// QA 음성 F1·F2·F3 회귀: 실제 패널·컨트롤러를 브라우저에서 돌리고 WebRTC·/api/*만 흉내 낸다.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { deferred, emit, openLivePage, say, settle, startStaticServer, waitCommentary, waitFor } from "./helpers/live-voice-page.js";

function gatedAgent(replies, holds = {}) {
  return async (body) => {
    const id = body.delegationId;
    if (holds[id]) await holds[id].promise;
    const reply = replies[id];
    return reply ? reply(body) : { mode: "agent", reply: `${body.message} 처리했어요.`, listingIds: [] };
  };
}

async function withPage(run, options) {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const opened = await openLivePage(browser, server.address().port, options);
    await run(opened);
    assert.deepEqual(opened.errors, []);
    await opened.page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const bubbles = (page, role) => page.evaluate((r) => [...document.querySelectorAll(`#aiMessages .chat-bubble.${r}`)].map((b) => b.textContent.trim()), role);

test("F1: 위임이 진행 중이어도 사용자 발화·농농 맞장구는 각각 다른 말풍선이 된다", async () => {
  const holds = { A: deferred(), B: deferred() };
  await withPage(async ({ page, agentRequests }) => {
    await emit(page, { type: "session.input_transcript.delta", delta: "트랙터 찾아줘", start_ms: 1000, end_ms: 1800 });
    await emit(page, { type: "session.delegation.created", delegation: { id: "A", target: "client" } });
    await emit(page, { type: "session.output_transcript.delta", delta: "트랙터 찾아볼게요." });
    await waitFor(() => agentRequests.length === 1);
    await emit(page, { type: "session.input_transcript.delta", delta: "내일 날씨 알려줘", start_ms: 5000, end_ms: 5800 });
    await emit(page, { type: "session.delegation.created", delegation: { id: "B", target: "client" } });
    await emit(page, { type: "session.output_transcript.delta", delta: "날씨도 볼게요." });
    await waitFor(() => agentRequests.length === 2);
    await emit(page, { type: "session.input_transcript.delta", delta: "고마워", start_ms: 9000, end_ms: 9400 });
    await page.waitForFunction(() => [...document.querySelectorAll("#aiMessages .chat-bubble.user")].some((b) => b.textContent.includes("고마워")));
    const users = await bubbles(page, "user");
    assert.deepEqual(users.filter((t) => /트랙터|날씨|고마워/.test(t)), ["트랙터 찾아줘", "내일 날씨 알려줘", "고마워"]);
    const assistants = await bubbles(page, "assistant");
    assert.ok(assistants.includes("트랙터 찾아볼게요."), JSON.stringify(assistants));
    assert.ok(assistants.includes("날씨도 볼게요."), JSON.stringify(assistants));
    holds.A.resolve();
    holds.B.resolve();
    await waitCommentary(page, "A");
    await waitCommentary(page, "B");
    await settle(page);
    const after = (await bubbles(page, "user")).filter((t) => /트랙터|날씨|고마워/.test(t));
    assert.deepEqual(after, ["트랙터 찾아줘", "내일 날씨 알려줘", "고마워"], "결과가 온 뒤에도 합쳐지지 않는다");
  }, { agent: gatedAgent({}, holds) });
});

test("F2: 진행 중 작업을 말로 바로잡으면 그 작업의 원래 말만 history에 붙여 보내고, 기억은 중복되지 않는다", async () => {
  const holds = { A: deferred(), B: deferred() };
  await withPage(async ({ page, agentRequests }) => {
    await say(page, "트랙터 찾아줘", "A");
    await say(page, "내일 날씨 알려줘", "B");
    await waitFor(() => agentRequests.length === 2);
    await say(page, "아니 콤바인으로", "C");
    await waitFor(() => agentRequests.length === 3);
    const body = agentRequests[2];
    assert.equal(body.message, "아니 콤바인으로");
    assert.equal(body.delegationId, "C");
    const userHistory = body.history.filter((h) => h.role === "user").map((h) => h.content);
    assert.ok(userHistory.includes("트랙터 찾아줘"), `정정 대상이 history에 있어야 함: ${JSON.stringify(body.history)}`);
    assert.ok(!userHistory.includes("내일 날씨 알려줘"), "관련 없는 날씨 작업은 넣지 않는다");
    holds.A.resolve();
    holds.B.resolve();
    await waitCommentary(page, "C");
    await waitCommentary(page, "B");
    await settle(page, 300);
    // 이어지는 일반 발화의 history: 정정된 트랙터 요청을 두 번 기록하지 않는다.
    await say(page, "고마워", "D");
    await waitFor(() => agentRequests.length === 4);
    const later = agentRequests[3].history.filter((h) => h.role === "user").map((h) => h.content);
    assert.ok(later.filter((t) => t === "트랙터 찾아줘").length <= 1, JSON.stringify(later));
    assert.equal(later.filter((t) => t === "아니 콤바인으로").length, 1, JSON.stringify(later));
  }, {
    agent: gatedAgent({
      A: () => ({ mode: "agent", reply: "트랙터 결과예요.", listingIds: [] }),
      B: () => ({ mode: "agent", reply: "내일은 맑아요.", listingIds: [] }),
      C: () => ({ mode: "agent", reply: "콤바인 결과예요.", listingIds: [] }),
    }, holds),
  });
});

test("F2: 정정이 아닌 새 요청에는 다른 작업의 말을 붙이지 않는다", async () => {
  const holds = { A: deferred() };
  await withPage(async ({ page, agentRequests }) => {
    await say(page, "트랙터 찾아줘", "A");
    await say(page, "내일 날씨 알려줘", "B");
    await waitFor(() => agentRequests.length === 2);
    assert.deepEqual(agentRequests[1].history.filter((h) => h.role === "user").map((h) => h.content), []);
    holds.A.resolve();
  }, { agent: gatedAgent({}, holds) });
});

test("F3: 서버가 AI를 쓸 수 없다고(mode: unavailable) 답하면 '확인했어요'라고 하지 않고 쓸 수 없다고 알린다", async () => {
  await withPage(async ({ page }) => {
    await say(page, "트랙터 찾아줘", "A");
    await waitCommentary(page, "A");
    const spoken = await page.evaluate(() => window.voiceTest.sent.filter((e) => e.type === "session.commentary.append" && e.delegation_id === "A").map((e) => e.content));
    assert.equal(spoken.length, 1);
    assert.match(spoken[0], /AI 상담을 쓸 수 없어요/);
    assert.doesNotMatch(spoken.join(" "), /확인했어요/);
    const assistants = await bubbles(page, "assistant");
    assert.ok(assistants.some((t) => /AI 상담을 쓸 수 없어요/.test(t)), JSON.stringify(assistants));
    assert.ok(!assistants.some((t) => /말씀하신 내용을 확인했어요/.test(t)), JSON.stringify(assistants));
  }, { agent: async () => ({ mode: "unavailable", timing: { modelCalls: 0 } }) });
});
