import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/recommend.js";

test("추천 API는 제한을 넘긴 요청의 모델 호출을 막고 다음 시간창에 다시 허용한다", async (t) => {
  const variables = ["OPENAI_API_KEY", "DATABASE_URL", "VERCEL"];
  const previous = new Map(variables.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.OPENAI_API_KEY = "mock-only";
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-12T00:00:00Z") });
  const model = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ output: [{ content: [{ type: "output_text", text: '{"intent":"help"}' }] }] }),
  }));

  async function ask(ip, headers = {}, body = { message: "도움", context: { action: "interpret" } }) {
    const response = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      writeHead(status) { this.status = status; return this; },
      end(data) { this.body = JSON.parse(data); },
    };
    await handler({ method: "POST", headers, body, socket: { remoteAddress: ip } }, response);
    return response;
  }

  const ip = "192.0.2.1";
  assert.equal((await ask(ip, {}, { message: "가".repeat(3500) })).status, 413);
  const results = await Promise.all(Array.from({ length: 13 }, () => ask(ip, { "x-vercel-forwarded-for": "192.0.2.2" })));
  assert.equal(results.filter(({ status }) => status === 200).length, 12);
  assert.equal(results.find(({ status }) => status === 429).headers["Retry-After"], "60");
  assert.equal(model.mock.callCount(), 12);
  assert.equal((await ask("192.0.2.2")).status, 200);
  for (let client = 3; client <= 11; client++) {
    for (let request = 0; request < 12; request++) await ask(`192.0.2.${client}`);
  }
  assert.equal((await ask("192.0.2.12")).status, 429);
  assert.equal(model.mock.callCount(), 120);
  t.mock.timers.tick(60_000);
  assert.equal((await ask(ip)).status, 200);
  assert.equal(model.mock.callCount(), 121);
  process.env.VERCEL = "1";
  const fallback = await ask(ip, { "x-vercel-forwarded-for": ip });
  assert.equal(fallback.body.mode, "guide");
  assert.equal(model.mock.callCount(), 121);
});
