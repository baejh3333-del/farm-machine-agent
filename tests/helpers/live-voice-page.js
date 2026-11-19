// 실시간 음성 패널 브라우저 테스트 공용 도구: 실제 패널·컨트롤러 모듈을 쓰고 WebRTC·마이크·/api/*만 흉내 낸다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { listListings } from "../../server/listings-db.js";

export function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw new Error("invalid path");
      const bytes = await readFile(new URL(`../../${file}`, import.meta.url));
      res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "text/html");
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

// agent(body, index) => Promise<json>; holdListings: a promise the /api/listings response waits for.
export async function openLivePage(browser, port, { agent, holdListings = null }) {
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

export const say = (page, text, id) => page.evaluate(([t, d]) => {
  window.voiceTest.channel.emit({ type: "session.input_transcript.delta", delta: t, start_ms: 100, end_ms: 900 });
  window.voiceTest.channel.emit({ type: "session.delegation.created", delegation: { id: d, target: "client" } });
}, [text, id]);
export const commentaryFor = (page, id) => page.evaluate((d) => window.voiceTest.sent.filter(e => e.type === "session.commentary.append" && e.delegation_id === d).map(e => e.content), id);
export const waitCommentary = (page, id) => page.waitForFunction((d) => window.voiceTest.sent.some(e => e.type === "session.commentary.append" && e.delegation_id === d), id);
export const settle = (page, ms = 150) => page.evaluate((t) => new Promise(r => setTimeout(r, t)), ms);

export async function waitFor(check, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise(r => setTimeout(r, 20));
  }
}

export const emit = (page, event) => page.evaluate((e) => window.voiceTest.channel.emit(e), event);
// 컨트롤러가 정정 대상을 되물을 때 보낸 안내(위임 ID 없는 commentary)
export const clarifications = (page) => page.evaluate(() => window.voiceTest.sent
  .filter(e => e.type === "session.commentary.append" && String(e.event_id || "").startsWith("clarify_"))
  .map(e => e.content));
