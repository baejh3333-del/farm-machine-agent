// 농농 대화형 에이전트: OpenAI Responses API 함수 호출로 매물 검색부터 예약 생성까지 처리한다.
// 예약·등록 같은 쓰기 도구는 모델 판단만 믿지 않고, 서버가 사용자의 마지막 말이 긍정인지 다시 확인한다.
import { randomUUID } from "node:crypto";
import { rentalDays } from "../src/data/compatibility.js";
import { CROPS, CROP_BY_ID, MACHINE_BY_ID, MACHINE_TYPES, OPERATIONS, OPERATION_BY_ID, REGION_COORDS } from "../src/data/farm-machines.js";
import { NONGNONG_INSTRUCTIONS } from "./nongnong-prompt.js";

export const MAX_HISTORY = 16;
export const MAX_MESSAGE_CHARS = 600;
const MAX_TOOL_ROUNDS = 6;
const MODEL_TIMEOUT_MS = 20_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const CONDITION_LABEL = { good: "좋음", used: "사용감 있음", repair: "수리 필요" };
const REGIONS = Object.keys(REGION_COORDS);

// ───────────────────────── 긍정 판단 ─────────────────────────

const AFFIRMATIVE = [
  /^(?:네+|넵|예+|응+|웅|어+|그래(?:요)?|좋아(?:요)?|좋습니다|ㅇㅇ+|ㅇㅋ+|오케이|ok(?:ay)?|콜|맞아(?:요)?|부탁(?:해요|드려요|합니다))$/i,
  /(?:그걸로|그거로|이걸로|이거로|그것으로|이것으로)\s*(?:해|할게|예약|올려|진행|부탁)/,
  /(?:예약|신청|진행|등록|올려)\s*(?:해\s*)?(?:줘|주세요|줄래|주실래요|드려요|부탁|해요|할게요|합니다|하자|할래요)/,
  /(?:그거|그걸|이거|이걸)\s*(?:할게요|할게|할래요|살게요|빌릴게요)/,
  /^\d+\s*번(?:\s*(?:으로|로))?\s*(?:해\s*(?:줘|주세요)|할게요|예약|좋아요|진행)?/,
];
const NEGATIVE_OR_UNSURE = /(?:아니|안\s*돼|안돼|싫|별로|비싸|다른\s*(?:거|것)|글쎄|생각해\s*볼|모르겠|잠깐|잠시만|말고|취소)/;

export function isAffirmative(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/[?？]\s*$/.test(raw)) return false;
  const normalized = raw.replace(/[.!~…,\s]+$/g, "").replace(/^[\s,]+/, "").trim();
  if (!normalized || NEGATIVE_OR_UNSURE.test(normalized)) return false;
  if (/^(?:음+|흠+|어\.{2,})/.test(normalized)) return false;
  const lead = normalized.replace(/^(?:네|예|응|좋아요|ㅇㅇ|오케이)[,\s]+/, "");
  return AFFIRMATIVE.some((pattern) => pattern.test(normalized) || pattern.test(lead));
}

// ───────────────────────── 형식 도우미 ─────────────────────────

export function formatKoreanDate(ymd) {
  if (!DATE_RE.test(ymd || "")) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WEEKDAYS[d.getUTCDay()]})`;
}

const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;

function addDays(ymd, offset) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

function overlaps(ranges, start, end) {
  return ranges.filter((r) => !(end < r.start || start > r.end));
}

/** 같은 길이로 비어 있는 가장 가까운 기간을 찾는다(앞뒤 60일). */
export function nearestFreeWindow(booked, start, end, today) {
  const days = rentalDays(start, end);
  if (!days) return null;
  for (let step = 1; step <= 60; step += 1) {
    for (const offset of [step, -step]) {
      const s = addDays(start, offset);
      if (s < today) continue;
      const e = addDays(s, days - 1);
      if (!overlaps(booked, s, e).length) return { start: s, end: e };
    }
  }
  return null;
}

export function reservationNumber(prefix, id) {
  return `${prefix}-${String(id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function listingBrief(item) {
  return {
    id: item.id,
    title: item.title,
    machine: MACHINE_BY_ID[item.machineType]?.label || item.machineType,
    brand: item.brand,
    model: item.model || null,
    type: item.type === "rent" ? "대여" : "판매",
    region: item.region,
    price: item.price,
    priceText: item.type === "rent" ? `하루 ${won(item.price)}` : won(item.price),
    condition: CONDITION_LABEL[item.condition] || item.condition,
    included: item.included || "",
    pickup: item.pickup || "",
    inspectedAt: item.inspectedAt,
    crops: item.cropIds.map((id) => CROP_BY_ID[id]?.name).filter(Boolean),
    operations: item.operations.map((id) => OPERATION_BY_ID[id]?.label).filter(Boolean),
    areaPyeong: `${item.areaMin}~${item.areaMax}평`,
    sellerNote: String(item.description || item.summary || "").slice(0, 120),
    yearNote: "연식 정보는 매물 정보에 없음",
  };
}

// ───────────────────────── 도구 정의 ─────────────────────────

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const dateField = (description) => str(`${description} (YYYY-MM-DD)`);

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "search_listings",
    description: "대여 또는 판매 매물을 찾는다. 날짜를 주면 그 기간에 빌릴 수 있는 대여 매물만 돌려준다.",
    parameters: {
      type: "object",
      properties: {
        type: str("rent=빌리기, sale=사기", { enum: ["rent", "sale"] }),
        machineType: str("기종 ID", { enum: MACHINE_TYPES.map(({ id }) => id) }),
        cropId: str("작물 ID", { enum: CROPS.map(({ id }) => id) }),
        operation: str("작업 ID", { enum: OPERATIONS.map(({ id }) => id) }),
        region: str("지역", { enum: REGIONS }),
        start: dateField("대여 시작일"),
        end: dateField("반납일"),
        maxPrice: { type: "integer", description: "최대 가격(원). 대여는 하루 대여료 기준" },
      },
      required: ["type"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "check_availability",
    description: "대여 매물이 그 기간에 비어 있는지 확인하고, 안 되면 가장 가까운 빈 기간을 알려준다.",
    parameters: {
      type: "object",
      properties: { listingId: str("매물 ID"), start: dateField("대여 시작일"), end: dateField("반납일") },
      required: ["listingId", "start", "end"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "calculate_cost",
    description: "대여료, 보증금, 내야 하는 돈을 계산한다.",
    parameters: {
      type: "object",
      properties: { listingId: str("매물 ID"), start: dateField("대여 시작일"), end: dateField("반납일") },
      required: ["listingId", "start", "end"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_weather",
    description: "영양군 지역의 날짜별 날씨를 확인한다.",
    parameters: {
      type: "object",
      properties: { region: str("지역", { enum: REGIONS }), start: dateField("시작일"), end: dateField("종료일") },
      required: ["start"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_market_price",
    description: "시세 조회. 같은 종류(와 상태)의 매물 가격 범위를 최저·중간·최고로 돌려준다. 대여는 하루 대여료 기준.",
    parameters: {
      type: "object",
      properties: {
        type: str("rent=대여료 시세, sale=판매가 시세", { enum: ["rent", "sale"] }),
        machineType: str("기종 ID", { enum: MACHINE_TYPES.map(({ id }) => id) }),
        condition: str("상태(있으면)", { enum: ["good", "used", "repair"] }),
      },
      required: ["type", "machineType"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_rental_request",
    description: "대여 예약을 만든다. 직전에 추천한 매물에 사용자가 긍정했을 때만 부른다.",
    parameters: {
      type: "object",
      properties: { listingId: str("매물 ID"), start: dateField("대여 시작일"), end: dateField("반납일") },
      required: ["listingId", "start", "end"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_purchase_request",
    description: "판매 매물에 구매 예약(구매 신청)을 보낸다. 사용자가 긍정했을 때만 부른다.",
    parameters: {
      type: "object",
      properties: { listingId: str("매물 ID") },
      required: ["listingId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_listing",
    description: "사용자의 기계를 판매 또는 대여 매물로 등록한다. 요약을 보여주고 사용자가 긍정했을 때만 부른다.",
    parameters: {
      type: "object",
      properties: {
        type: str("rent=빌려주기, sale=팔기", { enum: ["rent", "sale"] }),
        machineType: str("기종 ID", { enum: MACHINE_TYPES.map(({ id }) => id) }),
        title: str("매물 제목(80자 이내)"),
        brand: str("제조사"),
        year: str("연식(예: 2019년식). 모르면 빈 문자열"),
        condition: str("상태", { enum: ["good", "used", "repair"] }),
        price: { type: "integer", description: "가격(원). 대여는 하루 대여료" },
        deposit: { type: "integer", description: "빌려주기일 때 보증금(원). 없으면 0" },
        region: str("지역", { enum: REGIONS }),
        cropIds: { type: "array", items: { type: "string", enum: CROPS.map(({ id }) => id) } },
        operations: { type: "array", items: { type: "string", enum: OPERATIONS.map(({ id }) => id) } },
        description: str("상세 설명(선택)"),
      },
      required: ["type", "machineType", "title", "brand", "condition", "price", "region", "cropIds", "operations"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_listing",
    description: "이번 대화에서 등록한 내 매물을 고친다. 바뀐 요약을 다시 보여주고 사용자가 긍정했을 때만 부른다. 바꿀 항목만 넣는다.",
    parameters: {
      type: "object",
      properties: {
        listingId: str("등록할 때 받은 매물 ID"),
        title: str("새 제목"),
        price: { type: "integer", description: "새 가격(원)" },
        condition: str("새 상태", { enum: ["good", "used", "repair"] }),
        year: str("새 연식"),
        deposit: { type: "integer", description: "새 보증금(원)" },
        description: str("새 상세 설명"),
      },
      required: ["listingId"],
      additionalProperties: false,
    },
  },
];

const WRITE_TOOLS = new Set(["create_rental_request", "create_purchase_request", "create_listing", "update_listing"]);

/** 연식·보증금은 매물 칸이 없어 상세 설명 앞줄에 적는다. */
export function composeListingDescription({ year, deposit, description }) {
  const lines = [];
  const y = String(year || "").trim().slice(0, 20);
  if (y) lines.push(`연식: ${y}`);
  if (Number.isSafeInteger(deposit) && deposit > 0) lines.push(`보증금: ${won(deposit)}`);
  const rest = String(description || "")
    .split("\n")
    .filter((line) => !/^(연식|보증금):/.test(line.trim()))
    .join("\n")
    .trim();
  if (rest) lines.push(rest);
  return lines.join("\n").slice(0, 1000);
}

function readDescriptionField(description, label) {
  const line = String(description || "").split("\n").find((l) => l.startsWith(`${label}:`));
  return line ? line.slice(label.length + 1).trim() : "";
}

export function priceStats(prices) {
  const sorted = prices.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { count: sorted.length, min: sorted[0], median, max: sorted.at(-1) };
}

// ───────────────────────── 도구 실행 ─────────────────────────

class ToolError extends Error {}
const toolFail = (message) => {
  throw new ToolError(message);
};

function requireDates(args, today) {
  const { start, end } = args;
  if (!DATE_RE.test(start || "") || !DATE_RE.test(end || "")) toolFail("시작일과 반납일이 필요합니다. 사용자에게 날짜를 물어보세요.");
  const days = rentalDays(start, end);
  if (!days) toolFail("반납일이 시작일보다 빠릅니다.");
  if (start < today) toolFail("오늘 이전 날짜로는 빌릴 수 없습니다.");
  return { start, end, days };
}

export function createToolRunner({ user, today, lastUserMessage, deps, listingPhoto = null, inputMode = "text", confirmed = false, requestId = null }) {
  // 화면 승인 버튼은 요청 ID를 함께 보내, 다시 눌러도 같은 요청으로 처리되게 한다.
  const newId = () => requestId || randomUUID();
  let listingsCache = null;
  const state = { shownListingIds: [], reservation: null, createdListing: null, updatedListing: null, pendingAction: null };

  async function listings() {
    listingsCache ??= await deps.fetchListings();
    return listingsCache;
  }

  async function findListing(id) {
    const item = (await listings()).find((l) => l.id === id && l.status !== "removed");
    if (!item) toolFail("매물을 찾을 수 없습니다. 먼저 search_listings로 찾아 주세요.");
    return item;
  }

  const handlers = {
    async search_listings(args) {
      const type = args.type === "sale" ? "sale" : "rent";
      const hasDates = DATE_RE.test(args.start || "") && DATE_RE.test(args.end || "");
      const dates = type === "rent" && hasDates ? requireDates(args, today) : null;
      let rows = (await listings()).filter((l) => l.type === type && l.status === "open" && (!user || l.ownerId !== user.id));
      if (args.machineType) rows = rows.filter((l) => l.machineType === args.machineType);
      if (args.cropId) rows = rows.filter((l) => l.cropIds.includes(args.cropId));
      if (args.operation) rows = rows.filter((l) => l.operations.includes(args.operation));
      if (Number.isFinite(args.maxPrice) && args.maxPrice > 0) rows = rows.filter((l) => l.price <= args.maxPrice);
      let excludedBooked = 0;
      if (dates) {
        const before = rows.length;
        rows = rows.filter((l) => !overlaps(l.booked || [], dates.start, dates.end).length);
        excludedBooked = before - rows.length;
      }
      const region = REGIONS.includes(args.region) ? args.region : null;
      rows.sort((a, b) => (region ? (b.region === region) - (a.region === region) : 0) || a.price - b.price);
      const results = rows.slice(0, 5).map((item) => ({
        ...listingBrief(item),
        sameRegion: region ? item.region === region : null,
        ...(dates ? { rentalDays: dates.days, rentalFee: item.price * dates.days } : {}),
      }));
      state.shownListingIds = results.slice(0, 3).map(({ id }) => id);
      return {
        count: results.length,
        excludedBecauseBooked: excludedBooked,
        results,
        note: results.length ? "결과에 있는 매물만 추천하세요." : "조건에 맞는 매물이 없습니다. 조건을 바꿔 다시 찾거나 사용자에게 알려 주세요.",
      };
    },

    async check_availability(args) {
      const item = await findListing(args.listingId);
      if (item.type !== "rent") toolFail("대여 매물이 아닙니다.");
      const { start, end, days } = requireDates(args, today);
      const conflicts = overlaps(item.booked || [], start, end);
      return {
        listingId: item.id,
        title: item.title,
        period: `${formatKoreanDate(start)} ~ ${formatKoreanDate(end)} (${days}일)`,
        available: item.status === "open" && !conflicts.length,
        bookedRanges: conflicts,
        nearestFree: conflicts.length ? nearestFreeWindow(item.booked || [], start, end, today) : null,
      };
    },

    async calculate_cost(args) {
      const item = await findListing(args.listingId);
      if (item.type !== "rent") {
        return { listingId: item.id, salePrice: item.price, salePriceText: won(item.price), deposit: null, depositNote: "보증금·운송비는 매물 정보에 없어 판매자 확인이 필요합니다." };
      }
      const { days } = requireDates(args, today);
      const fee = item.price * days;
      return {
        listingId: item.id,
        dailyPrice: item.price,
        days,
        rentalFee: fee,
        rentalFeeText: `${won(item.price)} × ${days}일 = ${won(fee)}`,
        deposit: null,
        depositNote: "보증금·운송비는 매물 정보에 없어 소유 농가 확인이 필요합니다.",
        amountDue: fee,
        amountDueText: won(fee),
      };
    },

    async get_weather(args) {
      if (!DATE_RE.test(args.start || "")) toolFail("날짜가 필요합니다.");
      const end = DATE_RE.test(args.end || "") && args.end >= args.start ? args.end : args.start;
      const data = await deps.getWeather({ region: REGIONS.includes(args.region) ? args.region : "영양읍", date: args.start, endDate: end });
      const days = (data.rangeForecast || [data.weather]).slice(0, 14).map((d) => ({
        date: d.date,
        dateText: formatKoreanDate(d.date),
        summary: d.summary,
        rainChance: d.pop,
        temp: `${d.tempMin}~${d.tempMax}도`,
        rainy: d.icon === "rain" || d.icon === "snow",
      }));
      const fallback = (data.rangeForecast || [data.weather]).some((d) => d.source !== "kma");
      return { region: data.region, days, source: fallback ? "예보 범위 밖이거나 예시 안내입니다. 참고만 하도록 말하세요." : "기상청 단기예보" };
    },

    async create_rental_request(args) {
      const item = await findListing(args.listingId);
      const { start, end } = requireDates(args, today);
      const id = newId();
      const result = await deps.createRentalRequest(user, { id, listingId: item.id, start, end, note: "농농 채팅으로 신청한 예약입니다." });
      const req = result.request || {};
      state.reservation = {
        kind: "rental",
        number: reservationNumber("R", req.id || id),
        listingId: item.id,
        title: item.title,
        region: item.region,
        start,
        end,
        days: req.days,
        totalPrice: req.totalPrice,
      };
      return {
        ok: true,
        reservationNumber: state.reservation.number,
        title: item.title,
        period: `${formatKoreanDate(start)} ~ ${formatKoreanDate(end)}`,
        amountDue: won(req.totalPrice ?? item.price * rentalDays(start, end)),
        status: "소유 농가 승인 대기",
        nextStep: "결제는 [대여 요청] 메뉴에서 사용자가 직접. 결제 전까지 확정 아님.",
      };
    },

    async create_purchase_request(args) {
      const item = await findListing(args.listingId);
      if (item.type !== "sale" || item.status !== "open") toolFail("지금 구매 신청을 받을 수 없는 매물입니다.");
      const id = newId();
      const body = `[농농 구매 신청] '${item.title}' 구매를 희망합니다. 확인 후 답장 부탁드립니다.`;
      const result = await deps.sendPurchaseMessage(user, { id, listingId: item.id, body });
      state.reservation = {
        kind: "purchase",
        number: reservationNumber("P", id),
        listingId: item.id,
        conversationId: result?.conversation?.id ?? null,
        title: item.title,
        region: item.region,
        totalPrice: item.price,
      };
      return {
        ok: true,
        reservationNumber: state.reservation.number,
        title: item.title,
        price: won(item.price),
        status: "판매자 확인 대기",
        nextStep: "판매자가 확인하면 채팅에서 결제·거래 진행. 사용자가 직접 결제.",
      };
    },

    async get_market_price(args) {
      const type = args.type === "sale" ? "sale" : "rent";
      const same = (await listings()).filter((l) => l.type === type && l.machineType === args.machineType && l.status !== "removed");
      const all = priceStats(same.map((l) => l.price));
      const sameCondition = args.condition ? priceStats(same.filter((l) => l.condition === args.condition).map((l) => l.price)) : null;
      const fmt = (st) => st && { ...st, text: `${won(st.min)} ~ ${won(st.max)} (중간 ${won(st.median)})` };
      return {
        machine: MACHINE_BY_ID[args.machineType]?.label || args.machineType,
        unit: type === "rent" ? "하루 대여료" : "판매가",
        allConditions: fmt(all),
        sameCondition: fmt(sameCondition),
        note: [
          all ? "" : "비슷한 매물이 없습니다. 가격을 지어내지 말고 희망 가격을 물어보세요.",
          "연식 정보는 매물 데이터에 없어 연식별 비교는 할 수 없습니다.",
          type === "rent" ? "보증금 시세 데이터는 없습니다. 보증금은 사용자에게 희망 금액을 물어보세요." : "",
        ].filter(Boolean).join(" "),
      };
    },

    async create_listing(args) {
      const id = newId();
      const description = composeListingDescription({ year: args.year, deposit: args.type === "rent" ? args.deposit : 0, description: args.description });
      const result = await deps.createListing(user, {
        id,
        type: args.type,
        machineType: args.machineType,
        title: args.title,
        brand: args.brand,
        condition: args.condition,
        price: args.price,
        region: args.region,
        cropIds: args.cropIds,
        operations: args.operations,
        description,
        ...(listingPhoto ? { photoDataUrl: listingPhoto } : {}),
      });
      const listing = result.listing || {};
      state.createdListing = { id: listing.id || id, number: reservationNumber("L", listing.id || id), title: listing.title || args.title, photoAttached: Boolean(listingPhoto) };
      return {
        ok: true,
        listingId: state.createdListing.id,
        listingNumber: state.createdListing.number,
        title: state.createdListing.title,
        price: won(args.price),
        description,
        photoAttached: Boolean(listingPhoto),
        nextStep: listingPhoto ? "사진도 함께 올렸다고 안내." : "사진이 있으면 더 빨리 거래된다고 한 번 안내. 사진은 [내 기계 관리]에서 올릴 수 있음.",
      };
    },

    async update_listing(args) {
      const current = (await deps.fetchOwnListings()).find((l) => l.id === args.listingId && l.status !== "removed");
      if (!current) toolFail("내가 등록한 매물을 찾을 수 없습니다.");
      const touchesDescription = ["year", "deposit", "description"].some((key) => args[key] !== undefined);
      const payload = { action: "update", id: current.id };
      if (typeof args.title === "string" && args.title.trim()) payload.title = args.title.trim();
      if (Number.isSafeInteger(args.price) && args.price >= 0) payload.price = args.price;
      if (["good", "used", "repair"].includes(args.condition)) payload.condition = args.condition;
      if (touchesDescription) {
        const depositText = readDescriptionField(current.description, "보증금").replace(/[^\d]/g, "");
        payload.description = composeListingDescription({
          year: args.year ?? readDescriptionField(current.description, "연식"),
          deposit: args.deposit ?? (depositText ? Number(depositText) : 0),
          description: args.description ?? current.description,
        });
      }
      if (Object.keys(payload).length === 2) toolFail("바꿀 내용이 없습니다.");
      const result = await deps.updateListing(user, payload);
      const listing = result.listing || {};
      state.updatedListing = { id: current.id, number: reservationNumber("L", current.id), title: listing.title || payload.title || current.title };
      return { ok: true, listingNumber: state.updatedListing.number, title: state.updatedListing.title, price: won(listing.price ?? payload.price ?? current.price), description: listing.description ?? payload.description ?? current.description };
    },
  };

  // 음성으로 받은 쓰기 요청은 바로 처리하지 않고, 화면 승인 카드에 보여 줄 요약을 만든다.
  const describers = {
    async create_rental_request(args) {
      const item = await findListing(args.listingId);
      const { start, end } = requireDates(args, today);
      const days = rentalDays(start, end);
      return {
        title: "대여 예약 확인",
        rows: [
          ["기계", item.title],
          ["지역", item.region],
          ["기간", `${formatKoreanDate(start)} ~ ${formatKoreanDate(end)} · ${days}일`],
          ["내야 하는 돈", `${won(item.price * days)} (하루 ${won(item.price)})`],
        ],
        args: { listingId: item.id, start, end },
      };
    },
    async create_purchase_request(args) {
      const item = await findListing(args.listingId);
      if (item.type !== "sale" || item.status !== "open") toolFail("지금 구매 신청을 받을 수 없는 매물입니다.");
      return { title: "구매 신청 확인", rows: [["기계", item.title], ["지역", item.region], ["판매가", won(item.price)]], args: { listingId: item.id } };
    },
    async create_listing(args) {
      const rent = args.type === "rent";
      const rows = [
        ["종류", rent ? "빌려주기" : "팔기"],
        ["기계", MACHINE_BY_ID[args.machineType]?.label || args.machineType],
        ["제목", args.title],
        ["제조사", args.brand],
        ["연식", args.year],
        ["상태", CONDITION_LABEL[args.condition]],
        ["가격", Number.isSafeInteger(args.price) ? `${rent ? "하루 " : ""}${won(args.price)}` : ""],
        ["보증금", rent && Number(args.deposit) > 0 ? won(args.deposit) : ""],
        ["지역", args.region],
        ["사진", listingPhoto ? "함께 올림" : "없음"],
      ].filter(([, value]) => value);
      return { title: "매물 등록 확인", rows, args };
    },
    async update_listing(args) {
      const current = (await deps.fetchOwnListings()).find((l) => l.id === args.listingId && l.status !== "removed");
      if (!current) toolFail("내가 등록한 매물을 찾을 수 없습니다.");
      const rows = [["매물", current.title]];
      if (typeof args.title === "string" && args.title.trim()) rows.push(["제목", `${current.title} → ${args.title.trim()}`]);
      if (Number.isSafeInteger(args.price) && args.price >= 0) rows.push(["가격", `${won(current.price)} → ${won(args.price)}`]);
      if (CONDITION_LABEL[args.condition]) rows.push(["상태", CONDITION_LABEL[args.condition]]);
      if (typeof args.year === "string" && args.year.trim()) rows.push(["연식", args.year.trim()]);
      if (Number.isSafeInteger(args.deposit) && args.deposit >= 0) rows.push(["보증금", won(args.deposit)]);
      if (typeof args.description === "string" && args.description.trim()) rows.push(["상세 설명", args.description.trim().slice(0, 80)]);
      if (rows.length === 1) toolFail("바꿀 내용이 없습니다.");
      return { title: "매물 수정 확인", rows, args };
    },
  };

  async function run(name, rawArgs) {
    const handler = handlers[name];
    if (!handler) return { error: "알 수 없는 기능입니다." };
    let args;
    try {
      args = JSON.parse(rawArgs || "{}");
    } catch {
      return { error: "인자 형식이 올바르지 않습니다." };
    }
    if (WRITE_TOOLS.has(name)) {
      if (!user) return { error: "LOGIN_REQUIRED", message: "로그인하지 않은 사용자입니다. 예약·등록은 로그인 후에 할 수 있다고 안내하세요." };
      if (state.reservation || state.createdListing || state.updatedListing || state.pendingAction) return { error: "이번 대화 차례에서 이미 하나를 처리했습니다." };
      if (inputMode === "voice" && !confirmed) {
        try {
          const summary = await describers[name](args);
          state.pendingAction = { tool: name, ...summary };
        } catch (error) {
          if (error instanceof ToolError) return { error: error.message };
          console.warn("nongnong describe failed", name, error instanceof Error ? error.message : "unknown");
          return { error: "처리 중 문제가 생겼습니다. 잠시 후 다시 시도하도록 안내하세요." };
        }
        return {
          error: "SCREEN_APPROVAL_REQUIRED",
          message: "음성으로 받은 요청은 말만으로 처리하지 않습니다. 화면에 확인 카드를 띄웠습니다. 아직 처리되지 않았다고 말하고, 요청 내용을 짧게 되읽은 뒤 맞으면 화면의 승인 버튼을 눌러 달라고 안내하세요.",
          summary: state.pendingAction.rows.map(([label, value]) => `${label}: ${value}`).join(" / "),
        };
      }
      if (!confirmed && !isAffirmative(lastUserMessage)) {
        return { error: "CONFIRMATION_REQUIRED", message: "사용자가 아직 분명히 동의하지 않았습니다. 예약하지 말고 한 번만 짧게 확인하세요." };
      }
      try {
        await deps.beforeWrite?.(name);
      } catch (error) {
        return { error: error?.code || "WRITE_BLOCKED", message: error?.message || "지금은 처리할 수 없습니다." };
      }
    }
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof ToolError) return { error: error.message };
      if (typeof error?.status === "number" && error.message) return { error: error.code || "FAILED", message: error.message };
      console.warn("nongnong tool failed", name, error instanceof Error ? error.message : "unknown");
      return { error: "처리 중 문제가 생겼습니다. 잠시 후 다시 시도하도록 안내하세요." };
    }
  }

  return { run, state };
}

// ───────────────────────── 대화 처리 ─────────────────────────

export function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_MESSAGE_CHARS) }));
}

const VOICE_GUIDE = `
[음성으로 받은 말]
- 이번 말은 음성 인식으로 받아 적은 글이다. 사용자가 확인했지만 잘못 들린 낱말이 남아 있을 수 있다.
- 경상도·전라도·충청도 같은 사투리를 존중한다. 고치라고 하거나 흉내 내지 말고, 뜻을 알아듣고 표준어 존댓말로 답한다.
- 날짜, 기간, 가격, 면적, 지역, 농기계 이름이 모호하면 추측하지 말고 한 번에 한두 가지만 쉬운 말로 되묻는다.
- 숫자, 날짜, 금액, 농기계 이름은 "~로 들었어요. 맞으세요?"처럼 되읽어 확인한다.
- 예약·구매 신청·등록·수정은 말로 "네"라고 해도 바로 처리되지 않는다. 도구를 부르면 화면에 확인 카드가 뜨고, 사용자가 화면의 승인 버튼을 눌러야 처리된다. 처리됐다고 말하지 않는다.
- 답은 소리로도 읽힌다. 짧은 문장 2~4개로 쓰고, 표·기호·이모지는 쓰지 않는다. 날짜는 "11월 20일", 금액은 "4만 5천 원"처럼 쓴다.`;

function buildInstructions({ user, today, listingPhoto, inputMode = "text" }) {
  return `${NONGNONG_INSTRUCTIONS}

[지금 상황]
- 오늘: ${today} (${formatKoreanDate(today)}), 시간대: 한국
- 로그인: ${user ? "로그인함" : "로그인 안 함 (추천까지만 가능)"}
- 등록용 사진: ${listingPhoto ? "있음 (등록하면 함께 올라감)" : "없음"}
- 지역 목록: ${REGIONS.join(", ")} (영양군)
- 사용자가 "다음 주 화요일"처럼 말하면 오늘 날짜를 기준으로 YYYY-MM-DD로 바꿔 도구에 넘긴다.${inputMode === "voice" ? `\n${VOICE_GUIDE}` : ""}`;
}

export async function defaultCallModel(body) {
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const error = new Error(`OpenAI ${response.status}`);
    error.code = data?.error?.code;
    throw error;
  }
  return response.json();
}

function outputText(response) {
  return (response.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("")
    .trim();
}

const PHOTO_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_PHOTO_CHARS = 1_300_000; // base64 기준 약 0.97MB (서버 사진 한도 1MB 이하)

export function validPhoto(photo) {
  return typeof photo === "string" && photo.length <= MAX_PHOTO_CHARS && PHOTO_RE.test(photo) ? photo : null;
}

export async function runNongnong({ messages, user = null, today, deps, callModel = defaultCallModel, model, photo = null, photoIsNew = false, inputMode = "text" }) {
  const history = sanitizeHistory(messages);
  const last = history.at(-1);
  if (!last || last.role !== "user") throw new Error("마지막 메시지는 사용자 메시지여야 합니다.");
  const resolvedModel = model || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const listingPhoto = validPhoto(photo);
  const voice = inputMode === "voice";
  const tools = createToolRunner({ user, today, lastUserMessage: last.content, deps, listingPhoto, inputMode: voice ? "voice" : "text" });
  const input = history.map(({ role, content }) => ({ role, content }));
  if (listingPhoto && photoIsNew) {
    // 이번 메시지와 함께 올린 사진만 모델에 보여준다. 이전 사진 분석 결과는 대화 기록에 남아 있다.
    input[input.length - 1] = {
      role: "user",
      content: [
        { type: "input_text", text: last.content },
        { type: "input_image", image_url: listingPhoto, detail: "auto" },
      ],
    };
  }
  const base = {
    model: resolvedModel,
    store: false,
    max_output_tokens: 900,
    instructions: buildInstructions({ user, today, listingPhoto, inputMode: voice ? "voice" : "text" }),
    tools: TOOL_DEFINITIONS,
    include: ["reasoning.encrypted_content"],
    ...(/^gpt-6-(?:luna|sol)\b|^gpt-6\.1-terra\b/.test(resolvedModel) ? { reasoning: { effort: "low" } } : {}),
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callModel({ ...base, input });
    const calls = (response.output || []).filter((item) => item.type === "function_call");
    if (!calls.length) {
      const reply = outputText(response) || "잠시 문제가 생겼어요. 다시 한 번 말씀해 주세요.";
      return {
        mode: "agent",
        reply,
        listingIds: tools.state.shownListingIds,
        reservation: tools.state.reservation,
        createdListing: tools.state.createdListing,
        updatedListing: tools.state.updatedListing,
        ...(tools.state.pendingAction ? { pendingAction: tools.state.pendingAction } : {}),
      };
    }
    input.push(...response.output);
    for (const call of calls) {
      const result = await tools.run(call.name, call.arguments);
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    }
  }
  return {
    mode: "agent",
    reply: tools.state.reservation
      ? `예약을 접수했어요. 예약 번호는 ${tools.state.reservation.number}이에요.`
      : "확인할 게 많아 시간이 걸렸어요. 조건을 한 번만 더 말씀해 주세요.",
    listingIds: tools.state.shownListingIds,
    reservation: tools.state.reservation,
    createdListing: tools.state.createdListing,
    updatedListing: tools.state.updatedListing,
  };
}

// ───────────────────────── 화면 승인 후 처리 ─────────────────────────

export const CONFIRMABLE_TOOLS = WRITE_TOOLS;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userFacing(message) {
  return String(message || "")
    .replace(/\s*먼저 [a-z_]+로 찾아 주세요\./g, "")
    .replace(/하도록 안내하세요\.?$/, "해 주세요.")
    .trim();
}

/**
 * 음성 대화에서 띄운 승인 카드의 버튼을 눌렀을 때: 모델을 거치지 않고 카드에 적힌 작업을 그대로 처리한다.
 * 값 검사는 글로 요청할 때와 같은 도구 코드가 다시 한다.
 */
export async function runConfirmedAction({ user = null, today, deps, action, photo = null }) {
  const tool = action?.tool;
  const args = action?.args;
  if (!WRITE_TOOLS.has(tool) || !args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("처리할 수 없는 작업입니다.");
  }
  const requestId = UUID_RE.test(action?.requestId || "") ? action.requestId : null;
  const tools = createToolRunner({ user, today, lastUserMessage: "", deps, listingPhoto: validPhoto(photo), confirmed: true, requestId });
  const result = await tools.run(tool, JSON.stringify(args));
  const { state } = tools;
  if (!result?.ok) {
    const reason = result?.error === "LOGIN_REQUIRED" ? "로그인한 뒤에 다시 승인해 주세요." : userFacing(result?.message || result?.error) || "잠시 후 다시 시도해 주세요.";
    return { mode: "agent", failed: true, reply: `처리하지 못했어요. ${reason}`, listingIds: [], reservation: null, createdListing: null, updatedListing: null };
  }
  let reply;
  if (tool === "create_rental_request") {
    reply = `✅ 대여 요청을 보냈어요. 예약 번호는 ${result.reservationNumber}이에요. ${result.period}, 내야 하는 돈은 ${result.amountDue}이에요. 소유 농가가 승인하면 [대여 요청] 메뉴에서 결제해 주세요.`;
  } else if (tool === "create_purchase_request") {
    reply = `✅ 구매 신청을 보냈어요. 신청 번호는 ${result.reservationNumber}이에요. 판매자가 확인하면 채팅에서 거래를 이어 가요.`;
  } else if (tool === "create_listing") {
    reply = `✅ 매물을 올렸어요. 등록 번호는 ${result.listingNumber}이에요.${result.photoAttached ? " 사진도 함께 올렸어요." : " 사진은 [내 기계 관리]에서 올릴 수 있어요."}`;
  } else {
    reply = `✅ 매물을 고쳤어요. 등록 번호는 ${result.listingNumber}이에요.`;
  }
  return { mode: "agent", reply, listingIds: [], reservation: state.reservation, createdListing: state.createdListing, updatedListing: state.updatedListing };
}
