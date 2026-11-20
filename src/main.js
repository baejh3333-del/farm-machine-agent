import { createGarage } from "./garage.js";
import { accountRequest, getSocialProviders, signInWithSocial } from "./account.js";
import { CROPS, CROP_OPERATIONS, MACHINE_BY_ID, OPERATION_BY_ID } from "./data/farm-machines.js";
import { KOREA_REGIONS, getRegionCoords, findNearestRegion } from "./data/korea-regions.js";
import { initFontScale } from "./core/a11y.js";
import {
  $, escapeHtml, today, addDays, areaLabel, syncServerTime, toast, showDialog, hideDialog,
  getListingPhotoSrc, hasListingPhoto, machineImage,
} from "./core/utils.js";
import {
  state, runtime, blankFilters, persist, apiFetch, allListings, listingById,
  isLoggedIn, activeFavorites, stopChatPolling, bumpAuthEpoch,
  resetAccountRuntimeState, saveGuestFavorites, readGuestFavorites, clearGuestFavorites,
  DEFAULT_FALLBACK_REGION,
} from "./core/store.js";
import {
  initBannerCarousel, initAutoChoreography, trackHeaderHeight,
} from "./core/motion.js";
import { createCatalogViews } from "./views/catalog.js";
import { createTransactionViews } from "./views/transactions.js";
import { createDealsView } from "./views/deals.js";
import { parseDealsHash, dealsHash } from "./data/deals-model.js";
import { initEducationCertificate, renderEducationCertificate, setEducationCertificateStatus } from "./views/education-cert.js";
import { SETUP_CHANGED_EVENT, initAccountInitialSetup } from "./views/initial-setup.js";
import { createAiPanel } from "./ai/panel.js";
import { createDesignApp } from "./design/app.js?v=20261120-8";
import { createHeaderNav } from "./views/header-nav.js?v=20261120-6";
import { createCartCheckout } from "./views/cart-checkout.js";
import { refreshWeatherAndMapConfig, renderHeaderMapView, focusHeaderMapListing, ensureHongcheonRandomListing } from "./views/map-weather.js?v=20261120-6";

initFontScale();

const appDeps = {
  machineVisual: (...args) => machineVisual(...args),
  listingSummary: (...args) => listingSummary(...args),
  hasListingPhoto,
  renderAll: (...args) => renderAll(...args),
  setView: (...args) => setView(...args),
  toggleFavorite: (...args) => toggleFavorite(...args),
  loadCatalog: (...args) => loadCatalog(...args),
  refreshAuthenticatedData: (...args) => refreshAuthenticatedData(...args),
  savePendingIntentAndRedirectLogin: (...args) => savePendingIntentAndRedirectLogin(...args),
  updateBadges: (...args) => updateBadges(...args),
  openForm: (...args) => txViews.openForm(...args),
  rentalForm: (...args) => txViews.rentalForm(...args),
  chatForm: (...args) => txViews.chatForm(...args),
  addToCart: (...args) => cartCheckout.addToCart(...args),
  openCheckout: (...args) => cartCheckout.openCheckout(...args),
  openDetail: (...args) => catalogViews.openDetail(...args),
  openListingPage: (id) => openListingPage(id),
  renderListings: (...args) => catalogViews.renderListings(...args),
  openDeal: (conversationId) => setView("deals", { conversationId }),
  onConversationRead: (...args) => dealsView.onConversationRead(...args),
};

function getOwnedMachinesSnapshot() {
  if (isLoggedIn()) {
    return {
      owned: Array.isArray(runtime.ownedMachines) ? runtime.ownedMachines : [],
      selectedId: typeof runtime.selectedOwnedMachineId === "string" ? runtime.selectedOwnedMachineId : "",
    };
  }
  try {
    const saved = JSON.parse(localStorage.getItem("moa-owned-machines-v1") || "{}");
    const owned = Array.isArray(saved?.owned) ? saved.owned : [];
    const selectedId = typeof saved?.selectedId === "string" ? saved.selectedId : owned[0]?.id || "";
    return { owned, selectedId };
  } catch {
    return { owned: [], selectedId: "" };
  }
}

const catalogViews = createCatalogViews(appDeps);
const txViews = createTransactionViews(appDeps);
// 홈·매물 찾기·매물 상세는 모아농 2.1·2.2 디자인 화면을 그대로 쓴다
const designApp = createDesignApp({
  setView: (...args) => setView(...args),
  openDetail: (id) => openListingPage(id),
  listingById,
  favorites: () => activeFavorites(),
  isLoggedIn: () => isLoggedIn(),
  isFavorite: (id) => activeFavorites().includes(id),
  toggleFavorite: (id) => toggleFavorite(id),
  rentalForm: (...args) => txViews.rentalForm(...args),
  chatForm: (...args) => txViews.chatForm(...args),
  openNewListing: () => txViews.openNewListing(),
  openMyPage: () => $("myPageButton")?.click(),
  openLogin: () => (isLoggedIn() ? $("myPageButton")?.click() : setView("login")),
  askAi: (prompt) => (prompt ? aiPanel.submitPrompt(prompt) : aiPanel.openAiPanel()),
  openMap: (id) => setView("map", { focusListingId: id }),
  browseType: (type) => { designApp.browseType(type); setView("browse"); },
  goBrowse: () => setView("browse"),
  scrollHome: (section) => designApp.scrollHome(section),
  runDestination: (dest) => headerNav.runDestination(dest),
});

function openListingPage(id) {
  if (!listingById(id)) return;
  setView("detail", { id });
}
const dealsView = createDealsView({
  setView: (...args) => setView(...args),
  refreshAuthenticatedData: (...args) => refreshAuthenticatedData(...args),
  updateBadges: (...args) => updateBadges(...args),
  chatForm: (...args) => txViews.chatForm(...args),
  handleRequestAction: (...args) => txViews.handleRequestAction(...args),
  savePendingIntentAndRedirectLogin: (...args) => savePendingIntentAndRedirectLogin(...args),
  closeForm: () => hideDialog($("formBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); }),
});
const aiPanel = createAiPanel({
  state,
  runtime,
  persist: () => persist(updateBadges),
  allListings,
  listingById,
  loadCatalog: (...args) => loadCatalog(...args),
  openDetail: (...args) => catalogViews.openDetail(...args),
  renderListings: (...args) => catalogViews.renderListings(...args),
  refreshAuthenticatedData: (...args) => refreshAuthenticatedData(...args),
  savePendingIntentAndRedirectLogin: (...args) => savePendingIntentAndRedirectLogin(...args),
  setView: (...args) => setView(...args),
  openNewListing: (...args) => txViews.openNewListing(...args),
  toggleFavorite: (...args) => toggleFavorite(...args),
  isFavorite: (id) => activeFavorites().includes(id),
  openChat: (target) => txViews.chatForm(target),
  openDeal: (conversationId) => setView("deals", conversationId ? { conversationId } : {}),
  focusMapListing: (listingId) => {
    if (!listingId) return;
    if (state.view === "map" && focusHeaderMapListing(listingId)) return;
    setView("map", { preserveAiPanel: true, focusListingId: listingId });
  },
  getOwnedMachines: () => getOwnedMachinesSnapshot(),
});

const headerNav = createHeaderNav({
  setView: (...args) => setView(...args),
  setTransaction: (type) => catalogViews.setTransaction(type),
  openFilters: () => catalogViews.openFilters(),
  openAiPanel: () => aiPanel.openAiPanel(),
  submitAiPrompt: (prompt) => aiPanel.submitPrompt(prompt),
  scrollHome: (section) => designApp.scrollHome(section),
});
const cartCheckout = createCartCheckout({
  setView: (...args) => setView(...args),
});

async function loadCatalog({ quiet = false } = {}) {
  const epoch = runtime.authEpoch;
  try {
    const data = await apiFetch("/api/listings", { timeoutMs: 8000 });
    if (epoch !== runtime.authEpoch) return;
    if (!Array.isArray(data.listings)) throw new Error("잘못된 매물 응답");
    runtime.catalog = data.listings;
    if (!data.listings.length) {
      ensureHongcheonRandomListing({ randomize: false });
    }
    runtime.catalogState = "ready";
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
    if (!quiet) console.error(error);
    if (!Array.isArray(runtime.catalog) || !runtime.catalog.length) {
      ensureHongcheonRandomListing({ randomize: false });
    }
    runtime.catalogState = "error";
  }
  renderAll();
  if (isLoggedIn()) txViews.renderOwner();
}

async function refreshAuthenticatedData({ includeRequests = true, includeConversations = true } = {}) {
  if (!isLoggedIn()) {
    resetAccountRuntimeState();
    renderEducationCertificate();
    runtime.ownedMachines = [];
    runtime.selectedOwnedMachineId = "";
    runtime.garage?.resetToGuest();
    updateBadges();
    renderAll();
    txViews.renderBuyerRequests();
    return;
  }

  const epoch = runtime.authEpoch;
  try {
    const tasks = [apiFetch("/api/me")];
    tasks.push(includeRequests ? apiFetch("/api/requests") : Promise.resolve(null));
    tasks.push(includeConversations ? apiFetch("/api/conversations?mode=list") : Promise.resolve(null));
    const [meData, reqData, convData] = await Promise.all(tasks);
    if (epoch !== runtime.authEpoch) return;

    runtime.serverFavorites = Array.isArray(meData?.favorites) ? meData.favorites : [];
    runtime.ownedMachines = Array.isArray(meData?.ownedMachines) ? meData.ownedMachines : [];
    runtime.selectedOwnedMachineId = typeof meData?.selectedOwnedMachineId === "string" ? meData.selectedOwnedMachineId : "";
    runtime.garage?.setExternalOwned(runtime.ownedMachines, runtime.selectedOwnedMachineId);
    setEducationCertificateStatus(meData?.educationCertificate);
    const freshName = typeof meData?.user?.name === "string" ? meData.user.name : "";
    if (freshName && runtime.accountUser?.id === meData.user.id && runtime.accountUser.name !== freshName) {
      runtime.accountUser = { ...runtime.accountUser, name: freshName };
    }

    if (reqData) {
      runtime.incomingRequests = Array.isArray(reqData.incoming) ? reqData.incoming : [];
      runtime.outgoingRequests = Array.isArray(reqData.outgoing) ? reqData.outgoing : [];
      runtime.approvableRequestCount = Number(reqData.approvableCount) || 0;
    }
    if (convData) {
      runtime.userConversations = Array.isArray(convData.conversations) ? convData.conversations : [];
    }

    txViews.renderGuestImportBanner();
    updateBadges();
    catalogViews.renderListings();
    catalogViews.renderFavoritesView();
    if (state.view === "requests") txViews.renderBuyerRequests();
    if (state.view === "owner") txViews.renderOwner();
    if (state.view === "deals") dealsView.renderList();
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
    if (error?.status !== 401) {
      console.error("authenticated refresh failed", error);
    }
  }
}

function closeAiPanel({ returnFocus = true } = {}) {
  const panel = $("aiPanel");
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  if ($("aiBackdrop")) $("aiBackdrop").hidden = true;
  panel.classList.remove("is-entering");
  document.body.classList.remove("ai-open", "ai-fullscreen", "ai-docked");
  $("aiLauncher")?.setAttribute("aria-expanded", "false");
  if (returnFocus) $("aiLauncher")?.focus({ preventScroll: true });
}

function savePendingIntentAndRedirectLogin(intent, notice = "로그인 후 이어서 진행할 수 있어요.") {
  runtime.pendingIntent = intent;
  closeAiPanel({ returnFocus: false });
  hideDialog($("detailBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
  hideDialog($("formBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
  toast(notice);
  setView("login");
}

function syncFavoriteButtons(id, isFav) {
  const escapedId = CSS.escape(id);
  document.querySelectorAll(`[data-favorite="${escapedId}"], [data-detail-fav="${escapedId}"]`).forEach((button) => {
    button.setAttribute("aria-pressed", String(isFav));
    const label = button.querySelector(".favorite-label");
    if (label) label.textContent = isFav ? "찜한 기계" : "찜하기";
  });
  document.querySelectorAll(`.ai-rec-fav-btn[data-ai-favorite="${escapedId}"]`).forEach((button) => {
    button.setAttribute("aria-pressed", String(isFav));
    button.classList.toggle("is-favorited", isFav);
    button.textContent = isFav ? "❤️ 찜됨" : "🤍 찜";
  });
}

async function toggleFavorite(id, { favorite, fromModal = false } = {}) {
  const currentList = activeFavorites();
  const nextFav = typeof favorite === "boolean" ? favorite : !currentList.includes(id);

  if (!isLoggedIn()) {
    saveGuestFavorites(nextFav ? [...runtime.guestFavorites, id] : runtime.guestFavorites.filter((v) => v !== id));
    syncFavoriteButtons(id, nextFav);
    updateBadges();
    catalogViews.renderFavoritesView();
    toast(nextFav ? "찜한 농기계 목록에 담았습니다." : "찜 목록에서 제외했습니다.");
    return;
  }

  const escapedId = CSS.escape(id);
  const buttons = [...document.querySelectorAll(`[data-favorite="${escapedId}"], [data-detail-fav="${escapedId}"], [data-fav-remove="${escapedId}"], .ai-rec-fav-btn[data-ai-favorite="${escapedId}"]`)];
  buttons.forEach((btn) => { btn.disabled = true; });
  try {
    const res = await apiFetch("/api/me", {
      method: "POST",
      json: { action: "toggleFavorite", listingId: id, favorite: nextFav },
    });
    runtime.serverFavorites = Array.isArray(res?.userData?.favorites) ? res.userData.favorites : [];
    const actualFav = runtime.serverFavorites.includes(id);
    syncFavoriteButtons(id, actualFav);
    updateBadges();
    catalogViews.renderFavoritesView();
    toast(actualFav ? "찜한 농기계 목록에 담았습니다." : "찜 목록에서 제외했습니다.");
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
    if (error?.status === 401) {
      savePendingIntentAndRedirectLogin(null, "세션이 만료되었습니다. 다시 로그인해 주세요.");
      return;
    }
    toast(error?.message || "찜 상태를 변경하지 못했습니다.");
  } finally {
    buttons.forEach((btn) => { btn.disabled = false; });
  }
}

function machineVisual(item) {
  const type = MACHINE_BY_ID[item.machineType];
  const src = getListingPhotoSrc(item);
  return src
    ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.title)} 사진" style="width:100%;height:100%;object-fit:cover">`
    : `<img class="machine-example" src="${machineImage(type)}" alt="${escapeHtml(type?.label || "농기계")} AI 예시 이미지" width="350" height="365" loading="lazy">`;
}

function listingSummary(item) {
  const summary = state.aiSummaries[item.id] || item.summary;
  const cleaned = summary.replace(/권장\s*면적\s*\d[\d,]*~\d[\d,]*㎡\.?/g, "").trim();
  return `${cleaned} (${areaLabel(item.areaMin, item.areaMax)} 권장)`;
}

function updateBadges() {
  const favBadge = $("favNavBadge");
  const favCount = activeFavorites().length;
  if (favBadge) {
    favBadge.hidden = favCount === 0;
    favBadge.textContent = String(favCount);
  }
  const ownerBadge = $("ownerBadge");
  if (ownerBadge) {
    if (!isLoggedIn()) {
      ownerBadge.hidden = true;
      ownerBadge.textContent = "";
    } else {
      ownerBadge.hidden = runtime.approvableRequestCount === 0;
      ownerBadge.textContent = String(runtime.approvableRequestCount);
    }
  }
  const dealsBadge = $("dealsNavBadge");
  const dealsDot = $("dealsNavDot");
  if (dealsBadge || dealsDot) {
    const counts = isLoggedIn() ? dealsView.badgeCounts() : { attention: 0, unread: 0 };
    if (dealsBadge) {
      dealsBadge.hidden = counts.attention === 0;
      dealsBadge.textContent = String(counts.attention);
      dealsBadge.setAttribute("aria-label", `확인 필요 ${counts.attention}건`);
    }
    if (dealsDot) dealsDot.hidden = counts.attention > 0 || counts.unread === 0;
  }
  const myPageDot = $("myPageNotifDot");
  if (myPageDot) {
    const hasPending = favCount > 0 || (isLoggedIn() && runtime.approvableRequestCount > 0);
    myPageDot.hidden = !hasPending;
  }
  cartCheckout.updateCartBadge();
}

const viewIds = {
  favorites: "favoritesView",
  deals: "dealsView",
  dealsLoginRequired: "dealsLoginRequiredView",
  garage: "garageView",
  map: "mapView",
  home: "homeView",
  browse: "browseView",
  detail: "detailView",
  guide: "guideView",
  requests: "requestsView",
  requestsLoginRequired: "requestsLoginRequiredView",
  owner: "ownerView",
  ownerLoginRequired: "ownerLoginRequiredView",
  login: "loginView",
};
const MY_PAGE_VIEWS = new Set([
  "favorites",
  "deals",
  "dealsLoginRequired",
  "requests",
  "requestsLoginRequired",
  "owner",
  "ownerLoginRequired",
]);

// 모아농 2.0: 홈은 예약창·소개만 보여주고, 매물 목록은 '매물 찾기'에서 따로 본다
const MAIN_PAGE_VIEWS = [];
const DESIGN_VIEWS = new Set(["home", "browse", "detail"]);
let scrollSpyPausedUntil = 0;

function markNav(view) {
  for (const button of document.querySelectorAll("[data-view]")) {
    const NAV_GROUP = { map: "browse", guide: "garage", favorites: "owner", deals: "owner", requests: "owner" };
    const active = button.dataset.view === view
      || (button.classList.contains("nav-item") && NAV_GROUP[view] === button.dataset.view)
      || (view === "ownerLoginRequired" && button.dataset.view === "owner")
      || (view === "dealsLoginRequired" && button.dataset.view === "deals")
      || (view === "requestsLoginRequired" && button.dataset.view === "requests");
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const myPageBtn = $("myPageButton");
  if (myPageBtn) {
    myPageBtn.classList.toggle("active", MY_PAGE_VIEWS.has(view));
  }
}

function setView(view, options = {}) {
  headerNav.closeAll();
  if (!options.preserveAiPanel) closeAiPanel({ returnFocus: false });
  if (!Object.hasOwn(viewIds, view)) view = "home";
  if (view === "deals" && !isLoggedIn()) {
    runtime.pendingIntent = { type: "deal", conversationId: options.conversationId || null };
    dealsView.hide();
    view = "dealsLoginRequired";
  }
  if (view === "requests" && !isLoggedIn()) {
    runtime.pendingIntent = { type: "requests" };
    view = "requestsLoginRequired";
  }
  if (view === "owner" && !isLoggedIn()) view = "ownerLoginRequired";
  if (view === "detail" && !listingById(options.id || state.detailId)) view = "browse";
  if (view !== "deals" && view !== "dealsLoginRequired") {
    dealsView.hide();
    if (parseDealsHash(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  }
  state.view = view;
  const onMainPage = MAIN_PAGE_VIEWS.includes(view);
  for (const [name, id] of Object.entries(viewIds)) {
    $(id).hidden = onMainPage ? !MAIN_PAGE_VIEWS.includes(name) : name !== view;
  }
  $("myPageLayout").hidden = !MY_PAGE_VIEWS.has(view);
  markNav(view);
  persist(updateBadges);
  if (view === "favorites") {
    catalogViews.renderFavoritesView();
  }
  if (view === "owner") {
    txViews.renderOwner();
    refreshAuthenticatedData();
  }
  if (view === "requests") {
    txViews.renderBuyerRequests();
    if (isLoggedIn()) refreshAuthenticatedData();
  }
  if (view === "deals") {
    const target = { conversationId: options.conversationId || null, filter: options.filter || null };
    if (!options.fromHistory) {
      const next = dealsHash(target);
      if (location.hash !== next) history.pushState(null, "", next);
    }
    dealsView.show(target);
    if (isLoggedIn()) refreshAuthenticatedData();
  }
  if (view === "garage") runtime.garage?.refresh();
  if (view === "map") {
    runtime.selectedMapListingId = options.focusListingId || "";
    renderHeaderMapView({
      onOpenDetail: (id) => catalogViews.openDetail(id),
      onRent: (id) => txViews.rentalForm(id),
      focusListingId: options.focusListingId || "",
    });
  }
  // 메뉴를 눌러 스크롤하는 동안에는 스크롤 표시가 중간에 바뀌지 않게 잠깐 멈춘다
  scrollSpyPausedUntil = Date.now() + 1000;
  designApp.closePop();
  document.body.classList.toggle("design-page", DESIGN_VIEWS.has(view));
  document.body.dataset.view = view;
  if (view === "browse") designApp.showBrowse();
  if (view === "detail") designApp.showDetail(options.id || state.detailId);
  if (view === "detail" && options.id) state.detailId = options.id;
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

// 스크롤 위치에 따라 상단 메뉴의 홈/매물 찾기 표시를 바꾼다
function initMainPageScrollSpy() {
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


function renderAll() {
  runtime.garage?.refresh();
  catalogViews.syncQuickSearchInputs();
  catalogViews.renderCrops();
  catalogViews.renderQuickWizard();
  catalogViews.renderMachineCategoryBar();
  catalogViews.renderListings();
  catalogViews.renderFavoritesView();
  designApp.refresh();
  txViews.renderBuyerRequests();
  updateBadges();
  if (state.view === "map") {
    renderHeaderMapView({
      onOpenDetail: (id) => catalogViews.openDetail(id),
      onRent: (id) => txViews.rentalForm(id),
    });
  }
  aiPanel.refreshContextBar?.();
}

function bindEvents() {
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  const cropSelect = $("cropSelect");
  cropSelect.add(new Option("전체 작물", "all"));
  for (const { id, name } of CROPS) cropSelect.add(new Option(name, id));
  cropSelect.hidden = true;
  cropSelect.tabIndex = -1;

  const cropDropdown = document.createElement("div");
  cropDropdown.className = "crop-dropdown";
  const cropBtn = document.createElement("button");
  cropBtn.type = "button";
  cropBtn.className = "crop-dropdown-btn";
  cropBtn.id = "cropDropdownBtn";
  cropBtn.setAttribute("aria-haspopup", "listbox");
  cropBtn.setAttribute("aria-expanded", "false");
  const cropBtnLabel = document.createElement("span");
  cropBtnLabel.id = "cropDropdownLabel";
  cropBtnLabel.textContent = "전체 작물";
  const cropBtnCaret = document.createElement("span");
  cropBtnCaret.className = "crop-dropdown-caret";
  cropBtnCaret.setAttribute("aria-hidden", "true");
  cropBtnCaret.textContent = "▾";
  cropBtn.append(cropBtnLabel, cropBtnCaret);

  const cropMenu = document.createElement("div");
  cropMenu.className = "crop-dropdown-menu";
  cropMenu.id = "cropDropdownMenu";
  cropMenu.setAttribute("role", "listbox");
  cropMenu.hidden = true;

  const syncCropDropdown = (val) => {
    const opt = Array.from(cropSelect.options).find((o) => o.value === val) || cropSelect.options[0];
    cropBtnLabel.textContent = opt ? opt.textContent : "전체 작물";
    cropMenu.querySelectorAll(".crop-dropdown-item").forEach((el) => {
      const selected = el.dataset.value === (opt?.value || "all");
      el.classList.toggle("is-selected", selected);
      el.setAttribute("aria-selected", selected ? "true" : "false");
    });
  };

  for (const opt of cropSelect.options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "crop-dropdown-item";
    item.dataset.value = opt.value;
    item.setAttribute("role", "option");
    item.textContent = opt.textContent;
    item.addEventListener("click", () => {
      cropSelect.value = opt.value;
      cropSelect.dispatchEvent(new Event("change", { bubbles: true }));
      cropMenu.hidden = true;
      cropBtn.setAttribute("aria-expanded", "false");
      cropDropdown.classList.remove("is-open");
    });
    cropMenu.append(item);
  }

  cropBtn.addEventListener("click", () => {
    const nextOpen = cropMenu.hidden;
    cropMenu.hidden = !nextOpen;
    cropBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    cropDropdown.classList.toggle("is-open", nextOpen);
  });

  document.addEventListener("click", (event) => {
    if (!cropDropdown.contains(event.target)) {
      cropMenu.hidden = true;
      cropBtn.setAttribute("aria-expanded", "false");
      cropDropdown.classList.remove("is-open");
    }
  });

  cropDropdown.append(cropBtn, cropMenu);
  cropSelect.parentNode.insertBefore(cropDropdown, cropSelect.nextSibling);

  cropSelect.addEventListener("change", () => {
    const chosen = cropSelect.value;
    syncCropDropdown(chosen);
    state.selectedCrop = chosen;
    state.filters.cropIds = chosen === "all" ? [] : [chosen];
    if (chosen !== "all") {
      const operations = CROP_OPERATIONS[chosen] || [];
      state.filters.operations = state.filters.operations.filter((id) => operations.includes(id));
      state.filters.stageIds = state.filters.stageIds.filter((stage) =>
        operations.some((id) => OPERATION_BY_ID[id]?.stage === stage)
      );
    }
    persist(updateBadges);
    renderAll();
  });
  syncCropDropdown(cropSelect.value);
  $("rentTab").addEventListener("click", () => catalogViews.setTransaction("rent"));
  $("saleTab").addEventListener("click", () => catalogViews.setTransaction("sale"));

  state.viewMode = "list";
  $("viewModeList")?.addEventListener("click", () => {
    state.viewMode = "list";
    persist(updateBadges);
    catalogViews.renderListings();
  });
  $("viewModeMap")?.addEventListener("click", () => {
    setView("map");
  });

  const syncRegionSelect = (regionName) => {
    const sel = $("regionSelect");
    if (!sel) return;
    const hasOption = [...sel.options].some((o) => o.value === regionName);
    if (!hasOption) {
      const opt = document.createElement("option");
      opt.value = regionName;
      opt.textContent = regionName;
      sel.append(opt);
    }
    sel.value = regionName;
  };

  const formatRegionLabel = (regionName, userCoords) => {
    const info = getRegionCoords(regionName);
    if (userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lng)) {
      const shortPlace = info?.subRegion || info?.city || regionName;
      return `📍 GPS · ${shortPlace}`;
    }
    if (info?.subRegion) {
      return `📍 ${info.province} ${info.city} · ${info.subRegion}`;
    }
    if (info?.province && info?.city && info.province !== info.city) {
      return `📍 ${info.province} ${info.city}`;
    }
    return `📍 ${regionName}`;
  };

  const updateRegionPickerTrigger = () => {
    const btn = $("regionPickerBtn");
    const label = $("regionPickerLabel");
    const hasGps = Boolean(state.userCoords && Number.isFinite(state.userCoords.lat) && Number.isFinite(state.userCoords.lng));
    if (label) label.textContent = formatRegionLabel(state.region, hasGps ? state.userCoords : null);
    if (btn) btn.classList.toggle("is-gps", hasGps);
    syncRegionSelect(state.region);
  };

  const INITIAL_GPS_SESSION_KEY = "moa-initial-gps-checked";

  const applyRegionSelection = (nextRegion, { coords = null, source = null, notice = "" } = {}) => {
    state.region = nextRegion || DEFAULT_FALLBACK_REGION;
    state.userCoords = coords;
    state.regionSource = source || (coords ? "gps" : "manual");
    runtime.userCoords = coords;
    persist(updateBadges);
    updateRegionPickerTrigger();
    renderAll();
    refreshWeatherAndMapConfig({ onUpdate: () => catalogViews.renderListings() });
    if (notice) toast(notice);
  };

  $("regionSelect")?.addEventListener("change", (event) => {
    const next = event.target.value;
    applyRegionSelection(next, {
      coords: null,
      source: "manual",
      notice: `내 동네가 '${next}'(으)로 설정되었습니다.`,
    });
  });

  // 전국 지역 선택 모달 (GPS + 시/도 -> 시/군/구 -> 읍/면)
  const regionDialog = $("regionPickerDialog");
  const regionPickerBtn = $("regionPickerBtn");
  const provListEl = $("regionProvinceList");
  const cityAreaEl = $("regionCityArea");
  const gpsBtn = $("regionGpsBtn");
  let activeProvince = getRegionCoords(state.region)?.province || KOREA_REGIONS[0].name;
  let activeSubCity = null;

  const closeRegionPicker = () => {
    if (!regionDialog) return;
    hideDialog(regionDialog);
    regionPickerBtn?.setAttribute("aria-expanded", "false");
  };

  const renderCityStep = () => {
    if (!cityAreaEl) return;
    const prov = KOREA_REGIONS.find((p) => p.name === activeProvince) || KOREA_REGIONS[0];
    if (activeSubCity && Array.isArray(activeSubCity.subRegions) && activeSubCity.subRegions.length) {
      const wholeName = `${prov.name} ${activeSubCity.name}`;
      cityAreaEl.innerHTML = `
        <div class="region-step-title">
          <span>3단계 · ${escapeHtml(activeSubCity.name)} 읍·면 선택</span>
          <button type="button" class="region-sub-back" id="regionSubBackBtn">← ${escapeHtml(prov.shortName)} 시/군/구로</button>
        </div>
        <div class="region-cities-grid">
          <button type="button" class="region-city-btn${state.region === wholeName ? " is-selected" : ""}" data-select-region="${escapeHtml(wholeName)}">
            ${escapeHtml(activeSubCity.name)} 전체
          </button>
          ${activeSubCity.subRegions
            .map(
              (sub) => `
            <button type="button" class="region-city-btn${state.region === sub.name ? " is-selected" : ""}" data-select-region="${escapeHtml(sub.name)}">
              ${escapeHtml(sub.name)}
            </button>`
            )
            .join("")}
        </div>
      `;
      $("regionSubBackBtn")?.addEventListener("click", () => {
        activeSubCity = null;
        renderCityStep();
      });
    } else {
      cityAreaEl.innerHTML = `
        <div class="region-step-title">
          <span>2단계 · ${escapeHtml(prov.name)} 시/군/구 선택</span>
        </div>
        <div class="region-cities-grid">
          ${prov.cities
            .map((city) => {
              const fullName = `${prov.name} ${city.name}`;
              const hasSubs = Array.isArray(city.subRegions) && city.subRegions.length > 0;
              const isSelected =
                state.region === fullName ||
                (hasSubs && city.subRegions.some((s) => s.name === state.region));
              return `
                <button
                  type="button"
                  class="region-city-btn${isSelected ? " is-selected" : ""}"
                  data-city-name="${escapeHtml(city.name)}"
                  data-has-subs="${hasSubs ? "1" : "0"}"
                  data-select-region="${escapeHtml(fullName)}"
                >
                  ${escapeHtml(city.name)}${hasSubs ? " ▸" : ""}
                </button>`;
            })
            .join("")}
        </div>
      `;
    }

    cityAreaEl.querySelectorAll("[data-select-region]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.hasSubs === "1") {
          const cityObj = prov.cities.find((c) => c.name === btn.dataset.cityName);
          if (cityObj) {
            activeSubCity = cityObj;
            renderCityStep();
            return;
          }
        }
        const chosen = btn.dataset.selectRegion;
        if (!chosen) return;
        closeRegionPicker();
        applyRegionSelection(chosen, {
          coords: null,
          source: "manual",
          notice: `내 동네가 '${chosen}'(으)로 설정되었습니다.`,
        });
      });
    });
  };

  const renderProvinceStep = () => {
    if (!provListEl) return;
    provListEl.innerHTML = `
      <div class="region-step-title"><span>1단계 · 시/도 선택</span></div>
      ${KOREA_REGIONS.map(
        (p) => `
        <button
          type="button"
          class="region-prov-btn${p.name === activeProvince ? " is-active" : ""}"
          data-province="${escapeHtml(p.name)}"
        >
          <span>${escapeHtml(p.name)}</span>
        </button>`
      ).join("")}
    `;
    provListEl.querySelectorAll("[data-province]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeProvince = btn.dataset.province;
        activeSubCity = null;
        renderProvinceStep();
        renderCityStep();
      });
    });
  };

  const openRegionPicker = () => {
    if (!regionDialog) return;
    const current = getRegionCoords(state.region);
    activeProvince = current?.province || KOREA_REGIONS[0].name;
    activeSubCity = null;
    if (current?.subRegion) {
      const prov = KOREA_REGIONS.find((p) => p.name === activeProvince);
      const city = prov?.cities.find((c) => c.name === current.city);
      if (city?.subRegions?.length) activeSubCity = city;
    }
    renderProvinceStep();
    renderCityStep();
    regionPickerBtn?.setAttribute("aria-expanded", "true");
    showDialog(regionDialog, regionPickerBtn);
  };

  regionPickerBtn?.addEventListener("click", openRegionPicker);
  $("closeRegionPicker")?.addEventListener("click", closeRegionPicker);
  regionDialog?.addEventListener("click", (event) => {
    if (event.target === regionDialog) closeRegionPicker();
  });

  const requestGpsAndApply = ({ silentOnError = false } = {}) =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        if (!silentOnError) toast("이 브라우저에서는 위치(GPS) 기능을 지원하지 않습니다.");
        resolve(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            ...(Number.isFinite(pos.coords.accuracy) ? { accuracy: Math.round(pos.coords.accuracy) } : {}),
            source: "gps",
          };
          const nearest = findNearestRegion(coords.lat, coords.lng);
          const regionName = nearest?.name || state.region || DEFAULT_FALLBACK_REGION;
          try {
            sessionStorage.setItem(INITIAL_GPS_SESSION_KEY, "granted");
          } catch {}
          applyRegionSelection(regionName, {
            coords,
            source: "gps",
            notice: `현재 GPS 위치(${regionName}) 기준으로 설정되었습니다.`,
          });
          resolve(true);
        },
        (err) => {
          try {
            sessionStorage.setItem(INITIAL_GPS_SESSION_KEY, "denied");
          } catch {}
          if (silentOnError) {
            if (state.regionSource === "default") {
              state.region = DEFAULT_FALLBACK_REGION;
              state.userCoords = null;
              runtime.userCoords = null;
              updateRegionPickerTrigger();
              renderAll();
              refreshWeatherAndMapConfig({ onUpdate: () => catalogViews.renderListings() });
            }
          } else if (err?.code === 1) {
            toast("위치 접근 권한이 거부되었습니다. 시/도를 직접 선택해 주세요.");
          } else if (err?.code === 3) {
            toast("위치 확인 시간이 초과되었습니다. 시/도를 직접 선택해 주세요.");
          } else {
            toast("현재 위치를 가져오지 못했습니다. 시/도를 직접 선택해 주세요.");
          }
          resolve(false);
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    });

  gpsBtn?.addEventListener("click", async () => {
    gpsBtn.disabled = true;
    gpsBtn.textContent = "📍 현재 위치 확인 중...";
    const ok = await requestGpsAndApply({ silentOnError: false });
    gpsBtn.disabled = false;
    gpsBtn.textContent = "📍 내 위치로 자동 설정 (GPS)";
    if (ok) closeRegionPicker();
  });

  updateRegionPickerTrigger();

  const maybePromptInitialGps = async () => {
    if (state.regionSource !== "default") return;
    let sessionChecked = "";
    try {
      sessionChecked = sessionStorage.getItem(INITIAL_GPS_SESSION_KEY) || "";
    } catch {}
    if (sessionChecked) return;

    if (navigator.permissions?.query) {
      try {
        const perm = await navigator.permissions.query({ name: "geolocation" });
        if (perm.state === "denied") {
          try {
            sessionStorage.setItem(INITIAL_GPS_SESSION_KEY, "denied");
          } catch {}
          return;
        }
      } catch {}
    }

    await requestGpsAndApply({ silentOnError: true });
  };

  // 상단 빠른 검색바 연동
  $("searchInput").addEventListener("input", () => catalogViews.renderListings());
  $("listingSort").value = state.sort;
  $("listingSort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    persist(updateBadges);
    catalogViews.renderListings();
  });

  // Custom-styled sort menu keeps the original select/change behavior intact.
  const sortSelect = $("listingSort");
  const sortTrigger = $("listingSortTrigger");
  const sortMenu = $("listingSortMenu");
  const sortCurrent = $("listingSortCurrent");
  const sortOptions = [...document.querySelectorAll(".listing-sort-option")];
  const closeSortMenu = () => {
    sortMenu.hidden = true;
    sortTrigger.setAttribute("aria-expanded", "false");
  };
  const syncSortMenu = () => {
    const selected = sortSelect.selectedOptions[0];
    sortCurrent.textContent = selected?.textContent || "최근 점검순";
    sortOptions.forEach((option) => {
      const active = option.dataset.sortValue === sortSelect.value;
      option.setAttribute("aria-selected", String(active));
    });
  };
  syncSortMenu();
  sortTrigger.addEventListener("click", () => {
    const willOpen = sortMenu.hidden;
    sortMenu.hidden = !willOpen;
    sortTrigger.setAttribute("aria-expanded", String(willOpen));
  });
  sortOptions.forEach((option) => {
    option.addEventListener("click", () => {
      sortSelect.value = option.dataset.sortValue;
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
      syncSortMenu();
      closeSortMenu();
      sortTrigger.focus();
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".listing-sort-picker")) closeSortMenu();
  });
  sortTrigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSortMenu();
  });
  sortSelect.addEventListener("change", syncSortMenu);
  $("quickSearchBtn")?.addEventListener("click", () => {
    catalogViews.renderListings();
    setView("browse");
  });
  initLoginForm();
  initEducationCertificate();
  initAccountInitialSetup();
  window.addEventListener(SETUP_CHANGED_EVENT, () => {
    updateBadges();
    renderAll();
  });
  $("quickDateInput")?.addEventListener("change", (event) => {
    state.filters.date = event.target.value;
    if (!state.filters.date || state.filters.dateEnd < state.filters.date) state.filters.dateEnd = state.filters.date ? addDays(state.filters.date, 1) : "";
    persist(updateBadges);
    renderAll();
    refreshWeatherAndMapConfig({ onUpdate: () => catalogViews.renderListings() });
  });
  $("quickDateEndInput")?.addEventListener("change", (event) => {
    const end = event.target.value;
    if (!state.filters.date) state.filters.date = today();
    state.filters.dateEnd = end && end >= state.filters.date ? end : state.filters.date;
    persist(updateBadges);
    renderAll();
  });
  // 날짜 칸 어디를 눌러도 달력이 열리게
  for (const id of ["quickDateInput", "quickDateEndInput"]) {
    $(id)?.closest(".qs-date")?.addEventListener("click", (event) => {
      const input = $(id);
      if (input.disabled) return;
      if (event.target !== input) event.preventDefault();
      try { input.showPicker?.(); } catch { input.focus(); }
    });
  }
  $("clearQuickDate")?.addEventListener("click", () => {
    state.filters.date = "";
    state.filters.dateEnd = "";
    persist(updateBadges);
    renderAll();
    refreshWeatherAndMapConfig({ onUpdate: () => catalogViews.renderListings() });
  });

  // 빠른 검색바 시간 선택 (홈·지도와 동기화)
  const quickTimeBtn = $("quickTimeBtn");
  const quickTimePop = $("quickTimePopover");
  const quickStartSel = $("quickStartTimeSelect");
  const quickEndSel = $("quickEndTimeSelect");
  const quickTimeText = $("quickTimeText");
  if (quickStartSel && quickEndSel) {
    const slots = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
    for (const slot of slots) {
      quickStartSel.add(new Option(slot, slot));
      quickEndSel.add(new Option(slot, slot));
    }
    const syncQuickTimeUi = () => {
      const start = state.filters.startTime || "09:00";
      const end = state.filters.endTime || "18:00";
      quickStartSel.value = start;
      quickEndSel.value = end;
      if (quickTimeText) quickTimeText.textContent = `${start}–${end}`;
    };
    const closeQuickTime = () => {
      if (!quickTimePop || quickTimePop.hidden) return;
      quickTimePop.hidden = true;
      quickTimeBtn?.setAttribute("aria-expanded", "false");
    };
    syncQuickTimeUi();
    quickTimeBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = quickTimePop.hidden;
      if (willOpen) syncQuickTimeUi();
      quickTimePop.hidden = !willOpen;
      quickTimeBtn.setAttribute("aria-expanded", String(willOpen));
    });
    $("quickTimeResetBtn")?.addEventListener("click", () => {
      state.filters.startTime = "09:00";
      state.filters.endTime = "18:00";
      syncQuickTimeUi();
      persist(updateBadges);
      window.dispatchEvent(new CustomEvent("moanong:time-change", {
        detail: { startTime: "09:00", endTime: "18:00", source: "browse" },
      }));
      closeQuickTime();
    });
    $("quickTimeApplyBtn")?.addEventListener("click", () => {
      const start = quickStartSel.value || "09:00";
      const end = quickEndSel.value || "18:00";
      state.filters.startTime = start;
      state.filters.endTime = end;
      syncQuickTimeUi();
      persist(updateBadges);
      window.dispatchEvent(new CustomEvent("moanong:time-change", {
        detail: { startTime: start, endTime: end, source: "browse" },
      }));
      closeQuickTime();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".qs-time-wrap")) closeQuickTime();
    });
    window.addEventListener("moanong:time-change", (event) => {
      const detail = event.detail || {};
      if (detail.startTime) state.filters.startTime = detail.startTime;
      if (detail.endTime) state.filters.endTime = detail.endTime;
      syncQuickTimeUi();
    });
  }
  $("quickRadiusSelect")?.addEventListener("change", (event) => {
    state.filters.radius = event.target.value;
    persist(updateBadges);
    renderAll();
  });

  $("guideResults").addEventListener("click", () => {
    setView("browse");
    $("marketTitle").focus();
  });
  $("openFilters").addEventListener("click", () => catalogViews.openFilters());
  $("inlineResetFilters")?.addEventListener("click", catalogViews.resetAllFilters);

  // 활성 필터 칩 개별 제거
  $("activeFilters").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-remove-group]");
    if (!chip) return;
    const group = chip.dataset.removeGroup;
    const val = chip.dataset.removeVal;
    if (Array.isArray(state.filters[group])) {
      state.filters[group] = state.filters[group].filter((item) => item !== val);
      if (group === "cropIds") state.selectedCrop = state.filters.cropIds[0] || "all";
    } else {
      state.filters[group] = val;
      if (group === "date") state.filters.dateEnd = "";
    }
    persist(updateBadges);
    renderAll();
  });

  // 상세 필터 모달 이벤트
  $("closeFilters").addEventListener("click", () => hideDialog($("filterBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
  $("applyFilters").addEventListener("click", catalogViews.applyFilters);
  $("resetFilters").addEventListener("click", () => {
    runtime.draft = blankFilters();
    catalogViews.renderFilterOptions();
  });

  $("filterBackdrop").addEventListener("change", (event) => {
    const input = event.target.closest("[data-filter-group]");
    if (input) {
      const list = runtime.draft[input.dataset.filterGroup];
      runtime.draft[input.dataset.filterGroup] = input.checked ? [...new Set([...list, input.value])] : list.filter((value) => value !== input.value);
      if (input.dataset.filterGroup === "stageIds") {
        runtime.draft.operations = runtime.draft.operations.filter((id) => !runtime.draft.stageIds.length || runtime.draft.stageIds.includes(OPERATION_BY_ID[id]?.stage));
      }
      catalogViews.renderFilterOptions();
      return;
    }
    catalogViews.renderFilterPreview();
  });

  $("filterBackdrop").addEventListener("click", (event) => {
    const areaPreset = event.target.closest("[data-area-preset]");
    if (areaPreset) {
      runtime.draft.areaPyeong = areaPreset.dataset.areaPreset;
      $("areaInput").value = runtime.draft.areaPyeong;
      catalogViews.renderFilterOptions();
      return;
    }
    const pricePreset = event.target.closest("[data-price-preset]");
    if (pricePreset) {
      runtime.draft.maxPrice = pricePreset.dataset.pricePreset;
      $("maxPrice").value = runtime.draft.maxPrice;
      catalogViews.renderFilterOptions();
      return;
    }
    if (event.target === $("filterBackdrop")) hideDialog($("filterBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
  });

  $("filterBackdrop").addEventListener("input", catalogViews.renderFilterPreview);

  $("closeDetail").addEventListener("click", () => hideDialog($("detailBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
  $("closeForm").addEventListener("click", () => hideDialog($("formBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
  for (const id of ["detailBackdrop", "formBackdrop"]) {
    $(id).addEventListener("click", (event) => {
      if (event.target === $(id)) hideDialog($(id), (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const open = ["checkoutBackdrop", "cartBackdrop", "formBackdrop", "detailBackdrop", "filterBackdrop"].map($).find((dialog) => dialog && !dialog.hidden);
      if (open) hideDialog(open, (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
    }
  });

  $("listingGrid").addEventListener("click", (event) => {
    const cartButton = event.target.closest("[data-add-cart]");
    if (cartButton) return cartCheckout.addToCart(cartButton.dataset.addCart);
    const checkoutButton = event.target.closest("[data-buy-now]");
    if (checkoutButton) return cartCheckout.openCheckout(checkoutButton.dataset.buyNow);
    const detailButton = event.target.closest("[data-detail]");
    if (detailButton) return catalogViews.openDetail(detailButton.dataset.detail);
    const favoriteButton = event.target.closest("[data-favorite]");
    if (favoriteButton) return toggleFavorite(favoriteButton.dataset.favorite);
    if (event.target.closest("[data-reset-all]")) catalogViews.resetAllFilters();
  });

  $("detailContent").addEventListener("click", (event) => {
    const cartBtn = event.target.closest("[data-detail-cart]");
    if (cartBtn) return cartCheckout.addToCart(cartBtn.dataset.detailCart);
    const checkoutBtn = event.target.closest("[data-detail-checkout]");
    if (checkoutBtn) {
      hideDialog($("detailBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
      return cartCheckout.openCheckout(checkoutBtn.dataset.detailCheckout);
    }
    const favBtn = event.target.closest("[data-detail-fav]");
    if (favBtn) return toggleFavorite(favBtn.dataset.detailFav);
    const manageBtn = event.target.closest("[data-detail-manage]");
    if (manageBtn) {
      hideDialog($("detailBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
      setView("owner");
      return;
    }
    const chatBtn = event.target.closest("[data-detail-chat]");
    if (chatBtn) {
      hideDialog($("detailBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
      txViews.chatForm({ listingId: chatBtn.dataset.detailChat });
      return;
    }
    const button = event.target.closest("[data-detail-action]");
    if (!button) return;
    hideDialog($("detailBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
    const item = listingById(button.dataset.detailAction);
    if (!item) return;
    item.type === "rent" ? txViews.rentalForm(item.id) : txViews.chatForm({ listingId: item.id });
  });

  $("newListingButton")?.addEventListener("click", () => txViews.openNewListing());

  $("guestImportBanner")?.addEventListener("click", async (event) => {
    if (event.target.closest("#importGuestDismiss")) {
      runtime.dismissGuestImport = true;
      txViews.renderGuestImportBanner();
      return;
    }
    const confirmBtn = event.target.closest("#importGuestConfirm");
    if (!confirmBtn) return;
    confirmBtn.disabled = true;
    try {
      const gFavs = readGuestFavorites();
      const gOwned = runtime.garage?.getGuestOwned() || [];
      const res = await apiFetch("/api/me", {
        method: "POST",
        json: { action: "importGuest", favorites: gFavs, ownedMachines: gOwned },
      });
      clearGuestFavorites();
      runtime.garage?.clearGuestOwned();
      if (res?.userData) {
        runtime.serverFavorites = Array.isArray(res.userData.favorites) ? res.userData.favorites : [];
        runtime.garage?.setExternalOwned(res.userData.ownedMachines || [], res.userData.selectedOwnedMachineId || "");
      }
      txViews.renderGuestImportBanner();
      updateBadges();
      renderAll();
      toast(`가져오기 완료: 찜 ${res.importedFavorites || 0}건, 보유 기계 ${res.importedMachines || 0}대`);
    } catch (error) {
      toast(error?.message || "임시 항목을 가져오지 못했습니다.");
      confirmBtn.disabled = false;
    }
  });

  $("ownerListings").addEventListener("change", async (event) => {
    const select = event.target.closest("[data-owner-status]");
    if (!select) return;
    const id = select.dataset.ownerStatus;
    const item = listingById(id);
    const prevStatus = item?.status || "open";
    const nextStatus = select.value;
    select.disabled = true;
    try {
      await apiFetch("/api/listings", {
        method: "POST",
        json: { action: "status", id, status: nextStatus },
      });
      await loadCatalog({ quiet: true });
      txViews.renderOwner();
      toast("매물 상태를 변경했습니다.");
    } catch (error) {
      select.value = prevStatus;
      if (error?.status === 401) {
        savePendingIntentAndRedirectLogin(null, "세션이 만료되었습니다. 다시 로그인해 주세요.");
        return;
      }
      toast(error?.message || "매물 상태를 변경하지 못했습니다.");
    } finally {
      select.disabled = false;
    }
  });

  $("ownerListings").addEventListener("click", async (event) => {
    const detailBtn = event.target.closest("[data-owner-detail]");
    if (detailBtn) return catalogViews.openDetail(detailBtn.dataset.ownerDetail);
    const editBtn = event.target.closest("[data-owner-edit]");
    if (editBtn) {
      const target = listingById(editBtn.dataset.ownerEdit);
      if (target) txViews.openEditListing(target);
      return;
    }
    const removeBtn = event.target.closest("[data-owner-remove]");
    if (removeBtn) {
      const id = removeBtn.dataset.ownerRemove;
      removeBtn.disabled = true;
      try {
        await apiFetch("/api/listings", {
          method: "POST",
          json: { action: "remove", id },
        });
        await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData()]);
        txViews.renderOwner();
        toast("매물을 목록에서 숨겼습니다.");
      } catch (error) {
        if (error?.status === 401) {
          savePendingIntentAndRedirectLogin(null, "세션이 만료되었습니다. 다시 로그인해 주세요.");
          return;
        }
        toast(error?.message || "매물을 숨기지 못했습니다.");
        removeBtn.disabled = false;
      }
    }
  });

  const handleRequestsAndChatsClick = (event) => {
    const approveBtn = event.target.closest("[data-req-approve]");
    if (approveBtn) return txViews.handleRequestAction("approve", approveBtn.dataset.reqApprove, approveBtn);
    const rejectBtn = event.target.closest("[data-req-reject]");
    if (rejectBtn) return txViews.handleRequestAction("reject", rejectBtn.dataset.reqReject, rejectBtn);
    const cancelBtn = event.target.closest("[data-req-cancel]");
    if (cancelBtn) return txViews.handleRequestAction("cancel", cancelBtn.dataset.reqCancel, cancelBtn);
    const openDealBtn = event.target.closest("[data-open-deal]");
    if (openDealBtn) return setView("deals", { conversationId: openDealBtn.dataset.openDeal });
    const gotoDealsBtn = event.target.closest("[data-goto-deals]");
    if (gotoDealsBtn) return setView("deals", { filter: gotoDealsBtn.dataset.gotoDeals });
    const openChatBtn = event.target.closest("[data-open-chat]");
    if (openChatBtn) {
      return txViews.chatForm({
        conversationId: openChatBtn.dataset.openChat,
        listingId: openChatBtn.dataset.chatListing || null,
      });
    }
    const openListingChatBtn = event.target.closest("[data-open-chat-listing]");
    if (openListingChatBtn) {
      return txViews.chatForm({ listingId: openListingChatBtn.dataset.openChatListing });
    }
  };

  $("ownerRequests")?.addEventListener("click", handleRequestsAndChatsClick);
  $("ownerConversations")?.addEventListener("click", handleRequestsAndChatsClick);
  $("buyerRequestList")?.addEventListener("click", handleRequestsAndChatsClick);
  $("buyerConversations")?.addEventListener("click", handleRequestsAndChatsClick);


  for (const id of ["filterBackdrop", "detailBackdrop", "formBackdrop", "regionPickerDialog", "cartBackdrop", "checkoutBackdrop"]) {
    const el = $(id);
    if (el) el.style.zIndex = "1300";
  }
  if ($("toast")) $("toast").style.zIndex = "1350";
  $("aiLauncher").addEventListener("click", aiPanel.openAiPanel);
  $("aiExpand").addEventListener("click", aiPanel.toggleAiPanelSize);
  window.visualViewport?.addEventListener("resize", aiPanel.syncAiViewport);
  window.visualViewport?.addEventListener("scroll", aiPanel.syncAiViewport);
  $("aiClose").addEventListener("click", () => closeAiPanel());
  $("aiBackdrop")?.addEventListener("click", () => closeAiPanel({ returnFocus: false }));
  // 농농 상담창 밖의 화면을 누르면 상담창을 자동으로 닫는다
  // (상담창에서 연 매물 상세·필터 창 안을 누를 때는 닫지 않는다)
  document.addEventListener("pointerdown", (event) => {
    if ($("aiPanel").hidden) return;
    if (state.view === "map") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#aiPanel, #aiLauncher, #headerAiOpen, .dialog-backdrop, #toast")) return;
    closeAiPanel({ returnFocus: false });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing && !$("aiPanel").hidden && !document.querySelector(".dialog-backdrop:not([hidden])")) closeAiPanel();
  }, true);
  const aiInput = $("aiInput");
  $("aiForm").addEventListener("submit", aiPanel.sendAiQuestion);
  $("aiReset").addEventListener("click", aiPanel.resetAiPanel);

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    if (button.closest("#aiPanel")) return;
    button.addEventListener("click", () => aiPanel.submitPrompt(button.dataset.prompt));
  });

  $("favoritesList")?.addEventListener("click", (event) => {
    const detailBtn = event.target.closest("[data-favorite-detail]");
    if (detailBtn) return catalogViews.openDetail(detailBtn.dataset.favoriteDetail);
    const removeBtn = event.target.closest("[data-fav-remove]");
    if (removeBtn) return toggleFavorite(removeBtn.dataset.favRemove, { favorite: false });
    if (event.target.closest("[data-favorites-browse]")) setView("browse");
  });

  document.querySelectorAll('[data-action="favorites"]:not([data-view])').forEach((button) => {
    button.addEventListener("click", () => setView("favorites"));
  });

  return { maybePromptInitialGps };
}

// 초기 상태 동기화
if (state.selectedCrop && state.selectedCrop !== "all" && !state.filters.cropIds.length) {
  state.filters.cropIds = [state.selectedCrop];
}
if ($("regionSelect")) {
  if (![...$("regionSelect").options].some((o) => o.value === state.region)) {
    const opt = document.createElement("option");
    opt.value = state.region;
    opt.textContent = state.region;
    $("regionSelect").append(opt);
  }
  $("regionSelect").value = state.region;
}
// 메인 배너: 4초마다 자동으로 다음 장, 멈춤/재생·이전/다음·점 선택

function initLoginForm() {
  const form = $("loginForm");
  const username = $("loginId");
  const password = $("loginPassword");
  const name = $("signupName");
  const confirm = $("signupConfirm");
  const submit = $("loginSubmit");
  const eye = $("loginEye");
  const switchButton = $("switchAccount");
  // 로그인 · 회원가입 탭(모아농 2.3): 지금 모드와 다른 탭을 누르면 전환 버튼을 대신 누른다
  document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const signupNow = !$("signupNameField")?.hidden;
      if ((tab.dataset.authTab === "signup") !== signupNow) switchButton?.click();
    });
  });
  const headerButton = $("loginButton");
  const logout = $("accountLogoutButton");
  let signup = false;

  function showError(message) {
    const error = $("accountError");
    error.textContent = message;
    error.hidden = !message;
  }

  function setMode(nextSignup) {
    signup = nextSignup;
    const label = signup ? "회원가입" : "로그인";
    $("accountHeading").textContent = "모아농 " + label;
    submit.textContent = label;
    switchButton.textContent = signup ? "로그인" : "회원가입";
    $("signupNameField").hidden = $("signupConfirmField").hidden = !signup;
    name.disabled = confirm.disabled = !signup;
    name.required = confirm.required = signup;
    password.minLength = signup ? 8 : 0;
    password.autocomplete = signup ? "new-password" : "current-password";
    password.value = confirm.value = "";
    password.type = "password";
    eye.setAttribute("aria-pressed", "false");
    eye.setAttribute("aria-label", "비밀번호 보기");
    eye.classList.remove("is-showing");
    showError("");
    (signup ? name : username).focus();
  }

  function renderAccount(user) {
    runtime.accountUser = user ?? null;
    const loggedIn = isLoggedIn();
    headerButton.hidden = loggedIn;
    logout.hidden = !loggedIn;
    designApp.refresh();
    updateBadges();
  }

  async function applyAccountTransition(nextUser) {
    const prevId = runtime.accountUser?.id || null;
    const nextId = nextUser?.id || null;
    const changed = prevId !== nextId;
    if (changed) {
      bumpAuthEpoch();
      resetAccountRuntimeState();
    }
    renderAccount(nextUser);
    if (changed) {
      runtime.catalogReady = loadCatalog({ quiet: true });
      await Promise.all([
        runtime.catalogReady,
        refreshAuthenticatedData(),
        nextId ? cartCheckout.syncGuestCartOnLogin() : cartCheckout.loadCart(),
      ]);
    } else if (nextId) {
      await Promise.all([refreshAuthenticatedData(), cartCheckout.loadCart()]);
    } else {
      runtime.garage?.refreshNote?.();
      updateBadges();
      txViews.renderBuyerRequests();
    }
  }

  runtime.onSessionExpiredHandler = () => {
    bumpAuthEpoch();
    resetAccountRuntimeState();
    renderAccount(null);
    cartCheckout.loadCart();
    runtime.garage?.resetToGuest();
    if (state.view === "deals" || state.view === "requests" || state.view === "owner") {
      setView(state.view);
    }
  };

  function resumePendingIntentIfAny() {
    const intent = runtime.pendingIntent;
    runtime.pendingIntent = null;
    if (!intent) return false;
    if (intent.type === "rental") {
      setView("browse");
      txViews.rentalForm(intent.listingId, intent.draftValues || null);
      return true;
    }
    if (intent.type === "chat") {
      txViews.chatForm({
        listingId: intent.listingId,
        conversationId: intent.conversationId,
        draftBody: intent.draftBody || "",
      });
      return true;
    }
    if (intent.type === "deal") {
      setView("deals", intent.conversationId ? { conversationId: intent.conversationId } : {});
      return true;
    }
    if (intent.type === "requests") {
      setView("requests");
      return true;
    }
    if (intent.type === "favorites") {
      setView("favorites");
      return true;
    }
    if (intent.type === "inbound") {
      setView("owner");
      return true;
    }
    if (intent.type === "newListing") {
      setView("owner");
      txViews.openNewListing(intent.draftValues || null);
      return true;
    }
    if (intent.type === "editListing") {
      setView("owner");
      const target = listingById(intent.listingId);
      if (target) txViews.openEditListing(target, intent.draftValues || null);
      return true;
    }
    return false;
  }

  function openLogin() {
    if (isLoggedIn()) return setView("owner");
    setView("login");
    setMode(false);
  }

  headerButton.addEventListener("click", openLogin);
  $("myPageButton").addEventListener("click", () => {
    setView("owner");
    document.querySelector('#myPageMenu [data-view="owner"]')?.focus({ preventScroll: true });
  });
  $("ownerLoginGoButton").addEventListener("click", openLogin);
  $("dealsLoginGoButton")?.addEventListener("click", () => {
    if (runtime.pendingIntent?.type !== "deal") {
      runtime.pendingIntent = { type: "deal", conversationId: null };
    }
    openLogin();
  });
  $("requestsLoginGoButton")?.addEventListener("click", () => {
    runtime.pendingIntent = { type: "requests" };
    openLogin();
  });
  $("favoritesLoginGoButton")?.addEventListener("click", () => {
    runtime.pendingIntent = { type: "favorites" };
    openLogin();
  });
  switchButton.addEventListener("click", () => setMode(!signup));

  eye.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    eye.setAttribute("aria-pressed", String(show));
    eye.setAttribute("aria-label", show ? "비밀번호 숨기기" : "비밀번호 보기");
    eye.classList.toggle("is-showing", show);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    showError("");
    if (signup && !name.value.trim()) {
      showError("이름을 입력해 주세요.");
      name.focus();
      return;
    }
    if (signup && password.value !== confirm.value) {
      showError("비밀번호가 일치하지 않습니다.");
      confirm.focus();
      return;
    }
    submit.disabled = switchButton.disabled = true;
    try {
      const data = { username: username.value.trim(), password: password.value };
      if (signup) data.name = name.value.trim();
      const result = await accountRequest(signup ? "signup" : "login", data);
      await applyAccountTransition(result.user);
      password.value = confirm.value = "";
      if (!resumePendingIntentIfAny()) {
        setView("owner");
      }
    } catch (error) {
      showError(error instanceof TypeError || error instanceof SyntaxError
        ? "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
        : error.message);
    } finally {
      submit.disabled = switchButton.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await accountRequest("logout", {});
      runtime.pendingIntent = null;
      await applyAccountTransition(null);
      setView("home");
      toast("로그아웃되었습니다.");
    } catch {
      toast("로그아웃에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      logout.disabled = false;
    }
  });

  for (const el of document.querySelectorAll("[data-view-target]")) {
    el.addEventListener("click", () => setView(el.dataset.viewTarget));
  }

  function isPlaceholderNickname(value) {
    return typeof value === "string" && /^(카카오회원|네이버회원)_/.test(value);
  }

  function openNicknameModal({ required = false } = {}) {
    if (!isLoggedIn()) return;
    stopChatPolling();
    const currentName = isPlaceholderNickname(runtime.accountUser?.name) ? "" : (runtime.accountUser?.name || "");
    $("formContent").innerHTML = `
      <h2 id="formTitle" style="margin:0 0 8px">${required ? "사이트 닉네임 설정" : "닉네임 변경"}</h2>
      <p style="margin:0 0 14px;color:var(--muted,#555);font-size:0.95rem">
        ${required ? "모아농기계에서 거래·채팅 시 표시될 닉네임을 설정해 주세요." : "다른 사용자에게 표시될 닉네임을 변경할 수 있습니다."}
      </p>
      <form id="nicknameForm" style="display:grid;gap:12px">
        <label for="nicknameInput" style="font-weight:600">닉네임 (1~40자)</label>
        <input id="nicknameInput" class="login-input" type="text" maxlength="40" required value="${escapeHtml(currentName)}" placeholder="예: 영양감자농장" />
        <p id="nicknameError" class="account-error" role="alert" hidden></p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="button button-secondary" id="nicknameCancelBtn">나중에</button>
          <button type="submit" class="button button-primary" id="nicknameSaveBtn">저장하기</button>
        </div>
      </form>
    `;
    showDialog($("formBackdrop"));
    const input = $("nicknameInput");
    const errEl = $("nicknameError");
    const saveBtn = $("nicknameSaveBtn");
    $("nicknameCancelBtn").addEventListener("click", () => hideDialog($("formBackdrop")));
    input.focus();

    $("nicknameForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const nextName = input.value.trim();
      if (!nextName || nextName.length > 40) {
        errEl.textContent = "닉네임을 1~40자로 입력해 주세요.";
        errEl.hidden = false;
        input.focus();
        return;
      }
      saveBtn.disabled = true;
      errEl.hidden = true;
      try {
        const res = await apiFetch("/api/me", { method: "POST", json: { action: "updateNickname", name: nextName } });
        if (res?.user) {
          renderAccount({ ...runtime.accountUser, name: res.user.name });
        }
        hideDialog($("formBackdrop"));
        toast("닉네임이 설정되었습니다.");
        await refreshAuthenticatedData();
      } catch (error) {
        errEl.textContent = error.message || "닉네임을 저장하지 못했습니다.";
        errEl.hidden = false;
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  $("editNicknameButton")?.addEventListener("click", () => openNicknameModal({ required: false }));

  const kakaoBtn = $("kakaoLoginButton");
  const naverBtn = $("naverLoginButton");
  const socialSection = $("socialLoginSection");
  getSocialProviders().then((providers) => {
    if (!socialSection) return;
    const hasKakao = Boolean(providers?.kakao && kakaoBtn);
    const hasNaver = Boolean(providers?.naver && naverBtn);
    if (hasKakao) kakaoBtn.hidden = false;
    if (hasNaver) naverBtn.hidden = false;
    socialSection.hidden = !(hasKakao || hasNaver);
  }).catch(() => {});

  kakaoBtn?.addEventListener("click", async () => {
    showError("");
    kakaoBtn.disabled = true;
    try {
      await signInWithSocial("kakao", window.location.pathname || "/");
    } catch (error) {
      showError(error.message);
      kakaoBtn.disabled = false;
    }
  });

  naverBtn?.addEventListener("click", async () => {
    showError("");
    naverBtn.disabled = true;
    try {
      await signInWithSocial("naver", window.location.pathname || "/");
    } catch (error) {
      showError(error.message);
      naverBtn.disabled = false;
    }
  });

  accountRequest("session")
    .then(async (result) => {
      await applyAccountTransition(result.user);
      if (isLoggedIn() && state.view === "ownerLoginRequired") setView("owner");
      if (isLoggedIn() && (state.view === "deals" || state.view === "dealsLoginRequired")) {
        setView("deals", { ...(parseDealsHash(location.hash) || {}), fromHistory: true });
      }
      if (isLoggedIn() && state.view === "requestsLoginRequired") setView("requests");
      if (isLoggedIn() && isPlaceholderNickname(result.user?.name)) {
        openNicknameModal({ required: true });
      }
    })
    .catch(() => {})
    .finally(() => { submit.disabled = false; });
}

// 도움말 카드 속 바로가기 버튼(data-nav-go) → 머리말 메뉴와 같은 곳으로
document.addEventListener("click", (event) => {
  const go = event.target.closest?.("[data-nav-go]");
  if (go) headerNav.runDestination(go.dataset.navGo);
});

runtime.garage = createGarage({
  root: $("garageView"), getListings: allListings, getCatalogState: () => runtime.catalogState,
  today, openListing: catalogViews.openDetail, notify: toast,
  isAuthenticated: isLoggedIn,
  async onAddMachine(item) {
    const res = await apiFetch("/api/me", { method: "POST", json: { action: "addOwned", ...item } });
    if (res?.userData) {
      runtime.ownedMachines = Array.isArray(res.userData.ownedMachines) ? res.userData.ownedMachines : [];
      runtime.selectedOwnedMachineId = typeof res.userData.selectedOwnedMachineId === "string" ? res.userData.selectedOwnedMachineId : "";
    }
    return res.userData;
  },
  async onSelectMachine(id) {
    const res = await apiFetch("/api/me", { method: "POST", json: { action: "selectOwned", id } });
    if (res?.userData) {
      runtime.ownedMachines = Array.isArray(res.userData.ownedMachines) ? res.userData.ownedMachines : [];
      runtime.selectedOwnedMachineId = typeof res.userData.selectedOwnedMachineId === "string" ? res.userData.selectedOwnedMachineId : "";
    }
    return res.userData;
  },
  async onRemoveMachine(id) {
    const res = await apiFetch("/api/me", { method: "POST", json: { action: "removeOwned", id } });
    if (res?.userData) {
      runtime.ownedMachines = Array.isArray(res.userData.ownedMachines) ? res.userData.ownedMachines : [];
      runtime.selectedOwnedMachineId = typeof res.userData.selectedOwnedMachineId === "string" ? res.userData.selectedOwnedMachineId : "";
    }
    return res.userData;
  },
  openRental(id, start, end) {
    state.filters.date = start;
    state.filters.dateEnd = end;
    persist(updateBadges);
    txViews.rentalForm(id);
  },
});
$("detailContent").addEventListener("click", (event) => {
  if (event.target.closest("[data-open-garage]")) {
    hideDialog($("detailBackdrop"), (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
    setView("garage");
    $("ownedModel").focus();
  }
});
headerNav.bind();
cartCheckout.bind();
const { maybePromptInitialGps } = bindEvents();
syncServerTime().then(() => { catalogViews.syncQuickSearchInputs(); renderAll(); });
trackHeaderHeight();
$("brandHome")?.addEventListener("click", () => setView("home"));
initBannerCarousel(setView);
initAutoChoreography();
initMainPageScrollSpy();
catalogViews.setTransaction(state.transaction);
dealsView.bind();
{
  const initialDeals = parseDealsHash(location.hash);
  if (initialDeals) setView("deals", { ...initialDeals, fromHistory: true });
  else if (new URLSearchParams(location.search).get("view") === "map") setView("map");
  else setView("home");
}
if (state.view === "home") {
  void maybePromptInitialGps();
}
window.addEventListener("popstate", () => {
  const target = parseDealsHash(location.hash);
  if (target) setView("deals", { ...target, fromHistory: true });
  else if (state.view === "deals" || state.view === "dealsLoginRequired") setView("home");
});
// 채팅 밖에서도 확인 필요·안 읽음 배지가 갱신되도록 대화 목록만 주기적으로 조회한다(GET은 읽음 처리하지 않음).
setInterval(() => {
  if (!isLoggedIn() || document.visibilityState !== "visible" || state.view === "deals") return;
  refreshAuthenticatedData({ includeRequests: false, includeConversations: true });
}, 45000);
renderAll();
runtime.catalogReady = loadCatalog();
refreshWeatherAndMapConfig({ onUpdate: () => catalogViews.renderListings() });

