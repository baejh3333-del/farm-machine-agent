// 문제 5 검증: 확인을 물은 작업에 "네/해줘"라고 답하면 /api/agent가 같은 응답 안에서 실제 DB에 실행하고 결과를 돌려준다.
// AI 키 없이도 동작해야 하므로(모델을 거치지 않는 경로) 실제 PGlite DB와 HTTP 핸들러로 끝까지 확인한다.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import accountHandler from "../api/account.js";
import agentHandler from "../api/agent.js";
import { resetAuthCache } from "../server/account-auth.js";
import { createPglitePool, kstToday, setPool } from "../server/db.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";

const ENV_KEYS = ["APP_ENV", "DATABASE_URL", "AI_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

function patchRes(res) {
  let code = 200;
  res.status = (c) => { code = c; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
    return res;
  };
}

async function apiReq(baseUrl, path, { method = "GET", cookie = "", json } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") {
    headers.origin = baseUrl;
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined });
  const setCookie = response.headers.getSetCookie?.() || [];
  const nextCookie = setCookie.length ? setCookie.map((c) => c.split(";")[0]).join("; ") : cookie;
  return { status: response.status, body: await response.json().catch(() => ({})), cookie: nextCookie };
}

async function signup(baseUrl, username, name) {
  const res = await apiReq(baseUrl, "/api/account?action=signup", { method: "POST", json: { username, name, password: "Password123!" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { user: res.body.user, cookie: res.cookie };
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let pool;
let server;
let baseUrl;
let prevEnv;
let buyer;
let saleListing;
let dealingListing;
let rentListing;

before(async () => {
  prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_PROVIDER;
  process.env.APP_ENV = "test";
  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });

  const routes = new Map([["/api/account", accountHandler], ["/api/agent", agentHandler]]);
  server = createServer(async (req, res) => {
    patchRes(res);
    const handler = routes.get(new URL(req.url || "/", "http://x").pathname);
    if (!handler) return res.status(404).json({});
    await handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const owner = await signup(baseUrl, "exec_owner", "김판매");
  buyer = await signup(baseUrl, "exec_buyer", "박구매");

  const base = {
    machineType: "rootHarvester",
    cropIds: ["sweetPotato"],
    operations: ["potatoHarvest"],
    areaMin: 300,
    areaMax: 5000,
    condition: "good",
    brand: "두루기계통상",
    description: "고구마 수확용입니다.",
  };
  saleListing = (await createListing(owner.user, { ...base, id: randomUUID(), title: "두루기계통상 DRGH-1400 · 청기면", type: "sale", price: 3_200_000, region: "청기면" }, { pool })).listing;
  dealingListing = (await createListing(owner.user, { ...base, id: randomUUID(), title: "두루기계통상 DRGH-1400 · 영양읍", type: "sale", price: 3_000_000, region: "영양읍" }, { pool })).listing;
  await pool.query("UPDATE listings SET status = 'dealing' WHERE id = $1", [dealingListing.id]);
  rentListing = (await createListing(owner.user, { ...base, id: randomUUID(), title: "두루기계통상 DRGH-1400 · 입암면", type: "rent", price: 90_000, region: "입암면" }, { pool })).listing;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await pool?.end();
  setPool(undefined);
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const chat = (message, pendingAction, cookie = buyer.cookie) => apiReq(baseUrl, "/api/agent", {
  method: "POST",
  cookie,
  json: { action: "chat", message, history: [], inputMode: "voice", ...(pendingAction ? { pendingAction } : {}) },
});

test("문제5: 거래 불가 매물로 구매를 요청하면 이유와 다음 방법을 한 문장으로 바로 알려 준다(대기 없음)", async () => {
  const res = await chat("응 해줘", { type: "purchase_request", listingId: dealingListing.id, title: dealingListing.title, price: dealingListing.price, requestId: randomUUID() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.mode, "agent");
  assert.match(res.body.reply, /구매 신청을 하지 못했어요\. 이유: 지금 구매 신청을 받을 수 없는 매물입니다\. 다른 매물을 찾아 드릴까요\?/);
  assert.doesNotMatch(res.body.reply, /잠시|기다려/);
  assert.equal(res.body.reservation, undefined);
});

test("문제5: 오류가 난 다음 대화에서도 '너가 바로 구매해줘'로 구매 신청이 같은 응답 안에서 완료되고 DB에 남는다", async () => {
  const requestId = randomUUID();
  const pending = { type: "purchase_request", listingId: saleListing.id, title: saleListing.title, price: saleListing.price, requestId };
  const res = await chat("확인은 했는데 내가 지금 손을 못 써서 너가 바로 구매해줘", pending);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.reservation.kind, "purchase");
  assert.equal(res.body.reservation.listingId, saleListing.id);
  assert.match(res.body.reply, /^'두루기계통상 DRGH-1400 · 청기면' 구매 신청이 완료되었어요![\s\S]*신청 번호는 P-[0-9A-F]{8}예요\.$/);

  const rows = await pool.query("SELECT c.listing_id, m.body FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = $1", [requestId]);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].listing_id, saleListing.id);
  assert.match(rows.rows[0].body, /농농 구매 신청/);

  // 같은 요청을 한 번 더 말해도(같은 requestId) 두 번 신청되지 않는다.
  const again = await chat("네", pending);
  assert.equal(again.body.reservation.number, res.body.reservation.number);
  const count = await pool.query("SELECT count(*)::int AS n FROM messages WHERE id = $1", [requestId]);
  assert.equal(count.rows[0].n, 1);
});

test("문제5: 대여 예약도 '네'라고 하면 같은 응답 안에서 예약 요청이 만들어지고 번호를 알려 준다", async () => {
  const start = addDays(kstToday(), 5);
  const end = addDays(start, 1);
  const res = await chat("네", { type: "rental_request", listingId: rentListing.id, title: rentListing.title, start, end, requestId: randomUUID() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.reservation.kind, "rental");
  assert.match(res.body.reply, /대여 신청이 완료되었어요![\s\S]*신청 번호는 R-[0-9A-F]{8}예요\./);
  const rows = await pool.query("SELECT listing_id, start_date::text AS s FROM rental_requests WHERE listing_id = $1", [rentListing.id]);
  assert.equal(rows.rows.length, 1);
});

test("문제5: 판매글은 '올려줘'라고 하면 바로 등록된다", async () => {
  const res = await chat("판매글 올려줘", {
    type: "create_listing",
    listingType: "sale",
    machineType: "rootHarvester",
    title: "고구마 수확기 팝니다",
    price: 1_500_000,
    region: "청기면",
    cropIds: ["sweetPotato"],
    operations: ["potatoHarvest"],
    delivery: { methods: ["self_pickup"] },
    description: "직접 쓰던 수확기입니다.",
    requestId: randomUUID(),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.createdListing?.id);
  assert.match(res.body.reply, /매물 등록을 완료했어요\. 신청 번호는 L-/);
  const rows = await pool.query("SELECT title, status FROM listings WHERE id = $1", [res.body.createdListing.id]);
  assert.equal(rows.rows[0]?.status, "open");
});

test("문제5: 실행 요청이 아닌 말이나 비로그인 상태에서는 확인 대기 작업을 실행하지 않는다", async () => {
  const pending = { type: "purchase_request", listingId: saleListing.id, title: saleListing.title, requestId: randomUUID() };
  const notYes = await chat("음 좀 더 생각해볼게", pending);
  assert.equal(notYes.body.reservation, undefined);
  const anon = await chat("네", pending, "");
  assert.equal(anon.body.reservation, undefined);
  const count = await pool.query("SELECT count(*)::int AS n FROM messages WHERE id = $1", [pending.requestId]);
  assert.equal(count.rows[0].n, 0);
});
