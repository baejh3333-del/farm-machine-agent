// QA bug1 회귀: 매물 상세·대여 신청 창이 휴대폰 폭(390px, 527px)에서 가로로 넘치지 않고,
// 제목·체크리스트·날씨 안내·행동 버튼이 창 안에 보이며 이름 있는 버튼으로 눌릴 수 있어야 한다. 데스크톱도 확인한다.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";

async function startStatic() {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw new Error("invalid path");
      const bytes = await readFile(new URL(`../${file}`, import.meta.url));
      res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "text/html");
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function openFirstCheapestDetail(browser, port, width, height) {
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
  await page.locator('header [data-view="browse"]').click();
  await page.locator("#listingSort").selectOption("price");
  await page.locator(".button-card-cta[data-detail]").first().click();
  await page.locator("#detailBackdrop:not([hidden]) .detail-dialog").waitFor();
  return { page, errors };
}

function measure(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector(".detail-dialog");
    const box = dialog.getBoundingClientRect();
    const inside = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.left >= box.left - 1 && r.right <= box.right + 1;
    };
    const actions = [...dialog.querySelectorAll(".detail-actions button")].map((b) => ({
      name: (b.getAttribute("aria-label") || b.textContent).trim(),
      inside: inside(b),
      height: b.getBoundingClientRect().height,
    }));
    return {
      title: document.querySelector("#detailTitle")?.textContent,
      clientWidth: dialog.clientWidth,
      scrollWidth: dialog.scrollWidth,
      docOverflow: document.documentElement.scrollWidth > window.innerWidth,
      titleInside: inside(document.querySelector("#detailTitle")),
      checklistInside: inside(document.querySelector(".detail-checklist")),
      weather: document.querySelector(".detail-copy .weather-detail, .detail-copy [class*='weather']") ? inside(document.querySelector(".detail-copy .weather-detail, .detail-copy [class*='weather']")) : "absent",
      overflowing: [...dialog.querySelectorAll("*")].filter((el) => !inside(el) && el.getClientRects().length).map((el) => el.className || el.tagName).slice(0, 5),
      actions,
    };
  });
}

for (const [width, height] of [[390, 844], [527, 844], [1280, 900]]) {
  test(`bug1: 상세·대여 신청 창이 ${width}px에서 가로로 넘치지 않고 내용과 버튼이 창 안에 보인다`, async () => {
    const server = await startStatic();
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const { page, errors } = await openFirstCheapestDetail(browser, server.address().port, width, height);
      const m = await measure(page);
      assert.ok(m.title, "상세 제목이 있어야 함");
      assert.ok(m.scrollWidth <= m.clientWidth, `가로 넘침: clientWidth ${m.clientWidth} scrollWidth ${m.scrollWidth} (${m.overflowing.join(", ")})`);
      assert.equal(m.docOverflow, false, "문서 전체가 가로로 넘치면 안 됨");
      assert.equal(m.titleInside, true, "제목이 잘리면 안 됨");
      assert.equal(m.checklistInside, true, "체크리스트가 잘리면 안 됨");
      assert.notEqual(m.weather, false, "날씨 안내가 잘리면 안 됨");
      assert.deepEqual(m.overflowing, [], "창 밖으로 나간 요소가 없어야 함");
      assert.ok(m.actions.length >= 2, "찜하기와 신청 버튼이 있어야 함");
      for (const action of m.actions) {
        assert.ok(action.name, "버튼에는 읽을 수 있는 이름이 있어야 함");
        assert.equal(action.inside, true, `버튼 '${action.name}'이 창 안에 있어야 함`);
        assert.ok(action.height >= 44, `버튼 '${action.name}' 터치 높이 ${action.height}px`);
      }
      const primary = page.locator(".detail-actions [data-detail-action], .detail-actions [data-detail-manage]").first();
      await primary.scrollIntoViewIfNeeded();
      assert.equal(await primary.isVisible(), true, "주요 행동 버튼이 보여야 함");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  });
}
