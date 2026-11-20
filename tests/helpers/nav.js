// 화면 테스트용 메뉴 이동 도우미.
// 홈·매물 찾기·상세는 디자인 화면(Shadow DOM 안 머리말)이라 기존 헤더(.sidebar)가 숨겨진다.
// 지금 보이는 머리말이 어느 쪽이든 실제 사용자처럼 상위 메뉴를 열고 세부 항목을 누른다.

// 세부 항목 이름 → 상위 메뉴 이름 (src/design/menu.js MENU와 같다)
const GROUP_OF = {
  "매물 찾기": "매물 찾기",
  "내 동네 매물 지도": "매물 찾기",
  "빠른 예약 검색": "매물 찾기",
  "내 농기계·호환 확인": "농기계 호환",
  "작물별 작업 가이드": "농기계 호환",
  "내 기계 관리": "기계 관리",
  "거래 관리": "기계 관리",
  "내 대여 요청": "기계 관리",
  "찜 목록": "기계 관리",
};

// 세부 항목 이름 → 기존 헤더의 data-view / data-nav-dest
const LEGACY = {
  "매물 찾기": ["browse", "browse"],
  "내 동네 매물 지도": ["map", "map"],
  "빠른 예약 검색": ["browse", "home-booking"],
  "내 농기계·호환 확인": ["garage", "garage"],
  "작물별 작업 가이드": ["garage", "guide"],
  "내 기계 관리": ["owner", "owner"],
  "거래 관리": ["owner", "deals"],
  "내 대여 요청": ["owner", "requests"],
  "찜 목록": ["owner", "favorites"],
};

const VISIBLE_DESIGN_HOST = ".design-view:not([hidden]) [id$='DesignHost']";

export async function designHeaderVisible(page) {
  return page.evaluate(() => document.body.classList.contains("design-page"));
}

/** 지금 보이는 머리말에서 세부 메뉴 항목(예: "찜 목록")을 눌러 그 화면으로 간다. */
export async function goToMenu(page, label) {
  const group = GROUP_OF[label];
  if (!group) throw new Error(`알 수 없는 메뉴: ${label}`);
  await settle(page);
  if (await designHeaderVisible(page)) {
    const host = page.locator(VISIBLE_DESIGN_HOST);
    const trigger = host.locator('nav[aria-label="주 메뉴"] a', { hasText: group }).first();
    await trigger.click();
    const item = host.locator("[data-mega-item]", { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
    await item.waitFor({ state: "visible" });
    await item.evaluate((el) => el.click());
  } else {
    // 기존 헤더: 상위 메뉴를 누르면 그 화면으로 바로 가므로, 마우스를 올려 세부 메뉴를 연다.
    const [view, dest] = LEGACY[label];
    await page.locator(`.sidebar-nav [data-view="${view}"]`).hover();
    await page.locator(`#headerFeatures [data-nav-dest="${dest}"]`).click();
  }
  await settle(page);
}

// 화면 전환 직후에는 이전 화면과 새 화면이 잠깐 같이 보일 수 있어, 보이는 화면이 하나로 정해질 때까지 기다린다.
async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll(".design-view:not([hidden])").length <= 1);
  await page.waitForTimeout(250);
}

/** 지금 보이는 머리말의 오른쪽 '로그인'/'마이페이지' 버튼을 누른다. */
export async function clickAuthButton(page) {
  if (await designHeaderVisible(page)) {
    await page
      .locator(`${VISIBLE_DESIGN_HOST} header a`, { hasText: /^\s*(로그인|마이페이지)\s*$/ })
      .first()
      .click();
    return;
  }
  const login = page.locator("#loginButton");
  if (await login.isVisible()) await login.click();
  else await page.locator("#myPageButton").click();
}

/** 디자인 매물 찾기 화면에서 제목이 들어간 카드를 눌러 디자인 상세 화면을 연다. */
export async function openDesignDetailByText(page, text) {
  if (!(await page.locator("#browseView:not([hidden])").count())) await goToMenu(page, "매물 찾기");
  const card = page.locator("#browseDesignHost article[data-card]", { hasText: text }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.locator("#detailView:not([hidden]) #detailDesignHost h1").waitFor({ state: "visible" });
}
