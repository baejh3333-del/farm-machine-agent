import { createGarage } from "./garage.js";
import { accountRequest } from "./account.js";
import { CROPS, MACHINE_BY_ID } from "./data/farm-machines.js";
import { initFontScale } from "./core/a11y.js";
import {
  $, escapeHtml, today, syncServerTime, toast, showDialog, hideDialog,
  getListingPhotoSrc, hasListingPhoto, machineImage,
} from "./core/utils.js";
import {
  state, runtime, blankFilters, persist, apiFetch, allListings, listingById,
  isLoggedIn, activeFavorites, stopChatPolling, bumpAuthEpoch,
  resetAccountRuntimeState, saveGuestFavorites,
} from "./core/store.js";
import {
  initBannerCarousel, initRevealOnScroll, trackHeaderHeight, initScrollMotion,
} from "./core/motion.js";
import { createCatalogViews } from "./views/catalog.js";
import { createTransactionViews } from "./views/transactions.js";
import { createAiPanel } from "./ai/panel.js";

initFontScale();

const appDeps = {
  machineVisual: (...args) => machineVisual(...args),
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
  openDetail: (...args) => catalogViews.openDetail(...args),
  renderListings: (...args) => catalogViews.renderListings(...args),
};

const catalogViews = createCatalogViews(appDeps);
const txViews = createTransactionViews(appDeps);
const aiPanel = createAiPanel({
  state,
  runtime,
  persist: () => persist(updateBadges),
  allListings,
  listingById,
  loadCatalog: (...args) => loadCatalog(...args),
  openDetail: (...args) => catalogViews.openDetail(...args),
  renderListings: (...args) => catalogViews.renderListings(...args),
});

async function loadCatalog({ quiet = false } = {}) {
  const epoch = runtime.authEpoch;
  try {
    const data = await apiFetch("/api/listings", { timeoutMs: 8000 });
    if (epoch !== runtime.authEpoch) return;
    if (!Array.isArray(data.listings)) throw new Error("잘못된 매물 응답");
    runtime.catalog = data.listings;
    runtime.catalogState = "ready";
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
    if (!quiet) console.error(error);
    runtime.catalogState = "error";
  }
  renderAll();
  if (isLoggedIn()) txViews.renderOwner();
}

async function refreshAuthenticatedData({ includeRequests = true, includeConversations = true } = {}) {
  if (!isLoggedIn()) {
    resetAccountRuntimeState();
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
    runtime.garage?.setExternalOwned(meData?.ownedMachines || [], meData?.selectedOwnedMachineId || "");

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
    if (state.view === "requests") txViews.renderBuyerRequests();
    if (state.view === "owner") txViews.renderOwner();
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
    if (error?.status !== 401) {
      console.error("authenticated refresh failed", error);
    }
  }
}

function savePendingIntentAndRedirectLogin(intent, notice = "로그인 후 이어서 진행할 수 있어요.") {
  runtime.pendingIntent = intent;
  hideDialog($("detailBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
  hideDialog($("formBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
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
}

async function toggleFavorite(id, { favorite, fromModal = false } = {}) {
  const currentList = activeFavorites();
  const nextFav = typeof favorite === "boolean" ? favorite : !currentList.includes(id);

  if (!isLoggedIn()) {
    saveGuestFavorites(nextFav ? [...guestFavorites, id] : runtime.guestFavorites.filter((v) => v !== id));
    syncFavoriteButtons(id, nextFav);
    updateBadges();
    toast(nextFav ? "찜한 농기계 목록에 담았습니다." : "찜 목록에서 제외했습니다.");
    if (fromModal) catalogViews.openFavoritesModal();
    return;
  }

  const escapedId = CSS.escape(id);
  const buttons = [...document.querySelectorAll(`[data-favorite="${escapedId}"], [data-detail-fav="${escapedId}"], [data-fav-remove="${escapedId}"]`)];
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
    toast(actualFav ? "찜한 농기계 목록에 담았습니다." : "찜 목록에서 제외했습니다.");
    if (fromModal) catalogViews.openFavoritesModal();
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
}

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

function setView(view) {
  if (!Object.hasOwn(viewIds, view)) view = "home";
  if (view === "owner" && !isLoggedIn()) view = "ownerLoginRequired";
  state.view = view;
  const onMainPage = MAIN_PAGE_VIEWS.includes(view);
  for (const [name, id] of Object.entries(viewIds)) {
    $(id).hidden = onMainPage ? !MAIN_PAGE_VIEWS.includes(name) : name !== view;
  }
  markNav(view);
  persist(updateBadges);
  if (view === "owner") {
    txViews.renderOwner();
    refreshAuthenticatedData();
  }
  if (view === "requests") {
    txViews.renderBuyerRequests();
    if (isLoggedIn()) refreshAuthenticatedData();
  }
  if (view === "runtime.garage") runtime.garage?.refresh();
  // 메뉴를 눌러 스크롤하는 동안에는 스크롤 표시가 중간에 바뀌지 않게 잠깐 멈춘다
  scrollSpyPausedUntil = Date.now() + 1000;
  if (view === "browse") $("market").scrollIntoView({ behavior: "smooth" });
  else window.scrollTo({ top: 0 });
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
  txViews.renderBuyerRequests();
  updateBadges();
}

function bindEvents() {
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  const cropSelect = $("cropSelect");
  cropSelect.add(new Option("전체 작물", "all"));
  for (const { id, name, emoji } of CROPS) cropSelect.add(new Option(emoji + " " + name, id));
  cropSelect.addEventListener("change", () => {
    const chosen = cropSelect.value;
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
  $("rentTab").addEventListener("click", () => catalogViews.setTransaction("rent"));
  $("saleTab").addEventListener("click", () => catalogViews.setTransaction("sale"));

  $("regionSelect").addEventListener("change", (event) => {
    state.region = event.target.value;
    persist(updateBadges);
    renderAll();
    toast(`내 동네가 '${state.region}'(으)로 설정되었습니다.`);
  });

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
  $("quickDateInput")?.addEventListener("change", (event) => {
    state.filters.date = event.target.value;
    if (!state.filters.date || state.filters.dateEnd < state.filters.date) state.filters.dateEnd = state.filters.date ? addDays(state.filters.date, 1) : "";
    persist(updateBadges);
    renderAll();
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
  });
  $("quickRadiusSelect")?.addEventListener("change", (event) => {
    state.filters.radius = event.target.value;
    persist(updateBadges);
    renderAll();
  });

  $("guideResults").addEventListener("click", () => {
    setView("browse");
    $("marketTitle").focus();
  });
  $("catalogViews.openFilters").addEventListener("click", () => catalogViews.openFilters());
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
  $("closeFilters").addEventListener("click", () => hideDialog($("filterBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); })));
  $("catalogViews.applyFilters").addEventListener("click", catalogViews.applyFilters);
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
    if (event.target === $("filterBackdrop")) hideDialog($("filterBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
  });

  $("filterBackdrop").addEventListener("input", catalogViews.renderFilterPreview);

  $("closeDetail").addEventListener("click", () => hideDialog($("detailBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); })));
  $("closeForm").addEventListener("click", () => hideDialog($("formBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); })));
  for (const id of ["detailBackdrop", "formBackdrop"]) {
    $(id).addEventListener("click", (event) => {
      if (event.target === $(id)) hideDialog($(id, (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const open = ["formBackdrop", "detailBackdrop", "filterBackdrop"].map($).find((dialog) => !dialog.hidden);
      if (open) hideDialog(open, (b) => { if (b === $("formBackdrop")) stopChatPolling(); });
    }
  });

  $("listingGrid").addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-detail]");
    if (detailButton) return catalogViews.openDetail(detailButton.dataset.detail);
    const favoriteButton = event.target.closest("[data-favorite]");
    if (favoriteButton) return toggleFavorite(favoriteButton.dataset.favorite);
    if (event.target.closest("[data-reset-all]")) catalogViews.resetAllFilters();
  });

  $("detailContent").addEventListener("click", (event) => {
    const favBtn = event.target.closest("[data-detail-fav]");
    if (favBtn) return toggleFavorite(favBtn.dataset.detailFav);
    const manageBtn = event.target.closest("[data-detail-manage]");
    if (manageBtn) {
      hideDialog($("detailBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
      setView("owner");
      return;
    }
    const chatBtn = event.target.closest("[data-detail-chat]");
    if (chatBtn) {
      hideDialog($("detailBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
      txViews.chatForm({ listingId: chatBtn.dataset.detailChat });
      return;
    }
    const button = event.target.closest("[data-detail-action]");
    if (!button) return;
    hideDialog($("detailBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
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


  $("aiLauncher").addEventListener("click", aiPanel.openAiPanel);
  $("aiExpand").addEventListener("click", aiPanel.toggleAiPanelSize);
  window.visualViewport?.addEventListener("resize", aiPanel.syncAiViewport);
  window.visualViewport?.addEventListener("scroll", aiPanel.syncAiViewport);
  const closeAiPanel = ({ returnFocus = true } = {}) => {
    if ($("aiPanel").hidden) return;
    $("aiPanel").hidden = true;
    document.body.classList.remove("ai-open");
    $("aiLauncher").setAttribute("aria-expanded", "false");
    if (returnFocus) $("aiLauncher").focus({ preventScroll: true });
  };
  $("aiClose").addEventListener("click", () => closeAiPanel());
  // 농농 상담창 밖의 화면을 누르면 상담창을 자동으로 닫는다
  // (상담창에서 연 매물 상세·필터 창 안을 누를 때는 닫지 않는다)
  document.addEventListener("pointerdown", (event) => {
    if ($("aiPanel").hidden) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#aiPanel, #aiLauncher, .dialog-backdrop, #toast")) return;
    closeAiPanel({ returnFocus: false });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing && !$("aiPanel").hidden && !document.querySelector(".dialog-backdrop:not([hidden])")) closeAiPanel();
  }, true);
  const aiInput = $("aiInput");
  $("aiForm").addEventListener("submit", aiPanel.sendAiQuestion);
  $("aiReset").addEventListener("click", () => {
    if (recommendationPending) return;
    conversation = undefined;
    $("aiMessages").replaceChildren();
    $("aiStarters").hidden = false;
    aiInput.value = "";
    aiInput.placeholder = aiDefaultPlaceholder;
    aiPanel.appendAiMessage("어떤 작물에 어떤 작업을 하실 건가요? 아는 조건부터 말씀해 주세요.", "assistant");
    $("aiInput").focus();
  });

  document.querySelectorAll("[data-prompt]").forEach((button) =>
    button.addEventListener("click", () => {
      if (recommendationPending) return;
      aiInput.value = button.dataset.prompt;
      $("aiForm").requestSubmit();
    })
  );

  document.querySelector('[data-action="favorites"]').addEventListener("click", catalogViews.openFavoritesModal);
}

// 초기 상태 동기화
if (state.selectedCrop && state.selectedCrop !== "all" && !state.filters.cropIds.length) {
  state.filters.cropIds = [state.selectedCrop];
}
$("regionSelect").value = state.region;
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
    headerButton.textContent = isLoggedIn() ? `${runtime.accountUser.name} · 내 계정` : "로그인";
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
      await Promise.all([runtime.catalogReady, refreshAuthenticatedData()]);
    } else if (nextId) {
      await refreshAuthenticatedData();
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
    runtime.garage?.resetToGuest();
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
  $("ownerLoginGoButton").addEventListener("click", openLogin);
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

  accountRequest("session")
    .then(async (result) => {
      await applyAccountTransition(result.user);
      if (isLoggedIn() && state.view === "ownerLoginRequired") setView("owner");
    })
    .catch(() => {})
    .finally(() => { submit.disabled = false; });
}

runtime.garage = createGarage({
  root: $("garageView"), getListings: allListings, getCatalogState: () => runtime.catalogState,
  today, openListing: catalogViews.openDetail, notify: toast,
  isAuthenticated: isLoggedIn,
  async onAddMachine(item) {
    const res = await apiFetch("/api/me", { method: "POST", json: { action: "addOwned", ...item } });
    return res.userData;
  },
  async onSelectMachine(id) {
    const res = await apiFetch("/api/me", { method: "POST", json: { action: "selectOwned", id } });
    return res.userData;
  },
  async onRemoveMachine(id) {
    const res = await apiFetch("/api/me", { method: "POST", json: { action: "removeOwned", id } });
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
  if (event.target.closest("[data-open-runtime.garage]")) {
    hideDialog($("detailBackdrop", (b) => { if (b === $("formBackdrop")) stopChatPolling(); }));
    setView("runtime.garage");
    $("ownedModel").focus();
  }
});
bindEvents();
syncServerTime().then(() => { catalogViews.syncQuickSearchInputs(); renderAll(); });
trackHeaderHeight();
$("brandHome")?.addEventListener("click", () => setView("home"));
initBannerCarousel(setView);
initRevealOnScroll();
initScrollMotion();
initMainPageScrollSpy();
catalogViews.setTransaction(state.transaction);
setView("home");
renderAll();
runtime.catalogReady = loadCatalog();

