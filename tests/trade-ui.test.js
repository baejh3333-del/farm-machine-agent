import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDeal, normalizeOffer, senderState, roleLabel, deriveStage, nextActions,
  matchesFilter, filterCounts, sortDeals, dealsBadge, filterMessages, readSeqFor,
  buildOfferBody, describeOffer, rentalDays,
  parseDealsHash, dealsHash, stageSteps, DEAL_FILTERS,
} from "../src/data/deals-model.js";
import { sortInboxDeals } from "../src/views/deals.js";

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

test("발신 주체: 내 메시지/상대 메시지/시스템 (AI 대리 발신 구분 없음)", () => {
  const ctx = { meId: ME, myRole: "buyer" };
  assert.equal(senderState({ senderId: ME, senderKind: "human", senderRole: "buyer" }, ctx), "me_human");
  assert.equal(senderState({ senderId: OTHER, senderKind: "human", senderRole: "owner" }, ctx), "other_human");
  assert.equal(senderState({ senderId: ME, senderKind: "system", senderRole: "system" }, ctx), "system");
  // senderRole이 없는 구버전 응답도 senderId로 판별
  assert.equal(senderState({ senderId: OTHER, senderKind: "human" }, { meId: ME }), "other_human");
  // 과거에 남은 ai_proxy 메시지도 해당 역할의 메시지로만 표시한다
  assert.equal(senderState({ senderId: OTHER, senderKind: "ai_proxy", senderRole: "owner" }, ctx), "other_human");
  const d = normalizeDeal(conv(), { meId: ME });
  assert.equal(Object.hasOwn(d, "ai"), false, "거래 모델에 AI 대리 상태가 남아 있으면 안 된다");
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
  const v2 = normalizeOffer({ id: 9, termsVersion: 3, fromRole: "owner", senderKind: "human", amount: 80000, amountUnit: "daily", days: 3, itemTotal: 240000, transportFee: null, transportPayer: null, totalAmount: null, termsComplete: false, status: "open", acceptedByOwner: true });
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
    normalizeDeal(conv({ id: "b", updatedAt: "2026-11-18T00:00:00Z", stage: "negotiating", negotiation: { currentOffer: { id: "o1", termsVersion: 1, fromRole: "owner", amount: 90000, status: "open" } } }), { meId: ME }),
    normalizeDeal(conv({ id: "c", myRole: "owner", ownerId: ME, buyerId: OTHER, updatedAt: "2026-11-18T02:00:00Z" }), { meId: ME }),
  ];
  assert.deepEqual(sortDeals(deals).map((d) => d.id), ["b", "c", "a"]);
  const counts = filterCounts(deals);
  assert.equal(counts.all, 3);
  assert.equal(counts.buyer, 2);
  assert.equal(counts.owner, 1);
  assert.equal(counts.attention, 1);
  assert.equal(counts.unread, 1);
  assert.equal(Object.hasOwn(counts, "ai"), false, "농농이 진행 중 필터는 제거되었다");
  assert.equal(DEAL_FILTERS.some((f) => f.key === "ai"), false);
  assert.deepEqual(dealsBadge(deals), { attention: 1, unread: 2 });
  assert.equal(matchesFilter(deals[2], "unread"), false);
  assert.equal(deals[2].unreadSupported, false);
});

test("읽음 seq: 화면에 그린 상대·시스템 메시지 기준, 내 메시지만으로는 읽음 처리하지 않음", () => {
  const ctx = { meId: ME, myRole: "buyer" };
  const msgs = [
    { seq: 1, senderId: OTHER, senderKind: "human", senderRole: "owner" },
    { seq: 2, senderId: ME, senderKind: "human", senderRole: "buyer" },
    { seq: 3, senderId: ME, senderKind: "human", senderRole: "buyer" },
  ];
  assert.equal(readSeqFor(msgs, ctx, 0), 1);
  assert.equal(readSeqFor(msgs, ctx, 1), null);
  assert.equal(readSeqFor(msgs.slice(1), ctx, 0), null);
  assert.deepEqual(filterMessages(msgs, "sent", ctx).map((m) => m.seq), [2, 3]);
  assert.deepEqual(filterMessages(msgs, "received", ctx).map((m) => m.seq), [1]);
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
  const d = normalizeDeal(conv(), { meId: ME, legacyOrder: { kind: "rental", status: "pending", derivedState: "approvable" } });
  assert.equal(d.stage, "applied");
  assert.equal(nextActions(d).some((a) => a.key === "approve"), false, "구매자에게는 승인 버튼이 없다");
});

test("메시지함 정렬(sortInboxDeals): 확인 필요 여부와 무관하게 최근 대화순으로 정렬한다", () => {
  const deals = [
    normalizeDeal(conv({ id: "older-alert", updatedAt: "2026-11-18T00:00:00Z", stage: "negotiating", negotiation: { currentOffer: { id: "o1", termsVersion: 1, fromRole: "owner", amount: 90000, status: "open" } } }), { meId: ME }),
    normalizeDeal(conv({ id: "newest", updatedAt: "2026-11-18T03:00:00Z" }), { meId: ME }),
    normalizeDeal(conv({ id: "middle", updatedAt: "2026-11-18T01:30:00Z", unreadCount: 1 }), { meId: ME }),
  ];
  assert.deepEqual(sortInboxDeals(deals).map((d) => d.id), ["newest", "middle", "older-alert"]);
});
