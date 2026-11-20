// 회귀: 매물 찾기 화면(#browseDesignHost)이 모바일(320·390·430px)과 데스크톱(1280px)에서
// 가로 넘침 없이 검색창·날짜 팝오버·탭·첫 매물 카드가 읽기 쉽게 표시되어야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";
import { startStaticServer } from "./helpers/live-voice-page.js";
import { goToMenu } from "./helpers/nav.js";

async function openBrowse(browser, port, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const listings = listListings();
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/listings" ? { listings } : path === "/api/me" ? { user: null } : {} });
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await goToMenu(page, "매물 찾기");
  await page.locator("#browseView:not([hidden]) #browseDesignHost article[data-card]").first().waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  return { page, errors };
}

for (const [width, height] of [[320, 844], [390, 844], [430, 844], [1280, 900]]) {
  test(`매물 찾기 화면이 ${width}px에서 가로 넘침 없이 검색·팝오버·카드가 정상 표시된다`, async () => {
    const server = await startStaticServer();
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const { page, errors } = await openBrowse(browser, server.address().port, width, height);
      const base = await page.evaluate(() => {
        const root = document.querySelector("#browseDesignHost").shadowRoot;
        const vw = window.innerWidth;
        const sb = root.querySelector("[data-search-bar]")?.getBoundingClientRect();
        const card = root.querySelector("article[data-card]")?.getBoundingClientRect();
        return {
          docOverflow: document.documentElement.scrollWidth - vw,
          sbInside: Boolean(sb && sb.left >= -1 && sb.right <= vw + 1),
          cardWidth: card ? card.width : 0,
        };
      });
      assert.ok(base.docOverflow <= 0, `문서가 가로로 ${base.docOverflow}px 넘침`);
      assert.equal(base.sbInside, true, "검색 바가 화면 안에 있어야 함");
      assert.ok(base.cardWidth >= 200, `매물 카드 폭이 너무 좁음: ${base.cardWidth}px`);

      // 날짜 팝오버 열기 및 화면 내 표시 확인
      await page.locator("#browseDesignHost [data-field-start]").click();
      await page.locator("#browseDesignHost [data-pop-date]").waitFor({ state: "visible" });
      const pop = await page.evaluate(() => {
        const root = document.querySelector("#browseDesignHost").shadowRoot;
        const vw = window.innerWidth;
        const r = root.querySelector("[data-pop-date]")?.getBoundingClientRect();
        return {
          docOverflow: document.documentElement.scrollWidth - vw,
          inside: Boolean(r && r.left >= -1 && r.right <= vw + 1 && r.width > 0),
        };
      });
      assert.ok(pop.docOverflow <= 0, `날짜 팝오버 열린 상태에서 가로로 ${pop.docOverflow}px 넘침`);
      assert.equal(pop.inside, true, "날짜 팝오버가 화면 안에 있어야 함");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
