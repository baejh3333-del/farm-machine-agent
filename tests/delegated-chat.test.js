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
import { acceptOffer, submitOffer } from "../server/trade-negotiation.js";
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
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
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

  // 구매자(상대)가 다시 메시지를 보내도 판매자 쪽 확인 대기는 풀리지 않는다.
  const buyerAgain = await sendMessage(
    buyer4.user,
    { id: randomUUID(), conversationId: convId, body: "그럼 10%라도 안 될까요?" },
    { pool }
  );
  const stillPaused = await getConversationMessages(owner4.user.id, { conversationId: convId, pool });
  assert.equal(stillPaused.conversation.aiPausedReason, "escalated:price_negotiation");
  const blocked = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: buyerAgain.message.seq,
    targetRole: "owner",
    pool,
    call: mockCall,
  });
  assert.equal(blocked.skipped, true);
  assert.equal(blocked.reason, "AI_PAUSED");

  // 판매자가 직접 답하면 '직접 이어받기(takeover)'로 남고 연속 AI 턴은 초기화된다. 다시 맡기기 전까지 자동 응대 없음.
  const humanReply = await sendMessage(
    owner4.user,
    { id: randomUUID(), conversationId: convId, body: "정가로만 가능합니다." },
    { pool }
  );
  assert.equal(humanReply.conversation.aiPausedReason, "takeover");
  assert.equal(humanReply.conversation.aiConsecutiveTurns, 0);

  const resumed = await updateConversationAiPolicy(
    owner4.user,
    { conversationId: convId, mode: "autonomous", resume: true },
    { pool }
  );
  assert.equal(resumed.conversation.aiPausedReason, null);
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
  const staleAi = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM messages WHERE conversation_id = $1 AND sender_kind = 'ai_proxy'`,
    [convId]
  );
  assert.equal(staleAi.rows[0].cnt, 0);

  // 직접 이어받은 뒤에는 새 메시지가 와도 다시 맡기기 전까지 자동 응대하지 않는다.
  const m2 = await sendMessage(
    buyer6.user,
    { id: randomUUID(), conversationId: convId, body: "내일 하루 대여로 진행할게요." },
    { pool }
  );
  const pausedRes = await runDelegatedChatReply({ conversationId: convId, triggerSeq: m2.message.seq, targetRole: "owner", pool, call: staleCall });
  assert.equal(pausedRes.reason, "AI_PAUSED");

  // 다시 맡긴 뒤 판매자 AI는 구조화 제안만 등록하고 대여 신청(rental_requests)은 만들지 않는다.
  await updateConversationAiPolicy(owner6.user, { conversationId: convId, mode: "autonomous", resume: true }, { pool });
  const m3 = await sendMessage(
    buyer6.user,
    { id: randomUUID(), conversationId: convId, body: "조건 알려주세요." },
    { pool }
  );
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const offerCall = async ({ tools }) => {
    assert.ok(!tools.some((t) => t.name === "apply_agreed_offer"), "판매자 AI에는 신청 도구가 없다");
    return {
      content: [
        {
          type: "tool_use",
          id: "t_offer",
          name: "submit_offer",
          input: {
            amount: 250000,
            amountUnit: "total",
            start: tomorrow,
            end: tomorrow,
            transportPayer: "none",
            transportFee: 0,
            note: "오전 9시 직접 인수",
            message: "내일 하루 25만원, 오전 9시 직접 인수 조건으로 제안드려요.",
          },
        },
      ],
    };
  };
  const offerRes = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: m3.message.seq,
    targetRole: "owner",
    today: kstToday(),
    pool,
    call: offerCall,
  });
  assert.equal(offerRes.action, "offer_submitted");
  assert.equal(offerRes.offer.fromRole, "owner");
  assert.equal(offerRes.offer.acceptedByOwner, true);
  assert.equal(offerRes.offer.acceptedByBuyer, false);
  assert.equal(offerRes.offer.totalAmount, 250000);

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

test("8. 거래 전담: 목표가를 향한 구조화 역제안 → 양측 합의 → 합의 금액 그대로 신청(대여·구매), 중복 신청 없음", async () => {
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
        targetPrice: 110000,
        maxBudget: 150000,
        budgetUnit: "total",
        allowNegotiation: true,
        areaPyeong: 500,
        pickupPreference: "오전 9시 직접 인수",
      },
    },
    { pool }
  );
  assert.equal(policyRes.conversation.buyerAiPolicy.fullDelegation, true);
  assert.equal(policyRes.conversation.buyerAiPolicy.autoExecuteTransaction, true);
  assert.equal(policyRes.conversation.buyerAiPolicy.maxBudget, 150000);
  const convId = policyRes.conversation.id;

  // 판매자(사람)가 정가 12만원·직접 인수 조건을 구조화 제안으로 보낸다.
  const ownerMsg = await sendMessage(
    owner8.user,
    { id: randomUUID(), conversationId: convId, body: `내일(${tomorrow}) 오전 9시 직접 인수, 12만원입니다.` },
    { pool }
  );
  const ownerOffer = await submitOffer(
    {
      conversationId: convId,
      actorUserId: owner8.user.id,
      terms: { amount: 120000, amountUnit: "total", start: tomorrow, end: tomorrow, transportPayer: "none" },
    },
    { pool }
  );
  assert.equal(ownerOffer.offer.termsVersion, 1);

  let round = 0;
  let seenPrompt = "";
  const mockWeather = async ({ region }) => ({ region, weather: { date: tomorrow, summary: "맑음", suitability: "good" } });
  const counterCall = async ({ system, tools, messages }) => {
    round += 1;
    seenPrompt = system;
    assert.ok(tools.some((t) => t.name === "submit_offer"));
    assert.ok(tools.some((t) => t.name === "apply_agreed_offer"));
    if (round === 1) {
      return { content: [{ type: "tool_use", id: "n1", name: "get_negotiation_state", input: {} }] };
    }
    const state = JSON.parse(messages[messages.length - 1].content.find((b) => b.tool_use_id === "n1").content);
    assert.equal(state.myEvaluation.verdict, "counter_in_range");
    assert.equal(state.myEvaluation.counterSuggestion.amount, 115000);
    assert.equal(JSON.stringify(state).includes("150000"), false, "한도 원값은 도구 결과에 없다");
    return {
      content: [
        {
          type: "tool_use",
          id: "n2",
          name: "submit_offer",
          input: {
            amount: state.myEvaluation.counterSuggestion.amount,
            amountUnit: "total",
            start: tomorrow,
            end: tomorrow,
            transportPayer: "none",
            transportFee: 0,
            message: "직접 인수로 11만 5천원이면 바로 진행하고 싶습니다.",
          },
        },
      ],
    };
  };

  // 메시지가 먼저였고 제안이 뒤였으므로 트리거는 최신 seq(판매자 메시지)
  const counterRes = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: ownerMsg.message.seq,
    targetRole: "buyer",
    today: kstToday(),
    pool,
    call: counterCall,
    getWeather: mockWeather,
  });
  assert.equal(counterRes.action, "offer_submitted");
  assert.equal(counterRes.offer.termsVersion, 2);
  assert.equal(counterRes.offer.fromRole, "buyer");
  assert.equal(counterRes.offer.itemTotal, 115000);
  assert.equal(seenPrompt.includes("150,000"), false, "최대 예산은 프롬프트에 없다");
  assert.equal(seenPrompt.includes("110,000"), false, "목표가는 프롬프트에 없다");
  assert.ok(seenPrompt.includes("빌리는 분"));

  // 판매자(사람)가 같은 버전(v2)에 수락 → 합의
  const accepted = await acceptOffer(
    { conversationId: convId, actorUserId: owner8.user.id, offerId: counterRes.offer.id, termsVersion: 2 },
    { pool }
  );
  assert.equal(accepted.agreed, true);
  const ownerOk = await sendMessage(owner8.user, { id: randomUUID(), conversationId: convId, body: "좋습니다, 그렇게 하죠." }, { pool });

  const applyCall = async () => ({
    content: [{ type: "tool_use", id: "a1", name: "apply_agreed_offer", input: { message: "합의한 조건으로 대여 신청을 접수했어요. 승인해 주시면 확정됩니다." } }],
  });
  const applyRes = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: ownerOk.message.seq,
    targetRole: "buyer",
    today: kstToday(),
    pool,
    call: applyCall,
  });
  assert.equal(applyRes.action, "applied");
  assert.equal(applyRes.order.kind, "rental");
  assert.equal(applyRes.order.status, "pending");
  assert.equal(applyRes.order.totalPrice, 115000, "정가 12만원이 아니라 합의 금액으로 저장");

  const rentalCheck = await pool.query(`SELECT * FROM rental_requests WHERE listing_id = $1`, [rentListing.id]);
  assert.equal(rentalCheck.rows.length, 1);
  assert.equal(rentalCheck.rows[0].requester_id, buyer8.user.id);
  assert.equal(Number(rentalCheck.rows[0].total_price), 115000);
  assert.equal(Number(rentalCheck.rows[0].list_daily_price), 120000);
  assert.equal(String(rentalCheck.rows[0].offer_id), counterRes.offer.id);
  assert.equal(rentalCheck.rows[0].created_via, "buyer_ai");

  // 같은 합의에 대한 '감사합니다' 후속 이벤트는 신청을 추가로 만들지 않는다.
  const thanks = await sendMessage(owner8.user, { id: randomUUID(), conversationId: convId, body: "감사합니다!" }, { pool });
  const dupRes = await runDelegatedChatReply({ conversationId: convId, triggerSeq: thanks.message.seq, targetRole: "buyer", today: kstToday(), pool, call: applyCall });
  assert.equal(dupRes.action, "applied");
  assert.equal(dupRes.idempotent, true);
  const rentalAfterDup = await pool.query(`SELECT COUNT(*)::int AS cnt FROM rental_requests WHERE listing_id = $1`, [rentListing.id]);
  assert.equal(rentalAfterDup.rows[0].cnt, 1);

  // 판매 매물: 목표가 이내 제안은 구매자 AI가 수락 → 합의 즉시 합의 금액으로 구매 신청
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
  const salePolicy = await updateConversationAiPolicy(
    buyer8.user,
    {
      listingId: saleListing.id,
      mode: "autonomous",
      policy: { fullDelegation: true, intent: "sale", targetPrice: 3400000, maxBudget: 3600000, allowNegotiation: true },
    },
    { pool }
  );
  const saleConvId = salePolicy.conversation.id;
  const saleMsg = await sendMessage(owner8.user, { id: randomUUID(), conversationId: saleConvId, body: "340만원에 직거래 가능합니다." }, { pool });
  await submitOffer(
    { conversationId: saleConvId, actorUserId: owner8.user.id, terms: { amount: 3400000, amountUnit: "total", transportPayer: "none" } },
    { pool }
  );
  const saleTxRes = await runDelegatedChatReply({
    conversationId: saleConvId,
    triggerSeq: saleMsg.message.seq,
    targetRole: "buyer",
    pool,
    call: async ({ system }) => {
      assert.equal(system.includes("3,600,000"), false);
      return { content: [{ type: "tool_use", id: "s1", name: "accept_offer", input: { message: "340만원 직거래 조건으로 진행할게요." } }] };
    },
  });
  assert.equal(saleTxRes.action, "offer_accepted");
  assert.equal(saleTxRes.agreed, true);
  assert.equal(saleTxRes.order.kind, "purchase");
  assert.equal(saleTxRes.order.totalPrice, 3400000);
  assert.equal(saleTxRes.order.status, "pending");
  const poRows = await pool.query(`SELECT * FROM purchase_orders WHERE listing_id = $1`, [saleListing.id]);
  assert.equal(poRows.rows.length, 1);
  assert.equal(poRows.rows[0].buyer_id, buyer8.user.id);
  assert.equal(Number(poRows.rows[0].price), 3400000);
});

test("9. 정보 부족·한도 초과 시 무응답 대기, 상대에게 한도·에스컬레이션 비공개", async () => {
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
  assert.equal(stateAfterUnknown.conversation.aiDraftJson?.suggestedReplyDraft, "작년 가을에 점검 후 오일 교환 완료했습니다.");
  const buyerViewA = await getConversationMessages(buyer9.user.id, { conversationId: convId, pool });
  assert.equal(buyerViewA.conversation.waitingForUser, false);
  assert.equal(buyerViewA.messages.some((m) => m.body.includes("수리 이력이 없어")), false);

  // Case B: 한도(9만원) 밖 13만원 제안 → 구매자 AI는 수락하지 못하고 사용자 확인으로 멈춘다(신청·발신 없음)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await updateConversationAiPolicy(
    buyer9.user,
    {
      conversationId: convId,
      mode: "autonomous",
      policy: { fullDelegation: true, intent: "rent", targetStart: tomorrow, targetEnd: tomorrow, targetPrice: 80000, maxBudget: 90000, allowNegotiation: true },
    },
    { pool }
  );
  await submitOffer(
    {
      conversationId: convId,
      actorUserId: owner9.user.id,
      terms: { amount: 100000, amountUnit: "daily", start: tomorrow, end: tomorrow, transportPayer: "buyer", transportFee: 30000 },
    },
    { pool }
  );
  const q2 = await sendMessage(owner9.user, { id: randomUUID(), conversationId: convId, body: "운반비 3만원 포함 13만원에 대여 가능합니다." }, { pool });
  let budgetRound = 0;
  let acceptOutput = null;
  const escBudget = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: q2.message.seq,
    targetRole: "buyer",
    today: kstToday(),
    pool,
    call: async ({ messages }) => {
      budgetRound += 1;
      if (budgetRound === 1) {
        return { content: [{ type: "tool_use", id: "b1", name: "accept_offer", input: { message: "13만원으로 하겠습니다." } }] };
      }
      acceptOutput = JSON.parse(messages[messages.length - 1].content.find((b) => b.tool_use_id === "b1").content);
      return {
        content: [
          {
            type: "tool_use",
            id: "b2",
            name: "escalate_to_user",
            input: { reasonCode: "price_outside_policy", summaryForUser: "상대 제안이 맡기신 범위를 넘어 확인이 필요해요." },
          },
        ],
      };
    },
  });
  assert.equal(acceptOutput.ok, false);
  assert.equal(acceptOutput.code, "OFFER_OUTSIDE_POLICY");
  assert.equal(escBudget.action, "escalated");
  assert.equal(escBudget.aiPausedReason, "escalated:price_outside_policy");

  const rentalCount = await pool.query(`SELECT COUNT(*)::int AS cnt FROM rental_requests WHERE listing_id = $1`, [list9.id]);
  assert.equal(rentalCount.rows[0].cnt, 0);
  const stateAfterBudget = await getConversationMessages(buyer9.user.id, { conversationId: convId, pool });
  assert.equal(stateAfterBudget.messages.filter((m) => m.senderKind === "ai_proxy").length, 0);

  // 판매자 화면/응답에는 구매자 한도·에스컬레이션·초안이 없다.
  const ownerView = await getConversationMessages(owner9.user.id, { conversationId: convId, pool });
  const ownerJson = JSON.stringify(ownerView);
  assert.equal(ownerJson.includes("90000"), false);
  assert.equal(ownerJson.includes("80000"), false);
  assert.equal(ownerJson.includes("맡기신 범위"), false);
  assert.deepEqual(ownerView.conversation.buyerAiPolicy, {});

  // 판매자가 메시지를 다시 보내도 구매자의 확인 대기는 유지된다.
  const q3 = await sendMessage(owner9.user, { id: randomUUID(), conversationId: convId, body: "답 주세요~" }, { pool });
  const stillWaiting = await runDelegatedChatReply({ conversationId: convId, triggerSeq: q3.message.seq, targetRole: "buyer", pool, call: async () => { throw new Error("must not call LLM"); } });
  assert.equal(stillWaiting.reason, "AI_PAUSED");
});

test("10. 대리 채팅 대여 제안에서 365일 초과 기간 거부 및 365일 상한 허용 검증", async () => {
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
  await updateConversationAiPolicy(
    buyer10.user,
    { conversationId: convId, mode: "autonomous", policy: { fullDelegation: true, intent: "rent", targetStart: start, targetEnd: tooLongEnd }, resume: true },
    { pool }
  );
  const ownerReply = await sendMessage(
    owner10.user,
    { id: randomUUID(), conversationId: convId, body: "원하시는 날짜 알려주시면 확인해드릴게요." },
    { pool }
  );

  let roundA = 0;
  let checkTooLongOut = null;
  let checkMaxOut = null;
  let offerTooLongOut = null;
  const res = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: ownerReply.message.seq,
    targetRole: "buyer",
    today,
    pool,
    call: async ({ messages }) => {
      roundA += 1;
      const toolOut = (id) => JSON.parse(messages[messages.length - 1].content.find((b) => b.tool_use_id === id).content);
      if (roundA === 1) {
        return {
          content: [
            { type: "tool_use", id: "chk_over", name: "check_availability", input: { start, end: tooLongEnd } },
            { type: "tool_use", id: "chk_max", name: "check_availability", input: { start, end: maxAllowedEnd } },
          ],
        };
      }
      if (roundA === 2) {
        checkTooLongOut = toolOut("chk_over");
        checkMaxOut = toolOut("chk_max");
        return {
          content: [{
            type: "tool_use", id: "of_over", name: "submit_offer",
            input: { amount: 100000, amountUnit: "daily", start, end: tooLongEnd, transportPayer: "none", message: "366일 대여 원합니다." },
          }],
        };
      }
      offerTooLongOut = toolOut("of_over");
      return {
        content: [{
          type: "tool_use", id: "of_max", name: "submit_offer",
          input: { amount: 100000, amountUnit: "daily", start, end: maxAllowedEnd, transportPayer: "none", message: `${MAX_RENTAL_DAYS}일 대여로 제안드립니다.` },
        }],
      };
    },
  });

  assert.ok(checkTooLongOut?.error?.includes(String(MAX_RENTAL_DAYS)));
  assert.equal(checkMaxOut?.available, true);
  assert.equal(checkMaxOut?.days, MAX_RENTAL_DAYS);
  assert.equal(offerTooLongOut.ok, false);
  assert.ok(offerTooLongOut.error.includes(String(MAX_RENTAL_DAYS)));
  assert.equal(res.action, "offer_submitted");
  assert.equal(res.offer.days, MAX_RENTAL_DAYS);
  assert.equal(res.offer.itemTotal, 100000 * MAX_RENTAL_DAYS);

  const countAfter = await pool.query(`SELECT COUNT(*)::int AS cnt FROM rental_requests WHERE listing_id = $1`, [list10.id]);
  assert.equal(countAfter.rows[0].cnt, 0);
});

test("11. 시연 농가 매물도 명시적 수신 위임(listing_ai_policies)이 있을 때만 판매자 AI가 자동 답장", async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('demo-owner', '시연 농가', 'demo-owner@users.moa-farm.example.com', false, now(), now())
     ON CONFLICT (id) DO NOTHING`
  );
  const insertDemoListing = async (title) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO listings (
        id, owner_id, type, model_id, title, brand, machine_type,
        crop_ids, operations, area_min, area_max, price, region,
        condition, inspected_at, included, pickup, description, status, is_demo
      ) VALUES (
        $1, 'demo-owner', 'rent', 'asia-amc900', $2, '아세아', 'cultivator',
        ARRAY['pepper'], ARRAY['till'], 100, 2000, 80000, '영양읍',
        'good', '2026-10-12', '로터리', '직접 인수', '주말 오전 인수 가능', 'open', true
      )`,
      [id, title]
    );
    return id;
  };

  // (a) 위임 없음: 구매자가 자동 응대를 켜도 판매자 AI는 꺼진 상태
  const noPolicyListing = await insertDemoListing("시연용 관리기(위임 없음)");
  const buyer11 = await signupHttp(baseUrl, "dc_buyer11", "시연구매");
  const noPolicyHttp = await apiReq(baseUrl, "/api/conversations", {
    method: "POST",
    cookie: buyer11.cookie,
    json: { listingId: noPolicyListing, action: "update_ai_policy", mode: "autonomous", policy: { instructions: "토요일 오전" } },
  });
  assert.equal(noPolicyHttp.status, 200);
  assert.equal(noPolicyHttp.body.conversation.ownerAiMode, "off");
  const noPolicyRun = await runDelegatedChatReply({
    conversationId: noPolicyHttp.body.conversation.id,
    triggerSeq: 1,
    targetRole: "owner",
    pool,
    call: async () => { throw new Error("must not call LLM"); },
  });
  assert.equal(noPolicyRun.reason, "AI_MODE_OFF");

  // (b) 판매자가 매물 단위 수신 위임을 명시적으로 저장한 경우
  const demoListingId = await insertDemoListing("시연용 아세아 관리기");
  await pool.query(
    `INSERT INTO listing_ai_policies (listing_id, owner_id, mode, policy) VALUES ($1, 'demo-owner', 'autonomous', $2::jsonb)`,
    [demoListingId, JSON.stringify({ allowNegotiation: false, fullDelegation: false })]
  );
  const policyHttp = await apiReq(baseUrl, "/api/conversations", {
    method: "POST",
    cookie: buyer11.cookie,
    json: { listingId: demoListingId, action: "update_ai_policy", mode: "autonomous", policy: { instructions: "토요일 오전 대여 희망" } },
  });
  assert.equal(policyHttp.status, 200);
  const convId = policyHttp.body.conversation.id;
  assert.equal(policyHttp.body.conversation.buyerAiMode, "autonomous");
  assert.equal(policyHttp.body.conversation.ownerAiMode, "autonomous");

  const sendHttp = await apiReq(baseUrl, "/api/conversations", {
    method: "POST",
    cookie: buyer11.cookie,
    json: { action: "send", id: randomUUID(), conversationId: convId, body: "이번 주 토요일 오전에 대여 가능할까요?" },
  });
  assert.equal(sendHttp.status, 201);
  assert.equal(sendHttp.body.aiReplyScheduled, true);

  const replyRes = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: sendHttp.body.message.seq,
    targetRole: "owner",
    pool,
    call: async ({ system }) => {
      assert.ok(system.includes("빌려주는 분"));
      return {
        content: [
          {
            type: "tool_use",
            id: "demo_reply",
            name: "send_proxy_reply",
            input: { body: "네, 토요일 오전 직접 인수로 대여 가능합니다.", confidence: "high", rationale: "시연 매물 조건 일치" },
          },
        ],
      };
    },
  });
  assert.ok(replyRes.action === "replied" || replyRes.reason === "ALREADY_REPLIED");
  if (replyRes.action === "replied") assert.equal(replyRes.replyToSeq, sendHttp.body.message.seq);
});
