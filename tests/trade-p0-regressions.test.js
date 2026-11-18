// 04-state-tests 설계에서 실제로 재현했던 P0 결함 R1~R4를 통합 구현에 대해 다시 검증한다.
// LLM은 스텁(call 주입), DB는 PGlite. 실제 LLM·실제 PostgreSQL 검증은 아님.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import accountHandler from "../api/account.js";
import { resetAuthCache } from "../server/account-auth.js";
import { sendMessage, updateConversationAiPolicy } from "../server/chat.js";
import { createPglitePool, kstToday, setPool } from "../server/db.js";
import { runDelegatedChatReply } from "../server/delegated-chat.js";
import { enqueueDelegatedReply, processDelegationJobs } from "../server/delegation-queue.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";
import { acceptOffer, applyAgreedOffer, submitOffer } from "../server/trade-negotiation.js";

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

let pool;
let server;
let baseUrl;
const prevEnv = {};

function isoPlus(days) {
  const d = new Date(`${kstToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const START = isoPlus(3);
const END = isoPlus(5); // 3일

async function signup(username, name) {
  const res = await fetch(`${baseUrl}/api/account?action=signup`, {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "application/json" },
    body: JSON.stringify({ username, name, password: "Password123!" }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.user;
}

let n = 0;
async function setup() {
  n += 1;
  const owner = await signup(`p0_owner${n}`, "빌려주는분");
  const buyer = await signup(`p0_buyer${n}`, "빌리는분");
  const { listing } = await createListing(
    owner,
    {
      id: randomUUID(),
      title: "관리기 임대",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 100000, // 정가 일 10만원 → 3일 정가 30만원
      region: "영양읍",
      condition: "good",
      description: "직접 인수",
    },
    { pool }
  );
  const first = await sendMessage(buyer, { id: randomUUID(), listingId: listing.id, body: "대여 가능할까요?" }, { pool });
  return { owner, buyer, listing, conversationId: first.conversation.id, firstSeq: first.message.seq };
}

const BUYER_FULL = {
  fullDelegation: true,
  autoExecuteTransaction: true,
  allowNegotiation: true,
  targetPrice: 240000,
  maxBudget: 250000,
  budgetUnit: "total",
};

function scripted(...blocks) {
  let i = 0;
  return async () => {
    const block = blocks[Math.min(i, blocks.length - 1)];
    i += 1;
    const b = typeof block === "function" ? await block() : block;
    return { content: [{ type: "tool_use", id: `t_${randomUUID()}`, ...b }] };
  };
}
const tool = (name, input) => ({ name, input });

async function countAiProxy(conversationId) {
  const r = await pool.query(
    `SELECT count(*)::int AS c FROM messages WHERE conversation_id = $1 AND sender_kind = 'ai_proxy'`,
    [conversationId]
  );
  return r.rows[0].c;
}
async function rentalRows(listingId) {
  const r = await pool.query(`SELECT * FROM rental_requests WHERE listing_id = $1 ORDER BY created_at`, [listingId]);
  return r.rows;
}
async function convRow(conversationId) {
  return (await pool.query(`SELECT * FROM conversations WHERE id = $1`, [conversationId])).rows[0];
}

before(async () => {
  for (const k of ["APP_ENV", "DATABASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) prevEnv[k] = process.env[k];
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.APP_ENV = "test";
  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });
  server = createServer(async (req, res) => {
    patchRes(res);
    await accountHandler(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server?.close(r));
  await pool?.end();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("R1. 생성 중 사용자가 AI를 끄거나 정책을 바꾸면 늦은 AI 답장은 커밋되지 않는다", async () => {
  // (a) 모드 off
  const a = await setup();
  await updateConversationAiPolicy(a.owner, { conversationId: a.conversationId, mode: "autonomous" }, { pool });
  const offMid = scripted(async () => {
    await updateConversationAiPolicy(a.owner, { conversationId: a.conversationId, mode: "off" }, { pool });
    return tool("send_proxy_reply", { body: "네 가능합니다", confidence: "high" });
  });
  const ra = await runDelegatedChatReply({ conversationId: a.conversationId, triggerSeq: a.firstSeq, targetRole: "owner", pool, call: offMid, today: kstToday() });
  assert.notEqual(ra.action, "replied", JSON.stringify(ra));
  assert.equal(ra.reason, "MODE_CHANGED");
  assert.equal(await countAiProxy(a.conversationId), 0);

  // (b) 정책 변경(버전 증가)
  const b = await setup();
  await updateConversationAiPolicy(b.owner, { conversationId: b.conversationId, mode: "autonomous", policy: { minPrice: 200000 } }, { pool });
  const policyMid = scripted(async () => {
    await updateConversationAiPolicy(b.owner, { conversationId: b.conversationId, policy: { minPrice: 280000 } }, { pool });
    return tool("send_proxy_reply", { body: "네 가능합니다", confidence: "high" });
  });
  const rb = await runDelegatedChatReply({ conversationId: b.conversationId, triggerSeq: b.firstSeq, targetRole: "owner", pool, call: policyMid, today: kstToday() });
  assert.equal(rb.reason, "POLICY_CHANGED", JSON.stringify(rb));
  assert.equal(await countAiProxy(b.conversationId), 0);
});

test("R2. 예산은 저장되는 합의액으로 검사: 상한 초과 제안은 수락·신청 불가, 24만 합의는 정가 30만이 아닌 24만으로 저장", async () => {
  const s = await setup();
  await updateConversationAiPolicy(s.buyer, { conversationId: s.conversationId, mode: "autonomous", policy: BUYER_FULL }, { pool });

  // 판매자가 3일 30만원(정가) 제안 → 구매자 AI가 수락을 시도해도 서버가 거부
  await submitOffer(
    { conversationId: s.conversationId, actorUserId: s.owner.id, terms: { amount: 300000, amountUnit: "total", start: START, end: END, transportPayer: "none", transportFee: 0 } },
    { pool }
  );
  const m1 = await sendMessage(s.owner, { id: randomUUID(), conversationId: s.conversationId, body: "3일 30만원입니다." }, { pool });
  const tryAccept = scripted(
    tool("accept_offer", { message: "좋습니다 진행할게요" }),
    tool("complete_delegated_transaction", { start: START, end: END, agreedPrice: 240000 }), // 구 도구: 존재하지 않아야 함
    tool("escalate_to_user", { reasonCode: "price_outside_policy", summaryForUser: "확인 필요" })
  );
  const r1 = await runDelegatedChatReply({ conversationId: s.conversationId, triggerSeq: m1.message.seq, targetRole: "buyer", pool, call: tryAccept, today: kstToday() });
  assert.notEqual(r1.action, "offer_accepted", JSON.stringify(r1));
  assert.equal((await rentalRows(s.listing.id)).length, 0, "상한 초과 조건으로 신청이 생기면 안 됨");
  const agreed = await pool.query(`SELECT count(*)::int AS c FROM trade_offers WHERE conversation_id = $1 AND status = 'accepted'`, [s.conversationId]);
  assert.equal(agreed.rows[0].c, 0);

  // 판매자가 24만원 역제안 → 구매자 AI 수락 → 합의 + 자동 신청, 저장액 24만
  const s2 = await setup();
  await updateConversationAiPolicy(s2.buyer, { conversationId: s2.conversationId, mode: "autonomous", policy: BUYER_FULL }, { pool });
  await submitOffer(
    { conversationId: s2.conversationId, actorUserId: s2.owner.id, terms: { amount: 240000, amountUnit: "total", start: START, end: END, transportPayer: "none", transportFee: 0 } },
    { pool }
  );
  const m2 = await sendMessage(s2.owner, { id: randomUUID(), conversationId: s2.conversationId, body: "24만원에 해드릴게요." }, { pool });
  const r2 = await runDelegatedChatReply({
    conversationId: s2.conversationId,
    triggerSeq: m2.message.seq,
    targetRole: "buyer",
    pool,
    call: scripted(tool("accept_offer", { message: "24만원으로 진행하겠습니다." })),
    today: kstToday(),
  });
  assert.equal(r2.action, "offer_accepted", JSON.stringify(r2));
  assert.equal(r2.agreed, true);
  const rows = await rentalRows(s2.listing.id);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].total_price), 240000, "합의액 24만이 저장돼야 하며 정가 30만이 아님");
  assert.equal(rows[0].requester_id, s2.buyer.id);
  assert.equal(rows[0].status, "pending", "신청은 판매자 승인 전 pending(완료 아님)");
  globalThis.__p0_applied = s2; // R4에서 재사용
});

test("R3a. 판매자 AI는 구매자 명의 신청을 만들 수 없다(도구 미노출 + 서버 403)", async () => {
  const s = await setup();
  await updateConversationAiPolicy(
    s.owner,
    { conversationId: s.conversationId, mode: "autonomous", policy: { fullDelegation: true, autoExecuteTransaction: true, minPrice: 200000 } },
    { pool }
  );
  await submitOffer(
    { conversationId: s.conversationId, actorUserId: s.buyer.id, terms: { amount: 300000, amountUnit: "total", start: START, end: END, transportPayer: "none", transportFee: 0 } },
    { pool }
  );
  const m = await sendMessage(s.buyer, { id: randomUUID(), conversationId: s.conversationId, body: "30만원에 빌릴게요" }, { pool });
  const r = await runDelegatedChatReply({
    conversationId: s.conversationId,
    triggerSeq: m.message.seq,
    targetRole: "owner",
    pool,
    call: scripted(
      tool("apply_agreed_offer", { message: "신청 접수했습니다" }),
      tool("complete_delegated_transaction", { start: START, end: END }),
      tool("escalate_to_user", { reasonCode: "needs_user_decision", summaryForUser: "확인" })
    ),
    today: kstToday(),
  });
  assert.notEqual(r.action, "applied", JSON.stringify(r));
  assert.equal((await rentalRows(s.listing.id)).length, 0);

  // 사람 판매자가 수락해 합의가 되어도, 판매자 명의 신청 시도는 403
  const latest = await pool.query(`SELECT id, terms_version FROM trade_offers WHERE conversation_id = $1 ORDER BY terms_version DESC LIMIT 1`, [s.conversationId]);
  const acc = await acceptOffer(
    { conversationId: s.conversationId, offerId: latest.rows[0].id, termsVersion: latest.rows[0].terms_version, actorUserId: s.owner.id },
    { pool }
  );
  assert.equal(acc.agreed, true);
  await assert.rejects(
    () => applyAgreedOffer({ conversationId: s.conversationId, offerId: latest.rows[0].id, actorUserId: s.owner.id }, { pool, today: kstToday() }),
    (err) => err.status === 403 && err.code === "SELLER_CANNOT_APPLY"
  );
  assert.equal((await rentalRows(s.listing.id)).length, 0);
});

test("R3b. 상대방 메시지는 내 확인 대기(에스컬레이션)를 풀지 않고, 큐로 들어온 이벤트도 자동 답장하지 않는다", async () => {
  const s = await setup();
  await updateConversationAiPolicy(s.buyer, { conversationId: s.conversationId, mode: "autonomous", policy: BUYER_FULL }, { pool });
  const m1 = await sendMessage(s.owner, { id: randomUUID(), conversationId: s.conversationId, body: "5만원 깎아드릴까요? 예산이 얼마세요?" }, { pool });
  const e = await runDelegatedChatReply({
    conversationId: s.conversationId,
    triggerSeq: m1.message.seq,
    targetRole: "buyer",
    pool,
    call: scripted(tool("escalate_to_user", { reasonCode: "price_negotiation", summaryForUser: "가격 확인 필요" })),
    today: kstToday(),
  });
  assert.equal(e.action, "escalated", JSON.stringify(e));
  assert.match(String((await convRow(s.conversationId)).buyer_ai_pause), /^escalated:/);

  const before = await countAiProxy(s.conversationId);
  const m2 = await sendMessage(s.owner, { id: randomUUID(), conversationId: s.conversationId, body: "답 주세요" }, { pool });
  assert.match(String((await convRow(s.conversationId)).buyer_ai_pause), /^escalated:/, "상대 메시지로 해제되면 안 됨");

  await enqueueDelegatedReply({ conversationId: s.conversationId, triggerSeq: m2.message.seq, targetRole: "buyer", pool });
  const stats = await processDelegationJobs({
    pool,
    conversationId: s.conversationId,
    runnerOptions: { call: scripted(tool("send_proxy_reply", { body: "예산은 25만원입니다", confidence: "high" })), today: kstToday() },
  });
  assert.equal(stats.succeeded, 1);
  const job = await pool.query(`SELECT last_reason FROM delegation_jobs WHERE conversation_id = $1 AND trigger_seq = $2`, [s.conversationId, m2.message.seq]);
  assert.equal(job.rows[0].last_reason, "AI_PAUSED");
  assert.equal(await countAiProxy(s.conversationId), before, "확인 대기 중 자동 답장 금지");
});

test("R4. 신청 후 '감사합니다'와 중복 이벤트·재신청 시도에도 같은 합의로 신청은 1건뿐", async () => {
  const s = globalThis.__p0_applied;
  assert.ok(s, "R2 선행 필요");
  assert.equal((await rentalRows(s.listing.id)).length, 1);

  const thanks = await sendMessage(s.owner, { id: randomUUID(), conversationId: s.conversationId, body: "감사합니다~" }, { pool });
  await runDelegatedChatReply({
    conversationId: s.conversationId,
    triggerSeq: thanks.message.seq,
    targetRole: "buyer",
    pool,
    call: scripted(tool("apply_agreed_offer", { message: "신청했습니다" })),
    today: kstToday(),
  });
  // 같은 이벤트가 큐로 여러 번 들어와도 1회만 처리
  for (let i = 0; i < 3; i += 1) {
    await enqueueDelegatedReply({ conversationId: s.conversationId, triggerSeq: thanks.message.seq, targetRole: "buyer", pool });
  }
  await processDelegationJobs({
    pool,
    conversationId: s.conversationId,
    runnerOptions: { call: scripted(tool("apply_agreed_offer", { message: "신청했습니다" })), today: kstToday() },
  });
  const agreedOffer = await pool.query(`SELECT id FROM trade_offers WHERE conversation_id = $1 AND status = 'accepted' LIMIT 1`, [s.conversationId]);
  const again = await applyAgreedOffer({ conversationId: s.conversationId, offerId: agreedOffer.rows[0].id, actorUserId: s.buyer.id }, { pool, today: kstToday() });
  assert.equal(again.idempotent, true);
  assert.equal((await rentalRows(s.listing.id)).length, 1, "같은 합의로 신청은 1건");
});
