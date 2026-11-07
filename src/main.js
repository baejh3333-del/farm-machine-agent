// 시작점: 모듈을 만들고 서로 연결한 뒤 첫 화면을 그린다.
// 화면별 코드는 각 모듈에 있다.
//   browse.js 매물 찾기 · detail.js 상세 · favorites.js 찜 · trade.js 신청·승인·채팅
//   ai/chat-panel.js 농농이 상담 · login.js 로그인 · navigation.js 화면 전환 · effects.js 연출
//   app-state.js 화면 상태와 매물 목록 · user-store.js 사용자 데이터(서버)
import { initAiPanel } from "./ai/chat-panel.js";
import { app } from "./app.js";
import { allListings, catalogReady, catalogStatus, legacyTradeDataRemoved, listingById, loadCatalog, persist, state } from "./app-state.js";
import {
  bindBrowseEvents, initBrowse, renderCrops, renderListings, renderMachineCategoryBar, renderQuickWizard,
  setTransaction, syncQuickSearchInputs,
} from "./browse.js";
import { available } from "./data/recommendation.js";
import { bindDetailEvents, openDetail } from "./detail.js";
import { initBannerCarousel, initRevealOnScroll, initScrollMotion, trackHeaderHeight } from "./effects.js";
import { bindFavorites, toggleFavorite } from "./favorites.js";
import { createGarage } from "./garage.js";
import { statusClass, statusLabel } from "./listing-view.js";
import { initLoginForm } from "./login.js";
import { bindNavigation, initMainPageScrollSpy, setView } from "./navigation.js";
import { syncServerTime, today } from "./time.js";
import { createTrade } from "./trade.js";
import { $, hideDialog, toast } from "./ui.js";
import { createUserStore } from "./user-store.js";

let accountUser = null;
const store = createUserStore({ notify: (message) => toast(message) });

const trade = createTrade({
  store, listingById, today, available, statusLabel, statusClass,
  ownedListings: () => allListings().filter((item) => item.owner),
  getFilters: () => state.filters,
  requireLogin(message) {
    toast(message);
    for (const id of ["formBackdrop", "detailBackdrop", "filterBackdrop"]) hideDialog($(id));
    app.openLogin();
  },
  onBookingsChanged: () => loadCatalog(),
});

const garage = createGarage({
  root: $("garageView"), storage: store.machineStorage, getListings: allListings, getCatalogState: catalogStatus,
  today, openListing: openDetail, notify: toast,
  openRental(id, start, end) {
    state.filters.date = start;
    state.filters.dateEnd = end;
    persist();
    trade.openRentalForm(id);
  },
});

function updateBadges() {
  const favBadge = $("favNavBadge");
  if (favBadge) {
    favBadge.hidden = store.favorites.length === 0;
    favBadge.textContent = String(store.favorites.length);
  }
  const ownerBadge = $("ownerBadge");
  if (ownerBadge) {
    const pendingCount = accountUser ? trade.pendingForOwner() : 0;
    ownerBadge.hidden = pendingCount === 0;
    ownerBadge.textContent = pendingCount ? String(pendingCount) : "";
  }
}

function renderAll() {
  garage.refresh();
  syncQuickSearchInputs();
  renderCrops();
  renderQuickWizard();
  renderMachineCategoryBar();
  renderListings();
  trade.renderBuyerRequests();
  if (state.view === "owner") trade.renderOwner();
  updateBadges();
}

Object.assign(app, {
  store, trade, garage,
  renderAll, renderListings, updateBadges, setView, openDetail, toggleFavorite,
  isFavorite: (id) => store.favorites.includes(id),
  isLoggedIn: () => Boolean(accountUser),
  accountUser: () => accountUser,
  setAccountUser(user) { accountUser = user; },
  openLogin: () => setView("login"),
  onViewShown(view) {
    if (view === "owner") trade.renderOwner();
    if (view === "requests") trade.renderBuyerRequests();
    if (view === "garage") garage.refresh();
  },
});

// 서버에서 사용자 데이터가 바뀌면 배지·목록을 다시 그린다. 보유 농기계가 바뀌었을 때만 garage를 다시 읽는다.
let shownMachines = JSON.stringify(store.machineStorage.load());
store.subscribe(() => {
  updateBadges();
  trade.renderBuyerRequests();
  if (state.view === "owner") trade.renderOwner();
  const machines = JSON.stringify(store.machineStorage.load());
  if (machines !== shownMachines) {
    shownMachines = machines;
    garage.reload();
  }
});

function bindDialogs() {
  $("closeDetail").addEventListener("click", () => hideDialog($("detailBackdrop")));
  $("closeForm").addEventListener("click", () => hideDialog($("formBackdrop")));
  for (const id of ["detailBackdrop", "formBackdrop"]) {
    $(id).addEventListener("click", (event) => {
      if (event.target === $(id)) hideDialog($(id));
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const open = ["formBackdrop", "detailBackdrop", "filterBackdrop"].map($).find((dialog) => !dialog.hidden);
      if (open) hideDialog(open);
    }
  });
  $("ownerListings").addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-owner-detail]");
    if (detailButton) openDetail(detailButton.dataset.ownerDetail);
  });
}

initBrowse();
bindNavigation();
bindBrowseEvents();
initLoginForm();
bindDialogs();
bindDetailEvents();
initAiPanel();
bindFavorites();
syncServerTime().then(() => { syncQuickSearchInputs(); renderAll(); });
trackHeaderHeight();
$("brandHome")?.addEventListener("click", () => setView("home"));
initBannerCarousel();
initRevealOnScroll();
initScrollMotion();
initMainPageScrollSpy();
setTransaction(state.transaction);
setView("home");
renderAll();
catalogReady();
if (legacyTradeDataRemoved) toast("대여 요청과 채팅은 이제 계정에 저장돼요. 이 브라우저에 남아 있던 예전 시연 기록은 정리했어요.");
