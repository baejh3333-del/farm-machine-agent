// 화면 전환과 상단 메뉴 표시.
import { app } from "./app.js";
import { persist, state } from "./app-state.js";
import { $ } from "./ui.js";

const viewIds = { garage: "garageView", home: "homeView", browse: "browseView", guide: "guideView", requests: "requestsView", owner: "ownerView", ownerLoginRequired: "ownerLoginRequiredView", login: "loginView", about: "aboutView" };
// 홈과 매물 찾기는 한 페이지: 배너(홈) 아래로 스크롤하면 매물 목록(매물 찾기)이 이어진다
const MAIN_PAGE_VIEWS = ["home", "browse"];
let scrollSpyPausedUntil = 0;
function markNav(view) {
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
export function setView(view) {
  if (!Object.hasOwn(viewIds, view)) view = "home";
  if (view === "owner" && !app.isLoggedIn()) view = "ownerLoginRequired";
  state.view = view;
  const onMainPage = MAIN_PAGE_VIEWS.includes(view);
  for (const [name, id] of Object.entries(viewIds)) {
    $(id).hidden = onMainPage ? !MAIN_PAGE_VIEWS.includes(name) : name !== view;
  }
  markNav(view);
  persist();
  app.onViewShown?.(view);
  // 메뉴를 눌러 스크롤하는 동안에는 스크롤 표시가 중간에 바뀌지 않게 잠깐 멈춘다
  scrollSpyPausedUntil = Date.now() + 1000;
  if (view === "browse") $("market").scrollIntoView({ behavior: "smooth" });
  else window.scrollTo({ top: 0 });
}
// 스크롤 위치에 따라 상단 메뉴의 홈/매물 찾기 표시를 바꾼다
export function initMainPageScrollSpy() {
  const banner = $("bannerCarousel");
  const header = document.querySelector(".sidebar");
  if (!banner) return;
  const update = () => {
    if (!MAIN_PAGE_VIEWS.includes(state.view) || Date.now() < scrollSpyPausedUntil) return;
    const headerHeight = header ? header.offsetHeight : 0;
    const passedBanner = banner.getBoundingClientRect().bottom - headerHeight < 120;
    const next = passedBanner ? "browse" : "home";
    if (next !== state.view) {
      state.view = next;
      markNav(next);
    }
  };
  window.addEventListener("scroll", update, { passive: true });
}

export function bindNavigation() {
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
}
