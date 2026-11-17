import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import accountHandler from "../api/account.js";
import agentChatReplyHandler from "../api/agent-chat-reply.js";
import conversationsHandler from "../api/conversations.js";
import { resetAuthCache } from "../server/account-auth.js";
import {
  dismissAiDraft,
  getConversationMessages,
  sendMessage,
  updateConversationAiPolicy,
} from "../server/chat.js";
import { createPglitePool, kstToday, setPool } from "../server/db.js";
import { runDelegatedChatReply } from "../server/delegated-chat.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, inspectDatabase, runMigrations } from "../server/migrator.js";
import { MAX_RENTAL_DAYS } from "../server/rentals.js";

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

let pool;
let server;
let baseUrl;
let prevEnv = {};
let owner;
let buyer;
let outsider;
let listing;

before(async () => {
  prevEnv = {
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ZAI_API_KEY: process.env.ZAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ZAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.APP_ENV = "test";

  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();

  await initEnvironment({ env: "test", pool });
  const migRes = await runMigrations({ env: "test", pool });
  assert.ok(migRes.applied.includes("0005_delegated_chat.sql"));

  const routeMap = new Map([
    ["/api/account", accountHandler],
    ["/api/conversations", conversationsHandler],
    ["/api/agent-chat-reply", agentChatReplyHandler],
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

  owner = await signupHttp(baseUrl, "dc_owner", "김소유");
  buyer = await signupHttp(baseUrl, "dc_buyer", "박구매");
  outsider = await signupHttp(baseUrl, "dc_outsider", "최외부");

  const created = await createListing(
    owner.user,
    {
      id: randomUUID(),
      title: "아세아 관리기 AMC-900 임대",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 150000,
      region: "영양읍",
      condition: "good",
      included: "로터리",
      pickup: "영양읍 농가 직접 인수",
      description: "오전 9시~오후 5시 직접 인수 가능합니다.",
    },
    { pool }
  );
  listing = created.listing;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await pool?.end();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("1. 0005 마이그레이션 스키마 및 updateConversationAiPolicy 권한·재활성화 검증", async () => {
  const info = await inspectDatabase({ pool });
  assert.ok(info.appliedMigrations.some((m) => m.version === "0005_delegated_chat.sql"));

  // 구매자가 매물 ID로 대화방 생성 및 AI 정책 설정
  const buyerPolicyRes = await updateConversationAiPolicy(
    buyer.user,
    {
      listingId: listing.id,
      mode: "copilot",
      policy: { instructions: "토요일 오전 인수 희망", maxConsecutiveAiTurns: 4 },
    },
    { pool }
  );
  assert.equal(buyerPolicyRes.role, "buyer");
  assert.equal(buyerPolicyRes.conversation.buyerAiMode, "copilot");
  assert.equal(buyerPolicyRes.conversation.ownerAiMode, "off");
  assert.equal(buyerPolicyRes.conversation.buyerAiPolicy.instructions, "토요일 오전 인수 희망");

  const convId = buyerPolicyRes.conversation.id;

  // 소유자도 동일 대화방에 autonomous 정책 설정
  const ownerPolicyRes = await updateConversationAiPolicy(
    owner.user,
    {
      conversationId: convId,
      mode: "autonomous",
      policy: { instructions: "오전 9시~12시 직접 인수만 가능, 흥정 불가", allowNegotiation: false },
    },
    { pool }
  );
  assert.equal(ownerPolicyRes.role, "owner");
  assert.equal(ownerPolicyRes.conversation.ownerAiMode, "autonomous");
  assert.equal(ownerPolicyRes.conversation.ownerAiPolicy.allowNegotiation, false);

  // 제3자는 설정 변경 불가
  await assert.rejects(
    () => updateConversationAiPolicy(outsider.user, { conversationId: convId, mode: "autonomous" }, { pool }),
    (err) => err.status === 403 && err.code === "FORBIDDEN"
  );
});

test("2. autonomous 자동 응대(ai_proxy) 및 동일 triggerSeq 멱등성 검증", async () => {
  const owner2 = await signupHttp(baseUrl, "dc_owner2", "이소유");
  const buyer2 = await signupHttp(baseUrl, "dc_buyer2", "정구매");
  const { listing: list2 } = await createListing(
    owner2.user,
    {
      id: randomUUID(),
      title: "얀마 이앙기 임대",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 120000,
      region: "입암면",
      condition: "good",
      pickup: "직접 인수",
      description: "주말 오전 인수 가능",
    },
    { pool }
  );

  const msgRes = await sendMessage(
    buyer2.user,
    { id: randomUUID(), listingId: list2.id, body: "이번 주 토요일 오전 10시에 인수 가능할까요?" },
    { pool }
  );
  const convId = msgRes.conversation.id;
  await updateConversationAiPolicy(
    owner2.user,
    { conversationId: convId, mode: "autonomous", policy: { instructions: "토요일 오전 가능" } },
    { pool }
  );

  let llmCallCount = 0;
  const mockCall = async ({ tools }) => {
    llmCallCount += 1;
    if (llmCallCount === 1) {
      return {
        content: [{ type: "tool_use", id: "t1", name: "get_listing_context", input: {} }],
      };
    }
    assert.ok(tools.some((t) => t.name === "send_proxy_reply"));
    return {
      content: [
        {
          type: "tool_use",
          id: "t2",
          name: "send_proxy_reply",
          input: {
            body: "네, 토요일 오전 10시 입암면 농가에서 직접 인수 가능합니다.",
            confidence: "high",
            rationale: "소유자 정책 및 매물 설명 일치",
          },
        },
      ],
    };
  };

  const r1 = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msgRes.message.seq,
    targetRole: "owner",
    pool,
    call: mockCall,
  });
  assert.equal(r1.action, "replied");
  assert.equal(r1.replyToSeq, msgRes.message.seq);
  assert.equal(r1.confidence, "high");

  // 동일 triggerSeq 재호출 시 멱등 차단
  const r2 = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msgRes.message.seq,
    targetRole: "owner",
    pool,
    call: mockCall,
  });
  assert.equal(r2.skipped, true);
  assert.equal(r2.reason, "ALREADY_REPLIED");

  const fetched = await getConversationMessages(buyer2.user.id, { conversationId: convId, pool });
  const aiMsgs = fetched.messages.filter((m) => m.senderKind === "ai_proxy");
  assert.equal(aiMsgs.length, 1);
  assert.equal(aiMsgs[0].replyToSeq, msgRes.message.seq);
  assert.equal(fetched.conversation.aiConsecutiveTurns, 1);
});

test("3. copilot 초안 생성(ai_draft_json) 및 dismissAiDraft 검증", async () => {
  const owner3 = await signupHttp(baseUrl, "dc_owner3", "최소유");
  const buyer3 = await signupHttp(baseUrl, "dc_buyer3", "한구매");
  const { listing: list3 } = await createListing(
    owner3.user,
    {
      id: randomUUID(),
      title: "아세아 관리기 임대",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 50000,
      region: "청기면",
      condition: "good",
      description: "고랑 작업 가능",
    },
    { pool }
  );

  const msgRes = await sendMessage(
    buyer3.user,
    { id: randomUUID(), listingId: list3.id, body: "내일 오전 사용 가능한가요?" },
    { pool }
  );
  const convId = msgRes.conversation.id;
  await updateConversationAiPolicy(owner3.user, { conversationId: convId, mode: "copilot" }, { pool });

  const mockCall = async () => ({
    content: [
      {
        type: "tool_use",
        id: "t1",
        name: "send_proxy_reply",
        input: { body: "내일 오전 예약 비어 있어 사용 가능합니다.", confidence: "high", rationale: "예약 없음" },
      },
    ],
  });

  const res = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msgRes.message.seq,
    targetRole: "owner",
    pool,
    call: mockCall,
  });
  assert.equal(res.action, "draft_saved");

  // 메시지는 자동 전송되지 않고 aiDraftJson에만 저장됨
  const state1 = await getConversationMessages(owner3.user.id, { conversationId: convId, pool });
  assert.equal(state1.messages.length, 1);
  assert.equal(state1.conversation.aiDraftJson?.targetUserId, owner3.user.id);
  assert.equal(state1.conversation.aiDraftJson?.body, "내일 오전 예약 비어 있어 사용 가능합니다.");

  // 초안 무시(dismiss)
  const dismissed = await dismissAiDraft(owner3.user, { conversationId: convId }, { pool });
  assert.equal(dismissed.conversation.aiDraftJson, null);
});

test("4. 에스컬레이션(escalate_to_user) 시 일시정지·system 기록 및 인간 개입 후 해제", async () => {
  const owner4 = await signupHttp(baseUrl, "dc_owner4", "송소유");
  const buyer4 = await signupHttp(baseUrl, "dc_buyer4", "강구매");
  const { listing: list4 } = await createListing(
    owner4.user,
    {
      id: randomUUID(),
      title: "국제 트랙터 60마력",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 180000,
      region: "영양읍",
      condition: "good",
      description: "흥정 불가",
    },
    { pool }
  );

  const msgRes = await sendMessage(
    buyer4.user,
    { id: randomUUID(), listingId: list4.id, body: "가격 20% 깎아주시면 바로 빌릴게요." },
    { pool }
  );
  const convId = msgRes.conversation.id;
  await updateConversationAiPolicy(
    owner4.user,
    { conversationId: convId, mode: "autonomous", policy: { allowNegotiation: false } },
    { pool }
  );

  const mockCall = async () => ({
    content: [
      {
        type: "tool_use",
        id: "t1",
        name: "escalate_to_user",
        input: {
          reasonCode: "price_negotiation",
          summaryForUser: "구매자가 20% 가격 할인을 요청해 소유자 확인이 필요합니다.",
          suggestedReplyDraft: "죄송하지만 정가 기준으로만 대여 가능합니다.",
        },
      },
    ],
  });

  const escRes = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msgRes.message.seq,
    targetRole: "owner",
    pool,
    call: mockCall,
  });
  assert.equal(escRes.action, "escalated");
  assert.equal(escRes.aiPausedReason, "escalated:price_negotiation");

  const pausedState = await getConversationMessages(owner4.user.id, { conversationId: convId, pool });
  assert.equal(pausedState.conversation.aiPausedReason, "escalated:price_negotiation");
  const sysMsg = pausedState.messages.find((m) => m.senderKind === "system");
  assert.ok(sysMsg);
  assert.equal(sysMsg.escalationReason, "price_negotiation");

  // 소유자가 직접 human 메시지를 보내면 aiPausedReason과 aiConsecutiveTurns가 초기화됨
  const humanReply = await sendMessage(
    owner4.user,
    { id: randomUUID(), conversationId: convId, body: "정가로만 가능합니다." },
    { pool }
  );
  assert.equal(humanReply.conversation.aiPausedReason, null);
  assert.equal(humanReply.conversation.aiConsecutiveTurns, 0);
});

test("5. AI-to-AI 핑퐁 상한(maxConsecutiveAiTurns) 및 system 메시지 무트리거 검증", async () => {
  const owner5 = await signupHttp(baseUrl, "dc_owner5", "윤소유");
  const buyer5 = await signupHttp(baseUrl, "dc_buyer5", "오구매");
  const { listing: list5 } = await createListing(
    owner5.user,
    {
      id: randomUUID(),
      title: "LS 트랙터 임대",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 160000,
      region: "석보면",
      condition: "good",
      description: "일정 조율 가능",
    },
    { pool }
  );

  const m1 = await sendMessage(
    buyer5.user,
    { id: randomUUID(), listingId: list5.id, body: "토요일 오전 대여 문의드립니다." },
    { pool }
  );
  const convId = m1.conversation.id;
  await updateConversationAiPolicy(
    owner5.user,
    { conversationId: convId, mode: "autonomous", policy: { maxConsecutiveAiTurns: 2 } },
    { pool }
  );
  await updateConversationAiPolicy(
    buyer5.user,
    { conversationId: convId, mode: "autonomous", policy: { maxConsecutiveAiTurns: 2 } },
    { pool }
  );

  let turn = 0;
  const mockCall = async () => {
    turn += 1;
    return {
      content: [
        {
          type: "tool_use",
          id: `t_${turn}`,
          name: "send_proxy_reply",
          input: { body: `자동 조율 응답 ${turn}`, confidence: "high" },
        },
      ],
    };
  };

  // Turn 1 (owner AI replies to buyer human)
  const r1 = await runDelegatedChatReply({ conversationId: convId, triggerSeq: m1.message.seq, targetRole: "owner", pool, call: mockCall });
  assert.equal(r1.action, "replied");
  assert.equal(r1.aiConsecutiveTurns, 1);

  // Turn 2 (buyer AI replies to owner AI)
  const r2 = await runDelegatedChatReply({ conversationId: convId, triggerSeq: r1.seq, targetRole: "buyer", pool, call: mockCall });
  assert.equal(r2.action, "replied");
  assert.equal(r2.aiConsecutiveTurns, 2);

  // Turn 3 (owner AI hits maxConsecutiveAiTurns=2 -> both_ai_handoff pause!)
  const r3 = await runDelegatedChatReply({ conversationId: convId, triggerSeq: r2.seq, targetRole: "owner", pool, call: mockCall });
  assert.equal(r3.skipped, true);
  assert.equal(r3.paused, true);
  assert.equal(r3.reason, "both_ai_handoff");

  // system 메시지에 대해서는 트리거가 무시됨
  const afterPause = await getConversationMessages(owner5.user.id, { conversationId: convId, pool });
  const sysSeq = afterPause.messages[afterPause.messages.length - 1].seq;
  assert.equal(afterPause.messages[afterPause.messages.length - 1].senderKind, "system");
  const rSys = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: sysSeq,
    targetRole: "buyer",
    forceDraft: true,
    pool,
    call: mockCall,
  });
  // forceDraft=false면 SYSTEM_MESSAGE_IGNORED
  const rSysAuto = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: sysSeq,
    targetRole: "buyer",
    pool,
    call: mockCall,
  });
  assert.equal(rSysAuto.skipped, true);
  assert.ok(rSysAuto.reason === "AI_PAUSED" || rSysAuto.reason === "SYSTEM_MESSAGE_IGNORED");
  assert.ok(rSys);
});

test("6. LLM 실행 중 인간 답장 도착 시 스테일 AI 응답 폐기 및 propose_rental_handoff DB 미삽입 검증", async () => {
  const owner6 = await signupHttp(baseUrl, "dc_owner6", "임소유");
  const buyer6 = await signupHttp(baseUrl, "dc_buyer6", "서구매");
  const { listing: list6 } = await createListing(
    owner6.user,
    {
      id: randomUUID(),
      title: "동양 콤바인 임대",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 250000,
      region: "영양읍",
      condition: "good",
      description: "직접 인수",
    },
    { pool }
  );

  const m1 = await sendMessage(
    buyer6.user,
    { id: randomUUID(), listingId: list6.id, body: "내일 대여 가능할까요?" },
    { pool }
  );
  const convId = m1.conversation.id;
  await updateConversationAiPolicy(owner6.user, { conversationId: convId, mode: "autonomous" }, { pool });

  // LLM 호출 도중에 소유자가 직접 답장함
  const staleCall = async () => {
    await sendMessage(
      owner6.user,
      { id: randomUUID(), conversationId: convId, body: "제가 직접 답장드릴게요, 내일 가능합니다!" },
      { pool }
    );
    return {
      content: [
        {
          type: "tool_use",
          id: "t_stale",
          name: "send_proxy_reply",
          input: { body: "뒤늦은 AI 답변", confidence: "high" },
        },
      ],
    };
  };

  const staleRes = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: m1.message.seq,
    targetRole: "owner",
    pool,
    call: staleCall,
  });
  assert.equal(staleRes.aborted, true);
  assert.equal(staleRes.reason, "STALE_TRIGGER_ON_COMMIT");

  // propose_rental_handoff는 rental_requests에 행을 추가하지 않음
  const m2 = await sendMessage(
    buyer6.user,
    { id: randomUUID(), conversationId: convId, body: "모레 하루 대여로 진행할게요." },
    { pool }
  );
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const handoffCall = async () => ({
    content: [
      {
        type: "tool_use",
        id: "t_handoff",
        name: "propose_rental_handoff",
        input: { start: tomorrow, end: tomorrow, estimatedPrice: 250000, note: "오전 9시 인수" },
      },
    ],
  });
  const handoffRes = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: m2.message.seq,
    targetRole: "owner",
    today: kstToday(),
    pool,
    call: handoffCall,
  });
  assert.equal(handoffRes.action, "handoff_proposed");

  const rentalRows = await pool.query(`SELECT COUNT(*)::int AS cnt FROM rental_requests WHERE listing_id = $1`, [list6.id]);
  assert.equal(rentalRows.rows[0].cnt, 0);
});

test("7. LLM 키 미설정 시 안전 종료 및 HTTP /api/conversations + /api/agent-chat-reply 검증", async () => {
  const skipped = await runDelegatedChatReply({
    conversationId: randomUUID(),
    triggerSeq: 1,
    targetRole: "owner",
    pool,
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, "LLM_UNAVAILABLE");

  // HTTP: update_ai_policy & send with aiReplyScheduled=true
  const policyHttp = await apiReq(baseUrl, "/api/conversations", {
    method: "POST",
    cookie: buyer.cookie,
    json: {
      listingId: listing.id,
      action: "update_ai_policy",
      mode: "copilot",
      policy: { instructions: "오전 희망" },
    },
  });
  assert.equal(policyHttp.status, 200);
  const convId = policyHttp.body.conversation.id;

  const sendHttp = await apiReq(baseUrl, "/api/conversations", {
    method: "POST",
    cookie: owner.cookie,
    json: {
      action: "send",
      id: randomUUID(),
      conversationId: convId,
      body: "네 오전 가능합니다.",
    },
  });
  assert.equal(sendHttp.status, 201);
  assert.equal(sendHttp.body.aiReplyScheduled, true);

  // HTTP /api/agent-chat-reply: 제3자 접근 차단
  const forbiddenHttp = await apiReq(baseUrl, "/api/agent-chat-reply", {
    method: "POST",
    cookie: outsider.cookie,
    json: { conversationId: convId },
  });
  assert.equal(forbiddenHttp.status, 403);

  // HTTP /api/agent-chat-reply: 참여자(buyer, copilot 모드) 호출 시 LLM 키 없으면 skipped 반환하며 200
  const replyHttp = await apiReq(baseUrl, "/api/agent-chat-reply", {
    method: "POST",
    cookie: buyer.cookie,
    json: { conversationId: convId },
  });
  assert.equal(replyHttp.status, 200);
  assert.equal(replyHttp.body.result.skipped, true);
  assert.equal(replyHttp.body.result.reason, "LLM_UNAVAILABLE");
});

test("8. fullDelegation 거래 전담 모드: 환경·예산 검증 후 대여/구매 자동 접수(transaction_completed) 검증", async () => {
  const owner8 = await signupHttp(baseUrl, "dc_owner8", "전담소유");
  const buyer8 = await signupHttp(baseUrl, "dc_buyer8", "전담구매");
  const { listing: rentListing } = await createListing(
    owner8.user,
    {
      id: randomUUID(),
      title: "아세아 관리기 풀세트 대여",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till", "ridge"],
      areaMin: 300,
      areaMax: 2500,
      price: 120000,
      region: "영양읍",
      condition: "good",
      included: "로터리, 두둑성형기",
      pickup: "영양읍 창고 오전 9시 직접 인수",
      description: "고추밭 작업에 적합합니다.",
    },
    { pool }
  );

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const policyRes = await updateConversationAiPolicy(
    buyer8.user,
    {
      listingId: rentListing.id,
      mode: "autonomous",
      policy: {
        fullDelegation: true,
        intent: "rent",
        targetStart: tomorrow,
        targetEnd: tomorrow,
        maxBudget: 150000,
        allowNegotiation: false,
        areaPyeong: 500,
        cropIds: ["pepper"],
        operations: ["till"],
        ownedModelId: null,
        region: "영양읍",
        pickupPreference: "오전 9시 직접 인수",
        customRules: "비 오는 날 제외",
      },
    },
    { pool }
  );
  assert.equal(policyRes.conversation.buyerAiPolicy.fullDelegation, true);
  assert.equal(policyRes.conversation.buyerAiPolicy.autoExecuteTransaction, true);
  assert.equal(policyRes.conversation.buyerAiPolicy.maxConsecutiveAiTurns, 6);
  assert.equal(policyRes.conversation.buyerAiPolicy.maxBudget, 150000);
  const convId = policyRes.conversation.id;

  const ownerReply = await sendMessage(
    owner8.user,
    { id: randomUUID(), conversationId: convId, body: `내일(${tomorrow}) 오전 9시 12만원에 대여 가능합니다.` },
    { pool }
  );

  let round = 0;
  const mockWeather = async ({ region }) => ({
    region,
    weather: { date: tomorrow, summary: "맑음", icon: "sun", suitability: "good", pop: 10, tempMin: 8, tempMax: 18 },
    rangeForecast: [{ date: tomorrow, summary: "맑음", icon: "sun", suitability: "good", pop: 10, tempMin: 8, tempMax: 18 }],
  });
  const mockCall = async ({ system, tools }) => {
    round += 1;
    assert.ok(system.includes("거래 전담 모드 (Full Delegation)"));
    assert.ok(system.includes("150,000원"));
    assert.ok(tools.some((t) => t.name === "complete_delegated_transaction"));
    if (round === 1) {
      return {
        content: [
          { type: "tool_use", id: "c1", name: "check_availability", input: { start: tomorrow, end: tomorrow } },
          { type: "tool_use", id: "c2", name: "get_weather", input: { region: "영양읍", date: tomorrow, endDate: tomorrow } },
          { type: "tool_use", id: "c3", name: "check_farm_compatibility", input: { areaPyeong: 500 } },
        ],
      };
    }
    return {
      content: [
        {
          type: "tool_use",
          id: "c4",
          name: "complete_delegated_transaction",
          input: {
            start: tomorrow,
            end: tomorrow,
            agreedPrice: 120000,
            note: "오전 9시 직접 인수 합의",
            closingReply: "날씨와 일정·예산이 모두 맞아 내일 오전 9시 인수로 대여 신청을 자동 접수했습니다.",
          },
        },
      ],
    };
  };

  const txRes = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: ownerReply.message.seq,
    targetRole: "buyer",
    today: kstToday(),
    pool,
    call: mockCall,
    getWeather: mockWeather,
  });
  assert.equal(txRes.action, "transaction_completed");
  assert.equal(txRes.kind, "rental");
  assert.equal(txRes.aiPausedReason, "transaction_completed");
  assert.equal(txRes.rentalRequest.listingId, rentListing.id);
  assert.equal(txRes.rentalRequest.requesterId, buyer8.user.id);
  assert.equal(txRes.rentalRequest.totalPrice, 120000);
  assert.equal(txRes.rentalRequest.status, "pending");

  const rentalCheck = await pool.query(`SELECT * FROM rental_requests WHERE listing_id = $1`, [rentListing.id]);
  assert.equal(rentalCheck.rows.length, 1);
  assert.equal(rentalCheck.rows[0].requester_id, buyer8.user.id);

  const convState = await getConversationMessages(buyer8.user.id, { conversationId: convId, pool });
  assert.equal(convState.conversation.aiPausedReason, "transaction_completed");
  assert.ok(convState.messages.some((m) => m.senderKind === "ai_proxy" && m.body.includes("자동 접수")));

  // 판매 매물에 대해서도 purchase_orders 자동 생성 검증
  const { listing: saleListing } = await createListing(
    owner8.user,
    {
      id: randomUUID(),
      title: "중고 구보다 트랙터 판매",
      type: "sale",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 3500000,
      region: "영양읍",
      condition: "used",
      pickup: "영양읍 직거래",
      description: "정상 작동합니다.",
    },
    { pool }
  );
  await updateConversationAiPolicy(
    buyer8.user,
    {
      listingId: saleListing.id,
      mode: "autonomous",
      policy: { fullDelegation: true, intent: "sale", maxBudget: 4000000, pickupPreference: "영양읍 직거래" },
    },
    { pool }
  );
  const ownerSaleReply = await sendMessage(
    owner8.user,
    { id: randomUUID(), conversationId: (await getConversationMessages(buyer8.user.id, { listingId: saleListing.id, pool })).conversation.id, body: "350만원에 직거래 가능합니다." },
    { pool }
  );
  const saleTxRes = await runDelegatedChatReply({
    conversationId: ownerSaleReply.conversation.id,
    triggerSeq: ownerSaleReply.message.seq,
    targetRole: "buyer",
    pool,
    call: async () => ({
      content: [
        {
          type: "tool_use",
          id: "s1",
          name: "complete_delegated_transaction",
          input: {
            agreedPrice: 3500000,
            note: "영양읍 직거래 합의",
            closingReply: "예산 범위 내 조건이라 구매 신청을 자동 접수했습니다.",
          },
        },
      ],
    }),
  });
  assert.equal(saleTxRes.action, "transaction_completed");
  assert.equal(saleTxRes.kind, "purchase");
  assert.equal(saleTxRes.purchaseOrder.listingId, saleListing.id);
  assert.equal(saleTxRes.purchaseOrder.buyerId, buyer8.user.id);
  assert.equal(saleTxRes.purchaseOrder.price, 3500000);
  assert.equal(saleTxRes.purchaseOrder.status, "pending");
});

test("9. 정보 부족·예산 초과 시 무응답 대기(ai_proxy 미전송 및 waitingForUser) 검증", async () => {
  const owner9 = await signupHttp(baseUrl, "dc_owner9", "대기소유");
  const buyer9 = await signupHttp(baseUrl, "dc_buyer9", "대기구매");
  const { listing: list9 } = await createListing(
    owner9.user,
    {
      id: randomUUID(),
      title: "대동 경운기 대여",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 100000,
      region: "영양읍",
      condition: "good",
      description: "직접 인수",
    },
    { pool }
  );

  // Case A: 매물 정보에 없는 질문(미기재 수리 이력) -> ai_proxy 전송 없이 escalate 및 사용자 대기
  const q1 = await sendMessage(
    buyer9.user,
    { id: randomUUID(), listingId: list9.id, body: "작년에 미션 오일 교환이나 엔진 수리 이력이 있나요?" },
    { pool }
  );
  const convId = q1.conversation.id;
  await updateConversationAiPolicy(owner9.user, { conversationId: convId, mode: "autonomous" }, { pool });

  const escUnknown = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: q1.message.seq,
    targetRole: "owner",
    pool,
    call: async () => ({
      content: [
        {
          type: "tool_use",
          id: "u1",
          name: "escalate_to_user",
          input: {
            reasonCode: "unknown_condition",
            summaryForUser: "매물 정보에 작년 미션 오일 교환 및 수리 이력이 없어 답변하지 않고 기다리고 있어요.",
            suggestedReplyDraft: "작년 가을에 점검 후 오일 교환 완료했습니다.",
          },
        },
      ],
    }),
  });
  assert.equal(escUnknown.action, "escalated");
  assert.equal(escUnknown.waitingForUser, true);
  assert.equal(escUnknown.aiPausedReason, "escalated:unknown_condition");

  const stateAfterUnknown = await getConversationMessages(owner9.user.id, { conversationId: convId, pool });
  assert.equal(stateAfterUnknown.messages.filter((m) => m.senderKind === "ai_proxy").length, 0);
  assert.equal(stateAfterUnknown.conversation.waitingForUser, true);
  assert.ok(stateAfterUnknown.conversation.escalationSummary.includes("수리 이력"));
  assert.equal(stateAfterUnknown.conversation.aiDraftJson?.waitingForUser, true);
  assert.equal(stateAfterUnknown.conversation.aiDraftJson?.suggestedReplyDraft, "작년 가을에 점검 후 오일 교환 완료했습니다.");

  // Case B: fullDelegation 모드에서 예산 초과 제안 -> 서버 가드레일이 자동 실행 차단 및 무응답 대기
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await updateConversationAiPolicy(
    buyer9.user,
    {
      conversationId: convId,
      mode: "autonomous",
      policy: { fullDelegation: true, intent: "rent", targetStart: tomorrow, targetEnd: tomorrow, maxBudget: 90000 },
    },
    { pool }
  );
  const q2 = await sendMessage(
    owner9.user,
    { id: randomUUID(), conversationId: convId, body: "운반비 포함해서 13만원에 대여 가능합니다." },
    { pool }
  );
  const escBudget = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: q2.message.seq,
    targetRole: "buyer",
    today: kstToday(),
    pool,
    call: async () => ({
      content: [
        {
          type: "tool_use",
          id: "b1",
          name: "complete_delegated_transaction",
          input: {
            start: tomorrow,
            end: tomorrow,
            agreedPrice: 130000,
            closingReply: "13만원으로 접수하겠습니다.",
          },
        },
      ],
    }),
  });
  assert.equal(escBudget.action, "escalated");
  assert.equal(escBudget.reasonCode, "budget_exceeded");
  assert.equal(escBudget.aiPausedReason, "escalated:budget_exceeded");
  assert.equal(escBudget.waitingForUser, true);

  const rentalCount = await pool.query(`SELECT COUNT(*)::int AS cnt FROM rental_requests WHERE listing_id = $1`, [list9.id]);
  assert.equal(rentalCount.rows[0].cnt, 0);
  const stateAfterBudget = await getConversationMessages(buyer9.user.id, { conversationId: convId, pool });
  assert.equal(stateAfterBudget.messages.filter((m) => m.senderKind === "ai_proxy").length, 0);
});

test("10. 대리 채팅 대여 경로에서 365일 초과 대여 기간 거부 및 365일 상한 허용 검증", async () => {
  const owner10 = await signupHttp(baseUrl, "dc_owner10", "기간소유");
  const buyer10 = await signupHttp(baseUrl, "dc_buyer10", "기간구매");
  const { listing: list10 } = await createListing(
    owner10.user,
    {
      id: randomUUID(),
      title: "대동 트랙터 장기 대여",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 100000,
      region: "영양읍",
      condition: "good",
      description: "직접 인수",
    },
    { pool }
  );

  const shiftDays = (iso, delta) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  };
  const today = kstToday();
  const start = shiftDays(today, 1);
  const tooLongEnd = shiftDays(start, MAX_RENTAL_DAYS); // MAX_RENTAL_DAYS + 1 일
  const maxAllowedEnd = shiftDays(start, MAX_RENTAL_DAYS - 1); // MAX_RENTAL_DAYS 일

  const firstMsg = await sendMessage(
    buyer10.user,
    { id: randomUUID(), listingId: list10.id, body: "장기 대여 가능한가요?" },
    { pool }
  );
  const convId = firstMsg.conversation.id;

  // Case A: fullDelegation 모드에서 check_availability 및 complete_delegated_transaction 모두 365일 초과 거부
  await updateConversationAiPolicy(
    buyer10.user,
    {
      conversationId: convId,
      mode: "autonomous",
      policy: { fullDelegation: true, intent: "rent", targetStart: start, targetEnd: tooLongEnd },
    },
    { pool }
  );
  const ownerReplyA = await sendMessage(
    owner10.user,
    { id: randomUUID(), conversationId: convId, body: "원하시는 날짜 알려주시면 확인해드릴게요." },
    { pool }
  );

  let roundA = 0;
  let checkTooLongOut = null;
  let checkMaxOut = null;
  const resTooLong = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: ownerReplyA.message.seq,
    targetRole: "buyer",
    today,
    pool,
    call: async ({ messages }) => {
      roundA += 1;
      if (roundA === 1) {
        return {
          content: [
            { type: "tool_use", id: "chk_over", name: "check_availability", input: { start, end: tooLongEnd } },
            { type: "tool_use", id: "chk_max", name: "check_availability", input: { start, end: maxAllowedEnd } },
          ],
        };
      }
      const lastUser = messages[messages.length - 1];
      const toolResults = Array.isArray(lastUser?.content) ? lastUser.content : [];
      checkTooLongOut = JSON.parse(toolResults.find((b) => b.tool_use_id === "chk_over").content);
      checkMaxOut = JSON.parse(toolResults.find((b) => b.tool_use_id === "chk_max").content);
      return {
        content: [
          {
            type: "tool_use",
            id: "tx_over",
            name: "complete_delegated_transaction",
            input: {
              start,
              end: tooLongEnd,
              closingReply: "366일 대여 접수하겠습니다.",
            },
          },
        ],
      };
    },
  });

  assert.ok(checkTooLongOut?.error?.includes(String(MAX_RENTAL_DAYS)));
  assert.equal(checkMaxOut?.available, true);
  assert.equal(checkMaxOut?.days, MAX_RENTAL_DAYS);
  assert.equal(resTooLong.action, "escalated");
  assert.equal(resTooLong.reasonCode, "invalid_schedule");
  assert.equal(resTooLong.waitingForUser, true);

  const countAfterA = await pool.query(`SELECT COUNT(*)::int AS cnt FROM rental_requests WHERE listing_id = $1`, [list10.id]);
  assert.equal(countAfterA.rows[0].cnt, 0);

  // Case B: 일반 autonomous 모드에서 propose_rental_handoff도 365일 초과 시 거부
  const buyerReplyB = await sendMessage(
    buyer10.user,
    { id: randomUUID(), conversationId: convId, body: "날짜 다시 확인해주세요." },
    { pool }
  );
  await updateConversationAiPolicy(
    buyer10.user,
    {
      conversationId: convId,
      mode: "autonomous",
      policy: { fullDelegation: false, intent: "rent" },
    },
    { pool }
  );
  const ownerReplyB = await sendMessage(
    owner10.user,
    { id: randomUUID(), conversationId: convId, body: "366일이나 365일 중 어떤 걸로 할까요?" },
    { pool }
  );

  let roundB = 0;
  let handoffOverOut = null;
  const resHandoff = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: ownerReplyB.message.seq,
    targetRole: "buyer",
    today,
    pool,
    call: async ({ messages }) => {
      roundB += 1;
      if (roundB === 1) {
        return {
          content: [
            {
              type: "tool_use",
              id: "ho_over",
              name: "propose_rental_handoff",
              input: { start, end: tooLongEnd },
            },
          ],
        };
      }
      const lastUser = messages[messages.length - 1];
      const toolResults = Array.isArray(lastUser?.content) ? lastUser.content : [];
      handoffOverOut = JSON.parse(toolResults.find((b) => b.tool_use_id === "ho_over").content);
      return {
        content: [
          {
            type: "tool_use",
            id: "reply_ok",
            name: "send_proxy_reply",
            input: {
              body: `대여 기간은 최대 ${MAX_RENTAL_DAYS}일까지 가능해서 기간을 조정해 주세요.`,
              confidence: "high",
              rationale: "최대 대여 기간 초과 안내",
            },
          },
        ],
      };
    },
  });

  assert.ok(handoffOverOut?.error?.includes(String(MAX_RENTAL_DAYS)));
  assert.equal(resHandoff.action, "replied");
  assert.equal(buyerReplyB.message.seq < ownerReplyB.message.seq, true);

  const countAfterB = await pool.query(`SELECT COUNT(*)::int AS cnt FROM rental_requests WHERE listing_id = $1`, [list10.id]);
  assert.equal(countAfterB.rows[0].cnt, 0);
});
