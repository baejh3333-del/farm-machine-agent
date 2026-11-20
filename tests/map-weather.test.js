import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { REGION_COORDS, listingCoords, distanceKm } from "../src/data/farm-machines.js";
import { KOREA_REGIONS, latLngToKmaGrid, getRegionCoords, findNearestRegion } from "../src/data/korea-regions.js";
import { getWeatherAndMapConfig } from "../server/weather.js";
import { DEFAULT_FALLBACK_REGION, runtime, state } from "../src/core/store.js";
import {
  CLUSTER_SCALE_THRESHOLD_METERS,
  HEADER_CLUSTER_STEPS,
  clusterListingsByZoom,
  getClusterThresholdKm,
  getScaleMetersForZoomLevel,
  measureMapScaleMeters,
  shouldClusterAtScale,
  getHeaderMapAllItems,
} from "../src/views/map-weather.js";

test("listingCoords와 distanceKm는 결정적 좌표 기반 직선거리를 계산한다", () => {
  const c1 = listingCoords("영양읍", "rent-1");
  const c2 = listingCoords("영양읍", "rent-1");
  assert.deepEqual(c1, c2);

  const sameRegionKm = distanceKm("영양읍", "영양읍", "rent-1");
  const farRegionKm = distanceKm("영양읍", "수비면", "rent-1");
  assert.ok(sameRegionKm >= 0.2 && sameRegionKm < 4, `sameRegionKm=${sameRegionKm}`);
  assert.ok(farRegionKm > 10 && farRegionKm < 25, `farRegionKm=${farRegionKm}`);

  const gpsKm = distanceKm({ lat: REGION_COORDS["입암면"].lat, lng: REGION_COORDS["입암면"].lng }, "입암면", "rent-2");
  assert.ok(gpsKm >= 0.2 && gpsKm < 4, `gpsKm=${gpsKm}`);
});

test("getWeatherAndMapConfig는 API 키 미설정 시 폴백 예보와 svg 지도 설정을 반환한다", async () => {
  const prevKma = process.env.KMA_WEATHER_API_KEY;
  const prevKakao = process.env.KAKAO_MAP_JS_KEY;
  delete process.env.KMA_WEATHER_API_KEY;
  delete process.env.KAKAO_MAP_JS_KEY;

  try {
    const res = await getWeatherAndMapConfig({ region: "청기면", date: "2026-05-15" });
    assert.equal(res.region, "청기면");
    assert.equal(res.mapConfig.provider, "unavailable");
    assert.equal(res.mapConfig.kakaoAppKey, null);
    assert.equal(res.weather.source, "fallback");
    assert.ok(["good", "caution", "wind"].includes(res.weather.suitability));
    assert.equal(typeof res.weather.advice, "string");
    assert.ok(res.weather.advice.length > 0);
  } finally {
    if (prevKma !== undefined) process.env.KMA_WEATHER_API_KEY = prevKma;
    if (prevKakao !== undefined) process.env.KAKAO_MAP_JS_KEY = prevKakao;
  }
});

test("KAKAO_MAP_JS_KEY가 설정되면 mapConfig.provider가 kakao로 전환된다", async () => {
  const prevKakao = process.env.KAKAO_MAP_JS_KEY;
  process.env.KAKAO_MAP_JS_KEY = "demo-kakao-js-key";
  try {
    const res = await getWeatherAndMapConfig({ region: "영양읍", date: "2026-05-15" });
    assert.equal(res.mapConfig.provider, "kakao");
    assert.equal(res.mapConfig.kakaoAppKey, "demo-kakao-js-key");
  } finally {
    if (prevKakao !== undefined) process.env.KAKAO_MAP_JS_KEY = prevKakao;
    else delete process.env.KAKAO_MAP_JS_KEY;
  }
});

test("getWeatherAndMapConfig는 며칠간 예보(forecastDays)와 시간대별 슬롯(slots)·작업 팁을 반환한다", async () => {
  const prevKma = process.env.KMA_WEATHER_API_KEY;
  delete process.env.KMA_WEATHER_API_KEY;
  try {
    const res = await getWeatherAndMapConfig({ region: "영양읍", days: 5 });
    assert.equal(Array.isArray(res.forecastDays), true);
    assert.equal(res.forecastDays.length, 5);
    assert.equal(res.forecastDays[0].inShortTermRange, true);
    assert.equal(res.forecastDays[3].inShortTermRange, true);
    assert.equal(res.forecastDays[4].inShortTermRange, false);

    assert.equal(Array.isArray(res.weather.slots), true);
    assert.ok(res.weather.slots.length >= 4);
    assert.equal(typeof res.weather.slots[0].timeLabel, "string");
    assert.equal(typeof res.weather.slots[0].temp, "number");

    assert.equal(Array.isArray(res.weather.workTips), true);
    assert.equal(res.weather.workTips.length, 3);
  } finally {
    if (prevKma !== undefined) process.env.KMA_WEATHER_API_KEY = prevKma;
  }
});

test("getWeatherAndMapConfig는 endDate가 주어지면 예약 기간 일별 예보(rangeForecast)와 예보 가능 여부를 반환한다", async () => {
  const prevKma = process.env.KMA_WEATHER_API_KEY;
  delete process.env.KMA_WEATHER_API_KEY;
  try {
    const base = await getWeatherAndMapConfig({ region: "수비면" });
    const todayYmd = base.today;
    const endMs = Date.parse(`${todayYmd}T00:00:00Z`) + 4 * 86_400_000;
    const endYmd = new Date(endMs).toISOString().slice(0, 10);

    const res = await getWeatherAndMapConfig({ region: "수비면", date: todayYmd, endDate: endYmd });
    assert.equal(Array.isArray(res.rangeForecast), true);
    assert.equal(res.rangeForecast.length, 5);
    assert.equal(res.rangeForecast[0].date, todayYmd);
    assert.equal(res.rangeForecast[0].inShortTermRange, true);
    assert.equal(res.rangeForecast[4].date, endYmd);
    assert.equal(res.rangeForecast[4].inShortTermRange, false);
  } finally {
    if (prevKma !== undefined) process.env.KMA_WEATHER_API_KEY = prevKma;
  }
});

test("latLngToKmaGrid는 한국 주요 지점의 기상청 단기예보 격자(nx, ny)를 정확히 변환한다", () => {
  assert.equal(KOREA_REGIONS.length, 15);
  assert.deepEqual(latLngToKmaGrid(36.6667, 129.1124), { nx: 97, ny: 108 }); // 영양읍
  assert.deepEqual(latLngToKmaGrid(37.5665, 126.978), { nx: 60, ny: 127 }); // 서울 시청
  assert.deepEqual(latLngToKmaGrid(35.1796, 129.0756), { nx: 98, ny: 76 }); // 부산 시청
});

test("findNearestRegion과 getRegionCoords는 전국 시/군/구 및 GPS 좌표를 올바르게 매핑한다", () => {
  const chuncheon = findNearestRegion(37.8813, 127.7298);
  assert.equal(chuncheon.province, "강원특별자치도");
  assert.ok(chuncheon.distanceKm < 2);

  const icheon = findNearestRegion(37.272, 127.435);
  assert.equal(icheon.name, "경기도 이천시");
  assert.equal(icheon.city, "이천시");
  assert.ok(icheon.distanceKm < 1);

  const yeongyang = findNearestRegion(36.667, 129.112);
  assert.equal(yeongyang.name, "영양읍");
  assert.equal(yeongyang.city, "영양군");

  const resolvedIcheon = getRegionCoords("경기도 이천시");
  assert.equal(resolvedIcheon.name, "경기도 이천시");
  assert.equal(resolvedIcheon.nx, 68);
  assert.equal(resolvedIcheon.ny, 120);
});

test("getWeatherAndMapConfig는 전국 지역명과 명시적 lat/lng 좌표를 그대로 반영한다", async () => {
  const prevKma = process.env.KMA_WEATHER_API_KEY;
  delete process.env.KMA_WEATHER_API_KEY;
  try {
    const resIcheon = await getWeatherAndMapConfig({ region: "경기도 이천시", date: "2026-05-15" });
    assert.equal(resIcheon.region, "경기도 이천시");
    assert.equal(resIcheon.coords.nx, 68);
    assert.equal(resIcheon.coords.ny, 120);
    assert.equal(resIcheon.weather.region, "경기도 이천시");

    const resGps = await getWeatherAndMapConfig({
      region: "강원특별자치도 춘천시",
      lat: 37.8813,
      lng: 127.7298,
      date: "2026-05-15",
    });
    assert.equal(resGps.region, "강원특별자치도 춘천시");
    assert.equal(resGps.coords.lat, 37.8813);
    assert.equal(resGps.coords.lng, 127.7298);
    assert.deepEqual({ nx: resGps.coords.nx, ny: resGps.coords.ny }, latLngToKmaGrid(37.8813, 127.7298));
  } finally {
    if (prevKma !== undefined) process.env.KMA_WEATHER_API_KEY = prevKma;
  }
});

test("clusterListingsByZoom은 지도 축소 레벨에 따라 매물을 단일 점으로 단계적 통합한다", () => {
  const origin = { lat: 37.6456, lng: 127.6844 };
  const sampleItems = [
    { id: "hc-1", region: "서면 팔봉리", title: "팔봉 트랙터", lat: 37.6538, lng: 127.6942, status: "open" },
    { id: "hc-2", region: "강원특별자치도 홍천군", title: "남면 트랙터", lat: 37.618, lng: 127.805, status: "open" },
    { id: "yy-1", region: "영양읍", title: "영양 농기계 1", lat: 36.6667, lng: 129.1124, status: "open" },
    { id: "yy-2", region: "청기면", title: "영양 농기계 2", lat: 36.704, lng: 129.048, status: "open" },
  ];

  assert.equal(getClusterThresholdKm(5).km, 0);
  assert.equal(getClusterThresholdKm(6).km, 7);
  assert.equal(getClusterThresholdKm(8).km, 38);
  assert.equal(getClusterThresholdKm(12).km, 1000);

  const lv5 = clusterListingsByZoom(sampleItems, 5, origin);
  assert.equal(lv5.length, 4);
  assert.ok(lv5.every((c) => c.count === 1));

  const lv8 = clusterListingsByZoom(sampleItems, 8, origin);
  assert.equal(lv8.length, 2);
  assert.deepEqual(lv8.map((c) => c.count).sort((a, b) => a - b), [2, 2]);

  const lv12 = clusterListingsByZoom(sampleItems, 12, origin);
  assert.equal(lv12.length, 1);
  assert.equal(lv12[0].count, 4);
  assert.equal(lv12[0].isAllCluster, true);
  assert.equal(lv12[0].items[0].id, "hc-1");
  assert.equal(lv12[0].items.length, 4);
});

test("getHeaderMapAllItems는 DB 매물이 있으면 홍천 강제 선택·덧씌우기를 하지 않고 비어 있을 때만 폴백한다", () => {
  const prevCatalog = runtime.catalog;
  const prevSelected = runtime.selectedMapListingId;
  try {
    runtime.selectedMapListingId = "";
    runtime.catalog = [
      { id: "yy-only-1", region: "영양읍", title: "영양 매물", status: "open", lat: 36.6667, lng: 129.1124 },
    ];
    const items = getHeaderMapAllItems({ lat: 36.6667, lng: 129.1124 });
    assert.deepEqual(items.map((i) => i.id), ["yy-only-1"]);
    assert.equal(runtime.selectedMapListingId, "");

    runtime.catalog = [];
    const fallbackItems = getHeaderMapAllItems({ lat: 37.6456, lng: 127.6844 });
    assert.equal(fallbackItems.length, 1);
    assert.equal(fallbackItems[0].id, "hc-vivaldi-1");
  } finally {
    runtime.catalog = prevCatalog;
    runtime.selectedMapListingId = prevSelected;
  }
});

test("250m 축척 경계까지는 개별 매물을 유지하고 250m 초과 축소에서만 그룹화하며 통합 문구를 쓰지 않는다", () => {
  const origin = { lat: 37.6538, lng: 127.6942 };
  const closeItems = [
    { id: "near-1", region: "서면 팔봉리", title: "트랙터 A", lat: 37.6538, lng: 127.6942, status: "open" },
    { id: "near-2", region: "서면 팔봉리", title: "트랙터 B", lat: 37.65405, lng: 127.69435, status: "open" },
    { id: "other-1", region: "홍천읍", title: "관리기 C", lat: 37.6541, lng: 127.6945, status: "open" },
  ];

  assert.equal(CLUSTER_SCALE_THRESHOLD_METERS, 250);
  assert.equal(getScaleMetersForZoomLevel(1), 20);
  assert.equal(getScaleMetersForZoomLevel(2), 30);
  assert.equal(getScaleMetersForZoomLevel(3), 50);
  assert.equal(getScaleMetersForZoomLevel(4), 100);
  assert.equal(getScaleMetersForZoomLevel(5), 250);
  assert.equal(getScaleMetersForZoomLevel(6), 500);
  assert.equal(shouldClusterAtScale(20), false);
  assert.equal(shouldClusterAtScale(100), false);
  assert.equal(shouldClusterAtScale(250), false);
  assert.equal(shouldClusterAtScale(251), true);
  assert.equal(shouldClusterAtScale(500), true);

  // 250m 이하(실제 축척 및 Lv.1~Lv.5 폴백)에서는 매우 가까운 매물도 개별 유지
  const at100m = clusterListingsByZoom(closeItems, 4, origin, { scaleMeters: 100 });
  assert.equal(at100m.length, 3);
  assert.ok(at100m.every((c) => c.count === 1));

  const at250m = clusterListingsByZoom(closeItems, 5, origin, { scaleMeters: 250 });
  assert.equal(at250m.length, 3);
  assert.ok(at250m.every((c) => c.count === 1));

  const fallbackLv5 = clusterListingsByZoom(closeItems, 5, origin);
  assert.equal(fallbackLv5.length, 3);
  assert.ok(fallbackLv5.every((c) => c.count === 1));

  // 250m 초과(251m / Lv.6 500m)에서는 가까운 매물이 그룹화됨
  const at251m = clusterListingsByZoom(closeItems, 5, origin, { scaleMeters: 251 });
  assert.equal(at251m.length, 1);
  assert.equal(at251m[0].count, 3);
  assert.doesNotMatch(at251m[0].label, /통합/);

  const fallbackLv6 = clusterListingsByZoom(closeItems, 6, origin);
  assert.equal(fallbackLv6.length, 1);
  assert.equal(fallbackLv6[0].count, 3);
  assert.doesNotMatch(fallbackLv6[0].label, /통합/);

  // 전국 클러스터 및 모든 단계 라벨에도 '통합' 문구가 없어야 함
  const allKr = clusterListingsByZoom(closeItems, 12, origin);
  assert.doesNotMatch(allKr[0].label, /통합/);
  for (const step of HEADER_CLUSTER_STEPS) {
    assert.doesNotMatch(step.label, /통합/);
  }

  // 같은 지역(예: 영양읍)의 여러 매물도 완전히 같은 한 점이 아니라 개별 농가 좌표로 분산되어 250m 이하에서 각각 보인다
  const yy1 = listingCoords("영양읍", "r1");
  const yy2 = listingCoords("영양읍", "mock-cultivator-rent-5");
  const yy3 = listingCoords("영양읍", "mock-tractor-sale-3");
  assert.notDeepEqual(yy1, yy2);
  assert.notDeepEqual(yy2, yy3);

  const fallbackOnlyMap = { getLevel: () => 5 };
  assert.equal(measureMapScaleMeters(fallbackOnlyMap, { clientWidth: 0 }), 250);
});

test("초기 기본 지역은 수도권(경기도 이천시)이고 가짜 기본 GPS 좌표는 넣지 않는다", () => {
  assert.equal(DEFAULT_FALLBACK_REGION, "경기도 이천시");
  assert.equal(state.region, "경기도 이천시");
  assert.equal(state.regionSource, "default");
  assert.equal(state.userCoords, null);
});

test("지도 매물 목록을 접으면(.is-list-collapsed) design-shell.css에서도 왼쪽 빈칸 없이 지도가 전체 너비로 커진다", () => {
  const css = fs.readFileSync(new URL("../src/styles/design-shell.css", import.meta.url), "utf8");
  assert.match(css, /#mapView\s+\.header-map-layout\.is-list-collapsed\s*\{[^}]*grid-template-columns:\s*0px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /#mapView\s+\.header-map-layout\.is-list-collapsed\s+\.header-map-list\s*\{[^}]*position:\s*absolute/s);
});

