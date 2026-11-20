// QA3 회귀: 지역 제한 없는 '전체' 선택은 특정 군 이름("영양군 전체")을 붙이지 않고, 모든 지역 매물을 함께 보여 줘야 한다.
// 매물 찾기(2.x 디자인)에서는 위치 '현재 위치'가 그 역할을 한다(설명: '전체 지역에서 보여드려요').
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";
import { startStaticServer } from "./helpers/live-voice-page.js";
import { goToMenu } from "./helpers/nav.js";

test("QA3: 매물 찾기의 '전체 지역' 위치 안내는 지역 이름 없이 중립적이고, 여러 지역 매물을 함께 보여 준다", async () => {
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
    await goToMenu(page, "매물 찾기");

    const host = page.locator("#browseDesignHost");
    await host.locator('button[data-field]:has-text("어디서")').click();
    const allOption = host.locator("button", { hasText: "전체 지역에서 보여드려요" }).first();
    await allOption.waitFor({ state: "visible" });
    const optionText = (await allOption.textContent()).replace(/\s+/g, " ").trim();
    assert.doesNotMatch(optionText.replace("현재 위치", ""), /영양|홍천|가평|군|도\b/, `전체 선택 안내에 지역 이름이 붙으면 안 됨: ${optionText}`);
    await allOption.evaluate((el) => el.click()); // 팝업이 떠오르는 애니메이션 중에도 누른다
    await page.keyboard.press("Escape");

    const summary = (await host.locator("text=/전체 지역 · \\d+대 있어요/").first().textContent()).trim();
    assert.match(summary, /^전체 지역 · \d+대 있어요$/, "목록 요약도 지역 이름 없이 '전체 지역'이어야 함");
    // 요약 대수는 영양군 매물만 센 값보다 커야 한다(다른 지역 매물까지 함께 셈)
    const total = Number(summary.match(/(\d+)대/)[1]);
    const yeongyangOnly = listings.filter((item) => item.status === "open" && String(item.pickup || "").includes("영양군")).length;
    assert.ok(total > yeongyangOnly, `전체 지역 ${total}대가 영양군 매물 ${yeongyangOnly}대보다 많아야 함`);

    // 카드는 모델마다 하나씩만 먼저 보여 주므로, 특정 매물 대신 여러 시·군이 섞여 있는지 본다
    const cards = host.locator("article[data-card]");
    await cards.first().waitFor({ state: "visible" });
    const places = new Set(
      (await cards.allTextContents()).map((t) => (t.match(/([가-힣]+[군시])\s/) || [])[1]).filter(Boolean),
    );
    assert.ok(places.size >= 2, `여러 시·군 매물이 함께 보여야 함: ${[...places].join(", ")}`);
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
