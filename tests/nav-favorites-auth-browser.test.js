import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { resetAuthCache } from "../server/account-auth.js";
import { closePool, setPool } from "../server/db.js";
import { setWritesFrozen } from "../server/migrator.js";

let tempDir;
let server;
let baseUrl;
let browser;
let prevEnv = {};

before(async () => {
  prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    APP_ENV: process.env.APP_ENV,
    MOA_LOCAL_DB: process.env.MOA_LOCAL_DB,
    OBJECT_STORAGE_DIR: process.env.OBJECT_STORAGE_DIR,
    HOST: process.env.HOST,
    PORT: process.env.PORT,
  };

  tempDir = await mkdtemp(join(tmpdir(), "moa-nav-fav-auth-"));
  delete process.env.DATABASE_URL;
  process.env.APP_ENV = "test";
  process.env.MOA_LOCAL_DB = join(tempDir, "pglite");
  process.env.OBJECT_STORAGE_DIR = join(tempDir, "objects");

  await closePool().catch(() => {});
  setPool(undefined);
  resetAuthCache();

  const { createAppServer } = await import("../dev-server.js");
  server = await createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  browser = await chromium.launch({ channel: "chrome", headless: true });
});

after(async () => {
  await setWritesFrozen({ env: "test", frozen: false }).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  await closePool().catch(() => {});
  setPool(undefined);
  resetAuthCache();
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function signupOnLoginView(page, { username, name, password = "Password123!" }) {
  const switchBtn = page.locator("#switchAccount");
  if ((await switchBtn.textContent())?.trim() === "회원가입") {
    await switchBtn.click();
  }
  await page.locator("#signupName").fill(name);
  await page.locator("#loginId").fill(username);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#signupConfirm").fill(password);
  await page.locator("#loginSubmit").click();
  await page.locator("#myPageButton").waitFor({ state: "visible", timeout: 10000 });
}

test("favorites in-page view works for guests and signed-in users without opening modal", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // Go to browse and favorite the first listing as a guest
    await page.locator('.sidebar-nav [data-view="browse"]').click();
    const firstCard = page.locator("#listingGrid .listing-card").first();
    await firstCard.waitFor({ state: "visible" });
    const listingTitle = (await firstCard.locator("h3").textContent())?.trim();
    await firstCard.locator("[data-favorite]").click();

    // Open favorites via top nav submenu (매물 찾기 -> 찜한 농기계)
    await page.locator('.nav-group[data-nav-group="browse"]').hover();
    await page.locator("#navSubmenuBrowse").waitFor({ state: "visible" });
    await page.locator('#navSubmenuBrowse [data-nav-dest="favorites"]').click();

    // Verify in-page favorites view (NOT modal)
    await page.locator("#favoritesView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#formBackdrop").isHidden(), true, "favorites must not open modal");
    assert.equal(await page.locator("#favoritesCount").textContent(), "(1대)");
    assert.equal(await page.locator("#favNavBadge").textContent(), "1");
    assert.equal(await page.locator("#favoritesGuestNotice").isVisible(), true);
    assert.match(await page.locator("#favoritesList").textContent(), new RegExp(listingTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    // Open detail from favorites view
    await page.locator("#favoritesList [data-favorite-detail]").first().click();
    await page.locator("#detailBackdrop").waitFor({ state: "visible" });
    await page.locator("#closeDetail").click();
    await page.locator("#detailBackdrop").waitFor({ state: "hidden" });

    // Remove favorite in-page and verify count + empty state
    await page.locator("#favoritesList [data-fav-remove]").first().click();
    assert.equal(await page.locator("#favoritesCount").textContent(), "(0대)");
    assert.equal(await page.locator("#favNavBadge").isHidden(), true);
    assert.match(await page.locator("#favoritesList").textContent(), /아직 찜한 농기계가 없습니다/);

    // Empty state CTA navigates back to browse
    await page.locator("#favoritesList [data-favorites-browse]").click();
    await page.locator("#browseView").waitFor({ state: "visible" });

    // Sign up and verify signed-in favorites flow
    await page.locator("#loginButton").click();
    await page.locator("#loginView").waitFor({ state: "visible" });
    await signupOnLoginView(page, { username: "fav_user_1", name: "찜테스트농부" });

    await page.locator('.sidebar-nav [data-view="browse"]').click();
    await page.locator("#listingGrid .listing-card").first().locator("[data-favorite]").click();

    // Open favorites via 마이페이지 menu entry point
    await page.locator("#myPageButton").click();
    await page.locator("#myPageMenu").waitFor({ state: "visible" });
    await page.locator('#myPageMenu [data-view="favorites"]').click();

    await page.locator("#favoritesView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#formBackdrop").isHidden(), true);
    assert.equal(await page.locator("#favoritesGuestNotice").isHidden(), true);
    assert.equal(await page.locator("#favoritesCount").textContent(), "(1대)");

    await page.locator("#favoritesList [data-fav-remove]").first().click();
    await page.waitForFunction(() => document.querySelector("#favoritesCount")?.textContent === "(0대)");
    assert.equal(await page.locator("#favNavBadge").isHidden(), true);
  } finally {
    await context.close();
  }
});

test("logged-out 거래 관리 and 내 대여 요청 show auth gate, hide previous content, and preserve signed-in behavior", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 1. Logged-out 거래 관리
    await page.locator('.sidebar-nav [data-view="deals"]').click();
    await page.locator("#dealsLoginRequiredView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#dealsView").isHidden(), true, "dealsView previous content must be hidden when logged out");
    assert.match(await page.locator("#dealsLoginRequiredView").textContent(), /로그인이 필요한 서비스입니다\./);

    // Actionable login from 거래 관리
    await page.locator("#dealsLoginGoButton").click();
    await page.locator("#loginView").waitFor({ state: "visible" });

    // 2. Logged-out 내 대여 요청 (via top nav submenu)
    await page.locator('.nav-group[data-nav-group="deals"]').hover();
    await page.locator("#navSubmenuDeals").waitFor({ state: "visible" });
    await page.locator('#navSubmenuDeals [data-nav-dest="requests"]').click();

    await page.locator("#requestsLoginRequiredView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#requestsView").isHidden(), true, "requestsView previous content must be hidden when logged out");
    assert.match(await page.locator("#requestsLoginRequiredView").textContent(), /로그인이 필요한 서비스입니다\./);

    // Actionable login from 내 대여 요청 -> resumes into signed-in requestsView
    await page.locator("#requestsLoginGoButton").click();
    await page.locator("#loginView").waitFor({ state: "visible" });
    await signupOnLoginView(page, { username: "gate_user_1", name: "인증테스트농부" });

    await page.locator("#requestsView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#requestsLoginRequiredView").isHidden(), true);
    assert.match(await page.locator("#requestsView").textContent(), /내 대여 요청/);

    // Signed-in 거래 관리 shows dealsView normally
    await page.locator('.sidebar-nav [data-view="deals"]').click();
    await page.locator("#dealsView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#dealsLoginRequiredView").isHidden(), true);
    assert.match(await page.locator("#dealsView").textContent(), /거래 관리/);
  } finally {
    await context.close();
  }
});

test("top menu hover submenus support hover navigation, keyboard, touch, and dismiss", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // Hover -> submenu opens -> click 중고 구매 매물 -> navigates & switches transaction to sale
    const browseGroup = page.locator('.nav-group[data-nav-group="browse"]');
    await browseGroup.hover();
    await page.locator("#navSubmenuBrowse").waitFor({ state: "visible" });
    assert.equal(await browseGroup.locator("> .nav-item").getAttribute("aria-expanded"), "true");

    await page.locator('#navSubmenuBrowse [data-nav-dest="browse-sale"]').click();
    await page.locator("#browseView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#saleTab").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#navSubmenuBrowse").isHidden(), true);

    // Keyboard: ArrowDown opens submenu & focuses first item, ArrowDown moves to second, Escape closes & restores focus
    const dealsTrigger = page.locator('.nav-group[data-nav-group="deals"] > .nav-item');
    await dealsTrigger.focus();
    await page.keyboard.press("ArrowDown");
    await page.locator("#navSubmenuDeals").waitFor({ state: "visible" });
    const firstFocused = await page.evaluate(() => document.activeElement?.getAttribute("data-nav-dest"));
    assert.equal(firstFocused, "deals");

    await page.keyboard.press("ArrowDown");
    const secondFocused = await page.evaluate(() => document.activeElement?.getAttribute("data-nav-dest"));
    assert.equal(secondFocused, "requests");

    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#navSubmenuDeals").isHidden(), true);
    const returnedToTrigger = await page.evaluate(() => document.activeElement?.getAttribute("data-view"));
    assert.equal(returnedToTrigger, "deals");

    // Touch: first touch tap opens submenu without navigating away; outside tap dismisses
    const mapTrigger = page.locator('.nav-group[data-nav-group="map"] > .nav-item');
    await mapTrigger.evaluate((el) => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      el.click();
    });
    await page.locator("#navSubmenuMap").waitFor({ state: "visible" });
    assert.equal(await page.locator("#mapView").isHidden(), true, "first touch tap should open submenu instead of navigating");

    await page.locator("main").click({ position: { x: 20, y: 20 } });
    assert.equal(await page.locator("#navSubmenuMap").isHidden(), true, "outside click must dismiss submenu");
  } finally {
    await context.close();
  }
});
