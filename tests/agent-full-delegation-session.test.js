import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import accountHandler from "../api/account.js";
import agentHandler from "../api/agent.js";
import { resetAuthCache } from "../server/account-auth.js";
import {
  getOrCreateAgentSession,
  loadFarmProfile,
  recordAgentTurn,
  upsertFarmProfile,
} from "../server/agent-session-store.js";
import { createPglitePool, setPool } from "../server/db.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";
import {
  executeDelegatedTransaction,
  runAgentTurn,
  selectToolsForTurn,
} from "../server/nongnong-agent.js";
import { isUuid } from "../server/validate.js";
import { insertUser } from "./helpers/agent-db.js";

const TODAY = "2026-11-16";

const AI_ENV = [
  "APP_ENV",
  "DATABASE_URL",
  "AI_PROVIDER",
  "AI_FULL_TOOLS",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];

function saveEnv() {
  return Object.fromEntries(AI_ENV.map((k) => [k, process.env[k]]));
}

function restoreEnv(prev) {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function patchRes(res) {
  let code = 200;
  res.status = (c) => {
    code = c;
    return res;
  };
  res.json = (obj) => {
    if (!res.headersSent) res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
    return res;
  };
}

async function apiReq(baseUrl, path, { method = "GET", cookie = "", json = undefined, origin = baseUrl } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (method !== "GET" && method !== "HEAD") {
    headers.origin = origin;
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const setCookie = response.headers.getSetCookie?.() || [];
  const nextCookie = setCookie.length
    ? setCookie.map((c) => c.split(";")[0]).join("; ")
    : cookie;
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body, cookie: nextCookie };
}

async function signupHttp(baseUrl, username, name, password = "Password123!") {
  const res = await apiReq(baseUrl, "/api/account?action=signup", {
    method: "POST",
    json: { username, name, password },
  });
  assert.equal(res.status, 200, `signup failed: ${JSON.stringify(res.body)}`);
  return { user: res.body.user, cookie: res.cookie };
}

function scripted(responses) {
  const calls = [];
  const call = async (request) => {
    calls.push(structuredClone(request));
    const next = responses.shift();
    return next === undefined ? null : next;
  };
  return { call, calls };
}

let pool;
let server;
let baseUrl;
let prevEnv;
let owner;
let buyer;
let dbListing;

before(async () => {
  prevEnv = saveEnv();
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_FULL_TOOLS;
  process.env.APP_ENV = "test";

  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();

  await initEnvironment({ env: "test", pool });
  const migRes = await runMigrations({ env: "test", pool });
  assert.ok(migRes.applied.includes("0003_agent_core.sql"));
  assert.ok(migRes.applied.includes("0005_delegated_chat.sql"));

  await insertUser(pool, "u-a", "농가 A");
  await insertUser(pool, "u-b", "농가 B");

  const routeMap = new Map([
    ["/api/account", accountHandler],
    ["/api/agent", agentHandler],
  ]);

  server = createServer(async (req, res) => {
    patchRes(res);
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const handler = routeMap.get(url.pathname);
    if (!handler) {
      res.status(404).json({ error: { code: "NOT_FOUND" } });
      return;
    }
    await handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;

  owner = await signupHttp(baseUrl, "fd_owner", "김소유");
  buyer = await signupHttp(baseUrl, "fd_buyer", "박구매");

  const created = await createListing(
    owner.user,
    {
      id: randomUUID(),
      title: "아세아텍 관리기 AMC-900 대여",
      type: "rent",
      modelId: "asia-amc900",
      machineType: "cultivator",
      cropIds: ["pepper"],
      operations: ["ridge", "mulch"],
      areaMin: 300,
      areaMax: 2000,
      price: 55000,
      region: "영양읍",
      condition: "good",
      included: "두둑성형기 포함",
      pickup: "영양읍 농가 직접 인수",
      description: "고추 두둑 작업에 적합한 관리기입니다.",
    },
    { pool },
  );
  dbListing = created.listing;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await pool?.end();
  setPool(undefined);
  restoreEnv(prevEnv);
});

test("1. farm_profiles: upsertFarmProfile은 유효 필드만 병합 저장하고 loadFarmProfile이 반환한다", async () => {
  assert.equal(await loadFarmProfile("", { pool }), null);
  assert.equal(await loadFarmProfile("u-a", { pool }), null);

  const longRegion = "경상북도 영양군 영양읍 ".repeat(5);
  const longNotes = "가".repeat(600);
  const first = await upsertFarmProfile(
    "u-a",
    {
      region: longRegion,
      cropIds: ["pepper", "invalid_crop_id", "potato", "pepper"],
      areaPyeong: 600.9,
      notes: longNotes,
    },
    { pool },
  );
  assert.equal(first.region.length, 40);
  assert.deepEqual(first.cropIds, ["pepper", "potato"]);
  assert.equal(first.areaPyeong, 600);
  assert.equal(first.notes.length, 500);

  // 부분 업데이트 시 기존 region, cropIds, notes가 보존된다.
  const merged = await upsertFarmProfile(
    "u-a",
    {
      areaPyeong: 850,
      notes: "",
    },
    { pool },
  );
  assert.deepEqual(merged, {
    region: first.region,
    cropIds: ["pepper", "potato"],
    areaPyeong: 850,
    notes: first.notes,
  });

  // 무효 패치만 넘기면 기존 프로필을 그대로 반환한다.
  const noop = await upsertFarmProfile(
    "u-a",
    { region: "   ", cropIds: ["bogus"], areaPyeong: -1, notes: "" },
    { pool },
  );
  assert.deepEqual(noop, merged);

  const loaded = await loadFarmProfile("u-a", { pool });
  assert.deepEqual(loaded, merged);
});

test("2. agent_sessions / agent_messages / agent_tool_calls: 세션 생성·격리 및 턴 기록·슬롯 병합", async () => {
  assert.equal(await getOrCreateAgentSession("", null, { pool }), null);
  assert.equal(await recordAgentTurn({ userId: "", sessionId: randomUUID(), userMessage: "안녕", pool }), null);
  assert.equal(await recordAgentTurn({ userId: "u-a", sessionId: null, userMessage: "안녕", pool }), null);

  const sid = randomUUID();
  const created = await getOrCreateAgentSession("u-a", sid, {
    intent: "rent",
    slots: { region: "영양읍" },
    pool,
  });
  assert.equal(created.id, sid);
  assert.equal(created.userId, "u-a");
  assert.equal(created.intent, "rent");
  assert.equal(created.stage, "collecting");
  assert.deepEqual(created.slots, { region: "영양읍" });
  assert.equal(created.lastSeq, 0);

  // 잘못된 UUID면 새 UUID를 발급하고, 다른 사용자가 같은 sessionId를 요청하면 새 세션 ID로 격리한다.
  const generated = await getOrCreateAgentSession("u-a", "not-a-uuid", { pool });
  assert.ok(isUuid(generated.id));
  const isolated = await getOrCreateAgentSession("u-b", sid, { pool });
  assert.notEqual(isolated.id, sid);
  assert.equal(isolated.userId, "u-b");

  const turn1 = await recordAgentTurn({
    sessionId: sid,
    userId: "u-a",
    userMessage: "고추밭 600평 두둑 작업할 관리기 찾아요",
    assistantReply: "영양읍 고추밭에 맞는 관리기 매물을 찾았어요.",
    slotsPatch: { cropIds: ["pepper"], areaPyeong: 600, operations: ["ridge"] },
    intent: "rent",
    stage: "collecting",
    toolCalls: [
      {
        tool: "search_listings",
        args: { cropId: "pepper", operations: ["ridge"], transaction: "rent" },
        result: { count: 2 },
        ok: true,
        latencyMs: 14,
        model: "claude-haiku-5-5",
      },
    ],
    pool,
  });

  assert.equal(turn1.session.lastSeq, 2);
  assert.deepEqual(turn1.session.slots, {
    region: "영양읍",
    cropIds: ["pepper"],
    areaPyeong: 600,
    operations: ["ridge"],
  });
  assert.equal(turn1.toolCallCount, 1);

  // 2턴: 기존 슬롯 유지 + 새 슬롯 병합 + 4000자 초과 메시지 절단 + 실패 도구 호출 기록
  const turn2 = await recordAgentTurn({
    sessionId: sid,
    userId: "u-a",
    userMessage: "질".repeat(4500),
    assistantReply: "다시 확인해 드릴게요.",
    slotsPatch: { region: null, machineType: "cultivator" },
    stage: "confirming",
    toolCalls: [
      {
        tool: "create_rental_request",
        args: { listingId: "l-1" },
        result: { ok: false, code: "UNAVAILABLE" },
        ok: false,
        errorCode: "UNAVAILABLE",
        latencyMs: 18,
      },
    ],
    pool,
  });
  assert.equal(turn2.session.lastSeq, 4);
  assert.equal(turn2.session.slots.region, "영양읍");
  assert.equal(turn2.session.slots.machineType, "cultivator");

  const msgRes = await pool.query(
    `SELECT seq, role, body FROM agent_messages WHERE session_id = $1 ORDER BY seq ASC`,
    [sid],
  );
  assert.equal(msgRes.rows.length, 4);
  assert.equal(msgRes.rows[2].body.length, 4000);

  const tcRes = await pool.query(
    `SELECT message_id, tool, ok, error_code, latency_ms, model FROM agent_tool_calls WHERE session_id = $1 ORDER BY created_at ASC`,
    [sid],
  );
  assert.equal(tcRes.rows.length, 2);
  assert.equal(tcRes.rows[0].message_id, turn1.assistantMessageId);
  assert.equal(tcRes.rows[0].tool, "search_listings");
  assert.equal(tcRes.rows[0].ok, true);
  assert.equal(tcRes.rows[1].tool, "create_rental_request");
  assert.equal(tcRes.rows[1].ok, false);
  assert.equal(tcRes.rows[1].error_code, "UNAVAILABLE");
});

test("3. agent-session-store는 DB 오류 시 예외를 던지지 않고 null을 반환한다 (fail-open)", async () => {
  const brokenPool = {
    query: async () => {
      throw new Error("DB down");
    },
    connect: async () => {
      throw new Error("DB down");
    },
  };
  assert.equal(await loadFarmProfile("u-a", { pool: brokenPool }), null);
  assert.equal(await upsertFarmProfile("u-a", { region: "영양읍" }, { pool: brokenPool }), null);
  assert.equal(await getOrCreateAgentSession("u-a", randomUUID(), { pool: brokenPool }), null);
  assert.equal(
    await recordAgentTurn({
      sessionId: randomUUID(),
      userId: "u-a",
      userMessage: "안녕",
      assistantReply: "안녕하세요",
      pool: brokenPool,
    }),
    null,
  );
});

test("4. selectToolsForTurn은 기본 턴에 핵심 도구 15개만 포함하고 사진·수리·판매·보험 맥락에서 확장한다", () => {
  const coreOnly = selectToolsForTurn({ text: "고추밭 두둑 관리기 빌릴래요" });
  const coreNames = coreOnly.map((t) => t.name);
  assert.equal(coreNames.length, 15);
  assert.ok(coreNames.includes("delegate_transaction"));
  assert.ok(coreNames.includes("search_listings"));
  assert.ok(!coreNames.includes("note_photo"));
  assert.ok(!coreNames.includes("get_repair_guide"));
  assert.ok(!coreNames.includes("create_listing"));
  assert.ok(!coreNames.includes("get_insurance_info"));

  assert.equal(selectToolsForTurn({ hasImage: true }).length, 25);
  assert.equal(selectToolsForTurn({ text: "관리기 시동이 안 걸려요" }).length, 25);
  assert.equal(selectToolsForTurn({ text: "트랙터 팔고 싶어요" }).length, 25);
  assert.equal(selectToolsForTurn({ text: "보험도 들어야 하나요?" }).length, 25);
  assert.equal(selectToolsForTurn({ slots: { intent: "sell" } }).length, 25);

  process.env.AI_FULL_TOOLS = "1";
  try {
    assert.equal(selectToolsForTurn({ text: "고추" }).length, 25);
  } finally {
    delete process.env.AI_FULL_TOOLS;
  }
});

test("5. runAgentTurn은 farmProfile 기본값을 uiCtx에 주입하고 learnedSlots·delegate_transaction pendingAction 및 즉시 실행을 처리한다", async (t) => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  t.after(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  let capturedMeta = null;
  const { call, calls } = scripted([
    {
      content: [
        {
          type: "tool_use",
          id: "d1",
          name: "delegate_transaction",
          input: {
            listingId: dbListing.id,
            start: "2026-11-20",
            end: "2026-11-21",
            maxBudget: 60000,
            allowNegotiation: true,
            pickupPreference: "오전 9시 직접 인수",
            autoExecuteTransaction: true,
          },
        },
      ],
    },
  ]);

  const result = await runAgentTurn(
    "이 매물 농농이가 알아서 조율해 줘",
    {
      user: buyer.user,
      farmProfile: {
        region: "청기면",
        cropIds: ["pepper"],
        areaPyeong: 500,
        notes: "오전 작업 선호",
      },
      uiContext: {
        operations: ["ridge"],
      },
    },
    {
      listings: [dbListing],
      call,
      today: TODAY,
      deps: {
        onTurnComplete: (meta) => {
          capturedMeta = meta;
        },
      },
    },
  );

  // farmProfile 기본값이 시스템 프롬프트에 주입되었는지 확인
  assert.match(calls[0].system, /청기면/);
  assert.match(calls[0].system, /고추\(pepper\)/);
  assert.match(calls[0].system, /500평/);
  assert.match(calls[0].system, /오전 작업 선호/);

  // 비긍정 발화이므로 delegate_transaction은 pendingAction 확인 카드로 반환
  assert.equal(result.mode, "agent");
  assert.equal(result.pendingAction.type, "delegate_transaction");
  assert.equal(result.pendingAction.listingId, dbListing.id);
  assert.equal(result.pendingAction.areaPyeong, 500);
  assert.deepEqual(result.pendingAction.cropIds, ["pepper"]);
  assert.equal(result.pendingAction.maxBudget, 60000);
  assert.equal(result.pendingAction.allowNegotiation, true);

  // learnedSlots 추출 확인
  assert.equal(result.learnedSlots.region, "청기면");
  assert.deepEqual(result.learnedSlots.cropIds, ["pepper"]);
  assert.equal(result.learnedSlots.areaPyeong, 500);
  assert.equal(result.learnedSlots.start, "2026-11-20");
  assert.equal(result.learnedSlots.end, "2026-11-21");
  assert.equal(result.learnedSlots.maxPrice, 60000);
  assert.ok(capturedMeta);
  assert.equal(capturedMeta.stage, "confirming");
  assert.equal(capturedMeta.toolCalls[0].tool, "delegate_transaction");

  // 긍정 발화 + delegateTransaction deps 연결 시 즉시 실행
  const immediate = scripted([
    {
      content: [
        {
          type: "tool_use",
          id: "d2",
          name: "delegate_transaction",
          input: { listingId: dbListing.id, start: "2026-11-24", end: "2026-11-25", maxBudget: 55000 },
        },
      ],
    },
    { content: [{ type: "text", text: "전담 모드로 시작했어요." }] },
  ]);
  const immediateRes = await runAgentTurn(
    "네 진행해 주세요",
    { user: buyer.user },
    {
      listings: [dbListing],
      call: immediate.call,
      today: TODAY,
      deps: {
        beforeWrite: async () => {},
        delegateTransaction: (u, payload, { requestId }) => executeDelegatedTransaction(u, payload, { requestId, pool, today: TODAY }),
      },
    },
  );
  assert.equal(immediateRes.delegatedTransaction.listingId, dbListing.id);
  assert.equal(immediateRes.delegatedTransaction.mode, "autonomous");
  assert.equal(immediateRes.delegatedTransaction.fullDelegation, true);
  assert.equal(immediateRes.pendingAction, undefined);
});

test("6. executeDelegatedTransaction은 본인 매물을 차단하고, 타인 매물에 buyer_ai_mode='autonomous'와 fullDelegation 정책을 설정한다", async () => {
  const { listing: isolatedListing } = await createListing(
    owner.user,
    {
      id: randomUUID(),
      title: "아세아텍 관리기 AMC-900 전담 테스트",
      type: "rent",
      modelId: "asia-amc900",
      machineType: "cultivator",
      cropIds: ["pepper"],
      operations: ["ridge"],
      areaMin: 300,
      areaMax: 2000,
      price: 55000,
      region: "영양읍",
      condition: "good",
      included: "두둑성형기 포함",
      pickup: "영양읍 농가 직접 인수",
      description: "테스트 매물",
    },
    { pool },
  );

  const selfRes = await executeDelegatedTransaction(
    owner.user,
    { listingId: isolatedListing.id },
    { requestId: randomUUID(), pool, today: TODAY },
  );
  assert.equal(selfRes.outcome, "failed");
  assert.equal(selfRes.code, "SELF_INQUIRY_FORBIDDEN");

  const reqId = randomUUID();
  const execRes = await executeDelegatedTransaction(
    buyer.user,
    {
      listingId: isolatedListing.id,
      start: "2026-11-20",
      end: "2026-11-21",
      maxBudget: 60000,
      allowNegotiation: true,
      areaPyeong: 500,
      cropIds: ["pepper"],
      operations: ["ridge"],
      region: "청기면",
      pickupPreference: "직접 인수 희망",
      autoExecuteTransaction: true,
    },
    { requestId: reqId, pool, today: TODAY },
  );

  assert.equal(execRes.outcome, "completed");
  assert.equal(execRes.delegatedTransaction.listingId, isolatedListing.id);
  assert.equal(execRes.delegatedTransaction.mode, "autonomous");
  assert.equal(execRes.delegatedTransaction.fullDelegation, true);
  assert.equal(execRes.delegatedTransaction.policy.fullDelegation, true);
  assert.equal(execRes.delegatedTransaction.policy.autoExecuteTransaction, true);
  assert.equal(execRes.delegatedTransaction.policy.maxBudget, 60000);
  assert.equal(execRes.delegatedTransaction.policy.maxConsecutiveAiTurns, 6);

  const convId = execRes.delegatedTransaction.conversationId;
  const convRow = (
    await pool.query(
      `SELECT buyer_ai_mode, buyer_ai_policy, ai_paused_reason, last_seq FROM conversations WHERE id = $1`,
      [convId],
    )
  ).rows[0];
  assert.equal(convRow.buyer_ai_mode, "autonomous");
  assert.equal(convRow.buyer_ai_policy.fullDelegation, true);
  assert.equal(convRow.buyer_ai_policy.targetStart, "2026-11-20");
  assert.equal(convRow.ai_paused_reason, null);
  assert.equal(Number(convRow.last_seq), 1);

  const msgRow = (
    await pool.query(
      `SELECT sender_id, sender_kind, ai_confidence, body FROM messages WHERE conversation_id = $1 AND seq = 1`,
      [convId],
    )
  ).rows[0];
  assert.equal(msgRow.sender_id, buyer.user.id);
  assert.equal(msgRow.sender_kind, "ai_proxy");
  assert.equal(msgRow.ai_confidence, "high");
  assert.match(msgRow.body, /아세아텍 관리기/);

  // 동일 requestId 재시도 시 멱등성 유지
  const retryRes = await executeDelegatedTransaction(
    buyer.user,
    { listingId: isolatedListing.id, start: "2026-11-20", end: "2026-11-21" },
    { requestId: reqId, pool, today: TODAY },
  );
  assert.equal(retryRes.outcome, "completed");
  assert.equal(retryRes.idempotent, true);
  assert.equal(retryRes.delegatedTransaction.conversationId, convId);
});

test("7. /api/agent 엔드포인트는 chat에서 세션·농가 프로필을 저장하고 execute로 delegate_transaction을 실행한다", async (t) => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  t.after(() => {
    delete process.env.OPENAI_API_KEY;
  });

  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).startsWith("https://api.openai.com")) {
      return Response.json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_delegate_1",
                  type: "function",
                  function: {
                    name: "delegate_transaction",
                    arguments: JSON.stringify({
                      listingId: dbListing.id,
                      start: "2026-11-22",
                      end: "2026-11-23",
                      maxBudget: 55000,
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    }
    return realFetch(url, options);
  });

  const sessionId = randomUUID();
  const chatRes = await apiReq(baseUrl, "/api/agent", {
    method: "POST",
    cookie: buyer.cookie,
    json: {
      action: "chat",
      sessionId,
      message: "입암면 고추밭 400평에 쓸 관리기 전담시켜 줄까요?",
    },
  });
  assert.equal(chatRes.status, 200);
  assert.equal(chatRes.body.mode, "agent");
  assert.equal(chatRes.body.sessionId, sessionId);
  assert.equal(chatRes.body.pendingAction.type, "delegate_transaction");

  const storedProfile = await loadFarmProfile(buyer.user.id, { pool });
  assert.equal(storedProfile.region, "입암면");
  assert.deepEqual(storedProfile.cropIds, ["pepper"]);
  assert.equal(storedProfile.areaPyeong, 400);

  const sessRow = (await pool.query(`SELECT last_seq, stage, slots FROM agent_sessions WHERE id = $1`, [sessionId])).rows[0];
  assert.equal(Number(sessRow.last_seq), 2);
  assert.equal(sessRow.stage, "confirming");
  assert.equal(sessRow.slots.region, "입암면");

  const execRes = await apiReq(baseUrl, "/api/agent", {
    method: "POST",
    cookie: buyer.cookie,
    json: {
      action: "execute",
      requestId: randomUUID(),
      pendingAction: chatRes.body.pendingAction,
    },
  });
  assert.equal(execRes.status, 200);
  assert.equal(execRes.body.outcome, "completed");
  assert.equal(execRes.body.delegatedTransaction.mode, "autonomous");
  assert.equal(execRes.body.delegatedTransaction.fullDelegation, true);

  await new Promise((resolve) => setTimeout(resolve, 20));
});
