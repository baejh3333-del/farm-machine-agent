import { REGION_COORDS } from "../src/data/farm-machines.js";

const KMA_ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";
const CACHE_TTL_MS = 15 * 60 * 1000;
const weatherCache = new Map();

function kstTodayYmd() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function kstBaseDateTime() {
  // 기상청 단기예보 발표시각: 02, 05, 08, 11, 14, 17, 20, 23시 (발표 + 10분 이후 조회 가능)
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000 - 15 * 60 * 1000);
  const hour = kst.getUTCHours();
  const baseHours = [2, 5, 8, 11, 14, 17, 20, 23];
  let chosen = baseHours.filter((h) => h <= hour).pop();
  if (chosen === undefined) {
    kst.setUTCDate(kst.getUTCDate() - 1);
    chosen = 23;
  }
  const ymd = kst.toISOString().slice(0, 10).replace(/-/g, "");
  return { baseDate: ymd, baseTime: `${String(chosen).padStart(2, "0")}00` };
}

function addDaysYmd(ymd, offset) {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return ymd;
  return new Date(ms + offset * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(ymdA, ymdB) {
  const a = Date.parse(`${ymdA}T00:00:00Z`);
  const b = Date.parse(`${ymdB}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.round((b - a) / 86_400_000);
}

function assessFarmingWeather({ pop, pty, sky, windSpeed, tempMin, tempMax }) {
  if (pty === 3 || pty === 7) {
    return {
      icon: "snow",
      summary: "눈 예상",
      suitability: "caution",
      advice: "눈·결빙이 예상됩니다. 야외 작업과 농기계 이동 시 미끄럼 안전에 유의하세요.",
    };
  }
  if (pty > 0 || pop >= 60) {
    return {
      icon: "rain",
      summary: pty > 0 ? "비 예상" : `강수확률 ${pop}%`,
      suitability: "caution",
      advice: "비 예보가 있어 로터리·수확·약제 방제 작업 효율이 떨어질 수 있습니다. 일정 조율을 권장해요.",
    };
  }
  if (windSpeed >= 7) {
    return {
      icon: "wind",
      summary: `강풍 주의 (${windSpeed}m/s)`,
      suitability: "wind",
      advice: "바람이 강해 SS기·분무기 방제 시 약제 비산에 주의가 필요합니다.",
    };
  }
  if (sky === 4 || pop >= 40) {
    return {
      icon: "cloud",
      summary: "흐림",
      suitability: "good",
      advice: "큰 비 소식은 없으나 구름이 많습니다. 작업 전 현지 하늘 상태를 한 번 더 확인하세요.",
    };
  }
  const coldNote = Number.isFinite(tempMin) && tempMin <= 2 ? " 아침 저온에 시동 예열을 충분히 해주세요." : "";
  const hotNote = Number.isFinite(tempMax) && tempMax >= 30 ? " 한낮 고온 시 휴식과 냉각수 점검을 권장합니다." : "";
  return {
    icon: "sun",
    summary: sky === 3 ? "구름 조금" : "맑음",
    suitability: "good",
    advice: `농작업하기 무난한 날씨입니다.${coldNote}${hotNote}`,
  };
}

function buildWorkTips({ pop, pty, windSpeed, tempMin }) {
  const isWet = pty > 0 || pop >= 60;
  const isWindy = windSpeed >= 7;
  const isFrost = Number.isFinite(tempMin) && tempMin <= 0;
  return [
    {
      label: "경운·로터리",
      status: isWet ? "caution" : "good",
      note: isWet ? "토양 과습 주의" : "작업 적합",
    },
    {
      label: "약제 방제",
      status: isWet ? "caution" : isWindy ? "caution" : "good",
      note: isWet ? "우천 희석 우려" : isWindy ? "약제 비산 주의" : "작업 적합",
    },
    {
      label: "수확·운반",
      status: isWet ? "caution" : isFrost ? "caution" : "good",
      note: isWet ? "노면 미끄럼 주의" : isFrost ? "아침 서리 유의" : "작업 적합",
    },
  ];
}

function slotIconAndSummary({ pty, sky, pop, windSpeed }) {
  if (pty === 3 || pty === 7) return { icon: "snow", summary: "눈" };
  if (pty > 0 || pop >= 60) return { icon: "rain", summary: "비" };
  if (windSpeed >= 7) return { icon: "wind", summary: "강풍" };
  if (sky === 4) return { icon: "cloud", summary: "흐림" };
  if (sky === 3) return { icon: "cloud", summary: "구름많음" };
  return { icon: "sun", summary: "맑음" };
}

function buildFallbackSlots({ tempMin, tempMax, pop, pty, sky, windSpeed, seed }) {
  const times = [
    { time: "0600", label: "06시", tempRatio: 0.05, windFactor: 0.75 },
    { time: "0900", label: "09시", tempRatio: 0.4, windFactor: 0.9 },
    { time: "1200", label: "12시", tempRatio: 0.85, windFactor: 1.0 },
    { time: "1500", label: "15시", tempRatio: 1.0, windFactor: 1.05 },
    { time: "1800", label: "18시", tempRatio: 0.6, windFactor: 0.9 },
    { time: "2100", label: "21시", tempRatio: 0.25, windFactor: 0.75 },
  ];
  const span = Math.max(2, tempMax - tempMin);
  return times.map((t, idx) => {
    const temp = Math.round(tempMin + span * t.tempRatio);
    const slotPop = Math.max(0, Math.min(90, pop + ((seed + idx * 7) % 3 === 0 ? 0 : -10)));
    const slotPty = slotPop >= 60 ? pty : 0;
    const slotWind = Number(Math.max(0.8, windSpeed * t.windFactor).toFixed(1));
    const { icon, summary } = slotIconAndSummary({ pty: slotPty, sky, pop: slotPop, windSpeed: slotWind });
    return {
      time: t.time,
      timeLabel: t.label,
      temp,
      pop: slotPop,
      windSpeed: slotWind,
      icon,
      summary,
    };
  });
}

function buildFallbackForecast(region, date, { inShortTermRange = false, fallbackReason = "" } = {}) {
  const month = Number(String(date).slice(5, 7)) || 5;
  const day = Number(String(date).slice(8, 10)) || 15;
  const regionShift = Object.keys(REGION_COORDS).indexOf(region);
  const seed = (month * 31 + day * 7 + Math.max(0, regionShift) * 13) % 100;

  // 계절별 평균 기온 범위 (영양군 기준)
  const monthlyTemps = {
    1: [-7, 2], 2: [-5, 5], 3: [0, 11], 4: [5, 18], 5: [10, 23], 6: [15, 27],
    7: [20, 29], 8: [20, 30], 9: [14, 25], 10: [7, 19], 11: [1, 11], 12: [-5, 4],
  };
  const [baseMin, baseMax] = monthlyTemps[month] || [8, 20];
  const tempMin = baseMin + ((seed % 5) - 2);
  const tempMax = baseMax + ((seed % 5) - 2);
  const pop = seed < 18 ? 70 : seed < 38 ? 40 : 10;
  const pty = pop >= 60 ? (month === 1 || month === 2 || month === 12 ? 3 : 1) : 0;
  const sky = pop >= 60 ? 4 : pop >= 35 ? 3 : 1;
  const windSpeed = seed >= 82 ? 7.8 : Number((2.1 + (seed % 4) * 0.8).toFixed(1));
  const humidity = pop >= 60 ? 78 : pop >= 35 ? 62 : 48;
  const rainAmount = pty > 0 ? "5mm 내외" : "강수 없음";
  const assessed = assessFarmingWeather({ pop, pty, sky, windSpeed, tempMin, tempMax });
  const workTips = buildWorkTips({ pop, pty, windSpeed, tempMin });
  const slots = buildFallbackSlots({ tempMin, tempMax, pop, pty, sky, windSpeed, seed });

  return {
    source: "fallback",
    sourceLabel: inShortTermRange
      ? "예시 기상 안내 (기상청 API 키 미설정)"
      : "단기예보 범위 외 (계절 참고 안내)",
    hasLiveForecast: false,
    inShortTermRange,
    fallbackReason,
    date,
    region,
    tempMin,
    tempMax,
    pop,
    windSpeed,
    humidity,
    rainAmount,
    ...assessed,
    workTips,
    slots,
  };
}

function parseKmaDayItems(region, date, dayItems) {
  const temps = dayItems.filter((i) => i.category === "TMP").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
  const pops = dayItems.filter((i) => i.category === "POP").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
  const ptys = dayItems.filter((i) => i.category === "PTY").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
  const skys = dayItems.filter((i) => i.category === "SKY").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
  const winds = dayItems.filter((i) => i.category === "WSD").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
  const rehs = dayItems.filter((i) => i.category === "REH").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
  const pcps = dayItems.filter((i) => i.category === "PCP").map((i) => String(i.fcstValue || "").trim()).filter((v) => v && v !== "강수없음");

  const tempMin = temps.length ? Math.min(...temps) : null;
  const tempMax = temps.length ? Math.max(...temps) : null;
  const pop = pops.length ? Math.max(...pops) : 0;
  const pty = ptys.find((v) => v > 0) || 0;
  const sky = skys.length ? Math.max(...skys) : 1;
  const windSpeed = winds.length ? Number(Math.max(...winds).toFixed(1)) : 2.5;
  const humidity = rehs.length ? Math.round(rehs.reduce((a, b) => a + b, 0) / rehs.length) : null;
  const rainAmount = pcps.length ? pcps[0] : "강수 없음";
  const assessed = assessFarmingWeather({ pop, pty, sky, windSpeed, tempMin, tempMax });
  const workTips = buildWorkTips({ pop, pty, windSpeed, tempMin });

  // 주요 시간대별 슬롯 (06시, 09시, 12시, 15시, 18시, 21시 우선)
  const byTime = new Map();
  for (const item of dayItems) {
    if (!item.fcstTime) continue;
    let bucket = byTime.get(item.fcstTime);
    if (!bucket) {
      bucket = {};
      byTime.set(item.fcstTime, bucket);
    }
    bucket[item.category] = item.fcstValue;
  }
  const preferredTimes = ["0600", "0900", "1200", "1500", "1800", "2100"];
  const availableTimes = [...byTime.keys()].sort();
  const chosenTimes = preferredTimes.filter((t) => byTime.has(t));
  const finalTimes = chosenTimes.length >= 2 ? chosenTimes : availableTimes.filter((_, idx) => idx % 3 === 0).slice(0, 6);

  const slots = finalTimes.map((t) => {
    const b = byTime.get(t) || {};
    const slotTemp = Number.isFinite(Number(b.TMP)) ? Number(b.TMP) : null;
    const slotPop = Number.isFinite(Number(b.POP)) ? Number(b.POP) : 0;
    const slotPty = Number.isFinite(Number(b.PTY)) ? Number(b.PTY) : 0;
    const slotSky = Number.isFinite(Number(b.SKY)) ? Number(b.SKY) : sky;
    const slotWind = Number.isFinite(Number(b.WSD)) ? Number(Number(b.WSD).toFixed(1)) : windSpeed;
    const { icon, summary } = slotIconAndSummary({ pty: slotPty, sky: slotSky, pop: slotPop, windSpeed: slotWind });
    return {
      time: t,
      timeLabel: `${t.slice(0, 2)}시`,
      temp: slotTemp,
      pop: slotPop,
      windSpeed: slotWind,
      icon,
      summary,
    };
  });

  return {
    source: "kma",
    sourceLabel: "기상청 단기예보",
    hasLiveForecast: true,
    inShortTermRange: true,
    fallbackReason: "",
    date,
    region,
    tempMin,
    tempMax,
    pop,
    windSpeed,
    humidity,
    rainAmount,
    ...assessed,
    workTips,
    slots,
  };
}

async function fetchKmaForecastAllDays(region, apiKey) {
  const coords = REGION_COORDS[region] || REGION_COORDS["영양읍"];
  const { baseDate, baseTime } = kstBaseDateTime();

  // serviceKey는 이미 인코딩된 키와 디코딩된 키 모두 들어올 수 있어 그대로/인코딩 분기
  const encodedKey = apiKey.includes("%") ? apiKey : encodeURIComponent(apiKey);
  const url = `${KMA_ENDPOINT}?serviceKey=${encodedKey}&pageNo=1&numOfRows=1000&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${coords.nx}&ny=${coords.ny}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`KMA HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.response?.body?.items?.item;
    if (!Array.isArray(items) || !items.length) throw new Error("KMA empty items");

    const grouped = new Map();
    for (const item of items) {
      if (!item.fcstDate) continue;
      const ymd = `${item.fcstDate.slice(0, 4)}-${item.fcstDate.slice(4, 6)}-${item.fcstDate.slice(6, 8)}`;
      let list = grouped.get(ymd);
      if (!list) {
        list = [];
        grouped.set(ymd, list);
      }
      list.push(item);
    }

    const parsed = new Map();
    for (const [ymd, dayItems] of grouped.entries()) {
      parsed.set(ymd, parseKmaDayItems(region, ymd, dayItems));
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function getKmaMapForRegion(safeRegion, kmaApiKey) {
  if (!kmaApiKey) return { map: null, reason: "NO_KEY" };
  const cacheKey = `kma-all:${safeRegion}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { map: cached.value, reason: "" };
  }
  try {
    const map = await fetchKmaForecastAllDays(safeRegion, kmaApiKey);
    weatherCache.set(cacheKey, { at: Date.now(), value: map });
    return { map, reason: "" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "KMA_FETCH_ERROR";
    console.warn("KMA weather fetch failed, using fallback:", reason);
    return { map: null, reason };
  }
}

function resolveDayWeather(safeRegion, targetDate, todayYmd, kmaMap, kmaErrorReason) {
  const diff = daysBetween(todayYmd, targetDate);
  const inShortTermRange = diff >= 0 && diff <= 3;

  if (inShortTermRange && kmaMap?.has(targetDate)) {
    return kmaMap.get(targetDate);
  }

  const fallbackReason = kmaErrorReason || (!kmaMap ? "NO_KEY" : !inShortTermRange ? "OUT_OF_RANGE" : "NO_FORECAST_FOR_DATE");
  return buildFallbackForecast(safeRegion, targetDate, { inShortTermRange, fallbackReason });
}

export async function getWeatherAndMapConfig({ region = "영양읍", date = "", endDate = "", days = 5 } = {}) {
  const safeRegion = Object.hasOwn(REGION_COORDS, region) ? region : "영양읍";
  const todayYmd = kstTodayYmd();
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayYmd;
  const safeEndDate = /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= targetDate ? endDate : "";
  const safeDays = Math.min(7, Math.max(1, Number(days) || 5));

  const kakaoAppKey = String(process.env.KAKAO_MAP_JS_KEY || "").trim() || null;
  const kmaApiKey = String(process.env.KMA_WEATHER_API_KEY || "").trim() || null;

  const { map: kmaMap, reason: kmaErrorReason } = await getKmaMapForRegion(safeRegion, kmaApiKey);

  const weather = resolveDayWeather(safeRegion, targetDate, todayYmd, kmaMap, kmaErrorReason);

  const forecastDays = [];
  for (let i = 0; i < safeDays; i += 1) {
    const d = addDaysYmd(todayYmd, i);
    forecastDays.push(resolveDayWeather(safeRegion, d, todayYmd, kmaMap, kmaErrorReason));
  }

  let rangeForecast = null;
  if (safeEndDate) {
    const span = Math.min(14, Math.max(1, daysBetween(targetDate, safeEndDate) + 1));
    rangeForecast = [];
    for (let i = 0; i < span; i += 1) {
      const d = addDaysYmd(targetDate, i);
      rangeForecast.push(resolveDayWeather(safeRegion, d, todayYmd, kmaMap, kmaErrorReason));
    }
  }

  return {
    region: safeRegion,
    today: todayYmd,
    coords: REGION_COORDS[safeRegion],
    weather,
    forecastDays,
    rangeForecast,
    mapConfig: {
      provider: kakaoAppKey ? "kakao" : "unavailable",
      kakaoAppKey,
    },
  };
}
