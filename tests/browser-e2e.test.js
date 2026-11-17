import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import sharp from "sharp";

import { resetAuthCache } from "../server/account-auth.js";
import { closePool, kstToday, setPool } from "../server/db.js";
import { setWritesFrozen } from "../server/migrator.js";

function shiftDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

let tempDir;
let server;
let baseUrl;
let browser;
let pngFixturePath;
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

  tempDir = await mkdtemp(join(tmpdir(), "moa-e2e-"));
  delete process.env.DATABASE_URL;
  process.env.APP_ENV = "test";
  process.env.MOA_LOCAL_DB = join(tempDir, "pglite");
  process.env.OBJECT_STORAGE_DIR = join(tempDir, "objects");

  pngFixturePath = join(tempDir, "tractor-fixture.png");
  const pngBuf = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 45, g: 127, b: 78 } },
  }).png().toBuffer();
  await writeFile(pngFixturePath, pngBuf);

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

async function openMyPageAndClick(page, selector) {
  const menu = page.locator("#myPageMenu");
  if (await menu.isHidden()) {
    await page.locator("#myPageButton").click();
    await menu.waitFor({ state: "visible" });
  }
  await menu.locator(selector).click();
  await menu.waitFor({ state: "hidden" });
}

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
}

test("이중 브라우저 컨텍스트 E2E: 회원가입·사진 등록·검색/AI추천·찜/차고 가져오기·대여 승인/채팅/취소·동결 오류 및 계정 전환 격리", async () => {
  const today = kstToday();
  const startDate = shiftDate(today, 4);
  const endDate = shiftDate(today, 6);
  const uniqueTitle = "E2E 실사진 관리기 777";

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 1. User A signs up and creates a rental listing with uploaded image
    await pageA.goto(baseUrl, { waitUntil: "networkidle" });
    await pageA.locator("#loginButton").click();
    await signupOnLoginView(pageA, { username: "e2e_owner_a", name: "소유자A" });
    await pageA.locator("#ownerView").waitFor({ state: "visible" });

    await pageA.locator("#newListingButton").click();
    await pageA.locator("#listingEditorForm").waitFor({ state: "visible" });
    await pageA.locator("#manualSpecFields").waitFor({ state: "visible" });
    await pageA.locator("#editModelId").selectOption("asia-amc900");
    await pageA.locator("#modelSpecSummary").waitFor({ state: "visible" });
    await pageA.locator("#manualSpecFields").waitFor({ state: "hidden" });
    await pageA.locator("#editTitle").fill(uniqueTitle);
    await pageA.locator("#editPrice").fill("65000");
    await pageA.locator("#editPhoto").setInputFiles(pngFixturePath);
    await pageA.locator("#editIncluded").fill("로터리, 두둑성형기 포함");
    await pageA.locator("#editPickup").fill("영양읍 창고 직거래");
    await pageA.locator("#editDescription").fill("Playwright E2E 테스트 매물입니다.");
    await pageA.locator("#listingSubmitButton").click();

    await pageA.locator("#formBackdrop").waitFor({ state: "hidden" });
    await pageA.locator(`#ownerListings:has-text("${uniqueTitle}")`).waitFor({ state: "visible" });

    // Confirm uploaded WebP photo and auto-populated specs serve cleanly
    const listingsRes = await pageA.evaluate(async () => {
      const r = await fetch("/api/listings");
      return r.json();
    });
    const createdListing = listingsRes.listings.find((l) => l.title === uniqueTitle);
    assert.ok(createdListing, "created listing must appear in GET /api/listings");
    assert.equal(createdListing.brand, "아세아텍");
    assert.equal(createdListing.machineType, "cultivator");
    assert.deepEqual(createdListing.operations, ["till", "ridge"]);
    assert.ok(createdListing.cropIds.includes("pepper"));
    assert.ok(createdListing.photoUrl?.startsWith("/api/photos?key="), "photoUrl must point to /api/photos");

    // 2. Guest B searches, favorites, runs AI recommendation, adds garage machine, triggers login resume on rental request
    await pageB.goto(baseUrl, { waitUntil: "networkidle" });
    await pageB.locator("#searchInput").fill(uniqueTitle);
    const matchingCard = pageB.locator("#listingGrid .listing-card", { hasText: uniqueTitle });
    await matchingCard.waitFor({ state: "visible" });

    // Favorite before login (guest storage)
    await matchingCard.locator("[data-favorite]").click();
    await pageB.locator("#myPageNotifDot").waitFor({ state: "visible" });
    assert.equal(await pageB.locator("#favNavBadge").textContent(), "1");

    // Verify Toss-style MyPage dropdown opens, closes on Escape, and #headerAiOpen opens AI panel
    await pageB.locator("#myPageButton").click();
    await pageB.locator("#myPageMenu").waitFor({ state: "visible" });
    await pageB.keyboard.press("Escape");
    await pageB.locator("#myPageMenu").waitFor({ state: "hidden" });

    await pageB.locator("#headerAiOpen").click();
    await pageB.locator("#aiPanel").waitFor({ state: "visible" });
    await pageB.locator("#aiClose").click();
    await pageB.locator("#aiPanel").waitFor({ state: "hidden" });

    // AI panel calls /api/agent without rule-based fallback; when no LLM key is configured, it reports unavailable
    await pageB.locator("#aiLauncher").click();
    await pageB.locator("#aiPanel").waitFor({ state: "visible" });
    await pageB.locator("#aiInput").fill("고추 두둑 대여 300평 7만원 이하");
    await pageB.locator('#aiForm button[type="submit"]').click();
    await pageB.locator('#aiMessages .chat-bubble.assistant:has-text("AI 상담을 호출할 수 없습니다.")').waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await pageB.locator("#aiModeLabel").count(), 0);
    await pageB.locator("#aiClose").click();

    // Add guest machine in garage
    await openMyPageAndClick(pageB, '[data-view="garage"]');
    await pageB.locator("#garageView").waitFor({ state: "visible" });
    await pageB.locator("#ownedModel").selectOption("asia-amc900");
    await pageB.locator("#ownedName").fill("게스트관리기");
    await pageB.locator("#ownedSubmitButton").click();
    await pageB.locator('#ownedMachines:has-text("게스트관리기")').waitFor({ state: "visible" });

    // Open browse card detail and trigger rental request as guest -> preserves intent across signup
    await pageB.locator('header [data-view="browse"]').click();
    await matchingCard.locator("[data-detail]").first().click();
    await pageB.locator("#detailBackdrop").waitFor({ state: "visible" });
    await pageB.locator("[data-detail-action]").click();
    await pageB.locator("#loginView").waitFor({ state: "visible" });

    await signupOnLoginView(pageB, { username: "e2e_buyer_b", name: "요청자B" });

    // Pending rental intent automatically reopens rental form after signup
    await pageB.locator("#rentalForm").waitFor({ state: "visible" });
    await pageB.locator("#rentStart").fill(startDate);
    await pageB.locator("#rentEnd").fill(endDate);
    await pageB.locator("#rentNote").fill("고추밭 작업 대여 요청합니다.");
    await pageB.locator("#rentalSubmitButton").click();
    await pageB.locator("#formBackdrop").waitFor({ state: "hidden" });

    // Navigate to ownerView in B to opt-in guest favorites/garage import
    await openMyPageAndClick(pageB, '[data-view="owner"]');
    await pageB.locator("#guestImportBanner").waitFor({ state: "visible" });
    await pageB.locator("#importGuestConfirm").click();
    await pageB.locator("#guestImportBanner").waitFor({ state: "hidden" });
    assert.equal(await pageB.locator("#favNavBadge").textContent(), "1");

    // B opens listing detail again and starts 1:1 chat inquiry
    await pageB.locator('header [data-view="browse"]').click();
    await pageB.locator("#searchInput").fill(uniqueTitle);
    await pageB.locator("#listingGrid .listing-card", { hasText: uniqueTitle }).locator("[data-detail]").first().click();
    await pageB.locator("[data-detail-chat]").click();
    await pageB.locator("#chatForm").waitFor({ state: "visible" });
    await pageB.locator("#chatMessage").fill("토요일 오전 9시 인수 가능한가요?");
    await pageB.locator("#chatSendButton").click();
    await pageB.locator('#chatLog:has-text("토요일 오전 9시 인수 가능한가요?")').waitFor({ state: "visible" });
    await pageB.locator("#closeForm").click();

    // 3. User A sees approvable badge count 1, approves reservation, replies in chat, and reloads to confirm persistence
    await pageA.reload({ waitUntil: "networkidle" });
    await pageA.locator("#myPageNotifDot").waitFor({ state: "visible" });
    await pageA.locator("#myPageButton").click();
    await pageA.locator("#ownerBadge").waitFor({ state: "visible" });
    assert.equal(await pageA.locator("#ownerBadge").textContent(), "1");
    await openMyPageAndClick(pageA, '[data-view="owner"]');
    await pageA.locator('#ownerRequests [data-req-approve]').waitFor({ state: "visible" });
    await pageA.locator('#ownerRequests [data-req-approve]').click();
    await pageA.locator('#ownerRequests:has-text("예약 확정")').waitFor({ state: "visible" });
    await pageA.locator("#ownerBadge").waitFor({ state: "hidden" });

    // Owner A replies in buyer-scoped chat
    await pageA.locator('#ownerConversations [data-open-chat]').click();
    await pageA.locator('#chatLog:has-text("토요일 오전 9시 인수 가능한가요?")').waitFor({ state: "visible" });
    await pageA.locator("#chatMessage").fill("네 토요일 오전 9시에 준비해 둘게요!");
    await pageA.locator("#chatSendButton").click();
    await pageA.locator('#chatLog:has-text("네 토요일 오전 9시에 준비해 둘게요!")').waitFor({ state: "visible" });
    await pageA.locator("#closeForm").click();

    await pageA.reload({ waitUntil: "networkidle" });
    await openMyPageAndClick(pageA, '[data-view="owner"]');
    await pageA.locator(`#ownerListings:has-text("${startDate} ~ ${endDate}")`).waitFor({ state: "visible" });

    // 4. Write-freeze 503 UI error test on Context A edit modal (keeps modal open, no false success)
    await setWritesFrozen({ env: "test", frozen: true });
    await pageA.locator(`#ownerListings .owner-row:has-text("${uniqueTitle}") [data-owner-edit]`).click();
    await pageA.locator("#listingEditorForm").waitFor({ state: "visible" });
    await pageA.locator("#editTitle").fill("동결 중 수정 시도 제목");
    await pageA.locator("#listingSubmitButton").click();
    await pageA.locator('#toast.visible:has-text("점검 중")').waitFor({ state: "visible" });
    assert.equal(await pageA.locator("#listingEditorForm").isVisible(), true, "edit modal must remain open on write failure");
    await pageA.locator("#closeForm").click();
    await pageA.locator(`#ownerListings:has-text("${uniqueTitle}")`).waitFor({ state: "visible" });
    await setWritesFrozen({ env: "test", frozen: false });

    // 5. Context B sees approved request + A's reply, then cancels the future reservation
    await openMyPageAndClick(pageB, '[data-view="requests"]');
    await pageB.locator('#buyerRequestList:has-text("예약 확정")').waitFor({ state: "visible" });
    await pageB.locator('#buyerRequestList [data-open-chat-listing]').click();
    await pageB.locator('#chatLog:has-text("네 토요일 오전 9시에 준비해 둘게요!")').waitFor({ state: "visible" });
    await pageB.locator("#closeForm").click();

    await pageB.locator('#buyerRequestList [data-req-cancel]').click();
    await pageB.locator('#buyerRequestList:has-text("취소됨")').waitFor({ state: "visible" });

    // 6. Account switch isolation in Context B -> logout B, signup User C -> zero data leakage
    await openMyPageAndClick(pageB, '[data-view="owner"]');
    await pageB.locator("#accountLogoutButton").click();
    await pageB.locator("#favNavBadge").waitFor({ state: "hidden" });

    await pageB.locator("#loginButton").click();
    await signupOnLoginView(pageB, { username: "e2e_user_c", name: "사용자C" });
    await pageB.locator("#ownerView").waitFor({ state: "visible" });
    assert.equal(await pageB.locator("#favNavBadge").isHidden(), true);
    assert.equal(await pageB.locator("#ownerBadge").isHidden(), true);

    await openMyPageAndClick(pageB, '[data-view="garage"]');
    await pageB.locator('#ownedCount:has-text("0대")').waitFor({ state: "visible" });
    await openMyPageAndClick(pageB, '[data-view="requests"]');
    await pageB.locator('#buyerRequestList:has-text("아직 보낸 대여 요청이 없어요")').waitFor({ state: "visible" });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
