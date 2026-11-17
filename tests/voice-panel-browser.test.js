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
      res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
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
      assert.equal(await page.locator('[data-ai-picker-toggle="inline"]').count(), 1);
      await page.keyboard.press("Escape");
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
