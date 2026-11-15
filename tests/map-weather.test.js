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
