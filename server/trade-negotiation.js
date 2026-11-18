// 구조화된 거래 조건(제안) 버전·양측 수락·합의 기반 신청.
// - 역할은 항상 서버가 대화방 참여 관계(conversations.buyer_id / listings.owner_id)로 결정한다.
// - 같은 terms_version에 구매자·판매자 수락이 모두 기록되어야 합의(status = 'accepted')다.
// - 운송비가 미정이면 조건 미완성이며 수락·신청할 수 없다. 명시적 직접 인수('none')만 0원이다.
// - 신청은 구매자 본인 또는 신청 권한을 받은 구매자 AI만 만들 수 있고, 저장 금액은 합의 금액이다.
// - 비공개 한도(목표가·최대 예산·최저가)는 본인 역할 평가에만 쓰이며 DTO에 원값을 싣지 않는다.
import { randomUUID } from "node:crypto";
import { getPool, kstToday, withTransaction } from "./db.js";
import { fail, HttpError } from "./http.js";
import { MAX_RENTAL_DAYS } from "./rentals.js";
import { formatIsoDate } from "./validate.js";

const ROLES = new Set(["buyer", "owner"]);
const SENDER_KINDS = new Set(["human", "ai_proxy"]);
const TRANSPORT_PAYERS = new Set(["buyer", "owner", "none"]);
const OPEN_ORDER_STATUSES = new Set(["pending", "approved", "accepted"]);
export const DEFAULT_MAX_AI_ROUNDS = 3;

// ───────────────────────── 공용 유틸 ─────────────────────────

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

export function inclusiveDays(start, end) {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  return Math.floor((e - s) / 86_400_000) + 1;
}

function toIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined; // undefined = 잘못된 값
  return Math.trunc(n);
}

function roleOfUser(conv, userId) {
  if (!userId) return null;
  if (conv.buyer_id === userId) return "buyer";
  if (conv.owner_id === userId) return "owner";
  return null;
}

function pick(...values) {
  for (const v of values) if (v !== undefined) return v;
  return undefined;
}

function roundingUnit(listingType) {
  return listingType === "sale" ? 10_000 : 1_000;
}

// ───────────────────────── 금액 계산 ─────────────────────────

/** 제안 행(또는 같은 형태의 객체)으로 운송비 포함 총액과 판매자 순수령액을 계산한다. 미정이면 null. */
export function computeOfferTotals({ item_total, transport_fee, transport_payer }) {
  const itemTotal = Number(item_total);
  const payer = transport_payer ?? null;
  const fee = transport_fee === null || transport_fee === undefined ? null : Number(transport_fee);
  const termsComplete = payer === "none" || ((payer === "buyer" || payer === "owner") && fee !== null);
  if (!termsComplete) {
    return { termsComplete: false, totalAmount: null, ownerNet: null };
  }
  return {
    termsComplete: true,
    totalAmount: itemTotal + (payer === "buyer" ? fee : 0),
    ownerNet: itemTotal - (payer === "owner" ? fee : 0),
  };
}

/**
 * 클라이언트·AI 입력을 검증된 조건으로 정규화한다.
 * amountUnit 'daily'는 대여만 허용되며 itemTotal = amount × days.
 */
export function normalizeOfferTerms(input, listing) {
  const raw = input && typeof input === "object" ? input : {};
  const listingType = listing.type === "sale" ? "sale" : "rent";
  const amount = toIntOrNull(raw.amount);
  if (amount === null || amount === undefined) {
    fail(400, "OFFER_TERMS_INVALID", "제안 금액을 0원 이상 정수로 입력해 주세요.");
  }
  const unitRaw = pick(raw.amountUnit, raw.amountBasis) ?? "total";
  if (unitRaw !== "total" && unitRaw !== "daily") {
    fail(400, "OFFER_TERMS_INVALID", "금액 단위는 total 또는 daily만 가능합니다.");
  }
  if (unitRaw === "daily" && listingType !== "rent") {
    fail(400, "OFFER_TERMS_INVALID", "판매 매물은 총액으로만 제안할 수 있습니다.");
  }

  let start = null;
  let end = null;
  let days = null;
  if (listingType === "rent") {
    start = parseIsoDate(raw.start);
    end = parseIsoDate(raw.end ?? raw.start);
    if (!start || !end) {
      fail(400, "OFFER_TERMS_INVALID", "대여 제안에는 시작일과 반납일(YYYY-MM-DD)이 필요합니다.");
    }
    if (end < start) fail(400, "OFFER_TERMS_INVALID", "반납일은 시작일보다 빠를 수 없습니다.");
    days = inclusiveDays(start, end);
    if (days > MAX_RENTAL_DAYS) {
      fail(400, "OFFER_TERMS_INVALID", `대여 기간은 최대 ${MAX_RENTAL_DAYS}일까지 제안할 수 있습니다.`);
    }
    if (raw.days !== undefined && raw.days !== null && raw.days !== "" && Number(raw.days) !== days) {
      fail(400, "OFFER_TERMS_INVALID", "대여 일수가 시작일·반납일과 일치하지 않습니다.");
    }
  }

  const payerRaw = raw.transportPayer ?? null;
  if (payerRaw !== null && !TRANSPORT_PAYERS.has(payerRaw)) {
    fail(400, "OFFER_TERMS_INVALID", "운송비 부담은 buyer·owner·none 중 하나이거나 미정이어야 합니다.");
  }
  let transportFee = toIntOrNull(raw.transportFee);
  if (transportFee === undefined) {
    fail(400, "OFFER_TERMS_INVALID", "운송비는 0원 이상 정수이거나 미정이어야 합니다.");
  }
  if (payerRaw === "none") {
    if (transportFee !== null && transportFee !== 0) {
      fail(400, "OFFER_TERMS_INVALID", "직접 인수(운송 없음)에는 운송비를 붙일 수 없습니다.");
    }
    transportFee = 0;
  }
  if (payerRaw === null && transportFee !== null) {
    fail(400, "OFFER_TERMS_INVALID", "운송비를 적으려면 누가 부담하는지 정해 주세요.");
  }

  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 300) : "";
  const itemTotal = unitRaw === "daily" ? amount * days : amount;
  if (!Number.isSafeInteger(itemTotal) || itemTotal > 2_000_000_000) {
    fail(400, "OFFER_TERMS_INVALID", "제안 금액이 너무 큽니다.");
  }
  return {
    listingType,
    amount,
    amountUnit: unitRaw,
    start,
    end,
    days,
    itemTotal,
    transportFee,
    transportPayer: payerRaw,
    note,
  };
}

// ───────────────────────── DTO ─────────────────────────

/** 양측에 공개 가능한 제안 DTO(정규 이름 + 호환 별칭). 비공개 한도·평가 없음. */
export function toOfferDto(row) {
  if (!row) return null;
  const totals = computeOfferTotals(row);
  const days = row.days != null ? Number(row.days) : null;
  const itemTotal = Number(row.item_total);
  const unitPrice = row.listing_type === "rent" && days ? Math.round(itemTotal / days) : itemTotal;
  const buyerAcceptedAt = toIso(row.buyer_accepted_at);
  const ownerAcceptedAt = toIso(row.owner_accepted_at);
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    termsVersion: Number(row.terms_version),
    fromRole: row.from_role,
    senderKind: row.sender_kind,
    listingType: row.listing_type,
    amount: Number(row.amount),
    amountUnit: row.amount_unit,
    unitPrice,
    days,
    start: row.start_date ? formatIsoDate(row.start_date) : null,
    end: row.end_date ? formatIsoDate(row.end_date) : null,
    itemTotal,
    transportFee: row.transport_fee === null || row.transport_fee === undefined ? null : Number(row.transport_fee),
    transportPayer: row.transport_payer ?? null,
    totalAmount: totals.totalAmount,
    ownerNet: totals.ownerNet,
    termsComplete: totals.termsComplete,
    note: row.note ?? "",
    status: row.status,
    acceptedByBuyer: Boolean(buyerAcceptedAt),
    acceptedByOwner: Boolean(ownerAcceptedAt),
    buyerAcceptedAt,
    ownerAcceptedAt,
    buyerAcceptedBy: row.buyer_accepted_kind ?? null,
    ownerAcceptedBy: row.owner_accepted_kind ?? null,
    messageId: row.message_id ? String(row.message_id) : null,
    createdAt: toIso(row.created_at),
    // 호환 별칭 (worker 간 초기 계약 이름)
    version: Number(row.terms_version),
    byRole: row.from_role,
    source: row.sender_kind,
    amountBasis: row.amount_unit,
    buyerTotal: totals.totalAmount,
  };
}

function toOrderDto(row, kind, { legacy = false } = {}) {
  if (!row) return null;
  return {
    kind,
    id: String(row.id),
    status: row.status,
    totalPrice: Number(kind === "rental" ? row.total_price : row.price),
    transportFee: row.transport_fee === null || row.transport_fee === undefined ? null : Number(row.transport_fee),
    transportPayer: row.transport_payer ?? null,
    offerId: row.offer_id ? String(row.offer_id) : null,
    createdVia: row.created_via ?? null,
    start: kind === "rental" && row.start_date ? formatIsoDate(row.start_date) : null,
    end: kind === "rental" && row.end_date ? formatIsoDate(row.end_date) : null,
    days: kind === "rental" && row.days != null ? Number(row.days) : null,
    legacy,
    createdAt: toIso(row.created_at),
  };
}

// ───────────────────────── 정책 평가 (본인 역할 전용) ─────────────────────────

function policyNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** 정책 한도를 이 제안의 총액 기준으로 환산한다(budgetUnit 'daily'는 대여 일수를 곱함). */
export function resolvePolicyLimits(policy, role, { listingType, days }) {
  const p = policy && typeof policy === "object" ? policy : {};
  const daily = p.budgetUnit === "daily" && listingType === "rent" && days > 0;
  const scale = (v) => (v === null ? null : daily ? v * days : v);
  const target = scale(policyNumber(p.targetPrice));
  const hard = scale(policyNumber(role === "buyer" ? p.maxBudget : p.minPrice));
  return { target, hard };
}

function roundTowards(value, unit, direction) {
  return direction === "down" ? Math.floor(value / unit) * unit : Math.ceil(value / unit) * unit;
}

/**
 * 본인 역할의 정책으로 제안을 평가한다. 결과는 본인에게만 노출하며 한도 원값을 포함하지 않는다.
 * verdict:
 *  - accept_ok: 목표가 이내(또는 목표가 없이 한도 이내) → 수락 가능
 *  - counter_in_range: 한도 이내지만 목표가보다 불리 → 역제안 권장(라운드 소진 시 수락 가능)
 *  - outside_limit: 한도 밖 → 수락 불가
 *  - needs_user: 운송비 미정·한도 미설정 등 사용자 판단 필요
 */
export function evaluateOfferForRole(offer, role, policy, { roundsUsed = 0, maxRounds } = {}) {
  if (!offer || !ROLES.has(role)) return null;
  const p = policy && typeof policy === "object" ? policy : {};
  const limitRounds = Number(p.maxNegotiationRounds) > 0
    ? Math.min(10, Math.trunc(Number(p.maxNegotiationRounds)))
    : (maxRounds ?? DEFAULT_MAX_AI_ROUNDS);
  const roundsLeft = Math.max(0, limitRounds - roundsUsed);
  const base = { verdict: "needs_user", counterSuggestion: null, reasons: [], roundsUsed, roundsLeft };
  const { target, hard } = resolvePolicyLimits(p, role, { listingType: offer.listingType, days: offer.days });

  if (!offer.termsComplete) {
    return { ...base, reasons: ["transport_unknown"] };
  }
  if (target === null && hard === null) {
    return { ...base, reasons: ["no_price_policy"] };
  }

  const unit = roundingUnit(offer.listingType);
  if (role === "buyer") {
    const cost = offer.totalAmount;
    const transportOnBuyer = offer.transportPayer === "buyer" ? offer.transportFee : 0;
    const suggestTotal = (() => {
      const goal = target ?? hard;
      if (cost <= goal) return null;
      let mid = roundTowards((goal + cost) / 2, unit, "down");
      if (mid < goal) mid = goal;
      if (hard !== null && mid > hard) mid = hard;
      return mid >= cost ? null : mid;
    })();
    const counterSuggestion = suggestTotal === null
      ? null
      : {
          amount: Math.max(0, suggestTotal - transportOnBuyer),
          amountUnit: "total",
          totalAmount: suggestTotal,
          transportFee: offer.transportFee,
          transportPayer: offer.transportPayer,
        };
    if (hard !== null && cost > hard) {
      return { ...base, verdict: "outside_limit", reasons: ["above_buyer_limit"], counterSuggestion };
    }
    if (target !== null && cost <= target) return { ...base, verdict: "accept_ok", reasons: ["within_target"] };
    if (target === null) return { ...base, verdict: "accept_ok", reasons: ["within_limit"] };
    if (hard === null) {
      return { ...base, verdict: "needs_user", reasons: ["above_target_no_limit"], counterSuggestion };
    }
    return { ...base, verdict: "counter_in_range", reasons: ["above_target_within_limit"], counterSuggestion };
  }

  // owner
  const net = offer.ownerNet;
  const transportOnOwner = offer.transportPayer === "owner" ? offer.transportFee : 0;
  const suggestNet = (() => {
    const goal = target ?? hard;
    if (net >= goal) return null;
    let mid = roundTowards((goal + net) / 2, unit, "up");
    if (mid > goal) mid = goal;
    if (hard !== null && mid < hard) mid = hard;
    return mid <= net ? null : mid;
  })();
  const counterSuggestion = suggestNet === null
    ? null
    : {
        amount: suggestNet + transportOnOwner,
        amountUnit: "total",
        ownerNet: suggestNet,
        transportFee: offer.transportFee,
        transportPayer: offer.transportPayer,
      };
  if (hard !== null && net < hard) {
    return { ...base, verdict: "outside_limit", reasons: ["below_owner_floor"], counterSuggestion };
  }
  if (target !== null && net >= target) return { ...base, verdict: "accept_ok", reasons: ["within_target"] };
  if (target === null) return { ...base, verdict: "accept_ok", reasons: ["within_limit"] };
  if (hard === null) {
    return { ...base, verdict: "needs_user", reasons: ["below_target_no_floor"], counterSuggestion };
  }
  return { ...base, verdict: "counter_in_range", reasons: ["below_target_within_floor"], counterSuggestion };
}

/** 비공개 한도 원값 목록(누설 검사용, 본인 서버 측에서만 사용). */
export function privateLimitValues(policy, role, { listingType, days } = {}) {
  const p = policy && typeof policy === "object" ? policy : {};
  const values = new Set();
  for (const key of ["targetPrice", role === "buyer" ? "maxBudget" : "minPrice"]) {
    const v = policyNumber(p[key]);
    if (v === null || v === 0) continue;
    values.add(v);
    if (listingType === "rent" && days > 0 && p.budgetUnit === "daily") values.add(v * days);
  }
  return values;
}

/** 사용자 정책이 AI의 조건 수락(합의)을 명시적으로 허용하는지. */
export function aiMayAgree(policy) {
  const p = policy && typeof policy === "object" ? policy : {};
  return p.fullDelegation === true || p.autoAcceptWithinLimits === true;
}

/** 구매자 정책이 AI의 신청 자동 접수를 명시적으로 허용하는지. */
export function aiMayApply(policy) {
  const p = policy && typeof policy === "object" ? policy : {};
  return p.fullDelegation === true && p.autoExecuteTransaction === true;
}

// ───────────────────────── 조회 ─────────────────────────

const CONV_SELECT = `
  SELECT c.*, l.owner_id, l.type AS listing_type, l.status AS listing_status,
         l.price AS listing_price, l.title AS listing_title
  FROM conversations c
  JOIN listings l ON l.id = c.listing_id`;

async function loadConversation(db, conversationId, { lock = false } = {}) {
  const res = await db.query(
    `${CONV_SELECT} WHERE c.id = $1 ${lock ? "FOR UPDATE OF c" : "LIMIT 1"}`,
    [conversationId]
  );
  return res.rows[0] || null;
}

async function resolveContext(db, args, { lock }) {
  const conversationId = args.conv?.id ?? args.conversationId;
  if (!conversationId) fail(400, "INVALID_TARGET", "대화방을 지정해 주세요.");
  // 호출자가 이미 잠근 행을 넘겨도, 금액 판단에 필요한 최신 값은 여기서 다시 읽는다(같은 트랜잭션).
  const conv = await loadConversation(db, String(conversationId), { lock });
  if (!conv) fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
  const role = roleOfUser(conv, args.actorUserId ?? args.viewerUserId);
  if (!role) fail(403, "FORBIDDEN", "이 대화의 거래 조건에 접근할 권한이 없습니다.");
  if (args.actorRole && args.actorRole !== role) {
    fail(403, "ROLE_MISMATCH", "요청한 역할이 대화 참여 관계와 일치하지 않습니다.");
  }
  const senderKind = pick(args.senderKind, args.source) ?? "human";
  if (!SENDER_KINDS.has(senderKind)) fail(400, "INVALID_SENDER_KIND", "올바르지 않은 발신 주체입니다.");
  return { conv, role, senderKind };
}

async function loadOfferRows(db, conversationId, limit = 10) {
  const res = await db.query(
    `SELECT * FROM trade_offers WHERE conversation_id = $1 ORDER BY terms_version DESC LIMIT $2`,
    [conversationId, limit]
  );
  return res.rows;
}

async function latestVersion(db, conversationId) {
  const res = await db.query(
    `SELECT COALESCE(MAX(terms_version), 0) AS v FROM trade_offers WHERE conversation_id = $1`,
    [conversationId]
  );
  return Number(res.rows[0].v);
}

async function countAiRounds(db, conversationId, role) {
  const res = await db.query(
    `SELECT COUNT(*)::int AS n FROM trade_offers
     WHERE conversation_id = $1 AND from_role = $2 AND sender_kind = 'ai_proxy'`,
    [conversationId, role]
  );
  return Number(res.rows[0].n);
}

/** 합의에 명시적으로 연결된 신청(우선) → 없으면 표시용 레거시 역조회. */
async function loadLinkedOrder(db, conv) {
  const listingType = conv.listing_type;
  if (listingType === "rent") {
    const linked = await db.query(
      `SELECT * FROM rental_requests WHERE conversation_id = $1 AND offer_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [conv.id]
    );
    if (linked.rows.length) return toOrderDto(linked.rows[0], "rental");
    const legacy = await db.query(
      `SELECT * FROM rental_requests WHERE listing_id = $1 AND requester_id = $2 AND offer_id IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [conv.listing_id, conv.buyer_id]
    );
    return legacy.rows.length ? toOrderDto(legacy.rows[0], "rental", { legacy: true }) : null;
  }
  const linked = await db.query(
    `SELECT * FROM purchase_orders WHERE conversation_id = $1 AND offer_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [conv.id]
  );
  if (linked.rows.length) return toOrderDto(linked.rows[0], "purchase");
  const legacy = await db.query(
    `SELECT * FROM purchase_orders WHERE listing_id = $1 AND buyer_id = $2 AND offer_id IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [conv.listing_id, conv.buyer_id]
  );
  return legacy.rows.length ? toOrderDto(legacy.rows[0], "purchase", { legacy: true }) : null;
}

/** 진행 단계: 문의 → 협상 → 합의 → 신청(승인 대기) → 확정 / 거절 / 취소. 날짜 경과로 완료를 만들지 않는다. */
export function deriveTradeStage({ currentOffer, agreed, order }) {
  if (order && !order.legacy) {
    if (order.status === "pending") return "applied";
    if (order.status === "approved" || order.status === "accepted") return "confirmed";
    const linkedToCurrent = agreed && order.offerId === agreed.id;
    if (linkedToCurrent || !currentOffer) return order.status === "rejected" ? "rejected" : "cancelled";
  }
  if (order?.legacy && !currentOffer) {
    if (order.status === "pending") return "applied";
    if (order.status === "approved" || order.status === "accepted") return "confirmed";
    if (order.status === "rejected") return "rejected";
    if (order.status === "cancelled") return "cancelled";
  }
  if (agreed) return "agreed";
  if (currentOffer) return "negotiating";
  return "inquiry";
}

function policyForRole(conv, role) {
  const raw = role === "buyer" ? conv.buyer_ai_policy : conv.owner_ai_policy;
  return raw && typeof raw === "object" ? raw : {};
}

async function buildState(db, conv, role, { includeOffers = true } = {}) {
  const rows = await loadOfferRows(db, conv.id, includeOffers ? 10 : 3);
  const offers = rows.map(toOfferDto);
  const agreed = offers.find((o) => o.status === "accepted") || null;
  const open = offers.find((o) => o.status === "open") || null;
  const currentOffer = open || agreed || null;
  const order = await loadLinkedOrder(db, conv);
  let myEvaluation = null;
  if (open && role) {
    const roundsUsed = await countAiRounds(db, conv.id, role);
    myEvaluation = evaluateOfferForRole(open, role, policyForRole(conv, role), { roundsUsed });
  }
  const stage = deriveTradeStage({ currentOffer, agreed, order });
  const negotiation = {
    termsVersion: offers[0]?.termsVersion ?? 0,
    currentOffer,
    agreed,
    ...(includeOffers ? { offers: offers.slice().reverse() } : {}),
    linkedOrder: order,
    myEvaluation,
  };
  return { myRole: role, stage, negotiation, order, linkedOrder: order, myEvaluation };
}

function runInTx(opts, fn) {
  const client = opts?.client;
  if (client) return fn(client);
  return withTransaction(fn, opts?.pool || getPool());
}

function splitArgs(args, opts) {
  const a = args && typeof args === "object" ? args : {};
  const o = { ...(opts && typeof opts === "object" ? opts : {}) };
  if (!o.client && a.client) o.client = a.client;
  if (!o.pool && a.pool) o.pool = a.pool;
  return [a, o];
}

// ───────────────────────── 공개 API ─────────────────────────

/**
 * 새 조건 버전을 제안한다. 이전 열린 제안·미신청 합의는 superseded가 되고 제안자는 자동 수락한다.
 * AI 제안은 본인 정책의 한도 밖이면 거부한다(서버 방어선).
 */
export async function submitOffer(rawArgs = {}, rawOpts = {}) {
  const [args, opts] = splitArgs(rawArgs, rawOpts);
  return runInTx(opts, async (db) => {
    const { conv, role, senderKind } = await resolveContext(db, args, { lock: true });
    if (conv.listing_status !== "open") {
      fail(409, "LISTING_NOT_OPEN", "지금은 거래 조건을 제안할 수 없는 매물입니다.");
    }
    const terms = normalizeOfferTerms(pick(args.terms, args.offer), {
      type: conv.listing_type,
      price: conv.listing_price,
    });

    const order = await loadLinkedOrder(db, conv);
    if (order && !order.legacy && OPEN_ORDER_STATUSES.has(order.status)) {
      fail(409, "ORDER_ALREADY_ACTIVE", "이미 합의 조건으로 신청이 진행 중이라 조건을 바꿀 수 없습니다.");
    }

    const latest = await latestVersion(db, conv.id);
    const base = pick(args.baseTermsVersion);
    if (base !== undefined && base !== null && Number(base) !== latest) {
      fail(409, "OFFER_VERSION_STALE", "그사이 거래 조건이 바뀌었습니다. 최신 조건을 확인해 주세요.");
    }

    if (senderKind === "ai_proxy") {
      const totals = computeOfferTotals({
        item_total: terms.itemTotal,
        transport_fee: terms.transportFee,
        transport_payer: terms.transportPayer,
      });
      const evaluation = evaluateOfferForRole(
        { ...terms, ...totals },
        role,
        policyForRole(conv, role)
      );
      if (evaluation?.verdict === "outside_limit") {
        fail(409, "OFFER_OUTSIDE_POLICY", "위임 범위를 벗어난 조건이라 농농이가 제안할 수 없습니다.");
      }
    }

    await db.query(
      `UPDATE trade_offers SET status = 'superseded', updated_at = now()
       WHERE conversation_id = $1 AND status IN ('open', 'accepted')`,
      [conv.id]
    );
    const id = randomUUID();
    const now = new Date().toISOString();
    const ins = await db.query(
      `INSERT INTO trade_offers (
         id, conversation_id, terms_version, from_role, sender_kind, created_by, listing_type,
         amount, amount_unit, start_date, end_date, days, item_total, transport_fee, transport_payer, note,
         status, buyer_accepted_at, buyer_accepted_kind, owner_accepted_at, owner_accepted_kind, message_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12,$13,$14,$15,$16,'open',$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        id, conv.id, latest + 1, role, senderKind, args.actorUserId, terms.listingType,
        terms.amount, terms.amountUnit, terms.start, terms.end, terms.days, terms.itemTotal,
        terms.transportFee, terms.transportPayer, terms.note,
        role === "buyer" ? now : null, role === "buyer" ? senderKind : null,
        role === "owner" ? now : null, role === "owner" ? senderKind : null,
        args.messageId ?? null,
      ]
    );
    await db.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conv.id]);
    const offer = toOfferDto(ins.rows[0]);
    const state = await buildState(db, conv, role);
    return { offer, role, negotiation: state.negotiation, stage: state.stage };
  });
}

/**
 * 최신 조건 버전에 본인 역할의 수락을 기록한다. 양측 수락이 모이면 합의(accepted)다.
 * 운송비 등 미정 조건이 있으면 수락할 수 없다. 합의만 하며 신청은 applyAgreedOffer가 별도로 만든다.
 */
export async function acceptOffer(rawArgs = {}, rawOpts = {}) {
  const [args, opts] = splitArgs(rawArgs, rawOpts);
  return runInTx(opts, async (db) => {
    const { conv, role, senderKind } = await resolveContext(db, args, { lock: true });
    const offerId = args.offerId;
    if (!offerId) fail(400, "OFFER_ID_REQUIRED", "수락할 제안을 지정해 주세요.");
    const res = await db.query(
      `SELECT * FROM trade_offers WHERE id = $1 AND conversation_id = $2 FOR UPDATE`,
      [String(offerId), conv.id]
    );
    const row = res.rows[0];
    if (!row) fail(404, "OFFER_NOT_FOUND", "제안을 찾을 수 없습니다.");
    const version = pick(args.termsVersion, args.version);
    if (version === undefined || version === null || Number(version) !== Number(row.terms_version)) {
      fail(409, "OFFER_VERSION_STALE", "수락하려는 조건 버전이 최신이 아닙니다.");
    }
    const mine = role === "buyer" ? row.buyer_accepted_at : row.owner_accepted_at;
    if (row.status === "accepted" && mine) {
      const state = await buildState(db, conv, role);
      return { offer: toOfferDto(row), agreed: true, order: null, idempotent: true, negotiation: state.negotiation, stage: state.stage };
    }
    if (row.status !== "open") fail(409, "OFFER_NOT_OPEN", "이미 바뀌었거나 종료된 제안입니다.");
    if (Number(row.terms_version) !== (await latestVersion(db, conv.id))) {
      fail(409, "OFFER_VERSION_STALE", "수락하려는 조건 버전이 최신이 아닙니다.");
    }
    const dto = toOfferDto(row);
    if (!dto.termsComplete) {
      fail(409, "TERMS_INCOMPLETE", "운송비 등 미정 조건이 있어 아직 합의할 수 없습니다.");
    }
    if (conv.listing_status !== "open") {
      fail(409, "LISTING_NOT_OPEN", "지금은 거래할 수 없는 매물입니다.");
    }
    if (senderKind === "ai_proxy") {
      const policy = policyForRole(conv, role);
      if (!aiMayAgree(policy)) {
        fail(403, "AI_AGREE_NOT_AUTHORIZED", "농농이에게 조건 수락 권한이 위임되지 않았습니다.");
      }
      const roundsUsed = await countAiRounds(db, conv.id, role);
      const evaluation = evaluateOfferForRole(dto, role, policy, { roundsUsed });
      const ok = evaluation.verdict === "accept_ok" ||
        (evaluation.verdict === "counter_in_range" && (evaluation.roundsLeft === 0 || policy.allowNegotiation !== true));
      if (!ok) fail(409, "OFFER_OUTSIDE_POLICY", "위임 범위 밖의 조건이라 농농이가 수락할 수 없습니다.");
    }
    if (mine) {
      const state = await buildState(db, conv, role);
      return { offer: dto, agreed: false, order: null, idempotent: true, negotiation: state.negotiation, stage: state.stage };
    }

    const col = role === "buyer" ? "buyer" : "owner";
    const upd = await db.query(
      `UPDATE trade_offers
       SET ${col}_accepted_at = now(), ${col}_accepted_kind = $2,
           status = CASE WHEN ${role === "buyer" ? "owner" : "buyer"}_accepted_at IS NOT NULL THEN 'accepted' ELSE status END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [row.id, senderKind]
    );
    await db.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conv.id]);
    const offer = toOfferDto(upd.rows[0]);
    const state = await buildState(db, conv, role);
    return { offer, agreed: offer.status === "accepted", order: null, negotiation: state.negotiation, stage: state.stage };
  });
}

/** 열린 제안을 거절(상대 제안) 또는 철회(내 제안)한다. */
export async function rejectOffer(rawArgs = {}, rawOpts = {}) {
  const [args, opts] = splitArgs(rawArgs, rawOpts);
  return runInTx(opts, async (db) => {
    const { conv, role } = await resolveContext(db, args, { lock: true });
    const res = await db.query(
      `SELECT * FROM trade_offers WHERE id = $1 AND conversation_id = $2 FOR UPDATE`,
      [String(args.offerId ?? ""), conv.id]
    );
    const row = res.rows[0];
    if (!row) fail(404, "OFFER_NOT_FOUND", "제안을 찾을 수 없습니다.");
    if (row.status !== "open") fail(409, "OFFER_NOT_OPEN", "이미 바뀌었거나 종료된 제안입니다.");
    const nextStatus = row.from_role === role ? "withdrawn" : "rejected";
    const upd = await db.query(
      `UPDATE trade_offers SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [row.id, nextStatus]
    );
    const state = await buildState(db, conv, role);
    return { offer: toOfferDto(upd.rows[0]), negotiation: state.negotiation, stage: state.stage };
  });
}

/**
 * 합의된 조건으로 신청서를 만든다. 구매자 본인 또는 신청 권한을 받은 구매자 AI만 가능.
 * 저장 금액 = 합의 금액(대여 총액 포함). 같은 합의로는 한 번만 생성된다(offer_id 유니크 + 대화방 잠금).
 */
export async function applyAgreedOffer(rawArgs = {}, rawOpts = {}) {
  const [args, opts] = splitArgs(rawArgs, rawOpts);
  const today = opts.today || kstToday();
  return runInTx(opts, async (db) => {
    const { conv, role, senderKind } = await resolveContext(db, args, { lock: true });
    if (role !== "buyer") {
      fail(403, "SELLER_CANNOT_APPLY", "판매자(빌려주는 분)는 구매자 명의로 신청할 수 없습니다.");
    }
    const res = args.offerId
      ? await db.query(`SELECT * FROM trade_offers WHERE id = $1 AND conversation_id = $2 FOR UPDATE`, [String(args.offerId), conv.id])
      : await db.query(`SELECT * FROM trade_offers WHERE conversation_id = $1 AND status = 'accepted' FOR UPDATE`, [conv.id]);
    const row = res.rows[0];
    if (!row) fail(404, "OFFER_NOT_FOUND", "합의된 조건을 찾을 수 없습니다.");

    const table = conv.listing_type === "rent" ? "rental_requests" : "purchase_orders";
    const kind = conv.listing_type === "rent" ? "rental" : "purchase";
    const existing = await db.query(`SELECT * FROM ${table} WHERE offer_id = $1 LIMIT 1`, [row.id]);
    if (existing.rows.length) {
      return { order: toOrderDto(existing.rows[0], kind), idempotent: true };
    }
    if (row.status !== "accepted") fail(409, "OFFER_NOT_AGREED", "양측이 같은 조건에 합의해야 신청할 수 있습니다.");
    const dto = toOfferDto(row);
    if (!dto.termsComplete) fail(409, "TERMS_INCOMPLETE", "운송비 등 미정 조건이 있어 신청할 수 없습니다.");

    const policy = policyForRole(conv, "buyer");
    if (senderKind === "ai_proxy") {
      if (conv.buyer_ai_mode !== "autonomous" || !aiMayApply(policy)) {
        fail(403, "AI_APPLY_NOT_AUTHORIZED", "농농이에게 신청 접수 권한이 위임되지 않았습니다.");
      }
      const evaluation = evaluateOfferForRole(dto, "buyer", policy, { roundsUsed: 0, maxRounds: 0 });
      if (!evaluation || evaluation.verdict === "outside_limit" || evaluation.verdict === "needs_user") {
        fail(409, "OFFER_OUTSIDE_POLICY", "합의 금액이 위임 범위를 벗어나 자동 신청하지 않았습니다.");
      }
    }

    const listingRes = await db.query(`SELECT * FROM listings WHERE id = $1 FOR UPDATE`, [conv.listing_id]);
    const listing = listingRes.rows[0];
    if (!listing || listing.status !== "open" || listing.type !== conv.listing_type) {
      fail(409, "LISTING_NOT_OPEN", "지금은 신청할 수 없는 매물입니다.");
    }
    if (listing.owner_id === conv.buyer_id) fail(403, "SELF_INQUIRY_FORBIDDEN", "본인 매물에는 신청할 수 없습니다.");
    const createdVia = senderKind === "ai_proxy" ? "buyer_ai" : "human";
    const note = (dto.note || (senderKind === "ai_proxy" ? "농농이가 합의 조건으로 접수한 신청입니다." : "합의 조건으로 접수한 신청입니다.")).slice(0, 500);

    if (kind === "rental") {
      if (dto.start < today) fail(409, "INVALID_SCHEDULE", "지난 날짜로는 대여 신청할 수 없습니다.");
      const overlap = await db.query(
        `SELECT 1 FROM rental_requests
         WHERE listing_id = $1 AND status = 'approved'
           AND NOT (end_date < $2::date OR start_date > $3::date) LIMIT 1`,
        [listing.id, dto.start, dto.end]
      );
      if (overlap.rows.length) fail(409, "SCHEDULE_CONFLICT", "합의한 기간이 이미 확정된 예약과 겹칩니다.");
      const ins = await db.query(
        `INSERT INTO rental_requests (
           id, listing_id, requester_id, start_date, end_date, note, daily_price, days, total_price, status,
           offer_id, conversation_id, list_daily_price, transport_fee, transport_payer, created_via
         ) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          randomUUID(), listing.id, conv.buyer_id, dto.start, dto.end, note,
          Math.round(dto.itemTotal / dto.days), dto.days, dto.itemTotal,
          row.id, conv.id, Number(listing.price), dto.transportFee, dto.transportPayer, createdVia,
        ]
      );
      return { order: toOrderDto(ins.rows[0], kind), idempotent: false };
    }

    const accepted = await db.query(
      `SELECT 1 FROM purchase_orders WHERE listing_id = $1 AND status = 'accepted' LIMIT 1`,
      [listing.id]
    );
    if (accepted.rows.length) fail(409, "LISTING_NOT_OPEN", "이미 다른 구매가 확정된 매물입니다.");
    const pending = await db.query(
      `SELECT id FROM purchase_orders WHERE listing_id = $1 AND buyer_id = $2 AND status = 'pending' LIMIT 1`,
      [listing.id, conv.buyer_id]
    );
    if (pending.rows.length) {
      fail(409, "PENDING_APPLICATION_EXISTS", "이 매물에 승인 대기 중인 구매 신청이 이미 있습니다. 기존 신청을 취소한 뒤 다시 신청해 주세요.");
    }
    const pickup = (listing.pickup || "").slice(0, 120);
    const ins = await db.query(
      `INSERT INTO purchase_orders (
         id, listing_id, buyer_id, price, pickup, note, status,
         offer_id, conversation_id, transport_fee, transport_payer, created_via
       ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        randomUUID(), listing.id, conv.buyer_id, dto.itemTotal, pickup, note,
        row.id, conv.id, dto.transportFee, dto.transportPayer, createdVia,
      ]
    );
    return { order: toOrderDto(ins.rows[0], kind), idempotent: false };
  }).catch((error) => {
    if (error?.code === "23505" && !(error instanceof HttpError)) {
      fail(409, "APPLICATION_ALREADY_EXISTS", "같은 합의로 이미 신청되었습니다.");
    }
    throw error;
  });
}

/** 상세 화면용: 역할 확인 후 조건 이력·합의·연결 신청·본인 평가. 읽기 전용. */
export async function getNegotiationState(rawArgs = {}, rawOpts = {}) {
  const [args, opts] = splitArgs(rawArgs, rawOpts);
  const db = opts.client || opts.pool || getPool();
  const { conv, role } = await resolveContext(db, { ...args, actorUserId: args.viewerUserId ?? args.actorUserId }, { lock: false });
  return buildState(db, conv, role, { includeOffers: true });
}

/** worker1 상세 DTO용 별칭: getConversationTradeSummary(db, {conv, viewerRole, viewerUserId}). */
export async function getConversationTradeSummary(db, { conv, viewerRole, viewerUserId } = {}) {
  const fresh = await loadConversation(db || getPool(), String(conv?.id ?? ""), { lock: false });
  if (!fresh) return { stage: "inquiry", negotiation: null, order: null, linkedOrder: null };
  const role = viewerUserId ? roleOfUser(fresh, viewerUserId) : (ROLES.has(viewerRole) ? viewerRole : null);
  if (!role) fail(403, "FORBIDDEN", "이 대화의 거래 조건에 접근할 권한이 없습니다.");
  return buildState(db || getPool(), fresh, role, { includeOffers: true });
}

/** 목록용 일괄 요약: Map(conversationId → {stage, negotiation{termsVersion,currentOffer,agreed}, order}). */
export async function getTradeSummaries(conversationIds, viewerUserId, rawOpts = {}) {
  const db = rawOpts?.client || rawOpts?.pool || getPool();
  const ids = [...new Set((conversationIds || []).map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const convRes = await db.query(`${CONV_SELECT} WHERE c.id = ANY($1::uuid[])`, [ids]);
  const convs = convRes.rows.filter((c) => roleOfUser(c, viewerUserId));
  if (!convs.length) return out;
  const convIds = convs.map((c) => c.id);
  const offerRes = await db.query(
    `SELECT DISTINCT ON (conversation_id, status) *
     FROM trade_offers
     WHERE conversation_id = ANY($1::uuid[]) AND status IN ('open', 'accepted')
     ORDER BY conversation_id, status, terms_version DESC`,
    [convIds]
  );
  const verRes = await db.query(
    `SELECT conversation_id, MAX(terms_version) AS v FROM trade_offers
     WHERE conversation_id = ANY($1::uuid[]) GROUP BY conversation_id`,
    [convIds]
  );
  const versions = new Map(verRes.rows.map((r) => [String(r.conversation_id), Number(r.v)]));
  const byConv = new Map();
  for (const r of offerRes.rows) {
    const key = String(r.conversation_id);
    const entry = byConv.get(key) || {};
    if (r.status === "open") entry.open = toOfferDto(r);
    else entry.agreed = toOfferDto(r);
    byConv.set(key, entry);
  }
  for (const conv of convs) {
    const key = String(conv.id);
    const entry = byConv.get(key) || {};
    const order = await loadLinkedOrder(db, conv);
    const currentOffer = entry.open || entry.agreed || null;
    const agreed = entry.agreed || null;
    out.set(key, {
      stage: deriveTradeStage({ currentOffer, agreed, order }),
      negotiation: { termsVersion: versions.get(key) ?? 0, currentOffer, agreed },
      order,
      linkedOrder: order,
    });
  }
  return out;
}
