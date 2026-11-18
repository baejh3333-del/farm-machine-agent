import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import agentHandler from "../api/agent.js";
import { resetAuthCache } from "../server/account-auth.js";
import { createPglitePool, setPool } from "../server/db.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";

const ENV = ["APP_ENV", "DATABASE_URL", "AI_PROVIDER", "AI_FULL_TOOLS", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
let prevEnv;
let pool;
let server;
let baseUrl;

before(async () => {
  prevEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.APP_ENV = "test";
  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });
  server = createServer((req, res) => agentHandler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end?.();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// OpenAI 호출만 가짜로 돌려준다: 첫 호출은 매물 검색 도구, 다음 호출은 답변.
function mockOpenAi(t, turns) {
  process.env.OPENAI_API_KEY = "test-openai-key";
  t.after(() => { delete process.env.OPENAI_API_KEY; });
  const realFetch = globalThis.fetch;
  let index = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (!String(url).startsWith("https://api.openai.com")) return realFetch(url, options);
    const turn = turns[Math.min(index, turns.length - 1)];
    index += 1;
    return Response.json({ choices: [{ message: turn }] });
  });
}

const SEARCH_TURNS = [
  {
    content: null,
    tool_calls: [{
      id: "call_search_1",
      type: "function",
      function: { name: "search_listings", arguments: JSON.stringify({ machineType: "tractor", transaction: "sale" }) },
    }],
  },
  { content: "조건에 맞는 트랙터 판매 매물을 찾았어요." },
];

async function post(json) {
  return fetch(`${baseUrl}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(json),
  });
}

test("stream: true 채팅은 실제 검색 진행 문구를 먼저 보내고 마지막 줄에 결과를 보낸다", async (t) => {
  mockOpenAi(t, SEARCH_TURNS);
  const response = await post({ action: "chat", message: "트랙터 사고 싶어요", stream: true });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(lines.length >= 2);
  const progress = lines.slice(0, -1);
  assert.ok(progress.every((line) => line.type === "progress" && Object.keys(line).join() === "type,label"));
  assert.ok(progress.some((line) => /트랙터 판매 매물을 찾고 있어요$/.test(line.label)), JSON.stringify(progress));
  assert.ok(progress.every((line) => !/search_listings|tool|machineType|\{/.test(line.label)));
  const last = lines.at(-1);
  assert.equal(last.type, "result");
  assert.equal(last.status, 200);
  assert.equal(last.body.mode, "agent");
  assert.equal(last.body.reply, "조건에 맞는 트랙터 판매 매물을 찾았어요.");
});

test("stream이 없는 채팅은 같은 검색이어도 평소 JSON 한 번으로 응답한다", async (t) => {
  mockOpenAi(t, SEARCH_TURNS);
  const response = await post({ action: "chat", message: "트랙터 사고 싶어요" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.mode, "agent");
  assert.equal(body.reply, "조건에 맞는 트랙터 판매 매물을 찾았어요.");
});

test("stream: true여도 조회 없이 끝난 답변·검증 오류는 평소 JSON·상태 코드 그대로다", async (t) => {
  mockOpenAi(t, [{ content: "안녕하세요! 무엇을 도와드릴까요?" }]);
  const plain = await post({ action: "chat", message: "안녕하세요", stream: true });
  assert.equal(plain.status, 200);
  assert.match(plain.headers.get("content-type"), /application\/json/);
  assert.equal((await plain.json()).reply, "안녕하세요! 무엇을 도와드릴까요?");

  const invalid = await post({ action: "chat", message: "", stream: true });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "INVALID_MESSAGE");
});
