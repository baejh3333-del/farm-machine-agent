// 구조화 협상(trade_offers)·합의·신청 연결 검증(사람 참여자 전용).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { sendMessage } from "../server/chat.js";
import { kstToday } from "../server/db.js";
import {
  acceptOffer,
  applyAgreedOffer,
  computeOfferTotals,
  getNegotiationState,
  getTradeSummaries,
  normalizeOfferTerms,
  rejectOffer,
  submitOffer,
} from "../server/trade-negotiation.js";
import { makeListing, setupAgentDb, shiftDate } from "./helpers/agent-db.js";

const OWNER = { id: "u-a" };
const BUYER = { id: "u-b" };
const OUTSIDER = { id: "u-c" };

let pool;
let cleanup;

before(async () => {
  ({ pool, cleanup } = await setupAgentDb());
});

after(async () => {
  await cleanup?.();
});

async function expectHttpError(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status, `status ${error.status} code ${error.code}`);
    assert.equal(error.code, code);
    return true;
  });
}

async function openConversation(listing, body = "문의드립니다.") {
  const sent = await sendMessage(BUYER, { id: randomUUID(), listingId: listing.id, body }, { pool });
  return { convId: sent.conversation.id, seq: sent.message.seq };
}

// ───────────────────────── 순수 함수 ─────────────────────────

test("금액 계산: 운송비 미정은 0원이 아니며, 직접 인수(none)만 0원으로 확정", () => {
  assert.deepEqual(computeOfferTotals({ item_total: 900000, transport_fee: null, transport_payer: null }), {
    termsComplete: false, totalAmount: null, ownerNet: null,
  });
  assert.deepEqual(computeOfferTotals({ item_total: 900000, transport_fee: null, transport_payer: "buyer" }).termsComplete, false);
  assert.deepEqual(computeOfferTotals({ item_total: 950000, transport_fee: 30000, transport_payer: "buyer" }), {
    termsComplete: true, totalAmount: 980000, ownerNet: 950000,
  });
  assert.deepEqual(computeOfferTotals({ item_total: 950000, transport_fee: 30000, transport_payer: "owner" }), {
    termsComplete: true, totalAmount: 950000, ownerNet: 920000,
  });
  assert.equal(computeOfferTotals({ item_total: 1, transport_fee: 0, transport_payer: "none" }).termsComplete, true);

  const rent = normalizeOfferTerms(
    { amount: 80000, amountUnit: "daily", start: "2030-05-01", end: "2030-05-03", transportPayer: "none" },
    { type: "rent", price: 100000 }
  );
  assert.equal(rent.days, 3);
  assert.equal(rent.itemTotal, 240000);
  assert.equal(rent.transportFee, 0);
  assert.throws(() => normalizeOfferTerms({ amount: 1, amountUnit: "daily" }, { type: "sale" }), /총액/);
  assert.throws(() => normalizeOfferTerms({ amount: 1, transportFee: 5000 }, { type: "sale" }), /부담/);
  assert.throws(() => normalizeOfferTerms({ amount: 1, transportPayer: "none", transportFee: 5000 }, { type: "sale" }), /직접 인수/);
});

// ───────────────────────── 제안·수락·신청 ─────────────────────────

test("목표 24만/상한 25만 3일 대여: 합의 24만은 정가 30만이 아니라 24만으로 저장되고 같은 합의로 중복 신청되지 않는다", async () => {
  const listing = await makeListing(OWNER.id, { price: 100000, title: "3일 대여 관리기" });
  const { convId } = await openConversation(listing);
  const start = shiftDate(kstToday(), 3);
  const end = shiftDate(start, 2);

  const o1 = await submitOffer(
    { conversationId: convId, actorUserId: BUYER.id, terms: { amount: 240000, amountUnit: "total", start, end, transportPayer: "none" } },
    { pool }
  );
  assert.equal(o1.offer.termsVersion, 1);
  assert.equal(o1.offer.acceptedByBuyer, true);
  assert.equal(o1.offer.acceptedByOwner, false);
  assert.equal(o1.offer.days, 3);

  // 합의 전 신청 불가
  await expectHttpError(applyAgreedOffer({ conversationId: convId, actorUserId: BUYER.id, offerId: o1.offer.id }, { pool }), 409, "OFFER_NOT_AGREED");
  // 오래된 버전 수락 불가
  await expectHttpError(acceptOffer({ conversationId: convId, actorUserId: OWNER.id, offerId: o1.offer.id, termsVersion: 0 }, { pool }), 409, "OFFER_VERSION_STALE");
  // 제3자 접근 불가
  await expectHttpError(acceptOffer({ conversationId: convId, actorUserId: OUTSIDER.id, offerId: o1.offer.id, termsVersion: 1 }, { pool }), 403, "FORBIDDEN");
  // 역할 위조 불가
  await expectHttpError(
    acceptOffer({ conversationId: convId, actorUserId: OWNER.id, actorRole: "buyer", offerId: o1.offer.id, termsVersion: 1 }, { pool }),
    403,
    "ROLE_MISMATCH"
  );

  const acc = await acceptOffer({ conversationId: convId, actorUserId: OWNER.id, offerId: o1.offer.id, termsVersion: 1 }, { pool });
  assert.equal(acc.agreed, true);
  assert.equal(acc.offer.status, "accepted");
  assert.equal(acc.order, null, "합의만으로 신청이 생기지 않는다");

  // 판매자는 구매자 명의로 신청할 수 없다
  await expectHttpError(applyAgreedOffer({ conversationId: convId, actorUserId: OWNER.id, offerId: o1.offer.id }, { pool }), 403, "SELLER_CANNOT_APPLY");

  // 구매자 본인(명시적 버튼)은 AI 권한 없이도 신청 가능, 동시에 두 번 눌러도 1건
  const [a, b] = await Promise.all([
    applyAgreedOffer({ conversationId: convId, actorUserId: BUYER.id, offerId: o1.offer.id }, { pool }),
    applyAgreedOffer({ conversationId: convId, actorUserId: BUYER.id, offerId: o1.offer.id }, { pool }),
  ]);
  assert.equal(a.order.id, b.order.id);
  assert.equal([a.idempotent, b.idempotent].filter(Boolean).length, 1);
  const rows = await pool.query(`SELECT * FROM rental_requests WHERE listing_id = $1`, [listing.id]);
  assert.equal(rows.rows.length, 1);
  assert.equal(Number(rows.rows[0].total_price), 240000);
  assert.equal(Number(rows.rows[0].daily_price), 80000);
  assert.equal(Number(rows.rows[0].list_daily_price), 100000);
  assert.equal(rows.rows[0].created_via, "human");
  assert.equal(rows.rows[0].transport_payer, "none");

  // 신청 진행 중에는 조건 변경 불가, 단계는 applied
  await expectHttpError(
    submitOffer({ conversationId: convId, actorUserId: OWNER.id, terms: { amount: 300000, start, end, transportPayer: "none" } }, { pool }),
    409,
    "ORDER_ALREADY_ACTIVE"
  );
  const state = await getNegotiationState({ conversationId: convId, viewerUserId: OWNER.id }, { pool });
  assert.equal(state.stage, "applied");
  assert.equal(state.order.offerId, o1.offer.id);
  assert.equal(state.order.totalPrice, 240000);
  const summaries = await getTradeSummaries([convId], BUYER.id, { pool });
  assert.equal(summaries.get(convId).stage, "applied");
  assert.equal((await getTradeSummaries([convId], OUTSIDER.id, { pool })).size, 0);
});

test("조건 변경 시 이전 수락 무효, 운송비 미정은 합의 불가, 거절/철회", async () => {
  const listing = await makeListing(OWNER.id, { type: "sale", price: 1000000, title: "판매 이앙기" });
  const { convId } = await openConversation(listing);

  const o1 = await submitOffer({ conversationId: convId, actorUserId: OWNER.id, terms: { amount: 950000, transportPayer: "buyer" } }, { pool });
  assert.equal(o1.offer.termsComplete, false);
  assert.equal(o1.offer.transportFee, null);
  await expectHttpError(
    acceptOffer({ conversationId: convId, actorUserId: BUYER.id, offerId: o1.offer.id, termsVersion: 1 }, { pool }),
    409,
    "TERMS_INCOMPLETE"
  );

  const o2 = await submitOffer(
    { conversationId: convId, actorUserId: OWNER.id, terms: { amount: 950000, transportPayer: "buyer", transportFee: 30000 }, baseTermsVersion: 1 },
    { pool }
  );
  assert.equal(o2.offer.totalAmount, 980000);
  await expectHttpError(
    submitOffer({ conversationId: convId, actorUserId: BUYER.id, terms: { amount: 900000, transportPayer: "none" }, baseTermsVersion: 1 }, { pool }),
    409,
    "OFFER_VERSION_STALE"
  );
  // 구 버전 수락 시도
  await expectHttpError(
    acceptOffer({ conversationId: convId, actorUserId: BUYER.id, offerId: o1.offer.id, termsVersion: 1 }, { pool }),
    409,
    "OFFER_NOT_OPEN"
  );
  const rej = await rejectOffer({ conversationId: convId, actorUserId: BUYER.id, offerId: o2.offer.id }, { pool });
  assert.equal(rej.offer.status, "rejected");

  // 합의 후 새 제안이 오면 합의는 superseded
  const o3 = await submitOffer({ conversationId: convId, actorUserId: OWNER.id, terms: { amount: 960000, transportPayer: "none" } }, { pool });
  const agreed = await acceptOffer({ conversationId: convId, actorUserId: BUYER.id, offerId: o3.offer.id, termsVersion: o3.offer.termsVersion }, { pool });
  assert.equal(agreed.agreed, true);
  const o4 = await submitOffer({ conversationId: convId, actorUserId: OWNER.id, terms: { amount: 990000, transportPayer: "none" } }, { pool });
  const st = await getNegotiationState({ conversationId: convId, viewerUserId: BUYER.id }, { pool });
  assert.equal(st.negotiation.agreed, null);
  assert.equal(st.negotiation.currentOffer.id, o4.offer.id);
  assert.equal(st.negotiation.offers.find((o) => o.id === o3.offer.id).status, "superseded");
  assert.equal(st.stage, "negotiating");
});

// ───────────────────────── 발신 주체 ─────────────────────────

test("AI 대리 발신(ai_proxy)으로는 제안·수락·신청할 수 없다", async () => {
  const listing = await makeListing(OWNER.id, { type: "sale", price: 500000, title: "판매 분무기" });
  const { convId } = await openConversation(listing);
  await expectHttpError(
    submitOffer({ conversationId: convId, actorUserId: BUYER.id, senderKind: "ai_proxy", terms: { amount: 450000, transportPayer: "none" } }, { pool }),
    400,
    "INVALID_SENDER_KIND"
  );
  const o1 = await submitOffer({ conversationId: convId, actorUserId: OWNER.id, terms: { amount: 480000, transportPayer: "none" } }, { pool });
  assert.equal(o1.offer.senderKind, "human");
  await expectHttpError(
    acceptOffer({ conversationId: convId, actorUserId: BUYER.id, senderKind: "ai_proxy", offerId: o1.offer.id, termsVersion: 1 }, { pool }),
    400,
    "INVALID_SENDER_KIND"
  );
  const acc = await acceptOffer({ conversationId: convId, actorUserId: BUYER.id, offerId: o1.offer.id, termsVersion: 1 }, { pool });
  assert.equal(acc.agreed, true);
  assert.equal(acc.offer.buyerAcceptedBy, "human");
  await expectHttpError(
    applyAgreedOffer({ conversationId: convId, actorUserId: BUYER.id, senderKind: "ai_proxy", offerId: o1.offer.id }, { pool }),
    400,
    "INVALID_SENDER_KIND"
  );
  const applied = await applyAgreedOffer({ conversationId: convId, actorUserId: BUYER.id, offerId: o1.offer.id }, { pool });
  assert.equal(applied.order.createdVia, "human");
  assert.equal(applied.order.totalPrice, 480000);
  const st = await getNegotiationState({ conversationId: convId, viewerUserId: BUYER.id }, { pool });
  assert.equal(Object.hasOwn(st, "myEvaluation"), false, "AI 정책 평가는 더 이상 내려주지 않는다");
});
