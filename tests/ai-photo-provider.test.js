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

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// OpenAI 요청을 기록하고 정해진 답을 돌려준다.
function mockOpenAi(t, reply) {
  process.env.OPENAI_API_KEY = "test-openai-key";
  t.after(() => { delete process.env.OPENAI_API_KEY; });
  const realFetch = globalThis.fetch;
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (!String(url).startsWith("https://api.openai.com")) return realFetch(url, options);
    requests.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: reply } }] });
  });
  return requests;
}

async function post(json) {
  return fetch(`${baseUrl}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(json),
  });
}

function imagePartsOf(request) {
  return (request.messages || [])
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((part) => part.type === "image_url");
}

test("글+사진: 검사·재인코딩한 실제 사진이 사용자 말과 함께 모델(비전 입력)에 들어간다", async (t) => {
  const requests = mockOpenAi(t, "사진으로 보면 엔진 쪽에 기름 자국이 보여요.");
  const response = await post({ action: "chat", message: "여기서 기름이 새요", image: PNG_DATA_URL, inputMode: "text" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "agent");
  assert.ok(requests.length >= 1);
  const last = requests[0].messages.at(-1);
  assert.equal(last.role, "user");
  const texts = last.content.filter((part) => part.type === "text").map((part) => part.text).join(" ");
  assert.match(texts, /여기서 기름이 새요/);
  const images = imagePartsOf(requests[0]);
  assert.equal(images.length, 1, "exactly one vision input");
  assert.match(images[0].image_url.url, /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/);
  assert.notEqual(images[0].image_url.url, PNG_DATA_URL, "server re-encodes (EXIF stripped) before sending");
});

test("사진만(음성 패널): 기본 질문 없이 와도 사진을 모델에 보낸다", async (t) => {
  const requests = mockOpenAi(t, "관리기 사진이네요.");
  const response = await post({ action: "chat", message: "", image: PNG_DATA_URL, inputMode: "voice", delegationId: "d-photo" });
  assert.equal(response.status, 200);
  assert.equal(imagePartsOf(requests[0]).length, 1);
});

test("사진이 아니거나 망가진 데이터는 모델을 부르지 않고 400 INVALID_PHOTO로 돌려준다", async (t) => {
  const requests = mockOpenAi(t, "불리면 안 됨");
  for (const image of ["data:text/plain;base64,aGVsbG8=", "data:image/png;base64,bm90LWEtcG5n", "not-a-data-url"]) {
    const response = await post({ action: "chat", message: "이 사진 봐 주세요", image });
    assert.equal(response.status, 400, image);
    assert.equal((await response.json()).code, "INVALID_PHOTO");
  }
  assert.equal(requests.length, 0);
});
