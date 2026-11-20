import { MACHINE_BY_ID, listingCoords, distanceKm, haversineKm } from "../data/farm-machines.js";
import { applyModelSpecification } from "../data/machine-specifications.js";
import { DEFAULT_DEMO_RENTAL_OPTIONS } from "../data/rental-options.js";
import { getRegionCoords } from "../data/korea-regions.js";
import { $, escapeHtml, money, today, addDays, toast, getListingPhotoSrc, machineImage } from "../core/utils.js";
import { state, runtime, apiFetch, persist, statusLabel, statusClass } from "../core/store.js";
import publicRentalOffices from "../data/public-rental-offices.json" with { type: "json" };

const PUBLIC_RENTAL_SOURCE = "https://www.data.go.kr/data/15017325/standard.do";
let officeMapLibrary;
let fallbackOfficeMap;

function loadOfficeMapLibrary() {
  officeMapLibrary ??= new Promise((resolve, reject) => {
    const base = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet";
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${base}.css`;
    const script = document.createElement("script");
    script.src = `${base}.js`;
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.head.append(css, script);
  }).catch((error) => {
    officeMapLibrary = undefined;
    throw error;
  });
  return officeMapLibrary;
}
const PUBLIC_RENTAL_SITES = [
  ["경주시", "https://www.gyeongju.go.kr/agriculture/portal/page.do?menuId=10502"],
  ["고양시", "https://www.goyang.go.kr/agr/agr05/agr05_1.jsp"],
  ["이천시", "https://icheon.ncrs.co.kr/"],
  ["제주특별자치도", "https://jeju.amlend.kr/aml/lend/list/lendSearch"],
];

function renderPublicOfficeCard(card, [name, phone, address, agency, lat, lng], { onClose } = {}) {
  const site = PUBLIC_RENTAL_SITES.find(([region]) => address.split(" ").slice(0, 2).includes(region))?.[1];
  const query = encodeURIComponent(`${address} ${agency} 농기계 임대 예약`);
  const siteUrl = site || `https://search.naver.com/search.naver?query=${query}`;
  const phoneNumber = phone.replace(/[^\d+]/g, "");
  card.innerHTML = `
    <button type="button" class="header-map-card-close" id="headerMapCardCloseBtn" aria-label="공공 임대사업소 창 닫기">×</button>
    <div class="header-map-card-body">
      <div class="header-map-card-tags"><span class="header-map-farm-pill">공공 임대사업소</span></div>
      <h3 class="header-map-card-title">${escapeHtml(name)}</h3>
      <p class="header-map-card-addr">${escapeHtml(address)}</p>
      <p class="header-map-card-addr">${escapeHtml(agency)}${phoneNumber ? ` · <a href="tel:${phoneNumber}">${escapeHtml(phone)}</a>` : ""}</p>
      <div class="header-map-card-actions">
        <a class="button button-primary button-sm" href="${siteUrl}" target="_blank" rel="noopener">${site ? "공식 사이트" : "운영기관 사이트 검색"}</a>
        <a class="button button-secondary button-sm" href="https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}" target="_blank" rel="noopener">카카오맵</a>
        <a href="${PUBLIC_RENTAL_SOURCE}" target="_blank" rel="noopener">공공데이터 출처</a>
      </div>
    </div>`;
  card.querySelector("#headerMapCardCloseBtn")?.addEventListener("click", () => onClose?.());
}

export const DEFAULT_KAKAO_JS_KEY = "1535434b57df672bac4c1ff9a9170589";
export const DEFAULT_KAKAO_REST_KEY = "6df1354c0ce056eef6569a59e1ed90c8";

export const VIVALDI_PARK_ORIGIN = {
  lat: 37.6456,
  lng: 127.6844,
  name: "강원특별자치도 홍천군",
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
    description: "홍천군 서면 팔봉산 해바라기 농가에서 바로 빌릴 수 있는 중형 트랙터입니다.",
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
    pickup: "강원 홍천군 서면 팔봉리 해바라기 농가 창고",
    delivery: {
      methods: ["owner_delivery", "self_pickup"],
      fee: 20000,
      area: "서면·남면·홍천읍까지, 15km 안",
      pickupPlace: "강원 홍천군 서면 팔봉리 해바라기 농가 창고",
    },
    rentalOperator: {
      name: "최민성",
      experience: "트랙터 경운 작업 10년, 홍천 지역 밭 작업 다수",
      dailyPrice: 110000,
    },
    rentalOptions: DEFAULT_DEMO_RENTAL_OPTIONS.map((opt) => ({ ...opt })),
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

const DEFAULT_USER_SCALE_LEVEL = 6; // Kakao Map ~500m scale around user location
const MAP_TIME_OPTIONS = [
  "06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
];

function bindMapRelayout(map, containerEl, getCenter) {
  if (!map || !containerEl) return () => {};
  const trigger = () => {
    if (!containerEl.isConnected) return;
    const rect = containerEl.getBoundingClientRect?.();
    if (!rect || rect.width < 10 || rect.height < 10) return;
    map.relayout?.();
    const center = typeof getCenter === "function" ? getCenter() : null;
    if (center && typeof map.setCenter === "function") {
      map.setCenter(center);
    }
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(trigger);
  }
  const timer = setTimeout(trigger, 160);

  containerEl._mapResizeObserver?.disconnect?.();
  let ro = null;
  if (typeof ResizeObserver === "function") {
    let rafId = 0;
    ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(trigger);
    });
    ro.observe(containerEl);
    containerEl._mapResizeObserver = ro;
  }

  return () => {
    clearTimeout(timer);
    ro?.disconnect?.();
  };
}

export function renderListingMap(items, { onOpenDetail, onGpsUpdated } = {}) {
  const host = $("listingMapPanel");
  if (!host) return;
  if ($("market")?.classList.contains("catalog-split-active") || state.viewMode !== "map") {
    host.hidden = true;
    host.innerHTML = "";
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
        toast("위치 정보를 불러오지 못했습니다. 위치를 선택해주세요.");
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

export const CLUSTER_SCALE_THRESHOLD_METERS = 250;

export const HEADER_CLUSTER_STEPS = [
  { maxLevel: 1, km: 0, label: "개별 매물" },
  { maxLevel: 2, km: 0.08, label: "반경 80m" },
  { maxLevel: 3, km: 0.2, label: "반경 200m" },
  { maxLevel: 4, km: 0.5, label: "반경 500m" },
  { maxLevel: 5, km: 2.5, label: "반경 2.5km" },
  { maxLevel: 6, km: 7, label: "반경 7km" },
  { maxLevel: 7, km: 18, label: "반경 18km" },
  { maxLevel: 8, km: 38, label: "시·군 (38km)" },
  { maxLevel: 9, km: 75, label: "광역 (75km)" },
  { maxLevel: 10, km: 140, label: "도·권역 (140km)" },
  { maxLevel: 11, km: 240, label: "초광역 (240km)" },
  { maxLevel: 99, km: 1000, label: "전국 전체" },
];

export function getScaleMetersForZoomLevel(zoomLevel) {
  const lv = Math.max(1, Number(zoomLevel) || 6);
  const KAKAO_SCALE_BY_LEVEL = {
    1: 20,
    2: 30,
    3: 50,
    4: 100,
    5: 250,
    6: 500,
    7: 1000,
    8: 2000,
    9: 4000,
    10: 8000,
    11: 16000,
    12: 32000,
    13: 64000,
    14: 128000,
  };
  return KAKAO_SCALE_BY_LEVEL[lv] || Math.round(250 * Math.pow(2, lv - 5));
}

export function measureMapScaleMeters(map, containerEl, referencePx = 70) {
  const level = Number(map?.getLevel?.());
  if (Number.isFinite(level) && level > 0) {
    return getScaleMetersForZoomLevel(level);
  }
  const bounds = map?.getBounds?.();
  const widthPx = Number(containerEl?.clientWidth || containerEl?.getBoundingClientRect?.().width || 0);
  if (bounds && widthPx > 0 && typeof bounds.getSouthWest === "function" && typeof bounds.getNorthEast === "function") {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const centerLat = (Number(sw.getLat()) + Number(ne.getLat())) / 2;
    const widthKm = haversineKm(
      { lat: centerLat, lng: Number(sw.getLng()) },
      { lat: centerLat, lng: Number(ne.getLng()) }
    );
    if (Number.isFinite(widthKm) && widthKm > 0) {
      return Math.round(((widthKm * 1000) / widthPx) * referencePx);
    }
  }
  return getScaleMetersForZoomLevel(6);
}

export function shouldClusterAtScale(scaleMeters) {
  const meters = Number(scaleMeters);
  if (!Number.isFinite(meters)) return true;
  return meters > CLUSTER_SCALE_THRESHOLD_METERS;
}

export function formatScaleLabel(scaleMeters) {
  const meters = Number(scaleMeters);
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters >= 1000) {
    const km = meters / 1000;
    return Number.isInteger(km) ? `${km}km` : `${km.toFixed(1)}km`;
  }
  return `${Math.round(meters)}m`;
}

export function getClusterThresholdKm(zoomLevel, scaleMeters) {
  const effectiveScale = Number.isFinite(Number(scaleMeters))
    ? Number(scaleMeters)
    : getScaleMetersForZoomLevel(zoomLevel);
  if (!shouldClusterAtScale(effectiveScale)) {
    return HEADER_CLUSTER_STEPS[0];
  }
  const lv = Number(zoomLevel) || 6;
  const matched = HEADER_CLUSTER_STEPS.find((step) => lv <= step.maxLevel)
    || HEADER_CLUSTER_STEPS[HEADER_CLUSTER_STEPS.length - 1];
  return matched.km > 0 ? matched : HEADER_CLUSTER_STEPS[1];
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
  return `${topRegion} 외 ${entries.length - 1}곳`;
}

export function clusterListingsByZoom(items, zoomLevel, origin, { scaleMeters } = {}) {
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

  const effectiveScale = Number.isFinite(Number(scaleMeters))
    ? Number(scaleMeters)
    : getScaleMetersForZoomLevel(zoomLevel);

  if (!shouldClusterAtScale(effectiveScale)) {
    return entries
      .sort((a, b) => a.distKm - b.distKm)
      .map((entry, idx) => ({
        id: `item-${entry.item.id || idx + 1}`,
        lat: entry.lat,
        lng: entry.lng,
        count: 1,
        isAllCluster: false,
        label: entry.item.region || "매물",
        items: [entry.item],
        boundsPoints: [{ lat: entry.lat, lng: entry.lng }],
      }));
  }

  const step = getClusterThresholdKm(zoomLevel, effectiveScale);
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
        label: sortedItems.length > 1 ? "전국 전체 매물" : (sortedItems[0].region || "매물"),
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

let activeHeaderMapHandle = null;

export function focusHeaderMapListing(listingId) {
  const id = typeof listingId === "string" ? listingId.trim() : "";
  if (!id) return false;
  runtime.selectedMapListingId = id;
  if (
    activeHeaderMapHandle
    && activeHeaderMapHandle.canvasEl
    && activeHeaderMapHandle.canvasEl === $("headerMapCanvas")
    && activeHeaderMapHandle.canvasEl.isConnected
  ) {
    return activeHeaderMapHandle.focusListing(id);
  }
  return false;
}

function renderHeaderVisualFallback(
  canvasEl,
  origin,
  originLabel,
  allItems,
  selectedItem,
  { initialLevel = 6, initialCenter = null, onSelectItem, onOpenClusterSheet, onRecenterReset } = {}
) {
  let fallbackLevel = Math.max(1, Math.min(13, Number(initialLevel) || 6));
  const originCoords = { lat: Number(origin.lat), lng: Number(origin.lng) };
  let viewCenter = initialCenter
    ? { lat: Number(initialCenter.lat), lng: Number(initialCenter.lng) }
    : { ...originCoords };

  const projectAtLevel = (lat, lng, lv) => {
    const centerLat = lv >= 9 ? 36.45 : viewCenter.lat;
    const centerLng = lv >= 9 ? 127.85 : viewCenter.lng;
    const span = Math.pow(1.9, lv - 5) * 0.14;
    const x = Math.max(10, Math.min(90, 50 + ((Number(lng) - centerLng) / span) * 42));
    const y = Math.max(18, Math.min(82, 52 - ((Number(lat) - centerLat) / (span * 0.68)) * 42));
    return { x, y };
  };

  const paintFallback = () => {
    const scaleMeters = getScaleMetersForZoomLevel(fallbackLevel);
    const step = getClusterThresholdKm(fallbackLevel, scaleMeters);
    const clusters = clusterListingsByZoom(allItems, fallbackLevel, origin, { scaleMeters });
    const originPos = projectAtLevel(originCoords.lat, originCoords.lng, fallbackLevel);

    canvasEl.dataset.mapLevel = String(fallbackLevel);
    canvasEl.dataset.mapScaleMeters = String(scaleMeters);
    canvasEl.dataset.mapCenterLat = String(viewCenter.lat);
    canvasEl.dataset.mapCenterLng = String(viewCenter.lng);
    canvasEl.dataset.focusedListingId = selectedItem?.id || "";

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
                  data-listing-id="${escapeHtml(item.id)}"
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
                aria-label="${escapeHtml(cl.label)} ${cl.count.toLocaleString()}대 매물 전체 보기"
              >
                <span class="header-map-cluster-count">${cl.count.toLocaleString()}</span>
                <span class="header-map-cluster-sub">${cl.isAllCluster ? "전체 보기" : "대"}</span>
                <span class="header-map-cluster-caption">${escapeHtml(cl.label)}</span>
              </button>`;
          })
          .join("")}

        <div class="header-map-zoom-controls">
          <span class="header-map-zoom-badge">Lv.${fallbackLevel} · ${escapeHtml(formatScaleLabel(scaleMeters))} · ${escapeHtml(step.label)}</span>
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
          canvasEl.dataset.focusedListingId = selectedItem.id;
          canvasEl.querySelectorAll("[data-cluster-index]").forEach((el) => {
            const target = clusters[Number(el.dataset.clusterIndex)];
            el.classList.toggle("is-active", target?.count === 1 && target.items[0].id === selectedItem.id);
          });
          onSelectItem?.(selectedItem);
          return;
        }
        onOpenClusterSheet?.(cl, () => {
          fallbackLevel = Math.max(1, fallbackLevel - 2);
          paintFallback();
        });
      });
    });

    $("fallbackZoomIn")?.addEventListener("click", () => {
      fallbackLevel = Math.max(1, fallbackLevel - 1);
      paintFallback();
    });
    $("fallbackZoomOut")?.addEventListener("click", () => {
      fallbackLevel = Math.min(13, fallbackLevel + 1);
      paintFallback();
    });
  };

  paintFallback();
  return {
    focusListing(item) {
      if (!item) return;
      selectedItem = item;
      const coords = listingCoords(item, item.id);
      viewCenter = { lat: Number(coords.lat), lng: Number(coords.lng) };
      fallbackLevel = 1;
      paintFallback();
    },
    resetView() {
      selectedItem = null;
      viewCenter = { ...originCoords };
      fallbackLevel = 6;
      paintFallback();
      onRecenterReset?.();
    },
  };
}

export async function renderHeaderMapView({ onOpenDetail, onRent, focusListingId = "" } = {}) {
  const host = $("mapView");
  if (!host) return;
  fallbackOfficeMap?.remove();
  fallbackOfficeMap = undefined;
  activeHeaderMapHandle = null;

  const origin = activeOriginCoords();
  const isVivaldiOrigin =
    Math.abs(Number(origin.lat) - VIVALDI_PARK_ORIGIN.lat) < 0.02 &&
    Math.abs(Number(origin.lng) - VIVALDI_PARK_ORIGIN.lng) < 0.02;
  const originLabel = isVivaldiOrigin ? VIVALDI_PARK_ORIGIN.name : state.region || "내 위치";
  const fallbackOriginAddr = isVivaldiOrigin ? VIVALDI_PARK_ORIGIN.address : `${originLabel} 중심`;

  const allItems = getHeaderMapAllItems(origin);
  const requestedFocusId = (typeof focusListingId === "string" && focusListingId.trim())
    || runtime.selectedMapListingId
    || "";
  const resolveFocusItem = (id) => {
    if (!id) return null;
    const found = allItems.find((i) => i.id === id);
    if (found) return found;
    const fromCatalog = (Array.isArray(runtime.catalog) ? runtime.catalog : []).find((i) => i.id === id);
    if (fromCatalog) {
      allItems.unshift(fromCatalog);
      return fromCatalog;
    }
    return null;
  };
  let selectedItem = resolveFocusItem(requestedFocusId);
  if (selectedItem) {
    runtime.selectedMapListingId = selectedItem.id;
  } else {
    runtime.selectedMapListingId = "";
  }

  const listCollapsed = Boolean(runtime.headerMapListCollapsed);
  host.innerHTML = `
    <div class="header-map-layout${listCollapsed ? " is-list-collapsed" : ""}" id="headerMapLayout">
    <aside class="header-map-list" id="headerMapList" aria-label="지도 매물 목록">
      <div class="header-map-list-head">
        <div class="header-map-list-title">
          <span class="header-map-loc-dot" aria-hidden="true"></span>
          <div class="header-map-loc-copy">
            <strong>내 위치 · ${escapeHtml(originLabel)}</strong>
            <span id="headerMapOriginAddr">${escapeHtml(fallbackOriginAddr)}</span>
          </div>
        </div>
        <button type="button" class="header-map-list-toggle" id="headerMapListToggle"
          aria-controls="headerMapListBody" aria-expanded="${!listCollapsed}"
          aria-label="${listCollapsed ? "매물 목록 펼치기" : "매물 목록 접고 지도 크게 보기"}">
          <span class="header-map-list-count">가까운 매물 ${allItems.length.toLocaleString()}건</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      <div class="header-map-list-body" id="headerMapListBody"${listCollapsed ? " hidden" : ""}></div>
    </aside>
    <div class="header-map-stage${selectedItem ? " has-floating-card" : ""}" id="headerMapStage">
      <div class="header-map-floating-top">
        <div class="header-map-top-actions">
          <div class="header-map-time-wrap">
            <button type="button" class="header-map-pill-btn header-map-time-btn" id="headerMapTimeBtn" aria-haspopup="dialog" aria-expanded="false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>
              <span id="headerMapTimeLabel">${escapeHtml(state.filters.startTime || "09:00")}–${escapeHtml(state.filters.endTime || "18:00")}</span>
            </button>
            <div class="header-map-time-pop" id="headerMapTimePop" role="dialog" aria-label="대여 시간 선택" hidden>
              <div class="hmt-presets">
                <button type="button" class="hmt-preset" data-map-time-preset="08:00,12:00">오전 (08~12)</button>
                <button type="button" class="hmt-preset" data-map-time-preset="13:00,18:00">오후 (13~18)</button>
                <button type="button" class="hmt-preset" data-map-time-preset="09:00,18:00">종일 (09~18)</button>
              </div>
              <div class="hmt-selects">
                <label><span>시작</span><select id="headerMapStartTime">${MAP_TIME_OPTIONS.map((t) => `<option value="${t}"${(state.filters.startTime || "09:00") === t ? " selected" : ""}>${t}</option>`).join("")}</select></label>
                <label><span>종료</span><select id="headerMapEndTime">${MAP_TIME_OPTIONS.map((t) => `<option value="${t}"${(state.filters.endTime || "18:00") === t ? " selected" : ""}>${t}</option>`).join("")}</select></label>
              </div>
            </div>
          </div>
          <button type="button" class="header-map-pill-btn header-map-all-btn" id="headerMapShowAllBtn">
            전체 ${allItems.length.toLocaleString()}건 보기
          </button>
          <button type="button" class="header-map-pill-btn" id="socarPublicOfficesBtn">
            전국 공공 임대소 ${publicRentalOffices.length}건
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

      <div class="header-map-cluster-sheet" id="headerMapClusterSheet" role="dialog" aria-modal="false" aria-label="선택 구역 전체 매물 목록" hidden></div>
      <dialog class="socar-public-office-dialog" id="socarPublicOfficesDialog" aria-labelledby="socarPublicOfficesTitle">
        <form method="dialog">
          <button type="submit" class="button button-secondary button-sm">닫기</button>
        </form>
        <h2 id="socarPublicOfficesTitle">전국 공공 임대소</h2>
        <label for="socarPublicOfficesSearch">사업소명 또는 주소</label>
        <input type="search" id="socarPublicOfficesSearch" autocomplete="off">
        <div id="socarPublicOfficesResults"></div>
      </dialog>
    </div>
    </div>
  `;

  // 왼쪽 매물 목록: 가까운 순으로 보여주고, 누르면 지도에서 해당 매물을 짚어 준다.
  const LIST_PAGE = 30;
  let listShown = LIST_PAGE;
  let focusListing = (item) => {
    selectedItem = item;
    runtime.selectedMapListingId = item.id;
    renderFloatingCard(item);
  };
  const renderListBody = () => {
    const body = $("headerMapListBody");
    if (!body) return;
    if (!allItems.length) {
      body.innerHTML = `<p class="header-map-list-empty">주변에 등록된 매물이 아직 없어요.</p>`;
      return;
    }
    const rows = allItems.slice(0, listShown).map((item) => {
      const machine = MACHINE_BY_ID[item.machineType];
      const photoSrc = getListingPhotoSrc(item) || machineImage(machine);
      const dist = distanceKm(origin, item, item.id);
      const active = item.id === runtime.selectedMapListingId;
      return `
        <button type="button" class="header-map-list-item${active ? " is-active" : ""}" data-list-id="${escapeHtml(item.id)}" aria-pressed="${active}">
          <span class="header-map-list-copy">
            <span class="header-map-list-item-title">${escapeHtml(item.title)}</span>
            <span class="header-map-list-item-meta">${escapeHtml(item.region || "")} · ${dist}km</span>
            <span class="header-map-list-item-price"><strong>${money(item.price)}</strong>${item.type === "rent" ? " / 1일" : ""}</span>
            <span class="header-map-list-item-tag">${escapeHtml(machine?.label || "농기계")} · ${item.type === "rent" ? "대여" : "판매"}</span>
          </span>
          <img src="${escapeHtml(photoSrc)}" alt="" loading="lazy" />
        </button>`;
    }).join("");
    const more = allItems.length > listShown
      ? `<button type="button" class="header-map-list-more" id="headerMapListMore">매물 더 보기 (${(allItems.length - listShown).toLocaleString()}건 남음)</button>`
      : "";
    body.innerHTML = rows + more;
  };
  const syncListActive = () => {
    $("headerMapListBody")?.querySelectorAll("[data-list-id]").forEach((el) => {
      const active = el.dataset.listId === runtime.selectedMapListingId;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-pressed", String(active));
    });
  };
  // 지도에서 핀을 고르면 목록에서도 같은 매물을 보이게 한다(목록 밖이면 그만큼 더 펼친다).
  const revealListRow = (id) => {
    const index = allItems.findIndex((i) => i.id === id);
    if (index < 0) return;
    if (index >= listShown) {
      listShown = Math.ceil((index + 1) / LIST_PAGE) * LIST_PAGE;
      renderListBody();
    }
    const body = $("headerMapListBody");
    const row = body?.querySelector(`[data-list-id="${CSS.escape(id)}"]`);
    const isStackedLayout = Boolean(window.matchMedia?.("(max-width: 1023px)").matches);
    if (row && !body.hidden && !isStackedLayout) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  renderListBody();
  $("headerMapListBody")?.addEventListener("click", (e) => {
    if (e.target.closest("#headerMapListMore")) {
      listShown += LIST_PAGE;
      renderListBody();
      return;
    }
    const row = e.target.closest("[data-list-id]");
    if (!row) return;
    const item = allItems.find((i) => i.id === row.dataset.listId);
    if (!item) return;
    closeClusterSheet();
    focusListing(item);
    syncListActive();
    if (window.matchMedia?.("(max-width: 1023px)").matches) {
      $("headerMapStage")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
  $("headerMapListToggle")?.addEventListener("click", () => {
    const collapsed = !runtime.headerMapListCollapsed;
    runtime.headerMapListCollapsed = collapsed;
    $("headerMapLayout")?.classList.toggle("is-list-collapsed", collapsed);
    const body = $("headerMapListBody");
    if (body) body.hidden = collapsed;
    const toggle = $("headerMapListToggle");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "매물 목록 펼치기" : "매물 목록 접고 지도 크게 보기");
  });

  const showPublicOffice = (office) => {
    selectedItem = null;
    runtime.selectedMapListingId = "";
    closeClusterSheet();
    $("headerMapStage").classList.add("has-floating-card");
    const card = $("headerMapFloatingCard");
    card.hidden = false;
    renderPublicOfficeCard(card, office, { onClose: hideFloatingCard });
  };

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
    syncListActive();
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
            <strong>${escapeHtml(cluster.label.endsWith("전체") ? `${cluster.label} 매물` : `${cluster.label} 전체 매물`)}</strong>
          </div>
          <span>선택한 구역에 포함된 모든 매물(거리순)입니다.</span>
        </div>
        <div class="header-map-cluster-sheet-head-actions">
          ${onZoomArea ? `<button type="button" class="button button-secondary button-sm" id="headerMapClusterZoomAreaBtn">이 구역 확대</button>` : ""}
          <button type="button" class="button button-primary button-sm" id="headerMapClusterSheetCloseBtn">닫기</button>
        </div>
      </div>
      <div class="header-map-cluster-sheet-filters">
        <input type="search" id="headerMapClusterSearchInput" class="header-map-cluster-search" placeholder="기종·지역·농가명으로 검색" aria-label="구역 매물 검색" />
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

  const mapTimeBtn = $("headerMapTimeBtn");
  const mapTimePop = $("headerMapTimePop");
  const syncMapTimeLabel = () => {
    const start = state.filters.startTime || "09:00";
    const end = state.filters.endTime || "18:00";
    const label = $("headerMapTimeLabel");
    if (label) label.textContent = `${start}–${end}`;
    if ($("headerMapStartTime")) $("headerMapStartTime").value = start;
    if ($("headerMapEndTime")) $("headerMapEndTime").value = end;
    const catalogLabel = $("catalogTimeLabel");
    if (catalogLabel) catalogLabel.textContent = `${start}–${end}`;
    const homeLabel = $("homeTimeText");
    if (homeLabel) homeLabel.textContent = `${start}–${end}`;
  };
  const notifyTimeChange = (startTime, endTime) => {
    window.dispatchEvent(new CustomEvent("moanong:time-change", { detail: { startTime, endTime } }));
  };
  mapTimeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!mapTimePop) return;
    const nextOpen = mapTimePop.hidden;
    mapTimePop.hidden = !nextOpen;
    mapTimeBtn.setAttribute("aria-expanded", String(nextOpen));
  });
  mapTimePop?.addEventListener("click", (e) => {
    e.stopPropagation();
    const presetBtn = e.target.closest("[data-map-time-preset]");
    if (!presetBtn) return;
    const [s, en] = presetBtn.dataset.mapTimePreset.split(",");
    state.filters.startTime = s;
    state.filters.endTime = en;
    persist();
    syncMapTimeLabel();
    notifyTimeChange(s, en);
    mapTimePop.hidden = true;
    mapTimeBtn?.setAttribute("aria-expanded", "false");
    toast(`대여 시간을 ${s}–${en}(으)로 설정했습니다.`);
  });
  const onMapTimeSelectChange = () => {
    const s = $("headerMapStartTime")?.value || "09:00";
    let en = $("headerMapEndTime")?.value || "18:00";
    if (en <= s) en = s;
    state.filters.startTime = s;
    state.filters.endTime = en;
    persist();
    syncMapTimeLabel();
    notifyTimeChange(s, en);
  };
  $("headerMapStartTime")?.addEventListener("change", onMapTimeSelectChange);
  $("headerMapEndTime")?.addEventListener("change", onMapTimeSelectChange);
  host.addEventListener("click", () => {
    if (mapTimePop && !mapTimePop.hidden) {
      mapTimePop.hidden = true;
      mapTimeBtn?.setAttribute("aria-expanded", "false");
    }
  });

  const canvasEl = $("headerMapCanvas");
  const appKey = runtime.mapConfig?.kakaoAppKey || DEFAULT_KAKAO_JS_KEY;
  let activeMap = null;
  let originLatLng = null;
  let fallbackController = null;
  let pendingOffice;
  let locateOffice = (office) => { pendingOffice = office; };
  let fallbackMap;
  let pendingFocusListingId = selectedItem ? selectedItem.id : "";
  let applyFocusListing = (id) => {
    const item = resolveFocusItem(id);
    if (!item) return false;
    closeClusterSheet();
    selectedItem = item;
    runtime.selectedMapListingId = item.id;
    pendingFocusListingId = item.id;
    renderFloatingCard(item);
    return true;
  };
  activeHeaderMapHandle = {
    canvasEl,
    focusListing: (id) => applyFocusListing(id),
  };

  const officeDialog = $("socarPublicOfficesDialog");
  const officeSearch = $("socarPublicOfficesSearch");
  const officeResults = $("socarPublicOfficesResults");
  const renderOfficeResults = () => {
    const terms = officeSearch.value.trim().split(/\s+/);
    const results = publicRentalOffices.filter(([name, , address, agency]) =>
      terms.every((term) => `${name} ${address} ${agency}`.includes(term)),
    );
    officeResults.replaceChildren(...results.map((office) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-secondary button-sm";
      button.textContent = `${office[0]} · ${office[2]}`;
      button.addEventListener("click", () => {
        officeDialog.close();
        locateOffice?.(office);
        showPublicOffice(office);
      });
      return button;
    }));
    if (!results.length) officeResults.textContent = "검색 결과가 없습니다.";
  };
  officeSearch.addEventListener("input", renderOfficeResults);
  $("socarPublicOfficesBtn").addEventListener("click", () => {
    renderOfficeResults();
    officeDialog.showModal();
    officeSearch.focus();
  });

  $("headerMapRecenterBtn")?.addEventListener("click", () => {
    closeClusterSheet();
    hideFloatingCard();
    pendingFocusListingId = "";
    if (activeMap && originLatLng) {
      activeMap.setLevel(6);
      activeMap.panTo(originLatLng);
      toast(`${originLabel} 중심으로 이동했습니다.`);
    } else if (fallbackMap) {
      fallbackMap.panTo([origin.lat, origin.lng]);
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

    const initialFocusItem = pendingFocusListingId ? resolveFocusItem(pendingFocusListingId) : selectedItem;
    const initialLevel = initialFocusItem ? 1 : 6;
    const initialScaleMeters = getScaleMetersForZoomLevel(initialLevel);
    const initialStep = getClusterThresholdKm(initialLevel, initialScaleMeters);
    const initialCoords = initialFocusItem
      ? listingCoords(initialFocusItem, initialFocusItem.id)
      : { lat: Number(origin.lat), lng: Number(origin.lng) };

    const zoomControlWrap = document.createElement("div");
    zoomControlWrap.className = "header-map-zoom-controls";
    zoomControlWrap.innerHTML = `
      <span class="header-map-zoom-badge" id="headerMapZoomBadge">Lv.${initialLevel} · ${escapeHtml(formatScaleLabel(initialScaleMeters))} · ${escapeHtml(initialStep.label)}</span>
      <div class="header-map-zoom-btn-group" role="group" aria-label="지도 확대 축소">
        <button type="button" class="header-map-zoom-btn" id="headerMapZoomInBtn" aria-label="지도 확대">+</button>
        <button type="button" class="header-map-zoom-btn" id="headerMapZoomOutBtn" aria-label="지도 축소">−</button>
      </div>
    `;
    canvasEl.appendChild(zoomControlWrap);

    originLatLng = new maps.LatLng(Number(origin.lat), Number(origin.lng));
    const initialCenterLatLng = new maps.LatLng(Number(initialCoords.lat), Number(initialCoords.lng));
    activeMap = new maps.Map(mapStageEl, {
      center: initialCenterLatLng,
      level: initialLevel,
    });

    // 목록을 접거나 농농이 패널을 닫으면 지도 칸이 넓어진다. 카카오 지도는 크기 변화를 직접 알려 줘야 한다.
    if (typeof ResizeObserver === "function") {
      let relayoutFrame = 0;
      const resizeObserver = new ResizeObserver(() => {
        if (!canvasEl.isConnected) {
          resizeObserver.disconnect();
          return;
        }
        cancelAnimationFrame(relayoutFrame);
        relayoutFrame = requestAnimationFrame(() => {
          const center = activeMap.getCenter();
          activeMap.relayout();
          activeMap.setCenter(center);
        });
      });
      resizeObserver.observe(canvasEl);
    }

    focusListing = (item) => {
      const coords = listingCoords(item, item.id);
      const pos = new maps.LatLng(coords.lat, coords.lng);
      selectedItem = item;
      runtime.selectedMapListingId = item.id;
      if (activeMap.getLevel() > 5) activeMap.setLevel(5);
      activeMap.panTo(pos);
      syncOverlays(true);
      pinElements.forEach((el, id) => el.classList.toggle("is-active", id === item.id));
      renderFloatingCard(item);
    };

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
    let cachedShouldCluster = null;
    let cachedClusters = [];
    const officeOverlays = new Map();
    const officePositions = publicRentalOffices.map((office) => new maps.LatLng(office[4], office[5]));
    locateOffice = (office) => {
      pinElements.forEach((el) => el.classList.remove("is-active"));
      activeMap.setLevel(4);
      activeMap.panTo(officePositions[publicRentalOffices.indexOf(office)]);
    };

    const renderOfficePins = (viewport) => {
      officePositions.forEach((position, index) => {
        const existing = officeOverlays.get(index);
        if (!viewport.contain(position)) {
          existing?.setMap(null);
          officeOverlays.delete(index);
          return;
        }
        if (existing) return;
        const office = publicRentalOffices[index];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "header-map-price-pin socar-public-office-pin";
        button.title = office[0];
        button.setAttribute("aria-label", office[0]);
        button.textContent = "임대소";
        button.addEventListener("click", () => {
          pinElements.forEach((el) => el.classList.remove("is-active"));
          activeMap.panTo(position);
          showPublicOffice(office);
        });
        officeOverlays.set(index, new maps.CustomOverlay({
          map: activeMap,
          position,
          content: button,
          zIndex: 3,
        }));
      });
    };

    const createClusterOverlay = (cl) => {
      const pos = new maps.LatLng(cl.lat, cl.lng);

      if (cl.count === 1) {
        const item = cl.items[0];
        const machineLabel = MACHINE_BY_ID[item.machineType]?.label || "농기계";
        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = `header-map-price-pin${item.id === selectedItem?.id ? " is-active" : ""}`;
        pinBtn.dataset.listingId = item.id;
        pinBtn.innerHTML = `
          <span class="header-map-pin-tag">${escapeHtml(machineLabel)}</span>
          <strong>${money(item.price)}</strong>
          <span class="header-map-pin-tail" aria-hidden="true"></span>
        `;
        pinBtn.addEventListener("click", () => {
          closeClusterSheet();
          selectedItem = item;
          runtime.selectedMapListingId = item.id;
          canvasEl.dataset.focusedListingId = item.id;
          pinElements.forEach((el, id) => el.classList.toggle("is-active", id === item.id));
          activeMap.panTo(pos);
          renderFloatingCard(item);
          syncListActive();
          revealListRow(item.id);
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
      dotBtn.setAttribute("aria-label", `${cl.label} ${cl.count.toLocaleString()}대 매물 전체 보기`);
      dotBtn.innerHTML = `
        <span class="header-map-cluster-count">${cl.count.toLocaleString()}</span>
        <span class="header-map-cluster-sub">${cl.isAllCluster ? "전체 보기" : "대"}</span>
        <span class="header-map-cluster-caption">${escapeHtml(cl.label)}</span>
      `;
      dotBtn.addEventListener("click", () => {
        openClusterSheet(cl, () => {
          if (cl.boundsPoints?.length > 1) {
            const b = new maps.LatLngBounds();
            cl.boundsPoints.forEach((p) => b.extend(new maps.LatLng(p.lat, p.lng)));
            activeMap.setBounds(b, 60, 60, 140, 60);
          } else {
            activeMap.setLevel(Math.max(1, activeMap.getLevel() - 3), { animate: true });
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
      const scaleMeters = measureMapScaleMeters(activeMap, mapStageEl);
      const shouldCluster = shouldClusterAtScale(scaleMeters);
      const step = getClusterThresholdKm(level, scaleMeters);
      const badgeEl = $("headerMapZoomBadge");
      if (badgeEl) badgeEl.textContent = `Lv.${level} · ${formatScaleLabel(scaleMeters)} · ${step.label}`;

      canvasEl.dataset.mapLevel = String(level);
      canvasEl.dataset.mapScaleMeters = String(scaleMeters);
      const center = activeMap.getCenter?.();
      if (center) {
        canvasEl.dataset.mapCenterLat = String(center.getLat());
        canvasEl.dataset.mapCenterLng = String(center.getLng());
      }
      canvasEl.dataset.focusedListingId = selectedItem?.id || "";

      if (forceRecluster || cachedLevel !== level || cachedShouldCluster !== shouldCluster) {
        activeOverlays.forEach((ov) => ov.setMap(null));
        activeOverlays.clear();
        pinElements.clear();
        cachedLevel = level;
        cachedShouldCluster = shouldCluster;
        cachedClusters = clusterListingsByZoom(allItems, level, origin, { scaleMeters });
      }

      const viewport = activeMap.getBounds?.();
      if (viewport) renderOfficePins(viewport);
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

    applyFocusListing = (id) => {
      const item = resolveFocusItem(id);
      if (!item || !activeMap) return false;
      closeClusterSheet();
      selectedItem = item;
      runtime.selectedMapListingId = item.id;
      pendingFocusListingId = "";
      const coords = listingCoords(item, item.id);
      const pos = new maps.LatLng(Number(coords.lat), Number(coords.lng));
      activeMap.setLevel(1);
      if (typeof activeMap.setCenter === "function") {
        activeMap.setCenter(pos);
      } else {
        activeMap.panTo(pos);
      }
      syncOverlays(true);
      pinElements.forEach((el, pinId) => el.classList.toggle("is-active", pinId === item.id));
      renderFloatingCard(item);
      return true;
    };

    if (pendingOffice) locateOffice(pendingOffice);
    else if (pendingFocusListingId) applyFocusListing(pendingFocusListingId);
    else syncOverlays(true);

    bindMapRelayout(activeMap, mapStageEl, () => {
      if (selectedItem) {
        const c = listingCoords(selectedItem, selectedItem.id);
        return new maps.LatLng(Number(c.lat), Number(c.lng));
      }
      return originLatLng;
    });

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
    if (canvasEl && $("headerMapCanvas") === canvasEl) {
      const initialFocusItem = pendingFocusListingId ? resolveFocusItem(pendingFocusListingId) : selectedItem;
      const initialCoords = initialFocusItem ? listingCoords(initialFocusItem, initialFocusItem.id) : origin;
      fallbackController = renderHeaderVisualFallback(canvasEl, origin, originLabel, allItems, initialFocusItem, {
        initialLevel: initialFocusItem ? 1 : 6,
        initialCenter: initialCoords,
        onSelectItem: (chosen) => {
          closeClusterSheet();
          selectedItem = chosen;
          runtime.selectedMapListingId = chosen.id;
          renderFloatingCard(chosen);
          syncListActive();
          revealListRow(chosen.id);
        },
        onOpenClusterSheet: openClusterSheet,
        onRecenterReset: () => toast(`${originLabel} 중심으로 이동했습니다.`),
      });
      focusListing = (item) => {
        if (!item) return;
        selectedItem = item;
        runtime.selectedMapListingId = item.id;
        fallbackController?.focusListing(item);
        renderFloatingCard(item);
      };
      applyFocusListing = (id) => {
        const item = resolveFocusItem(id);
        if (!item) return false;
        if (fallbackMap) {
          renderHeaderMapView({ onOpenDetail, onRent, focusListingId: item.id });
          return true;
        }
        closeClusterSheet();
        selectedItem = item;
        runtime.selectedMapListingId = item.id;
        pendingFocusListingId = "";
        fallbackController?.focusListing(item);
        renderFloatingCard(item);
        return true;
      };
      if (initialFocusItem) {
        pendingFocusListingId = "";
        renderFloatingCard(initialFocusItem);
      }
      locateOffice = async (office) => {
        pendingOffice = office;
        try {
          const leaflet = await loadOfficeMapLibrary();
          if (!canvasEl.isConnected || pendingOffice !== office) return;
          if (!fallbackMap) {
            canvasEl.replaceChildren();
            fallbackMap = leaflet.map(canvasEl, { zoomControl: false });
            fallbackOfficeMap = fallbackMap;
            leaflet.control.zoom({ position: "bottomleft" }).addTo(fallbackMap);
            leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
              maxZoom: 19,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }).addTo(fallbackMap);
            for (const record of publicRentalOffices) {
              const marker = leaflet.circleMarker([record[4], record[5]], {
                radius: 6,
                color: "#fff",
                weight: 2,
                fillColor: "#1b598e",
                fillOpacity: 1,
              }).addTo(fallbackMap);
              marker.on("click", () => {
                showPublicOffice(record);
                locateOffice(record);
              });
            }
          }
          fallbackMap.setView([office[4], office[5]], 14);
        } catch {
          if (canvasEl.isConnected) toast("지도 연결이 지연되고 있습니다. 사업소 카드의 카카오맵에서 위치를 확인할 수 있습니다.");
        }
      };
      if (pendingOffice) locateOffice(pendingOffice);
    }
  }
}

let catalogMiniMapRenderSeq = 0;

function renderCatalogMiniMapFallback(canvasEl, origin, items, selectedId, { onSelectListing } = {}) {
  const list = Array.isArray(items) ? items : [];
  const points = list.map((item) => {
    const c = listingCoords(item, item.id);
    return { item, lat: Number(c.lat), lng: Number(c.lng) };
  });

  // Default to user's location at local ~500m-2km neighborhood scale (never nationwide stretch)
  const selectedPt = selectedId ? points.find((p) => p.item.id === selectedId) : null;
  const centerLat = Number(selectedPt ? selectedPt.lat : origin.lat);
  const centerLng = Number(selectedPt ? selectedPt.lng : origin.lng);
  const latSpan = 0.024;
  const lngSpan = 0.032;

  const project = (lat, lng) => {
    const x = Math.max(8, Math.min(92, 50 + ((lng - centerLng) / lngSpan) * 76));
    const y = Math.max(14, Math.min(84, 50 - ((lat - centerLat) / latSpan) * 66));
    return { x, y };
  };

  const originPos = project(Number(origin.lat), Number(origin.lng));
  const visiblePoints = points.slice(0, 24);

  canvasEl.innerHTML = `
    <div class="catalog-minimap-fallback" role="region" aria-label="매물 위치 미니 지도">
      <svg class="catalog-minimap-svg" viewBox="0 0 320 200" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern id="catalogMiniMapGrid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(23,66,51,0.07)" stroke-width="1" />
          </pattern>
        </defs>
        <rect width="320" height="200" fill="#eef4ee" />
        <rect width="320" height="200" fill="url(#catalogMiniMapGrid)" />
        <path d="M-10,165 C70,138 140,104 215,82 C265,67 295,52 330,34" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" />
        <path d="M52,-10 C86,58 135,105 198,136 C252,162 292,184 316,210" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" />
        <path d="M12,56 Q130,82 220,42 T332,68" fill="none" stroke="#cfe6f5" stroke-width="9" stroke-linecap="round" opacity="0.7" />
      </svg>
      <div class="catalog-minimap-origin-dot" style="left:${originPos.x.toFixed(1)}%;top:${originPos.y.toFixed(1)}%" title="내 위치 (${escapeHtml(state.region || "현재 위치")})"></div>
      ${visiblePoints
        .map(({ item, lat, lng }) => {
          const pos = project(lat, lng);
          const isActive = item.id === selectedId;
          const shortPrice = item.price >= 10000
            ? `${Math.round(item.price / 10000)}만`
            : `${item.price.toLocaleString("ko-KR")}`;
          return `
            <button
              type="button"
              class="catalog-minimap-pin${isActive ? " is-active" : ""}"
              style="left:${pos.x.toFixed(1)}%;top:${pos.y.toFixed(1)}%"
              data-minimap-listing="${escapeHtml(item.id)}"
              title="${escapeHtml(item.title)} (${money(item.price)})"
              aria-label="${escapeHtml(item.title)} 위치 보기"
            >${escapeHtml(shortPrice)}</button>`;
        })
        .join("")}
    </div>
  `;

  canvasEl.querySelectorAll("[data-minimap-listing]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = btn.dataset.minimapListing;
      const chosen = list.find((it) => it.id === id);
      if (!chosen) return;
      canvasEl.querySelectorAll(".catalog-minimap-pin.is-active").forEach((el) => el.classList.remove("is-active"));
      btn.classList.add("is-active");
      onSelectListing?.(chosen);
    });
  });
}

export async function renderCatalogMiniMap(host, items, { selectedId = "", onSelectListing, onExpandMap } = {}) {
  if (!host) return;
  const list = Array.isArray(items) ? items : [];
  const origin = activeOriginCoords();
  const seq = ++catalogMiniMapRenderSeq;

  // Initialize wrapper structure once per host to avoid DOM thrashing and ID collisions
  let canvasEl = host.querySelector(".catalog-minimap-canvas");
  let countBadge = host.querySelector(".catalog-minimap-count-pill");
  let expandBtn = host.querySelector(".catalog-minimap-expand-btn");

  if (!canvasEl) {
    host.innerHTML = `
      <div class="catalog-minimap-frame">
        <div class="catalog-minimap-canvas" aria-label="필터링된 매물 미니 지도"></div>
        <span class="catalog-minimap-count-pill" aria-live="polite"></span>
        <button type="button" class="catalog-minimap-expand-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.8 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.2 12 21 12 21z"></path><circle cx="12" cy="10.6" r="2.3"></circle></svg>
          <span>지도에서 보기</span>
        </button>
      </div>
    `;
    canvasEl = host.querySelector(".catalog-minimap-canvas");
    countBadge = host.querySelector(".catalog-minimap-count-pill");
    expandBtn = host.querySelector(".catalog-minimap-expand-btn");
  }

  if (countBadge) {
    countBadge.textContent = list.length ? `지도 매물 ${list.length}대` : "표시할 매물 없음";
  }
  if (expandBtn) {
    expandBtn.onclick = () => onExpandMap?.();
  }

  const appKey = runtime.mapConfig?.kakaoAppKey || DEFAULT_KAKAO_JS_KEY;
  if (!appKey) {
    host._miniMapState = null;
    renderCatalogMiniMapFallback(canvasEl, origin, list, selectedId, { onSelectListing });
    return;
  }

  try {
    const maps = await loadKakaoSdk(appKey);
    if (seq !== catalogMiniMapRenderSeq || !host.isConnected) return;

    const originLatLng = new maps.LatLng(Number(origin.lat), Number(origin.lng));
    let mapState = host._miniMapState;

    if (!mapState || mapState.canvasEl !== canvasEl || !mapState.map) {
      canvasEl.innerHTML = "";
      const stageEl = document.createElement("div");
      stageEl.className = "catalog-minimap-kakao-stage";
      canvasEl.appendChild(stageEl);
      const map = new maps.Map(stageEl, {
        center: originLatLng,
        level: DEFAULT_USER_SCALE_LEVEL,
      });
      mapState = {
        canvasEl,
        stageEl,
        map,
        overlays: [],
        pinMap: new Map(),
        targetCenter: originLatLng,
      };
      bindMapRelayout(map, stageEl, () => mapState.targetCenter || originLatLng);
      host._miniMapState = mapState;
    }

    const { map } = mapState;
    mapState.overlays.forEach((ov) => ov.setMap(null));
    mapState.overlays = [];
    mapState.pinMap.clear();

    const originDotEl = document.createElement("div");
    originDotEl.className = "catalog-minimap-origin-dot is-kakao";
    originDotEl.title = `내 위치 (${state.region || "현재 위치"})`;
    const originOv = new maps.CustomOverlay({
      map,
      position: originLatLng,
      content: originDotEl,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 3,
    });
    mapState.overlays.push(originOv);

    const bounds = new maps.LatLngBounds();
    bounds.extend(originLatLng);

    const useClusters = list.length > 35;
    const clusters = useClusters ? clusterListingsByZoom(list, 7, origin) : null;

    if (clusters) {
      clusters.forEach((cl) => {
        const pos = new maps.LatLng(cl.lat, cl.lng);
        bounds.extend(pos);
        const btn = document.createElement("button");
        btn.type = "button";
        if (cl.count === 1) {
          const item = cl.items[0];
          const shortPrice = item.price >= 10000
            ? `${Math.round(item.price / 10000)}만`
            : `${item.price.toLocaleString("ko-KR")}`;
          btn.className = `catalog-minimap-pin is-kakao${item.id === selectedId ? " is-active" : ""}`;
          btn.textContent = shortPrice;
          btn.title = `${item.title} (${money(item.price)})`;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            mapState.pinMap.forEach((el, id) => el.classList.toggle("is-active", id === item.id));
            map.panTo(pos);
            onSelectListing?.(item);
          });
          mapState.pinMap.set(item.id, btn);
        } else {
          btn.className = "catalog-minimap-cluster is-kakao";
          btn.textContent = `${cl.count}대`;
          btn.title = `${cl.label} (${cl.count}대)`;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (cl.items[0]) onSelectListing?.(cl.items[0]);
          });
        }
        const ov = new maps.CustomOverlay({
          map,
          position: pos,
          content: btn,
          xAnchor: 0.5,
          yAnchor: 1,
          zIndex: cl.count === 1 && cl.items[0]?.id === selectedId ? 6 : 4,
        });
        mapState.overlays.push(ov);
      });
    } else {
      list.forEach((item) => {
        const c = listingCoords(item, item.id);
        const pos = new maps.LatLng(Number(c.lat), Number(c.lng));
        bounds.extend(pos);
        const shortPrice = item.price >= 10000
          ? `${Math.round(item.price / 10000)}만`
          : `${item.price.toLocaleString("ko-KR")}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `catalog-minimap-pin is-kakao${item.id === selectedId ? " is-active" : ""}`;
        btn.textContent = shortPrice;
        btn.title = `${item.title} (${money(item.price)})`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          mapState.pinMap.forEach((el, id) => el.classList.toggle("is-active", id === item.id));
          map.panTo(pos);
          onSelectListing?.(item);
        });
        mapState.pinMap.set(item.id, btn);
        const ov = new maps.CustomOverlay({
          map,
          position: pos,
          content: btn,
          xAnchor: 0.5,
          yAnchor: 1,
          zIndex: item.id === selectedId ? 6 : 4,
        });
        mapState.overlays.push(ov);
      });
    }

    const selectedItem = selectedId ? list.find((it) => it.id === selectedId) : null;
    if (selectedItem) {
      const sc = listingCoords(selectedItem, selectedItem.id);
      mapState.targetCenter = new maps.LatLng(Number(sc.lat), Number(sc.lng));
    } else {
      mapState.targetCenter = originLatLng;
    }
    map.setLevel(DEFAULT_USER_SCALE_LEVEL);
    map.setCenter(mapState.targetCenter);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (!mapState.stageEl?.isConnected) return;
        map.relayout?.();
        map.setCenter(mapState.targetCenter);
      });
    } else {
      map.relayout?.();
    }
  } catch {
    if (seq !== catalogMiniMapRenderSeq || !host.isConnected) return;
    host._miniMapState = null;
    renderCatalogMiniMapFallback(canvasEl, origin, list, selectedId, { onSelectListing });
  }
}
