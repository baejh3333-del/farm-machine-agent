import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";

// Real application modules and DOM; provider/media are simulated so no microphone,
// paid provider call or production write is needed for these integration checks.
test("voice panel: live delegation, layout, contacts, stop and fallback preserve voice mode", async () => {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw new Error("invalid path");
      const bytes = await readFile(new URL(`../${file}`, import.meta.url));
      res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "text/html");
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const live of [true, false]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      const requests = [];
      page.on("pageerror", e => errors.push(e.message));
      const listings = listListings();
      await page.route("**/api/**", async route => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        let data = {};
        if (path === "/api/listings") data = { listings };
        if (path === "/api/me") data = { user: null };
        if (path === "/api/voice") data = req.method() === "GET"
          ? { liveAvailable: live, serverStt: false }
          : { session: { id: "test-live" }, transport: { type: "webrtc", sdp: "answer" } };
        if (path === "/api/agent") {
          requests.push(req.postDataJSON());
          data = { mode: "agent", reply: "보험 상담 연락처를 안내해 드려요.", listingIds: [listings[0].id],
            insuranceContacts: [{ name: "NH농협손해보험", phone: "1644-9000", website: "https://www.nhfire.co.kr" }] };
        }
        await route.fulfill({ json: data });
      });
      await page.addInitScript(() => {
        window.voiceTest = { sent: [], stopped: 0, peers: 0 };
        const track = { enabled: true, stop() { window.voiceTest.stopped++; } };
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
          constructor() { super(); window.voiceTest.peers++; }
          addTrack() {}
          createDataChannel() { return window.voiceTest.channel = new Channel(); }
          async createOffer() { return { type: "offer", sdp: "offer" }; }
          async setLocalDescription(offer) { this.localDescription = offer; }
          async setRemoteDescription() { setTimeout(() => window.voiceTest.channel.emit({ type: "session.started" }), 0); }
          close() {}
        };
        window.SpeechRecognition = class {
          start() { window.voiceTest.recognition = this; }
          stop() {
            const result = Object.assign([{ transcript: "네 보험 알려줘" }], { isFinal: true });
            this.onresult?.({ resultIndex: 0, results: [result] });
            this.onend?.();
          }
          abort() { this.onend?.(); }
        };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator("#aiLauncher").click();
      await page.locator("#aiPanel.is-fullscreen").waitFor({ state: "visible" });
      await page.locator("#aiPlusButton").click();
      await page.locator("#aiPlusMenu").waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await page.locator("#aiPlusMenu").waitFor({ state: "hidden" });
      assert.equal(await page.locator("#aiPanel").isVisible(), true);
      if (live) {
        await page.locator("#aiLiveVoiceButton").click();
        await page.waitForFunction(() => document.querySelector("#aiVoiceLiveBar").dataset.voiceState === "listening");
        await page.evaluate(() => {
          window.voiceTest.channel.emit({ type: "session.input_transcript.delta", delta: "보험 알려줘" });
          window.voiceTest.channel.emit({ type: "session.delegation.created", delegation: { id: "delegation-1", target: "client" } });
        });
        await page.locator('a[href="tel:16449000"], a[href="tel:1644-9000"]').waitFor();
        assert.equal(requests[0].inputMode, "voice");
        assert.equal(requests[0].delegationId, "delegation-1");
        await page.locator(".ai-rec-card-img").first().waitFor({ state: "visible" });
        await page.locator("#aiExpand").click();
        await page.locator(".ai-rec-card-img").first().waitFor({ state: "hidden" });
        assert.equal(await page.locator("#aiVoiceLiveBar").isVisible(), true);
        assert.equal(await page.evaluate(() => window.voiceTest.stopped), 0);
        await page.locator("#aiVoiceMuteBtn").click();
        assert.equal(await page.locator("#aiVoiceMuteBtn").getAttribute("aria-pressed"), "true");
        await page.locator("#aiVoiceStopBtn").click();
        await page.waitForFunction(() => window.voiceTest.stopped === 1);
        assert.equal(await page.locator("#aiVoiceLiveBar").isHidden(), true);
        const count = requests.length;
        await page.evaluate(() => window.voiceTest.channel.emit({ type: "session.delegation.created", delegation: { id: "late", target: "client" } }));
        assert.equal(requests.length, count);
      } else {
        await page.locator("#aiMicButton").click();
        await page.waitForFunction(() => Boolean(window.voiceTest.recognition));
        await page.locator("#aiMicButton").click();
        await page.locator('a[href="tel:16449000"], a[href="tel:1644-9000"]').waitFor();
        assert.equal(requests[0].inputMode, "voice");
        assert.equal(requests[0].message, "네 보험 알려줘");
        await page.locator("#aiMicButton").click();
        await page.waitForFunction(() => document.querySelector("#aiMicButton").getAttribute("aria-pressed") === "true");
        await page.evaluate(() => {
          const recognition = window.voiceTest.recognition;
          const original = recognition.stop.bind(recognition);
          recognition.stop = () => { window.voiceTest.finishRecognition = original; };
        });
        await page.locator("#aiMicButton").click();
        await page.locator("#aiClose").click();
        await page.evaluate(() => window.voiceTest.finishRecognition());
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
        assert.equal(requests.length, 1, "closing the panel must fence pending recognition");
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw new Error("invalid path");
      const bytes = await readFile(new URL(`../${file}`, import.meta.url));
      res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "text/html");
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// liveSession: () => { status, json } for POST /api/voice; agent: (listings) => { status, json } for /api/agent.
async function openVoicePage(browser, port, { liveSession, agent, micError = null }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  const requests = { live: [], agent: [] };
  page.on("pageerror", e => errors.push(e.message));
  const listings = listListings();
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === "/api/voice" && req.method() === "POST") {
      requests.live.push(req.postDataJSON());
      const { status = 200, json } = liveSession();
      return route.fulfill({ status, json });
    }
    if (path === "/api/agent") {
      requests.agent.push(req.postDataJSON());
      const { status = 200, json } = agent(listings);
      return route.fulfill({ status, json });
    }
    let data = {};
    if (path === "/api/listings") data = { listings };
    if (path === "/api/me") data = { user: null };
    if (path === "/api/voice") data = { liveAvailable: true, serverStt: false };
    await route.fulfill({ json: data });
  });
  await page.addInitScript((micErrorName) => {
    window.voiceTest = { sent: [], stopped: 0, peers: 0, closedPeers: 0, toasts: [] };
    document.addEventListener("DOMContentLoaded", () => {
      const toastEl = document.getElementById("toast");
      new MutationObserver(() => window.voiceTest.toasts.push(toastEl.textContent))
        .observe(toastEl, { childList: true, characterData: true, subtree: true });
    });
    const track = { enabled: true, stop() { window.voiceTest.stopped++; } };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        if (micErrorName) throw new DOMException("Permission denied", micErrorName);
        return { getTracks: () => [track], getAudioTracks: () => [track] };
      },
    });
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
      constructor() { super(); window.voiceTest.peers++; }
      addTrack() {}
      createDataChannel() { return window.voiceTest.channel = new Channel(); }
      async createOffer() { return { type: "offer", sdp: "offer" }; }
      async setLocalDescription(offer) { this.localDescription = offer; }
      async setRemoteDescription() { setTimeout(() => window.voiceTest.channel.emit({ type: "session.started" }), 0); }
      close() { window.voiceTest.closedPeers++; }
    };
    window.SpeechRecognition = class {
      start() { window.voiceTest.recognition = this; }
      stop() {
        const result = Object.assign([{ transcript: "트랙터 찾아줘" }], { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: [result] });
        this.onend?.();
      }
      abort() { this.onend?.(); }
    };
  }, micError);
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator("#aiLauncher").click();
  await page.locator("#aiPanel.is-fullscreen").waitFor({ state: "visible" });
  return { page, errors, requests };
}

const agentReply = (listings) => ({ json: { mode: "agent", reply: "트랙터 매물을 찾았어요.", listingIds: [listings[0].id] } });
const liveAnswer = () => ({ json: { session: { id: "test-live" }, transport: { type: "webrtc", sdp: "answer" } } });
const settle = (page) => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));

test("voice panel: live session 502 falls back to standard voice with one toast and no stuck UI", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { page, errors, requests } = await openVoicePage(browser, server.address().port, {
      liveSession: () => ({ status: 502, json: { error: "실시간 음성 대화를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.", code: "LIVE_SESSION_FAILED" } }),
      agent: agentReply,
    });
    await page.locator("#aiLiveVoiceButton").click();
    await page.waitForFunction(() => window.voiceTest.toasts.length > 0);
    await settle(page);
    const toasts = await page.evaluate(() => window.voiceTest.toasts);
    assert.equal(toasts.length, 1, `expected a single toast, got ${JSON.stringify(toasts)}`);
    assert.match(toasts[0], /일반 음성 입력으로 바꿨어요/);
    assert.equal(requests.live.length, 1);
    assert.equal(requests.live[0].action, "live_session");
    assert.ok(Array.isArray(requests.live[0].history));
    assert.equal(await page.evaluate(() => window.voiceTest.stopped), 1, "microphone released");
    assert.equal(await page.evaluate(() => window.voiceTest.closedPeers), 1, "peer connection closed");
    assert.equal(await page.locator("#aiVoiceLiveBar").isHidden(), true);
    assert.equal(await page.locator("#aiLiveVoiceButton").isHidden(), true);
    assert.equal(await page.locator("#aiLiveVoiceButton").getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#aiMicButton").isVisible(), true);

    // Standard voice input now works through the visible mic button.
    await page.locator("#aiMicButton").click();
    await page.waitForFunction(() => Boolean(window.voiceTest.recognition));
    await page.locator("#aiMicButton").click();
    // PR #42: 매물 카드가 붙은 답변은 설명 글 없이 추천 박스만 보인다.
    await page.waitForFunction(() => Boolean(document.querySelector(".chat-bubble.assistant.has-results .ai-result")));
    assert.equal(requests.live.length, 1, "no further live session attempts");
    assert.equal(requests.agent[0].inputMode, "voice");
    assert.equal(requests.agent[0].message, "트랙터 찾아줘");
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("voice panel: mic denial keeps live voice, delegation failure keeps session, server close resets UI", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const denied = await openVoicePage(browser, server.address().port, {
      liveSession: liveAnswer,
      agent: agentReply,
      micError: "NotAllowedError",
    });
    await denied.page.locator("#aiLiveVoiceButton").click();
    await denied.page.waitForFunction(() => window.voiceTest.toasts.length > 0);
    await settle(denied.page);
    const deniedToasts = await denied.page.evaluate(() => window.voiceTest.toasts);
    assert.equal(deniedToasts.length, 1, `expected a single toast, got ${JSON.stringify(deniedToasts)}`);
    assert.match(deniedToasts[0], /마이크 권한/);
    assert.equal(denied.requests.live.length, 0);
    assert.equal(await denied.page.locator("#aiLiveVoiceButton").isVisible(), true, "mic denial must not downgrade live voice");
    assert.equal(await denied.page.locator("#aiVoiceLiveBar").isHidden(), true);
    assert.deepEqual(denied.errors, []);
    await denied.page.close();

    const { page, errors, requests } = await openVoicePage(browser, server.address().port, {
      liveSession: liveAnswer,
      agent: () => ({ status: 500, json: { error: "농농이가 잠시 쉬고 있어요." } }),
    });
    await page.locator("#aiLiveVoiceButton").click();
    await page.waitForFunction(() => document.querySelector("#aiVoiceLiveBar").dataset.voiceState === "listening");
    await page.evaluate(() => {
      window.voiceTest.channel.emit({ type: "session.input_transcript.delta", delta: "트랙터 찾아줘" });
      window.voiceTest.channel.emit({ type: "session.delegation.created", delegation: { id: "d-fail", target: "client" } });
    });
    await page.waitForFunction(() => window.voiceTest.sent.some(e => e.type === "session.commentary.append" && e.delegation_id === "d-fail"));
    assert.equal(requests.agent.length, 1);
    assert.match(await page.locator("#toast").textContent(), /농농이가 잠시 쉬고 있어요/);
    assert.equal(await page.locator("#aiVoiceLiveBar").isVisible(), true, "delegation failure keeps the live session");
    assert.equal(await page.evaluate(() => window.voiceTest.stopped), 0);
    assert.equal(await page.evaluate(() => window.voiceTest.sent.some(e => e.type === "session.close")), false);

    // A protocol error event is logged, not toasted, and does not end the session.
    const toastCount = await page.evaluate(() => window.voiceTest.toasts.length);
    await page.evaluate(() => window.voiceTest.channel.emit({ type: "error", error: { message: "unknown event" } }));
    await settle(page);
    assert.equal(await page.evaluate(() => window.voiceTest.toasts.length), toastCount);
    assert.equal(await page.locator("#aiVoiceLiveBar").isVisible(), true);

    // Server-initiated close: UI resets and the next session starts a fresh transcript bubble.
    await page.evaluate(() => window.voiceTest.channel.emit({ type: "session.output_transcript.delta", delta: "다시 말씀해" }));
    await page.evaluate(() => window.voiceTest.channel.emit({ type: "session.closed" }));
    await page.locator("#aiVoiceLiveBar").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".is-live-transcript").count(), 0);
    assert.equal(await page.locator("#aiLiveVoiceButton").getAttribute("aria-pressed"), "false");
    assert.equal(await page.evaluate(() => window.voiceTest.stopped), 1);
    await page.locator("#aiLiveVoiceButton").click();
    await page.waitForFunction(() => document.querySelector("#aiVoiceLiveBar").dataset.voiceState === "listening");
    await page.evaluate(() => window.voiceTest.channel.emit({ type: "session.output_transcript.delta", delta: "새 대화" }));
    const liveBubbles = await page.locator(".is-live-transcript").allTextContents();
    assert.equal(liveBubbles.length, 1);
    assert.equal(liveBubbles[0].trim(), "새 대화");
    assert.equal(requests.live.length, 2);
    assert.ok(requests.live[1].history.every(e => typeof e.content === "string" && ["user", "assistant"].includes(e.role)));
    await page.locator("#aiVoiceStopBtn").click();
    await page.waitForFunction(() => window.voiceTest.stopped === 2);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("voice panel: voice switching keeps conversation memory and delegation sends thinkingContext", async () => {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw new Error("invalid path");
      const bytes = await readFile(new URL(`../${file}`, import.meta.url));
      res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "text/html");
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const listings = listListings();
    const { page, errors, requests } = await openVoicePage(browser, server.address().port, {
      liveSession: () => ({ status: 201, json: { session: { id: "s1" }, transport: { type: "webrtc", sdp: "answer" } } }),
      agent: () => ({
        status: 200,
        json: {
          mode: "agent",
          sessionId: "sess-mem-1",
          reply: "금요일은 비가 와서 다음 주 월요일이 좋아요.",
          listingIds: [listings[0].id],
          weatherInfo: {
            summary: "금요일 강수 예상",
            badWeatherWarning: "금요일 강수 확률 80%",
            goodAlternatives: [{ start: "2026-11-23", label: "11월 23일(월)" }],
          },
          learnedSlots: { region: "영양읍", areaPyeong: 500 },
        },
      }),
    });

    await page.locator("#aiLiveVoiceButton").click();
    await page.waitForFunction(() => document.querySelector("#aiVoiceLiveBar").dataset.voiceState === "listening");
    assert.equal(requests.live[0].voice, "noeul");

    // 1. Non-delegated speech + delegated turn both enter memory and thinkingContext carries weather reasons
    await page.evaluate(() => {
      window.voiceTest.channel.emit({ type: "session.input_transcript.delta", delta: "고추밭 500평이에요" });
      window.voiceTest.channel.emit({ type: "session.output_transcript.delta", delta: "네, 500평 고추밭 기억할게요." });
    });
    await page.evaluate(() => {
      window.voiceTest.channel.emit({ type: "session.input_transcript.delta", delta: "금요일에 작업 가능한가요?" });
      window.voiceTest.channel.emit({ type: "session.delegation.created", delegation: { id: "d-weather", target: "client" } });
    });
    await page.waitForFunction(() => window.voiceTest.sent.some(e => e.type === "session.commentary.append" && e.delegation_id === "d-weather"));
    const thinkEvent = await page.evaluate(() => window.voiceTest.sent.find(e => e.type === "session.thinking.append" && e.delegation_id === "d-weather" && e.content.includes("금요일 강수")));
    assert.ok(thinkEvent, "thinkingContext must include weather reasons and alternatives");
    assert.ok(requests.agent[0].history.some(h => h.content.includes("고추밭 500평이에요")));
    assert.equal(requests.agent[0].history.some(h => h.content.includes("금요일에 작업 가능한가요?")), false,
      "the delegated utterance is the message, not part of its own history");

    // The model reads the delegated answer aloud, then the user says thanks and the reply is cut off by a voice switch.
    await page.evaluate(() => {
      window.voiceTest.channel.emit({ type: "session.output_transcript.delta", delta: "금요일은 비가 와서 월요일이 좋아요." });
      window.voiceTest.channel.emit({ type: "session.input_transcript.delta", delta: "고마워요" });
    });
    // 사용자가 말을 마친 뒤(침묵 구간이 지난 뒤)에야 농농이가 답한다. 말하는 도중의 발화는 버린다.
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.voiceTest.channel.emit({ type: "session.output_transcript.delta", delta: "천만에요, 월요일에" });
    });

    // 2. Switching voice mid-session reconnects with selected voice while keeping prior history
    await page.locator("#aiVoiceSelect").selectOption("willow");
    await page.waitForFunction(() => window.voiceTest.peers === 2);
    await page.waitForFunction(() => document.querySelector("#aiVoiceLiveBar").dataset.voiceState === "listening");
    assert.equal(requests.live[1].voice, "willow");
    const switched = requests.live[1].history;
    assert.ok(switched.some(h => h.content.includes("고추밭 500평이에요")));
    assert.equal(switched.filter(h => h.role === "user" && h.content === "금요일에 작업 가능한가요?").length, 1);
    assert.equal(switched.filter(h => h.content.includes("금요일은 비가 와서")).length, 1, "delegated read-out is not stored twice");
    assert.ok(switched.some(h => h.role === "user" && h.content === "고마워요"));
    assert.ok(switched.some(h => h.role === "assistant" && h.content === "천만에요, 월요일에"), "in-flight reply survives the voice switch");

    await page.locator("#aiVoiceStopBtn").click();
    await page.waitForFunction(() => window.voiceTest.stopped === 2);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
