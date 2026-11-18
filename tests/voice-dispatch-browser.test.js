import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";

// Real panel + controller modules in a real browser; WebRTC, microphone and /api/* are simulated.
// VOICE_CONTROLLER_REF=<git ref> serves src/ai/gpt-live.js from that ref (to check the panel against a
// controller branch without editing the controller here).
const CONTROLLER_REF = process.env.VOICE_CONTROLLER_REF || "";

function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw new Error("invalid path");
      const bytes = CONTROLLER_REF && file === "src/ai/gpt-live.js"
        ? execFileSync("git", ["show", `${CONTROLLER_REF}:src/ai/gpt-live.js`])
        : await readFile(new URL(`../${file}`, import.meta.url));
      res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

// agent(body, index) => Promise<json>; holdListings: a promise the /api/listings response waits for.
async function openLivePage(browser, port, { agent, holdListings = null }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  const agentRequests = [];
  page.on("pageerror", e => errors.push(e.message));
  const listings = listListings();
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === "/api/agent") {
      const body = req.postDataJSON();
      const index = agentRequests.push(body) - 1;
      const { __status: status = 200, ...json } = await agent(body, index, listings);
      return route.fulfill({ status, json }).catch(() => {});
    }
    if (path === "/api/listings") {
      if (holdListings) await holdListings;
      return route.fulfill({ json: { listings } }).catch(() => {});
    }
    let data = {};
    if (path === "/api/me") data = { user: null };
    if (path === "/api/voice") data = req.method() === "GET"
      ? { liveAvailable: true, serverStt: false }
      : { session: { id: "test-live" }, transport: { type: "webrtc", sdp: "answer" } };
    await route.fulfill({ json: data }).catch(() => {});
  });
  await page.addInitScript(() => {
    window.voiceTest = { sent: [], timings: [], toasts: [] };
    document.addEventListener("nongnong:voice-dispatch-timing", (e) => window.voiceTest.timings.push(e.detail));
    document.addEventListener("DOMContentLoaded", () => {
      const toastEl = document.getElementById("toast");
      new MutationObserver(() => window.voiceTest.toasts.push(toastEl.textContent))
        .observe(toastEl, { childList: true, characterData: true, subtree: true });
    });
    const track = { enabled: true, stop() {} };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) });
    class Channel extends EventTarget {
      readyState = "open";
      send(raw) {
        const event = JSON.parse(raw);
        window.voiceTest.sent.push(event);
        if (event.type === "session.close") queueMicrotask(() => this.emit({ type: "session.closed" }));
      }
      emit(event) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) })); }
      close() { this.readyState = "closed"; }
    }
    window.RTCPeerConnection = class extends EventTarget {
      iceGatheringState = "complete";
      addTrack() {}
      createDataChannel() { return window.voiceTest.channel = new Channel(); }
      async createOffer() { return { type: "offer", sdp: "offer" }; }
      async setLocalDescription(offer) { this.localDescription = offer; }
      async setRemoteDescription() { setTimeout(() => window.voiceTest.channel.emit({ type: "session.started" }), 0); }
      close() {}
    };
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator("#aiLauncher").click();
  await page.locator("#aiPanel.is-fullscreen").waitFor({ state: "visible" });
  await page.locator("#aiLiveVoiceButton").click();
  await page.waitForFunction(() => document.querySelector("#aiVoiceLiveBar").dataset.voiceState === "listening");
  return { page, errors, agentRequests };
}

const say = (page, text, id) => page.evaluate(([t, d]) => {
  window.voiceTest.channel.emit({ type: "session.input_transcript.delta", delta: t, start_ms: 100, end_ms: 900 });
  window.voiceTest.channel.emit({ type: "session.delegation.created", delegation: { id: d, target: "client" } });
}, [text, id]);
const commentaryFor = (page, id) => page.evaluate((d) => window.voiceTest.sent.filter(e => e.type === "session.commentary.append" && e.delegation_id === d).map(e => e.content), id);
const waitCommentary = (page, id) => page.waitForFunction((d) => window.voiceTest.sent.some(e => e.type === "session.commentary.append" && e.delegation_id === d), id);
const settle = (page, ms = 150) => page.evaluate((t) => new Promise(r => setTimeout(r, t)), ms);

test("voice dispatch: request is sent before the catalog loads; server listing order is kept for follow-ups", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const gate = deferred();
  try {
    const { page, errors, agentRequests } = await openLivePage(browser, server.address().port, {
      holdListings: gate.promise,
      agent: async (body, index, listings) => index === 0
        ? {
            mode: "agent",
            reply: "조건에 맞는 매물 2건을 찾았어요.\n\n### 추천 매물\n1. **첫째** 영양읍\n2. **둘째** 영양읍",
            listingIds: ["not-in-local-catalog", listings[0].id, listings[0].id],
            timing: { firstModelMs: 40, usefulResultMs: 900, totalMs: 950, reply: "must not leak" },
          }
        : { mode: "agent", reply: "알겠어요.", listingIds: [] },
    });
    await say(page, "트랙터 찾아줘", "d-catalog");
    // The agent request goes out while /api/listings is still held.
    await waitFor(() => agentRequests.length === 1);
    assert.equal(await page.locator(".ai-rec-card-img").count(), 0);
    gate.resolve();
    await waitCommentary(page, "d-catalog");
    await page.locator(".ai-rec-card-img").first().waitFor({ state: "visible" });
    assert.equal(await page.locator(".chat-bubble.assistant.has-results .ai-rec-card").count(), 1, "deduplicated, locally known cards only");
    const [spoken] = await commentaryFor(page, "d-catalog");
    assert.equal(spoken, "조건에 맞는 매물 2건을 찾았어요.", "spoken summary does not re-read the card list");

    // The model reads the result aloud: no second assistant bubble duplicates the card.
    const assistantBubbles = await page.locator(".chat-bubble.assistant").count();
    await page.evaluate(() => window.voiceTest.channel.emit({ type: "session.output_transcript.delta", delta: "조건에 맞는 매물 2건을 찾았어요." }));
    await settle(page);
    assert.equal(await page.locator(".chat-bubble.assistant").count(), assistantBubbles);

    // Follow-up keeps server identity/order even for an id the local catalog lacks.
    await say(page, "1번 자세히 알려줘", "d-follow");
    await waitCommentary(page, "d-follow");
    const ids = agentRequests[1].uiContext.lastShownListings.map(item => item.id);
    assert.deepEqual(ids, ["not-in-local-catalog", listListings()[0].id]);

    const timing = await page.evaluate(() => window.voiceTest.timings[0]);
    assert.equal(timing.catalogPending, true);
    assert.ok(timing.marks.request <= timing.marks.response);
    assert.ok(timing.marks.catalog >= timing.marks.response, "catalog awaited only after the response, for cards");
    assert.equal(timing.firstModelMs, 40);
    assert.equal(timing.usefulResultMs, 900);
    assert.equal(JSON.stringify(timing).includes("트랙터"), false, "timing is content-free");
    assert.equal(JSON.stringify(timing).includes("leak"), false);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    gate.resolve();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("voice dispatch: a corrected read result is dropped but an authoritative write is rendered and spoken", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const holds = [deferred(), deferred()];
    const { page, errors, agentRequests } = await openLivePage(browser, server.address().port, {
      agent: async (body, index, listings) => {
        if (index === 0) {
          await holds[0].promise;
          return { mode: "agent", reply: "트랙터 매물이에요.", listingIds: [listings[0].id] };
        }
        if (index === 1) return { mode: "agent", reply: "콤바인은 지금 없어요.", listingIds: [] };
        if (index === 2) {
          await holds[1].promise;
          return { mode: "agent", reply: "", listingIds: [], reservation: { kind: "rental", number: "R-77", listingId: listings[0].id, title: listings[0].title, start: "2026-11-20", end: "2026-11-20" } };
        }
        return { mode: "agent", reply: "네.", listingIds: [] };
      },
    });
    await say(page, "트랙터 찾아줘", "d-old");
    await waitFor(() => agentRequests.length === 1);
    await say(page, "아니, 콤바인 찾아줘", "d-new");
    await waitCommentary(page, "d-new");
    holds[0].resolve();
    await waitFor(async () => (await page.evaluate(() => window.voiceTest.timings.length)) >= 2);
    await settle(page);
    assert.deepEqual(await commentaryFor(page, "d-old"), [], "stale read is not spoken");
    assert.equal(await page.locator(".ai-rec-card").count(), 0, "stale read cards are not rendered");
    assert.ok(await page.evaluate(() => window.voiceTest.timings.some(t => t.outcome === "stale_dropped")));

    // A write that finishes after a correction is still shown and spoken (receipt preserved).
    await say(page, "그거 20일에 예약해줘", "d-write");
    await waitFor(() => agentRequests.length === 3);
    await say(page, "아니 잠깐만", "d-after");
    await waitCommentary(page, "d-after");
    holds[1].resolve();
    await waitCommentary(page, "d-write");
    const [writeSpoken] = await commentaryFor(page, "d-write");
    assert.match(writeSpoken, /대여 예약 요청이 접수됐어요\. 신청 번호는 R-77예요/);
    await page.locator(".chat-bubble.assistant", { hasText: "R-77" }).first().waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("voice dispatch: stopping voice mid-flight renders a write silently and drops a read; unknown write keeps retry", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const hold = deferred();
    let mode = "write";
    const { page, errors, agentRequests } = await openLivePage(browser, server.address().port, {
      agent: async (body, index, listings) => {
        if (index === 0) return { mode: "agent", reply: "11월 20일 예약할까요?", listingIds: [],
          pendingAction: { type: "rental_request", listingId: listings[0].id, title: listings[0].title, start: "2026-11-20", end: "2026-11-20", requestId: "11111111-1111-4111-8111-111111111111" } };
        if (index === 1) {
          await hold.promise;
          return mode === "write"
            ? { mode: "agent", reply: "대여 예약 요청을 완료했어요.", listingIds: [], reservation: { kind: "rental", number: "R-5", listingId: listings[0].id, title: listings[0].title, start: "2026-11-20", end: "2026-11-20" } }
            : { mode: "agent", reply: "읽기 결과", listingIds: [listings[0].id] };
        }
        return { mode: "agent", reply: "네.", listingIds: [] };
      },
    });
    await say(page, "트랙터 20일 예약 가능해?", "d-ask");
    await waitCommentary(page, "d-ask");
    await say(page, "응 해줘", "d-yes");
    await waitFor(() => agentRequests.length === 2);
    assert.equal(agentRequests[1].pendingAction.requestId, "11111111-1111-4111-8111-111111111111");
    await page.locator("#aiVoiceStopBtn").click();
    await page.locator("#aiVoiceLiveBar").waitFor({ state: "hidden" });
    hold.resolve();
    await page.locator(".chat-bubble.assistant", { hasText: "대여 예약 요청을 완료했어요" }).waitFor();
    assert.deepEqual(await commentaryFor(page, "d-yes"), [], "no speech after the live session ended");
    assert.ok(await page.evaluate(() => window.voiceTest.timings.some(t => t.outcome === "rendered_silent" && t.write === true)));
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("voice dispatch: a lost response after sending an approved action does not claim failure and keeps the same request id", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { page, errors, agentRequests } = await openLivePage(browser, server.address().port, {
      agent: async (body, index, listings) => {
        if (index === 0) return { mode: "agent", reply: "예약할까요?", listingIds: [],
          pendingAction: { type: "rental_request", listingId: listings[0].id, title: listings[0].title, start: "2026-11-20", end: "2026-11-20", requestId: "22222222-2222-4222-8222-222222222222" } };
        if (index === 1) return { __status: 503, error: "잠시 연결이 불안정해요." };
        return { mode: "agent", reply: "대여 예약 요청을 완료했어요.", listingIds: [], reservation: { kind: "rental", number: "R-6", listingId: listings[0].id } };
      },
    });
    await say(page, "20일 예약 가능해?", "d1");
    await waitCommentary(page, "d1");
    await say(page, "응 해줘", "d2");
    await waitCommentary(page, "d2");
    const [spoken] = await commentaryFor(page, "d2");
    assert.match(spoken, /처리 결과를 아직 확인하지 못했어요/);
    await say(page, "다시 해줘", "d3");
    await waitCommentary(page, "d3");
    const retry = agentRequests.at(-1);
    assert.equal(retry.pendingAction?.requestId, "22222222-2222-4222-8222-222222222222", "retry reuses the idempotent request id");
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

async function waitFor(check, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise(r => setTimeout(r, 20));
  }
}
