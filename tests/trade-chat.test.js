// 역할·대화 API 검증: 서버 역할 권한, 레거시 비공개 시스템 메시지 차단, 명시적 읽음,
// 제거된 AI 대리 응대 액션 거부, 구조화 제안 역할 결정, 0008 레거시 이행.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import accountHandler from "../api/account.js";
import conversationsHandler from "../api/conversations.js";
import { resetAuthCache } from "../server/account-auth.js";
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

/** 제거된 AI 대리 응대 기능이 남긴 판매자 역할 에스컬레이션(기존 DB 행)을 흉내 낸다. */
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

test("1. 레거시 AI 상태·본인 전용 시스템 메시지는 상대방 API 응답에 포함되지 않는다", async () => {
  const first = await send(buyer, { listingId: listing.id, body: "11/22~24 대여 가능할까요?" });
  const convId = first.conversation.id;
  assert.equal(first.conversation.myRole, "buyer");

  const secret = "최소 수락가 314,159원보다 낮아 멈췄어요";
  await pool.query(
    `UPDATE conversations SET owner_ai_mode = 'autonomous', owner_ai_policy = $2::jsonb WHERE id = $1`,
    [convId, JSON.stringify({ minPrice: 314159 })]
  );
  await simulateOwnerEscalation(convId, owner.user.id, secret);

  const buyerView = await get(buyer, `conversationId=${convId}`);
  assert.equal(buyerView.status, 200, buyerView.raw);
  assert.ok(!buyerView.raw.includes("314159"), "판매자 최저가 원값 노출");
  assert.ok(!buyerView.raw.includes("314,159"), "판매자 에스컬레이션 요약 노출");
  assert.ok(!buyerView.raw.includes("비공개 초안 답장"), "판매자 초안 노출");
  const bc = buyerView.body.conversation;
  for (const key of ["buyerAiMode", "ownerAiMode", "buyerAiPolicy", "ownerAiPolicy", "aiPausedReason", "aiDraftJson", "waitingForUser", "escalationSummary", "myAiState", "counterpartAiActive", "aiConsecutiveTurns", "aiLastRunAt"]) {
    assert.equal(Object.hasOwn(bc, key), false, `AI 대리 응대 필드가 남아 있음: ${key}`);
  }
  assert.ok(buyerView.body.messages.every((m) => m.visibility === "both"));
  assert.ok(buyerView.body.messages.every((m) => !Object.hasOwn(m, "aiConfidence") && !Object.hasOwn(m, "escalationReason")));

  const buyerList = await get(buyer, "mode=list");
  assert.ok(!buyerList.raw.includes("314159") && !buyerList.raw.includes("314,159"));
  const listed = buyerList.body.conversations.find((c) => c.id === convId);
  assert.equal(listed.lastMessage.body, "11/22~24 대여 가능할까요?", "상대의 비공개 시스템 메시지가 목록 마지막 메시지로 노출되면 안 됨");
  assert.equal(listed.unreadCount, 0, "상대의 비공개 시스템 메시지는 안 읽음으로 세지 않는다");

  const ownerView = await get(owner, `conversationId=${convId}`);
  assert.equal(ownerView.body.conversation.myRole, "owner");
  assert.ok(!ownerView.raw.includes("314159"), "레거시 AI 정책은 더 이상 내려주지 않는다");
  assert.ok(ownerView.body.messages.some((m) => m.visibility === "self" && m.body === secret));

  const forbidden = await get(outsider, `conversationId=${convId}`);
  assert.equal(forbidden.status, 403);
});

test("2. 제거된 AI 대리 응대 액션은 거부되고, 사람 메시지는 AI 상태를 건드리지 않으며 새 대화에 문의 위임이 복사되지 않는다", async () => {
  const first = await send(buyer2, { listingId: listing.id, body: "문의드립니다" });
  const convId = first.conversation.id;
  assert.equal(Object.hasOwn(first, "aiReplyScheduled"), false);
  for (const action of ["update_ai_policy", "takeover", "resume", "dismiss_ai_draft", "retry_ai_job", "generate_ai_draft", "set_inbound_policy"]) {
    const res = await post(owner, { action, conversationId: convId, listingId: listing.id, mode: "autonomous", policy: {}, triggerSeq: 1 });
    assert.equal(res.status, 400, `${action}: ${res.raw}`);
    assert.equal(res.body.code, "UNKNOWN_ACTION", action);
  }
  const row = await convRow(convId);
  assert.equal(row.owner_ai_mode, "off");
  assert.equal(row.owner_ai_pause, null);

  const sent = await send(owner, { conversationId: convId, body: "네 가능합니다" });
  assert.equal(sent.message.senderKind, "human");
  assert.equal(sent.message.senderRole, "owner");

  // 운영 DB에 남아 있는 매물 단위 위임 행이 있어도 새 대화에 복사하지 않는다.
  const rent2 = (await createListing(owner.user, {
    id: randomUUID(), title: "트랙터 임대", type: "rent", price: 200000, modelId: "asia-amc900",
    cropIds: ["pepper"], operations: ["till"], region: "영양읍", condition: "good", included: "", pickup: "직접", description: "설명",
  }, { pool })).listing;
  await pool.query(
    `INSERT INTO listing_ai_policies (listing_id, owner_id, mode, policy, policy_version) VALUES ($1, $2, 'autonomous', $3::jsonb, 1)`,
    [rent2.id, owner.user.id, JSON.stringify({ minPrice: 161803 })]
  );
  const fresh = await send(buyer2, { listingId: rent2.id, body: "새 문의" });
  const freshRow = await convRow(fresh.conversation.id);
  assert.equal(freshRow.owner_ai_mode, "off");
  assert.ok(!JSON.stringify(fresh).includes("161803"));
});

test("3. 읽음은 GET·폴링으로 바뀌지 않고 mark_read로만 갱신된다", async () => {
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
