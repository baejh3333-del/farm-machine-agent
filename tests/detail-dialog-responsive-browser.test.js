// QA bug1 회귀: 매물 상세 화면이 휴대폰 폭(390px, 527px)에서 가로로 넘치지 않고,
// 제목·가격·행동 버튼이 화면 안에 보이며 이름 있는 버튼으로 눌릴 수 있어야 한다. 데스크톱도 확인한다.
// 매물 상세는 모아농 2.x 디자인 상세 화면(#detailDesignHost, Shadow DOM)이다. 찜 목록의 '상세 보기'로 연다.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";
import { startStaticServer } from "./helpers/live-voice-page.js";
import { goToMenu, seedGuestFavorites } from "./helpers/nav.js";

const LISTING_ID = "hc-vivaldi-1";

async function openDetail(browser, port, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const listings = listListings();
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/listings" ? { listings } : path === "/api/me" ? { user: null } : {} });
  });
  await seedGuestFavorites(page, [LISTING_ID]);
  await page.goto(`http://127.0.0.1:${port}`);
  await goToMenu(page, "찜 목록");
  await page.locator(`#favoritesView [data-favorite-detail="${LISTING_ID}"].button`).first().click();
  await page.locator("#detailView:not([hidden]) #detailDesignHost h1").waitFor({ state: "attached" });
  await page.waitForTimeout(500);
  return { page, errors };
}

function measure(page) {
  return page.evaluate(() => {
    const root = document.querySelector("#detailDesignHost").shadowRoot;
    const inView = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1;
    };
    const h1 = root.querySelector("h1");
    const price = [...root.querySelectorAll("*")].find((el) => !el.children.length && /^1일 [\d,]+(만)?원$/.test(el.textContent.trim()));
    const actions = [...root.querySelectorAll("button")]
      .filter((b) => b.getClientRects().length && /소유주에게 묻기|찜|농농이에게 묻기/.test(b.textContent))
      .map((b) => ({ name: (b.getAttribute("aria-label") || b.textContent).trim(), inside: inView(b), height: b.getBoundingClientRect().height }));
    return {
      title: h1?.textContent.trim(),
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      titleInside: inView(h1),
      priceInside: inView(price),
      actions,
    };
  });
}

for (const [width, height] of [[390, 844], [527, 844], [1280, 900]]) {
  test(`bug1: 매물 상세 화면이 ${width}px에서 가로로 넘치지 않고 제목·가격·버튼이 화면 안에 보인다`, async () => {
    const server = await startStaticServer();
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const { page, errors } = await openDetail(browser, server.address().port, width, height);
      const m = await measure(page);
      assert.ok(m.title, "상세 제목이 있어야 함");
      assert.ok(m.docOverflow <= 0, `문서가 가로로 ${m.docOverflow}px 넘침`);
      assert.equal(m.titleInside, true, "제목이 화면 밖으로 나가면 안 됨");
      assert.equal(m.priceInside, true, "가격이 화면 밖으로 나가면 안 됨");
      assert.ok(m.actions.length >= 2, `행동 버튼(소유주에게 묻기·찜 등)이 보여야 함: ${JSON.stringify(m.actions)}`);
      for (const action of m.actions) {
        assert.ok(action.name, "버튼에는 읽을 수 있는 이름이 있어야 함");
        assert.equal(action.inside, true, `버튼 '${action.name}'이 화면 안에 있어야 함`);
        assert.ok(action.height >= 40, `버튼 '${action.name}' 터치 높이 ${action.height}px`);
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
