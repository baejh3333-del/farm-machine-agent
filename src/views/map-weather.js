import { REGION_COORDS, MACHINE_BY_ID, listingCoords, distanceKm } from "../data/farm-machines.js";
import { $, escapeHtml, money, today, toast } from "../core/utils.js";
import { state, runtime, apiFetch } from "../core/store.js";

const WEATHER_ICONS = {
  sun: "☀️",
  cloud: "⛅",
  rain: "🌧️",
  wind: "💨",
  snow: "❄️",
};

let kakaoSdkPromise = null;
let lastWeatherKey = "";

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
        reject(new Error("Kakao Maps SDK load failed"));
      }
    };
    script.onerror = () => reject(new Error("Kakao Maps SDK network error"));
    document.head.appendChild(script);
  });
  return kakaoSdkPromise;
}

export async function refreshWeatherAndMapConfig({ onUpdate } = {}) {
  const targetDate = state.filters.date || today();
  const key = `${state.region}:${targetDate}`;
  if (key === lastWeatherKey && runtime.weatherData) return runtime.weatherData;
  lastWeatherKey = key;

  try {
    const params = new URLSearchParams({ region: state.region, date: targetDate });
    const data = await apiFetch(`/api/weather?${params.toString()}`, { timeoutMs: 5000 });
    if (data?.weather) runtime.weatherData = data.weather;
    if (data?.mapConfig) runtime.mapConfig = data.mapConfig;
    onUpdate?.();
    return data;
  } catch {
    return null;
  }
}

export function renderWeatherBanner() {
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

  host.hidden = false;
  host.className = `rental-weather-banner ${toneClass}`;
  host.innerHTML = `
    <div class="rwb-main">
      <span class="rwb-icon" aria-hidden="true">${icon}</span>
      <div class="rwb-copy">
        <div class="rwb-title-row">
          <strong>${escapeHtml(w.region)} ${isSelectedDate ? escapeHtml(targetDate) : "오늘"} 작업 날씨 · ${escapeHtml(w.summary)}</strong>
          <span class="rwb-source-pill">${w.source === "kma" ? "기상청 단기예보" : "예시 기상 안내"}</span>
        </div>
        <p class="rwb-advice">${escapeHtml(w.advice)}</p>
      </div>
    </div>
    <div class="rwb-metrics">
      ${tempText ? `<span class="rwb-metric">${escapeHtml(tempText)}</span>` : ""}
      <span class="rwb-metric">강수확률 ${Number(w.pop) || 0}%</span>
      <span class="rwb-metric">풍속 ${Number(w.windSpeed) || 0}m/s</span>
    </div>
  `;
}

export function weatherDetailNote() {
  const w = runtime.weatherData;
  if (!w || state.transaction !== "rent") return "";
  const icon = WEATHER_ICONS[w.icon] || "🌤️";
  const toneClass = w.suitability === "caution" ? "is-caution" : w.suitability === "wind" ? "is-wind" : "is-good";
  return `
    <div class="detail-weather-note ${toneClass}">
      <span aria-hidden="true">${icon}</span>
      <div>
        <strong>${escapeHtml(w.region)} (${escapeHtml(w.date)}) · ${escapeHtml(w.summary)} · 강수확률 ${Number(w.pop) || 0}%</strong>
        <p>${escapeHtml(w.advice)}</p>
      </div>
    </div>
  `;
}

function activeOriginCoords() {
  if (runtime.userCoords && Number.isFinite(runtime.userCoords.lat) && Number.isFinite(runtime.userCoords.lng)) {
    return runtime.userCoords;
  }
  return REGION_COORDS[state.region] || REGION_COORDS["영양읍"];
}

export function activeDistanceOrigin() {
  return runtime.userCoords || state.region;
}

function projectToSvg(lat, lng, bounds) {
  const pad = 42;
  const width = 760;
  const height = 420;
  const x = pad + ((lng - bounds.minLng) / Math.max(0.001, bounds.maxLng - bounds.minLng)) * (width - pad * 2);
  const y = height - pad - ((lat - bounds.minLat) / Math.max(0.001, bounds.maxLat - bounds.minLat)) * (height - pad * 2);
  return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
}

function renderSvgMap(container, items, { onOpenDetail }) {
  const origin = activeOriginCoords();
  const regionPoints = Object.values(REGION_COORDS);
  const itemPoints = items.map((item) => ({ item, coords: listingCoords(item) }));

  const allLats = [...regionPoints.map((r) => r.lat), ...itemPoints.map((p) => p.coords.lat), origin.lat];
  const allLngs = [...regionPoints.map((r) => r.lng), ...itemPoints.map((p) => p.coords.lng), origin.lng];
  const bounds = {
    minLat: Math.min(...allLats) - 0.025,
    maxLat: Math.max(...allLats) + 0.025,
    minLng: Math.min(...allLngs) - 0.035,
    maxLng: Math.max(...allLngs) + 0.035,
  };

  const selectedId = runtime.selectedMapListingId && items.some((i) => i.id === runtime.selectedMapListingId)
    ? runtime.selectedMapListingId
    : items[0]?.id || "";
  runtime.selectedMapListingId = selectedId;

  const originPt = projectToSvg(origin.lat, origin.lng, bounds);

  const regionLabelsSvg = regionPoints
    .map((r) => {
      const pt = projectToSvg(r.lat, r.lng, bounds);
      return `
        <g class="map-region-anchor">
          <circle cx="${pt.x}" cy="${pt.y}" r="26" class="map-region-halo" />
          <text x="${pt.x}" y="${pt.y - 32}" text-anchor="middle" class="map-region-text">${escapeHtml(r.name)}</text>
        </g>
      `;
    })
    .join("");

  const pinsSvg = itemPoints
    .map(({ item, coords }) => {
      const pt = projectToSvg(coords.lat, coords.lng, bounds);
      const isSelected = item.id === selectedId;
      return `
        <g class="map-pin ${isSelected ? "is-selected" : ""}" data-map-pin="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="${escapeHtml(item.title)} 위치 보기">
          <circle cx="${pt.x}" cy="${pt.y}" r="${isSelected ? 12 : 8}" class="map-pin-dot" />
          ${isSelected ? `<circle cx="${pt.x}" cy="${pt.y}" r="18" class="map-pin-ring" />` : ""}
        </g>
      `;
    })
    .join("");

  const selectedItem = items.find((i) => i.id === selectedId);
  const originArg = activeDistanceOrigin();

  container.innerHTML = `
    <div class="map-canvas-wrap">
      <svg viewBox="0 0 760 420" class="regional-svg-map" role="img" aria-label="영양군 농기계 매물 위치 지도">
        <defs>
          <pattern id="farmGrid" width="38" height="38" patternUnits="userSpaceOnUse">
            <path d="M 38 0 L 0 0 0 38" fill="none" stroke="rgba(45, 90, 56, 0.08)" stroke-width="1" />
          </pattern>
        </defs>
        <rect width="760" height="420" fill="#f2efe7" rx="16" />
        <rect width="760" height="420" fill="url(#farmGrid)" rx="16" />
        ${regionLabelsSvg}
        <g class="map-user-origin">
          <circle cx="${originPt.x}" cy="${originPt.y}" r="14" fill="rgba(37, 99, 235, 0.16)" />
          <circle cx="${originPt.x}" cy="${originPt.y}" r="6.5" fill="#2563eb" stroke="#ffffff" stroke-width="2" />
          <text x="${originPt.x}" y="${originPt.y + 20}" text-anchor="middle" class="map-user-text">${runtime.userCoords ? "내 GPS 위치" : `내 동네 (${escapeHtml(state.region)})`}</text>
        </g>
        ${pinsSvg}
      </svg>
      <div class="map-provider-badge">내장 지역 지도 (카카오맵 키 미설정 시 기본 제공)</div>
    </div>
    <div class="map-selected-card" id="mapSelectedCard">
      ${
        selectedItem
          ? `
            <div class="msc-info">
              <span class="msc-region">${escapeHtml(selectedItem.region)} · ${distanceKm(originArg, selectedItem.region, selectedItem.id)}km · ${escapeHtml(MACHINE_BY_ID[selectedItem.machineType]?.label || "")}</span>
              <strong>${escapeHtml(selectedItem.title)}</strong>
              <span class="msc-price">${money(selectedItem.price)}${selectedItem.type === "rent" ? " / 1일" : ""}</span>
            </div>
            <button type="button" class="button button-primary" id="mapOpenDetailBtn">상세 보기</button>
          `
          : `<p class="msc-empty">표시할 매물이 없습니다. 검색 조건을 조정해 보세요.</p>`
      }
    </div>
  `;

  container.querySelectorAll("[data-map-pin]").forEach((pin) => {
    const selectPin = () => {
      runtime.selectedMapListingId = pin.dataset.mapPin;
      renderSvgMap(container, items, { onOpenDetail });
    };
    pin.addEventListener("click", selectPin);
    pin.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectPin();
      }
    });
  });

  $("mapOpenDetailBtn")?.addEventListener("click", () => {
    if (selectedItem) onOpenDetail?.(selectedItem.id);
  });
}

async function renderKakaoMap(container, items, appKey, { onOpenDetail }) {
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
      title: runtime.userCoords ? "내 GPS 위치" : `내 동네 (${state.region})`,
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
    renderSvgMap(container, items, { onOpenDetail });
  }
}

export function renderListingMap(items, { onOpenDetail, onGpsUpdated } = {}) {
  const host = $("listingMapPanel");
  if (!host) return;
  if (state.viewMode !== "map") {
    host.hidden = true;
    return;
  }

  host.hidden = false;
  host.innerHTML = `
    <div class="map-toolbar">
      <div class="map-toolbar-info">
        <strong>매물 위치 지도</strong>
        <span>${runtime.userCoords ? "현재 GPS 위치 기준 거리 표시 중" : `${escapeHtml(state.region)} 중심 기준 직선거리(km)`}</span>
      </div>
      <div class="map-toolbar-actions">
        <button type="button" class="button button-secondary map-gps-btn" id="mapUseGpsBtn">
          ${runtime.userCoords ? "GPS 위치 다시 잡기" : "현재 위치(GPS)로 거리 계산"}
        </button>
        ${runtime.userCoords ? `<button type="button" class="button-reset-inline" id="mapClearGpsBtn">동네 기준으로 복원</button>` : ""}
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
        runtime.userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
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
    runtime.userCoords = null;
    toast(`${state.region} 기준으로 거리를 복원했습니다.`);
    onGpsUpdated?.();
  });

  const renderArea = $("mapRenderArea");
  if (runtime.mapConfig?.provider === "kakao" && runtime.mapConfig?.kakaoAppKey) {
    renderKakaoMap(renderArea, items, runtime.mapConfig.kakaoAppKey, { onOpenDetail });
  } else {
    renderSvgMap(renderArea, items, { onOpenDetail });
  }
}
