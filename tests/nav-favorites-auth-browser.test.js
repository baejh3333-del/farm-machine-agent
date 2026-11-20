import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { clickAuthButton, goToMenu, signupOnLoginView } from "./helpers/nav.js";

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

// 매물 찾기(디자인) 첫 카드의 상세를 열고 '찜하기'를 누른다. 상세 제목을 돌려준다.
async function favoriteFirstListing(page) {
  await goToMenu(page, "매물 찾기");
  const firstCard = page.locator("#browseDesignHost article[data-card]").first();
  await firstCard.waitFor({ state: "visible" });
  await firstCard.click();
  const host = page.locator("#detailDesignHost");
  await host.locator("h1").waitFor({ state: "visible" });
  const heading = (await host.locator("h1").textContent()).trim();
  await host.locator('button[aria-label="찜하기"]').click();
  await host.locator('button[aria-label="찜하기"][aria-pressed="true"]').waitFor({ state: "attached" });
  return heading;
}

test("favorites in-page view works for guests and signed-in users without opening modal", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 손님: 매물 상세에서 찜 → 머리말 '기계 관리 › 찜 목록'
    const heading = await favoriteFirstListing(page);
    const model = heading.split(" ").pop();
    await goToMenu(page, "찜 목록");

    // 찜 목록은 창(모달)이 아니라 화면 안에 보인다
    await page.locator("#favoritesView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#formBackdrop").isHidden(), true, "favorites must not open modal");
    assert.equal(await page.locator("#favoritesCount").textContent(), "(1대)");
    assert.equal(await page.locator("#favoritesGuestNotice").isVisible(), true);
    assert.match(await page.locator("#favoritesList").textContent(), new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    // 찜 목록의 '상세 보기'는 매물 상세 화면을 연다
    await page.locator("#favoritesList [data-favorite-detail].button").first().click();
    await page.locator("#detailView:not([hidden]) #detailDesignHost h1").waitFor({ state: "visible" });
    assert.equal((await page.locator("#detailDesignHost h1").textContent()).trim(), heading);
    await goToMenu(page, "찜 목록");

    // 화면 안에서 빼면 개수·빈 상태가 바로 바뀐다
    await page.locator("#favoritesList [data-fav-remove]").first().click();
    assert.equal(await page.locator("#favoritesCount").textContent(), "(0대)");
    assert.match(await page.locator("#favoritesList").textContent(), /아직 찜한 농기계가 없습니다/);

    // 빈 상태의 '매물 둘러보기'는 매물 찾기로 간다
    await page.locator("#favoritesList [data-favorites-browse]").click();
    await page.locator("#browseView").waitFor({ state: "visible" });

    // 가입 후: 머리말 버튼이 '마이페이지'로 바뀌고, 찜은 계정에 저장된다
    await clickAuthButton(page);
    await signupOnLoginView(page, { username: "fav_user_1", name: "찜테스트농부" });
    await page.locator("#loginView").waitFor({ state: "hidden" });
    await favoriteFirstListing(page);
    await page.locator('#detailDesignHost header a:has-text("마이페이지")').first().waitFor({ state: "visible" });

    // 마이페이지 왼쪽 메뉴의 '찜 목록'
    await clickAuthButton(page);
    await page.locator("#myPageMenu").waitFor({ state: "visible" });
    await page.locator('#myPageMenu [data-view="favorites"]').click();

    await page.locator("#favoritesView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#formBackdrop").isHidden(), true);
    assert.equal(await page.locator("#favoritesGuestNotice").isHidden(), true);
    assert.equal(await page.locator("#favoritesCount").textContent(), "(1대)");

    await page.locator("#favoritesList [data-fav-remove]").first().click();
    await page.waitForFunction(() => document.querySelector("#favoritesCount")?.textContent === "(0대)");
  } finally {
    await context.close();
  }
});

test("logged-out 거래 관리 and 내 대여 요청 show auth gate, hide previous content, and preserve signed-in behavior", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 1. 로그아웃 상태의 거래 관리 (디자인 머리말 '기계 관리 › 거래 관리')
    await goToMenu(page, "거래 관리");
    await page.locator("#dealsLoginRequiredView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#dealsView").isHidden(), true, "dealsView previous content must be hidden when logged out");
    assert.match(await page.locator("#dealsLoginRequiredView").textContent(), /로그인이 필요한 서비스입니다\./);

    // 거래 관리의 로그인 버튼
    await page.locator("#dealsLoginGoButton").click();
    await page.locator("#loginView").waitFor({ state: "visible" });

    // 2. 로그아웃 상태의 내 대여 요청 (기존 헤더 '기계 관리 › 내 대여 요청')
    await goToMenu(page, "내 대여 요청");
    await page.locator("#requestsLoginRequiredView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#requestsView").isHidden(), true, "requestsView previous content must be hidden when logged out");
    assert.match(await page.locator("#requestsLoginRequiredView").textContent(), /로그인이 필요한 서비스입니다\./);

    // 내 대여 요청에서 로그인하면 로그인한 내 대여 요청 화면으로 돌아온다
    await page.locator("#requestsLoginGoButton").click();
    await signupOnLoginView(page, { username: "gate_user_1", name: "인증테스트농부" });

    await page.locator("#requestsView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#requestsLoginRequiredView").isHidden(), true);
    assert.match(await page.locator("#requestsView").textContent(), /내 대여 요청/);

    // 로그인 후 거래 관리는 그대로 보인다
    await goToMenu(page, "거래 관리");
    await page.locator("#dealsView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#dealsLoginRequiredView").isHidden(), true);
    assert.match(await page.locator("#dealsView").textContent(), /거래 관리/);
  } finally {
    await context.close();
  }
});

test("top menu submenus: design header keeps hover-opened menu on click; legacy header supports hover, keyboard, touch, and dismiss", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 디자인 머리말(홈): 마우스를 올리면 열리고, 이어서 눌러도 닫히지 않으며, 한 번 더 누르면 닫힌다
    const home = page.locator("#homeDesignHost");
    const megaOpen = () => home.locator("[data-mega-root]").getAttribute("data-open");
    const mine = home.locator('nav[aria-label="주 메뉴"] a', { hasText: "기계 관리" });
    await mine.hover();
    assert.equal(await megaOpen(), "mine", "hover opens submenu");
    await mine.click();
    assert.equal(await megaOpen(), "mine", "click right after hover keeps submenu open");
    await mine.click();
    assert.equal(await megaOpen(), "", "second click closes submenu");

    // 세부 항목을 누르면 그 화면으로 간다 → 기존 헤더 화면(작물별 작업 가이드)
    await goToMenu(page, "작물별 작업 가이드");
    await page.locator("#guideView").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.body.classList.contains("design-page")), false);

    // 기존 헤더: 마우스를 올리면 그 메뉴의 세부 항목이 열리고, 누르면 이동하며 닫힌다
    const panel = page.locator("#headerFeatures");
    const ownerTrigger = page.locator('.sidebar-nav [data-view="owner"]');
    await ownerTrigger.hover();
    await panel.waitFor({ state: "visible" });
    assert.equal(await ownerTrigger.getAttribute("aria-expanded"), "true");
    await panel.locator('[data-nav-dest="favorites"]').click();
    await page.locator("#favoritesView").waitFor({ state: "visible" });
    assert.equal(await panel.isHidden(), true);

    // 키보드: ArrowDown으로 첫 항목에 초점, 다시 ArrowDown으로 다음 항목, Escape로 닫고 초점 복귀
    await page.mouse.move(700, 600);
    await ownerTrigger.focus();
    await page.keyboard.press("ArrowDown");
    await panel.waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-nav-dest")), "owner");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-nav-dest")), "deals");
    await page.keyboard.press("Escape");
    assert.equal(await panel.isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-view")), "owner");

    // 터치: 첫 탭은 이동하지 않고 세부 메뉴만 열며, 바깥을 누르면 닫힌다
    const garageTrigger = page.locator('.sidebar-nav [data-view="garage"]');
    await garageTrigger.evaluate((el) => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      el.click();
    });
    await panel.waitFor({ state: "visible" });
    assert.equal(await page.locator("#garageView").isHidden(), true, "first touch tap should open submenu instead of navigating");
    await page.mouse.click(700, 700);
    assert.equal(await panel.isHidden(), true, "outside click must dismiss submenu");
  } finally {
    await context.close();
  }
});
