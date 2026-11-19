import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";
import { deferred, startStaticServer, waitFor } from "./helpers/live-voice-page.js";

// Typed AI chat regression: submitting a question must not wait on /api/listings before calling /api/agent.
async function openTextPanelPage(browser, port, { agent, holdListings = null }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  const agentRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const listings = listListings();

  await page.route("**/api/**", async (route) => {
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
    if (path === "/api/me") return route.fulfill({ json: { user: null } }).catch(() => {});
    if (path === "/api/voice") return route.fulfill({ json: { liveAvailable: false, serverStt: false } }).catch(() => {});
    return route.fulfill({ json: {} }).catch(() => {});
  });

  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator("#aiLauncher").click();
  await page.locator("#aiPanel.is-fullscreen").waitFor({ state: "visible" });
  return { page, errors, agentRequests, listings };
}

test("typed agent submit: sends /api/agent before catalog loads, renders non-listing replies immediately, and awaits catalog only for listing cards", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const listingsGate = deferred();
  try {
    const { page, errors, agentRequests, listings } = await openTextPanelPage(browser, server.address().port, {
      holdListings: listingsGate.promise,
      agent: async (_body, index, catalog) => {
        if (index === 0) {
          return { mode: "agent", reply: "내일 영양읍은 맑고 바람이 약해요.", listingIds: [] };
        }
        if (index === 1) {
          return {
            mode: "agent",
            reply: "트랙터 매물을 찾았어요.",
            listingIds: ["not-in-local-catalog", catalog[0].id, catalog[0].id],
          };
        }
        return { mode: "agent", reply: "첫 번째 매물 상세 정보예요.", listingIds: [] };
      },
    });

    // 1) Non-listing reply must dispatch /api/agent and render immediately while /api/listings is still held.
    await page.locator("#aiInput").fill("내일 영양읍 날씨 어때?");
    await page.locator("#aiForm [type=submit]").click();
    await waitFor(() => agentRequests.length === 1);
    await page.locator(".chat-bubble.assistant", { hasText: "내일 영양읍은 맑고 바람이 약해요." }).waitFor();
    assert.equal(await page.locator(".chat-bubble.is-thinking").count(), 0, "thinking bubble cleared without waiting for catalog");

    // 2) Listing-card reply must also dispatch /api/agent before /api/listings finishes,
    //    then wait for catalog only when cards need to be rendered.
    await page.locator("#aiInput").fill("트랙터 빌려줘");
    await page.locator("#aiForm [type=submit]").click();
    await waitFor(() => agentRequests.length === 2);
    assert.equal(await page.locator(".chat-bubble.is-thinking").count(), 1, "thinking bubble remains while catalog settles for cards");
    assert.equal(await page.locator(".ai-rec-card").count(), 0);

    listingsGate.resolve();
    await page.locator(".chat-bubble.assistant.has-results .ai-rec-card").first().waitFor({ state: "visible" });
    assert.equal(await page.locator(".chat-bubble.assistant.has-results .ai-rec-card").count(), 1, "deduplicated locally known card rendered");
    assert.equal(await page.locator(".chat-bubble.is-thinking").count(), 0);

    // 3) Follow-up preserves server listing order/identity even when an ID is absent from local catalog.
    await page.locator("#aiInput").fill("1번 자세히 알려줘");
    await page.locator("#aiForm [type=submit]").click();
    await waitFor(() => agentRequests.length === 3);
    await page.locator(".chat-bubble.assistant", { hasText: "첫 번째 매물 상세 정보예요." }).waitFor();
    assert.deepEqual(
      agentRequests[2].uiContext.lastShownListings.map((item) => item.id),
      ["not-in-local-catalog", listings[0].id],
    );
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    listingsGate.resolve();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
