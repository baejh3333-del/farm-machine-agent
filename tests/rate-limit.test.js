import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/recommend.js";
import {
  checkRecommendLimit, clientAddress, createMemoryStore, recommendLimitResponse, recommendLimits,
} from "../server/rate-limit.js";

const request = (ip, headers = {}) => ({ headers, socket: { remoteAddress: ip } });
const limits = (minute, day, global) => recommendLimits({
  RECOMMEND_LIMIT_PER_MINUTE: String(minute),
  RECOMMEND_LIMIT_PER_DAY: String(day),
  RECOMMEND_GLOBAL_LIMIT_PER_DAY: String(global),
});
const env = {};

test("IP당 분당 한도를 넘으면 다음 분까지 남은 초를 알려준다", async () => {
  const store = createMemoryStore();
  const now = Date.UTC(2026, 10, 7, 12, 0, 30);
  const options = { store, env, now, limits: limits(2, 0, 0) };
  assert.equal((await checkRecommendLimit(request("198.51.100.1"), options)).allowed, true);
  assert.equal((await checkRecommendLimit(request("198.51.100.1"), options)).allowed, true);
  assert.deepEqual(await checkRecommendLimit(request("198.51.100.1"), options), { allowed: false, retryAfter: 30 });
  assert.equal((await checkRecommendLimit(request("198.51.100.2"), options)).allowed, true, "다른 IP는 따로 센다");
  assert.equal((await checkRecommendLimit(request("198.51.100.1"), { ...options, now: now + 30_000 })).allowed, true, "다음 분에는 초기화된다");
});

test("일일 한도는 한국 시간 자정에 초기화된다", async () => {
  const store = createMemoryStore();
  const kst2359 = Date.UTC(2026, 10, 7, 14, 59, 0);
  const options = { store, env, limits: limits(0, 1, 0) };
  assert.equal((await checkRecommendLimit(request("198.51.100.1"), { ...options, now: kst2359 })).allowed, true);
  assert.deepEqual(await checkRecommendLimit(request("198.51.100.1"), { ...options, now: kst2359 }), { allowed: false, retryAfter: 60 });
  assert.equal((await checkRecommendLimit(request("198.51.100.1"), { ...options, now: kst2359 + 60_000 })).allowed, true);
});

test("IP 한도에 막힌 요청은 전체 일일 한도를 소진하지 않는다", async () => {
  const store = createMemoryStore();
  const options = { store, env, now: Date.UTC(2026, 10, 7, 3), limits: limits(1, 0, 3) };
  for (let i = 0; i < 10; i += 1) await checkRecommendLimit(request("203.0.113.9"), options);
  assert.equal((await checkRecommendLimit(request("198.51.100.1"), options)).allowed, true);
  assert.equal((await checkRecommendLimit(request("198.51.100.2"), options)).allowed, true);
  assert.equal((await checkRecommendLimit(request("198.51.100.3"), options)).allowed, false, "전체 한도 3회째 이후 차단");
});

test("한도 0은 제한을 끄고, 잘못된 값은 기본값을 쓴다", async () => {
  const [minute, day, global] = recommendLimits({
    RECOMMEND_LIMIT_PER_MINUTE: "0", RECOMMEND_LIMIT_PER_DAY: "abc", RECOMMEND_GLOBAL_LIMIT_PER_DAY: "-5",
  });
  assert.deepEqual([minute.max, day.max, global.max], [0, 150, 3000]);
  const untouched = { async hit() { throw new Error("제한이 꺼져 있으면 저장소를 쓰지 않는다"); } };
  assert.deepEqual(await checkRecommendLimit(request("198.51.100.1"), { store: untouched, env, limits: limits(0, 0, 0) }), { allowed: true });
});

test("Vercel에서만 전달 헤더의 IP를 믿는다", () => {
  const forwarded = { "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": "198.51.100.7, 10.0.0.1" };
  assert.equal(clientAddress(request("10.0.0.1", forwarded), { VERCEL: "1" }), "203.0.113.5");
  assert.equal(clientAddress(request("10.0.0.1", { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }), { VERCEL: "1" }), "198.51.100.7");
  assert.equal(clientAddress(request("127.0.0.1", forwarded), {}), "127.0.0.1", "로컬에서는 위조 가능한 헤더를 무시한다");
});

test("횟수를 확인할 수 없으면 OpenAI를 부르지 않고 503을 돌려준다", async (t) => {
  t.mock.method(console, "error", () => {});
  const failing = { async hit() { throw new Error("db down"); } };
  const result = await recommendLimitResponse(request("198.51.100.1"), { store: failing, env, limits: limits(1, 0, 0) });
  assert.equal(result.status, 503);
});

test("추천 API는 한도를 넘으면 429와 Retry-After를 돌려준다", async (t) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  process.env = { ...saved, RECOMMEND_LIMIT_PER_MINUTE: "1", RECOMMEND_LIMIT_PER_DAY: "0", RECOMMEND_GLOBAL_LIMIT_PER_DAY: "0" };
  delete process.env.OPENAI_API_KEY;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  const call = async () => {
    const response = {
      statusCode: 200, headers: {}, body: undefined,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await handler({ method: "POST", body: { message: "고추 두둑 대여" }, headers: {}, socket: { remoteAddress: "192.0.2.10" } }, response);
    return response;
  };
  const first = await call();
  assert.equal(first.statusCode, 200);
  assert.equal(typeof first.body.reply, "string");
  const second = await call();
  assert.equal(second.statusCode, 429);
  assert.match(second.headers["Retry-After"], /^\d+$/);
  assert.match(second.body.error, /잠시 후/);
});
