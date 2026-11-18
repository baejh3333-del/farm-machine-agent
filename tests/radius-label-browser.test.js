// QA3 회귀: 이동 거리 '전체'는 지역 제한 없이 모든 지역 매물을 보여 주므로, 특정 군 이름("영양군 전체")을 붙이면 안 된다.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";
import { startStaticServer } from "./helpers/live-voice-page.js";

test("QA3: 이동 거리 '전체' 라벨은 지역 이름 없이 중립적이고, 여러 지역 매물을 함께 보여 준다", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const listings = listListings();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(15000);
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path === "/api/listings" ? { listings } : path === "/api/me" ? { user: null } : {} });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('header [data-view="browse"]').click();
    await page.locator("#quickRadiusSelect").selectOption("all");
    const labels = await page.evaluate(() => ({
      quick: document.querySelector('#quickRadiusSelect option[value="all"]').textContent.trim(),
      dialog: document.querySelector('#radiusInput option[value="all"]').textContent.trim(),
    }));
    assert.equal(labels.quick, "전체 거리");
    assert.equal(labels.quick, labels.dialog, "빠른 검색과 상세 필터의 '전체' 라벨이 같아야 함");
    assert.doesNotMatch(labels.quick, /영양|군|시|도/);
    await page.locator('.button-card-cta[data-detail="hc-vivaldi-1"]').waitFor({ state: "attached" });
    const shownRegions = await page.evaluate(() => [...document.querySelectorAll(".button-card-cta[data-detail]")].map((b) => b.dataset.detail));
    assert.ok(shownRegions.includes("hc-vivaldi-1"), "영양군 밖(홍천) 매물도 '전체 거리'에 보인다");
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
