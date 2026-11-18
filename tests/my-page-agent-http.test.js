// /api/agent로 마이페이지 변경을 끝까지 확인한다(실제 PGlite DB, 실제 로그인 쿠키, AI 키 없음).
// - 확인 대기 작업에 "네"라고 하면(글·음성) 같은 응답 안에서 실행되고 DB에 남는다.
// - 화면 승인(action: execute)도 같은 검증을 거친다. 다른 계정 것을 위조하면 서비스가 막는다.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import accountHandler from "../api/account.js";
import agentHandler from "../api/agent.js";
import { resetAuthCache } from "../server/account-auth.js";
import { createPglitePool, setPool } from "../server/db.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";
import { prepareMyPageAction } from "../server/my-page-agent.js";
import { addOwnedMachine } from "../server/user-data.js";

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

let pool;
let server;
let baseUrl;
let prevEnv;
let alice;
let bob;
let bobListing;
let aliceMachineId;

async function apiReq(path, { cookie = "", json } = {}) {
  const headers = { origin: baseUrl, "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(json) });
  const setCookie = response.headers.getSetCookie?.() || [];
  const nextCookie = setCookie.length ? setCookie.map((c) => c.split(";")[0]).join("; ") : cookie;
  return { status: response.status, body: await response.json().catch(() => ({})), cookie: nextCookie };
}

async function signup(username, name) {
  const res = await apiReq("/api/account?action=signup", { json: { username, name, password: "Password123!" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { user: res.body.user, cookie: res.cookie };
}

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
  alice = await signup("http_alice", "앨리스");
  bob = await signup("http_bob", "밥농부");
  bobListing = (await createListing(bob.user, {
    id: randomUUID(), title: "밥의 판매 수확기", type: "sale", price: 3_000_000, region: "청기면",
    machineType: "rootHarvester", cropIds: ["sweetPotato"], operations: ["potatoHarvest"], areaMin: 300, areaMax: 5000,
    condition: "good", brand: "두루기계통상", description: "고구마 수확용입니다.",
  }, { pool })).listing;
  aliceMachineId = randomUUID();
  await addOwnedMachine(alice.user.id, { id: aliceMachineId, modelId: "kubota-b2320", name: "앨리스 트랙터" }, { pool });
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

const chat = (cookie, message, pendingAction, inputMode = "text") => apiReq("/api/agent", {
  cookie,
  json: { action: "chat", message, history: [], inputMode, ...(pendingAction ? { pendingAction } : {}) },
});
const execute = (cookie, pendingAction, requestId = randomUUID()) => apiReq("/api/agent", { cookie, json: { action: "execute", pendingAction, requestId } });
const nameOf = async (id) => (await pool.query('SELECT name FROM "user" WHERE id = $1', [id])).rows[0].name;

test("HTTP: 확인 대기 중인 마이페이지 변경에 '네'라고 하면 같은 응답 안에서 실제로 바뀐다(글·음성)", async () => {
  const pending = await prepareMyPageAction(alice.user, { operation: "update_nickname", args: { name: "앨리스농장" } });
  const res = await chat(alice.cookie, "네", pending);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.executedAction, "my_page_action");
  assert.equal(res.body.reply, "닉네임을 '앨리스농장'(으)로 바꿨어요.");
  assert.equal(res.body.myPageAction.operation, "update_nickname");
  assert.equal(await nameOf(alice.user.id), "앨리스농장");
  assert.equal(await nameOf(bob.user.id), "밥농부");

  const voicePending = await prepareMyPageAction(alice.user, { operation: "add_owned_machine", args: { modelId: "tym-t25", name: "음성 트랙터" } });
  const voice = await chat(alice.cookie, "응 해줘", voicePending, "voice");
  assert.equal(voice.status, 200, JSON.stringify(voice.body));
  assert.equal(voice.body.reply, "내 농기계에 추가했어요.");
  // 같은 확인을 다시 보내도(중복 전송) 한 대만 생긴다: 서버가 만든 requestId를 그대로 쓴다.
  await chat(alice.cookie, "네", voicePending, "voice");
  const rows = await pool.query("SELECT id FROM owned_machines WHERE user_id = $1 AND name = '음성 트랙터'", [alice.user.id]);
  assert.deepEqual(rows.rows.map((r) => r.id), [voicePending.requestId]);
});

test("HTTP: '네'가 아니면 실행하지 않고, 실패하면 이유를 말한다", async () => {
  const pending = await prepareMyPageAction(alice.user, { operation: "update_nickname", args: { name: "안바뀜" } });
  const res = await chat(alice.cookie, "아니요 잠깐만요", pending);
  assert.equal(res.status, 200);
  assert.notEqual(await nameOf(alice.user.id), "안바뀜");

  // 다른 계정 매물을 숨기는 위조 확인: 서비스가 막고 DB는 그대로다.
  const forged = { type: "my_page_action", operation: "hide_listing", args: { listingId: bobListing.id }, summary: "숨길까요?", requestId: randomUUID() };
  const denied = await chat(alice.cookie, "네", forged);
  assert.equal(denied.status, 200);
  assert.equal(denied.body.actionFailed, true);
  assert.match(denied.body.reply, /^마이페이지 변경을 하지 못했어요\. 이유: 내가 등록한 매물만 변경할 수 있습니다\.$/);
  assert.equal((await pool.query("SELECT status FROM listings WHERE id = $1", [bobListing.id])).rows[0].status, "open");
});

test("HTTP: 화면 승인(execute)도 실제로 반영되고, 계정 분리·허용 목록·로그인을 지킨다", async () => {
  const pending = await prepareMyPageAction(bob.user, { operation: "set_listing_status", args: { listingId: bobListing.id, status: "dealing" } });
  const ok = await execute(bob.cookie, pending);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.outcome, "completed");
  assert.equal((await pool.query("SELECT status FROM listings WHERE id = $1", [bobListing.id])).rows[0].status, "dealing");

  const forged = await execute(bob.cookie, { type: "my_page_action", operation: "remove_owned_machine", args: { ownedMachineId: aliceMachineId } });
  assert.equal(forged.body.outcome, "failed");
  assert.equal(forged.body.code, "FORBIDDEN");
  assert.equal((await pool.query("SELECT 1 FROM owned_machines WHERE id = $1", [aliceMachineId])).rows.length, 1);

  const unsupported = await execute(bob.cookie, { type: "my_page_action", operation: "update_password", args: { password: "x" } });
  assert.equal(unsupported.body.outcome, "failed");
  assert.equal(unsupported.body.code, "UNSUPPORTED_OPERATION");

  for (const type of ["constructor", "__proto__", "toString"]) {
    const weird = await execute(bob.cookie, { type });
    assert.equal(weird.status, 400, type);
    assert.equal(weird.body.code, "INVALID_ACTION");
  }

  const anonymous = await execute("", pending);
  assert.equal(anonymous.status, 401);
  const anonChat = await chat("", "네", pending);
  assert.equal(anonChat.body.executedAction, undefined, "비로그인은 확인 대기 작업을 실행하지 않는다");
});
