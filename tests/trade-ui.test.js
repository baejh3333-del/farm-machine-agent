import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDeal, normalizeOffer, senderState, roleLabel, aiStatus, deriveStage, nextActions,
  matchesFilter, filterCounts, sortDeals, dealsBadge, filterMessages, readSeqFor,
  buildPolicyFromForm, validatePolicy, buildOfferBody, describeOffer, rentalDays,
  parseDealsHash, dealsHash, stageSteps,
} from "../src/data/deals-model.js";

const ME = "u-me";
const OTHER = "u-other";

function conv(over = {}) {
  return {
    id: "c1",
    listingId: "l1",
    listingTitle: "트랙터 MF-35",
    listingType: "rent",
    ownerId: OTHER,
    ownerName: "박농부",
    buyerId: ME,
    buyerName: "김농부",
    lastSeq: 5,
    buyerAiMode: "autonomous",
    ownerAiMode: "off",
    buyerAiPolicy: {},
    ownerAiPolicy: {},
    ...over,
  };
}

test("역할은 서버 myRole을 우선하고, 대여/판매에 맞는 한국어 칩을 만든다", () => {
  assert.equal(normalizeDeal(conv({ myRole: "owner" }), { meId: ME }).myRole, "owner");
  const d = normalizeDeal(conv(), { meId: ME });
  assert.equal(d.myRole, "buyer");
  assert.equal(d.roleLabel, "빌리는 쪽");
  assert.equal(d.counterpartName, "박농부");
  assert.equal(roleLabel("owner", "sale"), "파는 쪽");
  assert.equal(roleLabel("buyer", "sale"), "사는 쪽");
});

test("발신 주체 6종: 내 직접/내 농농이/상대 직접/상대 농농이/시스템 (+초안은 별도)", () => {
  const ctx = { meId: ME, myRole: "buyer" };
  assert.equal(senderState({ senderId: ME, senderKind: "human", senderRole: "buyer" }, ctx), "me_human");
  assert.equal(senderState({ senderId: ME, senderKind: "ai_proxy", senderRole: "buyer" }, ctx), "me_ai");
  assert.equal(senderState({ senderId: OTHER, senderKind: "human", senderRole: "owner" }, ctx), "other_human");
  assert.equal(senderState({ senderId: OTHER, senderKind: "ai_proxy", senderRole: "owner" }, ctx), "other_ai");
  assert.equal(senderState({ senderId: ME, senderKind: "system", senderRole: "system" }, ctx), "system");
  // senderRole이 없는 구버전 응답도 senderId로 판별
  assert.equal(senderState({ senderId: OTHER, senderKind: "ai_proxy" }, { meId: ME }), "other_ai");
  const d = normalizeDeal(conv({ myAiState: { mode: "copilot", pause: null, draft: { body: "토요일 오전 가능할까요?" } } }), { meId: ME });
  assert.equal(d.ai.draft.body, "토요일 오전 가능할까요?");
  assert.ok(d.nextActions.some((a) => a.key === "draft"));
});

test("내 일시정지 상태: takeover는 직접 진행, escalated는 확인 대기이며 둘 다 다시 맡기기 가능", () => {
  const take = aiStatus(conv({ myAiState: { mode: "autonomous", pause: "takeover" } }), "buyer");
  assert.equal(take.key, "takeover");
  assert.equal(take.canResume, true);
  assert.equal(take.canTakeover, false);
  const esc = aiStatus(conv({ myAiState: { mode: "autonomous", pause: "escalated:budget_exceeded", waitingForUser: true } }), "buyer");
  assert.equal(esc.key, "waiting");
  assert.equal(esc.reasonLabel, "예산 상한 초과");
  const failed = aiStatus(conv({ myAiState: { mode: "autonomous", pause: "failed:LLM_FAILED" } }), "buyer");
  assert.equal(failed.key, "failed");
  const full = aiStatus(conv({ myAiState: { mode: "autonomous", pause: null, policy: { fullDelegation: true } } }), "buyer");
  assert.equal(full.key, "full");
  // 상대 정책은 내 상태에 섞이지 않는다
  const legacy = aiStatus(conv({ buyerAiMode: "off", ownerAiMode: "autonomous", ownerAiPolicy: { fullDelegation: true } }), "buyer");
  assert.equal(legacy.key, "off");
});

test("단계: 날짜 경과(derivedState active/completed)로 대여 중·완료를 만들지 않는다", () => {
  assert.equal(deriveStage(conv({ stage: "confirmed", order: { kind: "rental", status: "approved", derivedState: "completed" } })), "confirmed");
  assert.equal(deriveStage(conv({ stage: "confirmed", order: { kind: "rental", status: "approved", derivedState: "active" } })), "confirmed");
  assert.equal(deriveStage(conv({ stage: "applied", order: { kind: "rental", status: "pending", derivedState: "expired" } })), "applied");
  assert.equal(deriveStage(conv({ order: { kind: "rental", status: "completed" } })), "completed");
  assert.equal(deriveStage(conv({})), "inquiry");
  assert.equal(deriveStage(conv({ stage: "negotiating" })), "negotiating");
  const steps = stageSteps("agreed", "sale");
  assert.deepEqual(steps.map((s) => s.key), ["inquiry", "negotiating", "agreed", "applied", "confirmed", "completed"]);
  assert.equal(steps.find((s) => s.state === "current").key, "agreed");
});

test("제안 DTO: v2 이름과 v1 별칭을 모두 정규화하고 운송비 미정은 '미정'으로 표시", () => {
  const v2 = normalizeOffer({ id: 9, termsVersion: 3, fromRole: "owner", senderKind: "ai_proxy", amount: 80000, amountUnit: "daily", days: 3, itemTotal: 240000, transportFee: null, transportPayer: null, totalAmount: null, termsComplete: false, status: "open", acceptedByOwner: true });
  assert.equal(v2.termsVersion, 3);
  assert.equal(v2.amountUnit, "daily");
  assert.equal(v2.acceptedByOwner, true);
  assert.match(describeOffer(v2), /일 80,000원 × 3일 = 240,000원/);
  assert.match(describeOffer(v2), /운송비 미정/);
  const v1 = normalizeOffer({ id: "a", version: 2, byRole: "buyer", source: "human", amountBasis: "total", amount: 950000, buyerTotal: 980000, transportFee: 30000, transportPayer: "buyer", status: "agreed", buyerAcceptedAt: "x", ownerAcceptedAt: "y" });
  assert.equal(v1.termsVersion, 2);
  assert.equal(v1.fromRole, "buyer");
  assert.equal(v1.totalAmount, 980000);
  assert.equal(v1.status, "accepted");
  assert.equal(v1.acceptedByBuyer && v1.acceptedByOwner, true);
});

test("다음 할 일: 상대 제안 응답·합의 후 구매자 신청·판매자 승인만 확인 필요로 분류", () => {
  const theirs = normalizeDeal(conv({ stage: "negotiating", negotiation: { termsVersion: 2, currentOffer: { id: "o2", termsVersion: 2, fromRole: "owner", amount: 950000, amountUnit: "total", status: "open", acceptedByOwner: true } } }), { meId: ME });
  assert.ok(theirs.needsAttention);
  assert.ok(theirs.nextActions.some((a) => a.key === "respond_offer"));

  const mine = normalizeDeal(conv({ stage: "negotiating", negotiation: { currentOffer: { id: "o3", termsVersion: 3, fromRole: "buyer", amount: 900000, status: "open", acceptedByBuyer: true } } }), { meId: ME });
  assert.equal(mine.nextActions.some((a) => a.key === "respond_offer"), false);

  const agreedOffer = { id: "o4", termsVersion: 4, fromRole: "owner", amount: 920000, status: "accepted", acceptedByBuyer: true, acceptedByOwner: true, transportPayer: "none", transportFee: 0, termsComplete: true };
  const buyerAgreed = normalizeDeal(conv({ stage: "agreed", negotiation: { currentOffer: agreedOffer, agreed: agreedOffer }, order: null }), { meId: ME });
  assert.ok(buyerAgreed.nextActions.some((a) => a.key === "apply"));
  const ownerAgreed = normalizeDeal(conv({ myRole: "owner", buyerId: OTHER, ownerId: ME, stage: "agreed", negotiation: { currentOffer: agreedOffer, agreed: agreedOffer }, order: null }), { meId: ME });
  assert.equal(ownerAgreed.nextActions.some((a) => a.key === "apply"), false, "판매자는 신청할 수 없다");

  const ownerPending = normalizeDeal(conv({ myRole: "owner", buyerId: OTHER, ownerId: ME, stage: "applied", order: { kind: "rental", id: "r1", status: "pending", derivedState: "approvable" } }), { meId: ME });
  assert.ok(ownerPending.nextActions.some((a) => a.key === "approve"));
  const ownerExpired = normalizeDeal(conv({ myRole: "owner", buyerId: OTHER, ownerId: ME, stage: "applied", order: { kind: "rental", id: "r1", status: "pending", derivedState: "expired" } }), { meId: ME });
  assert.equal(ownerExpired.nextActions.some((a) => a.key === "approve"), false);
  const ownerPurchase = normalizeDeal(conv({ listingType: "sale", myRole: "owner", buyerId: OTHER, ownerId: ME, stage: "applied", order: { kind: "purchase", id: "p1", status: "pending" } }), { meId: ME });
  assert.equal(ownerPurchase.nextActions.some((a) => a.key === "approve"), false, "구매 승인 API가 없으므로 승인 버튼을 약속하지 않는다");
  assert.ok(ownerPurchase.nextActions.some((a) => a.key === "purchase_received"));
});

test("필터·정렬·배지: 확인 필요 우선, 안 읽음은 서버 unreadCount만 사용", () => {
  const deals = [
    normalizeDeal(conv({ id: "a", updatedAt: "2026-11-18T01:00:00Z", unreadCount: 2 }), { meId: ME }),
    normalizeDeal(conv({ id: "b", updatedAt: "2026-11-18T00:00:00Z", myAiState: { mode: "autonomous", pause: "escalated:unknown_condition", waitingForUser: true } }), { meId: ME }),
    normalizeDeal(conv({ id: "c", myRole: "owner", ownerId: ME, buyerId: OTHER, updatedAt: "2026-11-18T02:00:00Z", ownerAiMode: "off", buyerAiMode: "off" }), { meId: ME }),
  ];
  assert.deepEqual(sortDeals(deals).map((d) => d.id), ["b", "c", "a"]);
  const counts = filterCounts(deals);
  assert.equal(counts.all, 3);
  assert.equal(counts.buyer, 2);
  assert.equal(counts.owner, 1);
  assert.equal(counts.attention, 1);
  assert.equal(counts.unread, 1);
  assert.equal(counts.ai, 1);
  assert.deepEqual(dealsBadge(deals), { attention: 1, unread: 2 });
  assert.equal(matchesFilter(deals[2], "unread"), false);
  assert.equal(deals[2].unreadSupported, false);
});

test("읽음 seq: 화면에 그린 상대·시스템 메시지 기준, 내 AI 발신만으로는 읽음 처리하지 않음", () => {
  const ctx = { meId: ME, myRole: "buyer" };
  const msgs = [
    { seq: 1, senderId: OTHER, senderKind: "human", senderRole: "owner" },
    { seq: 2, senderId: ME, senderKind: "ai_proxy", senderRole: "buyer" },
    { seq: 3, senderId: ME, senderKind: "ai_proxy", senderRole: "buyer" },
  ];
  assert.equal(readSeqFor(msgs, ctx, 0), 1);
  assert.equal(readSeqFor(msgs, ctx, 1), null);
  assert.equal(readSeqFor(msgs.slice(1), ctx, 0), null);
  assert.deepEqual(filterMessages(msgs, "sent", ctx).map((m) => m.seq), [2, 3]);
  assert.deepEqual(filterMessages(msgs, "received", ctx).map((m) => m.seq), [1]);
});

test("위임 조건: 비운 한도는 null(정가로 채우지 않음), 운송비 미입력은 미정(null), 판매자는 신청 권한 없음", () => {
  const buyer = buildPolicyFromForm({ targetPrice: "900,000", limit: "", transportPayer: "buyer", transportFee: "", transportKnown: false, allowNegotiation: true, autoExecuteTransaction: true, requiredQuestions: "누유 여부\n\n토요일 인수 가능 여부" }, "buyer");
  assert.equal(buyer.targetPrice, 900000);
  assert.equal(buyer.maxBudget, null);
  assert.equal(buyer.transportFee, null);
  assert.equal(buyer.autoExecuteTransaction, true);
  assert.deepEqual(buyer.requiredQuestions, ["누유 여부", "토요일 인수 가능 여부"]);
  const pickup = buildPolicyFromForm({ transportPayer: "none" }, "buyer");
  assert.equal(pickup.transportFee, 0, "직접 인수는 명시적으로 0원");
  const owner = buildPolicyFromForm({ targetPrice: "1000000", limit: "900000", autoExecuteTransaction: true }, "owner");
  assert.equal(owner.minPrice, 900000);
  assert.equal(owner.autoExecuteTransaction, false);
  assert.equal(owner.maxBudget, undefined);
  assert.deepEqual(validatePolicy({ targetPrice: 1100000, maxBudget: 1000000 }, "buyer"), ["목표가는 최대 예산보다 클 수 없어요."]);
  assert.deepEqual(validatePolicy({ targetPrice: 800000, minPrice: 900000 }, "owner"), ["희망가는 최저 허용가보다 낮을 수 없어요."]);
});

test("제안 본문: 단위·기간·운송비를 명시하고 worker1/worker2 별칭을 모두 보낸다", () => {
  const body = buildOfferBody({ conversationId: "c1", amount: "80,000", amountUnit: "daily", start: "2026-12-01", end: "2026-12-03", days: rentalDays("2026-12-01", "2026-12-03"), transportPayer: "buyer", transportFee: "", note: "", baseTermsVersion: 2 });
  assert.equal(body.action, "submit_offer");
  assert.equal(body.terms.amount, 80000);
  assert.equal(body.terms.amountUnit, "daily");
  assert.equal(body.terms.amountBasis, "daily");
  assert.equal(body.terms.days, 3);
  assert.equal(body.terms.transportFee, null);
  assert.equal(body.offer, body.terms);
  assert.equal(body.baseTermsVersion, 2);
  assert.throws(() => buildOfferBody({ conversationId: "c1", amount: "" }), /금액/);
});

test("해시 라우트: #/deals, #/deals/:id, 필터", () => {
  assert.deepEqual(parseDealsHash("#/deals"), { conversationId: null, filter: null });
  assert.deepEqual(parseDealsHash("#/deals/abc-1?filter=attention"), { conversationId: "abc-1", filter: "attention" });
  assert.equal(parseDealsHash("#/other"), null);
  assert.equal(dealsHash({ conversationId: "x y" }), "#/deals/x%20y");
  assert.equal(dealsHash({ filter: "all" }), "#/deals");
  assert.equal(dealsHash({ filter: "owner" }), "#/deals?filter=owner");
});

test("구버전 DTO(order 미포함)에서도 목록이 깨지지 않는다", () => {
  const d = normalizeDeal(conv({ aiPausedReason: "transaction_completed" }), { meId: ME, legacyOrder: { kind: "rental", status: "pending", derivedState: "approvable" } });
  assert.equal(d.stage, "applied");
  assert.equal(d.ai.key, "submitted");
  assert.equal(nextActions(d).some((a) => a.key === "approve"), false, "구매자에게는 승인 버튼이 없다");
});
