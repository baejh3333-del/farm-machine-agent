// 거래 관리(채팅 밖) 화면용 순수 뷰 모델.
// 서버 대화 DTO(worker1 계약 v2 + worker2 협상 v3)를 화면에서 쓰는 형태로 정규화한다.
// DOM·네트워크에 의존하지 않으므로 node:test에서 바로 검증한다.

export const STAGE_ORDER_RENT = ["inquiry", "negotiating", "agreed", "applied", "confirmed", "active", "completed"];
export const STAGE_ORDER_SALE = ["inquiry", "negotiating", "agreed", "applied", "confirmed", "completed"];

export const STAGE_LABEL = {
  inquiry: "문의",
  checking: "조건 확인",
  negotiating: "협상",
  agreed: "합의",
  applied: "신청 · 승인 대기",
  confirmed: "확정",
  active: "대여 중",
  completed: "완료",
  rejected: "거절됨",
  cancelled: "취소됨",
};

export const STAGE_SHORT_LABEL = {
  inquiry: "문의",
  checking: "조건 확인",
  negotiating: "협상",
  agreed: "합의",
  applied: "신청",
  confirmed: "확정",
  active: "대여 중",
  completed: "완료",
  rejected: "거절",
  cancelled: "취소",
};

const ORDER_STATUS_TO_STAGE = {
  pending: "applied",
  requested: "applied",
  approved: "confirmed",
  confirmed: "confirmed",
  // 'completed'/'done'은 서버가 인도·반납을 명시적으로 기록한 경우에만 온다.
  completed: "completed",
  done: "completed",
  rejected: "rejected",
  cancelled: "cancelled",
};

export function roleOf(conv, meId) {
  if (!conv) return null;
  if (conv.myRole === "buyer" || conv.myRole === "owner") return conv.myRole;
  if (meId && conv.buyerId === meId) return "buyer";
  if (meId && conv.ownerId === meId) return "owner";
  return null;
}

/** 역할 칩 문구: 대여/판매에 따라 정확한 관계를 쓴다. */
export function roleLabel(role, listingType) {
  const rent = listingType !== "sale";
  if (role === "buyer") return rent ? "빌리는 쪽" : "사는 쪽";
  if (role === "owner") return rent ? "빌려주는 쪽" : "파는 쪽";
  return "참여자";
}

export function counterpartLabel(role, listingType) {
  const rent = listingType !== "sale";
  if (role === "buyer") return rent ? "빌려주는 분" : "판매자";
  if (role === "owner") return rent ? "빌리는 분" : "구매자";
  return "상대";
}

/**
 * 메시지 발신 주체: me_human | other_human | system
 */
export function senderState(msg, { meId, myRole } = {}) {
  if (!msg) return null;
  if (msg.senderKind === "system" || msg.senderRole === "system") return "system";
  let mine;
  if (msg.senderRole === "buyer" || msg.senderRole === "owner") {
    mine = myRole ? msg.senderRole === myRole : msg.senderId === meId;
  } else {
    mine = Boolean(meId) && msg.senderId === meId;
  }
  return mine ? "me_human" : "other_human";
}

export const SENDER_LABEL = {
  me_human: "내가 보냄",
  other_human: "상대가 보냄",
  system: "시스템 안내",
};

export const SENDER_ICON = {
  me_human: "🙋",
  other_human: "💬",
  system: "ℹ️",
};

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** worker2 v3 명명을 기준으로, 이전 초안 명명(version/byRole/amountBasis/buyerTotal)도 받아 준다. */
export function normalizeOffer(raw) {
  if (!raw || typeof raw !== "object") return null;
  const amountUnit = raw.amountUnit || raw.amountBasis || "total";
  const status = raw.status === "agreed" ? "accepted" : (raw.status || "open");
  return {
    id: raw.id != null ? String(raw.id) : null,
    termsVersion: finiteOrNull(raw.termsVersion ?? raw.version) ?? 0,
    fromRole: raw.fromRole || raw.byRole || null,
    senderKind: raw.senderKind || raw.source || "human",
    listingType: raw.listingType || null,
    amount: finiteOrNull(raw.amount ?? raw.unitPrice),
    amountUnit: amountUnit === "daily" ? "daily" : "total",
    unitPrice: finiteOrNull(raw.unitPrice),
    days: finiteOrNull(raw.days),
    start: raw.start || null,
    end: raw.end || null,
    itemTotal: finiteOrNull(raw.itemTotal),
    transportFee: finiteOrNull(raw.transportFee),
    transportPayer: raw.transportPayer || null,
    totalAmount: finiteOrNull(raw.totalAmount ?? raw.buyerTotal),
    ownerNet: finiteOrNull(raw.ownerNet),
    termsComplete: raw.termsComplete !== undefined ? Boolean(raw.termsComplete) : finiteOrNull(raw.transportFee) !== null || raw.transportPayer === "none",
    note: raw.note || "",
    status,
    acceptedByBuyer: Boolean(raw.acceptedByBuyer ?? raw.buyerAcceptedAt),
    acceptedByOwner: Boolean(raw.acceptedByOwner ?? raw.ownerAcceptedAt),
    createdAt: raw.createdAt || null,
  };
}

export function formatWon(value) {
  const n = finiteOrNull(value);
  if (n === null) return "미정";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** "일 8만원 × 3일 = 24만원 · 운송비 미정" 같은 한 줄 요약 */
export function describeOffer(offer) {
  if (!offer) return "";
  const parts = [];
  if (offer.amountUnit === "daily") {
    const days = offer.days ? ` × ${offer.days}일` : "";
    parts.push(`일 ${formatWon(offer.amount)}${days}${offer.itemTotal != null ? ` = ${formatWon(offer.itemTotal)}` : ""}`);
  } else {
    parts.push(`총 ${formatWon(offer.itemTotal ?? offer.amount)}`);
  }
  if (offer.transportPayer === "none") parts.push("운송비 없음(직접 인수)");
  else if (offer.transportFee === null) parts.push("운송비 미정");
  else parts.push(`운송비 ${formatWon(offer.transportFee)}${offer.transportPayer === "owner" ? "(판매자 부담)" : offer.transportPayer === "buyer" ? "(구매자 부담)" : ""}`);
  if (offer.start) parts.push(offer.end && offer.end !== offer.start ? `${offer.start}~${offer.end}` : offer.start);
  return parts.join(" · ");
}

export function offerAcceptedBy(offer, role) {
  if (!offer) return false;
  return role === "buyer" ? offer.acceptedByBuyer : offer.acceptedByOwner;
}

/**
 * 표시 단계. 서버(stage) 우선, 주문 상태로 대여 중/완료를 보강.
 * 서버 stage가 없을 때만(구버전 응답) 주문으로 임시 추정한다.
 */
export function deriveStage(conv, { order = null } = {}) {
  const linked = order || conv?.order || null;
  let stage = conv?.stage || null;
  // 날짜 경과로 '대여 중/완료'를 만들지 않는다: 서버의 원래 status만 단계 근거로 쓴다.
  // (rentals.js의 derivedState는 오늘 날짜로 upcoming/active/completed를 계산한다.)
  const orderStage = linked ? ORDER_STATUS_TO_STAGE[linked.status] : null;
  if (!stage) stage = orderStage || "inquiry";
  if ((stage === "confirmed" || stage === "applied") && (orderStage === "active" || orderStage === "completed")) stage = orderStage;
  if (stage === "active" && conv?.listingType === "sale") stage = "confirmed";
  return stage;
}

export function stageSteps(stage, listingType) {
  const order = listingType === "sale" ? STAGE_ORDER_SALE : STAGE_ORDER_RENT;
  const idx = order.indexOf(stage);
  return order.map((key, i) => ({
    key,
    label: STAGE_SHORT_LABEL[key],
    state: idx === -1 ? "todo" : i < idx ? "done" : i === idx ? "current" : "todo",
  }));
}

/** 거래 카드/상세용 정규화 */
export function normalizeDeal(conv, { meId = null, legacyOrder = null } = {}) {
  const myRole = roleOf(conv, meId);
  const listingType = conv.listingType === "sale" ? "sale" : "rent";
  const order = conv.order || legacyOrder || null;
  const stage = deriveStage(conv, { order });
  const neg = conv.negotiation || {};
  const currentOffer = normalizeOffer(neg.currentOffer);
  const agreed = normalizeOffer(neg.agreed) || (currentOffer?.status === "accepted" ? currentOffer : null);
  const offers = Array.isArray(neg.offers) ? neg.offers.map(normalizeOffer).filter(Boolean) : [];
  const lastMessage = conv.lastMessage || null;
  const lastSender = senderState(lastMessage, { meId, myRole });
  const unreadCount = Number.isFinite(Number(conv.unreadCount)) ? Number(conv.unreadCount) : null;
  const counterpartName = myRole === "buyer" ? conv.ownerName : conv.buyerName;

  const deal = {
    id: String(conv.id),
    listingId: conv.listingId,
    listingTitle: conv.listingTitle || "농기계",
    listingType,
    listingStatus: conv.listingStatus || null,
    myRole,
    roleLabel: roleLabel(myRole, listingType),
    counterpartRoleLabel: counterpartLabel(myRole, listingType),
    counterpartName: counterpartName || "상대 농가",
    stage,
    stageLabel: STAGE_LABEL[stage] || stage,
    termsVersion: finiteOrNull(neg.termsVersion) ?? currentOffer?.termsVersion ?? 0,
    currentOffer,
    agreed,
    offers,
    order,
    lastMessage,
    lastSender,
    lastSeq: Number(conv.lastSeq) || 0,
    myLastReadSeq: finiteOrNull(conv.myLastReadSeq),
    unreadCount,
    unreadSupported: unreadCount !== null,
    updatedAt: conv.updatedAt || lastMessage?.createdAt || conv.createdAt || null,
  };
  deal.nextActions = nextActions(deal);
  deal.needsAttention = deal.nextActions.some((a) => a.attention);
  return deal;
}

/** 다음 할 일. attention=true 이면 '내 확인 필요'에 들어간다. */
export function nextActions(deal) {
  const actions = [];
  const { currentOffer, agreed, order, myRole } = deal;
  if (
    currentOffer && currentOffer.status === "open" &&
    currentOffer.fromRole && currentOffer.fromRole !== myRole &&
    !offerAcceptedBy(currentOffer, myRole)
  ) {
    actions.push({ key: "respond_offer", attention: true, label: `상대 제안 응답 · ${describeOffer(currentOffer)}` });
  }
  if (agreed && myRole === "buyer" && !order && deal.stage === "agreed") {
    actions.push({
      key: "apply",
      attention: true,
      label: agreed.termsComplete ? "합의 조건으로 신청하기" : "운송비 등 미확정 조건 정리 필요",
    });
  }
  if (
    myRole === "owner" && order &&
    (order.canApprove === true || (order.status === "pending" && !["expired", "conflict", "operator_conflict"].includes(order.derivedState)))
  ) {
    // 대여 신청은 승인/거절 API가 있다. 구매 신청 승인 API는 아직 없으므로 승인 버튼을 약속하지 않는다.
    if (order.kind === "purchase") actions.push({ key: "purchase_received", attention: true, label: "구매 신청 도착 · 대화로 인수 일정 확인" });
    else actions.push({ key: "approve", attention: true, label: "대여 신청 승인/거절" });
  }
  return actions;
}

export const DEAL_FILTERS = [
  { key: "all", label: "전체" },
  { key: "buyer", label: "구매·빌리기" },
  { key: "owner", label: "판매·빌려주기" },
  { key: "attention", label: "내 확인 필요" },
  { key: "unread", label: "안 읽음" },
];

export function matchesFilter(deal, filter) {
  switch (filter) {
    case "buyer": return deal.myRole === "buyer";
    case "owner": return deal.myRole === "owner";
    case "attention": return deal.needsAttention;
    case "unread": return (deal.unreadCount || 0) > 0;
    default: return true;
  }
}

export function filterCounts(deals) {
  const counts = {};
  for (const f of DEAL_FILTERS) counts[f.key] = deals.filter((d) => matchesFilter(d, f.key)).length;
  return counts;
}

/** 확인 필요 먼저, 그다음 최근 활동순 */
export function sortDeals(deals) {
  return [...deals].sort((a, b) => {
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

/** 상단 '거래 관리' 배지 */
export function dealsBadge(deals) {
  const attention = deals.filter((d) => d.needsAttention).length;
  const unread = deals.reduce((sum, d) => sum + (d.unreadCount || 0), 0);
  return { attention, unread };
}

/** 메시지 목록 탭 필터: all | sent | received */
export function filterMessages(messages, tab, ctx) {
  if (tab === "all" || !tab) return messages;
  return messages.filter((m) => {
    const s = senderState(m, ctx);
    if (tab === "sent") return s === "me_human";
    if (tab === "received") return s === "other_human";
    return false;
  });
}

/** 읽음 처리할 seq: 화면에 실제로 그린 상대·시스템 메시지 중 최대 seq. 내 메시지만 있으면 null. */
export function readSeqFor(messages, ctx, currentReadSeq = 0) {
  let max = null;
  for (const m of messages) {
    const s = senderState(m, ctx);
    if (s === "me_human") continue;
    const seq = Number(m.seq);
    if (Number.isFinite(seq) && (max === null || seq > max)) max = seq;
  }
  if (max === null || max <= (Number(currentReadSeq) || 0)) return null;
  return max;
}

/** 제안 폼 → submit_offer 본문(양측 명명 별칭 포함) */
export function buildOfferBody({ conversationId, amount, amountUnit, start, end, days, transportFee, transportPayer, note, baseTermsVersion }) {
  const n = Number(String(amount ?? "").replace(/[,\s원]/g, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error("제안 금액을 입력해 주세요.");
  const feeRaw = transportFee === null || transportFee === undefined || String(transportFee).trim() === "" ? null : Number(String(transportFee).replace(/[,\s원]/g, ""));
  const terms = {
    amount: Math.round(n),
    amountUnit: amountUnit === "daily" ? "daily" : "total",
    amountBasis: amountUnit === "daily" ? "daily" : "total",
    start: start || null,
    end: end || start || null,
    days: Number.isFinite(Number(days)) && Number(days) > 0 ? Math.trunc(Number(days)) : null,
    transportFee: transportPayer === "none" ? 0 : (Number.isFinite(feeRaw) ? Math.round(feeRaw) : null),
    transportPayer: ["buyer", "owner", "none"].includes(transportPayer) ? transportPayer : null,
    note: String(note || "").slice(0, 200),
  };
  return {
    action: "submit_offer",
    conversationId,
    terms,
    offer: terms,
    baseTermsVersion: Number(baseTermsVersion) || 0,
  };
}

export function rentalDays(start, end) {
  if (!start) return null;
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end || start}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return Math.round((e - s) / 86400000) + 1;
}

export function parseDealsHash(hash) {
  const h = String(hash || "").replace(/^#/, "");
  const m = h.match(/^\/deals(?:\/([^?]+))?(?:\?(.*))?$/);
  if (!m) return null;
  const params = new URLSearchParams(m[2] || "");
  return {
    conversationId: m[1] ? decodeURIComponent(m[1]) : null,
    filter: params.get("filter") || null,
  };
}

export function dealsHash({ conversationId = null, filter = null } = {}) {
  let h = "#/deals";
  if (conversationId) h += `/${encodeURIComponent(conversationId)}`;
  if (filter && filter !== "all") h += `?filter=${encodeURIComponent(filter)}`;
  return h;
}
