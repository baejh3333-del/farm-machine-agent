// QA2 인증 회귀: 격리된 임시 로컬 DB(PGlite)와 테스트 계정으로 홍천 hc-vivaldi-1 대여를 실제 폼으로 신청하고,
// 화면에 보인 제목·매물 ID·가격·합계가 DB에 저장된 요청과 같은지 확인한다. 운영 DB·외부 서비스는 쓰지 않는다.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { openFavoriteDetail, seedGuestFavorites, signupOnLoginView } from "./helpers/nav.js";

import { resetAuthCache } from "../server/account-auth.js";
import { closePool, getPool, kstToday, setPool } from "../server/db.js";

const LISTING_ID = "hc-vivaldi-1";

function shiftDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

const digits = (text) => Number(String(text || "").replace(/[^\d]/g, ""));

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
  };
  tempDir = await mkdtemp(join(tmpdir(), "moa-hc-booking-"));
  delete process.env.DATABASE_URL; // 운영·원격 DB를 절대 쓰지 않는다.
  process.env.APP_ENV = "test";
  process.env.MOA_LOCAL_DB = join(tempDir, "pglite");
  process.env.OBJECT_STORAGE_DIR = join(tempDir, "objects");
  await closePool().catch(() => {});
  setPool(undefined);
  resetAuthCache();

  const { createAppServer } = await import("../dev-server.js");
  server = await createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

after(async () => {
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

test("QA2: 로그인한 사용자가 홍천 트랙터를 폼으로 신청하면 화면의 제목·ID·가격·합계가 저장된 요청과 같다", async () => {
  const startDate = shiftDate(kstToday(), 4);
  const endDate = shiftDate(kstToday(), 5); // 2일
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // 상세 화면은 찜 목록의 '상세 보기'로 연다(손님 찜에 미리 넣어 둠)
    await seedGuestFavorites(page, [LISTING_ID]);
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 서버가 주는 기준 매물
    const apiListing = await page.evaluate(async (id) => (await (await fetch("/api/listings")).json()).listings.find((l) => l.id === id), LISTING_ID);
    assert.ok(apiListing, "로컬 DB에 hc-vivaldi-1이 있어야 함");
    assert.equal(apiListing.price, 130000);

    // 화면: 찜 목록 → 상세(2.x 디자인 화면). 제목은 '기종 모델'로, 가격은 '1일 N만원'으로 보인다.
    await openFavoriteDetail(page, LISTING_ID);
    const host = page.locator("#detailDesignHost");
    const model = apiListing.model || apiListing.specification?.model;
    const heading = (await host.locator("h1").textContent()).trim();
    assert.ok(heading.includes(model), `상세 제목 '${heading}'에 모델 '${model}'이 있어야 함`);
    const dayPrice = (await host.locator("text=/^1일 [0-9,]+만원$/").first().textContent()).trim();
    const shownPrice = digits(dayPrice.replace(/^1일/, "")) * 10000;
    assert.equal(shownPrice, apiListing.price, dayPrice);
    const shownTitle = apiListing.title; // 대여 신청·저장 요청은 매물 원래 제목을 쓴다

    // 손님이면 로그인 화면으로 갔다가, 가입하면 같은 매물 대여 폼이 다시 열린다.
    await host.locator("a[data-cta]", { hasText: "대여 요청 보내기" }).click();
    await signupOnLoginView(page, { username: "qa2_hc_renter", name: "홍천테스터" });

    await page.locator("#rentalForm").waitFor({ state: "visible" });
    await page.locator("#rentStart").fill(startDate);
    await page.locator("#rentEnd").fill(endDate);
    await page.locator("#rentNote").fill("QA2 회귀 테스트 신청");
    const buttonLabel = (await page.locator("#rentalSubmitButton").textContent()).replace(/\s/g, "");
    const shownDays = Number(/(\d+)일/.exec(buttonLabel)?.[1]);
    const shownTotal = digits(/·([\d,]+)/.exec(buttonLabel)?.[1]);
    assert.equal(shownDays, 2, buttonLabel);
    assert.equal(shownTotal, 260000, buttonLabel);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/requests") && r.request().method() === "POST"),
      page.locator("#rentalSubmitButton").click(),
    ]);
    assert.ok(response.ok(), `신청 응답 ${response.status()}`);
    await page.locator("#formBackdrop").waitFor({ state: "hidden" });

    // DB에 저장된 요청(이 테스트 계정의 유일한 요청)
    const { rows } = await getPool().query(
      `SELECT r.listing_id, r.start_date::text AS start_date, r.end_date::text AS end_date, r.daily_price, r.days, r.total_price, r.status, l.title
         FROM rental_requests r JOIN listings l ON l.id = r.listing_id`,
    );
    assert.equal(rows.length, 1, `저장된 요청 수: ${JSON.stringify(rows)}`);
    const saved = rows[0];
    assert.equal(saved.listing_id, LISTING_ID);
    assert.equal(saved.title, shownTitle);
    assert.equal(Number(saved.daily_price), shownPrice);
    assert.equal(Number(saved.days), shownDays);
    assert.equal(Number(saved.total_price), shownTotal);
    assert.equal(String(saved.start_date).slice(0, 10), startDate);
    assert.equal(String(saved.end_date).slice(0, 10), endDate);
    assert.equal(saved.status, "pending");

    // API로 다시 읽어도 같은 값
    const apiRequests = await page.evaluate(async () => (await (await fetch("/api/requests")).json()));
    const mine = (apiRequests.requests || apiRequests.sent || apiRequests.mine || []).find?.((r) => r.listingId === "hc-vivaldi-1")
      || Object.values(apiRequests).flat().find((r) => r && r.listingId === "hc-vivaldi-1");
    assert.ok(mine, `GET /api/requests: ${JSON.stringify(apiRequests).slice(0, 300)}`);
    assert.equal(mine.listingTitle, shownTitle);
    assert.equal(mine.dailyPrice, shownPrice);
    assert.equal(mine.totalPrice, shownTotal);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
