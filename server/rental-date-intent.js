// 사용자의 말에서 대여 시작일·반납일을 읽는다. "내일", "다음 주 화요일부터 이틀", "11월 24일~26일" 같은 한국어 표현을
// 오늘 날짜(한국 시간, YYYY-MM-DD) 기준으로 바꾼다. 하루로 정할 수 없는 말("다음 주쯤", "주말에")은 날짜로 보지 않는다.

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_INDEX = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6 }; // 월요일 시작 주
const RELATIVE_DAYS = [
  [/내일\s*모레|내일모레/g, 2],
  [/오늘/g, 0],
  [/내일/g, 1],
  [/모레/g, 2],
  [/글피/g, 3],
];
const DURATION_WORDS = [
  [/하루/, 1],
  [/이틀/, 2],
  [/사흘/, 3],
  [/나흘/, 4],
  [/닷새/, 5],
  [/엿새/, 6],
  [/일주일|한\s*주(?:일)?\s*(?:동안|간)?|이레/, 7],
];

function toUtc(ymd) {
  return Date.parse(`${ymd}T00:00:00Z`);
}

export function addDaysYmd(ymd, offset) {
  return new Date(toUtc(ymd) + offset * 86_400_000).toISOString().slice(0, 10);
}

function makeYmd(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return "";
  return value.toISOString().slice(0, 10);
}

/** 월~일 0~6 (월요일 시작) */
function weekdayIndex(ymd) {
  return (new Date(toUtc(ymd)).getUTCDay() + 6) % 7;
}

function mondayOf(ymd) {
  return addDaysYmd(ymd, -weekdayIndex(ymd));
}

/** 연도 없는 월·일: 오늘(또는 앞 날짜)보다 이르면 다음 해로 본다. */
function monthDay(month, day, floor) {
  const year = Number(floor.slice(0, 4));
  let ymd = makeYmd(year, month, day);
  if (ymd && ymd < floor) ymd = makeYmd(year + 1, month, day);
  return ymd;
}

/** 일만 말한 경우("24일부터"): 이번 달에서 이미 지났으면 다음 달로 본다. */
function dayOnly(day, floor) {
  const [y, m] = floor.split("-").map(Number);
  let ymd = makeYmd(y, m, day);
  if (ymd && ymd < floor) {
    const next = m === 12 ? [y + 1, 1] : [y, m + 1];
    ymd = makeYmd(next[0], next[1], day);
  }
  return ymd;
}

function readDuration(text) {
  const nights = text.match(/(\d{1,2})\s*박\s*(\d{1,2})\s*일/);
  if (nights) return Number(nights[2]);
  const counted = text.match(/(\d{1,2})\s*일\s*(?:동안|간|정도|만|짜리|치)/);
  if (counted) return Number(counted[1]);
  const borrowFor = text.match(/(?<![\d월])(\d{1,2})\s*일\s*(?:만\s*)?(?:빌리|빌려|빌릴|대여|사용|쓰|써)/);
  if (borrowFor && Number(borrowFor[1]) <= 14) return Number(borrowFor[1]);
  for (const [pattern, days] of DURATION_WORDS) if (pattern.test(text)) return days;
  return 0;
}

/**
 * 문장에서 날짜 후보를 나온 순서대로 모은다. 각 후보는 { index, ymd, weekend }.
 */
function collectDates(text, today) {
  const found = [];
  const taken = [];
  const push = (index, length, ymd, extra = {}) => {
    if (!ymd) return;
    if (taken.some(([a, b]) => index < b && a < index + length)) return;
    taken.push([index, index + length]);
    found.push({ index, ymd, ...extra });
  };

  for (const m of text.matchAll(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/g)) {
    push(m.index, m[0].length, makeYmd(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  for (const m of text.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    const prev = found.filter((f) => f.index < m.index).at(-1)?.ymd;
    push(m.index, m[0].length, monthDay(Number(m[1]), Number(m[2]), prev || today));
  }
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/g)) {
    const prev = found.filter((f) => f.index < m.index).at(-1)?.ymd;
    push(m.index, m[0].length, monthDay(Number(m[1]), Number(m[2]), prev || today));
  }
  // "24일부터", "26일까지", "25일에": 뒤에 부터·까지·에·~·날이 오는 일(日)만 날짜로 본다("3일 동안"은 기간).
  for (const m of text.matchAll(/(?<![\d])(\d{1,2})\s*일(?=\s*(?:부터|까지|에|~|∼|-|날|자로|자부터))|(?<=(?:~|∼|부터)\s*)(\d{1,2})\s*일(?!\s*(?:동안|간|정도|만|짜리|치))/g)) {
    found.sort((a, b) => a.index - b.index);
    const prev = found.filter((f) => f.index < m.index).at(-1)?.ymd;
    const day = Number(m[1] || m[2]);
    let ymd = "";
    if (prev) {
      const [y, mo] = prev.split("-").map(Number);
      ymd = makeYmd(y, mo, day);
      if (ymd && ymd < prev) ymd = dayOnly(day, addDaysYmd(prev, 1));
    } else {
      ymd = dayOnly(day, today);
    }
    push(m.index, m[0].length, ymd);
  }
  for (const [pattern, offset] of RELATIVE_DAYS) {
    for (const m of text.matchAll(pattern)) push(m.index, m[0].length, addDaysYmd(today, offset));
  }
  const thisMonday = mondayOf(today);
  for (const m of text.matchAll(/(이번\s*주|다다음\s*주|다음\s*주|담주)?\s*(?:의\s*)?([월화수목금토일])\s*요일/g)) {
    const idx = WEEKDAY_INDEX[m[2]];
    const week = (m[1] || "").replace(/\s+/g, "");
    let ymd;
    if (week === "이번주") ymd = addDaysYmd(thisMonday, idx);
    else if (week === "다음주" || week === "담주") ymd = addDaysYmd(thisMonday, 7 + idx);
    else if (week === "다다음주") ymd = addDaysYmd(thisMonday, 14 + idx);
    else {
      // 주를 말하지 않은 요일은 오늘 이후 가장 가까운 그 요일(오늘 포함)
      const diff = (idx - weekdayIndex(today) + 7) % 7;
      ymd = addDaysYmd(today, diff);
    }
    push(m.index, m[0].length, ymd);
  }
  for (const m of text.matchAll(/(이번\s*주|다음\s*주|담주)\s*말|(이번|다음)\s*주말/g)) {
    const word = (m[1] || m[2] || "").replace(/\s+/g, "");
    const next = word.startsWith("다음") || word === "담주";
    let ymd = addDaysYmd(thisMonday, (next ? 7 : 0) + 5);
    if (ymd < today) ymd = today; // 일요일에 "이번 주말"이라고 하면 오늘
    push(m.index, m[0].length, ymd, { weekend: true });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * 문장에서 대여 기간을 읽는다. 날짜를 하나도 찾지 못하면 null.
 * @returns {{ start: string, end: string } | null}
 */
export function parseRentalDates(text, today) {
  const raw = String(text || "");
  if (!raw.trim() || !YMD.test(String(today || ""))) return null;
  const dates = collectDates(raw, today);
  if (!dates.length) return null;
  const start = dates[0].ymd;
  if (dates.length >= 2 && dates[1].ymd >= start) {
    return { start, end: dates[1].ymd };
  }
  const duration = readDuration(raw);
  if (duration > 1) return { start, end: addDaysYmd(start, duration - 1) };
  if (dates[0].weekend && !duration) {
    const sunday = addDaysYmd(mondayOf(start), 6);
    return { start, end: sunday };
  }
  return { start, end: start };
}

/** 날짜를 말하려는 흔적이 있는지(파서가 못 읽는 표현 포함). 모델이 채운 날짜를 믿어도 되는지 판단할 때 쓴다. */
export function hasDateSignal(text) {
  return /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*월\s*\d{1,2}|\d{1,2}\s*일\s*(?:부터|까지|에|~)|\d{1,2}\s*\/\s*\d{1,2}|오늘|내일|모레|글피|요일|주말|다음\s*주|이번\s*주|다음\s*달|이번\s*달|월초|월말|초순|중순|하순/.test(String(text || ""));
}

/** "날짜는 상관없이 먼저 보여줘"처럼 날짜 없이 둘러보길 분명히 원하는 말 */
export function wantsBrowseWithoutDate(text) {
  return /날짜\s*(?:는|가)?\s*(?:상관\s*없|무관|나중에|아직\s*(?:몰|안\s*정)|모르)|날짜\s*없이|아무\s*때나|언제든(?:지)?\s*(?:괜찮|상관)|일단\s*(?:매물|목록)?\s*(?:먼저\s*)?(?:보여|둘러)/.test(String(text || ""));
}

/**
 * 이번 말 → 앞선 사용자 말(최근 순) → 세션에 저장된 기간 → 화면 필터 기간 순으로 대여 기간을 정한다.
 * @returns {{ start: string, end: string, source: "message"|"history"|"session"|"screen" } | null}
 */
export function resolveRentalDates({ text = "", history = [], sessionSlots = null, uiCtx = {}, today }) {
  const fromText = parseRentalDates(text, today);
  if (fromText) return { ...fromText, source: "message" };
  const userTurns = (Array.isArray(history) ? history : [])
    .filter((item) => item?.role === "user" && typeof item.content === "string")
    .slice(-6)
    .reverse();
  for (const turn of userTurns) {
    const parsed = parseRentalDates(turn.content, today);
    if (parsed) return { ...parsed, source: "history" };
  }
  const slotStart = sessionSlots?.start;
  if (YMD.test(slotStart || "") && slotStart >= today) {
    const slotEnd = YMD.test(sessionSlots?.end || "") && sessionSlots.end >= slotStart ? sessionSlots.end : slotStart;
    return { start: slotStart, end: slotEnd, source: "session" };
  }
  if (YMD.test(uiCtx?.date || "")) {
    return { start: uiCtx.date, end: YMD.test(uiCtx?.dateEnd || "") && uiCtx.dateEnd >= uiCtx.date ? uiCtx.dateEnd : uiCtx.date, source: "screen" };
  }
  return null;
}
