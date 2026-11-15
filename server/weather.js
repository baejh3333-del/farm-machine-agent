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

function buildFallbackForecast(region, date) {
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
  const assessed = assessFarmingWeather({ pop, pty, sky, windSpeed, tempMin, tempMax });

  return {
    source: "fallback",
    sourceLabel: "예시 기상 안내 (기상청 API 키 미설정 또는 단기예보 범위 외)",
    date,
    region,
    tempMin,
    tempMax,
    pop,
    windSpeed,
    ...assessed,
  };
}

async function fetchKmaForecast(region, date, apiKey) {
  const coords = REGION_COORDS[region] || REGION_COORDS["영양읍"];
  const { baseDate, baseTime } = kstBaseDateTime();
  const targetYmd = date.replace(/-/g, "");

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

    const dayItems = items.filter((item) => item.fcstDate === targetYmd);
    if (!dayItems.length) return null;

    const temps = dayItems.filter((i) => i.category === "TMP").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
    const pops = dayItems.filter((i) => i.category === "POP").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
    const ptys = dayItems.filter((i) => i.category === "PTY").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
    const skys = dayItems.filter((i) => i.category === "SKY").map((i) => Number(i.fcstValue)).filter(Number.isFinite);
    const winds = dayItems.filter((i) => i.category === "WSD").map((i) => Number(i.fcstValue)).filter(Number.isFinite);

    const tempMin = temps.length ? Math.min(...temps) : null;
    const tempMax = temps.length ? Math.max(...temps) : null;
    const pop = pops.length ? Math.max(...pops) : 0;
    const pty = ptys.find((v) => v > 0) || 0;
    const sky = skys.length ? Math.max(...skys) : 1;
    const windSpeed = winds.length ? Number(Math.max(...winds).toFixed(1)) : 2.5;
    const assessed = assessFarmingWeather({ pop, pty, sky, windSpeed, tempMin, tempMax });

    return {
      source: "kma",
      sourceLabel: "기상청 단기예보",
      date,
      region,
      tempMin,
      tempMax,
      pop,
      windSpeed,
      ...assessed,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getWeatherAndMapConfig({ region = "영양읍", date = "" } = {}) {
  const safeRegion = Object.hasOwn(REGION_COORDS, region) ? region : "영양읍";
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : kstTodayYmd();
  const kakaoAppKey = String(process.env.KAKAO_MAP_JS_KEY || "").trim() || null;
  const kmaApiKey = String(process.env.KMA_WEATHER_API_KEY || "").trim() || null;

  const cacheKey = `${safeRegion}:${targetDate}:${Boolean(kmaApiKey)}`;
  const cached = weatherCache.get(cacheKey);
  let weather;

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    weather = cached.value;
  } else {
    const diff = daysBetween(kstTodayYmd(), targetDate);
    let fallbackReason = !kmaApiKey ? "NO_KEY" : diff < 0 || diff > 3 ? "OUT_OF_RANGE" : "";
    if (kmaApiKey && diff >= 0 && diff <= 3) {
      try {
        weather = await fetchKmaForecast(safeRegion, targetDate, kmaApiKey);
        if (!weather) fallbackReason = "NO_FORECAST_FOR_DATE";
      } catch (err) {
        fallbackReason = err instanceof Error ? err.message : "KMA_FETCH_ERROR";
        console.warn("KMA weather fetch failed, using fallback:", fallbackReason);
        weather = null;
      }
    }
    if (!weather) {
      weather = { ...buildFallbackForecast(safeRegion, targetDate), fallbackReason };
    }
    weatherCache.set(cacheKey, { at: Date.now(), value: weather });
  }

  return {
    region: safeRegion,
    coords: REGION_COORDS[safeRegion],
    weather,
    mapConfig: {
      provider: kakaoAppKey ? "kakao" : "unavailable",
      kakaoAppKey,
    },
  };
}
