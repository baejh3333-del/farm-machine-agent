// 대여 매물 선택 옵션(옵트인 제공 항목) 및 요금 계산 규칙. 화면·서버가 같은 규칙을 쓴다.
import { deliveryOf } from "./delivery.js";

export const RENTAL_OPTION_ORDER = ["ridger", "fuel", "care"];

export const RENTAL_OPTION_DEFS = {
  ridger: {
    id: "ridger",
    label: "두둑 성형기 같이 빌리기",
    description: "트랙터에 달아 쓰는 작업기예요. 감자·배추 밭에 필요해요.",
    unitPrice: 10000,
    pricing: "per_day",
  },
  fuel: {
    id: "fuel",
    label: "연료 가득 채워 받기",
    description: "반납할 때 다시 채우지 않아도 돼요.",
    unitPrice: 30000,
    pricing: "once",
  },
  care: {
    id: "care",
    label: "고장 걱정 없는 안심 보장",
    description: "작업 중 고장 나면 수리비를 30만원까지 대신 내 드려요.",
    unitPrice: 5000,
    pricing: "per_day",
  },
};

export const DEFAULT_DEMO_RENTAL_OPTIONS = RENTAL_OPTION_ORDER.map((id) => ({
  ...RENTAL_OPTION_DEFS[id],
}));

export const DEMO_MOCKUP_LISTING_ID = "hc-vivaldi-1";

export function isDemoMockupListing(listing) {
  return Boolean(listing && listing.id === DEMO_MOCKUP_LISTING_ID);
}

export const FREE_LESSON_OPTION = {
  id: "lesson",
  label: "처음 쓰는 법 알려 주기",
  description: "받을 때 시동부터 작업까지 알려 달라고 소유주에게 부탁해요.",
  demoDescription: "받을 때 30분 동안 시동부터 작업까지 알려 드려요.",
  unitPrice: 0,
  pricing: "once",
};

const VALID_PRICING = new Set(["per_day", "once"]);

/** 저장·응답용 옵션 목록을 정리한다. 알 수 없는 ID나 잘못된 가격은 버리고 순서를 고정한다. */
export function cleanRentalOptions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const byId = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!Object.hasOwn(RENTAL_OPTION_DEFS, id) || byId.has(id)) continue;
    const def = RENTAL_OPTION_DEFS[id];
    const unitPrice = Number(entry.unitPrice);
    const pricing = typeof entry.pricing === "string" && VALID_PRICING.has(entry.pricing) ? entry.pricing : def.pricing;
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice > 10_000_000) continue;
    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim().slice(0, 60) : def.label;
    const description = typeof entry.description === "string" && entry.description.trim()
      ? entry.description.trim().slice(0, 160)
      : def.description;
    byId.set(id, { id, label, description, unitPrice, pricing });
  }
  return RENTAL_OPTION_ORDER.filter((id) => byId.has(id)).map((id) => byId.get(id));
}

export function sameRentalOption(left, right) {
  return Boolean(
    left && right &&
    left.id === right.id &&
    left.unitPrice === right.unitPrice &&
    left.pricing === right.pricing
  );
}

export function sameRentalOptionList(left, right) {
  const a = cleanRentalOptions(left);
  const b = cleanRentalOptions(right);
  if (a.length !== b.length) return false;
  return a.every((item, idx) => sameRentalOption(item, b[idx]));
}

/** 단일 옵션 금액(원) */
export function optionCost(option, days = 1) {
  const safeDays = Math.max(1, Number(days) || 1);
  const unit = Number(option?.unitPrice) || 0;
  return option?.pricing === "per_day" ? unit * safeDays : unit;
}

/**
 * 매물·기간·수령 방식·작업자·선택 옵션으로 총액을 계산한다.
 * @returns {{ days: number, machineTotal: number, operatorTotal: number, deliveryMethod: string | null, deliveryFee: number, optionsTotal: number, totalPrice: number }}
 */
export function calculateRentalQuote({
  dailyPrice = 0,
  days = 1,
  operatorDailyPrice = 0,
  delivery = null,
  deliveryMethod = null,
  selectedOptions = [],
} = {}) {
  const safeDays = Math.max(1, Number(days) || 1);
  const machineTotal = (Number(dailyPrice) || 0) * safeDays;
  const operatorTotal = (Number(operatorDailyPrice) || 0) * safeDays;
  const normalizedMethod = deliveryMethod === "owner_delivery" || deliveryMethod === "self_pickup"
    ? deliveryMethod
    : null;
  const rawFee = delivery?.fee;
  const deliveryFee = normalizedMethod === "owner_delivery" && Number.isSafeInteger(rawFee) && rawFee > 0
    ? rawFee
    : 0;
  const options = cleanRentalOptions(selectedOptions);
  const optionsTotal = options.reduce((sum, opt) => sum + optionCost(opt, safeDays), 0);
  const totalPrice = machineTotal + operatorTotal + deliveryFee + optionsTotal;
  return {
    days: safeDays,
    machineTotal,
    operatorTotal,
    deliveryMethod: normalizedMethod,
    deliveryFee,
    optionsTotal,
    totalPrice,
  };
}

/** 매물 상세 '옵션' 카드 목록을 목업 순서대로 만든다(소유주가 제공하는 것만 포함). */
export function buildDetailRentalOptions(listing) {
  if (!listing || listing.type !== "rent") return [];
  const offered = cleanRentalOptions(listing.rentalOptions);
  const byId = new Map(offered.map((opt) => [opt.id, opt]));
  const op = listing.rentalOperator;
  const list = [];

  if (op) {
    list.push({
      id: "work",
      kind: "operator",
      t: "농작업 대행",
      d: `소유주 ${op.name}님이 기계를 몰고 와서 직접 작업해 드려요. ${op.experience || ""}`.trim(),
      unit: Number(op.dailyPrice) || 0,
      per: "day",
    });
  }
  if (byId.has("ridger")) {
    const o = byId.get("ridger");
    list.push({ id: o.id, kind: "addon", t: o.label, d: o.description, unit: o.unitPrice, per: o.pricing === "per_day" ? "day" : "once", option: o });
  }
  list.push({
    id: FREE_LESSON_OPTION.id,
    kind: "free",
    t: FREE_LESSON_OPTION.label,
    d: isDemoMockupListing(listing) ? FREE_LESSON_OPTION.demoDescription : FREE_LESSON_OPTION.description,
    unit: 0,
    per: "once",
  });
  if (byId.has("fuel")) {
    const o = byId.get("fuel");
    list.push({ id: o.id, kind: "addon", t: o.label, d: o.description, unit: o.unitPrice, per: o.pricing === "per_day" ? "day" : "once", option: o });
  }
  if (byId.has("care")) {
    const o = byId.get("care");
    list.push({ id: o.id, kind: "addon", t: o.label, d: o.description, unit: o.unitPrice, per: o.pricing === "per_day" ? "day" : "once", option: o });
  }
  return list;
}

/** 배달 설명 문구를 목업 톤에 맞게 만든다. */
export function formatDeliveryDescription(delivery) {
  const area = String(delivery?.area || "").trim();
  if (!area) return "소유주가 내 밭까지 가져다 드려요.";
  if (/(?:안|이내)$/.test(area)) return `${area}이면 내 밭까지 가져다 드려요.`;
  return `${area}까지 소유주가 내 밭까지 가져다 드려요.`;
}

/** 매물이 허용하는 수령 방식의 기본값(직접 가지러 가기 우선, 없으면 배달 받기). */
export function defaultRentalDeliveryMethod(listing) {
  const methods = deliveryOf(listing).methods;
  if (methods.includes("self_pickup")) return "self_pickup";
  if (methods.includes("owner_delivery")) return "owner_delivery";
  return "self_pickup";
}
