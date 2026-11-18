// 역할·대화 API(worker1) 검증: 서버 역할 권한, 상대 비공개 정보 차단, 역할별 일시정지·초안·정책 버전,
// 명시적 읽음, 직접 이어받기/다시 맡기기, 판매자 매물 단위 문의 위임, 0008 레거시 이행.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import accountHandler from "../api/account.js";
import agentChatReplyHandler from "../api/agent-chat-reply.js";
import conversationsHandler from "../api/conversations.js";
import { resetAuthCache } from "../server/account-auth.js";
import { sanitizeAiPolicy } from "../server/chat.js";
import { createPglitePool, setPool } from "../server/db.js";
import { createListing } from "../server/listings-service.js";
import { DEFAULT_MIGRATIONS_DIR, initEnvironment, runMigrations } from "../server/migrator.js";

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

async function apiReq(baseUrl, path, { method = "GET", cookie = "", json = undefined } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") {
    headers.origin = baseUrl;
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const setCookie = response.headers.getSetCookie?.() || [];
  const nextCookie = setCookie.length ? setCookie.map((c) => c.split(";")[0]).join("; ") : cookie;
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, raw: text, cookie: nextCookie };
}

async function signupHttp(baseUrl, username, name) {
  const res = await apiReq(baseUrl, "/api/account?action=signup", {
    method: "POST",
    json: { username, name, password: "Password123!" },
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
let buyer2;
let outsider;
let listing;
let saleListing;

const post = (who, json) => apiReq(baseUrl, "/api/conversations", { method: "POST", cookie: who.cookie, json });
const get = (who, qs) => apiReq(baseUrl, `/api/conversations?${qs}`, { cookie: who.cookie });

async function send(who, { conversationId, listingId, body }) {
  const res = await post(who, { action: "send", id: randomUUID(), conversationId, listingId, body });
  assert.ok(res.status === 201 || res.status === 200, `send failed: ${res.raw}`);
  return res.body;
}

async function convRow(id) {
  return (await pool.query(`SELECT * FROM conversations WHERE id = $1`, [id])).rows[0];
}

/** 런타임(delegated-chat)이 판매자 역할 에스컬레이션을 기록하는 모양을 그대로 흉내 낸다. */
async function simulateOwnerEscalation(conversationId, ownerId, summary) {
  await pool.query(
    `UPDATE conversations
     SET owner_ai_pause = 'escalated:price_below_minimum',
         owner_ai_draft_json = $2::jsonb,
         last_seq = last_seq + 1
     WHERE id = $1`,
    [conversationId, JSON.stringify({ targetUserId: ownerId, targetRole: "owner", waitingForUser: true, summaryForUser: summary, body: "비공개 초안 답장" })]
  );
  const seq = (await convRow(conversationId)).last_seq;
  await pool.query(
    `INSERT INTO messages (id, conversation_id, sender_id, seq, body, sender_kind, escalation_reason)
     VALUES ($1, $2, $3, $4, $5, 'system', 'price_below_minimum')`,
    [randomUUID(), conversationId, ownerId, seq, summary]
  );
  return Number(seq);
}

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
  const mig = await runMigrations({ env: "test", pool });
  assert.ok(mig.applied.includes("0008_role_scoped_ai_state.sql"));

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
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  owner = await signupHttp(baseUrl, "tc_owner", "김판매");
  buyer = await signupHttp(baseUrl, "tc_buyer", "박구매");
  buyer2 = await signupHttp(baseUrl, "tc_buyer2", "이구매");
  outsider = await signupHttp(baseUrl, "tc_outsider", "최외부");

  const base = {
    modelId: "asia-amc900",
    cropIds: ["pepper"],
    operations: ["till"],
    region: "영양읍",
    condition: "good",
    included: "로터리",
    pickup: "직접 인수",
    description: "직접 인수 가능합니다.",
  };
  listing = (await createListing(owner.user, { ...base, id: randomUUID(), title: "관리기 임대", type: "rent", price: 100000 }, { pool })).listing;
  saleListing = (await createListing(owner.user, { ...base, id: randomUUID(), title: "관리기 판매", type: "sale", price: 1000000 }, { pool })).listing;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await pool?.end();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("1. 상대방의 비공개 한도·초안·에스컬레이션은 API 응답에 포함되지 않는다", async () => {
  const first = await send(buyer, { listingId: listing.id, body: "11/22~24 대여 가능할까요?" });
  const convId = first.conversation.id;
  assert.equal(first.conversation.myRole, "buyer");

  const bp = await post(buyer, { action: "update_ai_policy", conversationId: convId, mode: "autonomous", policy: { maxBudget: 271828, targetPrice: 240000, budgetUnit: "total" } });
  assert.equal(bp.status, 200, bp.raw);
  const op = await post(owner, { action: "update_ai_policy", conversationId: convId, mode: "autonomous", policy: { minPrice: 314159 } });
  assert.equal(op.status, 200, op.raw);
  assert.equal(op.body.role, "owner");

  const secret = "최소 수락가 314,159원보다 낮아 멈췄어요";
  await simulateOwnerEscalation(convId, owner.user.id, secret);

  const buyerView = await get(buyer, `conversationId=${convId}`);
  assert.equal(buyerView.status, 200, buyerView.raw);
  assert.ok(!buyerView.raw.includes("314159"), "판매자 최저가 원값 노출");
  assert.ok(!buyerView.raw.includes("314,159"), "판매자 에스컬레이션 요약 노출");
  assert.ok(!buyerView.raw.includes("비공개 초안 답장"), "판매자 초안 노출");
  const bc = buyerView.body.conversation;
  assert.deepEqual(bc.ownerAiPolicy, {});
  assert.equal(bc.buyerAiPolicy.maxBudget, 271828);
  assert.equal(bc.aiPausedReason, null);
  assert.equal(bc.waitingForUser, false);
  assert.equal(bc.escalationSummary, null);
  assert.equal(bc.aiDraftJson, null);
  assert.equal(bc.myAiState.mode, "autonomous");
  assert.equal(bc.counterpartAiActive, false, "상대가 확인 대기 중이면 상대 AI는 비활성으로 표시");
  assert.ok(buyerView.body.messages.every((m) => m.visibility === "both"));
  assert.ok(buyerView.body.messages.every((m) => m.senderRole === "buyer" || m.senderRole === "owner" || m.senderRole === "system"));

  const buyerList = await get(buyer, "mode=list");
  assert.ok(!buyerList.raw.includes("314159") && !buyerList.raw.includes("314,159"));
  const listed = buyerList.body.conversations.find((c) => c.id === convId);
  assert.equal(listed.lastMessage.body, "11/22~24 대여 가능할까요?", "상대의 비공개 시스템 메시지가 목록 마지막 메시지로 노출되면 안 됨");

  const ownerView = await get(owner, `conversationId=${convId}`);
  assert.ok(!ownerView.raw.includes("271828"), "구매자 상한 원값 노출");
  const oc = ownerView.body.conversation;
  assert.equal(oc.myRole, "owner");
  assert.deepEqual(oc.buyerAiPolicy, {});
  assert.equal(oc.ownerAiPolicy.minPrice, 314159);
  assert.equal(oc.waitingForUser, true);
  assert.equal(oc.escalationSummary, secret);
  assert.equal(oc.myAiState.pause, "escalated:price_below_minimum");
  assert.ok(ownerView.body.messages.some((m) => m.visibility === "self" && m.body === secret));

  const forbidden = await get(outsider, `conversationId=${convId}`);
  assert.equal(forbidden.status, 403);
});

test("2. 상대 메시지는 내 확인 대기를 풀지 않고, 내가 직접 보내면 내 역할만 직접 이어받기 상태가 된다", async () => {
  const first = await send(buyer2, { listingId: listing.id, body: "문의드립니다" });
  const convId = first.conversation.id;
  await post(owner, { action: "update_ai_policy", conversationId: convId, mode: "autonomous", policy: {} });
  await post(buyer2, { action: "update_ai_policy", conversationId: convId, mode: "autonomous", policy: {} });
  await simulateOwnerEscalation(convId, owner.user.id, "수리 이력을 확인해 주세요");

  await send(buyer2, { conversationId: convId, body: "답변 기다릴게요" });
  let row = await convRow(convId);
  assert.equal(row.owner_ai_pause, "escalated:price_below_minimum", "상대 메시지로 판매자 대기가 풀리면 안 됨");
  assert.equal(row.buyer_ai_pause, "takeover", "자동 응대 중 직접 보낸 구매자는 직접 이어받기");

  const versionBefore = row.owner_ai_policy_version;
  await send(owner, { conversationId: convId, body: "작년 봄에 엔진 수리했습니다" });
  row = await convRow(convId);
  assert.equal(row.owner_ai_pause, "takeover");
  assert.equal(row.owner_ai_draft_json, null, "내 초안은 직접 발신 시 비움");
  assert.equal(row.buyer_ai_pause, "takeover", "판매자 발신이 구매자 상태를 바꾸면 안 됨");

  // 정책 저장만으로는 직접 이어받기가 풀리지 않는다(정책 버전은 증가).
  const upd = await post(owner, { action: "update_ai_policy", conversationId: convId, mode: "autonomous", policy: { minPrice: 90000 } });
  assert.equal(upd.status, 200, upd.raw);
  row = await convRow(convId);
  assert.equal(row.owner_ai_pause, "takeover");
  assert.ok(row.owner_ai_policy_version > versionBefore);

  // 다시 맡기기는 내 역할 일시정지만 해제한다.
  const resumed = await post(owner, { action: "resume", conversationId: convId });
  assert.equal(resumed.status, 200, resumed.raw);
  row = await convRow(convId);
  assert.equal(row.owner_ai_pause, null);
  assert.equal(row.buyer_ai_pause, "takeover");
  assert.equal(resumed.body.conversation.myAiState.pause, null);
  assert.equal(resumed.body.aiReplyScheduled, false, "마지막 메시지가 내 것이면 응답 예약 없음");

  const takeover = await post(owner, { action: "takeover", conversationId: convId });
  assert.equal(takeover.status, 200);
  assert.equal(takeover.body.conversation.myAiState.pause, "takeover");
  assert.equal(takeover.body.conversation.aiPausedReason, "takeover");
  assert.ok((await convRow(convId)).owner_ai_policy_version > row.owner_ai_policy_version, "이어받기는 정책 버전을 올려 생성 중 응답을 무효화");

  await post(owner, { action: "update_ai_policy", conversationId: convId, mode: "off" });
  const resumeOff = await post(owner, { action: "resume", conversationId: convId });
  assert.equal(resumeOff.status, 400);
  assert.equal(resumeOff.body.code, "AI_MODE_OFF");

  const outsiderTakeover = await post(outsider, { action: "takeover", conversationId: convId });
  assert.equal(outsiderTakeover.status, 403);
});

test("3. 읽음은 GET·폴링·내 AI 발신으로 바뀌지 않고 mark_read로만 갱신된다", async () => {
  const first = await send(buyer, { listingId: saleListing.id, body: "판매 문의합니다" });
  const convId = first.conversation.id;
  await send(owner, { conversationId: convId, body: "네 가능합니다" });
  await send(owner, { conversationId: convId, body: "언제 오실까요?" });

  let view = await get(buyer, `conversationId=${convId}`);
  assert.equal(view.body.conversation.unreadCount, 2);
  view = await get(buyer, `conversationId=${convId}&after_seq=0`);
  view = await get(buyer, "mode=list");
  assert.equal(view.body.conversations.find((c) => c.id === convId).unreadCount, 2, "GET이 읽음 처리하면 안 됨");

  // 판매자 본인 기준으로는 자기 메시지가 안 읽음이 아니다.
  const ownerList = await get(owner, "mode=list");
  assert.equal(ownerList.body.conversations.find((c) => c.id === convId).unreadCount, 1);

  const marked = await post(buyer, { action: "mark_read", conversationId: convId, readSeq: 2 });
  assert.equal(marked.status, 200, marked.raw);
  assert.equal(marked.body.conversation.unreadCount, 1);
  assert.equal(marked.body.conversation.myLastReadSeq, 2);

  const back = await post(buyer, { action: "mark_read", conversationId: convId, readSeq: 1 });
  assert.equal(back.body.conversation.myLastReadSeq, 2, "읽음은 뒤로 가지 않음");
  const beyond = await post(buyer, { action: "mark_read", conversationId: convId, readSeq: 999 });
  assert.equal(beyond.body.conversation.myLastReadSeq, 3, "last_seq를 넘지 않음");
  assert.equal(beyond.body.conversation.unreadCount, 0);
  assert.equal(Number((await convRow(convId)).owner_last_read_seq), 0, "구매자 읽음이 판매자 칸을 바꾸면 안 됨");

  const bad = await post(buyer, { action: "mark_read", conversationId: convId, readSeq: -1 });
  assert.equal(bad.status, 400);
  const other = await post(outsider, { action: "mark_read", conversationId: convId, readSeq: 1 });
  assert.equal(other.status, 403);
});

test("4. /api/agent-chat-reply는 클라이언트 targetRole로 상대 AI를 실행하지 못한다", async () => {
  const conv = (await get(buyer, `listingId=${listing.id}`)).body.conversation;
  await post(owner, { action: "update_ai_policy", conversationId: conv.id, mode: "autonomous", policy: {} });

  const cross = await apiReq(baseUrl, "/api/agent-chat-reply", {
    method: "POST",
    cookie: buyer.cookie,
    json: { conversationId: conv.id, targetRole: "owner" },
  });
  assert.equal(cross.status, 403);
  assert.equal(cross.body.code, "TARGET_ROLE_FORBIDDEN");

  const self = await apiReq(baseUrl, "/api/agent-chat-reply", {
    method: "POST",
    cookie: buyer.cookie,
    json: { conversationId: conv.id, targetRole: "buyer", forceDraft: true },
  });
  assert.equal(self.status, 200, self.raw);
  assert.equal(self.body.result.skipped, true, "LLM 키가 없으면 안전 종료");

  const outsiderCall = await apiReq(baseUrl, "/api/agent-chat-reply", {
    method: "POST",
    cookie: outsider.cookie,
    json: { conversationId: conv.id },
  });
  assert.equal(outsiderCall.status, 403);
});

test("5. 판매자 매물 단위 문의 위임은 명시 저장 시에만, 새 대화에만 복사된다", async () => {
  const rent2 = (await createListing(owner.user, {
    id: randomUUID(), title: "트랙터 임대", type: "rent", price: 200000, modelId: "asia-amc900",
    cropIds: ["pepper"], operations: ["till"], region: "영양읍", condition: "good", included: "", pickup: "직접", description: "설명",
  }, { pool })).listing;

  // 위임 저장 전 대화: 판매자 자동 응대 없음
  const before = await send(buyer, { listingId: rent2.id, body: "가능할까요" });
  assert.equal(before.conversation.ownerAiMode, "off");
  assert.equal(before.aiReplyScheduled, false);

  const notOwner = await post(buyer, { action: "set_inbound_policy", listingId: rent2.id, mode: "autonomous", policy: {} });
  assert.equal(notOwner.status, 403);
  const peek = await get(buyer, `mode=inbound_policy&listingId=${rent2.id}`);
  assert.equal(peek.status, 403);

  const set = await post(owner, {
    action: "set_inbound_policy",
    listingId: rent2.id,
    mode: "autonomous",
    policy: { minPrice: 161803, targetPrice: 190000, requiredQuestions: ["사용 면적"], transportFee: "" },
  });
  assert.equal(set.status, 200, set.raw);
  assert.equal(set.body.inboundPolicy.mode, "autonomous");
  assert.equal(set.body.inboundPolicy.policy.transportFee, null, "빈 운송비는 0이 아니라 미정");
  assert.equal(set.body.inboundPolicy.policyVersion, 1);
  const again = await post(owner, { action: "set_inbound_policy", listingId: rent2.id, mode: "autonomous", policy: { minPrice: 161803 } });
  assert.equal(again.body.inboundPolicy.policyVersion, 2);
  const read = await get(owner, `mode=inbound_policy&listingId=${rent2.id}`);
  assert.equal(read.body.inboundPolicy.policy.minPrice, 161803);

  // 기존 대화는 그대로
  assert.equal((await convRow(before.conversation.id)).owner_ai_mode, "off");

  // 새 대화는 판매자 정책을 복사하고, 구매자 응답에는 판매자 정책이 없다.
  const fresh = await send(buyer2, { listingId: rent2.id, body: "새 문의" });
  const row = await convRow(fresh.conversation.id);
  assert.equal(row.owner_ai_mode, "autonomous");
  assert.equal(row.owner_ai_policy.minPrice, 161803);
  assert.equal(row.owner_ai_policy_version, 2);
  assert.equal(fresh.aiReplyScheduled, true, "새 문의에 판매자 대리 응답 예약");
  assert.equal(fresh.conversation.counterpartAiActive, true);
  assert.ok(!JSON.stringify(fresh).includes("161803"), "구매자 응답에 판매자 최저가 노출");
});

test("6. 시연 농가(demo-owner) 매물도 명시 위임 없이 자동 응답을 예약하지 않는다", async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('demo-owner', '시연 농가', 'demo-owner@users.moa-farm.example.com', false, now(), now())
     ON CONFLICT (id) DO NOTHING`
  );
  const demoListingId = `demo-${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO listings (id, owner_id, type, title, brand, machine_type, crop_ids, operations, area_min, area_max, price, region, condition, inspected_at, included, pickup, description, summary, status)
     SELECT $1, 'demo-owner', 'rent', '시연 관리기', brand, machine_type, crop_ids, operations, area_min, area_max, 50000, region, condition, inspected_at, included, pickup, description, summary, 'open'
     FROM listings WHERE id = $2`,
    [demoListingId, listing.id]
  );
  const policy = await post(buyer, { action: "update_ai_policy", listingId: demoListingId, mode: "autonomous", policy: { fullDelegation: true } });
  assert.equal(policy.status, 200, policy.raw);
  assert.equal(policy.body.aiReplyScheduled, false);
  const sent = await send(buyer, { conversationId: policy.body.conversation.id, body: "시연 문의" });
  assert.equal(sent.aiReplyScheduled, false, "암묵적 시연 농가 자동 응답 금지");
  assert.equal((await convRow(policy.body.conversation.id)).owner_ai_mode, "off");
});

test("7. 판매자는 구매자 명의 신청(apply_offer)을 할 수 없고 제안 액션은 서버가 역할을 결정한다", async () => {
  const conv = (await get(buyer, `listingId=${saleListing.id}`)).body.conversation;
  const apply = await post(owner, { action: "apply_offer", conversationId: conv.id, offerId: randomUUID() });
  assert.equal(apply.status, 403, apply.raw);
  assert.equal(apply.body.code, "SELLER_CANNOT_APPLY");
  const ordersAfter = await pool.query(`SELECT COUNT(*)::int AS n FROM purchase_orders WHERE listing_id = $1`, [saleListing.id]);
  assert.equal(ordersAfter.rows[0].n, 0);

  const outsiderOffer = await post(outsider, { action: "submit_offer", conversationId: conv.id, offer: { amount: 900000, amountUnit: "total", transportPayer: "none" } });
  assert.equal(outsiderOffer.status, 403);

  const offer = await post(buyer, {
    action: "submit_offer",
    conversationId: conv.id,
    offer: { amount: 900000, amountUnit: "total", transportPayer: "none", transportFee: 0 },
    terms: { amount: 900000, amountUnit: "total", amountBasis: "total", transportPayer: "none", transportFee: 0 },
    baseTermsVersion: 0,
  });
  assert.equal(offer.status, 200, offer.raw);
  assert.equal(offer.body.role, "buyer");
  assert.equal(offer.body.offer.fromRole, "buyer");
  assert.equal(offer.body.conversation.stage, "negotiating");
  assert.ok(offer.body.conversation.negotiation?.currentOffer, "대화 DTO에 현재 제안 요약 포함");
});

test("8. 정책 정규화: 미입력 한도는 null, 운송비 미정은 0이 아님, 알 수 없는 값 무시", () => {
  const p = sanitizeAiPolicy({ maxBudget: "", targetPrice: "240000", budgetUnit: "weekly", transportFee: null, transportPayer: "alien", requiredQuestions: ["누유 여부", "", 3] });
  assert.equal(p.maxBudget, null);
  assert.equal(p.minPrice, null);
  assert.equal(p.targetPrice, 240000);
  assert.equal(p.budgetUnit, null);
  assert.equal(p.transportFee, null);
  assert.equal(p.transportPayer, null);
  assert.deepEqual(p.requiredQuestions, ["누유 여부"]);
  assert.equal(sanitizeAiPolicy({ transportFee: 0, transportPayer: "none" }).transportFee, 0);
});

test("9. 0008 이행: 레거시 공유 초안·일시정지가 대상 역할 칸으로만 옮겨지고 기존 메시지는 읽음 처리된다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "moa-0008-"));
  const legacyPool = createPglitePool("memory://");
  try {
    for (const f of readdirSync(DEFAULT_MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < "0008")) {
      copyFileSync(join(DEFAULT_MIGRATIONS_DIR, f), join(dir, f));
    }
    await initEnvironment({ env: "test", pool: legacyPool });
    await runMigrations({ env: "test", pool: legacyPool, migrationsDir: dir });
    for (const [id, name] of [["lo", "판매"], ["lb", "구매"], ["lb2", "구매2"]]) {
      await legacyPool.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, false, now(), now())`,
        [id, name, `${id}@x.example.com`]
      );
    }
    await legacyPool.query(
      `INSERT INTO listings (id, owner_id, type, title, brand, machine_type, crop_ids, operations, area_min, area_max, price, region, condition, inspected_at, included, pickup, description, summary)
       VALUES ('L1', 'lo', 'rent', 't', 'b', 'cultivator', '{pepper}', '{till}', 1, 100, 1000, 'r', 'good', '2026-01-01', '', '', '', '')`
    );
    const c1 = randomUUID();
    const c2 = randomUUID();
    await legacyPool.query(
      `INSERT INTO conversations (id, listing_id, buyer_id, last_seq, ai_paused_reason, ai_draft_json)
       VALUES ($1, 'L1', 'lb', 7, 'escalated:unknown_condition', $2::jsonb)`,
      [c1, JSON.stringify({ targetUserId: "lo", targetRole: "owner", summaryForUser: "판매자 확인 필요" })]
    );
    await legacyPool.query(
      `INSERT INTO conversations (id, listing_id, buyer_id, last_seq, ai_paused_reason)
       VALUES ($1, 'L1', 'lb2', 3, 'max_turns_reached')`,
      [c2]
    );

    copyFileSync(join(DEFAULT_MIGRATIONS_DIR, "0008_role_scoped_ai_state.sql"), join(dir, "0008_role_scoped_ai_state.sql"));
    const res = await runMigrations({ env: "test", pool: legacyPool, migrationsDir: dir });
    assert.ok(res.applied.includes("0008_role_scoped_ai_state.sql"));

    const r1 = (await legacyPool.query(`SELECT * FROM conversations WHERE id = $1`, [c1])).rows[0];
    assert.equal(r1.owner_ai_pause, "escalated:unknown_condition");
    assert.equal(r1.buyer_ai_pause, null, "판매자 에스컬레이션이 구매자에게 복사되면 안 됨");
    assert.equal(r1.owner_ai_draft_json.summaryForUser, "판매자 확인 필요");
    assert.equal(r1.buyer_ai_draft_json, null);
    assert.equal(Number(r1.buyer_last_read_seq), 7);
    assert.equal(Number(r1.owner_last_read_seq), 7);

    const r2 = (await legacyPool.query(`SELECT * FROM conversations WHERE id = $1`, [c2])).rows[0];
    assert.equal(r2.buyer_ai_pause, "max_turns_reached");
    assert.equal(r2.owner_ai_pause, "max_turns_reached", "대상이 불명확한 레거시 정지는 양쪽에 보수적으로 유지");

    const policies = await legacyPool.query(`SELECT COUNT(*)::int AS n FROM listing_ai_policies`);
    assert.equal(policies.rows[0].n, 0, "이행이 암묵적 판매자 위임을 만들면 안 됨");
  } finally {
    await legacyPool.end();
    setPool(pool);
    rmSync(dir, { recursive: true, force: true });
  }
});
