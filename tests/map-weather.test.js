import test from "node:test";
import assert from "node:assert/strict";
import { REGION_COORDS, listingCoords, distanceKm } from "../src/data/farm-machines.js";
import { KOREA_REGIONS, latLngToKmaGrid, getRegionCoords, findNearestRegion } from "../src/data/korea-regions.js";
import { getWeatherAndMapConfig } from "../server/weather.js";

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
  assert.equal(KOREA_REGIONS.length, 17);
  assert.deepEqual(latLngToKmaGrid(36.6667, 129.1124), { nx: 97, ny: 108 }); // 영양읍
  assert.deepEqual(latLngToKmaGrid(37.5665, 126.978), { nx: 60, ny: 127 }); // 서울 시청
  assert.deepEqual(latLngToKmaGrid(35.1796, 129.0756), { nx: 98, ny: 76 }); // 부산 시청
});

test("findNearestRegion과 getRegionCoords는 전국 시/군/구 및 GPS 좌표를 올바르게 매핑한다", () => {
  const seoul = findNearestRegion(37.5665, 126.978);
  assert.equal(seoul.province, "서울특별시");
  assert.ok(seoul.distanceKm < 2);

  const suwon = findNearestRegion(37.2636, 127.0286);
  assert.equal(suwon.name, "경기도 수원시");
  assert.equal(suwon.city, "수원시");
  assert.ok(suwon.distanceKm < 1);

  const yeongyang = findNearestRegion(36.667, 129.112);
  assert.equal(yeongyang.name, "영양읍");
  assert.equal(yeongyang.city, "영양군");

  const resolvedSuwon = getRegionCoords("경기도 수원시");
  assert.equal(resolvedSuwon.name, "경기도 수원시");
  assert.equal(resolvedSuwon.nx, 61);
  assert.equal(resolvedSuwon.ny, 120);
});

test("getWeatherAndMapConfig는 전국 지역명과 명시적 lat/lng 좌표를 그대로 반영한다", async () => {
  const prevKma = process.env.KMA_WEATHER_API_KEY;
  delete process.env.KMA_WEATHER_API_KEY;
  try {
    const resSuwon = await getWeatherAndMapConfig({ region: "경기도 수원시", date: "2026-05-15" });
    assert.equal(resSuwon.region, "경기도 수원시");
    assert.equal(resSuwon.coords.nx, 61);
    assert.equal(resSuwon.coords.ny, 120);
    assert.equal(resSuwon.weather.region, "경기도 수원시");

    const resGps = await getWeatherAndMapConfig({
      region: "서울특별시 강남구",
      lat: 37.5172,
      lng: 127.0473,
      date: "2026-05-15",
    });
    assert.equal(resGps.region, "서울특별시 강남구");
    assert.equal(resGps.coords.lat, 37.5172);
    assert.equal(resGps.coords.lng, 127.0473);
    assert.deepEqual({ nx: resGps.coords.nx, ny: resGps.coords.ny }, latLngToKmaGrid(37.5172, 127.0473));
  } finally {
    if (prevKma !== undefined) process.env.KMA_WEATHER_API_KEY = prevKma;
  }
});
