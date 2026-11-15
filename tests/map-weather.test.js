import test from "node:test";
import assert from "node:assert/strict";
import { REGION_COORDS, listingCoords, distanceKm } from "../src/data/farm-machines.js";
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
