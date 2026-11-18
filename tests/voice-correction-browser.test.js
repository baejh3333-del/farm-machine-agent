import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  clarifications, commentaryFor, deferred, emit, openLivePage, say, settle, startStaticServer, waitCommentary, waitFor,
} from "./helpers/live-voice-page.js";

// 정정 발화가 어느 작업을 바로잡는지: 실제 패널·컨트롤러를 브라우저에서 돌리고 WebRTC·/api/*만 흉내 낸다.
// 모든 응답은 테스트가 정한 순서로만 풀리므로(deferred) 결과가 결정적이다.

// 위임 ID별로 응답을 붙잡아 두는 가짜 에이전트. replies[id] = (listings) => json
function gatedAgent(replies, holds) {
  return async (body, index, listings) => {
    const id = body.delegationId;
    if (holds[id]) await holds[id].promise;
    const reply = replies[id];
    return reply ? reply(listings) : { mode: "agent", reply: `${body.message} 처리했어요.`, listingIds: [] };
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
    await new Promise(resolve => server.close(resolve));
  }
}

const tractor = (listings) => ({ mode: "agent", reply: "트랙터 결과예요.", listingIds: [listings[0].id] });
const combine = (listings) => ({ mode: "agent", reply: "콤바인 결과예요.", listingIds: [listings[1].id] });
const weather = () => ({ mode: "agent", reply: "내일은 맑아요.", listingIds: [] });

test("correction: '아니 콤바인으로' with tractor and weather both pending invalidates only the tractor search", async () => {
  const holds = { A: deferred(), B: deferred() };
  await withPage(async ({ page, agentRequests }) => {
    await say(page, "트랙터 찾아줘", "A");
    await say(page, "내일 날씨 알려줘", "B");
    await waitFor(() => agentRequests.length === 2);
    await say(page, "아니 콤바인으로", "C");
    await waitCommentary(page, "C");
    holds.B.resolve();
    await waitCommentary(page, "B");
    holds.A.resolve();
    await waitFor(async () => (await page.evaluate(() => window.voiceTest.timings.length)) >= 3);
    await settle(page);
    assert.deepEqual(await commentaryFor(page, "A"), [], "corrected tractor read is not announced");
    assert.deepEqual(await commentaryFor(page, "B"), ["내일은 맑아요."], "unrelated weather task is kept");
    assert.deepEqual(await clarifications(page), [], "an explicit machine slot needs no clarification");
    assert.equal(await page.locator(".ai-rec-card").count(), 1, "only the combine cards are drawn");
    assert.ok(await page.evaluate(() => window.voiceTest.sent.some(e => e.event_id?.startsWith("stale_") && e.delegation_id === "A")));
  }, { agent: gatedAgent({ A: tractor, B: weather, C: combine }, holds) });
});

test("correction: a settled tractor result is the target, not the still-pending weather task", async () => {
  const holds = { B: deferred() };
  await withPage(async ({ page, agentRequests }) => {
    await say(page, "트랙터 찾아줘", "A");
    await waitCommentary(page, "A");
    await page.locator('.chat-bubble[data-delegation-id="A"] .ai-rec-card').first().waitFor();
    await say(page, "내일 날씨 알려줘", "B");
    await waitFor(() => agentRequests.length === 2);
    await say(page, "아니 콤바인으로", "C");
    await waitCommentary(page, "C");
    // The already-shown tractor answer is marked as corrected (kept on screen, not deleted).
    await page.locator('.chat-bubble.is-superseded[data-delegation-id="A"] .ai-superseded-note').waitFor();
    assert.equal(agentRequests[2].uiContext.lastShownListings, undefined, "'1번' no longer points at the corrected tractor list");
    holds.B.resolve();
    await waitCommentary(page, "B");
    assert.deepEqual(await commentaryFor(page, "B"), ["내일은 맑아요."], "pending weather task is not cancelled");
    assert.deepEqual(await clarifications(page), []);
  }, { agent: gatedAgent({ A: tractor, B: weather, C: combine }, holds) });
});

test("correction: ambiguous machine correction asks which request, holds both reads, then resumes after the answer", async () => {
  const holds = { A: deferred(), B: deferred(), W: deferred() };
  await withPage(async ({ page, agentRequests }) => {
    await say(page, "트랙터 찾아줘", "A");
    await say(page, "콤바인도 찾아줘", "B");
    await say(page, "관리기 20일 예약해줘", "W");
    await waitFor(() => agentRequests.length === 3);
    await say(page, "아니 이앙기로", "C");
    await waitCommentary(page, "C");
    const [question] = await clarifications(page);
    assert.match(question, /트랙터 찾기, 콤바인 찾기, 관리기 예약 중에 어느 요청을 바꿀까요/);

    // Results arrive while the question is open: reads are held, the write receipt is announced at once.
    holds.A.resolve();
    holds.B.resolve();
    holds.W.resolve();
    await waitCommentary(page, "W");
    await settle(page, 300);
    assert.match((await commentaryFor(page, "W"))[0], /대여 예약 요청이 접수됐어요/);
    assert.deepEqual(await commentaryFor(page, "A"), [], "held until the user answers");
    assert.deepEqual(await commentaryFor(page, "B"), []);

    // The user answers; the model hears it as a new turn (no delegation needed to resolve).
    await emit(page, { type: "session.input_transcript.delta", delta: "트랙터요" });
    await emit(page, { type: "session.output_transcript.delta", delta: "네, 트랙터를 이앙기로 바꿀게요." });
    await waitCommentary(page, "B");
    assert.deepEqual(await commentaryFor(page, "B"), ["콤바인 결과예요."], "the other request resumes");
    assert.deepEqual(await commentaryFor(page, "A"), [], "only the chosen request is dropped");
    await page.locator('.chat-bubble.is-superseded[data-delegation-id="A"]').waitFor();
    assert.equal(await page.locator('.chat-bubble.is-superseded[data-delegation-id="W"]').count(), 0, "write receipts are never marked");
    assert.equal(await page.locator('.chat-bubble[data-delegation-id="W"]', { hasText: "R-1" }).count(), 1);
  }, {
    agent: gatedAgent({
      A: tractor,
      B: combine,
      W: (listings) => ({ mode: "agent", reply: "", listingIds: [], reservation: { kind: "rental", number: "R-1", listingId: listings[2].id, title: listings[2].title, start: "2026-11-20", end: "2026-11-20" } }),
      C: () => ({ mode: "agent", reply: "이앙기도 찾아볼게요.", listingIds: [] }),
    }, holds),
  });
});

test("correction: answering 'keep both' releases every held read without cancelling anything", async () => {
  const holds = { A: deferred(), B: deferred() };
  await withPage(async ({ page, agentRequests }) => {
    await say(page, "트랙터 찾아줘", "A");
    await say(page, "콤바인도 찾아줘", "B");
    await waitFor(() => agentRequests.length === 2);
    await say(page, "아니 그게 아니라", "C");
    await waitCommentary(page, "C");
    assert.equal((await clarifications(page)).length, 1);
    holds.A.resolve();
    holds.B.resolve();
    await settle(page, 300);
    assert.deepEqual(await commentaryFor(page, "A"), []);
    await emit(page, { type: "session.input_transcript.delta", delta: "그대로 두세요" });
    await emit(page, { type: "session.output_transcript.delta", delta: "알겠어요." });
    await waitCommentary(page, "A");
    await waitCommentary(page, "B");
    assert.equal(await page.locator(".chat-bubble.is-superseded").count(), 0);
  }, { agent: gatedAgent({ A: tractor, B: combine }, holds) });
});
