import test from "node:test";
import assert from "node:assert/strict";

delete process.env.OPENAI_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
const { createDevServer } = await import("../dev-server.js");

test("개발 서버는 Vercel과 같은 API 핸들러로 응답한다", async (t) => {
  const server = createDevServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body });

  const listings = await fetch(`${base}/api/listings`);
  assert.equal(listings.status, 200);
  assert.equal((await listings.json()).listings.length, 100);

  const wrongMethod = await post("/api/listings", "{}");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");

  const invalid = await post("/api/recommend", "{not json");
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /JSON/);

  const tooLarge = await post("/api/recommend", JSON.stringify({ message: "고추", pad: "가".repeat(4000) }));
  assert.equal(tooLarge.status, 413, "한글 4,000자는 12,000바이트라 바이트 기준으로 막힌다");

  const ok = await post("/api/recommend", JSON.stringify({ message: "고추 두둑 대여" }));
  assert.equal(ok.status, 200);
  const result = await ok.json();
  assert.equal(typeof result.reply, "string");
  assert.ok(Array.isArray(result.listingIds));

  assert.equal((await fetch(`${base}/src/main.js`)).status, 200);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
});
