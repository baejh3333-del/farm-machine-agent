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
        region: str("지역", { enum: REGIONS }),
        cropIds: { type: "array", items: { type: "string", enum: CROPS.map(({ id }) => id) } },
        operations: { type: "array", items: { type: "string", enum: OPERATIONS.map(({ id }) => id) } },
        description: str("상세 설명(선택)"),
      },
      required: ["type", "machineType", "title", "brand", "condition", "price", "region", "cropIds", "operations"],
      additionalProperties: false,
    },
  },
];

const WRITE_TOOLS = new Set(["create_rental_request", "create_purchase_request", "create_listing"]);

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

export function createToolRunner({ user, today, lastUserMessage, deps }) {
  let listingsCache = null;
  const state = { shownListingIds: [], reservation: null, createdListing: null };

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
      const id = randomUUID();
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
      const id = randomUUID();
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

    async create_listing(args) {
      const id = randomUUID();
      const year = String(args.year || "").trim().slice(0, 20);
      const description = [year ? `연식: ${year}` : "", String(args.description || "").trim()].filter(Boolean).join("\n").slice(0, 1000);
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
      });
      const listing = result.listing || {};
      state.createdListing = { id: listing.id || id, title: listing.title || args.title };
      return {
        ok: true,
        listingNumber: reservationNumber("L", listing.id || id),
        title: listing.title || args.title,
        nextStep: "사진은 [내 기계 관리]에서 매물을 열어 올리도록 안내.",
      };
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
      if (!isAffirmative(lastUserMessage)) {
        return { error: "CONFIRMATION_REQUIRED", message: "사용자가 아직 분명히 동의하지 않았습니다. 예약하지 말고 한 번만 짧게 확인하세요." };
      }
      if (state.reservation || state.createdListing) return { error: "이번 대화 차례에서 이미 하나를 처리했습니다." };
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

function buildInstructions({ user, today }) {
  return `${NONGNONG_INSTRUCTIONS}

[지금 상황]
- 오늘: ${today} (${formatKoreanDate(today)}), 시간대: 한국
- 로그인: ${user ? "로그인함" : "로그인 안 함 (추천까지만 가능)"}
- 지역 목록: ${REGIONS.join(", ")} (영양군)
- 사용자가 "다음 주 화요일"처럼 말하면 오늘 날짜를 기준으로 YYYY-MM-DD로 바꿔 도구에 넘긴다.`;
}

export async function defaultCallModel(body) {
  const response = await fetch("https://api.openai.com/v1/responses", {
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

export async function runNongnong({ messages, user = null, today, deps, callModel = defaultCallModel, model }) {
  const history = sanitizeHistory(messages);
  const last = history.at(-1);
  if (!last || last.role !== "user") throw new Error("마지막 메시지는 사용자 메시지여야 합니다.");
  const resolvedModel = model || process.env.OPENAI_MODEL?.trim() || "gpt-6-luna";
  const tools = createToolRunner({ user, today, lastUserMessage: last.content, deps });
  const input = history.map(({ role, content }) => ({ role, content }));
  const base = {
    model: resolvedModel,
    store: false,
    max_output_tokens: 700,
    instructions: buildInstructions({ user, today }),
    tools: TOOL_DEFINITIONS,
    include: ["reasoning.encrypted_content"],
    ...(/^gpt-6-(?:luna|sol)\b|^gpt-6\.1-terra\b/.test(resolvedModel) ? { reasoning: { effort: "low" } } : {}),
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callModel({ ...base, input });
    const calls = (response.output || []).filter((item) => item.type === "function_call");
    if (!calls.length) {
      const reply = outputText(response) || "잠시 문제가 생겼어요. 다시 한 번 말씀해 주세요.";
      return { mode: "agent", reply, listingIds: tools.state.shownListingIds, reservation: tools.state.reservation, createdListing: tools.state.createdListing };
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
  };
}
