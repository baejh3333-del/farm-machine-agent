import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startStaticServer } from "./helpers/live-voice-page.js";
import { goToMenu } from "./helpers/nav.js";

const SAMPLE_LISTINGS = [
  {
    id: "hc-near-1",
    type: "rent",
    status: "open",
    machineType: "tractor",
    brand: "대동",
    title: "홍천 45마력 트랙터 A",
    region: "서면 팔봉리",
    farmName: "팔봉 해바라기 농가",
    address: "강원특별자치도 홍천군 서면 팔봉리 712",
    lat: 37.6538,
    lng: 127.6942,
    price: 130000,
    cropIds: ["rice", "pepper"],
    operations: ["till"],
    description: "홍천 트랙터 A",
  },
  {
    id: "hc-near-2",
    type: "rent",
    status: "open",
    machineType: "cultivator",
    brand: "아세아",
    title: "홍천 8마력 관리기 B",
    region: "서면 팔봉리",
    farmName: "팔봉 산골 농가",
    address: "강원특별자치도 홍천군 서면 팔봉리 715",
    lat: 37.65405,
    lng: 127.69435,
    price: 45000,
    cropIds: ["pepper", "cabbage"],
    operations: ["till", "ridge"],
    description: "홍천 관리기 B",
  },
  {
    id: "yy-far-1",
    type: "rent",
    status: "open",
    machineType: "cultivator",
    brand: "국제",
    title: "영양 다목적 관리기",
    region: "영양읍",
    farmName: "영양 고추 농가",
    address: "경상북도 영양군 영양읍 동부리 10",
    lat: 36.6667,
    lng: 129.1124,
    price: 55000,
    cropIds: ["pepper"],
    operations: ["ridge"],
    description: "영양 관리기",
  },
];

function installKakaoMapStub() {
  window.kakao = {
    maps: {
      load(cb) {
        cb();
      },
      LatLng: class LatLng {
        constructor(lat, lng) {
          this._lat = Number(lat);
          this._lng = Number(lng);
        }
        getLat() { return this._lat; }
        getLng() { return this._lng; }
      },
      LatLngBounds: class LatLngBounds {
        constructor(sw, ne) {
          this._sw = sw || null;
          this._ne = ne || null;
        }
        extend(pos) {
          const lat = pos.getLat();
          const lng = pos.getLng();
          if (!this._sw) {
            this._sw = new window.kakao.maps.LatLng(lat, lng);
            this._ne = new window.kakao.maps.LatLng(lat, lng);
          } else {
            this._sw = new window.kakao.maps.LatLng(Math.min(this._sw.getLat(), lat), Math.min(this._sw.getLng(), lng));
            this._ne = new window.kakao.maps.LatLng(Math.max(this._ne.getLat(), lat), Math.max(this._ne.getLng(), lng));
          }
        }
        getSouthWest() { return this._sw; }
        getNorthEast() { return this._ne; }
        contain(pos) {
          if (!this._sw || !this._ne) return true;
          return pos.getLat() >= this._sw.getLat()
            && pos.getLat() <= this._ne.getLat()
            && pos.getLng() >= this._sw.getLng()
            && pos.getLng() <= this._ne.getLng();
        }
      },
      Map: class KakaoMap {
        constructor(container, opts = {}) {
          this._container = container;
          this._center = opts.center || new window.kakao.maps.LatLng(37.6538, 127.6942);
          this._level = opts.level || 6;
          this._listeners = new window.Map();
          this._overlayHost = document.createElement("div");
          this._overlayHost.className = "mock-kakao-overlays";
          this._overlayHost.style.cssText = "padding: 120px 40px 40px; display: flex; flex-wrap: wrap; gap: 16px;";
          container.appendChild(this._overlayHost);
        }
        getLevel() { return this._level; }
        setLevel(lv) {
          this._level = lv;
          this._emit("zoom_changed");
          this._emit("idle");
        }
        getCenter() { return this._center; }
        setCenter(pos) {
          this._center = pos;
          this._emit("idle");
        }
        panTo(pos) {
          this._center = pos;
          this._emit("idle");
        }
        setBounds(bounds) {
          if (bounds?.getSouthWest?.() && bounds?.getNorthEast?.()) {
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            this._center = new window.kakao.maps.LatLng(
              (sw.getLat() + ne.getLat()) / 2,
              (sw.getLng() + ne.getLng()) / 2,
            );
          }
          this._level = Math.max(1, this._level - 2);
          this._emit("zoom_changed");
          this._emit("idle");
        }
        getBounds() {
          const widthPx = this._container.clientWidth || 1000;
          const heightPx = this._container.clientHeight || 600;
          const KAKAO_SCALE = { 1: 20, 2: 30, 3: 50, 4: 100, 5: 250, 6: 500, 7: 1000, 8: 2000, 9: 4000, 10: 8000, 11: 16000, 12: 32000 };
          const scaleMeters = KAKAO_SCALE[this._level] || Math.round(250 * Math.pow(2, this._level - 5));
          const metersPerPx = scaleMeters / 70;
          const halfWidthM = (metersPerPx * widthPx) / 2;
          const halfHeightM = (metersPerPx * heightPx) / 2;
          const lat = this._center.getLat();
          const lng = this._center.getLng();
          const dLat = halfHeightM / 111320;
          const dLng = halfWidthM / (111320 * Math.cos((lat * Math.PI) / 180));
          return new window.kakao.maps.LatLngBounds(
            new window.kakao.maps.LatLng(lat - dLat, lng - dLng),
            new window.kakao.maps.LatLng(lat + dLat, lng + dLng),
          );
        }
        _on(type, fn) {
          const list = this._listeners.get(type) || [];
          list.push(fn);
          this._listeners.set(type, list);
        }
        _emit(type) {
          for (const fn of this._listeners.get(type) || []) fn();
        }
      },
      CustomOverlay: class CustomOverlay {
        constructor({ map, content }) {
          this._content = content;
          this._map = null;
          if (map) this.setMap(map);
        }
        setMap(map) {
          if (this._content?.parentNode) this._content.parentNode.removeChild(this._content);
          this._map = map;
          if (map && this._content) map._overlayHost.appendChild(this._content);
        }
      },
      event: {
        addListener(target, type, fn) {
          target?._on?.(type, fn);
        },
      },
    },
  };
}

test("카카오 지도: 25m 축척 경계, 통합 문구 제거, 임대소 마커, AI 패널 유지/명시적 닫기, 에이전트 검색 자동 센터링", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(15000);
    await page.addInitScript(installKakaoMapStub);

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/listings") {
        return route.fulfill({ json: { listings: SAMPLE_LISTINGS } });
      }
      if (url.pathname === "/api/me") {
        return route.fulfill({ json: { user: null } });
      }
      if (url.pathname === "/api/weather") {
        return route.fulfill({
          json: {
            region: "강원특별자치도 홍천군",
            mapConfig: { provider: "kakao", kakaoAppKey: "test-key" },
            weather: { suitability: "good", advice: "작업하기 좋아요", slots: [], workTips: [] },
            forecastDays: [],
          },
        });
      }
      if (url.pathname === "/api/agent") {
        const body = route.request().postDataJSON?.() || {};
        const msg = String(body.message || "");
        if (msg.includes("영양")) {
          return route.fulfill({
            json: {
              mode: "agent",
              reply: "영양 다목적 관리기를 찾았어요.",
              listingIds: ["yy-far-1"],
            },
          });
        }
        return route.fulfill({
          json: {
            mode: "agent",
            reply: "홍천 45마력 트랙터를 찾았어요.",
            listingIds: ["hc-near-1", "hc-near-2"],
          },
        });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto(`http://127.0.0.1:${server.address().port}`);

    // 1. 지도 뷰 진입
    await goToMenu(page, "내 동네 매물 지도");
    await page.locator("#headerMapZoomBadge").waitFor({ state: "visible" });

    // 2. 공공 임대소 마커 문구 확인 ('임대소')
    // 초기 레벨 6에서 전국 공공 임대소가 홍천 인근 viewport 안에 있는지 확인하고, 필요 시 축소해 확인
    for (let i = 0; i < 4; i += 1) {
      const count = await page.locator(".socar-public-office-pin").count();
      if (count > 0) break;
      await page.locator("#headerMapZoomOutBtn").click();
    }
    const officeTexts = await page.locator(".socar-public-office-pin").allTextContents();
    assert.ok(officeTexts.length > 0, "공공 임대소 마커가 지도에 표시되어야 함");
    assert.ok(officeTexts.every((t) => t.trim() === "임대소"), `모든 공공 임대소 마커는 '임대소'여야 함: ${officeTexts}`);

    // 3. 250m 축척 경계 검증: Lv.5(250m)까지 확대 -> 개별 매물, Lv.6(500m)로 축소 -> 그룹화 + '통합' 문구 없음
    for (let i = 0; i < 12; i += 1) {
      const lv = Number(await page.locator("#headerMapCanvas").getAttribute("data-map-level"));
      if (lv === 5) break;
      if (lv > 5) await page.locator("#headerMapZoomInBtn").click();
      else await page.locator("#headerMapZoomOutBtn").click();
    }
    const at250m = await page.evaluate(() => {
      const canvas = document.getElementById("headerMapCanvas");
      return {
        level: canvas.dataset.mapLevel,
        scale: canvas.dataset.mapScaleMeters,
        pins: [...canvas.querySelectorAll(".header-map-price-pin[data-listing-id]")].map((el) => el.dataset.listingId),
        clusters: canvas.querySelectorAll(".header-map-cluster-dot").length,
        badge: document.getElementById("headerMapZoomBadge")?.textContent || "",
      };
    });
    assert.equal(at250m.level, "5");
    assert.equal(at250m.scale, "250");
    assert.equal(at250m.clusters, 0, "250m 축척에서는 클러스터가 생기지 않아야 함");
    assert.ok(at250m.pins.includes("hc-near-1") && at250m.pins.includes("hc-near-2"), "250m 축척에서는 가까운 매물이 개별 핀으로 표시되어야 함");
    assert.doesNotMatch(at250m.badge, /통합/);

    // 한 단계 축소 (Lv.6 / 500m > 250m) -> 가까운 두 매물 그룹화
    await page.locator("#headerMapZoomOutBtn").click();
    const at500m = await page.evaluate(() => {
      const canvas = document.getElementById("headerMapCanvas");
      const dot = canvas.querySelector(".header-map-cluster-dot");
      return {
        level: canvas.dataset.mapLevel,
        scale: canvas.dataset.mapScaleMeters,
        countText: dot?.querySelector(".header-map-cluster-count")?.textContent?.trim() || "",
        subText: dot?.querySelector(".header-map-cluster-sub")?.textContent?.trim() || "",
        aria: dot?.getAttribute("aria-label") || "",
        badge: document.getElementById("headerMapZoomBadge")?.textContent || "",
      };
    });
    assert.equal(at500m.level, "6");
    assert.equal(at500m.scale, "500");
    assert.equal(at500m.countText, "2", "클러스터 숫자가 읽기 쉽게 표시되어야 함");
    assert.equal(at500m.subText, "대", "'대 통합' 대신 '대'로 표시되어야 함");
    assert.doesNotMatch(at500m.aria, /통합/);
    assert.doesNotMatch(at500m.badge, /통합/);

    // 클러스터 시트 열어도 '통합' 문구가 전혀 없어야 함
    await page.locator(".header-map-cluster-dot").first().click();
    await page.locator("#headerMapClusterSheet").waitFor({ state: "visible" });
    const mapTextAndAria = await page.evaluate(() => {
      const root = document.getElementById("mapView");
      const arias = [...root.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label")).join(" ");
      return `${root.textContent} ${arias}`;
    });
    assert.doesNotMatch(mapTextAndAria, /통합/, "지도 클러스터 UI/시트/aria 어디에도 '통합' 문구가 없어야 함");
    await page.locator("#headerMapClusterSheetCloseBtn").click();

    // 4. 지도 사용 중 AI 농농이 패널 열림 및 크기 유지 + 명시적 닫기 유지
    await page.locator("#aiLauncher").click();
    await page.locator("#aiPanel").waitFor({ state: "visible" });
    if (await page.locator("#aiPanel").getAttribute("data-layout-mode") !== "docked") await page.locator("#aiExpand").click();
    await page.waitForTimeout(500);
    const sizeBefore = await page.locator("#aiPanel").boundingBox();
    assert.equal(await page.locator("#aiPanel").getAttribute("data-layout-mode"), "docked");

    // 지도 드래그 시뮬레이션
    const canvasBox = await page.locator("#headerMapCanvas").boundingBox();
    await page.mouse.move(canvasBox.x + 120, canvasBox.y + 180);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 240, canvasBox.y + 220, { steps: 4 });
    await page.mouse.up();

    // 지도 컨트롤 클릭 (축소, 확대, 내 위치 중심, 전체 보기 후 닫기)
    await page.locator("#headerMapZoomOutBtn").click();
    await page.locator("#headerMapZoomInBtn").click();
    await page.locator("#headerMapRecenterBtn").click();
    await page.locator("#headerMapShowAllBtn").click();
    await page.locator("#headerMapClusterSheetCloseBtn").click();

    const sizeAfter = await page.locator("#aiPanel").boundingBox();
    assert.equal(await page.locator("#aiPanel").isHidden(), false, "지도 조작 중 AI 패널이 닫히면 안 됨");
    assert.equal(await page.locator("#aiPanel").getAttribute("data-layout-mode"), "docked");
    assert.ok(Math.abs(sizeAfter.width - sizeBefore.width) < 2, `패널 너비가 유지되어야 함 (${sizeBefore.width} vs ${sizeAfter.width})`);
    assert.ok(Math.abs(sizeAfter.height - sizeBefore.height) < 2, `패널 높이가 유지되어야 함 (${sizeBefore.height} vs ${sizeAfter.height})`);

    // 명시적 닫기(#aiClose 및 Escape)는 정상 동작
    await page.locator("#aiClose").click();
    assert.equal(await page.locator("#aiPanel").isHidden(), true, "#aiClose로 명시적 닫기가 동작해야 함");

    await page.locator("#aiLauncher").click();
    await page.locator("#aiPanel").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#aiPanel").isHidden(), true, "Escape 키로 명시적 닫기가 동작해야 함");

    // 5. 지도가 비활성(홈)일 때 에이전트가 매물을 찾으면 자동으로 지도로 전환·센터링하며 패널과 대화를 유지
    await page.locator("#brandHome").click();
    assert.equal(await page.locator("#mapView").isHidden(), true, "홈에서는 지도가 비활성 상태여야 함");

    await page.locator("#aiLauncher").click();
    await page.locator("#aiPanel").waitFor({ state: "visible" });
    if (await page.locator("#aiPanel").getAttribute("data-layout-mode") !== "docked") await page.locator("#aiExpand").click();
    await page.locator("#aiInput").fill("홍천 트랙터 찾아줘");
    await page.locator('#aiForm button[type="submit"]').click();

    await page.locator(".ai-rec-card").first().waitFor({ state: "visible" });
    await page.waitForFunction(() => document.getElementById("headerMapCanvas")?.dataset.focusedListingId === "hc-near-1");

    const afterFirstSearch = await page.evaluate(() => {
      const canvas = document.getElementById("headerMapCanvas");
      return {
        mapHidden: document.getElementById("mapView").hidden,
        panelHidden: document.getElementById("aiPanel").hidden,
        layoutMode: document.getElementById("aiPanel").dataset.layoutMode,
        focusedId: canvas?.dataset.focusedListingId,
        centerLat: Number(canvas?.dataset.mapCenterLat),
        centerLng: Number(canvas?.dataset.mapCenterLng),
        level: canvas?.dataset.mapLevel,
        floatingCardVisible: !document.getElementById("headerMapFloatingCard").hidden,
        floatingCardText: document.getElementById("headerMapFloatingCard").textContent,
        messagesText: document.getElementById("aiMessages").textContent,
      };
    });
    assert.equal(afterFirstSearch.mapHidden, false, "매물 검색 결과 시 지도가 자동으로 활성화되어야 함");
    assert.equal(afterFirstSearch.panelHidden, false, "지도 자동 전환 시 AI 패널이 열려 있어야 함");
    assert.equal(afterFirstSearch.layoutMode, "docked", "AI 패널 크기가 유지되어야 함");
    assert.equal(afterFirstSearch.focusedId, "hc-near-1");
    assert.ok(Math.abs(afterFirstSearch.centerLat - 37.6538) < 0.001, `lat=${afterFirstSearch.centerLat}`);
    assert.ok(Math.abs(afterFirstSearch.centerLng - 127.6942) < 0.001, `lng=${afterFirstSearch.centerLng}`);
    assert.equal(afterFirstSearch.level, "1");
    assert.equal(afterFirstSearch.floatingCardVisible, true);
    assert.match(afterFirstSearch.floatingCardText, /홍천 45마력 트랙터 A/);
    assert.match(afterFirstSearch.messagesText, /홍천 트랙터 찾아줘/);

    // 지도가 이미 활성일 때도 새 검색 결과로 재센터링 + 이전 대화 유지
    await page.locator("#aiInput").fill("영양 관리기 찾아줘");
    await page.locator('#aiForm button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById("headerMapCanvas")?.dataset.focusedListingId === "yy-far-1");

    const afterSecondSearch = await page.evaluate(() => {
      const canvas = document.getElementById("headerMapCanvas");
      return {
        panelHidden: document.getElementById("aiPanel").hidden,
        layoutMode: document.getElementById("aiPanel").dataset.layoutMode,
        focusedId: canvas?.dataset.focusedListingId,
        centerLat: Number(canvas?.dataset.mapCenterLat),
        centerLng: Number(canvas?.dataset.mapCenterLng),
        messagesText: document.getElementById("aiMessages").textContent,
      };
    });
    assert.equal(afterSecondSearch.panelHidden, false);
    assert.equal(afterSecondSearch.layoutMode, "docked");
    assert.equal(afterSecondSearch.focusedId, "yy-far-1");
    assert.ok(Math.abs(afterSecondSearch.centerLat - 36.6667) < 0.001, `lat=${afterSecondSearch.centerLat}`);
    assert.ok(Math.abs(afterSecondSearch.centerLng - 129.1124) < 0.001, `lng=${afterSecondSearch.centerLng}`);
    assert.match(afterSecondSearch.messagesText, /홍천 트랙터 찾아줘/);
    assert.match(afterSecondSearch.messagesText, /영양 관리기 찾아줘/);

    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("폴백 지도: 25m 축척 경계 일관성, 통합 문구 제거, 에이전트 검색 자동 센터링", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(15000);

    await page.route("**/*kakao*", (route) => route.abort());
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/listings") {
        return route.fulfill({ json: { listings: SAMPLE_LISTINGS } });
      }
      if (url.pathname === "/api/me") {
        return route.fulfill({ json: { user: null } });
      }
      if (url.pathname === "/api/weather") {
        return route.fulfill({
          json: {
            region: "강원특별자치도 홍천군",
            mapConfig: { provider: "unavailable", kakaoAppKey: null },
            weather: { suitability: "good", advice: "좋아요", slots: [], workTips: [] },
            forecastDays: [],
          },
        });
      }
      if (url.pathname === "/api/agent") {
        return route.fulfill({
          json: {
            mode: "agent",
            reply: "영양 다목적 관리기를 찾았어요.",
            listingIds: ["yy-far-1"],
          },
        });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await goToMenu(page, "내 동네 매물 지도");
    await page.locator("#fallbackZoomIn").waitFor({ state: "visible" });

    // 폴백 지도에서도 Lv.5(250m)까지 확대 시 개별 매물, Lv.6(500m)에서 그룹화
    for (let i = 0; i < 8; i += 1) {
      const lv = Number(await page.locator("#headerMapCanvas").getAttribute("data-map-level"));
      if (lv === 5) break;
      if (lv > 5) await page.locator("#fallbackZoomIn").click();
      else await page.locator("#fallbackZoomOut").click();
    }
    const fb250m = await page.evaluate(() => ({
      level: document.getElementById("headerMapCanvas").dataset.mapLevel,
      scale: document.getElementById("headerMapCanvas").dataset.mapScaleMeters,
      clusters: document.querySelectorAll("#headerMapCanvas .header-map-cluster-dot").length,
      pins: document.querySelectorAll("#headerMapCanvas .header-map-price-pin").length,
    }));
    assert.equal(fb250m.level, "5");
    assert.equal(fb250m.scale, "250");
    assert.equal(fb250m.clusters, 0);
    assert.equal(fb250m.pins, 3);

    await page.locator("#fallbackZoomOut").click();
    const fb500m = await page.evaluate(() => {
      const root = document.getElementById("mapView");
      const dot = root.querySelector(".header-map-cluster-dot");
      const arias = [...root.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label")).join(" ");
      return {
        level: document.getElementById("headerMapCanvas").dataset.mapLevel,
        scale: document.getElementById("headerMapCanvas").dataset.mapScaleMeters,
        count: dot?.querySelector(".header-map-cluster-count")?.textContent?.trim() || "",
        sub: dot?.querySelector(".header-map-cluster-sub")?.textContent?.trim() || "",
        allTextAndAria: `${root.textContent} ${arias}`,
      };
    });
    assert.equal(fb500m.level, "6");
    assert.equal(fb500m.scale, "500");
    assert.equal(fb500m.count, "2");
    assert.equal(fb500m.sub, "대");
    assert.doesNotMatch(fb500m.allTextAndAria, /통합/);

    // 홈으로 이동 후 에이전트 검색 -> 폴백 지도 자동 활성화 + 센터링 + 패널/대화 유지
    await page.locator("#brandHome").click();
    await page.locator("#aiLauncher").click();
    await page.locator("#aiPanel").waitFor({ state: "visible" });
    await page.locator("#aiInput").fill("영양 관리기 찾아줘");
    await page.locator('#aiForm button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById("headerMapCanvas")?.dataset.focusedListingId === "yy-far-1");

    const fbCentered = await page.evaluate(() => ({
      mapHidden: document.getElementById("mapView").hidden,
      panelHidden: document.getElementById("aiPanel").hidden,
      centerLat: Number(document.getElementById("headerMapCanvas").dataset.mapCenterLat),
      centerLng: Number(document.getElementById("headerMapCanvas").dataset.mapCenterLng),
      messagesText: document.getElementById("aiMessages").textContent,
    }));
    assert.equal(fbCentered.mapHidden, false);
    assert.equal(fbCentered.panelHidden, false);
    assert.ok(Math.abs(fbCentered.centerLat - 36.6667) < 0.001);
    assert.ok(Math.abs(fbCentered.centerLng - 129.1124) < 0.001);
    assert.match(fbCentered.messagesText, /영양 관리기 찾아줘/);

    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("모바일(320/390px) 및 데스크톱(1280px) 지도 레이아웃: 겹침·가로 넘침 없이 핀/카드/시트/목록 접기 동작", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(15000);
    await page.addInitScript(installKakaoMapStub);

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/listings") return route.fulfill({ json: { listings: SAMPLE_LISTINGS } });
      if (url.pathname === "/api/me") return route.fulfill({ json: { user: null } });
      if (url.pathname === "/api/weather") {
        return route.fulfill({
          json: {
            region: "강원특별자치도 홍천군",
            mapConfig: { provider: "kakao", kakaoAppKey: "test-key" },
            weather: { suitability: "good", advice: "작업하기 좋아요", slots: [], workTips: [] },
            forecastDays: [],
          },
        });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await goToMenu(page, "내 동네 매물 지도");
    await page.locator("#headerMapZoomBadge").waitFor({ state: "visible" });

    const measure = () => page.evaluate(() => {
      const r = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
      };
      const ov = (a, b) => Boolean(a && b && a.w > 0 && b.w > 0 && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y);
      const stage = r("#headerMapStage");
      const list = r("#headerMapList");
      const fTop = r(".header-map-floating-top");
      const zoom = r(".header-map-zoom-controls");
      const card = r("#headerMapFloatingCard");
      return {
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        stage,
        list,
        overlaps: {
          listVsStage: ov(list, stage),
          zoomVsTop: ov(zoom, fTop),
          cardVsTop: ov(card, fTop),
          cardVsZoom: ov(card, zoom),
        },
      };
    });

    // 390px: 지도가 목록 위에 배치되고 겹침·가로 넘침이 없음
    const m390 = await measure();
    assert.equal(m390.overflowX, false, "390px에서 가로 넘침이 없어야 함");
    assert.equal(m390.overlaps.listVsStage, false, "390px에서 목록이 지도를 덮으면 안 됨");
    assert.equal(m390.overlaps.zoomVsTop, false, "390px에서 줌 컨트롤과 상단 버튼이 겹치면 안 됨");
    assert.ok(m390.stage.y < m390.list.y, "390px에서 지도가 목록보다 먼저 보여야 함");

    // 250m 확대 -> 개별 핀 클릭 시 플로팅 카드와 컨트롤이 겹치지 않음
    await page.locator("#headerMapZoomInBtn").click();
    await page.locator(".header-map-price-pin[data-listing-id]").first().click();
    await page.locator("#headerMapFloatingCard").waitFor({ state: "visible" });
    const m390Card = await measure();
    assert.equal(m390Card.overlaps.cardVsTop, false, "390px에서 카드와 상단 버튼이 겹치면 안 됨");
    assert.equal(m390Card.overlaps.cardVsZoom, false, "390px에서 카드와 줌 컨트롤이 겹치면 안 됨");

    // 모바일 목록 접기 시 지도 높이가 커짐
    const stageHeightBefore = m390Card.stage.h;
    await page.locator("#headerMapListToggle").click();
    const stageHeightAfter = await page.locator("#headerMapStage").evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(stageHeightAfter > stageHeightBefore, `목록 접기 후 지도 높이가 커져야 함 (${stageHeightBefore} -> ${stageHeightAfter})`);
    await page.locator("#headerMapListToggle").click();

    // 320px: 카드·전체 시트 가로 넘침 및 겹침 없음
    await page.setViewportSize({ width: 320, height: 568 });
    const m320Card = await measure();
    assert.equal(m320Card.overflowX, false, "320px에서 가로 넘침이 없어야 함");
    assert.equal(m320Card.overlaps.cardVsTop, false, "320px에서 카드와 상단 버튼이 겹치면 안 됨");
    assert.equal(m320Card.overlaps.cardVsZoom, false, "320px에서 카드와 줌 컨트롤이 겹치면 안 됨");

    await page.locator("#headerMapShowAllBtn").click();
    await page.locator("#headerMapClusterSheet").waitFor({ state: "visible" });
    const sheetCheck = await page.evaluate(() => {
      const sheet = document.getElementById("headerMapClusterSheet");
      const item = sheet.querySelector(".header-map-cluster-item");
      return {
        title: sheet.querySelector(".header-map-cluster-sheet-badges strong")?.textContent?.trim() || "",
        itemFits: item ? item.getBoundingClientRect().right <= sheet.getBoundingClientRect().right + 1 : true,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    assert.equal(sheetCheck.title, "전국 전체 매물");
    assert.equal(sheetCheck.itemFits, true, "320px에서 시트 카드가 시트 너비를 넘치면 안 됨");
    assert.equal(sheetCheck.overflowX, false);
    await page.locator("#headerMapClusterSheetCloseBtn").click();

    // 데스크톱(1280px): 목록 접기 시 지도 너비가 실제로 확장됨
    await page.setViewportSize({ width: 1280, height: 900 });
    const deskBefore = await page.locator("#headerMapStage").evaluate((el) => el.getBoundingClientRect().width);
    await page.locator("#headerMapListToggle").click();
    await page.waitForTimeout(450);
    const deskAfter = await page.locator("#headerMapStage").evaluate((el) => el.getBoundingClientRect().width);
    assert.ok(deskAfter > deskBefore + 200, `데스크톱 목록 접기 후 지도 너비가 커져야 함 (${deskBefore} -> ${deskAfter})`);

    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
