// 글 채팅의 사진 첨부: 고르면 작은 미리보기만 뜨고(자동 전송 없음, 입력한 글 유지), 전송해야 실제 사진이 함께 간다.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";
import { startStaticServer } from "./helpers/live-voice-page.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const photoReply = { mode: "agent", reply: "사진으로 보면 관리기 엔진 아래에서 기름이 새는 것으로 보여요.", listingIds: [], photoSummary: { machineType: "cultivator", confidence: "medium", observations: ["누유"] } };

async function openPanel(browser, port, agent) {
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
      const { status = 200, json } = agent(body, agentRequests.length);
      return route.fulfill({ status, json });
    }
    let data = {};
    if (path === "/api/listings") data = { listings };
    if (path === "/api/me") data = { user: null };
    if (path === "/api/voice") data = { liveAvailable: false, serverStt: false };
    await route.fulfill({ json: data });
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator("#aiLauncher").click();
  await page.locator("#aiPanel.is-fullscreen").waitFor({ state: "visible" });
  return { page, errors, agentRequests };
}

const attach = (page) => page.locator("#aiPhotoInput").setInputFiles({ name: "engine.png", mimeType: "image/png", buffer: PNG });
const send = (page) => page.locator("#aiForm [type=submit]").click();

test("사진 첨부: 고르면 미리보기만 뜨고 글은 그대로이며, 빼기 버튼으로 뺄 수 있다", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { page, errors, agentRequests } = await openPanel(browser, server.address().port, () => ({ json: photoReply }));
    await page.locator("#aiInput").fill("시동이 안 걸려요");
    await attach(page);
    await page.locator("#aiPhotoPreview").waitFor({ state: "visible" });
    const box = await page.locator("#aiPhotoThumb").boundingBox();
    assert.ok(box.width <= 56 && box.height <= 56, `small thumbnail (${box.width}x${box.height})`);
    assert.equal(await page.locator("#aiInput").inputValue(), "시동이 안 걸려요", "typed text is kept");
    await page.waitForTimeout(500);
    assert.equal(agentRequests.length, 0, "selecting never sends");

    await page.locator("#aiPhotoRemove").click();
    assert.equal(await page.locator("#aiPhotoPreview").isHidden(), true);
    await send(page);
    await page.locator(".chat-bubble.assistant", { hasText: "기름이 새는" }).waitFor();
    assert.equal(agentRequests.length, 1);
    assert.equal(agentRequests[0].image, undefined, "a removed photo is not sent");
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("사진 첨부: 입력한 글이 있으면 함께 보내고, 글이 비어 있으면 사진만 보낸다", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { page, errors, agentRequests } = await openPanel(browser, server.address().port, (_body, n) => (n === 1
      ? { status: 502, json: { code: "PHOTO_UNAVAILABLE", error: "사진을 지금 확인하지 못했어요. 잠시 후 다시 올려 주세요." } }
      : { json: photoReply }));
    await page.locator("#aiInput").fill("여기서 기름이 새요");
    await attach(page);
    await page.locator("#aiPhotoPreview").waitFor({ state: "visible" });
    await send(page);
    await page.locator(".chat-bubble.assistant", { hasText: "사진을 지금 확인하지 못했어요" }).waitFor();
    assert.equal(agentRequests[0].message, "여기서 기름이 새요");
    assert.equal(agentRequests[0].inputMode, "text");
    assert.match(agentRequests[0].image, /^data:image\/(webp|jpeg|png);base64,/);
    assert.equal(await page.locator("#aiPhotoPreview").isVisible(), true, "photo stays attached after a failure");
    assert.equal(await page.locator("#aiInput").inputValue(), "여기서 기름이 새요", "typed text is restored for retry");

    await send(page);
    await page.locator(".chat-bubble.assistant", { hasText: "기름이 새는" }).waitFor();
    assert.equal(agentRequests.length, 2);
    assert.equal(agentRequests[1].message, "여기서 기름이 새요");
    assert.equal(agentRequests[1].image, agentRequests[0].image, "retry sends the same photo");
    assert.equal(await page.locator("#aiPhotoPreview").isHidden(), true, "sent photo leaves the composer");

    assert.equal(await page.locator(".chat-bubble.user").last().textContent(), "여기서 기름이 새요");

    // 입력한 글 없이 사진 보내기
    await attach(page);
    await page.locator("#aiPhotoPreview").waitFor({ state: "visible" });
    assert.equal(await page.locator("#aiInput").inputValue(), "");
    await send(page);
    await page.waitForFunction(() => document.querySelectorAll(".chat-bubble.user img.ai-chat-photo").length >= 3);
    await page.waitForFunction(() => !document.querySelector("#aiMessages .is-thinking"));
    assert.equal(agentRequests.length, 3);
    assert.equal(agentRequests[2].message, undefined);
    assert.match(agentRequests[2].image, /^data:image\//);
    assert.equal(await page.locator(".chat-bubble.user").last().textContent(), "");
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
