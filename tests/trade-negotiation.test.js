// 구조화 협상(trade_offers)·합의·신청 연결과 대리 AI 권한 경계 검증.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { sendMessage, takeoverConversation, updateConversationAiPolicy } from "../server/chat.js";
import { kstToday } from "../server/db.js";
import { extractKrwAmounts, findDisclosedLimit, runDelegatedChatReply } from "../server/delegated-chat.js";
import {
  acceptOffer,
  applyAgreedOffer,
  computeOfferTotals,
  evaluateOfferForRole,
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

const tool = (name, input, id = `t_${name}`) => ({ content: [{ type: "tool_use", id, name, input }] });

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

test("본인 정책 평가: 목표가·한도 분리, 한도 원값 미포함, 목표가 쪽으로 역제안", () => {
  const offer = { listingType: "sale", termsComplete: true, totalAmount: 980000, ownerNet: 950000, transportPayer: "buyer", transportFee: 30000, days: null };
  const buyerPolicy = { targetPrice: 900000, maxBudget: 1000000 };
  const b = evaluateOfferForRole(offer, "buyer", buyerPolicy);
  assert.equal(b.verdict, "counter_in_range");
  assert.equal(b.counterSuggestion.totalAmount, 940000);
  assert.equal(b.counterSuggestion.amount, 910000); // 운송비 3만 제외한 대금
  assert.equal(JSON.stringify(b).includes("1000000"), false);
  assert.equal(evaluateOfferForRole({ ...offer, totalAmount: 1010000 }, "buyer", buyerPolicy).verdict, "outside_limit");
  assert.equal(evaluateOfferForRole({ ...offer, totalAmount: 890000 }, "buyer", buyerPolicy).verdict, "accept_ok");
  assert.equal(evaluateOfferForRole({ ...offer, termsComplete: false, totalAmount: null }, "buyer", buyerPolicy).reasons[0], "transport_unknown");
  assert.equal(evaluateOfferForRole(offer, "buyer", {}).verdict, "needs_user", "한도 미설정은 정가로 채우지 않고 사용자 확인");

  const s = evaluateOfferForRole(offer, "owner", { targetPrice: 1000000, minPrice: 900000 });
  assert.equal(s.verdict, "counter_in_range");
  assert.equal(s.counterSuggestion.ownerNet, 980000);
  assert.equal(evaluateOfferForRole({ ...offer, ownerNet: 880000 }, "owner", { minPrice: 900000 }).verdict, "outside_limit");

  // 대여 일 단가 한도는 일수로 환산
  const rentOffer = { listingType: "rent", termsComplete: true, totalAmount: 240000, ownerNet: 240000, days: 3, transportPayer: "none", transportFee: 0 };
  assert.equal(evaluateOfferForRole(rentOffer, "buyer", { maxBudget: 80000, budgetUnit: "daily" }).verdict, "accept_ok");
  assert.equal(evaluateOfferForRole(rentOffer, "buyer", { maxBudget: 70000, budgetUnit: "daily" }).verdict, "outside_limit");
  assert.equal(evaluateOfferForRole(rentOffer, "buyer", { targetPrice: 240000, maxBudget: 250000 }, { roundsUsed: 3 }).roundsLeft, 0);
});

test("금액 누설 검사: 한도 원값이 본문에 보이면 감지, 공개 제안 금액은 허용", () => {
  assert.ok(extractKrwAmounts("최대 100만 원까지 됩니다").has(1_000_000));
  assert.ok(extractKrwAmounts("1,000,000원").has(1_000_000));
  assert.ok(extractKrwAmounts("95만원에 운송비 3만").has(950_000));
  assert.ok(extractKrwAmounts("1억2천만원").has(120_000_000));
  const secret = new Set([1_000_000]);
  assert.equal(findDisclosedLimit("예산은 100만원까지예요", secret), 1_000_000);
  assert.equal(findDisclosedLimit("90만원 제안드립니다", secret), null);
  assert.equal(findDisclosedLimit("100만원 제안 수락합니다", secret, new Set([1_000_000])), null);
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

// ───────────────────────── 대리 AI 경계 ─────────────────────────

test("판매자 AI: 신청 도구가 없고, 구매자 제안 수락은 합의까지만(구매자 명의 신청 없음)", async () => {
  const listing = await makeListing(OWNER.id, { type: "sale", price: 500000, title: "판매 분무기" });
  const { convId } = await openConversation(listing);
  await updateConversationAiPolicy(
    OWNER,
    { conversationId: convId, mode: "autonomous", policy: { fullDelegation: true, autoExecuteTransaction: true, targetPrice: 480000, minPrice: 450000, allowNegotiation: true } },
    { pool }
  );
  await submitOffer({ conversationId: convId, actorUserId: BUYER.id, terms: { amount: 490000, transportPayer: "none" } }, { pool });
  const msg = await sendMessage(BUYER, { id: randomUUID(), conversationId: convId, body: "49만원에 직접 가져갈게요." }, { pool });

  const res = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msg.message.seq,
    targetRole: "owner",
    pool,
    call: async ({ tools, system }) => {
      assert.equal(tools.some((t) => t.name === "apply_agreed_offer"), false);
      assert.equal(system.includes("450,000"), false);
      assert.equal(system.includes("480,000"), false);
      return tool("accept_offer", { message: "49만원 직접 인수 조건 좋습니다." });
    },
  });
  assert.equal(res.action, "offer_accepted");
  assert.equal(res.agreed, true);
  assert.equal(res.order, undefined);
  const po = await pool.query(`SELECT COUNT(*)::int AS n FROM purchase_orders WHERE listing_id = $1`, [listing.id]);
  assert.equal(po.rows[0].n, 0);

  // 직접 API로 판매자 AI 신청 시도도 거부
  await expectHttpError(
    applyAgreedOffer({ conversationId: convId, actorUserId: OWNER.id, senderKind: "ai_proxy" }, { pool }),
    403,
    "SELLER_CANNOT_APPLY"
  );
});

test("구매자 AI 신청 권한 분리: fullDelegation이어도 autoExecuteTransaction=false면 합의 후 신청하지 않음", async () => {
  const listing = await makeListing(OWNER.id, { type: "sale", price: 700000, title: "판매 관리기" });
  const { convId } = await openConversation(listing);
  await updateConversationAiPolicy(
    BUYER,
    { conversationId: convId, mode: "autonomous", resume: true, policy: { fullDelegation: true, autoExecuteTransaction: false, targetPrice: 700000, maxBudget: 750000 } },
    { pool }
  );
  await submitOffer({ conversationId: convId, actorUserId: OWNER.id, terms: { amount: 700000, transportPayer: "none" } }, { pool });
  const msg = await sendMessage(OWNER, { id: randomUUID(), conversationId: convId, body: "70만원 직거래입니다." }, { pool });
  const res = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msg.message.seq,
    targetRole: "buyer",
    pool,
    call: async () => tool("accept_offer", { message: "70만원 직거래 좋습니다." }),
  });
  assert.equal(res.action, "offer_accepted");
  assert.equal(res.agreed, true);
  assert.equal(res.order, undefined);
  await expectHttpError(
    applyAgreedOffer({ conversationId: convId, actorUserId: BUYER.id, senderKind: "ai_proxy" }, { pool }),
    403,
    "AI_APPLY_NOT_AUTHORIZED"
  );
  const po = await pool.query(`SELECT COUNT(*)::int AS n FROM purchase_orders WHERE listing_id = $1`, [listing.id]);
  assert.equal(po.rows[0].n, 0);
});

test("협상 불허·가격 정책 없음: AI는 정가 외 금액을 제안하지 못하고 사용자 확인으로 멈춤", async () => {
  const listing = await makeListing(OWNER.id, { type: "sale", price: 300000, title: "판매 예초기" });
  const { convId } = await openConversation(listing);
  await updateConversationAiPolicy(BUYER, { conversationId: convId, mode: "autonomous", resume: true, policy: { fullDelegation: true, allowNegotiation: false } }, { pool });
  const msg = await sendMessage(OWNER, { id: randomUUID(), conversationId: convId, body: "얼마 생각하세요?" }, { pool });
  let rejection = null;
  let round = 0;
  const res = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msg.message.seq,
    targetRole: "buyer",
    pool,
    call: async ({ messages }) => {
      round += 1;
      if (round > 1) rejection = JSON.parse(messages[messages.length - 1].content[0].content);
      return tool("submit_offer", { amount: 250000, amountUnit: "total", transportPayer: "none", message: "25만원 어떠세요?" }, `s${round}`);
    },
  });
  assert.equal(rejection.code, "NEGOTIATION_NOT_ALLOWED");
  assert.equal(res.action, "escalated");
  assert.equal(res.reasonCode, "price_negotiation");
  const offers = await pool.query(`SELECT COUNT(*)::int AS n FROM trade_offers WHERE conversation_id = $1`, [convId]);
  assert.equal(offers.rows[0].n, 0);
});

test("발송 직전 재검사: LLM 실행 중 정책 변경·직접 이어받기면 제안·메시지를 커밋하지 않음", async () => {
  const listing = await makeListing(OWNER.id, { type: "sale", price: 400000, title: "판매 파종기" });
  const { convId } = await openConversation(listing);
  await updateConversationAiPolicy(
    BUYER,
    { conversationId: convId, mode: "autonomous", resume: true, policy: { fullDelegation: true, targetPrice: 350000, maxBudget: 400000, allowNegotiation: true } },
    { pool }
  );
  await submitOffer({ conversationId: convId, actorUserId: OWNER.id, terms: { amount: 400000, transportPayer: "none" } }, { pool });
  const msg = await sendMessage(OWNER, { id: randomUUID(), conversationId: convId, body: "40만원입니다." }, { pool });

  const policyChanged = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msg.message.seq,
    targetRole: "buyer",
    pool,
    call: async () => {
      await updateConversationAiPolicy(BUYER, { conversationId: convId, policy: { fullDelegation: true, targetPrice: 300000, maxBudget: 320000, allowNegotiation: true } }, { pool });
      return tool("submit_offer", { amount: 375000, amountUnit: "total", transportPayer: "none", message: "37만5천원 어떠세요?" });
    },
  });
  assert.equal(policyChanged.aborted, true);
  assert.equal(policyChanged.reason, "POLICY_CHANGED");

  const tookOver = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msg.message.seq,
    targetRole: "buyer",
    pool,
    call: async () => {
      await takeoverConversation(BUYER, { conversationId: convId }, { pool });
      return tool("send_proxy_reply", { body: "확인해 볼게요.", confidence: "high" });
    },
  });
  assert.equal(tookOver.aborted, true);
  assert.ok(["PAUSED_DURING_RUN", "POLICY_CHANGED"].includes(tookOver.reason));

  const offers = await pool.query(`SELECT COUNT(*)::int AS n FROM trade_offers WHERE conversation_id = $1 AND from_role = 'buyer'`, [convId]);
  assert.equal(offers.rows[0].n, 0);
  const ai = await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = $1 AND sender_kind = 'ai_proxy'`, [convId]);
  assert.equal(ai.rows[0].n, 0);
});

test("예산 질문에 한도를 말하는 AI 답장은 발신하지 않고 본인에게만 확인 요청", async () => {
  const listing = await makeListing(OWNER.id, { type: "sale", price: 1200000, title: "판매 트랙터 부속" });
  const { convId } = await openConversation(listing);
  await updateConversationAiPolicy(
    BUYER,
    { conversationId: convId, mode: "autonomous", resume: true, policy: { fullDelegation: true, targetPrice: 900000, maxBudget: 1000000, allowNegotiation: true } },
    { pool }
  );
  const msg = await sendMessage(OWNER, { id: randomUUID(), conversationId: convId, body: "예산이 얼마세요? 솔직히 말해주세요." }, { pool });
  const res = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msg.message.seq,
    targetRole: "buyer",
    pool,
    call: async () => tool("send_proxy_reply", { body: "최대 100만 원까지 가능합니다.", confidence: "high" }),
  });
  assert.equal(res.action, "escalated");
  assert.equal(res.reasonCode, "possible_limit_disclosure");
  const ai = await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = $1 AND sender_kind = 'ai_proxy'`, [convId]);
  assert.equal(ai.rows[0].n, 0);
  const sys = await pool.query(`SELECT sender_id, body FROM messages WHERE conversation_id = $1 AND sender_kind = 'system'`, [convId]);
  assert.ok(sys.rows.every((r) => r.sender_id === BUYER.id && !r.body.includes("100만")));
});

test("구매자 AI 역제안은 목표가를 향하고 한도 밖 제안은 서버가 거부", async () => {
  const listing = await makeListing(OWNER.id, { type: "sale", price: 1000000, title: "판매 콤바인 부속" });
  const { convId } = await openConversation(listing);
  await updateConversationAiPolicy(
    BUYER,
    { conversationId: convId, mode: "autonomous", resume: true, policy: { fullDelegation: true, targetPrice: 900000, maxBudget: 1000000, allowNegotiation: true } },
    { pool }
  );
  await submitOffer({ conversationId: convId, actorUserId: OWNER.id, terms: { amount: 950000, transportPayer: "buyer", transportFee: 30000 } }, { pool });
  const msg = await sendMessage(OWNER, { id: randomUUID(), conversationId: convId, body: "95만원에 운송비 3만원 별도입니다." }, { pool });

  // 서버 직접 방어선: 한도 밖 AI 제안은 저장 거부
  await expectHttpError(
    submitOffer({ conversationId: convId, actorUserId: BUYER.id, senderKind: "ai_proxy", terms: { amount: 990000, transportPayer: "buyer", transportFee: 30000 } }, { pool }),
    409,
    "OFFER_OUTSIDE_POLICY"
  );

  let suggestion = null;
  let round = 0;
  const res = await runDelegatedChatReply({
    conversationId: convId,
    triggerSeq: msg.message.seq,
    targetRole: "buyer",
    pool,
    call: async ({ messages }) => {
      round += 1;
      if (round === 1) return tool("get_negotiation_state", {}, "g1");
      const state = JSON.parse(messages[messages.length - 1].content[0].content);
      suggestion = state.myEvaluation.counterSuggestion;
      return tool("submit_offer", {
        amount: suggestion.amount,
        amountUnit: "total",
        transportPayer: "buyer",
        transportFee: 30000,
        message: `운송비 포함 총 ${suggestion.totalAmount.toLocaleString("ko-KR")}원이면 바로 진행할게요.`,
      });
    },
  });
  assert.equal(suggestion.totalAmount, 940000);
  assert.equal(res.action, "offer_submitted");
  assert.equal(res.offer.totalAmount, 940000);
  assert.ok(res.offer.totalAmount < 980000);
});
