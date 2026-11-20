// QA2 회귀: 홍천 hc-vivaldi-1은 서버 매물(13만원/일 트랙터)이 기준이다. 목록을 새로 받을 때마다 무작위 기종·가격으로
// 바꾸면 화면·예약·저장 값이 서로 달라진다. 제목·ID·가격·대여 합계가 서버 값과 같아야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";
import { runtime } from "../src/core/store.js";
import { ensureHongcheonRandomListing } from "../src/views/map-weather.js";
import { startStaticServer } from "./helpers/live-voice-page.js";
import { openFavoriteDetail, seedGuestFavorites } from "./helpers/nav.js";

const seed = () => listListings().find((item) => item.id === "hc-vivaldi-1");

test("QA2: 서버 목록에 있는 홍천 매물은 몇 번을 다시 불러도 기종·제목·가격이 바뀌지 않는다", () => {
  const authoritative = seed();
  assert.ok(authoritative, "시드에 hc-vivaldi-1이 있어야 함");
  for (let i = 0; i < 20; i += 1) {
    runtime.catalog = listListings();
    const listing = ensureHongcheonRandomListing({ randomize: true });
    const inCatalog = runtime.catalog.find((item) => item.id === "hc-vivaldi-1");
    assert.equal(inCatalog, listing);
    for (const key of ["id", "title", "price", "machineType", "type", "brand", "region", "status"]) {
      assert.equal(listing[key], authoritative[key], `${key} 값이 서버와 달라짐 (${i}회차)`);
    }
    assert.equal(runtime.catalog.length, listListings().length, "매물이 늘거나 줄지 않음");
    assert.ok(Number.isFinite(Number(listing.lat)) && Number.isFinite(Number(listing.lng)), "지도 좌표는 있어야 함");
  }
});

test("QA2: 서버 목록을 못 받았을 때의 대체 매물도 무작위가 아니라 시드와 같은 트랙터·가격이다", () => {
  for (let i = 0; i < 10; i += 1) {
    runtime.catalog = [];
    const fallback = ensureHongcheonRandomListing({ randomize: true });
    assert.equal(fallback.machineType, "tractor");
    assert.equal(fallback.price, seed().price);
  }
});

test("QA2: 상세 화면 가격과 대여 신청 합계가 서버 가격(13만원/일)으로 계산된다", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const listings = listListings();
    const authoritative = listings.find((item) => item.id === "hc-vivaldi-1");
    for (let load = 0; load < 3; load += 1) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({ json: path === "/api/listings" ? { listings } : path === "/api/me" ? { user: null } : {} });
      });
      // 매물 상세(2.x 디자인 화면)는 찜 목록의 '상세 보기'로 연다
      await seedGuestFavorites(page, ["hc-vivaldi-1"]);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await openFavoriteDetail(page, "hc-vivaldi-1");
      const host = page.locator("#detailDesignHost");
      const model = authoritative.model || authoritative.specification?.model;
      const heading = (await host.locator("h1").textContent()).trim();
      assert.ok(heading.includes(model), `상세 제목 '${heading}'에 서버 매물 모델 '${model}'이 있어야 함`);
      // 하루 가격과 요금 계산 줄(1일 가격 × 일수)이 서버 가격 13만원으로 나온다
      await host.locator("text=/^1일 13만원$/").first().waitFor({ state: "attached" });
      const breakdown = (await host.locator("text=/대여료 \\(1일 [\\d,]+만?원 × \\d+일\\)/").first().textContent()).trim();
      const [, unit, days] = breakdown.match(/1일 ([\d,]+만?원) × (\d+)일/);
      assert.equal(unit, "13만원", `대여료 계산 단가: ${breakdown}`);
      const total = (await host.locator("text=/^총 [\\d,]+만?원$/").first().textContent()).trim();
      assert.equal(total, `총 ${13 * Number(days)}만원`, `합계는 13만원 × ${days}일이어야 함`);
      // 대여 신청 폼의 합계는 이 목록 항목의 price × 일수로 계산된다(transactions.js updateEstimate).
      // 로그인이 필요해 폼은 열지 않고, 계산에 쓰이는 화면 목록 항목이 서버 값과 같은지 확인한다.
      const shown = await page.evaluate(async () => {
        const { runtime } = await import("/src/core/store.js");
        const item = runtime.catalog.find((i) => i.id === "hc-vivaldi-1");
        return { title: item.title, price: item.price, machineType: item.machineType, twoDayTotal: item.price * 2 };
      });
      assert.deepEqual(shown, { title: authoritative.title, price: 130000, machineType: "tractor", twoDayTotal: 260000 });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
