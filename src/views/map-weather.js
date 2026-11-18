import { MACHINE_BY_ID, listingCoords, distanceKm } from "../data/farm-machines.js";
import { applyModelSpecification } from "../data/machine-specifications.js";
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

function renderPublicOfficeCard(card, [name, phone, address, agency, lat, lng]) {
  const site = PUBLIC_RENTAL_SITES.find(([region]) => address.split(" ").slice(0, 2).includes(region))?.[1];
  const query = encodeURIComponent(`${address} ${agency} 농기계 임대 예약`);
  const siteUrl = site || `https://search.naver.com/search.naver?query=${query}`;
  const phoneNumber = phone.replace(/[^\d+]/g, "");
  card.innerHTML = `
    <div class="socar-card-body">
      <div class="socar-card-tags"><span class="socar-farm-pill">공공 임대사업소</span></div>
      <h3 class="socar-card-title">${escapeHtml(name)}</h3>
      <p class="socar-card-addr">${escapeHtml(address)}</p>
      <p class="socar-card-addr">${escapeHtml(agency)}${phoneNumber ? ` · <a href="tel:${phoneNumber}">${escapeHtml(phone)}</a>` : ""}</p>
      <div class="socar-card-actions">
        <a class="button button-primary button-sm" href="${siteUrl}" target="_blank" rel="noopener">${site ? "공식 사이트" : "운영기관 사이트 검색"}</a>
        <a class="button button-secondary button-sm" href="https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}" target="_blank" rel="noopener">카카오맵</a>
        <a href="${PUBLIC_RENTAL_SOURCE}" target="_blank" rel="noopener">공공데이터 출처</a>
      </div>
    </div>`;
}

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
    runtime.selectedMapListingId = listing.id;
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
  runtime.selectedMapListingId = listing.id;
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

function getHeaderMapNearbyItems(origin) {
  const randomListing = ensureHongcheonRandomListing({ randomize: false });
  const catalog = Array.isArray(runtime.catalog) && runtime.catalog.length ? runtime.catalog : [randomListing];
  const nearby = catalog.filter(
    (item) => item.status === "open" && distanceKm(origin, item, item.id) <= 30
  );
  if (nearby.length) return nearby;
  return [randomListing];
}

function renderHeaderVisualFallback(canvasEl, origin, originLabel, items, selectedItem, onSelectItem) {
  const originCoords = { lat: Number(origin.lat), lng: Number(origin.lng) };
  const project = (lat, lng) => {
    const dx = (Number(lng) - originCoords.lng) / 0.025;
    const dy = (originCoords.lat - Number(lat)) / 0.02;
    const x = Math.max(14, Math.min(86, 50 + dx * 42));
    const y = Math.max(18, Math.min(78, 52 + dy * 42));
    return { x, y };
  };

  canvasEl.innerHTML = `
    <div class="socar-visual-fallback" role="region" aria-label="주변 농기계 위치 안내 지도">
      <svg class="socar-fallback-grid" viewBox="0 0 800 480" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern id="socarGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(23,66,51,0.06)" stroke-width="1" />
          </pattern>
        </defs>
        <rect width="800" height="480" fill="#eef4ee" />
        <rect width="800" height="480" fill="url(#socarGrid)" />
        <path d="M-20,380 C160,330 290,260 440,210 C590,160 700,110 830,80" fill="none" stroke="#ffffff" stroke-width="14" stroke-linecap="round" />
        <path d="M90,-20 C170,130 280,220 420,275 C570,335 690,410 770,500" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" />
        <path d="M40,120 Q280,175 490,90 T820,160" fill="none" stroke="#cfe6f5" stroke-width="18" stroke-linecap="round" opacity="0.7" />
        <circle cx="400" cy="250" r="145" fill="rgba(255, 111, 15, 0.06)" stroke="rgba(255, 111, 15, 0.25)" stroke-dasharray="6 6" stroke-width="1.5" />
      </svg>

      <div class="socar-my-pin socar-fallback-pin" style="left:50%;top:52%" title="${escapeHtml(originLabel)}">
        <span class="socar-my-pulse"></span>
        <span class="socar-my-dot"></span>
        <span class="socar-my-badge">내 위치 · ${escapeHtml(originLabel)}</span>
      </div>

      ${items
        .map((item) => {
          const c = listingCoords(item, item.id);
          const pos = project(c.lat, c.lng);
          const machineLabel = MACHINE_BY_ID[item.machineType]?.label || "농기계";
          const active = item.id === selectedItem?.id;
          return `
            <button
              type="button"
              class="socar-price-pin socar-fallback-pin${active ? " is-active" : ""}"
              style="left:${pos.x.toFixed(1)}%;top:${pos.y.toFixed(1)}%"
              data-map-listing-id="${escapeHtml(item.id)}"
            >
              <span class="socar-pin-tag">${escapeHtml(machineLabel)}</span>
              <strong>${money(item.price)}</strong>
              <span class="socar-pin-tail" aria-hidden="true"></span>
            </button>`;
        })
        .join("")}

      <span class="socar-tile-note">실시간 위치 기반 주변 매물 뷰 · 홍천 비발디파크 반경 30km</span>
    </div>
  `;

  canvasEl.querySelectorAll("[data-map-listing-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = items.find((i) => i.id === btn.dataset.mapListingId);
      if (target) {
        canvasEl.querySelectorAll("[data-map-listing-id]").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.mapListingId === target.id);
        });
        onSelectItem(target);
      }
    });
  });
}

export async function renderHeaderMapView({ onOpenDetail, onRent } = {}) {
  const host = $("mapView");
  if (!host) return;
  fallbackOfficeMap?.remove();
  fallbackOfficeMap = undefined;

  const origin = activeOriginCoords();
  const isVivaldiOrigin =
    Math.abs(Number(origin.lat) - VIVALDI_PARK_ORIGIN.lat) < 0.02 &&
    Math.abs(Number(origin.lng) - VIVALDI_PARK_ORIGIN.lng) < 0.02;
  const originLabel = isVivaldiOrigin ? VIVALDI_PARK_ORIGIN.name : state.region || "내 위치";
  const fallbackOriginAddr = isVivaldiOrigin ? VIVALDI_PARK_ORIGIN.address : `${originLabel} 중심`;

  const items = getHeaderMapNearbyItems(origin);
  let selectedItem =
    items.find((i) => i.id === runtime.selectedMapListingId) ||
    items[0];
  if (selectedItem) runtime.selectedMapListingId = selectedItem.id;

  host.innerHTML = `
    <div class="socar-map-stage">
      <div class="socar-floating-top">
        <div class="socar-loc-pill">
          <span class="socar-loc-dot" aria-hidden="true"></span>
          <div class="socar-loc-copy">
            <strong>내 위치 · ${escapeHtml(originLabel)}</strong>
            <span id="socarOriginAddr">${escapeHtml(fallbackOriginAddr)}</span>
          </div>
        </div>
        <div class="socar-top-actions">
          <button type="button" class="socar-pill-btn" id="socarPublicOfficesBtn">
            전국 공공 임대소 ${publicRentalOffices.length}건
          </button>
          <button type="button" class="socar-pill-btn socar-recenter-btn" id="socarRecenterBtn">
            내 위치 중심
          </button>
        </div>
      </div>

      <div id="socarMapCanvas" class="socar-map-canvas" aria-label="내 주변 농기계 지도">
        <div class="socar-map-loading">홍천 비발디파크 주변 농기계 지도를 불러오는 중...</div>
      </div>

      <div class="socar-floating-card" id="socarFloatingCard" aria-live="polite"></div>
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
  `;

  const renderFloatingCard = (item) => {
    const cardEl = $("socarFloatingCard");
    if (!cardEl || !item) return;
    const dist = distanceKm(origin, item, item.id);
    const machine = MACHINE_BY_ID[item.machineType];
    const photoSrc = getListingPhotoSrc(item) || machineImage(machine);
    const farmName = item.farmName || `${item.region} 농가`;
    const farmAddr = item.address || `${item.region} 인근`;
    const sClass = statusClass(item);

    cardEl.innerHTML = `
      <div class="socar-card-media">
        <img src="${escapeHtml(photoSrc)}" alt="${escapeHtml(item.title)}" />
        <span class="socar-card-dist">내 위치에서 ${dist}km</span>
      </div>
      <div class="socar-card-body">
        <div class="socar-card-tags">
          <span class="card-status-pill ${sClass}">${statusLabel(item)}</span>
          <span class="socar-farm-pill">${escapeHtml(farmName)}</span>
          <span class="socar-machine-pill">${escapeHtml(machine?.label || "농기계")}</span>
        </div>
        <h3 class="socar-card-title">${escapeHtml(item.title)}</h3>
        <p class="socar-card-addr" id="socarFarmAddr">${escapeHtml(farmAddr)}</p>
        <div class="socar-card-bottom">
          <div class="socar-card-price">
            <strong>${money(item.price)}</strong>
            <small>${item.type === "rent" ? "/ 1일 대여" : "중고 구매가"}</small>
          </div>
          <div class="socar-card-actions">
            <button type="button" class="button button-secondary button-sm" id="socarDetailBtn">자세히 보기</button>
            <button type="button" class="button button-primary button-sm" id="socarRentBtn">${item.type === "rent" ? "바로 대여 신청" : "문의하기"}</button>
          </div>
        </div>
      </div>
    `;

    cardEl.classList.remove("is-updated");
    void cardEl.offsetWidth;
    cardEl.classList.add("is-updated");

    $("socarDetailBtn")?.addEventListener("click", () => onOpenDetail?.(item.id));
    $("socarRentBtn")?.addEventListener("click", () => onRent?.(item.id));

    const itemCoords = listingCoords(item, item.id);
    resolveKakaoAddress(itemCoords.lat, itemCoords.lng, farmAddr).then((addr) => {
      const addrEl = $("socarFarmAddr");
      if (addrEl && addr) addrEl.textContent = addr;
    });
  };

  renderFloatingCard(selectedItem);

  resolveKakaoAddress(origin.lat, origin.lng, fallbackOriginAddr).then((addr) => {
    const el = $("socarOriginAddr");
    if (el && addr) el.textContent = addr;
  });

  const canvasEl = $("socarMapCanvas");
  const appKey = runtime.mapConfig?.kakaoAppKey || DEFAULT_KAKAO_JS_KEY;
  let activeMap = null;
  let originLatLng = null;
  let pendingOffice;
  let locateOffice = (office) => { pendingOffice = office; };
  let fallbackMap;
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
        renderPublicOfficeCard($("socarFloatingCard"), office);
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

  $("socarRecenterBtn")?.addEventListener("click", () => {
    if (activeMap && originLatLng) {
      activeMap.panTo(originLatLng);
      toast(`${originLabel} 중심으로 이동했습니다.`);
    } else if (fallbackMap) {
      fallbackMap.panTo([origin.lat, origin.lng]);
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
    if (!canvasEl || $("socarMapCanvas") !== canvasEl) return;
    canvasEl.innerHTML = "";
    originLatLng = new maps.LatLng(Number(origin.lat), Number(origin.lng));
    activeMap = new maps.Map(canvasEl, {
      center: originLatLng,
      level: 5,
    });

    const bounds = new maps.LatLngBounds();
    bounds.extend(originLatLng);

    const myOverlayEl = document.createElement("div");
    myOverlayEl.className = "socar-my-pin";
    myOverlayEl.innerHTML = `
      <span class="socar-my-pulse"></span>
      <span class="socar-my-dot"></span>
      <span class="socar-my-badge">내 위치 · ${escapeHtml(originLabel)}</span>
    `;
    new maps.CustomOverlay({
      map: activeMap,
      position: originLatLng,
      content: myOverlayEl,
      yAnchor: 0.5,
      zIndex: 4,
    });

    const pinElements = new Map();
    const overlays = new Map();
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
        button.className = "socar-price-pin socar-public-office-pin";
        button.title = office[0];
        button.setAttribute("aria-label", office[0]);
        button.textContent = "임대";
        button.addEventListener("click", () => {
          pinElements.forEach((el) => el.classList.remove("is-active"));
          activeMap.panTo(position);
          renderPublicOfficeCard($("socarFloatingCard"), office);
        });
        officeOverlays.set(index, new maps.CustomOverlay({
          map: activeMap,
          position,
          content: button,
          zIndex: 3,
        }));
      });
    };
    const addPin = (item, pos) => {
      const machineLabel = MACHINE_BY_ID[item.machineType]?.label || "농기계";
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = `socar-price-pin${item.id === selectedItem?.id ? " is-active" : ""}`;
      pinBtn.innerHTML = `
        <span class="socar-pin-tag">${escapeHtml(machineLabel)}</span>
        <strong>${money(item.price)}</strong>
        <span class="socar-pin-tail" aria-hidden="true"></span>
      `;
      pinBtn.addEventListener("click", () => {
        selectedItem = item;
        runtime.selectedMapListingId = item.id;
        pinElements.forEach((el, id) => el.classList.toggle("is-active", id === item.id));
        activeMap.panTo(pos);
        renderFloatingCard(item);
      });
      pinElements.set(item.id, pinBtn);

      const overlay = new maps.CustomOverlay({
        map: activeMap,
        position: pos,
        content: pinBtn,
        yAnchor: 1.15,
        zIndex: item.id === selectedItem?.id ? 6 : 5,
      });
      overlays.set(item.id, overlay);
    };

    const mapItems = new Map(items.map((item) => [item.id, item]));
    for (const item of runtime.catalog ?? []) {
      if (item.status === "open") mapItems.set(item.id, item);
    }
    const positions = new Map([...mapItems].map(([id, item]) => {
      const { lat, lng } = listingCoords(item, id);
      return [id, new maps.LatLng(lat, lng)];
    }));
    for (const item of items) bounds.extend(positions.get(item.id));

    const renderVisiblePins = () => {
      const viewport = activeMap.getBounds();
      renderOfficePins(viewport);
      for (const [id, pos] of positions) {
        if (viewport.contain(pos)) {
          if (!overlays.has(id)) addPin(mapItems.get(id), pos);
        } else if (overlays.has(id)) {
          overlays.get(id).setMap(null);
          overlays.delete(id);
          pinElements.delete(id);
        }
      }
    };

    if (pendingOffice) {
      locateOffice(pendingOffice);
    } else if (items.length > 0) {
      activeMap.setBounds(bounds, 70, 60, 180, 60);
    }
    renderVisiblePins();
    maps.event.addListener(activeMap, "idle", renderVisiblePins);
  } catch {
    if (canvasEl && $("socarMapCanvas")) {
      renderHeaderVisualFallback(canvasEl, origin, originLabel, items, selectedItem, (chosen) => {
        selectedItem = chosen;
        runtime.selectedMapListingId = chosen.id;
        renderFloatingCard(chosen);
      });
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
                renderPublicOfficeCard($("socarFloatingCard"), record);
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
