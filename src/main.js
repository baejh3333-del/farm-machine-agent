import { MACHINE_SPECIFICATIONS, SPEC_BY_ID } from "./data/machine-specifications.js";
import { createGarage } from "./garage.js";
let garage;
import { accountRequest } from "./account.js";
import { CROPS, STAGES, OPERATIONS, MACHINE_TYPES, CROP_OPERATIONS, CROP_BY_ID, OPERATION_BY_ID, MACHINE_BY_ID, distanceKm } from "./data/farm-machines.js";
import { askRecommendation } from "./ai/recommend-agent.js";
import { conversationTurn, unrelatedTurn } from "./ai/conversation.js";
import { available, compareListings, recommendationGuide, selectMatchingListings } from "./data/recommendation.js";

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const money = (value) => `${Number(value).toLocaleString("ko-KR")}원`;
const toPyeong = (sqm) => Math.max(1, Math.round(Number(sqm) / 3.305785));
const areaLabel = (minSqm, maxSqm) => `약 ${toPyeong(minSqm).toLocaleString()}~${toPyeong(maxSqm).toLocaleString()}평`;
const areaFullLabel = (minSqm, maxSqm) =>
  `약 ${toPyeong(minSqm).toLocaleString()}~${toPyeong(maxSqm).toLocaleString()}평 (${Number(minSqm).toLocaleString()}~${Number(maxSqm).toLocaleString()}㎡)`;
// 웹서버 시간과 내 기기 시간의 차이 (서버 응답의 Date 헤더로 맞춘다)
let serverTimeOffset = 0;
const serverNow = () => new Date(Date.now() + serverTimeOffset);
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(serverNow());
const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const koreanDateParts = (isoDate) => {
  const d = new Date(`${isoDate}T12:00:00+09:00`);
  const fmt = (opts) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...opts }).format(d);
  return { date: fmt({ year: "numeric", month: "long", day: "numeric" }), weekday: fmt({ weekday: "long" }) };
};
async function syncServerTime() {
  try {
    const response = await fetch(location.pathname || "/", { method: "HEAD", cache: "no-store" });
    const header = response.headers.get("date");
    if (header) serverTimeOffset = new Date(header).getTime() - Date.now();
  } catch {
    // 서버 시간을 못 받으면 기기 시간을 그대로 쓴다
  }
}

const BEGINNER_TIPS = {
  pepper: {
    default: "고추 농사는 봄철 밭 갈기와 두둑 만들기·비닐 멀칭이 핵심이에요. 작업 면적과 필요한 부착기를 확인한 뒤 관리기와 휴립·멀칭기를 비교해 보세요.",
    till: "흙갈이(로터리) 작업은 땅을 부드럽게 부수어 뿌리가 잘 내리게 해줘요. 작은 밭은 관리기, 넓은 밭은 트랙터를 선택하세요.",
    ridge: "고추는 물빠짐이 중요해 높은 두둑을 만들어야 해요. 두둑성형기가 달린 관리기는 두둑 폭과 작업기 규격을 확인해 보세요.",
    mulch: "비닐 씌우기(멀칭)는 잡초를 막고 땅 온도를 유지해 줘요. 휴립·멀칭기를 쓰면 두둑과 비닐 피복을 한 번에 할 수 있어요.",
    transplant: "모종 심기(정식)는 정식기를 사용하면 허리를 굽히지 않고 일정한 간격으로 빠르게 심을 수 있어요.",
    spray: "고추 탄저병·진딧물 예방을 위해 주기적인 방제가 필수예요. 동력분무기나 방제기를 대여해 시간을 아껴보세요.",
  },
  rice: {
    default: "벼농사는 봄철 논 고르기·모내기(이앙)와 가을 콤바인 수확이 가장 큰일이에요. 고가 장비는 필요한 날만 대여해 보세요.",
    level: "모내기 전 논바닥을 평평하게 고르는 작업이에요. 트랙터 로터리·써레 작업기를 확인하세요.",
    ricePlant: "이앙기는 논에 모를 옮겨 심는 데 쓰입니다. 조수(줄 수)와 승용/보행 여부를 확인하세요.",
    riceHarvest: "콤바인은 벼를 베고 탈곡하는 장비입니다. 작업 기간과 논 진입 조건을 확인하세요.",
  },
  cabbage: {
    default: "배추는 초기 두둑 만들기, 비닐 멀칭, 모종 정식과 수확 후 운반 작업에 농기계를 쓰면 노동력을 크게 줄일 수 있어요.",
    mulch: "배추밭도 비닐 멀칭을 해두면 풀 뽑는 수고와 물 주기가 훨씬 수월해집니다.",
    transplant: "배추 모종을 일정한 간격으로 빠르게 심을 수 있는 정식기를 추천해요.",
    transport: "무거운 배추 망을 밭에서 옮길 때는 농용 운반차가 있으면 허리 부담 없이 안전하게 실어 나를 수 있어요.",
  },
  potato: {
    default: "감자는 파종부터 북주기, 땅속 감자를 캐내는 굴취 작업까지 전용 작업기를 쓰면 손상이 적고 수확이 정말 빨라져요.",
    seed: "씨감자 파종기를 쓰면 일정한 깊이와 간격으로 빠르게 심을 수 있어요.",
    hill: "감자가 자랄 때 흙을 덮어주는 북주기를 해주면 감자가 푸르게 변하는 것을 막고 수확량이 늘어납니다.",
    potatoHarvest: "감자 굴취기는 땅속 감자를 들어 올리는 작업기입니다. 두둑 폭과 부착 방식을 확인하세요.",
  },
  all: {
    default: "키우는 작물(고추·벼·배추·감자)을 먼저 누르면, 해당 작물의 작업과 관련 농기계를 찾아볼 수 있어요.",
  },
};

const blankFilters = () => ({
  cropIds: [],
  stageIds: [],
  operations: [],
  machineTypes: [],
  brands: [],
  conditions: [],
  minPrice: "",
  maxPrice: "",
  areaPyeong: "",
  radius: "all",
  date: "",
  dateEnd: "",
});

const UI_PREFS_KEY = "moa-farm-v1";
const GUEST_FAV_KEY = "moa-guest-favorites-v1";

const defaults = {
  view: "home",
  transaction: "rent",
  region: "영양읍",
  sort: "distance",
  selectedCrop: "all",
  filters: blankFilters(),
  aiSummaries: {},
};

let state;
try {
  const saved = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "{}");
  state = {
    view: typeof saved.view === "string" ? saved.view : defaults.view,
    transaction: saved.transaction === "sale" ? "sale" : defaults.transaction,
    region: typeof saved.region === "string" ? saved.region : defaults.region,
    sort: typeof saved.sort === "string" ? saved.sort : defaults.sort,
    selectedCrop: typeof saved.selectedCrop === "string" ? saved.selectedCrop : defaults.selectedCrop,
    filters: { ...blankFilters(), ...(saved.filters || {}) },
    aiSummaries: saved.aiSummaries && typeof saved.aiSummaries === "object" ? saved.aiSummaries : {},
  };
} catch {
  state = structuredClone(defaults);
}

function readGuestFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_FAV_KEY) || "[]");
    return Array.isArray(raw) ? [...new Set(raw.filter((v) => typeof v === "string" && v.trim()))] : [];
  } catch {
    return [];
  }
}

function saveGuestFavorites(list) {
  guestFavorites = [...new Set(list.filter((v) => typeof v === "string" && v.trim()))];
  try {
    localStorage.setItem(GUEST_FAV_KEY, JSON.stringify(guestFavorites));
  } catch {
    toast("브라우저 저장 공간이 부족합니다.");
  }
}

function clearGuestFavorites() {
  guestFavorites = [];
  try { localStorage.removeItem(GUEST_FAV_KEY); } catch { /* ignore */ }
}

let accountUser = null;
function isLoggedIn() { return Boolean(accountUser); }

let authEpoch = 0;
const activeControllers = new Set();
let guestFavorites = readGuestFavorites();
let serverFavorites = [];
let incomingRequests = [];
let outgoingRequests = [];
let approvableRequestCount = 0;
let userConversations = [];
let chatPollTimer = null;
let pendingIntent = null;
let dismissGuestImport = false;

function activeFavorites() {
  return isLoggedIn() ? serverFavorites : guestFavorites;
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

function bumpAuthEpoch() {
  authEpoch += 1;
  stopChatPolling();
  for (const controller of activeControllers) {
    try { controller.abort(); } catch { /* ignore */ }
  }
  activeControllers.clear();
  return authEpoch;
}

function resetAccountRuntimeState() {
  serverFavorites = [];
  incomingRequests = [];
  outgoingRequests = [];
  approvableRequestCount = 0;
  userConversations = [];
  dismissGuestImport = false;
}

let onSessionExpiredHandler = null;

async function apiFetch(url, options = {}) {
  const epoch = authEpoch;
  const controller = new AbortController();
  activeControllers.add(controller);
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { ...(options.headers || {}) };
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
      cache: "no-store",
      signal: controller.signal,
    });

    if (epoch !== authEpoch) {
      const staleErr = new Error("계정 상태가 변경되었습니다.");
      staleErr.code = "AUTH_CHANGED";
      throw staleErr;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && isLoggedIn() && onSessionExpiredHandler) {
        onSessionExpiredHandler();
      }
      const err = new Error(data?.error || `요청 처리에 실패했습니다. (${response.status})`);
      err.status = response.status;
      err.code = data?.code || "REQUEST_FAILED";
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

let draft = structuredClone(state.filters);
let toastTimer;
let catalog = [];
let catalogState = "loading";
let catalogReady = Promise.resolve();

function persist() {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify({
      view: state.view,
      transaction: state.transaction,
      region: state.region,
      sort: state.sort,
      selectedCrop: state.selectedCrop,
      filters: state.filters,
      aiSummaries: state.aiSummaries,
    }));
  } catch {
    toast("브라우저 저장 공간이 부족합니다.");
  }
  updateBadges();
}

function allListings() {
  return catalog;
}

function rentedNow(item) {
  if (item.type !== "rent") return false;
  const now = today();
  return (item.booked || []).some((range) => range.start <= now && now <= range.end);
}

async function loadCatalog({ quiet = false } = {}) {
  const epoch = authEpoch;
  try {
    const data = await apiFetch("/api/listings", { timeoutMs: 8000 });
    if (epoch !== authEpoch) return;
    if (!Array.isArray(data.listings)) throw new Error("잘못된 매물 응답");
    catalog = data.listings;
    catalogState = "ready";
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
    if (!quiet) console.error(error);
    catalogState = "error";
  }
  renderAll();
  if (isLoggedIn()) renderOwner();
}

function listingById(id) {
  return allListings().find((item) => item.id === id);
}

function statusLabel(item) {
  if (item.type === "sale") return item.status === "done" ? "판매 완료" : item.status === "dealing" ? "거래 중" : "판매 가능";
  if (item.condition === "repair") return "정비 중";
  return rentedNow(item) ? "대여 중" : "대여 가능";
}

function statusClass(item) {
  if (item.type === "rent" && item.condition !== "repair" && item.status === "open" && rentedNow(item)) return "rented";
  return item.status !== "open" || item.condition === "repair" ? "warn" : "ok";
}

function setToastVisible(value) {
  $("toast").classList.toggle("visible", value);
}

function toast(message) {
  $("toast").textContent = message;
  setToastVisible(true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToastVisible(false), 3200);
}

const dialogOpeners = new WeakMap();

function showDialog(backdrop) {
  if (backdrop.hidden) dialogOpeners.set(backdrop, document.activeElement);
  backdrop.hidden = false;
  document.body.style.overflow = "hidden";
  backdrop.querySelector("button")?.focus();
}

function hideDialog(backdrop) {
  if (backdrop.hidden) return;
  if (backdrop === $("formBackdrop")) stopChatPolling();
  backdrop.hidden = true;
  dialogOpeners.get(backdrop)?.focus();
  dialogOpeners.delete(backdrop);
  if (["filterBackdrop", "detailBackdrop", "formBackdrop"].every((id) => $(id).hidden)) {
    document.body.style.overflow = "";
  }
}

const LISTING_PHOTO = /^data:image\/(?:png|jpeg|webp);base64,/i;
const getListingPhotoSrc = (item) => {
  if (typeof item?.photoUrl === "string" && item.photoUrl.startsWith("/api/photos")) return item.photoUrl;
  if (typeof item?.photo === "string" && LISTING_PHOTO.test(item.photo)) return item.photo;
  return "";
};
const hasListingPhoto = (item) => Boolean(getListingPhotoSrc(item));
const machineImage = (type) => `./src/images/machines/${type?.id || "tractor"}.jpg`;

function pictureIcon(name) {
  return `<img class="picture-icon" src="./src/images/icons/${name}.jpg" alt="" width="32" height="32">`;
}

function favoriteIcon() {
  return `<svg class="favorite-icon" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
    <path fill="#b9703c" stroke="#65391f" stroke-width="1.8" stroke-linejoin="round"
      d="M2 28c0-2.1 2.1-3.9 4.5-4.8 1.4-2.2 3.6-3.1 6-3.1a8.8 8.8 0 0 1 10.7 0c2.7 0 5 1 6.3 3.1 2.4 1 4.5 2.7 4.5 4.8 0 3.5-5 4.1-8.5 4.1-3.3 1.1-5.7 0-7.5 0s-4.2 1.1-7.5 0C7 32.1 2 31.5 2 28Z"/>
    <path fill="#9a542a" d="M3.1 28c4.4 1.6 5.9-2.3 9.6-1.7 3.1.4 4.6 3.2 8.8 1.1 3.9-2 4.8-1.4 7.1-.5 1.3.5 2.8.8 4.3.6.4 2.8-3.8 3.6-7.6 3.6-3.1 1-5.5 0-7.3 0s-4.2 1-7.3 0c-3.8 0-7.6-.9-7.6-3.1Z"/>
    <g fill="#78421f">
      <circle cx="9" cy="28.4" r=".95"/>
      <circle cx="13.7" cy="25.4" r=".95"/>
      <circle cx="23.7" cy="28.5" r=".85"/>
      <circle cx="27.1" cy="26.3" r=".85"/>
    </g>
    <g class="favorite-shoot">
      <path fill="#9ac921" stroke="#416514" stroke-width="1.8" stroke-linejoin="round"
        d="M16.7 23.1v-4.4C9.5 19.4 6.1 15 6.2 9.2c5.3-2.6 9.7.3 11.6 4.1 2.3-4.6 7-6.9 12.1-5.4.2 6.4-3.8 10.8-10.6 10.8l-.2 4.4a3 3 0 0 1-2.4 0Z"/>
      <path fill="none" stroke="#d2ee6b" stroke-width="1.5" stroke-linecap="round"
        d="M9.3 10.7c1-.3 2.1-.2 3 .2m7.9 4c1-2 2.7-3.6 4.6-4.3"/>
    </g>
  </svg>`;
}

async function refreshAuthenticatedData({ includeRequests = true, includeConversations = true } = {}) {
  if (!isLoggedIn()) {
    resetAccountRuntimeState();
    garage?.resetToGuest();
    updateBadges();
    renderAll();
    renderBuyerRequests();
    return;
  }

  const epoch = authEpoch;
  try {
    const tasks = [apiFetch("/api/me")];
    tasks.push(includeRequests ? apiFetch("/api/requests") : Promise.resolve(null));
    tasks.push(includeConversations ? apiFetch("/api/conversations?mode=list") : Promise.resolve(null));
    const [meData, reqData, convData] = await Promise.all(tasks);
    if (epoch !== authEpoch) return;

    serverFavorites = Array.isArray(meData?.favorites) ? meData.favorites : [];
    garage?.setExternalOwned(meData?.ownedMachines || [], meData?.selectedOwnedMachineId || "");

    if (reqData) {
      incomingRequests = Array.isArray(reqData.incoming) ? reqData.incoming : [];
      outgoingRequests = Array.isArray(reqData.outgoing) ? reqData.outgoing : [];
      approvableRequestCount = Number(reqData.approvableCount) || 0;
    }
    if (convData) {
      userConversations = Array.isArray(convData.conversations) ? convData.conversations : [];
    }

    renderGuestImportBanner();
    updateBadges();
    renderListings();
    if (state.view === "requests") renderBuyerRequests();
    if (state.view === "owner") renderOwner();
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
    if (error?.status !== 401) {
      console.error("authenticated refresh failed", error);
    }
  }
}

function savePendingIntentAndRedirectLogin(intent, notice = "로그인 후 이어서 진행할 수 있어요.") {
  pendingIntent = intent;
  hideDialog($("detailBackdrop"));
  hideDialog($("formBackdrop"));
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
    saveGuestFavorites(nextFav ? [...guestFavorites, id] : guestFavorites.filter((v) => v !== id));
    syncFavoriteButtons(id, nextFav);
    updateBadges();
    toast(nextFav ? "찜한 농기계 목록에 담았습니다." : "찜 목록에서 제외했습니다.");
    if (fromModal) openFavoritesModal();
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
    serverFavorites = Array.isArray(res?.userData?.favorites) ? res.userData.favorites : [];
    const actualFav = serverFavorites.includes(id);
    syncFavoriteButtons(id, actualFav);
    updateBadges();
    toast(actualFav ? "찜한 농기계 목록에 담았습니다." : "찜 목록에서 제외했습니다.");
    if (fromModal) openFavoritesModal();
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
      ownerBadge.hidden = approvableRequestCount === 0;
      ownerBadge.textContent = String(approvableRequestCount);
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
  persist();
  if (view === "owner") {
    renderOwner();
    refreshAuthenticatedData();
  }
  if (view === "requests") {
    renderBuyerRequests();
    if (isLoggedIn()) refreshAuthenticatedData();
  }
  if (view === "garage") garage?.refresh();
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

function setTransaction(type) {
  state.transaction = type;
  $("rentTab").classList.toggle("active", type === "rent");
  $("saleTab").classList.toggle("active", type === "sale");
  $("rentTab").setAttribute("aria-pressed", String(type === "rent"));
  $("saleTab").setAttribute("aria-pressed", String(type === "sale"));
  $("marketSubtitle").textContent =
    type === "rent"
      ? "필요한 날만 합리적으로 빌려 쓰세요. 날짜와 평수를 고르면 더 정확해져요."
      : "오래 쓸 내 농기계를 찾아보세요. 점검 상태와 예산을 비교할 수 있어요.";
  const quickDateBox = $("quickDateBox");
  if (quickDateBox) {
    quickDateBox.classList.toggle("disabled-field", type === "sale");
    $("quickDateInput").disabled = type === "sale";
    $("quickDateEndInput").disabled = type === "sale";
  }
  persist();
  renderAll();
}

function syncQuickSearchInputs() {
  if ($("quickDateInput")) {
    // 날짜를 고르기 전에는 웹서버 기준 오늘(대여)과 내일(반납)을 보여준다
    const start = state.filters.date || today();
    const end = state.filters.dateEnd && state.filters.dateEnd >= start ? state.filters.dateEnd : state.filters.date ? start : addDays(start, 1);
    $("quickDateInput").min = today();
    $("quickDateInput").value = start;
    $("quickDateEndInput").min = start;
    $("quickDateEndInput").value = end;
    const s = koreanDateParts(start);
    const e = koreanDateParts(end);
    $("quickDateLabel").textContent = s.date;
    $("quickDateDay").textContent = s.weekday;
    $("quickDateEndLabel").textContent = e.date;
    $("quickDateEndDay").textContent = e.weekday;
    $("clearQuickDate").hidden = !state.filters.date;
  }
  if ($("quickRadiusSelect")) {
    $("quickRadiusSelect").value = state.filters.radius || "all";
  }
}

// 1단계: 작물 선택 렌더링
function renderCrops() {
  $("cropSelect").value = Object.hasOwn(CROP_BY_ID, state.selectedCrop) ? state.selectedCrop : "all";
  $("cropDescription").textContent = CROP_BY_ID[$("cropSelect").value]?.description || "작물을 고르면 해당 작물에 맞는 작업을 볼 수 있어요.";
}

// 2단계: 작업 단계 및 세부 작업 버튼 렌더링 (초보 농부 맞춤 위저드)
function renderQuickWizard() {
  const crop = CROP_BY_ID[state.selectedCrop];
  const recommendedOps = crop ? CROP_OPERATIONS[crop.id] || [] : [];

  // 단계 탭
  const allStageActive = state.filters.stageIds.length === 0;
  const stageHtml = [
    `<button type="button" class="stage-tab ${allStageActive ? "active" : ""}" data-quick-stage="all" aria-pressed="${allStageActive}">
      <span class="stage-step-num">전체</span>
      <strong>모든 작업 단계</strong>
    </button>`,
    ...STAGES.map((stage, idx) => {
      const active = state.filters.stageIds.includes(stage.id);
      return `
        <button type="button" class="stage-tab ${active ? "active" : ""}" data-quick-stage="${stage.id}" aria-pressed="${active}">
          <span class="stage-step-num">${idx + 1}단계</span>
          <strong>${escapeHtml(stage.label)}</strong>
        </button>
      `;
    }),
  ].join("");
  $("quickStageList").innerHTML = stageHtml;

  // 세부 작업 버튼들 (선택된 단계가 있으면 해당 단계만, 없으면 전체 표시)
  const visibleOps = OPERATIONS.filter((op) =>
    (!crop || recommendedOps.includes(op.id)) && (!state.filters.stageIds.length || state.filters.stageIds.includes(op.stage))
  );

  $("quickOperationList").innerHTML = visibleOps
    .map((op) => {
      const active = state.filters.operations.includes(op.id);
      const isRec = recommendedOps.includes(op.id);
      return `
        <button type="button" class="op-chip ${active ? "active" : ""} ${isRec ? "recommended" : ""}" data-quick-op="${op.id}" aria-pressed="${active}">
          <span class="op-chip-label">${escapeHtml(op.label)}</span>
          ${isRec ? `<span class="op-rec-tag">초보 추천</span>` : ""}
          ${active ? `<span class="op-check" aria-hidden="true">✓</span>` : ""}
        </button>
      `;
    })
    .join("");

  // 초보 농부 맞춤 콜아웃 업데이트
  const activeOpId = state.filters.operations[0];
  const cropKey = crop ? crop.id : "all";
  const tipGroup = BEGINNER_TIPS[cropKey] || BEGINNER_TIPS.all;
  const tipText = (activeOpId && tipGroup[activeOpId]) || tipGroup.default || BEGINNER_TIPS.all.default;

  const calloutTitle = crop
    ? `${crop.emoji} ${crop.name} 농사${activeOpId ? ` · '${OPERATION_BY_ID[activeOpId]?.label}'` : ""} 꿀팁!`
    : ` 초보 농부를 위한 농기계 선택 팁`;

  $("cropCallout").querySelector(".callout-icon").innerHTML = pictureIcon(crop?.id || "bulb");
  $("cropCallout").querySelector("strong").textContent = calloutTitle;
  $("cropCallout").querySelector("p").textContent = tipText;

  // 이벤트 바인딩
  $("quickStageList")
    .querySelectorAll("[data-quick-stage]")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        const stageId = btn.dataset.quickStage;
        if (stageId === "all") {
          state.filters.stageIds = [];
        } else {
          state.filters.stageIds = state.filters.stageIds.includes(stageId)
            ? state.filters.stageIds.filter((id) => id !== stageId)
            : [...state.filters.stageIds, stageId];
        }
        state.filters.operations = state.filters.operations.filter((id) =>
          !state.filters.stageIds.length || state.filters.stageIds.includes(OPERATION_BY_ID[id]?.stage)
        );
        persist();
        renderAll();
      })
    );

  $("quickOperationList")
    .querySelectorAll("[data-quick-op]")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        const opId = btn.dataset.quickOp;
        state.filters.operations = state.filters.operations.includes(opId)
          ? state.filters.operations.filter((id) => id !== opId)
          : [...state.filters.operations, opId];
        persist();
        renderAll();
      })
    );
}

// 기종별 빠른 카테고리 탭바 (쏘카 스타일)
function renderMachineCategoryBar() {
  const baseFiltersWithoutMachine = { ...state.filters, machineTypes: [] };
  const baseMatching = filteredListings(baseFiltersWithoutMachine);
  const isAll = state.filters.machineTypes.length === 0;

  const tabs = [
    `<button type="button" class="machine-tab ${isAll ? "active" : ""}" data-machine-tab="all" aria-pressed="${isAll}">
      <span class="mt-emoji" aria-hidden="true"><img class="mt-photo" src="${machineImage()}" alt="" /></span>
      <span class="mt-caption"><span class="mt-name">전체 기종</span><span class="mt-count">${baseMatching.length}</span></span>
    </button>`,
    ...MACHINE_TYPES.map((m) => {
      const matchingItems = baseMatching.filter((item) => item.machineType === m.id);
      const count = matchingItems.length;
      const photo = allListings().find((item) => item.machineType === m.id
        && hasListingPhoto(item))?.photo;
      const active = state.filters.machineTypes.includes(m.id);
      return `
        <button type="button" class="machine-tab ${active ? "active" : ""}" data-machine-tab="${m.id}" aria-pressed="${active}">
          <span class="mt-emoji" aria-hidden="true"><img class="mt-photo" src="${photo ? escapeHtml(photo) : machineImage(m)}" alt="" /></span>
          <span class="mt-caption"><span class="mt-name">${escapeHtml(m.label)}</span><span class="mt-count">${count}</span></span>
        </button>
      `;
    }),
  ];

  $("machineCategoryBar").innerHTML = tabs.join("");
  $("machineCategoryBar")
    .querySelectorAll("[data-machine-tab]")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        const mId = btn.dataset.machineTab;
        if (mId === "all") {
          state.filters.machineTypes = [];
        } else {
          state.filters.machineTypes = state.filters.machineTypes.includes(mId)
            ? state.filters.machineTypes.filter((id) => id !== mId)
            : [mId];
        }
        persist();
        renderAll();
      })
    );
}

// 상세 필터 모달 내부 옵션 렌더링 (다나와 + 토스 스타일)
function selectOption(group, values, checked, recommendedIds = []) {
  return values
    .map((item) => {
      const isChecked = checked.includes(item.id);
      const isRec = recommendedIds.includes(item.id);
      return `
        <label class="option ${isChecked ? "is-checked" : ""} ${isRec ? "is-recommended" : ""}">
          <input type="checkbox" data-filter-group="${group}" value="${item.id}" ${isChecked ? "checked" : ""}>
          ${group === "cropIds" ? pictureIcon(item.id) : group === "machineTypes" ? `<img class="picture-icon" src="${machineImage(item)}" alt="" width="32" height="32">` : group === "conditions" && ["good", "repair"].includes(item.id) ? pictureIcon(item.id) : ""}
          <span class="opt-text">${escapeHtml(item.label || item.name)}</span>
          ${isRec ? `<span class="opt-rec-badge">추천</span>` : ""}
        </label>
      `;
    })
    .join("");
}

function renderFilterOptions() {
  const activeCropId = draft.cropIds[0] || (state.selectedCrop !== "all" ? state.selectedCrop : null);
  const recOps = activeCropId ? CROP_OPERATIONS[activeCropId] || [] : [];

  $("filterCrops").innerHTML = selectOption("cropIds", CROPS, draft.cropIds);
  $("filterStages").innerHTML = selectOption("stageIds", STAGES, draft.stageIds);
  const visibleOperations = draft.stageIds.length
    ? OPERATIONS.filter((operation) => draft.stageIds.includes(operation.stage))
    : OPERATIONS;
  $("filterOperations").innerHTML = selectOption("operations", visibleOperations, draft.operations, recOps);
  $("filterMachines").innerHTML = selectOption("machineTypes", MACHINE_TYPES, draft.machineTypes);
  $("filterBrands").innerHTML = selectOption(
    "brands",
    [...new Set(allListings().map((item) => item.brand))].sort().map((brand) => ({ id: brand, label: brand })),
    draft.brands
  );
  $("filterConditions").innerHTML = selectOption(
    "conditions",
    [
      { id: "good", label: "정상 작동 (즉시 사용)", emoji: "" },
      { id: "used", label: "사용감 있음", emoji: "" },
      { id: "repair", label: "정비 필요", emoji: "" },
    ],
    draft.conditions,
    ["good"]
  );

  $("budgetUnit").textContent = state.transaction === "rent" ? "1일 대여료 기준" : "중고 구매가 기준";
  $("dateFilterLabel").hidden = state.transaction === "sale";
  $("dateEndFilterLabel").hidden = state.transaction === "sale";

  // 예산 프리셋 버튼 렌더링
  const pricePresetList =
    state.transaction === "rent"
      ? [
          { label: "전체 금액", max: "" },
          { label: "5만원 이하 / 일", max: "50000" },
          { label: "7만원 이하 / 일", max: "70000" },
          { label: "10만원 이하 / 일", max: "100000" },
        ]
      : [
          { label: "전체 금액", max: "" },
          { label: "300만원 이하", max: "3000000" },
          { label: "600만원 이하", max: "6000000" },
          { label: "1,000만원 이하", max: "10000000" },
        ];

  $("pricePresets").innerHTML = pricePresetList
    .map(
      (p) =>
        `<button type="button" class="preset-chip ${String(draft.maxPrice || "") === p.max ? "active" : ""}" data-price-preset="${p.max}">${p.label}</button>`
    )
    .join("");

  // 면적 프리셋 활성화 표시
  $("areaPresets")
    .querySelectorAll("[data-area-preset]")
    .forEach((btn) => {
      btn.classList.toggle("active", String(draft.areaPyeong || "") === btn.dataset.areaPreset);
    });

  for (const [id, key] of [
    ["minPrice", "minPrice"],
    ["maxPrice", "maxPrice"],
    ["areaInput", "areaPyeong"],
    ["radiusInput", "radius"],
    ["dateInput", "date"],
    ["dateEndInput", "dateEnd"],
  ]) {
    $(id).value = draft[key];
  }
  $("dateInput").min = today();
  renderFilterPreview();
}

function openFilters() {
  draft = structuredClone(state.filters);
  renderFilterOptions();
  showDialog($("filterBackdrop"));
}

function readDraftFields() {
  for (const [id, key] of [
    ["minPrice", "minPrice"],
    ["maxPrice", "maxPrice"],
    ["areaInput", "areaPyeong"],
    ["radiusInput", "radius"],
    ["dateInput", "date"],
    ["dateEndInput", "dateEnd"],
  ]) {
    draft[key] = $(id).value;
  }
  $("dateEndInput").min = draft.date || today();
}

function matches(item, filters) {
  if (item.type !== state.transaction || item.status !== "open") return false;
  if (item.condition === "repair" && !filters.conditions.includes("repair")) return false;
  if (filters.cropIds.length && !filters.cropIds.some((id) => item.cropIds.includes(id))) return false;
  if (filters.stageIds.length && !item.operations.some((id) => filters.stageIds.includes(OPERATION_BY_ID[id]?.stage))) return false;
  if (filters.operations.length && !filters.operations.some((id) => item.operations.includes(id))) return false;
  if (filters.machineTypes.length && !filters.machineTypes.includes(item.machineType)) return false;
  if (filters.brands.length && !filters.brands.includes(item.brand)) return false;
  if (filters.conditions.length && !filters.conditions.includes(item.condition)) return false;
  if (filters.minPrice && item.price < Number(filters.minPrice)) return false;
  if (filters.maxPrice && item.price > Number(filters.maxPrice)) return false;
  if (filters.areaPyeong && (Number(filters.areaPyeong) * 3.305785 < item.areaMin || Number(filters.areaPyeong) * 3.305785 > item.areaMax)) return false;
  if (filters.radius !== "all" && distanceKm(state.region, item.region, item.id) > Number(filters.radius)) return false;
  if (state.transaction === "rent" && filters.date && !available(item, filters.date, filters.dateEnd || filters.date)) return false;
  return true;
}

function filteredListings(filters = state.filters) {
  const query = $("searchInput").value.trim().toLowerCase();
  return allListings()
    .filter(
      (item) =>
        matches(item, filters) &&
        (!query ||
          `${item.title} ${item.brand} ${item.description} ${MACHINE_BY_ID[item.machineType]?.label || ""} ${item.operations
            .map((id) => OPERATION_BY_ID[id]?.label)
            .join(" ")}`
            .toLowerCase()
            .includes(query))
    )
    .sort((a, b) => compareListings(a, b, state.region, state.sort));
}

function renderFilterPreview() {
  readDraftFields();
  $("filterPreviewCount").textContent = `${filteredListings(draft).length}개`;
}

function applyFilters() {
  readDraftFields();
  if (draft.minPrice && draft.maxPrice && Number(draft.minPrice) > Number(draft.maxPrice)) {
    toast("최소 금액이 최대 금액보다 큽니다.");
    return;
  }
  if (state.transaction === "rent" && draft.dateEnd && (!draft.date || draft.dateEnd < draft.date)) {
    toast("대여 시작일과 반납일을 확인해 주세요.");
    return;
  }
  state.filters = structuredClone(draft);
  state.selectedCrop = state.filters.cropIds[0] || "all";
  persist();
  hideDialog($("filterBackdrop"));
  renderAll();
}

// 개별 삭제가 가능한 활성 필터 칩 생성
function buildFilterChips() {
  const f = state.filters;
  const chips = [];
  f.cropIds.forEach((id) => chips.push({ group: "cropIds", value: id, label: `${CROP_BY_ID[id]?.emoji || ""} ${CROP_BY_ID[id]?.name}` }));
  f.stageIds.forEach((id) => chips.push({ group: "stageIds", value: id, label: STAGES.find((s) => s.id === id)?.label }));
  f.operations.forEach((id) => chips.push({ group: "operations", value: id, label: OPERATION_BY_ID[id]?.label }));
  f.machineTypes.forEach((id) => chips.push({ group: "machineTypes", value: id, label: MACHINE_BY_ID[id]?.label }));
  f.brands.forEach((id) => chips.push({ group: "brands", value: id, label: id }));
  f.conditions.forEach((id) =>
    chips.push({ group: "conditions", value: id, label: id === "good" ? "정상 작동" : id === "used" ? "사용감 있음" : "정비 필요" })
  );
  if (f.minPrice) chips.push({ group: "minPrice", value: "", label: `${money(f.minPrice)} 이상` });
  if (f.maxPrice) chips.push({ group: "maxPrice", value: "", label: `${money(f.maxPrice)} 이하` });
  if (f.areaPyeong) chips.push({ group: "areaPyeong", value: "", label: `밭 ${f.areaPyeong}평 기준` });
  if (f.radius !== "all") chips.push({ group: "radius", value: "all", label: `${f.radius}km 이내` });
  if (f.date && state.transaction === "rent") chips.push({ group: "date", value: "", label: f.dateEnd ? ` ${f.date} ~ ${f.dateEnd}` : ` ${f.date}` });
  return chips.filter((c) => c.label);
}

function renderActiveFilters() {
  const chips = buildFilterChips();
  $("activeFilters").innerHTML = chips
    .map(
      (chip) =>
        `<button type="button" class="filter-chip" data-remove-group="${chip.group}" data-remove-val="${escapeHtml(chip.value)}" title="클릭하여 조건 해제">
          <span>${escapeHtml(chip.label)}</span>
          <span class="chip-close" aria-hidden="true">✕</span>
        </button>`
    )
    .join("");

  const count = chips.length;
  $("filterCount").hidden = count === 0;
  $("filterCount").textContent = String(count);
  if ($("inlineResetFilters")) {
    $("inlineResetFilters").hidden = count === 0 && !$("searchInput").value.trim();
  }
}

function card(item) {
  const summary = listingSummary(item);
  const distance = distanceKm(state.region, item.region, item.id);
  const machineLabel = MACHINE_BY_ID[item.machineType]?.label || "농기계";
  const cropsText = item.cropIds.map((id) => CROP_BY_ID[id]?.name).filter(Boolean).join("·");
  const opsText = item.operations.map((id) => OPERATION_BY_ID[id]?.label).filter(Boolean).slice(0, 2).join(" · ");
  const isFav = activeFavorites().includes(item.id);
  const sClass = statusClass(item);

  return `
    <article class="listing-card">
      <div class="card-media-wrap">
        <button type="button" class="card-media-btn" data-detail="${item.id}" aria-label="${escapeHtml(item.title)} 상세 보기">
          <div class="machine-art">
            ${machineVisual(item)}
            <div class="art-badges-top">
              <span class="card-status-pill ${sClass}">${statusLabel(item)}</span>
              <span class="art-distance-pill"> ${escapeHtml(item.region)} · ${distance}km</span>
            </div>
            <span class="art-caption">${hasListingPhoto(item) ? "실제 등록 사진" : `${escapeHtml(machineLabel)} AI 예시 이미지`}</span>
          </div>
        </button>
        <button type="button" class="card-save" data-favorite="${item.id}" aria-label="${escapeHtml(item.title)} 찜하기" aria-pressed="${isFav}">
          ${favoriteIcon()}
        </button>
      </div>

      <div class="card-body">
        <div class="card-spec-tags">
          <span class="spec-tag primary">${escapeHtml(machineLabel)}</span>
          <span class="spec-tag">${escapeHtml(cropsText)}</span>
          <span class="spec-tag">${escapeHtml(opsText)}</span>
          <span class="spec-tag">${areaLabel(item.areaMin, item.areaMax)}</span>
        </div>

        <button type="button" class="card-title-btn" data-detail="${item.id}">
          <h3>${escapeHtml(item.title)}</h3>
        </button>

        <div class="card-meta">제조사: ${escapeHtml(item.brand)} · 최근 점검: ${escapeHtml(item.inspectedAt)}</div>

        <div class="card-summary">
          <div class="summary-badge">${state.aiSummaries[item.id] ? "✦ AI 농농이 핵심 요약" : " 초보 농부 한줄 안내"}</div>
          <p>${escapeHtml(summary)}</p>
        </div>

        <div class="card-footer">
          <div class="card-price-box">
            <span class="price-type-label">${item.type === "rent" ? "1일 대여료" : "판매 가격"}</span>
            <div class="card-price">${money(item.price)}<small>${item.type === "rent" ? " / 1일" : ""}</small></div>
          </div>
          <button type="button" class="button button-card-cta" data-detail="${item.id}">
            <span>${item.type === "rent" ? "상세·대여 신청" : "상세·구매 문의"}</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderListings() {
  const items = filteredListings();
  $("resultCount").textContent = `총 ${items.length}대의 농기계 · ${{ distance: "거리순", price: "낮은 가격순", inspection: "최근 점검순" }[state.sort]}`;
  $("listingGrid").innerHTML = items.length
    ? items.map(card).join("")
    : `<div class="empty-state">
        <div class="empty-icon" aria-hidden="true"><img class="picture-icon" src="${machineImage()}" alt="" width="32" height="32"></div>
        <strong>선택하신 조건에 맞는 농기계가 아직 없어요</strong>
        <p>작업 종류나 예산, 거리 조건을 조금 넓혀서 다시 찾아볼까요?</p>
        <div class="empty-actions">
          <button type="button" class="button button-secondary" data-reset-all>전체 조건 초기화</button>
        </div>
      </div>`;

  if (catalogState !== "ready") {
    const message = catalogState === "loading" ? "우리 동네 농기계 매물을 불러오는 중입니다…" : "데모 매물을 불러오지 못했습니다. 페이지를 새로고침해 주세요.";
    $("resultCount").textContent = message;
    if (!items.length) $("listingGrid").innerHTML = `<div class="empty-state"><strong>${message}</strong></div>`;
  }
  renderActiveFilters();
}

function renderAll() {
  garage?.refresh();
  syncQuickSearchInputs();
  renderCrops();
  renderQuickWizard();
  renderMachineCategoryBar();
  renderListings();
  renderBuyerRequests();
  updateBadges();
}

function openDetail(id) {
  const item = listingById(id);
  if (!item) return;
  const date = state.filters.date;
  const dateEnd = state.filters.dateEnd || date;
  const booked = item.type === "rent" && date && !available(item, date, dateEnd);
  const unavailable = item.status !== "open" || item.condition === "repair";
  const isFav = activeFavorites().includes(item.id);

  $("detailContent").innerHTML = `
    <div class="detail-layout">
      <div class="detail-art-col">
        <div class="detail-art">${machineVisual(item)}${hasListingPhoto(item) ? "" : '<span class="machine-example-label">AI 예시 이미지</span>'}</div>
        <div class="detail-checklist">
          <strong> 초보 농부 인수 전 필수 체크리스트</strong>
          <ul>
            <li>시동이 한 번에 잘 걸리고 이상 소음이 없는지 확인하세요.</li>
            <li>내 트랙터·관리기와 작업기 연결 규격이 맞는지 확인하세요.</li>
            <li>비상 정지 스위치와 안전 덮개 등 안전장치를 꼭 점검하세요.</li>
          </ul>
        </div>
      </div>
      <div class="detail-copy">
        <div class="detail-badges">
          <span class="card-status-pill ${statusClass(item)}">${statusLabel(item)}</span>
          <span class="spec-tag"> ${escapeHtml(item.region)} (${distanceKm(state.region, item.region, item.id)}km)</span>
          <span class="spec-tag">${escapeHtml(MACHINE_BY_ID[item.machineType]?.label)}</span>
        </div>
        <h2 id="detailTitle">${escapeHtml(item.title)}</h2>
        ${garage?.detail(item) || ""}
        ${item.specification ? `
          <section class="model-specification" aria-label="실제 모델 사양">
            <h3>실제 모델 사양</h3>
            <p>실제 제품 사양을 참조한 가상 매물 · 가격·예약·점검일·권장 면적은 시연용</p>
            <dl class="model-spec-list">
              ${item.specification.facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
              <div><dt>연결 방식</dt><dd>${escapeHtml(item.specification.connection.label)}</dd></div>
            </dl>
            <p><strong>추가 확인:</strong> ${item.specification.unknowns.map(escapeHtml).join(" · ")}</p>
            <div>${item.specification.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)} ↗</a><p>${escapeHtml(source.note)} · 확인 ${escapeHtml(source.checkedAt)}</p>`).join("")}</div>
          </section>` : ""}
        <div class="detail-price-box">
          <span class="detail-price-label">${item.type === "rent" ? "1일 대여 요금" : "중고 판매 가격"}</span>
          <div class="detail-price">${money(item.price)} <small>${item.type === "rent" ? "/ 1일 기준" : ""}</small></div>
        </div>

        ${item.type === "rent" ? `<div class="detail-box"><b>대여 일정과 비용</b><p>${date ? `${date} ~ ${dateEnd} · ${booked || unavailable ? "대여 불가" : "대여 가능"}` : "시작일과 반납일을 선택해 대여 가능 여부를 확인하세요."}<br>운송비와 보증금은 소유 농가에 확인해 주세요.</p></div>` : ""}
        <div class="detail-box highlight">
          <b>${state.aiSummaries[item.id] ? "AI 한줄 요약" : "기종 사용 안내"}</b>
          <p>${escapeHtml(listingSummary(item))}</p>
        </div>

        <div class="detail-spec-grid">
          <div class="spec-cell">
            <small>추천 작물</small>
            <strong>${escapeHtml(item.cropIds.map((cropId) => CROP_BY_ID[cropId]?.name).filter(Boolean).join(", "))}</strong>
          </div>
          <div class="spec-cell">
            <small>주요 작업</small>
            <strong>${escapeHtml(item.operations.map((opId) => OPERATION_BY_ID[opId]?.label).filter(Boolean).join(", "))}</strong>
          </div>
          <div class="spec-cell">
            <small>권장 밭 크기</small>
            <strong>${areaFullLabel(item.areaMin, item.areaMax)}</strong>
          </div>
          <div class="spec-cell">
            <small>기계 상태 · 점검일</small>
            <strong>${escapeHtml(item.condition === "good" ? "정상 작동" : item.condition === "used" ? "사용감 있음" : "정비 필요")} (${escapeHtml(item.inspectedAt)})</strong>
          </div>
        </div>

        <div class="detail-box">
          <b> 포함 구성품 및 인수 방법</b>
          <p>포함 작업기/부속: <strong>${escapeHtml(item.included)}</strong><br>인수 방식: <strong>${escapeHtml(item.pickup)}</strong></p>
        </div>

        <div class="detail-box">
          <b> 등록 농가 상세 설명</b>
          <p>${escapeHtml(item.description)}</p>
        </div>

        <div class="detail-actions">
          <button type="button" class="button button-secondary detail-fav-btn" data-detail-fav="${item.id}" aria-label="찜하기" aria-pressed="${isFav}">
            ${favoriteIcon()}
            <span class="favorite-label">${isFav ? "찜한 기계" : "찜하기"}</span>
          </button>
          ${item.owner ? `
            <button type="button" class="button button-primary button-large" data-detail-manage="${item.id}">내 매물 관리하기</button>
          ` : `
            ${item.type === "rent" ? `<button type="button" class="button button-secondary" data-detail-chat="${item.id}">1:1 문의</button>` : ""}
            <button type="button" class="button button-primary button-large" data-detail-action="${item.id}" ${unavailable || booked ? "disabled" : ""}>
              ${unavailable ? "현재 거래 불가" : booked ? "선택 기간 대여 불가" : item.type === "rent" ? " 이 농기계 대여 신청하기" : " 판매자에게 채팅 문의하기"}
            </button>
          `}
        </div>
      </div>
    </div>
  `;
  showDialog($("detailBackdrop"));
}

function openForm(html) {
  stopChatPolling();
  $("formContent").innerHTML = html;
  showDialog($("formBackdrop"));
}

const REQUEST_STATE_LABEL = {
  approvable: "승인 대기",
  conflict: "일정 충돌 (승인 불가)",
  expired: "기간 경과",
  upcoming: "예약 확정",
  active: "대여 중",
  completed: "대여 완료",
  rejected: "거절됨",
  cancelled: "취소됨",
};

function renderRequestBadge(req) {
  const label = REQUEST_STATE_LABEL[req.derivedState] || req.status;
  return `<span class="step-pill req-pill req-pill-${escapeHtml(req.derivedState || req.status)}">${escapeHtml(label)}</span>`;
}

function rentalForm(id, draftValues = null) {
  const item = listingById(id);
  if (!item) return;
  if (!isLoggedIn()) {
    savePendingIntentAndRedirectLogin({
      type: "rental",
      listingId: id,
      draftValues,
    });
    return;
  }
  const minToday = today();
  const initialStart = draftValues?.start || (state.filters.date >= minToday ? state.filters.date : minToday);
  const initialEnd = draftValues?.end || (state.filters.dateEnd >= initialStart ? state.filters.dateEnd : initialStart);
  const initialNote = draftValues?.note || "";
  let draftRequestId = draftValues?.requestId || crypto.randomUUID();

  openForm(`
    <span class="step-pill">간편 대여 신청</span>
    <h2 id="formTitle">농기계 대여 요청하기</h2>
    <p><strong>${escapeHtml(item.title)}</strong> (${money(item.price)}/일) · 일정을 선택해 요청을 보내면 소유 농가에서 확인 후 승인해 드립니다.</p>
    <form class="stack-form" id="rentalForm">
      <div class="form-row-2">
        <label>대여 시작일<input type="date" id="rentStart" min="${minToday}" value="${escapeHtml(initialStart)}" required></label>
        <label>반납 예정일<input type="date" id="rentEnd" min="${escapeHtml(initialStart)}" value="${escapeHtml(initialEnd)}" required></label>
      </div>
      <p id="rentalEstimate" aria-live="polite"></p>
      <label>작업 내용 · 방문 메모 (선택)
        <textarea id="rentNote" maxlength="500" placeholder="예: 고추밭 300평 두둑 작업 예정입니다. 오전 9시에 직접 방문해 인수하겠습니다.">${escapeHtml(initialNote)}</textarea>
      </label>
      <div class="form-actions">
        <button class="button button-primary button-large" type="submit" id="rentalSubmitButton">대여 요청 보내기</button>
      </div>
    </form>
  `);

  let lastPayloadFingerprint = null;
  let busy = false;

  const updateEstimate = () => {
    const start = $("rentStart").value;
    const end = $("rentEnd").value;
    $("rentEnd").min = start || minToday;
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    const valid = Number.isInteger(days) && days > 0 && start >= minToday;
    const button = $("rentalSubmitButton");
    if (valid) {
      const totalPrice = item.price * days;
      $("rentalEstimate").textContent = "운송비와 보증금은 소유 농가에 확인해 주세요.";
      button.textContent = `${days}일 · ${money(totalPrice)} 대여 신청하기`;
      if (!busy) button.disabled = false;
    } else {
      $("rentalEstimate").textContent = "시작일과 반납일을 확인해 주세요.";
      button.textContent = "대여 기간을 확인해 주세요";
      button.disabled = true;
    }
  };
  $("rentalForm").addEventListener("input", () => {
    const fp = `${$("rentStart").value}|${$("rentEnd").value}|${$("rentNote").value.trim()}`;
    if (lastPayloadFingerprint && fp !== lastPayloadFingerprint) {
      draftRequestId = crypto.randomUUID();
      lastPayloadFingerprint = null;
    }
    updateEstimate();
  });
  updateEstimate();

  $("rentalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const start = $("rentStart").value;
    const end = $("rentEnd").value;
    const note = $("rentNote").value.trim();
    if (end < start || start < today()) return toast("대여 시작일과 반납일을 다시 확인하세요.");
    if (!available(listingById(id), start, end)) return toast("해당 기간에는 이미 확정된 예약이 있어 대여할 수 없습니다.");

    lastPayloadFingerprint = `${start}|${end}|${note}`;
    busy = true;
    const button = $("rentalSubmitButton");
    button.disabled = true;
    try {
      await apiFetch("/api/requests", {
        method: "POST",
        json: { action: "create", id: draftRequestId, listingId: id, start, end, note },
      });
      hideDialog($("formBackdrop"));
      await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData()]);
      toast("대여 요청을 보냈습니다! 상대방이 승인하면 예약이 확정됩니다.");
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if (error?.status === 401) {
        savePendingIntentAndRedirectLogin(
          { type: "rental", listingId: id, draftValues: { start, end, note, requestId: draftRequestId } },
          "세션이 만료되었습니다. 로그인 후 이어서 신청할 수 있어요."
        );
        return;
      }
      toast(error?.message || "대여 요청을 보내지 못했습니다.");
    } finally {
      busy = false;
      if ($("rentalSubmitButton")) updateEstimate();
    }
  });
}

function chatForm(target) {
  const opts = typeof target === "string" ? { listingId: target } : (target || {});
  const listingId = opts.listingId || null;
  let conversationId = opts.conversationId || null;
  const draftBody = typeof opts.draftBody === "string" ? opts.draftBody : "";
  const item = listingId ? listingById(listingId) : null;

  if (!isLoggedIn()) {
    savePendingIntentAndRedirectLogin({
      type: "chat",
      listingId,
      conversationId,
      draftBody,
    });
    return;
  }

  openForm(`
    <span class="step-pill">1:1 농기계 채팅 문의</span>
    <h2 id="formTitle">${item ? escapeHtml(item.title) : "1:1 대화"}</h2>
    <p id="chatSubtitle">대화 상대와 기계 상태·인수 일정을 안전하게 조율하세요.</p>
    <div style="margin-bottom:8px">
      <button type="button" id="chatLoadOlder" class="button button-secondary button-sm" hidden>이전 대화 더 보기</button>
    </div>
    <div id="chatLog" class="chat-log"><div class="chat-empty">대화 내역을 불러오는 중입니다…</div></div>
    <form id="chatForm" class="chat-send">
      <input id="chatMessage" maxlength="500" placeholder="예: 이번 주 토요일 오전 인수 가능할까요?" aria-label="메시지 입력" required value="${escapeHtml(draftBody)}">
      <button type="submit" id="chatSendButton" class="button button-primary">보내기</button>
    </form>
  `);

  const epoch = authEpoch;
  const bySeq = new Map();
  let hasMoreOlder = false;
  let busy = false;
  let draftMessageId = crypto.randomUUID();
  let lastSubmittedBody = null;

  const sortedMessages = () => [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const maxSeq = () => {
    const list = sortedMessages();
    return list.length ? list[list.length - 1].seq : 0;
  };
  const minSeq = () => {
    const list = sortedMessages();
    return list.length ? list[0].seq : null;
  };

  function renderChat({ keepScroll = false } = {}) {
    if (!$("chatLog")) return;
    const log = $("chatLog");
    const prevHeight = log.scrollHeight;
    const list = sortedMessages();
    log.innerHTML = list.length
      ? list.map((msg) => {
          const mine = msg.senderId === accountUser?.id;
          return `<div class="chat-line ${mine ? "mine" : ""}">
            <b>${escapeHtml(mine ? "나" : (msg.senderName || "상대 농가"))}</b>
            <div>${escapeHtml(msg.body)}</div>
          </div>`;
        }).join("")
      : `<div class="chat-empty">아직 나눈 대화가 없어요. 기계 상태와 인수 조건을 먼저 물어보세요!</div>`;
    $("chatLoadOlder").hidden = !hasMoreOlder;
    if (keepScroll) {
      log.scrollTop += log.scrollHeight - prevHeight;
    } else {
      log.scrollTop = log.scrollHeight;
    }
  }

  function applyConvMetadata(conv) {
    if (!conv) return;
    conversationId = conv.id;
    const isBuyer = conv.buyerId === accountUser?.id;
    const peerLabel = isBuyer ? `소유 농가 ${conv.ownerName}` : `문의 농가 ${conv.buyerName}`;
    if ($("formTitle")) $("formTitle").textContent = `${conv.listingTitle || item?.title || "농기계"} · 1:1 대화`;
    if ($("chatSubtitle")) $("chatSubtitle").textContent = `${peerLabel}님과의 대화`;
  }

  async function loadInitialMessages() {
    try {
      const qs = conversationId
        ? `conversationId=${encodeURIComponent(conversationId)}&limit=50`
        : `listingId=${encodeURIComponent(listingId)}&limit=50`;
      const data = await apiFetch(`/api/conversations?${qs}`);
      if (epoch !== authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
      if (data.conversation) applyConvMetadata(data.conversation);
      for (const m of data.messages || []) bySeq.set(m.seq, m);
      hasMoreOlder = Boolean(data.hasMoreOlder);
      renderChat();
      startPolling();
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if ($("chatLog")) {
        $("chatLog").innerHTML = `<div class="chat-empty">${escapeHtml(error?.message || "대화를 불러오지 못했습니다.")}</div>`;
      }
    }
  }

  async function pollNewMessages() {
    if (!conversationId || epoch !== authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
    try {
      const data = await apiFetch(`/api/conversations?conversationId=${encodeURIComponent(conversationId)}&after_seq=${maxSeq()}&limit=50`);
      if (epoch !== authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
      const incoming = data.messages || [];
      if (incoming.length) {
        for (const m of incoming) bySeq.set(m.seq, m);
        renderChat();
      }
    } catch {
      // Transient polling errors recover on next tick unless auth changed
    }
  }

  function startPolling() {
    stopChatPolling();
    if (!conversationId || epoch !== authEpoch || $("formBackdrop").hidden) return;
    chatPollTimer = setInterval(pollNewMessages, 2500);
  }

  $("chatLoadOlder").addEventListener("click", async () => {
    const oldest = minSeq();
    if (!conversationId || !oldest || oldest <= 1) return;
    $("chatLoadOlder").disabled = true;
    try {
      const data = await apiFetch(`/api/conversations?conversationId=${encodeURIComponent(conversationId)}&before_seq=${oldest}&limit=50`);
      if (epoch !== authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
      for (const m of data.messages || []) bySeq.set(m.seq, m);
      hasMoreOlder = Boolean(data.hasMoreOlder);
      renderChat({ keepScroll: true });
    } catch (error) {
      toast(error?.message || "이전 대화를 불러오지 못했습니다.");
    } finally {
      if ($("chatLoadOlder")) $("chatLoadOlder").disabled = false;
    }
  });

  $("chatMessage").addEventListener("input", () => {
    const val = $("chatMessage").value.trim();
    if (lastSubmittedBody !== null && val !== lastSubmittedBody) {
      draftMessageId = crypto.randomUUID();
      lastSubmittedBody = null;
    }
  });

  $("chatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const text = $("chatMessage").value.trim();
    if (!text) return;
    lastSubmittedBody = text;
    busy = true;
    $("chatSendButton").disabled = true;
    try {
      const res = await apiFetch("/api/conversations", {
        method: "POST",
        json: {
          action: "send",
          id: draftMessageId,
          conversationId,
          listingId: listingId || undefined,
          body: text,
        },
      });
      if (epoch !== authEpoch) return;
      if (res.conversation) applyConvMetadata(res.conversation);
      if (res.message) bySeq.set(res.message.seq, res.message);
      $("chatMessage").value = "";
      draftMessageId = crypto.randomUUID();
      lastSubmittedBody = null;
      renderChat();
      startPolling();
      refreshAuthenticatedData({ includeRequests: false, includeConversations: true });
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if (error?.status === 401) {
        savePendingIntentAndRedirectLogin(
          { type: "chat", listingId, conversationId, draftBody: text },
          "세션이 만료되었습니다. 로그인 후 메시지를 이어서 보낼 수 있어요."
        );
        return;
      }
      toast(error?.message || "메시지를 보내지 못했습니다.");
    } finally {
      busy = false;
      if ($("chatSendButton")) $("chatSendButton").disabled = false;
    }
  });

  loadInitialMessages();
}

async function handleRequestAction(action, requestId, button) {
  if (button) button.disabled = true;
  try {
    await apiFetch("/api/requests", {
      method: "POST",
      json: { action, id: requestId },
    });
    await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData()]);
    toast(
      action === "approve" ? "대여 요청을 승인했습니다. 해당 기간 예약이 확정되었습니다."
      : action === "reject" ? "대여 요청을 거절했습니다."
      : "대여 요청을 취소했습니다."
    );
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
    if (error?.status === 401) {
      savePendingIntentAndRedirectLogin(null, "세션이 만료되었습니다. 다시 로그인해 주세요.");
      return;
    }
    toast(error?.message || "요청 상태를 변경하지 못했습니다.");
    if (button) button.disabled = false;
  }
}

function renderRequestActionsHtml(req) {
  const actions = [];
  if (req.canApprove) {
    actions.push(`<button type="button" class="button button-primary button-sm" data-req-approve="${escapeHtml(req.id)}">승인</button>`);
  }
  if (req.canReject) {
    actions.push(`<button type="button" class="button button-secondary button-sm" data-req-reject="${escapeHtml(req.id)}">거절</button>`);
  }
  if (req.canCancel) {
    actions.push(`<button type="button" class="button button-secondary button-sm" data-req-cancel="${escapeHtml(req.id)}">요청 취소</button>`);
  }
  return actions.join("");
}

function renderBuyerRequests() {
  const listEl = $("buyerRequestList");
  const convEl = $("buyerConversations");
  if (!listEl) return;

  if (!isLoggedIn()) {
    listEl.innerHTML = `<div class="empty-panel">로그인하면 내가 보낸 대여 요청과 확정된 예약을 확인할 수 있어요.</div>`;
    if (convEl) convEl.innerHTML = `<div class="empty-panel">로그인하면 내 1:1 채팅 문의 내역을 확인할 수 있어요.</div>`;
    return;
  }

  listEl.innerHTML = outgoingRequests.length
    ? outgoingRequests.map((req) => `
      <div class="request-row">
        <div class="owner-row-info">
          <div class="owner-row-badges">
            ${renderRequestBadge(req)}
            <span class="spec-tag">${req.days}일 · ${money(req.totalPrice)}</span>
          </div>
          <strong>${escapeHtml(req.listingTitle || "농기계 매물")}</strong>
          <small>대여 기간: ${escapeHtml(req.start)} ~ ${escapeHtml(req.end)} · 소유자 ${escapeHtml(req.listingOwnerName || "-")}${req.note ? `<br>내 메모: ${escapeHtml(req.note)}` : ""}</small>
        </div>
        <div class="owner-row-actions">
          <button type="button" class="button button-secondary button-sm" data-open-chat-listing="${escapeHtml(req.listingId)}">1:1 채팅</button>
          ${req.canCancel ? `<button type="button" class="button button-secondary button-sm" data-req-cancel="${escapeHtml(req.id)}">요청 취소</button>` : ""}
        </div>
      </div>`).join("")
    : `<div class="empty-panel">아직 보낸 대여 요청이 없어요. 매물 상세에서 대여를 신청하면 여기에서 상태를 볼 수 있어요.</div>`;

  if (convEl) {
    const buyerConvs = userConversations.filter((c) => c.buyerId === accountUser?.id);
    convEl.innerHTML = buyerConvs.length
      ? buyerConvs.map((c) => `
        <div class="request-row">
          <div class="owner-row-info">
            <span class="step-pill">판매자: ${escapeHtml(c.ownerName)}</span>
            <strong>${escapeHtml(c.listingTitle)}</strong>
            <small>${c.lastMessage ? escapeHtml(c.lastMessage.body) : "대화 시작하기"}</small>
          </div>
          <div class="owner-row-actions">
            <button type="button" class="button button-primary button-sm" data-open-chat="${escapeHtml(c.id)}" data-chat-listing="${escapeHtml(c.listingId)}">대화 보기</button>
          </div>
        </div>`).join("")
      : `<div class="empty-panel">아직 시작한 채팅 문의가 없습니다.</div>`;
  }
}

function renderGuestImportBanner() {
  const banner = $("guestImportBanner");
  if (!banner) return;
  if (!isLoggedIn() || dismissGuestImport) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  const gFavs = readGuestFavorites();
  const gOwned = garage?.getGuestOwned() || [];
  if (!gFavs.length && !gOwned.length) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  banner.hidden = false;
  banner.innerHTML = `
    <div class="guest-import-copy">
      <strong>로그인 전에 담은 항목을 내 계정으로 가져올까요?</strong>
      <small>브라우저 임시 보관함: 찜한 매물 ${gFavs.length}건 · 보유 농기계 ${gOwned.length}대</small>
    </div>
    <div class="guest-import-actions">
      <button type="button" class="button button-primary button-sm" id="importGuestConfirm">내 계정에 가져오기</button>
      <button type="button" class="button button-secondary button-sm" id="importGuestDismiss">건너뛰기</button>
    </div>
  `;
}

function renderOwner() {
  if (!isLoggedIn()) return;
  if ($("ownerAccountLabel")) {
    $("ownerAccountLabel").textContent = `${accountUser.name} 님의 농기계 관리`;
  }
  renderGuestImportBanner();

  const owned = allListings().filter((item) => item.ownerId === accountUser.id && item.status !== "removed");

  $("ownerStats").innerHTML = `
    <div class="stat-box">
      <span class="stat-icon" aria-hidden="true">${pictureIcon("sprout")}</span>
      <div><small>내가 등록한 농기계</small><strong>${owned.length}대</strong></div>
    </div>
    <div class="stat-box">
      <span class="stat-icon" aria-hidden="true">${pictureIcon("envelope")}</span>
      <div><small>승인 가능한 대여 요청</small><strong>${approvableRequestCount}건</strong></div>
    </div>
    <div class="stat-box">
      <span class="stat-icon" aria-hidden="true">${pictureIcon("handshake")}</span>
      <div><small>거래 완료된 판매</small><strong>${owned.filter((item) => item.type === "sale" && item.status === "done").length}건</strong></div>
    </div>
  `;

  $("ownerListings").innerHTML = owned.length
    ? owned.map((item) => `
      <div class="owner-row">
        <div class="owner-row-info">
          <div class="owner-row-badges">
            <span class="card-status-pill ${statusClass(item)}">${statusLabel(item)}</span>
            <span class="spec-tag">${item.type === "rent" ? "일일 대여" : "중고 판매"}</span>
          </div>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${money(item.price)}${item.type === "rent" ? " / 1일" : ""} · ${escapeHtml(item.region)}</small>
          ${item.type === "rent" ? `<small>예약된 기간 · ${item.booked.length
            ? item.booked.slice().sort((a, b) => a.start.localeCompare(b.start))
              .map(({ start, end }) => escapeHtml(start + " ~ " + end)).join(" / ")
            : "없음"}</small>` : ""}
        </div>
        <div class="owner-row-actions">
          <select class="owner-status-select" data-owner-status="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 상태 변경">
            <option value="open" ${item.status === "open" ? "selected" : ""}>${item.type === "rent" ? "대여 가능" : "판매 가능"}</option>
            <option value="dealing" ${item.status === "dealing" ? "selected" : ""}>거래 중</option>
            <option value="done" ${item.status === "done" ? "selected" : ""}>거래 완료</option>
          </select>
          <button type="button" class="button button-secondary button-sm" data-owner-detail="${escapeHtml(item.id)}">상세</button>
          <button type="button" class="button button-secondary button-sm" data-owner-edit="${escapeHtml(item.id)}">수정</button>
          <button type="button" class="button button-secondary button-sm" data-owner-remove="${escapeHtml(item.id)}">숨기기</button>
        </div>
      </div>`).join("")
    : `<div class="empty-panel">아직 등록한 농기계가 없습니다. 상단 '+ 새 농기계 등록' 버튼을 눌러 등록해 보세요.</div>`;

  $("ownerRequests").innerHTML = incomingRequests.length
    ? incomingRequests.map((req) => `
      <div class="request-row">
        <div class="owner-row-info">
          <div class="owner-row-badges">
            ${renderRequestBadge(req)}
            <span class="spec-tag">${req.days}일 · ${money(req.totalPrice)}</span>
          </div>
          <strong>${escapeHtml(req.listingTitle || "농기계")}</strong>
          <small>요청자: ${escapeHtml(req.requesterName)} · 희망 기간: ${escapeHtml(req.start)} ~ ${escapeHtml(req.end)}${req.note ? `<br>메모: ${escapeHtml(req.note)}` : ""}</small>
        </div>
        <div class="owner-row-actions">
          ${renderRequestActionsHtml(req)}
        </div>
      </div>`).join("")
    : `<div class="empty-panel">도착한 대여 요청이 없습니다.</div>`;

  const ownerConvsEl = $("ownerConversations");
  if (ownerConvsEl) {
    const ownerConvs = userConversations.filter((c) => c.ownerId === accountUser?.id);
    ownerConvsEl.innerHTML = ownerConvs.length
      ? `<div class="panel-header" style="margin-top:8px"><h3>도착한 1:1 채팅 문의</h3><small>${ownerConvs.length}개 대화</small></div>` + ownerConvs.map((c) => `
        <div class="request-row">
          <div class="owner-row-info">
            <span class="step-pill">문의자: ${escapeHtml(c.buyerName)}</span>
            <strong>${escapeHtml(c.listingTitle)}</strong>
            <small>${c.lastMessage ? `"${escapeHtml(c.lastMessage.body)}"` : "새 대화"}</small>
          </div>
          <div class="owner-row-actions">
            <button type="button" class="button button-secondary button-sm" data-open-chat="${escapeHtml(c.id)}" data-chat-listing="${escapeHtml(c.listingId)}">대화하기</button>
          </div>
        </div>`).join("")
      : "";
  }
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("사진 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function listingFormModal({ mode = "create", item = null, draftValues = null } = {}) {
  const isEdit = mode === "edit" && Boolean(item);
  if (!isLoggedIn()) {
    savePendingIntentAndRedirectLogin({ type: isEdit ? "editListing" : "newListing", listingId: item?.id, draftValues });
    return;
  }

  let draftListingId = isEdit ? item.id : (draftValues?.id || crypto.randomUUID());
  const val = (key, fallback) => (draftValues && draftValues[key] !== undefined ? draftValues[key] : (item ? item[key] : fallback));
  const initialType = val("type", "rent");
  const initialModelId = val("modelId", "");
  const initialMachineType = val("machineType", MACHINE_TYPES[0].id);
  const initialBrand = val("brand", "직접 등록");
  const initialTitle = val("title", "");
  const initialCrop = (Array.isArray(val("cropIds", null)) ? val("cropIds", null)[0] : null)
    || (state.selectedCrop && state.selectedCrop !== "all" ? state.selectedCrop : CROPS[0].id);
  const initialOp = (Array.isArray(val("operations", null)) ? val("operations", null)[0] : null) || OPERATIONS[0].id;
  const initialPrice = val("price", "");
  const initialAreaMin = val("areaMin", 300);
  const initialAreaMax = val("areaMax", 1500);
  const initialRegion = val("region", state.region || "영양읍");
  const initialCondition = val("condition", "good");
  const initialInspected = val("inspectedAt", today());
  const initialIncluded = val("included", "");
  const initialPickup = val("pickup", "");
  const initialDescription = val("description", "");

  openForm(`
    <span class="step-pill">${isEdit ? "매물 수정" : "농기계 등록"}</span>
    <h2 id="formTitle">${isEdit ? "내 농기계 정보 수정" : "내 농기계 올리기"}</h2>
    <p>모든 회원이 직접 매물을 등록하고 관리할 수 있으며 서버 데이터베이스에 안전하게 저장됩니다.</p>
    <form class="stack-form" id="listingEditorForm">
      <div class="form-row-2">
        <label>거래 방식
          <select id="editType">
            <option value="rent" ${initialType === "rent" ? "selected" : ""}>빌려주기 (일일 대여)</option>
            <option value="sale" ${initialType === "sale" ? "selected" : ""}>중고로 판매하기</option>
          </select>
        </label>
        <label>등록 기종 (선택 시 사양 자동 연결)
          <select id="editModelId">
            <option value="">목록에 없는 기종 (직접 입력)</option>
            ${MACHINE_SPECIFICATIONS.map((m) => `<option value="${escapeHtml(m.id)}" ${initialModelId === m.id ? "selected" : ""}>${escapeHtml(m.brand)} ${escapeHtml(m.model)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="form-row-2">
        <label>농기계 종류
          <select id="editMachine">${MACHINE_TYPES.map((m) => `<option value="${escapeHtml(m.id)}" ${initialMachineType === m.id ? "selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}</select>
        </label>
        <label>제조사
          <input id="editBrand" maxlength="40" required value="${escapeHtml(initialBrand)}">
        </label>
      </div>
      <div class="form-row-2">
        <label>게시글 제목<input id="editTitle" maxlength="80" required value="${escapeHtml(initialTitle)}" placeholder="예: 초보자도 쉬운 관리기 + 두둑성형기 세트 대여"></label>
        <label>보관/거래 지역
          <select id="editRegion">
            ${["영양읍", "청기면", "입암면", "수비면"].map((r) => `<option value="${escapeHtml(r)}" ${initialRegion === r ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="form-row-2">
        <label>추천 작물<select id="editCrop">${CROPS.map((c) => `<option value="${escapeHtml(c.id)}" ${initialCrop === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
        <label>세부 작업<select id="editOperation">${OPERATIONS.map((o) => `<option value="${escapeHtml(o.id)}" ${initialOp === o.id ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}</select></label>
      </div>
      <div class="form-row-3">
        <label>요금/가격(원)<input id="editPrice" type="number" min="0" step="1000" required value="${escapeHtml(initialPrice)}" placeholder="예: 50000"></label>
        <label>최소 권장 면적(㎡)<input id="editAreaMin" type="number" min="1" required value="${escapeHtml(initialAreaMin)}" placeholder="예: 300"></label>
        <label>최대 권장 면적(㎡)<input id="editAreaMax" type="number" min="1" required value="${escapeHtml(initialAreaMax)}" placeholder="예: 1500"></label>
      </div>
      <div class="form-row-2">
        <label>기계 상태
          <select id="editCondition">
            <option value="good" ${initialCondition === "good" ? "selected" : ""}>정상 작동</option>
            <option value="used" ${initialCondition === "used" ? "selected" : ""}>사용감 있음</option>
            <option value="repair" ${initialCondition === "repair" ? "selected" : ""}>정비 필요</option>
          </select>
        </label>
        <label>최근 점검일<input id="editInspection" type="date" max="${today()}" value="${escapeHtml(initialInspected)}" required></label>
      </div>
      <label>기계 사진 업로드 (선택, JPG·PNG·WebP, 1MB 이하)<input id="editPhoto" type="file" accept="image/png,image/jpeg,image/webp"></label>
      ${isEdit && hasListingPhoto(item) ? `<label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="editRemovePhoto" style="width:auto"> 등록된 기존 사진 삭제하기</label>` : ""}
      <div class="form-row-2">
        <label>포함 작업기·부속품<input id="editIncluded" maxlength="120" required value="${escapeHtml(initialIncluded)}" placeholder="예: 로터리, 두둑성형기 포함"></label>
        <label>인수·전달 방법<input id="editPickup" maxlength="120" required value="${escapeHtml(initialPickup)}" placeholder="예: 영양읍 창고 직접 방문 인수"></label>
      </div>
      <label>상세 설명 및 초보자 안내<textarea id="editDescription" maxlength="1000" required placeholder="기계 작동 상태와 초보 농부님이 사용할 때 주의할 점을 적어주세요.">${escapeHtml(initialDescription)}</textarea></label>
      <button class="button button-primary button-large" type="submit" id="listingSubmitButton">${isEdit ? "수정 내용 저장하기" : "+ 매물 등록 완료하기"}</button>
    </form>
  `);

  const syncModelLock = () => {
    const modelId = $("editModelId").value;
    const spec = modelId ? SPEC_BY_ID[modelId] : null;
    if (spec) {
      $("editBrand").value = spec.brand;
      $("editMachine").value = spec.machineType;
      $("editBrand").disabled = true;
      $("editMachine").disabled = true;
    } else {
      $("editBrand").disabled = false;
      $("editMachine").disabled = false;
    }
  };
  syncModelLock();
  $("editModelId").addEventListener("change", syncModelLock);

  let busy = false;
  let lastSubmitHash = null;

  $("listingEditorForm").addEventListener("input", () => {
    if (!isEdit && lastSubmitHash !== null) {
      draftListingId = crypto.randomUUID();
      lastSubmitHash = null;
    }
  });

  $("listingEditorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const areaMin = Number($("editAreaMin").value);
    const areaMax = Number($("editAreaMax").value);
    if (!Number.isFinite(areaMin) || !Number.isFinite(areaMax) || areaMin < 1 || areaMin > areaMax) {
      return toast("권장 면적 범위를 올바르게 입력해 주세요.");
    }

    const file = $("editPhoto").files[0];
    if (file && file.size > 1024 * 1024) {
      return toast("JPG·PNG·WebP 사진을 1MB 이하로 선택해 주세요.");
    }

    let photoDataUrl = draftValues?.photoDataUrl || undefined;
    if (file) {
      try {
        photoDataUrl = await readImageFileAsDataUrl(file);
      } catch (err) {
        return toast(err?.message || "사진을 읽지 못했습니다.");
      }
    }

    const modelId = $("editModelId").value || null;
    const payload = {
      action: isEdit ? "update" : "create",
      id: draftListingId,
      type: $("editType").value,
      modelId,
      brand: $("editBrand").value.trim(),
      machineType: $("editMachine").value,
      title: $("editTitle").value.trim(),
      region: $("editRegion").value,
      cropIds: [$("editCrop").value],
      operations: [$("editOperation").value],
      price: Number($("editPrice").value),
      areaMin,
      areaMax,
      condition: $("editCondition").value,
      inspectedAt: $("editInspection").value,
      included: $("editIncluded").value.trim(),
      pickup: $("editPickup").value.trim(),
      description: $("editDescription").value.trim(),
      ...(photoDataUrl ? { photoDataUrl } : {}),
      ...(isEdit && $("editRemovePhoto")?.checked ? { removePhoto: true } : {}),
    };

    lastSubmitHash = JSON.stringify(payload);
    busy = true;
    $("listingSubmitButton").disabled = true;

    try {
      await apiFetch("/api/listings", { method: "POST", json: payload });
      hideDialog($("formBackdrop"));
      await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData()]);
      renderOwner();
      toast(isEdit ? "매물 정보를 수정했습니다." : "새 농기계 매물을 등록했습니다!");
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if (error?.status === 401) {
        savePendingIntentAndRedirectLogin(
          { type: isEdit ? "editListing" : "newListing", listingId: item?.id, draftValues: payload },
          "세션이 만료되었습니다. 로그인 후 이어서 등록할 수 있어요."
        );
        return;
      }
      toast(error?.message || "매물을 저장하지 못했습니다.");
    } finally {
      busy = false;
      if ($("listingSubmitButton")) $("listingSubmitButton").disabled = false;
    }
  });
}

function openNewListing(draftValues = null) {
  listingFormModal({ mode: "create", draftValues });
}

function openEditListing(item, draftValues = null) {
  listingFormModal({ mode: "edit", item, draftValues });
}

function openFavoritesModal() {
  const favIds = activeFavorites();
  const items = allListings().filter((item) => favIds.includes(item.id));
  openForm(`
    <span class="step-pill">관심 농기계 보관함</span>
    <h2 id="formTitle"> 내가 찜한 농기계 (${items.length}대)</h2>
    <p>비교해 보고 싶은 농기계를 모아두었어요. 버튼을 눌러 상세 조건을 확인하세요.</p>
    <div class="fav-modal-list">
      ${
        items.length
          ? items
              .map(
                (item) => `
          <div class="fav-modal-item">
            <button type="button" class="fav-thumb" data-favorite-detail="${item.id}" aria-label="${escapeHtml(item.title)} 상세 보기">${machineVisual(item)}</button>
            <div class="fav-item-info">
              <span class="spec-tag">${item.type === "rent" ? "일일 대여" : "중고 판매"} · ${escapeHtml(item.region)}</span>
              <strong>${escapeHtml(item.title)}</strong>
              <span class="fav-item-price">${money(item.price)}${item.type === "rent" ? " / 1일" : ""}</span>
            </div>
            <div class="fav-item-actions">
              <button type="button" class="button button-secondary button-sm" data-fav-remove="${item.id}">찜 해제</button>
              <button type="button" class="button button-primary button-sm" data-favorite-detail="${item.id}">상세 보기 ›</button>
            </div>
          </div>`
              )
              .join("")
          : `<div class="empty-panel">아직 찜한 농기계가 없습니다. 마음에 드는 농기계 카드 우측 상단의 찜 버튼을 눌러보세요!</div>`
      }
    </div>
  `);
  $("formContent")
    .querySelectorAll("[data-favorite-detail]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        hideDialog($("formBackdrop"));
        openDetail(button.dataset.favoriteDetail);
      })
    );
  $("formContent")
    .querySelectorAll("[data-fav-remove]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        toggleFavorite(button.dataset.favRemove, { favorite: false, fromModal: true });
      })
    );
}

function appendAiMessage(text, role, listingIds = []) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  const textNode = document.createElement("div");
  textNode.textContent = text;
  bubble.append(textNode);

  if (listingIds.length) {
    const results = document.createElement("div");
    results.className = "ai-result";
    const titleEl = document.createElement("div");
    titleEl.className = "ai-result-title";
    titleEl.textContent = " 농농이가 찾은 맞춤 매물";
    results.append(titleEl);

    listingIds.forEach((id) => {
      const item = listingById(id);
      if (!item) return;
      const cardBtn = document.createElement("button");
      cardBtn.type = "button";
      cardBtn.className = "ai-rec-card-btn";
      cardBtn.innerHTML = `
        <span class="ai-rec-info">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.region)} · ${money(item.price)}${item.type === "rent" ? "/일" : ""}</small>
          <small>${escapeHtml(areaLabel(item.areaMin, item.areaMax))} · ${escapeHtml(item.pickup || "인수 방법 문의")}</small>
        </span>
        <span class="ai-rec-cta">상세 보기 ›</span>
      `;
      cardBtn.addEventListener("click", () => openDetail(item.id));
      results.append(cardBtn);
    });
    bubble.append(results);
  }
  $("aiMessages").append(bubble);
  scrollAiToEnd();
  return bubble;
}

function scrollAiToEnd() {
  const scroll = $("aiScroll");
  scroll.scrollTop = scroll.scrollHeight;
}

let conversation;
let recommendationPending = false;
const aiDefaultPlaceholder = $("aiInput").placeholder;
const aiInputExamples = {
  crop: "예: 감자",
  operation: "예: 밭에 비닐을 씌우려고 해요",
  transaction: "예: 기계를 빌리고 싶어요",
  area: "예: 300평",
  date: "시작일과 반납일을 입력해 주세요",
  budget: "예: 7만 원 이하",
};

function askFollowUp(question, reply = question.reply) {
  $("aiInput").placeholder = aiInputExamples[question.field] || aiDefaultPlaceholder;
  const bubble = appendAiMessage(reply, "assistant");
  const choices = document.createElement("div");
  choices.className = "prompt-suggestions ai-follow-up";
  for (const choice of question.choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => {
      if (recommendationPending || !choices.isConnected) return;
      $("aiInput").value = choice;
      $("aiForm").requestSubmit();
    });
    choices.append(button);
  }
  bubble.append(choices);
  scrollAiToEnd();
}

async function sendAiQuestion(event) {
  event.preventDefault();
  const message = $("aiInput").value.trim();
  if (!message || recommendationPending) return;
  if (message.length > 500) return toast("질문을 500자 이내로 입력해 주세요.");

  recommendationPending = true;
  const submit = $("aiForm").querySelector('[type="submit"]');
  submit.disabled = true;
  $("aiInput").value = "";
  $("aiInput").placeholder = aiDefaultPlaceholder;
  $("aiStarters").hidden = true;
  $("aiMessages").querySelectorAll(".ai-follow-up").forEach((choices) => choices.remove());
  appendAiMessage(message, "user");
  let pending;

  try {
    const filters = {
      transaction: state.transaction,
      region: state.region,
      sort: state.sort,
      radius: state.filters.radius,
      date: state.filters.date,
      dateEnd: state.filters.dateEnd,
    };
    const previous = conversation;
    let turn = conversationTurn(message, filters, previous);
    let interpreted = false;
    const directAnswer = previous?.question?.choices.includes(message)
      || (previous?.field && /^\d[\d,.\s~년월일평㎡만원/-]*$/.test(message));
    if (!turn.reply && !directAnswer) {
      pending = appendAiMessage("말씀하신 조건을 확인하고 있어요…", "assistant");
      const result = await askRecommendation(message, {
        action: "interpret",
        cropId: previous?.context?.cropIds?.[0],
        field: previous?.field,
      }).catch(() => null);
      if (result?.intent === "search" && result.query) {
        turn = conversationTurn(result.query, filters, previous);
        interpreted = true;
      } else if (result?.intent === "help" || result?.intent === "rental_help") {
        const question = result.intent === "help" ? "뭐해" : "대여 신청 방법";
        turn = conversationTurn(question, filters, previous);
        interpreted = true;
      } else if (result?.intent === "unrelated") {
        turn = unrelatedTurn(previous);
      }
      pending.remove();
    }
    conversation = turn;
    if (conversation.reply || conversation.question) {
      if (conversation.question) {
        const reply = [conversation.reply, conversation.question.reply].filter(Boolean).join("\n\n");
        askFollowUp(conversation.question, reply);
      } else {
        appendAiMessage(conversation.reply, "assistant");
      }
      if (turn.reset) {
        conversation = undefined;
        $("aiStarters").hidden = false;
      }
      $("aiModeLabel").textContent = interpreted ? "AI 조건 해석 · 상담 안내" : "농기계 상담";
      return;
    }

    pending = appendAiMessage("조건에 맞는 매물을 확인하고 있어요…", "assistant");
    if (catalogState === "error") await loadCatalog();
    else await catalogReady;

    const { context } = conversation;
    const selection = selectMatchingListings("", context, allListings());
    const candidateIds = selection.candidates.map(({ id }) => id);
    const guide = recommendationGuide(selection);
    let result = guide;
    if (catalogState !== "ready" && !guide.listingIds.length) {
      appendAiMessage("매물 목록에 연결하지 못했어요. 입력한 조건은 기억하고 있어요. ‘바로 추천’을 입력해 다시 확인해 주세요.", "assistant");
      return;
    }

    // Catalog candidates can receive an AI explanation. Local demo listings use the same filters.
    if (guide.listingIds.length && candidateIds.every((id) => catalog.some((item) => item.id === id))) {
      try {
        result = await askRecommendation("조건에 맞는 매물", { ...context, candidateIds });
      } catch {
        result = guide;
      }
    }

    const current = selectMatchingListings("", context, allListings());
    if (current.candidates.map(({ id }) => id).join() !== candidateIds.join()) result = recommendationGuide(current);
    const { cropId, operations, combined, transaction, maxPrice, areaPyeong, date, dateEnd } = current;
    // Summarize only verified search conditions and the actual recommended listings.
    // Use textContent throughout so listing metadata cannot inject markup.
    const matched = result.listingIds.map((id) => allListings().find((item) => item.id === id)).filter(Boolean);
    const showDate = (value) => value ? value.slice(5).replace("-", "/") : "";
    const dateText = date ? showDate(date) + " ~ " + showDate(dateEnd || date) : "";
    const formatBudget = maxPrice && Number.isFinite(maxPrice / 10000) && maxPrice % 10000 === 0
      ? (maxPrice / 10000).toLocaleString("ko-KR") + "만 원"
      : maxPrice ? money(maxPrice) : "";
    const bubble = appendAiMessage(
      matched.length ? `🚜 조건에 맞는 농기계 ${matched.length}개를 찾았어요!` : result.reply,
      "assistant", result.listingIds,
    );
    if (matched.length) {
      // Keep two related facts on each row, matching the concise recommendation format.
      // Construct DOM text nodes instead of interpreting listing data as HTML.
      const overview = document.createElement("div");
      overview.className = "ai-rec-overview";
      const cropName = CROP_BY_ID[cropId]?.name;
      const workName = operations.map((id) => OPERATION_BY_ID[id].label).join(combined ? " + " : " · ");
      const rows = [
        [["🥬 작물", cropName], ["작업", workName]],
        [["📏 면적", areaPyeong ? Math.round(areaPyeong).toLocaleString("ko-KR") + "평" : ""],
         ["예산", formatBudget ? (transaction === "rent" ? "하루 " : "") + formatBudget + " 이하" : ""]],
        [["📅 대여 기간", transaction === "rent" ? dateText : ""]],
      ];
      if (transaction === "sale") rows.push([["거래 방식", "구매"]]);
      for (const rowFields of rows) {
        const present = rowFields.filter(([, value]) => value);
        if (!present.length) continue;
        const row = document.createElement("div");
        row.className = "ai-rec-row";
        for (const [index, [label, value]] of present.entries()) {
          if (index) {
            const separator = document.createElement("span");
            separator.className = "ai-rec-separator";
            separator.textContent = " | ";
            row.append(separator);
          }
          const labelNode = document.createElement("strong");
          labelNode.textContent = label + ":";
          row.append(labelNode, document.createTextNode(" " + value));
        }
        overview.append(row);
      }

      const comparison = document.createElement("div");
      comparison.className = "ai-rec-comparison";
      const title = document.createElement("strong");
      title.textContent = "추천 매물 비교";
      comparison.append(title);
      const shorten = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 38);
      for (const item of matched) {
        const line = document.createElement("div");
        line.className = "ai-rec-comparison-item";
        const name = document.createElement("strong");
        name.textContent = "• " + (item.title || "농기계 매물") + ":";
        line.append(name);
        // Favor short, factual equipment and pickup details over an AI paragraph.
        const features = [shorten(item.included), shorten(item.pickup)].filter(Boolean);
        if (!features.length && result.summaries?.[item.id]) features.push(shorten(result.summaries[item.id]));
        line.append(document.createTextNode(features.length ? " " + features.join(" · ") : " 상세 보기에서 확인"));
        const price = document.createElement("span");
        price.className = "ai-rec-price";
        price.textContent = money(item.price) + (item.type === "rent" ? "/일" : "");
        line.append(price);
        comparison.append(line);
      }
      const info = document.createElement("div");
      info.className = "ai-rec-notice";
      info.textContent = maxPrice
        ? "✅ 모두 작업 조건과 예산에 맞아요!"
        : "✅ 모두 작업 조건에 맞아요!";
      const caution = document.createElement("div");
      caution.className = "ai-rec-notice";
      caution.textContent = transaction === "rent"
        ? "💡 예약 가능 여부와 총 대여료는 확인해 주세요."
        : "💡 거래 가능 여부와 최종 가격은 확인해 주세요.";
      const cards = bubble.querySelector(".ai-result");
      for (const section of [overview, comparison, info, caution]) {
        if (cards) bubble.insertBefore(section, cards);
        else bubble.append(section);
      }
    }
    $("aiModeLabel").textContent = result.mode === "ai" ? "AI 요약 · 등록 매물 기반" : "등록 매물 조건 검색";
    if (result.mode === "ai" && result.summaries && typeof result.summaries === "object") {
      Object.assign(state.aiSummaries, result.summaries);
      persist();
      renderListings();
    }
  } catch (error) {
    console.error("추천을 표시하지 못했습니다.", error);
    appendAiMessage("추천을 표시하지 못했어요. 같은 조건으로 다시 보려면 ‘바로 추천’을 입력해 주세요.", "assistant");
  } finally {
    pending?.remove();
    recommendationPending = false;
    submit.disabled = false;
  }
}

function syncAiViewport() {
  const panel = $("aiPanel");
  const viewport = window.visualViewport;
  if (panel.hidden || !viewport) return;
  panel.style.setProperty("--ai-visible-top", `${viewport.offsetTop}px`);
  panel.style.setProperty("--ai-visible-height", `${viewport.height}px`);
}

function openAiPanel() {
  $("aiPanel").hidden = false;
  document.body.classList.add("ai-open");
  $("aiLauncher").setAttribute("aria-expanded", "true");
  syncAiViewport();
  $("aiClose").focus({ preventScroll: true });
}

function toggleAiPanelSize() {
  const button = $("aiExpand");
  const expanded = $("aiPanel").classList.toggle("is-expanded");
  button.setAttribute("aria-pressed", String(expanded));
  button.title = expanded ? "채팅창 원래 크기로" : "채팅창 확대";
  button.firstElementChild.textContent = expanded ? "⤡" : "⤢";
}

function resetAllFilters() {
  state.filters = blankFilters();
  state.selectedCrop = "all";
  $("searchInput").value = "";
  persist();
  renderAll();
  toast("모든 검색 조건을 초기화했습니다.");
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
    persist();
    renderAll();
  });
  $("rentTab").addEventListener("click", () => setTransaction("rent"));
  $("saleTab").addEventListener("click", () => setTransaction("sale"));

  $("regionSelect").addEventListener("change", (event) => {
    state.region = event.target.value;
    persist();
    renderAll();
    toast(`내 동네가 '${state.region}'(으)로 설정되었습니다.`);
  });

  // 상단 빠른 검색바 연동
  $("searchInput").addEventListener("input", () => renderListings());
  $("listingSort").value = state.sort;
  $("listingSort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    persist();
    renderListings();
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
    renderListings();
    setView("browse");
  });
  initLoginForm();
  $("quickDateInput")?.addEventListener("change", (event) => {
    state.filters.date = event.target.value;
    if (!state.filters.date || state.filters.dateEnd < state.filters.date) state.filters.dateEnd = state.filters.date ? addDays(state.filters.date, 1) : "";
    persist();
    renderAll();
  });
  $("quickDateEndInput")?.addEventListener("change", (event) => {
    const end = event.target.value;
    if (!state.filters.date) state.filters.date = today();
    state.filters.dateEnd = end && end >= state.filters.date ? end : state.filters.date;
    persist();
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
    persist();
    renderAll();
  });
  $("quickRadiusSelect")?.addEventListener("change", (event) => {
    state.filters.radius = event.target.value;
    persist();
    renderAll();
  });

  $("guideResults").addEventListener("click", () => {
    setView("browse");
    $("marketTitle").focus();
  });
  $("openFilters").addEventListener("click", () => openFilters());
  $("inlineResetFilters")?.addEventListener("click", resetAllFilters);

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
    persist();
    renderAll();
  });

  // 상세 필터 모달 이벤트
  $("closeFilters").addEventListener("click", () => hideDialog($("filterBackdrop")));
  $("applyFilters").addEventListener("click", applyFilters);
  $("resetFilters").addEventListener("click", () => {
    draft = blankFilters();
    renderFilterOptions();
  });

  $("filterBackdrop").addEventListener("change", (event) => {
    const input = event.target.closest("[data-filter-group]");
    if (input) {
      const list = draft[input.dataset.filterGroup];
      draft[input.dataset.filterGroup] = input.checked ? [...new Set([...list, input.value])] : list.filter((value) => value !== input.value);
      if (input.dataset.filterGroup === "stageIds") {
        draft.operations = draft.operations.filter((id) => !draft.stageIds.length || draft.stageIds.includes(OPERATION_BY_ID[id]?.stage));
      }
      renderFilterOptions();
      return;
    }
    renderFilterPreview();
  });

  $("filterBackdrop").addEventListener("click", (event) => {
    const areaPreset = event.target.closest("[data-area-preset]");
    if (areaPreset) {
      draft.areaPyeong = areaPreset.dataset.areaPreset;
      $("areaInput").value = draft.areaPyeong;
      renderFilterOptions();
      return;
    }
    const pricePreset = event.target.closest("[data-price-preset]");
    if (pricePreset) {
      draft.maxPrice = pricePreset.dataset.pricePreset;
      $("maxPrice").value = draft.maxPrice;
      renderFilterOptions();
      return;
    }
    if (event.target === $("filterBackdrop")) hideDialog($("filterBackdrop"));
  });

  $("filterBackdrop").addEventListener("input", renderFilterPreview);

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

  $("listingGrid").addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-detail]");
    if (detailButton) return openDetail(detailButton.dataset.detail);
    const favoriteButton = event.target.closest("[data-favorite]");
    if (favoriteButton) return toggleFavorite(favoriteButton.dataset.favorite);
    if (event.target.closest("[data-reset-all]")) resetAllFilters();
  });

  $("detailContent").addEventListener("click", (event) => {
    const favBtn = event.target.closest("[data-detail-fav]");
    if (favBtn) return toggleFavorite(favBtn.dataset.detailFav);
    const manageBtn = event.target.closest("[data-detail-manage]");
    if (manageBtn) {
      hideDialog($("detailBackdrop"));
      setView("owner");
      return;
    }
    const chatBtn = event.target.closest("[data-detail-chat]");
    if (chatBtn) {
      hideDialog($("detailBackdrop"));
      chatForm({ listingId: chatBtn.dataset.detailChat });
      return;
    }
    const button = event.target.closest("[data-detail-action]");
    if (!button) return;
    hideDialog($("detailBackdrop"));
    const item = listingById(button.dataset.detailAction);
    if (!item) return;
    item.type === "rent" ? rentalForm(item.id) : chatForm({ listingId: item.id });
  });

  $("newListingButton")?.addEventListener("click", () => openNewListing());

  $("guestImportBanner")?.addEventListener("click", async (event) => {
    if (event.target.closest("#importGuestDismiss")) {
      dismissGuestImport = true;
      renderGuestImportBanner();
      return;
    }
    const confirmBtn = event.target.closest("#importGuestConfirm");
    if (!confirmBtn) return;
    confirmBtn.disabled = true;
    try {
      const gFavs = readGuestFavorites();
      const gOwned = garage?.getGuestOwned() || [];
      const res = await apiFetch("/api/me", {
        method: "POST",
        json: { action: "importGuest", favorites: gFavs, ownedMachines: gOwned },
      });
      clearGuestFavorites();
      garage?.clearGuestOwned();
      if (res?.userData) {
        serverFavorites = Array.isArray(res.userData.favorites) ? res.userData.favorites : [];
        garage?.setExternalOwned(res.userData.ownedMachines || [], res.userData.selectedOwnedMachineId || "");
      }
      renderGuestImportBanner();
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
      renderOwner();
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
    if (detailBtn) return openDetail(detailBtn.dataset.ownerDetail);
    const editBtn = event.target.closest("[data-owner-edit]");
    if (editBtn) {
      const target = listingById(editBtn.dataset.ownerEdit);
      if (target) openEditListing(target);
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
        renderOwner();
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
    if (approveBtn) return handleRequestAction("approve", approveBtn.dataset.reqApprove, approveBtn);
    const rejectBtn = event.target.closest("[data-req-reject]");
    if (rejectBtn) return handleRequestAction("reject", rejectBtn.dataset.reqReject, rejectBtn);
    const cancelBtn = event.target.closest("[data-req-cancel]");
    if (cancelBtn) return handleRequestAction("cancel", cancelBtn.dataset.reqCancel, cancelBtn);
    const openChatBtn = event.target.closest("[data-open-chat]");
    if (openChatBtn) {
      return chatForm({
        conversationId: openChatBtn.dataset.openChat,
        listingId: openChatBtn.dataset.chatListing || null,
      });
    }
    const openListingChatBtn = event.target.closest("[data-open-chat-listing]");
    if (openListingChatBtn) {
      return chatForm({ listingId: openListingChatBtn.dataset.openChatListing });
    }
  };

  $("ownerRequests")?.addEventListener("click", handleRequestsAndChatsClick);
  $("ownerConversations")?.addEventListener("click", handleRequestsAndChatsClick);
  $("buyerRequestList")?.addEventListener("click", handleRequestsAndChatsClick);
  $("buyerConversations")?.addEventListener("click", handleRequestsAndChatsClick);


  $("aiLauncher").addEventListener("click", openAiPanel);
  $("aiExpand").addEventListener("click", toggleAiPanelSize);
  window.visualViewport?.addEventListener("resize", syncAiViewport);
  window.visualViewport?.addEventListener("scroll", syncAiViewport);
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
  $("aiForm").addEventListener("submit", sendAiQuestion);
  $("aiReset").addEventListener("click", () => {
    if (recommendationPending) return;
    conversation = undefined;
    $("aiMessages").replaceChildren();
    $("aiStarters").hidden = false;
    aiInput.value = "";
    aiInput.placeholder = aiDefaultPlaceholder;
    appendAiMessage("어떤 작물에 어떤 작업을 하실 건가요? 아는 조건부터 말씀해 주세요.", "assistant");
    $("aiInput").focus();
  });

  document.querySelectorAll("[data-prompt]").forEach((button) =>
    button.addEventListener("click", () => {
      if (recommendationPending) return;
      aiInput.value = button.dataset.prompt;
      $("aiForm").requestSubmit();
    })
  );

  document.querySelector('[data-action="favorites"]').addEventListener("click", openFavoritesModal);
}

// 초기 상태 동기화
if (state.selectedCrop && state.selectedCrop !== "all" && !state.filters.cropIds.length) {
  state.filters.cropIds = [state.selectedCrop];
}
$("regionSelect").value = state.region;
// 메인 배너: 4초마다 자동으로 다음 장, 멈춤/재생·이전/다음·점 선택
function initBannerCarousel() {
  const track = $("bannerTrack");
  if (!track) return;
  const slides = [...track.children];
  const dots = [...document.querySelectorAll(".banner-dot")];
  const pauseButton = $("bannerPause");
  let index = 0;
  let paused = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  let timer = null;

  const show = (next) => {
    index = (next + slides.length) % slides.length;
    track.style.transform = `translateX(-${index * 100}%)`;
    slides.forEach((slide, i) => {
      const current = i === index;
      slide.setAttribute("aria-hidden", String(!current));
      slide.classList.toggle("is-active", current);
      for (const el of slide.querySelectorAll("a, button")) el.tabIndex = current ? 0 : -1;
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
      if (i === index) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    $("bannerCounter").textContent = String(index + 1).padStart(2, "0");
  };
  const restart = () => {
    clearInterval(timer);
    if (!paused) timer = setInterval(() => show(index + 1), 4000);
  };
  const setPaused = (value) => {
    paused = value;
    pauseButton.classList.toggle("is-paused", paused);
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.setAttribute("aria-label", paused ? "자동 넘김 다시 시작" : "자동 넘김 멈추기");
    restart();
  };

  $("bannerPrev").addEventListener("click", () => { show(index - 1); restart(); });
  $("bannerNext").addEventListener("click", () => { show(index + 1); restart(); });
  pauseButton.addEventListener("click", () => setPaused(!paused));
  dots.forEach((dot, i) => dot.addEventListener("click", () => { show(i); restart(); }));
  for (const button of track.querySelectorAll("[data-banner-view]")) {
    button.addEventListener("click", () => setView(button.dataset.bannerView));
  }
  show(0);
  setPaused(paused);
}

// 아이디 기반 로그인 및 회원가입 화면
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
    accountUser = user ?? null;
    headerButton.textContent = isLoggedIn() ? `${accountUser.name} · 내 계정` : "로그인";
    updateBadges();
  }

  async function applyAccountTransition(nextUser) {
    const prevId = accountUser?.id || null;
    const nextId = nextUser?.id || null;
    const changed = prevId !== nextId;
    if (changed) {
      bumpAuthEpoch();
      resetAccountRuntimeState();
    }
    renderAccount(nextUser);
    if (changed) {
      catalogReady = loadCatalog({ quiet: true });
      await Promise.all([catalogReady, refreshAuthenticatedData()]);
    } else if (nextId) {
      await refreshAuthenticatedData();
    } else {
      garage?.refreshNote?.();
      updateBadges();
      renderBuyerRequests();
    }
  }

  onSessionExpiredHandler = () => {
    bumpAuthEpoch();
    resetAccountRuntimeState();
    renderAccount(null);
    garage?.resetToGuest();
  };

  function resumePendingIntentIfAny() {
    const intent = pendingIntent;
    pendingIntent = null;
    if (!intent) return false;
    if (intent.type === "rental") {
      setView("browse");
      rentalForm(intent.listingId, intent.draftValues || null);
      return true;
    }
    if (intent.type === "chat") {
      chatForm({
        listingId: intent.listingId,
        conversationId: intent.conversationId,
        draftBody: intent.draftBody || "",
      });
      return true;
    }
    if (intent.type === "newListing") {
      setView("owner");
      openNewListing(intent.draftValues || null);
      return true;
    }
    if (intent.type === "editListing") {
      setView("owner");
      const target = listingById(intent.listingId);
      if (target) openEditListing(target, intent.draftValues || null);
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
      pendingIntent = null;
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

// 브랜드 소개(모아농?) 화면: 스크롤로 보일 때마다 구역이 아래에서 떠오르며 나타난다
function initRevealOnScroll() {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) {
    for (const el of items) el.classList.add("is-visible");
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  for (const el of items) observer.observe(el);
}

// 상단바 높이를 CSS 변수로 알려 농농 상담창이 상단바 아래까지만 커지게 한다
function trackHeaderHeight() {
  const header = document.querySelector(".sidebar");
  if (!header) return;
  const apply = () => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
  apply();
  if ("ResizeObserver" in window) new ResizeObserver(apply).observe(header);
  else window.addEventListener("resize", apply);
}

// 토스 스타일 스크롤 모션: 글자가 스크롤에 맞춰 차례로 진해지고, 이미지는 커지며 천천히 움직인다
function initScrollMotion() {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const wordBlocks = [...document.querySelectorAll("[data-scroll-words]")];
  // 글자를 단어 단위로 나눈다 (<br>, <strong> 같은 태그는 그대로 둔다)
  const splitWords = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = child.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) frag.append(part);
          else {
            const span = document.createElement("span");
            span.className = "scroll-word";
            span.textContent = part;
            frag.append(span);
          }
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        splitWords(child);
      }
    }
  };
  for (const block of wordBlocks) splitWords(block);
  if (reduceMotion) {
    for (const w of document.querySelectorAll(".scroll-word")) w.classList.add("is-lit");
    return;
  }
  const growers = [...document.querySelectorAll("[data-scroll-grow]")];
  const parallax = [...document.querySelectorAll("[data-parallax]")];
  const clamp = (v) => Math.min(1, Math.max(0, v));
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight;
    const scrollY = window.scrollY;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    for (const block of wordBlocks) {
      if (block.offsetParent === null) continue;
      const r = block.getBoundingClientRect();
      // 블록 윗부분이 화면 아래 85% 지점에 닿을 때 시작해 화면 45% 지점을 지날 때 끝난다
      // 페이지 끝이라 그만큼 스크롤할 수 없으면, 맨 아래에 닿는 순간 끝나도록 맞춘다
      const absTop = r.top + scrollY;
      const start = absTop - vh * 0.85;
      const end = Math.min(absTop + r.height - vh * 0.45, maxScroll);
      const progress = end <= start ? (scrollY >= end ? 1 : 0) : clamp((scrollY - start) / (end - start));
      const words = block.querySelectorAll(".scroll-word");
      const lit = Math.round(progress * words.length);
      words.forEach((w, i) => w.classList.toggle("is-lit", i < lit));
    }
    for (const el of growers) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      const progress = clamp((vh - r.top) / (vh * 0.7));
      el.style.setProperty("--grow", (0.86 + 0.14 * progress).toFixed(4));
      el.style.setProperty("--grow-radius", `${Math.round(48 - 16 * progress)}px`);
    }
    for (const el of parallax) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      const center = (r.top + r.height / 2 - vh / 2) / vh;
      el.style.setProperty("--parallax", `${(center * -40).toFixed(1)}px`);
    }
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  // 다른 화면에서 돌아왔을 때도 바로 맞춘다
  for (const button of document.querySelectorAll("[data-view], #brandHome")) button.addEventListener("click", () => setTimeout(update, 60));
  update();
}

garage = createGarage({
  root: $("garageView"), getListings: allListings, getCatalogState: () => catalogState,
  today, openListing: openDetail, notify: toast,
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
    persist();
    rentalForm(id);
  },
});
$("detailContent").addEventListener("click", (event) => {
  if (event.target.closest("[data-open-garage]")) {
    hideDialog($("detailBackdrop"));
    setView("garage");
    $("ownedModel").focus();
  }
});
bindEvents();
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
catalogReady = loadCatalog();
