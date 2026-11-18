// 문제 7 검증: 실시간 음성 대화 중에도 사진을 올릴 수 있고, 농농이 사진을 참고해 음성으로 답한다.
// 실제 화면 모듈과 DOM을 쓰고, WebRTC·마이크·서버 응답만 흉내 낸다.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function startStatic() {
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function openLivePage(browser, port, agent) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  const agentRequests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const listings = listListings();
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === "/api/agent") {
      const body = req.postDataJSON();
      agentRequests.push(body);
      const { delayMs = 0, status = 200, json } = agent(body, agentRequests.length);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return route.fulfill({ status, json });
    }
    let data = {};
    if (path === "/api/listings") data = { listings };
    if (path === "/api/me") data = { user: null };
    if (path === "/api/voice") data = req.method() === "GET"
      ? { liveAvailable: true, serverStt: false }
      : { session: { id: "s-photo" }, transport: { type: "webrtc", sdp: "answer" } };
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    window.voiceTest = { sent: [] };
    const track = { enabled: true, stop() {} };
    window.voiceTest.track = track;
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
      createDataChannel() { return (window.voiceTest.channel = new Channel()); }
      async createOffer() { return { type: "offer", sdp: "offer" }; }
      async setLocalDescription(offer) { this.localDescription = offer; }
      async setRemoteDescription() { setTimeout(() => window.voiceTest.channel.emit({ type: "session.started" }), 0); }
      close() {}
    };
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator("#aiLauncher").click();
  await page.locator("#aiPanel.is-fullscreen").waitFor({ state: "visible" });
  await page.locator("#aiPlusButton").click();
  await page.locator("#aiLiveVoiceButton").click();
  await page.waitForFunction(() => document.querySelector("#aiVoiceLiveBar").dataset.voiceState === "listening");
  return { page, errors, agentRequests };
}

const photoReply = { mode: "agent", reply: "사진으로 보면 관리기 엔진 아래에서 기름이 새는 것으로 보여요.", listingIds: [], photoSummary: { machineType: "cultivator", confidence: "medium", observations: ["누유"] } };

test("음성 대화 중 입력한 글과 사진을 함께 보내고, 답을 음성으로 읽는다", async () => {
  const server = await startStatic();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { page, errors, agentRequests } = await openLivePage(browser, server.address().port, () => ({ json: photoReply }));
    assert.equal(await page.locator("#aiVoicePhotoBtn").isVisible(), true, "음성 바에서 바로 사진을 고를 수 있다");
    await page.locator("#aiInput").fill("엔진 아래가 젖어 있어요");
    await page.locator("#aiPhotoInput").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: PNG });
    await page.locator("#aiPhotoPreview").waitFor({ state: "visible" });
    await page.waitForTimeout(3500); // 예전처럼 몇 초 뒤 저절로 보내지 않는다
    assert.equal(agentRequests.length, 0, "고르기만 해서는 보내지 않는다");
    assert.equal(await page.locator("#aiInput").inputValue(), "엔진 아래가 젖어 있어요", "입력해 둔 글을 바꾸지 않는다");
    assert.match(await page.locator("#aiPhotoThumb").getAttribute("src"), /^data:image\//);

    await page.locator("#aiForm [type=submit]").click();
    await page.waitForFunction(() => window.voiceTest.sent.some((e) => e.type === "session.commentary.append" && e.content.includes("기름이 새는")));
    assert.equal(agentRequests.length, 1);
    assert.equal(agentRequests[0].inputMode, "voice");
    assert.equal(agentRequests[0].message, "엔진 아래가 젖어 있어요");
    assert.equal(await page.locator("#aiInput").inputValue(), "");
    assert.match(agentRequests[0].image, /^data:image\//);
    assert.equal(await page.locator("#aiPhotoPreview").isHidden(), true, "보낸 사진은 첨부에서 빠진다");
    assert.equal(await page.evaluate(() => window.voiceTest.sent.some((e) => e.type === "session.input_audio.mute")), false, "사진을 보내도 마이크를 끄지 않는다");
    assert.equal(await page.evaluate(() => window.voiceTest.track.enabled), true);
    assert.equal(await page.locator("#aiVoiceLiveBar").isVisible(), true, "음성 대화는 계속된다");
    assert.ok(await page.locator(".chat-bubble.user img.ai-chat-photo").count() >= 1, "보낸 사진이 대화에 보인다");
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("문제7: 음성 대화 중 사진만 보내다 실패하면 사진을 첨부 상태로 남겨 전송만 다시 누르면 같은 사진을 보낸다", async () => {
  const server = await startStatic();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { page, errors, agentRequests } = await openLivePage(browser, server.address().port, (_body, n) => (n === 1
      ? { status: 502, json: { code: "PHOTO_UNAVAILABLE", error: "사진을 지금 확인하지 못했어요." } }
      : { json: photoReply }));
    await page.locator("#aiPhotoInput").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: PNG });
    await page.locator("#aiPhotoPreview").waitFor({ state: "visible" });
    await page.locator("#aiForm [type=submit]").click();
    await page.locator(".chat-bubble.assistant", { hasText: "사진은 그대로 두었어요" }).waitFor();
    assert.equal(agentRequests.length, 1);
    assert.equal(agentRequests[0].message, undefined);
    assert.equal(await page.locator("#aiPhotoPreview").isVisible(), true, "실패하면 사진을 다시 첨부해 둔다");

    await page.locator("#aiForm [type=submit]").click();
    await page.waitForFunction(() => window.voiceTest.sent.some((e) => e.type === "session.commentary.append" && e.content.includes("기름이 새는")));
    assert.equal(agentRequests.length, 2);
    assert.equal(agentRequests[1].image, agentRequests[0].image, "같은 사진으로 다시 보낸다");
    assert.equal(await page.locator("#aiPhotoPreview").isHidden(), true);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("문제7: 농농이 다른 말을 확인하는 중에 올린 사진은 다음 음성 질문과 함께 보낸다(사진 + 말로 설명)", async () => {
  const server = await startStatic();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { page, errors, agentRequests } = await openLivePage(browser, server.address().port, (_body, n) => (n === 1
      ? { delayMs: 600, json: { mode: "agent", reply: "청기면 관리기 매물이 있어요.", listingIds: [] } }
      : { json: photoReply }));
    await page.evaluate(() => {
      window.voiceTest.channel.emit({ type: "session.input_transcript.delta", delta: "관리기 찾아줘" });
      window.voiceTest.channel.emit({ type: "session.delegation.created", delegation: { id: "d-1", target: "client" } });
    });
    await page.waitForFunction(() => document.querySelector("#aiVoiceLiveBar").dataset.voiceState === "thinking");
    await page.locator("#aiPhotoInput").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: PNG });
    await page.waitForFunction(() => window.voiceTest.sent.some((e) => e.type === "session.commentary.append" && e.delegation_id === "d-1"));
    assert.equal(agentRequests.length, 1, "확인 중에는 사진만 따로 보내지 않는다");
    assert.equal(agentRequests[0].image, undefined);

    await page.waitForTimeout(750); // 사용자 말이 끝난 뒤
    await page.evaluate(() => {
      window.voiceTest.channel.emit({ type: "session.input_transcript.delta", delta: "여기서 기름이 새요" });
      window.voiceTest.channel.emit({ type: "session.delegation.created", delegation: { id: "d-2", target: "client" } });
    });
    await page.waitForFunction(() => window.voiceTest.sent.some((e) => e.type === "session.commentary.append" && e.delegation_id === "d-2"));
    assert.equal(agentRequests.length, 2);
    assert.equal(agentRequests[1].message, "여기서 기름이 새요");
    assert.match(agentRequests[1].image, /^data:image\//, "말과 사진을 함께 보낸다");
    const spoken = await page.evaluate(() => window.voiceTest.sent.find((e) => e.delegation_id === "d-2" && e.type === "session.commentary.append").content);
    assert.match(spoken, /기름이 새는/);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
