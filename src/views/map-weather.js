import { MACHINE_BY_ID, listingCoords, distanceKm, haversineKm } from "../data/farm-machines.js";
import { applyModelSpecification } from "../data/machine-specifications.js";
import { getRegionCoords } from "../data/korea-regions.js";
import { $, escapeHtml, money, today, addDays, toast, getListingPhotoSrc, machineImage } from "../core/utils.js";
import { state, runtime, apiFetch, persist, statusLabel, statusClass } from "../core/store.js";

export const DEFAULT_KAKAO_JS_KEY = "1535434b57df672bac4c1ff9a9170589";
export const DEFAULT_KAKAO_REST_KEY = "6df1354c0ce056eef6569a59e1ed90c8";

export const VIVALDI_PARK_ORIGIN = {
  lat: 37.6456,
  lng: 127.6844,
  name: "홍천 비발디파크",
  address: "강원특별자치도 홍천군 서면 한치골길 262",
};

export const HONGCHEON_NEARBY_FARM = {
  id: "hc-vivaldi-1",
  region: "서면 팔봉리",
  farmName: "홍천 팔봉산 해바라기 농가",
  address: "강원특별자치도 홍천군 서면 팔봉리 712",
  lat: 37.6538,
  lng: 127.6942,
};

const HONGCHEON_RANDOM_PRESETS = [
  {
    machineType: "tractor",
    brand: "대동",
    title: "45마력 트랙터 · 로터리 포함",
    cropIds: ["pepper", "cabbage", "potato", "rice"],
    operations: ["till"],
    areaMin: 1000,
    areaMax: 18000,
    price: 130000,
    included: "로터리 작업기",
    description: "홍천 비발디파크 인근 팔봉산 해바라기 농가에서 바로 빌릴 수 있는 중형 트랙터입니다.",
    summary: "벼·고추·배추·감자 밭갈이에 적합한 45마력 트랙터입니다.",
  },
  {
    machineType: "cultivator",
    brand: "아세아",
    title: "8마력 다목적 관리기 · 두둑·로터리",
    cropIds: ["pepper", "cabbage", "potato"],
    operations: ["till", "ridge"],
    areaMin: 100,
    areaMax: 3500,
    price: 45000,
    included: "로터리·두둑 작업기",
    description: "초보 농부도 다루기 쉬운 홍천 팔봉산 농가 보유 관리기입니다.",
    summary: "고추·배추·감자 소규모 밭의 흙갈이와 두둑 성형에 쓰는 관리기입니다.",
  },
  {
    machineType: "ridgeMulcher",
    brand: "아세아",
    title: "두둑·비닐 멀칭 겸용 휴립피복기",
    cropIds: ["pepper", "cabbage", "potato"],
    operations: ["ridge", "mulch"],
    areaMin: 300,
    areaMax: 5000,
    price: 65000,
    included: "피복 롤러·배토판",
    description: "두둑 성형과 비닐 피복을 한 번에 처리하는 팔봉산 농가 장비입니다.",
    summary: "고추·배추·감자 밭 두둑과 멀칭 작업을 동시에 진행할 수 있습니다.",
  },
  {
    machineType: "ricePlanter",
    brand: "국제",
    title: "6조식 승용 이앙기",
    cropIds: ["rice"],
    operations: ["ricePlant"],
    areaMin: 1000,
    areaMax: 12000,
    price: 160000,
    included: "예비 모판 받침",
    description: "팔봉리 일대 논 작업에 투입되는 6조식 이앙기입니다.",
    summary: "벼 모내기에 쓰는 6조식 이앙기로 현장 시동 확인 후 대여 가능합니다.",
  },
  {
    machineType: "sprayer",
    brand: "한일",
    title: "이동식 동력 분무기 · 릴 호스 세트",
    cropIds: ["pepper", "cabbage", "potato", "rice"],
    operations: ["spray"],
    areaMin: 100,
    areaMax: 8000,
    price: 35000,
    included: "고압 호스·노즐",
    description: "노지 밭과 하우스 병해충 방제에 유용한 이동식 동력 분무기입니다.",
    summary: "고추·배추·감자 방제 작업용 동력 분무기입니다.",
  },
  {
    machineType: "potatoHarvester",
    brand: "태광",
    title: "감자 굴취기 · 진동 선별형",
    cropIds: ["potato"],
    operations: ["potatoHarvest"],
    areaMin: 400,
    areaMax: 9000,
    price: 85000,
    included: "굴취날·진동 선별판",
    description: "강원 홍천 밭 토질에 맞춰 세팅된 감자 수확 전용 굴취기입니다.",
    summary: "감자 손상을 줄이며 빠르게 수확할 수 있는 진동 선별 굴취기입니다.",
  },
  {
    machineType: "carrier",
    brand: "대동",
    title: "궤도형 동력 운반차 덤프",
    cropIds: ["pepper", "cabbage", "potato", "rice"],
    operations: ["transport"],
    areaMin: 100,
    areaMax: 18000,
    price: 55000,
    included: "적재함·경사로 판",
    description: "경사진 강원도 밭에서도 안정적으로 수확물을 나르는 궤도 운반차입니다.",
    summary: "경사지 수확물·자재 운반에 적합한 궤도형 동력 운반차입니다.",
  },
];

const kakaoAddressCache = new Map();

export async function resolveKakaoAddress(lat, lng, fallbackAddress = "") {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return fallbackAddress;
  const cacheKey = `${numLat.toFixed(5)},${numLng.toFixed(5)}`;
  if (kakaoAddressCache.has(cacheKey)) return kakaoAddressCache.get(cacheKey);

  const restKey = runtime.mapConfig?.kakaoRestApiKey || DEFAULT_KAKAO_REST_KEY;
  if (!restKey) return fallbackAddress;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${encodeURIComponent(numLng)}&y=${encodeURIComponent(numLat)}`,
      {
        headers: { Authorization: `KakaoAK ${restKey}` },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return fallbackAddress;
    const data = await res.json();
    const doc = data?.documents?.[0];
    const resolved = doc?.road_address?.address_name || doc?.address?.address_name || fallbackAddress;
    if (resolved) kakaoAddressCache.set(cacheKey, resolved);
    return resolved || fallbackAddress;
  } catch {
    return fallbackAddress;
  }
}

const hasCoord = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export function ensureHongcheonRandomListing({ randomize = false } = {}) {
  const existing = Array.isArray(runtime.catalog)
    ? runtime.catalog.find((item) => item.id === HONGCHEON_NEARBY_FARM.id)
    : null;

  // 서버 매물(hc-vivaldi-1)이 있으면 그것이 기준이다. 기종·제목·가격을 임의 프리셋으로 바꾸면 상세·예약·저장 값이
  // 서로 달라지므로(예: 13만원 트랙터가 4.5만원 관리기로 보임) 지도에 필요한 위치 정보만 비어 있을 때 채운다.
  if (existing) {
    const listing = {
      ...existing,
      farmName: existing.farmName || HONGCHEON_NEARBY_FARM.farmName,
      ownerName: existing.ownerName || existing.farmName || HONGCHEON_NEARBY_FARM.farmName,
      address: existing.address || HONGCHEON_NEARBY_FARM.address,
      lat: hasCoord(existing.lat) ? existing.lat : HONGCHEON_NEARBY_FARM.lat,
      lng: hasCoord(existing.lng) ? existing.lng : HONGCHEON_NEARBY_FARM.lng,
    };
    runtime.catalog = runtime.catalog.map((item) => (item === existing ? listing : item));
    return listing;
  }

  // 서버 목록을 못 받았을 때만 지도용 대체 매물을 만든다. 무작위로 바꾸지 않고 서버 시드와 같은 트랙터를 쓴다.
  void randomize; // 예전 호출부 호환용: 더 이상 매물을 무작위로 바꾸지 않는다.
  const idx = 0;
  const preset = HONGCHEON_RANDOM_PRESETS[idx] || HONGCHEON_RANDOM_PRESETS[0];
  const baseItem = {
    id: HONGCHEON_NEARBY_FARM.id,
    type: "rent",
    title: `${preset.title} · ${HONGCHEON_NEARBY_FARM.farmName}`,
    brand: preset.brand,
    machineType: preset.machineType,
    cropIds: [...preset.cropIds],
    operations: [...preset.operations],
    areaMin: preset.areaMin,
    areaMax: preset.areaMax,
    price: preset.price,
    region: HONGCHEON_NEARBY_FARM.region,
    farmName: HONGCHEON_NEARBY_FARM.farmName,
    address: HONGCHEON_NEARBY_FARM.address,
    lat: HONGCHEON_NEARBY_FARM.lat,
    lng: HONGCHEON_NEARBY_FARM.lng,
    condition: "good",
    inspectedAt: "2026-11-10",
    included: preset.included,
    pickup: "홍천 비발디파크 인근 농가 직접 인수 · 운반 협의",
    description: preset.description,
    summary: preset.summary,
    booked: [],
    owner: false,
    ownerName: HONGCHEON_NEARBY_FARM.farmName,
    status: "open",
  };

  const withSpec = applyModelSpecification(baseItem, idx);
  const listing = {
    ...withSpec,
    title: baseItem.title,
    brand: preset.brand,
    included: preset.included,
    description: `${preset.description} (${withSpec.model ? `참조 모델: ${withSpec.brand} ${withSpec.model}` : "현장 점검 완료"})`,
    summary: preset.summary,
    farmName: HONGCHEON_NEARBY_FARM.farmName,
    address: HONGCHEON_NEARBY_FARM.address,
    lat: HONGCHEON_NEARBY_FARM.lat,
    lng: HONGCHEON_NEARBY_FARM.lng,
  };

  if (!Array.isArray(runtime.catalog)) runtime.catalog = [];
  const rest = runtime.catalog.filter((item) => item.id !== HONGCHEON_NEARBY_FARM.id);
  runtime.catalog = [listing, ...rest];
  return listing;
}

const WEATHER_ICONS = {
  sun: "☀️",
  cloud: "⛅",
  rain: "🌧️",
  wind: "💨",
  snow: "❄️",
};

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

let kakaoSdkPromise = null;
let lastWeatherKey = "";

function formatShortDateLabel(ymd, baseToday = today()) {
  if (ymd === baseToday) return `오늘 (${ymd.slice(5).replace("-", "/")})`;
  if (ymd === addDays(baseToday, 1)) return `내일 (${ymd.slice(5).replace("-", "/")})`;
  if (ymd === addDays(baseToday, 2)) return `모레 (${ymd.slice(5).replace("-", "/")})`;
  const d = new Date(`${ymd}T12:00:00+09:00`);
  const wd = Number.isNaN(d.getTime()) ? "" : WEEKDAY_KO[d.getUTCDay()];
  return `${ymd.slice(5).replace("-", "/")} (${wd})`;
}

function suitabilityLabel(suitability) {
  if (suitability === "caution") return "작업 주의";
  if (suitability === "wind") return "강풍 주의";
  return "작업 적합";
}

function loadKakaoSdk(appKey) {
  if (window.kakao?.maps) return Promise.resolve(window.kakao.maps);
  if (kakaoSdkPromise) return kakaoSdkPromise;
  kakaoSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.async = true;
    script.onload = () => {
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => resolve(window.kakao.maps));
      } else {
        kakaoSdkPromise = null;
        reject(new Error("Kakao Maps SDK load failed"));
      }
    };
    script.onerror = () => {
      kakaoSdkPromise = null;
      reject(new Error("Kakao Maps SDK network error"));
    };
    document.head.appendChild(script);
  });
  return kakaoSdkPromise;
}

function validUserCoords() {
  const c = state.userCoords || runtime.userCoords;
  if (c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))) {
    return { lat: Number(c.lat), lng: Number(c.lng) };
  }
  return null;
}

export async function refreshWeatherAndMapConfig({ onUpdate } = {}) {
  const targetDate = state.filters.date || today();
  const gps = validUserCoords();
  const key = gps
    ? `${state.region}:${gps.lat.toFixed(3)},${gps.lng.toFixed(3)}:${targetDate}`
    : `${state.region}:${targetDate}`;
  if (key === lastWeatherKey && runtime.weatherData) return runtime.weatherData;
  lastWeatherKey = key;

  try {
    const params = new URLSearchParams({ region: state.region, date: targetDate, days: "5" });
    if (gps) {
      params.set("lat", String(gps.lat));
      params.set("lng", String(gps.lng));
    }
    const data = await apiFetch(`/api/weather?${params.toString()}`, { timeoutMs: 5000 });
    if (data?.weather) runtime.weatherData = data.weather;
    if (Array.isArray(data?.forecastDays)) {
      runtime.forecastDays = data.forecastDays;
      const hasCurrent = data.forecastDays.some((d) => d.date === runtime.selectedForecastDate);
      if (!hasCurrent) {
        runtime.selectedForecastDate = data.forecastDays.some((d) => d.date === targetDate)
          ? targetDate
          : (data.forecastDays[0]?.date || "");
      }
    }
    if (data?.mapConfig) runtime.mapConfig = data.mapConfig;
    onUpdate?.();
    return data;
  } catch {
    return null;
  }
}

export function renderWeatherBanner({ onSelectDate } = {}) {
  const host = $("rentalWeatherBanner");
  if (!host) return;

  if (state.transaction !== "rent") {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }

  const w = runtime.weatherData;
  if (!w) {
    host.hidden = true;
    return;
  }

  const targetDate = state.filters.date || today();
  const isSelectedDate = Boolean(state.filters.date);
  const icon = WEATHER_ICONS[w.icon] || "🌤️";
  const toneClass = w.suitability === "caution" ? "is-caution" : w.suitability === "wind" ? "is-wind" : "is-good";
  const tempText = Number.isFinite(w.tempMin) && Number.isFinite(w.tempMax) ? `${w.tempMin}° ~ ${w.tempMax}°C` : "";
  const days = Array.isArray(runtime.forecastDays) && runtime.forecastDays.length ? runtime.forecastDays : [w];
  const activeDay = days.find((d) => d.date === runtime.selectedForecastDate) || days[0] || w;
  const activeDayTone = activeDay.suitability === "caution" ? "is-caution" : activeDay.suitability === "wind" ? "is-wind" : "is-good";

  host.hidden = false;
  host.className = `rental-weather-banner ${toneClass}${runtime.weatherExpanded ? " is-expanded" : ""}`;
  host.innerHTML = `
    <div class="rwb-top-row" id="weatherBannerToggle" role="button" tabindex="0" aria-expanded="${runtime.weatherExpanded ? "true" : "false"}" style="cursor: pointer;">
      <div class="rwb-main">
        <span class="rwb-icon" data-weather-icon="${escapeHtml(w.icon || "sun")}" aria-hidden="true">${icon}</span>
        <div class="rwb-copy">
          <div class="rwb-title-row">
            <strong>${escapeHtml(w.region)} ${isSelectedDate ? escapeHtml(targetDate) : "오늘"} 작업 날씨 · ${escapeHtml(w.summary)}</strong>
            <span class="rwb-source-pill">${escapeHtml(w.sourceLabel || (w.source === "kma" ? "기상청 단기예보" : "예시 기상 안내"))}</span>
          </div>
          <p class="rwb-advice">${escapeHtml(w.advice)}</p>
        </div>
      </div>
      <div class="rwb-right">
        <div class="rwb-metrics">
          ${tempText ? `<span class="rwb-metric">${escapeHtml(tempText)}</span>` : ""}
          <span class="rwb-metric">강수확률 ${Number(w.pop) || 0}%</span>
          <span class="rwb-metric">풍속 ${Number(w.windSpeed) || 0}m/s</span>
          ${Number.isFinite(w.humidity) ? `<span class="rwb-metric">습도 ${w.humidity}%</span>` : ""}
        </div>
      </div>
    </div>
    ${
      runtime.weatherExpanded
        ? `
      <div class="rwb-detail-panel" id="weatherDetailPanel">
        <div class="rwb-days-strip" role="tablist" aria-label="날짜별 날씨 예보">
          ${days
            .map((d, idx) => {
              const dIcon = WEATHER_ICONS[d.icon] || "🌤️";
              const isSelected = d.date === activeDay.date;
              const dTone = d.suitability === "caution" ? "is-caution" : d.suitability === "wind" ? "is-wind" : "is-good";
              return `
                <button
                  type="button"
                  role="tab"
                  aria-selected="${isSelected ? "true" : "false"}"
                  class="rwb-day-card ${dTone}${isSelected ? " is-active" : ""}"
                  data-forecast-date="${escapeHtml(d.date)}"
                  style="--stagger-i: ${Math.min(idx, 12)}"
                >
                  <span class="rwb-day-label">${escapeHtml(formatShortDateLabel(d.date))}</span>
                  <span class="rwb-day-icon" data-weather-icon="${escapeHtml(d.icon || "sun")}" aria-hidden="true">${dIcon}</span>
                  <strong class="rwb-day-temp">${Number.isFinite(d.tempMin) ? `${d.tempMin}°` : "-"} / ${Number.isFinite(d.tempMax) ? `${d.tempMax}°` : "-"}</strong>
                  <span class="rwb-day-meta">강수 ${Number(d.pop) || 0}% · ${escapeHtml(suitabilityLabel(d.suitability))}</span>
                  ${!d.inShortTermRange ? `<span class="rwb-day-range-note">참고 예보</span>` : ""}
                </button>
              `;
            })
            .join("")}
        </div>
        <div class="rwb-day-detail ${activeDayTone}">
          <div class="rwb-day-detail-head">
            <div>
              <strong>${escapeHtml(formatShortDateLabel(activeDay.date))} 상세 예보 · ${escapeHtml(activeDay.summary)}</strong>
              <span class="rwb-day-sub">${escapeHtml(activeDay.rainAmount || "강수 없음")} · 풍속 ${Number(activeDay.windSpeed) || 0}m/s${Number.isFinite(activeDay.humidity) ? ` · 습도 ${activeDay.humidity}%` : ""}</span>
            </div>
            ${
              state.filters.date !== activeDay.date
                ? `<button type="button" class="button button-secondary button-sm" id="applyForecastDateBtn" data-apply-date="${escapeHtml(activeDay.date)}">이 날짜로 매물 보기</button>`
                : `<span class="rwb-applied-badge">현재 선택된 날짜</span>`
            }
          </div>
          ${
            Array.isArray(activeDay.slots) && activeDay.slots.length
              ? `<div class="rwb-slots-grid" aria-label="시간대별 예보">
                  ${activeDay.slots
                    .map(
                      (s, idx) => `
                    <div class="rwb-slot-card" style="--stagger-i: ${Math.min(idx, 12)}">
                      <span class="rwb-slot-time">${escapeHtml(s.timeLabel)}</span>
                      <span class="rwb-slot-icon" data-weather-icon="${escapeHtml(s.icon || "sun")}" aria-hidden="true">${WEATHER_ICONS[s.icon] || "🌤️"}</span>
                      <strong class="rwb-slot-temp">${Number.isFinite(s.temp) ? `${s.temp}°C` : "-"}</strong>
                      <span class="rwb-slot-meta">강수 ${Number(s.pop) || 0}%</span>
                      <span class="rwb-slot-meta">${Number(s.windSpeed) || 0}m/s</span>
                    </div>`
                    )
                    .join("")}
                </div>`
              : ""
          }
          ${
            Array.isArray(activeDay.workTips) && activeDay.workTips.length
              ? `<div class="rwb-work-tips">
                  ${activeDay.workTips
                    .map(
                      (tip, idx) => `
                    <span class="rwb-work-pill is-${escapeHtml(tip.status)}" style="--stagger-i: ${Math.min(idx, 12)}">
                      <strong>${escapeHtml(tip.label)}</strong> · ${escapeHtml(tip.note)}
                    </span>`
                    )
                    .join("")}
                </div>`
              : ""
          }
        </div>
      </div>`
        : ""
    }
  `;

  const weatherToggle = $("weatherBannerToggle");
  const toggleWeather = () => {
    runtime.weatherExpanded = !runtime.weatherExpanded;
    renderWeatherBanner({ onSelectDate });
  };
  weatherToggle?.addEventListener("click", toggleWeather);
  weatherToggle?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleWeather();
    }
  });

  host.querySelectorAll("[data-forecast-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      runtime.selectedForecastDate = btn.dataset.forecastDate;
      renderWeatherBanner({ onSelectDate });
    });
  });

  $("applyForecastDateBtn")?.addEventListener("click", (event) => {
    const chosen = event.currentTarget.dataset.applyDate;
    if (!chosen) return;
    if (typeof onSelectDate === "function") {
      onSelectDate(chosen);
    } else {
      state.filters.date = chosen;
      state.filters.dateEnd = chosen;
      const qStart = $("quickDateInput");
      const qEnd = $("quickDateEndInput");
      if (qStart) qStart.value = chosen;
      if (qEnd) qEnd.value = chosen;
      lastWeatherKey = "";
      refreshWeatherAndMapConfig({ onUpdate: () => renderWeatherBanner({ onSelectDate }) });
    }
    toast(`${chosen} 날짜 기준으로 대여 가능 매물을 표시합니다.`);
  });
}

export function weatherDetailNote() {
  const w = runtime.weatherData;
  if (!w || state.transaction !== "rent") return "";
  const icon = WEATHER_ICONS[w.icon] || "🌤️";
  const toneClass = w.suitability === "caution" ? "is-caution" : w.suitability === "wind" ? "is-wind" : "is-good";
  const upcoming = Array.isArray(runtime.forecastDays) ? runtime.forecastDays.slice(0, 4) : [];
  return `
    <div class="detail-weather-note ${toneClass}">
      <div class="dwn-top">
        <span class="dwn-icon" data-weather-icon="${escapeHtml(w.icon || "sun")}" aria-hidden="true">${icon}</span>
        <div>
          <strong>${escapeHtml(w.region)} (${escapeHtml(w.date)}) · ${escapeHtml(w.summary)} · 강수확률 ${Number(w.pop) || 0}% · 풍속 ${Number(w.windSpeed) || 0}m/s</strong>
          <p>${escapeHtml(w.advice)}</p>
        </div>
      </div>
      ${
        upcoming.length > 1
          ? `<div class="dwn-mini-strip" aria-label="가까운 날짜 예보">
              ${upcoming
                .map(
                  (d, idx) => `
                <span class="dwn-mini-day is-${d.suitability === "caution" ? "caution" : d.suitability === "wind" ? "wind" : "good"}" style="--stagger-i: ${Math.min(idx, 12)}">
                  <span>${escapeHtml(formatShortDateLabel(d.date))}</span>
                  <span><span class="dwn-mini-icon" data-weather-icon="${escapeHtml(d.icon || "sun")}" aria-hidden="true">${WEATHER_ICONS[d.icon] || "🌤️"}</span> ${Number.isFinite(d.tempMin) ? `${d.tempMin}°~${d.tempMax}°` : ""}</span>
                  <span>강수 ${Number(d.pop) || 0}%</span>
                </span>`
                )
                .join("")}
            </div>`
          : ""
      }
    </div>
  `;
}

export async function renderBookingWeatherPanel(container, { region, start, end } = {}) {
  if (!container) return;
  if (!start || !end || end < start) {
    container.innerHTML = "";
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.innerHTML = `<div class="rbw-loading">선택한 대여 기간(${escapeHtml(start)} ~ ${escapeHtml(end)})의 작업 날씨 예보를 확인하는 중...</div>`;

  try {
    const params = new URLSearchParams({ region: region || state.region, date: start, endDate: end });
    const data = await apiFetch(`/api/weather?${params.toString()}`, { timeoutMs: 5000 });
    const days = Array.isArray(data?.rangeForecast) ? data.rangeForecast : [];
    if (!days.length) {
      container.innerHTML = "";
      container.hidden = true;
      return;
    }

    const forecastAvailableDays = days.filter((d) => d.inShortTermRange);
    const hasCaution = forecastAvailableDays.some((d) => d.suitability === "caution" || d.suitability === "wind");
    const hasOutOfRange = days.some((d) => !d.inShortTermRange);

    container.innerHTML = `
      <div class="rbw-box ${hasCaution ? "is-caution" : "is-good"}">
        <div class="rbw-header">
          <strong>🌦️ ${escapeHtml(data.region || region)} 대여 기간 작업 날씨</strong>
          <span class="rbw-badge">
            ${
              forecastAvailableDays.length
                ? hasCaution
                  ? "주의 예보 포함"
                  : "예보 확인 가능"
                : "단기예보 범위 외"
            }
          </span>
        </div>
        <p class="rbw-summary-note">
          ${
            !forecastAvailableDays.length
              ? "선택한 날짜는 단기예보 제공 범위(오늘~3일 후)를 벗어나 계절 참고 기온만 표시됩니다."
              : hasCaution
                ? "예보가 나온 날 중 비·눈 또는 강풍 주의가 포함된 날이 있습니다. 작업 일정과 안전 준비를 확인하세요."
                : "예보가 나온 날은 농작업하기 무난한 날씨입니다."
          }
          ${forecastAvailableDays.length && hasOutOfRange ? " (이후 날짜는 단기예보 범위 외)" : ""}
        </p>
        <div class="rbw-days">
          ${days
            .map((d, idx) => {
              const dIcon = WEATHER_ICONS[d.icon] || "🌤️";
              const staggerStyle = `style="--stagger-i: ${Math.min(idx, 12)}"`;
              if (!d.inShortTermRange) {
                return `
                  <div class="rbw-day-row is-out-of-range" ${staggerStyle}>
                    <div class="rbw-day-date">
                      <strong>${escapeHtml(formatShortDateLabel(d.date))}</strong>
                      <span class="rbw-pill-muted">예보 범위 외</span>
                    </div>
                    <div class="rbw-day-info">
                      <span>단기예보 미제공 기간 (계절 참고 ${Number.isFinite(d.tempMin) ? `${d.tempMin}°~${d.tempMax}°C` : ""})</span>
                    </div>
                  </div>
                `;
              }
              const tone = d.suitability === "caution" ? "is-caution" : d.suitability === "wind" ? "is-wind" : "is-good";
              return `
                <div class="rbw-day-row ${tone}" ${staggerStyle}>
                  <div class="rbw-day-date">
                    <strong>${escapeHtml(formatShortDateLabel(d.date))}</strong>
                    <span class="rbw-pill-${tone}">${escapeHtml(suitabilityLabel(d.suitability))}</span>
                  </div>
                  <div class="rbw-day-info">
                    <span class="rbw-day-icon" data-weather-icon="${escapeHtml(d.icon || "sun")}" aria-hidden="true">${dIcon}</span>
                    <strong>${escapeHtml(d.summary)}</strong>
                    <span>${Number.isFinite(d.tempMin) ? `${d.tempMin}°~${d.tempMax}°C` : ""}</span>
                    <span>강수 ${Number(d.pop) || 0}%</span>
                    <span>풍속 ${Number(d.windSpeed) || 0}m/s</span>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  } catch {
    container.innerHTML = `<div class="rbw-loading">날씨 예보를 불러오지 못했습니다. 예약 신청은 그대로 진행할 수 있습니다.</div>`;
  }
}

function activeOriginCoords() {
  const gps = validUserCoords();
  if (gps) return gps;
  return getRegionCoords(state.region);
}

export function activeDistanceOrigin() {
  const gps = validUserCoords();
  if (gps) return gps;
  return getRegionCoords(state.region);
}

function renderMapError(container, message, { onRetry, onSwitchToList } = {}) {
  container.innerHTML = `
    <div class="map-error-box" role="alert">
      <strong>지도를 불러올 수 없습니다</strong>
      <p>${escapeHtml(message)}</p>
      <div class="map-error-actions">
        <button type="button" class="button button-secondary" id="mapRetryBtn">다시 시도</button>
        <button type="button" class="button button-primary" id="mapBackToListBtn">목록 보기로 전환</button>
      </div>
    </div>
  `;
  $("mapRetryBtn")?.addEventListener("click", () => onRetry?.());
  $("mapBackToListBtn")?.addEventListener("click", () => onSwitchToList?.());
}

async function renderKakaoMap(container, items, appKey, { onOpenDetail, onRetry, onSwitchToList }) {
  container.innerHTML = `<div class="kakao-map-box" id="kakaoMapBox">지도를 불러오는 중...</div><div class="map-selected-card" id="mapSelectedCard"></div>`;
  try {
    const maps = await loadKakaoSdk(appKey);
    const box = $("kakaoMapBox");
    if (!box) return;
    const origin = activeOriginCoords();
    const originPos = new maps.LatLng(origin.lat, origin.lng);
    const map = new maps.Map(box, {
      center: originPos,
      level: 7,
    });
    const bounds = new maps.LatLngBounds();
    bounds.extend(originPos);

    new maps.Marker({
      map,
      position: originPos,
      title: validUserCoords() ? "내 GPS 위치" : `내 동네 (${state.region})`,
    });

    const originArg = activeDistanceOrigin();

    const updateSelectedCard = (item) => {
      const cardEl = $("mapSelectedCard");
      if (!cardEl || !item) return;
      cardEl.innerHTML = `
        <div class="msc-info">
          <span class="msc-region">${escapeHtml(item.region)} · ${distanceKm(originArg, item.region, item.id)}km · ${escapeHtml(MACHINE_BY_ID[item.machineType]?.label || "")}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="msc-price">${money(item.price)}${item.type === "rent" ? " / 1일" : ""}</span>
        </div>
        <button type="button" class="button button-primary" id="mapOpenDetailBtn">상세 보기</button>
      `;
      cardEl.classList.remove("is-updated");
      void cardEl.offsetWidth;
      cardEl.classList.add("is-updated");
      $("mapOpenDetailBtn")?.addEventListener("click", () => onOpenDetail?.(item.id));
    };

    items.forEach((item) => {
      const c = listingCoords(item);
      const pos = new maps.LatLng(c.lat, c.lng);
      bounds.extend(pos);
      const marker = new maps.Marker({
        map,
        position: pos,
        title: item.title,
      });
      maps.event.addListener(marker, "click", () => {
        runtime.selectedMapListingId = item.id;
        updateSelectedCard(item);
      });
    });

    if (items.length > 0) {
      map.setBounds(bounds);
    }

    if (items[0]) updateSelectedCard(items.find((i) => i.id === runtime.selectedMapListingId) || items[0]);
  } catch {
    renderMapError(
      container,
      "지도 API 연결에 실패했습니다. 네트워크 상태나 도메인 허용 설정을 확인한 뒤 다시 시도해 주세요.",
      { onRetry, onSwitchToList }
    );
  }
}

export function renderListingMap(items, { onOpenDetail, onGpsUpdated } = {}) {
  const host = $("listingMapPanel");
  if (!host) return;
  if (state.viewMode !== "map") {
    host.hidden = true;
    return;
  }

  const hasGps = Boolean(validUserCoords());
  host.hidden = false;
  host.innerHTML = `
    <div class="map-toolbar">
      <div class="map-toolbar-info">
        <strong>매물 위치 지도</strong>
        <span>${hasGps ? "현재 GPS 위치 기준 거리 표시 중" : `${escapeHtml(state.region)} 중심 기준 직선거리(km)`}</span>
      </div>
      <div class="map-toolbar-actions">
        <button type="button" class="button button-secondary map-gps-btn" id="mapUseGpsBtn">
          ${hasGps ? "GPS 위치 다시 잡기" : "현재 위치(GPS)로 거리 계산"}
        </button>
        ${hasGps ? `<button type="button" class="button-reset-inline" id="mapClearGpsBtn">동네 기준으로 복원</button>` : ""}
      </div>
    </div>
    <div id="mapRenderArea" class="map-render-area"></div>
  `;

  $("mapUseGpsBtn")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      toast("이 브라우저에서는 위치 기능을 지원하지 않습니다.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ...(Number.isFinite(pos.coords.accuracy) ? { accuracy: Math.round(pos.coords.accuracy) } : {}),
          source: "gps",
        };
        state.userCoords = coords;
        runtime.userCoords = coords;
        persist();
        toast("현재 GPS 위치 기준으로 거리를 다시 계산했습니다.");
        onGpsUpdated?.();
      },
      () => {
        toast("위치 권한이 거부되어 선택한 동네 기준으로 표시합니다.");
      },
      { enableHighAccuracy: false, timeout: 6000 }
    );
  });

  $("mapClearGpsBtn")?.addEventListener("click", () => {
    state.userCoords = null;
    runtime.userCoords = null;
    persist();
    toast(`${state.region} 기준으로 거리를 복원했습니다.`);
    onGpsUpdated?.();
  });

  const renderArea = $("mapRenderArea");
  const onSwitchToList = () => $("viewModeList")?.click();
  const onRetry = () => {
    kakaoSdkPromise = null;
    lastWeatherKey = "";
    refreshWeatherAndMapConfig({ onUpdate: () => onGpsUpdated?.() });
  };

  const appKey = runtime.mapConfig?.kakaoAppKey || DEFAULT_KAKAO_JS_KEY;
  if (appKey) {
    renderKakaoMap(renderArea, items, appKey, { onOpenDetail, onRetry, onSwitchToList });
  } else {
    renderMapError(
      renderArea,
      "지도 API 서버와 연결되지 않았습니다. 환경 설정을 확인하거나 잠시 후 다시 시도해 주세요.",
      { onRetry, onSwitchToList }
    );
  }
}

export const HEADER_CLUSTER_STEPS = [
  { maxLevel: 4, km: 0.18, label: "개별 농가 핀" },
  { maxLevel: 5, km: 2.5, label: "반경 2.5km 통합" },
  { maxLevel: 6, km: 7, label: "반경 7km 통합" },
  { maxLevel: 7, km: 18, label: "반경 18km 통합" },
  { maxLevel: 8, km: 38, label: "시·군 통합 (38km)" },
  { maxLevel: 9, km: 75, label: "광역 통합 (75km)" },
  { maxLevel: 10, km: 140, label: "도·권역 통합 (140km)" },
  { maxLevel: 11, km: 240, label: "초광역 통합 (240km)" },
  { maxLevel: 99, km: 1000, label: "전국 1개 점 통합" },
];

export function getClusterThresholdKm(zoomLevel) {
  const lv = Number(zoomLevel) || 6;
  const matched = HEADER_CLUSTER_STEPS.find((step) => lv <= step.maxLevel);
  return matched || HEADER_CLUSTER_STEPS[HEADER_CLUSTER_STEPS.length - 1];
}

export function getHeaderMapAllItems(origin) {
  const catalog = Array.isArray(runtime.catalog) ? runtime.catalog : [];
  const openItems = catalog.filter((item) => item.status === "open");
  const list = openItems.length ? openItems : [ensureHongcheonRandomListing({ randomize: false })];
  return [...list].sort((a, b) => distanceKm(origin, a, a.id) - distanceKm(origin, b, b.id));
}

function buildClusterLabel(regionCounts, count) {
  const entries = [...regionCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topRegion = entries[0]?.[0] || "주변";
  if (entries.length <= 1) return count > 1 ? `${topRegion} 일대` : topRegion;
  return `${topRegion} 외 ${entries.length - 1}곳 통합`;
}

export function clusterListingsByZoom(items, zoomLevel, origin) {
  const list = Array.isArray(items) ? items : [];
  const entries = list.map((item) => {
    const coords = listingCoords(item, item.id);
    return {
      item,
      lat: coords.lat,
      lng: coords.lng,
      distKm: origin ? distanceKm(origin, item, item.id) : 0,
    };
  });
  if (!entries.length) return [];

  const step = getClusterThresholdKm(zoomLevel);
  if (Number(zoomLevel) >= 12) {
    let latSum = 0;
    let lngSum = 0;
    const regionCounts = new Map();
    entries.forEach(({ item, lat, lng }) => {
      latSum += lat;
      lngSum += lng;
      const r = item.region || "기타";
      regionCounts.set(r, (regionCounts.get(r) || 0) + 1);
    });
    const sortedItems = entries.sort((a, b) => a.distKm - b.distKm).map((e) => e.item);
    return [
      {
        id: "cluster-all-kr",
        lat: latSum / entries.length,
        lng: lngSum / entries.length,
        count: sortedItems.length,
        isAllCluster: true,
        label: sortedItems.length > 1 ? "전국 통합 매물" : (sortedItems[0].region || "매물"),
        items: sortedItems,
        boundsPoints: entries.map((e) => ({ lat: e.lat, lng: e.lng })),
      },
    ];
  }

  const degLatBound = step.km / 110.574;
  const degLngBound = step.km / 88.0;
  const clusters = [];

  for (const entry of entries) {
    let nearestCluster = null;
    let nearestDist = Infinity;

    for (const cl of clusters) {
      if (Math.abs(entry.lat - cl.lat) > degLatBound || Math.abs(entry.lng - cl.lng) > degLngBound) {
        continue;
      }
      const d = haversineKm({ lat: entry.lat, lng: entry.lng }, { lat: cl.lat, lng: cl.lng });
      if (d <= step.km && d < nearestDist) {
        nearestDist = d;
        nearestCluster = cl;
      }
    }

    const rName = entry.item.region || "주변";
    if (nearestCluster) {
      const nextCount = nearestCluster.count + 1;
      nearestCluster.lat = (nearestCluster.lat * nearestCluster.count + entry.lat) / nextCount;
      nearestCluster.lng = (nearestCluster.lng * nearestCluster.count + entry.lng) / nextCount;
      nearestCluster.count = nextCount;
      nearestCluster.entries.push(entry);
      nearestCluster.regionCounts.set(rName, (nearestCluster.regionCounts.get(rName) || 0) + 1);
    } else {
      const regionCounts = new Map();
      regionCounts.set(rName, 1);
      clusters.push({
        id: `cl-${clusters.length + 1}`,
        lat: entry.lat,
        lng: entry.lng,
        count: 1,
        isAllCluster: false,
        entries: [entry],
        regionCounts,
      });
    }
  }

  return clusters.map((cl) => {
    cl.entries.sort((a, b) => a.distKm - b.distKm);
    return {
      id: cl.id,
      lat: cl.lat,
      lng: cl.lng,
      count: cl.count,
      isAllCluster: cl.count === entries.length && entries.length > 1,
      label: buildClusterLabel(cl.regionCounts, cl.count),
      items: cl.entries.map((e) => e.item),
      boundsPoints: cl.entries.map((e) => ({ lat: e.lat, lng: e.lng })),
    };
  });
}

function renderHeaderVisualFallback(
  canvasEl,
  origin,
  originLabel,
  allItems,
  selectedItem,
  { initialLevel = 6, onSelectItem, onOpenClusterSheet, onRecenterReset } = {}
) {
  let fallbackLevel = initialLevel;
  const originCoords = { lat: Number(origin.lat), lng: Number(origin.lng) };

  const projectAtLevel = (lat, lng, lv) => {
    const centerLat = lv >= 9 ? 36.45 : originCoords.lat;
    const centerLng = lv >= 9 ? 127.85 : originCoords.lng;
    const span = Math.pow(1.9, Math.max(0, lv - 5)) * 0.14;
    const x = Math.max(10, Math.min(90, 50 + ((Number(lng) - centerLng) / span) * 42));
    const y = Math.max(18, Math.min(82, 52 - ((Number(lat) - centerLat) / (span * 0.68)) * 42));
    return { x, y };
  };

  const paintFallback = () => {
    const step = getClusterThresholdKm(fallbackLevel);
    const clusters = clusterListingsByZoom(allItems, fallbackLevel, origin);
    const originPos = projectAtLevel(originCoords.lat, originCoords.lng, fallbackLevel);

    canvasEl.innerHTML = `
      <div class="header-map-visual-fallback" role="region" aria-label="주변 농기계 위치 안내 지도">
        <svg class="header-map-fallback-grid" viewBox="0 0 800 480" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id="headerMapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(23,66,51,0.06)" stroke-width="1" />
            </pattern>
          </defs>
          <rect width="800" height="480" fill="#eef4ee" />
          <rect width="800" height="480" fill="url(#headerMapGrid)" />
          <path d="M-20,380 C160,330 290,260 440,210 C590,160 700,110 830,80" fill="none" stroke="#ffffff" stroke-width="14" stroke-linecap="round" />
          <path d="M90,-20 C170,130 280,220 420,275 C570,335 690,410 770,500" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" />
          <path d="M40,120 Q280,175 490,90 T820,160" fill="none" stroke="#cfe6f5" stroke-width="18" stroke-linecap="round" opacity="0.7" />
        </svg>

        <div class="header-map-my-pin header-map-fallback-pin" style="left:${originPos.x.toFixed(1)}%;top:${originPos.y.toFixed(1)}%" title="${escapeHtml(originLabel)}">
          <span class="header-map-my-pulse"></span>
          <span class="header-map-my-dot"></span>
          <span class="header-map-my-badge">내 위치 · ${escapeHtml(originLabel)}</span>
        </div>

        ${clusters
          .map((cl, idx) => {
            const pos = projectAtLevel(cl.lat, cl.lng, fallbackLevel);
            if (cl.count === 1) {
              const item = cl.items[0];
              const machineLabel = MACHINE_BY_ID[item.machineType]?.label || "농기계";
              const active = item.id === selectedItem?.id;
              return `
                <button
                  type="button"
                  class="header-map-price-pin header-map-fallback-pin${active ? " is-active" : ""}"
                  style="left:${pos.x.toFixed(1)}%;top:${pos.y.toFixed(1)}%"
                  data-cluster-index="${idx}"
                >
                  <span class="header-map-pin-tag">${escapeHtml(machineLabel)}</span>
                  <strong>${money(item.price)}</strong>
                  <span class="header-map-pin-tail" aria-hidden="true"></span>
                </button>`;
            }
            const tierClass = cl.count >= 100 || cl.isAllCluster ? "is-major" : cl.count >= 20 ? "is-medium" : "is-minor";
            return `
              <button
                type="button"
                class="header-map-cluster-dot header-map-fallback-pin ${tierClass}"
                style="left:${pos.x.toFixed(1)}%;top:${pos.y.toFixed(1)}%"
                data-cluster-index="${idx}"
                aria-label="${escapeHtml(cl.label)} ${cl.count}대 통합 매물 전체 보기"
              >
                <span class="header-map-cluster-count">${cl.count.toLocaleString()}</span>
                <span class="header-map-cluster-sub">${cl.isAllCluster ? "전체 보기" : "대 통합"}</span>
                <span class="header-map-cluster-caption">${escapeHtml(cl.label)}</span>
              </button>`;
          })
          .join("")}

        <div class="header-map-zoom-controls">
          <span class="header-map-zoom-badge">Lv.${fallbackLevel} · ${escapeHtml(step.label)}</span>
          <div class="header-map-zoom-btn-group" role="group" aria-label="지도 확대 축소">
            <button type="button" class="header-map-zoom-btn" id="fallbackZoomIn" aria-label="지도 확대">+</button>
            <button type="button" class="header-map-zoom-btn" id="fallbackZoomOut" aria-label="지도 축소">−</button>
          </div>
        </div>
      </div>
    `;

    canvasEl.querySelectorAll("[data-cluster-index]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cl = clusters[Number(btn.dataset.clusterIndex)];
        if (!cl) return;
        if (cl.count === 1) {
          selectedItem = cl.items[0];
          canvasEl.querySelectorAll("[data-cluster-index]").forEach((el) => {
            const target = clusters[Number(el.dataset.clusterIndex)];
            el.classList.toggle("is-active", target?.count === 1 && target.items[0].id === selectedItem.id);
          });
          onSelectItem?.(selectedItem);
          return;
        }
        onOpenClusterSheet?.(cl, () => {
          fallbackLevel = Math.max(4, fallbackLevel - 2);
          paintFallback();
        });
      });
    });

    $("fallbackZoomIn")?.addEventListener("click", () => {
      fallbackLevel = Math.max(4, fallbackLevel - 1);
      paintFallback();
    });
    $("fallbackZoomOut")?.addEventListener("click", () => {
      fallbackLevel = Math.min(12, fallbackLevel + 1);
      paintFallback();
    });
  };

  paintFallback();
  return {
    resetView() {
      fallbackLevel = 6;
      paintFallback();
      onRecenterReset?.();
    },
  };
}

export async function renderHeaderMapView({ onOpenDetail, onRent } = {}) {
  const host = $("mapView");
  if (!host) return;

  const origin = activeOriginCoords();
  const isVivaldiOrigin =
    Math.abs(Number(origin.lat) - VIVALDI_PARK_ORIGIN.lat) < 0.02 &&
    Math.abs(Number(origin.lng) - VIVALDI_PARK_ORIGIN.lng) < 0.02;
  const originLabel = isVivaldiOrigin ? VIVALDI_PARK_ORIGIN.name : state.region || "내 위치";
  const fallbackOriginAddr = isVivaldiOrigin ? VIVALDI_PARK_ORIGIN.address : `${originLabel} 중심`;

  const allItems = getHeaderMapAllItems(origin);
  let selectedItem = runtime.selectedMapListingId
    ? allItems.find((i) => i.id === runtime.selectedMapListingId) || null
    : null;
  if (!selectedItem) runtime.selectedMapListingId = "";

  host.innerHTML = `
    <div class="header-map-stage${selectedItem ? " has-floating-card" : ""}" id="headerMapStage">
      <div class="header-map-floating-top">
        <div class="header-map-loc-pill">
          <span class="header-map-loc-dot" aria-hidden="true"></span>
          <div class="header-map-loc-copy">
            <strong>내 위치 · ${escapeHtml(originLabel)}</strong>
            <span id="headerMapOriginAddr">${escapeHtml(fallbackOriginAddr)}</span>
          </div>
        </div>
        <div class="header-map-top-actions">
          <button type="button" class="header-map-pill-btn header-map-all-btn" id="headerMapShowAllBtn">
            전체 ${allItems.length.toLocaleString()}건 보기
          </button>
          <button type="button" class="header-map-pill-btn header-map-recenter-btn" id="headerMapRecenterBtn">
            내 위치 중심
          </button>
        </div>
      </div>

      <div id="headerMapCanvas" class="header-map-canvas" aria-label="내 주변 농기계 지도">
        <div class="header-map-loading">농기계 지도를 불러오는 중...</div>
      </div>

      <div class="header-map-floating-card" id="headerMapFloatingCard" aria-live="polite"${selectedItem ? "" : " hidden"}></div>

      <div class="header-map-cluster-sheet" id="headerMapClusterSheet" role="dialog" aria-modal="false" aria-label="통합 점 전체 매물 목록" hidden></div>
    </div>
  `;

  const hideFloatingCard = () => {
    selectedItem = null;
    runtime.selectedMapListingId = "";
    $("headerMapStage")?.classList.remove("has-floating-card");
    const cardEl = $("headerMapFloatingCard");
    if (cardEl) {
      cardEl.hidden = true;
      cardEl.innerHTML = "";
    }
    $("headerMapCanvas")?.querySelectorAll(".header-map-price-pin.is-active").forEach((el) => {
      el.classList.remove("is-active");
    });
  };

  const renderFloatingCard = (item) => {
    const cardEl = $("headerMapFloatingCard");
    if (!cardEl || !item) return;
    $("headerMapStage")?.classList.add("has-floating-card");
    cardEl.hidden = false;
    const dist = distanceKm(origin, item, item.id);
    const machine = MACHINE_BY_ID[item.machineType];
    const photoSrc = getListingPhotoSrc(item) || machineImage(machine);
    const farmName = item.farmName || `${item.region} 농가`;
    const farmAddr = item.address || `${item.region} 인근`;
    const sClass = statusClass(item);

    cardEl.innerHTML = `
      <button type="button" class="header-map-card-close" id="headerMapCardCloseBtn" aria-label="선택 매물 창 닫기">×</button>
      <div class="header-map-card-media">
        <img src="${escapeHtml(photoSrc)}" alt="${escapeHtml(item.title)}" />
        <span class="header-map-card-dist">내 위치에서 ${dist}km</span>
      </div>
      <div class="header-map-card-body">
        <div class="header-map-card-tags">
          <span class="card-status-pill ${sClass}">${statusLabel(item)}</span>
          <span class="header-map-farm-pill">${escapeHtml(farmName)}</span>
          <span class="header-map-machine-pill">${escapeHtml(machine?.label || "농기계")}</span>
        </div>
        <h3 class="header-map-card-title">${escapeHtml(item.title)}</h3>
        <p class="header-map-card-addr" id="headerMapFarmAddr">${escapeHtml(farmAddr)}</p>
        <div class="header-map-card-bottom">
          <div class="header-map-card-price">
            <strong>${money(item.price)}</strong>
            <small>${item.type === "rent" ? "/ 1일 대여" : "중고 구매가"}</small>
          </div>
          <div class="header-map-card-actions">
            <button type="button" class="button button-secondary button-sm" id="headerMapDetailBtn">자세히 보기</button>
            <button type="button" class="button button-primary button-sm" id="headerMapRentBtn">${item.type === "rent" ? "바로 대여 신청" : "문의하기"}</button>
          </div>
        </div>
      </div>
    `;

    cardEl.classList.remove("is-updated");
    void cardEl.offsetWidth;
    cardEl.classList.add("is-updated");

    $("headerMapCardCloseBtn")?.addEventListener("click", hideFloatingCard);
    $("headerMapDetailBtn")?.addEventListener("click", () => onOpenDetail?.(item.id));
    $("headerMapRentBtn")?.addEventListener("click", () => onRent?.(item.id));

    const itemCoords = listingCoords(item, item.id);
    resolveKakaoAddress(itemCoords.lat, itemCoords.lng, farmAddr).then((addr) => {
      const addrEl = $("headerMapFarmAddr");
      if (addrEl && addr) addrEl.textContent = addr;
    });
  };

  const closeClusterSheet = () => {
    const sheetEl = $("headerMapClusterSheet");
    if (!sheetEl) return;
    sheetEl.hidden = true;
    sheetEl.innerHTML = "";
  };

  const openClusterSheet = (cluster, onZoomArea) => {
    const sheetEl = $("headerMapClusterSheet");
    if (!sheetEl || !cluster) return;
    let txFilter = "all";
    let queryText = "";
    let showAllRows = false;

    sheetEl.hidden = false;
    sheetEl.innerHTML = `
      <div class="header-map-cluster-sheet-head">
        <div class="header-map-cluster-sheet-title-wrap">
          <div class="header-map-cluster-sheet-badges">
            <span class="header-map-cluster-sheet-count">${cluster.count.toLocaleString()}대</span>
            <strong>${escapeHtml(cluster.label)} 전체 매물</strong>
          </div>
          <span>클릭한 통합 점에 포함된 모든 매물(거리순)입니다.</span>
        </div>
        <div class="header-map-cluster-sheet-head-actions">
          ${onZoomArea ? `<button type="button" class="button button-secondary button-sm" id="headerMapClusterZoomAreaBtn">이 구역 확대</button>` : ""}
          <button type="button" class="button button-primary button-sm" id="headerMapClusterSheetCloseBtn">닫기</button>
        </div>
      </div>
      <div class="header-map-cluster-sheet-filters">
        <input type="search" id="headerMapClusterSearchInput" class="header-map-cluster-search" placeholder="기종·지역·농가명으로 검색" aria-label="통합 매물 검색" />
        <div class="header-map-cluster-tx-tabs" role="group" aria-label="거래 유형 필터">
          <button type="button" class="header-map-tx-tab is-active" data-cluster-tx="all">전체</button>
          <button type="button" class="header-map-tx-tab" data-cluster-tx="rent">대여</button>
          <button type="button" class="header-map-tx-tab" data-cluster-tx="sale">판매</button>
        </div>
      </div>
      <div class="header-map-cluster-list" id="headerMapClusterList"></div>
    `;

    const paintSheetItems = () => {
      const listEl = $("headerMapClusterList");
      if (!listEl) return;
      const q = queryText.trim().toLowerCase();
      const filtered = cluster.items.filter((item) => {
        if (txFilter !== "all" && item.type !== txFilter) return false;
        if (q) {
          const hay = `${item.title || ""} ${item.region || ""} ${item.farmSpotLabel || ""} ${item.farmName || ""} ${MACHINE_BY_ID[item.machineType]?.label || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      if (!filtered.length) {
        listEl.innerHTML = `<div class="header-map-cluster-empty">조건에 맞는 매물이 없습니다.</div>`;
        return;
      }

      const initialLimit = 120;
      const visible = showAllRows ? filtered : filtered.slice(0, initialLimit);
      listEl.innerHTML =
        visible
          .map((item) => {
            const machine = MACHINE_BY_ID[item.machineType];
            const dist = distanceKm(origin, item, item.id);
            const sClass = statusClass(item);
            const spotLabel = item.farmSpotLabel || item.farmName || `${item.region || ""} 농가`;
            return `
              <article class="header-map-cluster-item">
                <div class="header-map-cluster-item-top">
                  <div class="header-map-cluster-item-tags">
                    <span class="card-status-pill ${sClass}">${statusLabel(item)}</span>
                    <span class="header-map-machine-pill">${escapeHtml(machine?.label || "농기계")}</span>
                  </div>
                  <span class="header-map-cluster-item-dist">${dist}km</span>
                </div>
                <h4 class="header-map-cluster-item-title">${escapeHtml(item.title)}</h4>
                <p class="header-map-cluster-item-spot">${escapeHtml(spotLabel)}</p>
                <div class="header-map-cluster-item-bottom">
                  <div class="header-map-cluster-item-price">
                    <strong>${money(item.price)}</strong>
                    <small>${item.type === "rent" ? "/ 1일" : "중고 구매가"}</small>
                  </div>
                  <div class="header-map-cluster-item-actions">
                    <button type="button" class="button button-secondary button-sm" data-cluster-detail="${escapeHtml(item.id)}">자세히</button>
                    <button type="button" class="button button-primary button-sm" data-cluster-rent="${escapeHtml(item.id)}">${item.type === "rent" ? "대여" : "문의"}</button>
                  </div>
                </div>
              </article>
            `;
          })
          .join("") +
        (!showAllRows && filtered.length > initialLimit
          ? `<div class="header-map-cluster-more-note">
              <span>상위 ${initialLimit}건 표시 중 (전체 ${filtered.length.toLocaleString()}건)</span>
              <button type="button" class="button button-secondary button-sm" id="headerMapShowMoreBtn">나머지 ${(filtered.length - initialLimit).toLocaleString()}건 모두 표시</button>
            </div>`
          : "");

      $("headerMapShowMoreBtn")?.addEventListener("click", () => {
        showAllRows = true;
        paintSheetItems();
      });
    };

    paintSheetItems();

    $("headerMapClusterSheetCloseBtn")?.addEventListener("click", closeClusterSheet);
    $("headerMapClusterZoomAreaBtn")?.addEventListener("click", () => {
      closeClusterSheet();
      onZoomArea?.();
    });
    $("headerMapClusterSearchInput")?.addEventListener("input", (e) => {
      queryText = e.target.value || "";
      paintSheetItems();
    });
    sheetEl.querySelectorAll("[data-cluster-tx]").forEach((tab) => {
      tab.addEventListener("click", () => {
        txFilter = tab.dataset.clusterTx || "all";
        sheetEl.querySelectorAll("[data-cluster-tx]").forEach((t) => {
          t.classList.toggle("is-active", t.dataset.clusterTx === txFilter);
        });
        paintSheetItems();
      });
    });
    $("headerMapClusterList")?.addEventListener("click", (e) => {
      const detailBtn = e.target.closest("[data-cluster-detail]");
      if (detailBtn) {
        onOpenDetail?.(detailBtn.dataset.clusterDetail);
        return;
      }
      const rentBtn = e.target.closest("[data-cluster-rent]");
      if (rentBtn) {
        onRent?.(rentBtn.dataset.clusterRent);
      }
    });
  };

  if (selectedItem) {
    renderFloatingCard(selectedItem);
  } else {
    hideFloatingCard();
  }

  resolveKakaoAddress(origin.lat, origin.lng, fallbackOriginAddr).then((addr) => {
    const el = $("headerMapOriginAddr");
    if (el && addr) el.textContent = addr;
  });

  $("headerMapShowAllBtn")?.addEventListener("click", () => {
    openClusterSheet({
      id: "cluster-all-button",
      label: "전국 전체",
      count: allItems.length,
      items: allItems,
      boundsPoints: [],
    });
  });

  const canvasEl = $("headerMapCanvas");
  const appKey = runtime.mapConfig?.kakaoAppKey || DEFAULT_KAKAO_JS_KEY;
  let activeMap = null;
  let originLatLng = null;
  let fallbackController = null;

  $("headerMapRecenterBtn")?.addEventListener("click", () => {
    closeClusterSheet();
    hideFloatingCard();
    if (activeMap && originLatLng) {
      activeMap.setLevel(6);
      activeMap.panTo(originLatLng);
      toast(`${originLabel} 중심으로 이동했습니다.`);
    } else if (fallbackController) {
      fallbackController.resetView();
    } else {
      state.region = VIVALDI_PARK_ORIGIN.name;
      state.userCoords = { lat: VIVALDI_PARK_ORIGIN.lat, lng: VIVALDI_PARK_ORIGIN.lng, source: "default" };
      runtime.userCoords = state.userCoords;
      persist();
      renderHeaderMapView({ onOpenDetail, onRent });
    }
  });

  try {
    const maps = await loadKakaoSdk(appKey);
    if (!canvasEl || $("headerMapCanvas") !== canvasEl) return;
    canvasEl.innerHTML = "";

    const mapStageEl = document.createElement("div");
    mapStageEl.className = "header-map-kakao-stage-box";
    canvasEl.appendChild(mapStageEl);

    const zoomControlWrap = document.createElement("div");
    zoomControlWrap.className = "header-map-zoom-controls";
    zoomControlWrap.innerHTML = `
      <span class="header-map-zoom-badge" id="headerMapZoomBadge">Lv.6 · 반경 7km 통합</span>
      <div class="header-map-zoom-btn-group" role="group" aria-label="지도 확대 축소">
        <button type="button" class="header-map-zoom-btn" id="headerMapZoomInBtn" aria-label="지도 확대">+</button>
        <button type="button" class="header-map-zoom-btn" id="headerMapZoomOutBtn" aria-label="지도 축소">−</button>
      </div>
    `;
    canvasEl.appendChild(zoomControlWrap);

    originLatLng = new maps.LatLng(Number(origin.lat), Number(origin.lng));
    activeMap = new maps.Map(mapStageEl, {
      center: originLatLng,
      level: 6,
    });

    const myOverlayEl = document.createElement("div");
    myOverlayEl.className = "header-map-my-pin";
    myOverlayEl.innerHTML = `
      <span class="header-map-my-pulse"></span>
      <span class="header-map-my-dot"></span>
      <span class="header-map-my-badge">내 위치 · ${escapeHtml(originLabel)}</span>
    `;
    new maps.CustomOverlay({
      map: activeMap,
      position: originLatLng,
      content: myOverlayEl,
      yAnchor: 0.5,
      zIndex: 4,
    });

    const pinElements = new Map();
    const activeOverlays = new Map();
    let cachedLevel = null;
    let cachedClusters = [];

    const createClusterOverlay = (cl) => {
      const pos = new maps.LatLng(cl.lat, cl.lng);

      if (cl.count === 1) {
        const item = cl.items[0];
        const machineLabel = MACHINE_BY_ID[item.machineType]?.label || "농기계";
        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = `header-map-price-pin${item.id === selectedItem?.id ? " is-active" : ""}`;
        pinBtn.innerHTML = `
          <span class="header-map-pin-tag">${escapeHtml(machineLabel)}</span>
          <strong>${money(item.price)}</strong>
          <span class="header-map-pin-tail" aria-hidden="true"></span>
        `;
        pinBtn.addEventListener("click", () => {
          closeClusterSheet();
          selectedItem = item;
          runtime.selectedMapListingId = item.id;
          pinElements.forEach((el, id) => el.classList.toggle("is-active", id === item.id));
          activeMap.panTo(pos);
          renderFloatingCard(item);
        });
        pinElements.set(item.id, pinBtn);

        return new maps.CustomOverlay({
          map: activeMap,
          position: pos,
          content: pinBtn,
          yAnchor: 1.15,
          zIndex: item.id === selectedItem?.id ? 6 : 5,
        });
      }

      const tierClass = cl.count >= 100 || cl.isAllCluster ? "is-major" : cl.count >= 20 ? "is-medium" : "is-minor";
      const dotBtn = document.createElement("button");
      dotBtn.type = "button";
      dotBtn.className = `header-map-cluster-dot ${tierClass}`;
      dotBtn.setAttribute("aria-label", `${cl.label} ${cl.count}대 통합 매물 전체 보기`);
      dotBtn.innerHTML = `
        <span class="header-map-cluster-count">${cl.count.toLocaleString()}</span>
        <span class="header-map-cluster-sub">${cl.isAllCluster ? "전체 보기" : "대 통합"}</span>
        <span class="header-map-cluster-caption">${escapeHtml(cl.label)}</span>
      `;
      dotBtn.addEventListener("click", () => {
        openClusterSheet(cl, () => {
          if (cl.boundsPoints?.length > 1) {
            const b = new maps.LatLngBounds();
            cl.boundsPoints.forEach((p) => b.extend(new maps.LatLng(p.lat, p.lng)));
            activeMap.setBounds(b, 60, 60, 140, 60);
          } else {
            activeMap.setLevel(Math.max(4, activeMap.getLevel() - 3), { animate: true });
            activeMap.panTo(pos);
          }
        });
      });

      return new maps.CustomOverlay({
        map: activeMap,
        position: pos,
        content: dotBtn,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: cl.isAllCluster ? 8 : 7,
      });
    };

    const syncOverlays = (forceRecluster = false) => {
      if (!activeMap || $("headerMapCanvas") !== canvasEl) return;
      const level = activeMap.getLevel();
      const step = getClusterThresholdKm(level);
      const badgeEl = $("headerMapZoomBadge");
      if (badgeEl) badgeEl.textContent = `Lv.${level} · ${step.label}`;

      if (forceRecluster || cachedLevel !== level) {
        activeOverlays.forEach((ov) => ov.setMap(null));
        activeOverlays.clear();
        pinElements.clear();
        cachedLevel = level;
        cachedClusters = clusterListingsByZoom(allItems, level, origin);
      }

      const viewport = activeMap.getBounds?.();
      const checkViewport = Boolean(viewport) && cachedClusters.length > 40;

      for (const cl of cachedClusters) {
        const pos = new maps.LatLng(cl.lat, cl.lng);
        const visible = !checkViewport || viewport.contain(pos);
        if (visible) {
          if (!activeOverlays.has(cl.id)) {
            activeOverlays.set(cl.id, createClusterOverlay(cl));
          }
        } else if (activeOverlays.has(cl.id)) {
          activeOverlays.get(cl.id).setMap(null);
          activeOverlays.delete(cl.id);
          if (cl.count === 1) pinElements.delete(cl.items[0].id);
        }
      }
    };

    syncOverlays(true);
    maps.event.addListener(activeMap, "click", hideFloatingCard);
    maps.event.addListener(activeMap, "zoom_changed", () => syncOverlays(true));
    maps.event.addListener(activeMap, "idle", () => syncOverlays(false));

    $("headerMapZoomInBtn")?.addEventListener("click", () => {
      activeMap.setLevel(Math.max(1, activeMap.getLevel() - 1), { animate: true });
    });
    $("headerMapZoomOutBtn")?.addEventListener("click", () => {
      activeMap.setLevel(Math.min(13, activeMap.getLevel() + 1), { animate: true });
    });
  } catch {
    if (canvasEl && $("headerMapCanvas")) {
      fallbackController = renderHeaderVisualFallback(canvasEl, origin, originLabel, allItems, selectedItem, {
        initialLevel: 6,
        onSelectItem: (chosen) => {
          closeClusterSheet();
          selectedItem = chosen;
          runtime.selectedMapListingId = chosen.id;
          renderFloatingCard(chosen);
        },
        onOpenClusterSheet: openClusterSheet,
        onRecenterReset: () => toast(`${originLabel} 중심으로 이동했습니다.`),
      });
    }
  }
}
