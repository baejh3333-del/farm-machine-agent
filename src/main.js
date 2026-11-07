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

const defaults = {
  view: "home",
  transaction: "rent",
  region: "영양읍",
  sort: "distance",
  selectedCrop: "all",
  filters: blankFilters(),
  favorites: [],
  customListings: [],
  statuses: {},
  bookings: {},
  requests: [],
  messages: [],
  aiSummaries: {},
};

let state;
try {
  state = { ...structuredClone(defaults), ...JSON.parse(localStorage.getItem("moa-farm-v1") || "{}") };
  state.filters = { ...blankFilters(), ...(state.filters || {}) };
} catch {
  state = structuredClone(defaults);
}

const OWNER_DEMO_PROFILE = "10jo";
let accountUser = null;
function isLoggedIn() { return Boolean(accountUser); }
const OWNER_DB_KEY = "moa-owner-db-v1";
function readOwnerDb() {
  try { return JSON.parse(localStorage.getItem(OWNER_DB_KEY) || "{}"); } catch { return {}; }
}
function saveOwnerDb(db) {
  try { localStorage.setItem(OWNER_DB_KEY, JSON.stringify(db)); } catch { /* 원본 유지 */ }
}
function getOwnerData() { return readOwnerDb()[OWNER_DEMO_PROFILE]; }
function migrateExistingOwnerData() {
  const db = readOwnerDb();
  if (db[OWNER_DEMO_PROFILE]) return;
  const owned = allListings().filter((item) => item.owner);
  const ids = new Set(owned.map((item) => item.id));
  db[OWNER_DEMO_PROFILE] = {
    listingIds: [...ids],
    customListings: state.customListings.filter((item) => ids.has(item.id)),
    statuses: Object.fromEntries(Object.entries(state.statuses).filter(([id]) => ids.has(id))),
    bookings: Object.fromEntries(Object.entries(state.bookings).filter(([id]) => ids.has(id))),
    requests: state.requests.filter((item) => ids.has(item.listingId)),
    messages: state.messages.filter((item) => ids.has(item.listingId)),
  };
  saveOwnerDb(db);
}
function syncOwnerData() {
  const db = readOwnerDb();
  if (!db[OWNER_DEMO_PROFILE]) return;
  const ids = new Set(db[OWNER_DEMO_PROFILE].listingIds);
  for (const item of state.customListings) if (item.owner) ids.add(item.id);
  db[OWNER_DEMO_PROFILE] = {
    listingIds: [...ids],
    customListings: state.customListings.filter((item) => ids.has(item.id)),
    statuses: Object.fromEntries(Object.entries(state.statuses).filter(([id]) => ids.has(id))),
    bookings: Object.fromEntries(Object.entries(state.bookings).filter(([id]) => ids.has(id))),
    requests: state.requests.filter((item) => ids.has(item.listingId)),
    messages: state.messages.filter((item) => ids.has(item.listingId)),
  };
  saveOwnerDb(db);
}
let draft = structuredClone(state.filters);
let toastTimer;
let catalog = [];
let catalogState = "loading";

function persist() {
  try {
    localStorage.setItem("moa-farm-v1", JSON.stringify(state));
  } catch {
    toast("브라우저 저장 공간이 부족합니다. 사진 크기를 줄여 주세요.");
  }
  syncOwnerData();
  updateBadges();
}

// 데모: 대여 가능한 매물 중 5대를 '지금 대여 중'으로 보여준다 (매물 번호로 고정해서 새로고침해도 같은 5대)
const DEMO_RENTED_COUNT = 5;
let demoRentedIds = null;
function pickDemoRentedIds() {
  const hash = (text) => [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return new Set(
    catalog
      .filter((item) => item.type === "rent" && item.status === "open" && item.condition !== "repair")
      .sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id))
      .slice(0, DEMO_RENTED_COUNT)
      .map((item) => item.id),
  );
}

function allListings() {
  if (!demoRentedIds && catalog.length) demoRentedIds = pickDemoRentedIds();
  const now = today();
  return [...state.customListings, ...catalog].map((item) => ({
    ...item,
    status: state.statuses[item.id] || item.status,
    booked: [
      ...(item.booked || []),
      ...(state.bookings[item.id] || []),
      ...(demoRentedIds?.has(item.id) ? [{ start: now, end: addDays(now, 2), demo: true }] : []),
    ],
  }));
}

function rentedNow(item) {
  if (item.type !== "rent") return false;
  const now = today();
  return (item.booked || []).some((range) => range.start <= now && now <= range.end);
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/listings", { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`매물 조회 실패 (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.listings)) throw new Error("잘못된 매물 응답");
    catalog = data.listings;
    catalogState = "ready";
    migrateExistingOwnerData();
  } catch (error) {
    console.error(error);
    catalogState = "error";
  }
  renderAll();
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
  backdrop.hidden = true;
  dialogOpeners.get(backdrop)?.focus();
  dialogOpeners.delete(backdrop);
  if (["filterBackdrop", "detailBackdrop", "formBackdrop"].every((id) => $(id).hidden)) {
    document.body.style.overflow = "";
  }
}

const LISTING_PHOTO = /^data:image\/(?:png|jpeg|webp);base64,/i;
const hasListingPhoto = (item) => typeof item.photo === "string" && LISTING_PHOTO.test(item.photo);
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

function toggleFavorite(id) {
  const isFav = !state.favorites.includes(id);
  state.favorites = isFav ? [...state.favorites, id] : state.favorites.filter((value) => value !== id);
  persist();

  const escapedId = CSS.escape(id);
  document.querySelectorAll(`[data-favorite="${escapedId}"], [data-detail-fav="${escapedId}"]`).forEach((button) => {
    button.setAttribute("aria-pressed", String(isFav));
    const label = button.querySelector(".favorite-label");
    if (label) label.textContent = isFav ? "찜한 기계" : "찜하기";
  });
  toast(isFav ? "찜한 농기계 목록에 담았습니다." : "찜 목록에서 제외했습니다.");
}

function machineVisual(item) {
  const type = MACHINE_BY_ID[item.machineType];
  return hasListingPhoto(item)
    ? `<img src="${escapeHtml(item.photo)}" alt="${escapeHtml(item.title)} 사진" style="width:100%;height:100%;object-fit:cover">`
    : `<img class="machine-example" src="${machineImage(type)}" alt="${escapeHtml(type?.label || "농기계")} AI 예시 이미지" width="350" height="365" loading="lazy">`;
}

function listingSummary(item) {
  const summary = state.aiSummaries[item.id] || item.summary;
  const cleaned = summary.replace(/권장\s*면적\s*\d[\d,]*~\d[\d,]*㎡\.?/g, "").trim();
  return `${cleaned} (${areaLabel(item.areaMin, item.areaMax)} 권장)`;
}

function updateBadges() {
  const favBadge = $("favNavBadge");
  if (favBadge) {
    favBadge.hidden = state.favorites.length === 0;
    favBadge.textContent = String(state.favorites.length);
  }
  const ownerBadge = $("ownerBadge");
  if (ownerBadge) {
    if (!isLoggedIn()) {
      ownerBadge.hidden = true;
      ownerBadge.textContent = "";
    } else {
      const owned = allListings().filter((item) => item.owner);
      const pendingCount = state.requests.filter((r) => r.status === "pending" && owned.some((item) => item.id === r.listingId)).length;
      ownerBadge.hidden = pendingCount === 0;
      ownerBadge.textContent = String(pendingCount);
    }
  }
}

const viewIds = { home: "homeView", browse: "browseView", guide: "guideView", requests: "requestsView", owner: "ownerView", ownerLoginRequired: "ownerLoginRequiredView", login: "loginView", about: "aboutView" };

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
  if (view === "owner") renderOwner();
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
  const isFav = state.favorites.includes(item.id);
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
  const isFav = state.favorites.includes(item.id);

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
          <button type="button" class="button button-primary button-large" data-detail-action="${item.id}" ${unavailable || booked ? "disabled" : ""}>
            ${unavailable ? "현재 거래 불가" : booked ? "선택 기간 대여 불가" : item.type === "rent" ? " 이 농기계 대여 신청하기" : " 판매자에게 채팅 문의하기"}
          </button>
        </div>
      </div>
    </div>
  `;
  showDialog($("detailBackdrop"));
}

function openForm(html) {
  $("formContent").innerHTML = html;
  showDialog($("formBackdrop"));
}

function rentalForm(id) {
  const item = listingById(id);
  const date = state.filters.date >= today() ? state.filters.date : today();
  const endDate = state.filters.dateEnd >= date ? state.filters.dateEnd : date;
  openForm(`
    <span class="step-pill">간편 대여 신청</span>
    <h2 id="formTitle">농기계 대여 요청하기</h2>
    <p><strong>${escapeHtml(item.title)}</strong> (${money(item.price)}/일) · 일정을 선택해 요청을 보내면 소유 농가에서 확인 후 승인해 드립니다.</p>
    <form class="stack-form" id="rentalForm">
      <div class="form-row-2">
        <label>대여 시작일<input type="date" id="rentStart" min="${today()}" value="${date}" required></label>
        <label>반납 예정일<input type="date" id="rentEnd" min="${date}" value="${endDate}" required></label>
      </div>
      <p id="rentalEstimate" aria-live="polite"></p>
      <label>작업 내용 · 방문 메모 (선택)
        <textarea id="rentNote" placeholder="예: 고추밭 300평 두둑 작업 예정입니다. 오전 9시에 직접 방문해 인수하겠습니다."></textarea>
      </label>
      <div class="form-actions">
        <button class="button button-primary button-large" type="submit"> 대여 요청 보내기</button>
      </div>
    </form>
  `);
  const updateEstimate = () => {
    const start = $("rentStart").value;
    const end = $("rentEnd").value;
    $("rentEnd").min = start || today();
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    $("rentalEstimate").textContent = days > 0
      ? `기본 대여료 ${money(item.price * days)} (${days}일) · 운송비와 보증금은 소유 농가에 확인해 주세요.`
      : "시작일과 반납일을 확인해 주세요.";
  };
  $("rentalForm").addEventListener("input", updateEstimate);
  updateEstimate();
  $("rentalForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const start = $("rentStart").value;
    const end = $("rentEnd").value;
    if (end < start) return toast("반납일을 시작일 이후로 선택하세요.");
    if (!available(listingById(id), start, end)) return toast("해당 기간에는 이미 예약이 있어 대여할 수 없습니다.");
    state.requests.push({ id: crypto.randomUUID(), listingId: id, start, end, note: $("rentNote").value.trim(), status: "pending" });
    persist();
    hideDialog($("formBackdrop"));
    renderOwner();
    renderBuyerRequests();
    toast("대여 요청을 성공적으로 보냈습니다! 상단 '내 기계 등록·관리'에서 승인 시연을 해볼 수 있어요.");
  });
}

function chatForm(id) {
  const item = listingById(id);
  const role = state.view === "owner" ? "owner" : "buyer";
  openForm(`
    <span class="step-pill">1:1 농기계 채팅 문의</span>
    <h2 id="formTitle">${role === "owner" ? "이웃 농가(구매·대여 희망자)" : "기계 소유 농가"}와 대화하기</h2>
    <p><strong>${escapeHtml(item.title)}</strong> · 궁금한 기계 상태나 인수 시간을 편하게 물어보세요.</p>
    <div id="chatLog" class="chat-log"></div>
    <form id="chatForm" class="chat-send">
      <input id="chatMessage" maxlength="500" placeholder="예: 초보자도 작동하기 쉬운가요? 이번 주 토요일에 보러 가도 될까요?" aria-label="메시지 입력" required>
      <button type="submit" class="button button-primary">보내기</button>
    </form>
  `);
  const renderChat = () => {
    $("chatLog").innerHTML =
      state.messages
        .filter((message) => message.listingId === id)
        .map(
          (message) =>
            `<div class="chat-line ${message.role === role ? "mine" : ""}">
              <b>${message.role === "owner" ? "기계 소유자" : "문의 농가"}</b>
              <div>${escapeHtml(message.text)}</div>
            </div>`
        )
        .join("") || `<div class="chat-empty">아직 나눈 대화가 없어요. 기계 상태와 인수 조건을 먼저 물어보세요!</div>`;
    $("chatLog").scrollTop = $("chatLog").scrollHeight;
  };
  renderChat();
  $("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("chatMessage").value.trim();
    if (!text) return;
    state.messages.push({ id: crypto.randomUUID(), listingId: id, role, text });
    $("chatMessage").value = "";
    persist();
    renderChat();
    renderOwner();
  });
}

function renderBuyerRequests() {
  if (!state.requests.length) {
    $("buyerRequestList").textContent = "아직 보낸 대여 요청이 없어요. 매물 상세에서 대여를 신청하면 여기에서 상태를 볼 수 있어요.";
    return;
  }
  $("buyerRequestList").replaceChildren(...state.requests.slice().reverse().map((request) => {
    const row = document.createElement("div");
    row.className = "request-row";
    const item = listingById(request.listingId);
    const label = {
      pending: "승인 대기",
      approved: "승인됨 · 인수 및 반납 방법을 확인하세요",
      rejected: "거절됨 · 다른 기간이나 매물을 찾아보세요",
    }[request.status];
    row.textContent = [item?.title || "대여 매물", request.start + " ~ " + request.end, label].join(" · ");
    return row;
  }));
}

function renderOwner() {
  const ownerIds = new Set(getOwnerData()?.listingIds || []);
  const owned = allListings().filter((item) => ownerIds.has(item.id));
  const pending = state.requests.filter((request) => request.status === "pending" && owned.some((item) => item.id === request.listingId));
  $("ownerStats").innerHTML = `
    <div class="stat-box">
      <span class="stat-icon" aria-hidden="true">${pictureIcon("sprout")}</span>
      <div><small>내가 등록한 농기계</small><strong>${owned.length}대</strong></div>
    </div>
    <div class="stat-box">
      <span class="stat-icon" aria-hidden="true">${pictureIcon("envelope")}</span>
      <div><small>대기 중인 대여 요청</small><strong>${pending.length}건</strong></div>
    </div>
    <div class="stat-box">
      <span class="stat-icon" aria-hidden="true">${pictureIcon("handshake")}</span>
      <div><small>거래 완료된 판매</small><strong>${owned.filter((item) => item.type === "sale" && item.status === "done").length}건</strong></div>
    </div>
  `;

  $("ownerListings").innerHTML =
    owned
      .map(
        (item) => `
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
          <button type="button" class="button button-secondary button-sm" data-owner-detail="${item.id}">상세 보기</button>
          ${
            item.type === "sale" && item.status !== "done"
              ? `<button type="button" class="button button-primary button-sm" data-sale-status="${item.id}">${
                  item.status === "open" ? "거래 중으로 변경" : "판매 완료 처리"
                }</button>`
              : ""
          }
        </div>
      </div>`
      )
      .join("") || `<div class="empty-panel">아직 직접 등록한 농기계가 없습니다. 우측 상단 '+ 새 농기계 등록하기' 버튼을 눌러 등록해 보세요.</div>`;

  const inquiries = state.messages.filter((message) => message.role === "buyer" && owned.some((item) => item.id === message.listingId));
  const latestByListing = [...new Map(inquiries.map((message) => [message.listingId, message])).values()];

  $("ownerRequests").innerHTML =
    pending
      .map(
        (request) => `
      <div class="request-row">
        <div class="owner-row-info">
          <span class="step-pill"> 대여 승인 대기</span>
          <strong>${escapeHtml(listingById(request.listingId)?.title || "농기계")}</strong>
          <small>희망 기간: ${request.start} ~ ${request.end}${request.note ? `<br>메모: ${escapeHtml(request.note)}` : ""}</small>
        </div>
        <div class="owner-row-actions">
          <button type="button" class="button button-primary button-sm" data-approve="${request.id}">승인하기</button>
          <button type="button" class="button button-secondary button-sm" data-reject="${request.id}">거절</button>
        </div>
      </div>`
      )
      .join("") +
      latestByListing
        .map(
          (message) => `
      <div class="request-row">
        <div class="owner-row-info">
          <span class="step-pill"> 채팅 문의</span>
          <strong>${escapeHtml(listingById(message.listingId)?.title || "농기계")}</strong>
          <small>"${escapeHtml(message.text)}"</small>
        </div>
        <div class="owner-row-actions">
          <button type="button" class="button button-primary button-sm" data-reply="${message.listingId}">답장 보내기</button>
        </div>
      </div>`
        )
        .join("") || `<div class="empty-panel">아직 도착한 대여 요청이나 문의가 없습니다.</div>`;
}

function openNewListing() {
  openForm(`
    <span class="step-pill">농기계 등록</span>
    <h2 id="formTitle">내 농기계 올리기</h2>
    <p>이웃 농가에게 빌려주거나 판매할 농기계 정보를 입력해 주세요. (이 브라우저에 데모로 저장됩니다)</p>
    <form class="stack-form" id="newListingForm">
      <div class="form-row-2">
        <label>거래 방식
          <select id="newType"><option value="rent">빌려주기 (일일 대여)</option><option value="sale">중고로 판매하기</option></select>
        </label>
        <label>농기계 종류
          <select id="newMachine">${MACHINE_TYPES.map((item) => `<option value="${item.id}">${item.emoji} ${item.label}</option>`).join("")}</select>
        </label>
      </div>
      <label>게시글 제목<input id="newTitle" maxlength="80" required placeholder="예: 초보자도 쉬운 관리기 + 두둑성형기 세트 대여"></label>
      <div class="form-row-2">
        <label>추천 작물<select id="newCrop">${CROPS.map((item) => `<option value="${item.id}">${item.emoji} ${item.name}</option>`).join("")}</select></label>
        <label>세부 작업<select id="newOperation">${OPERATIONS.map((item) => `<option value="${item.id}">${item.label}</option>`).join("")}</select></label>
      </div>
      <div class="form-row-3">
        <label>요금/가격(원)<input id="newPrice" type="number" min="0" step="1000" required placeholder="예: 50000"></label>
        <label>최소 권장 면적(㎡)<input id="newAreaMin" type="number" min="1" required placeholder="예: 300"></label>
        <label>최대 권장 면적(㎡)<input id="newAreaMax" type="number" min="1" required placeholder="예: 1500"></label>
      </div>
      <div class="form-row-2">
        <label>기계 상태
          <select id="newCondition"><option value="good">정상 작동</option><option value="used">사용감 있음</option><option value="repair">정비 필요</option></select>
        </label>
        <label>최근 점검일<input id="newInspection" type="date" max="${today()}" value="${today()}" required></label>
      </div>
      <label>기계 사진 업로드 (JPG·PNG·WebP, 1MB 이하)<input id="newPhoto" type="file" accept="image/png,image/jpeg,image/webp" required></label>
      <div class="form-row-2">
        <label>포함 작업기·부속품<input id="newIncluded" required placeholder="예: 로터리, 두둑성형기 포함"></label>
        <label>인수·전달 방법<input id="newPickup" required placeholder="예: 영양읍 창고 직접 방문 인수"></label>
      </div>
      <label>상세 설명 및 초보자 안내<textarea id="newDescription" required placeholder="기계 작동 상태와 초보 농부님이 사용할 때 주의할 점을 친절하게 적어주세요."></textarea></label>
      <button class="button button-primary button-large" type="submit">+ 매물 등록 완료하기</button>
    </form>
  `);
  if (state.selectedCrop && state.selectedCrop !== "all") {
    $("newCrop").value = state.selectedCrop;
  }
  $("newListingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = $("newPhoto").files[0];
    if (!file || file.size > 1024 * 1024) return toast("JPG·PNG·WebP 사진을 1MB 이하로 선택해 주세요.");
    const areaMin = Number($("newAreaMin").value);
    const areaMax = Number($("newAreaMax").value);
    if (areaMin > areaMax) return toast("최대 면적이 최소 면적보다 작습니다.");
    const photo = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const machineType = $("newMachine").value;
    const cropId = $("newCrop").value;
    const operationId = $("newOperation").value;
    const item = {
      id: crypto.randomUUID(),
      type: $("newType").value,
      title: $("newTitle").value.trim(),
      brand: "직접 등록",
      machineType,
      cropIds: [cropId],
      operations: [operationId],
      areaMin,
      areaMax,
      price: Number($("newPrice").value),
      region: state.region,
      condition: $("newCondition").value,
      inspectedAt: $("newInspection").value,
      included: $("newIncluded").value.trim(),
      pickup: $("newPickup").value.trim(),
      description: $("newDescription").value.trim(),
      summary: `${CROP_BY_ID[cropId].name} ${OPERATION_BY_ID[operationId].label} 작업에 쓰는 ${MACHINE_BY_ID[machineType].label}입니다. 권장 면적 ${areaMin.toLocaleString()}~${areaMax.toLocaleString()}㎡.`,
      booked: [],
      owner: true,
      photo,
      status: "open",
    };
    state.customListings.unshift(item);
    persist();
    hideDialog($("formBackdrop"));
    renderOwner();
    renderAll();
    toast("새 농기계 매물을 등록했습니다!");
  });
}

function openFavoritesModal() {
  const items = allListings().filter((item) => state.favorites.includes(item.id));
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
        const removeId = button.dataset.favRemove;
        state.favorites = state.favorites.filter((id) => id !== removeId);
        persist();
        renderAll();
        openFavoritesModal();
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
    const button = event.target.closest("[data-detail-action]");
    if (!button) return;
    hideDialog($("detailBackdrop"));
    const item = listingById(button.dataset.detailAction);
    item.type === "rent" ? rentalForm(item.id) : chatForm(item.id);
  });

  $("ownerListings").addEventListener("click", (event) => {
    const detailBtn = event.target.closest("[data-owner-detail]");
    if (detailBtn) return openDetail(detailBtn.dataset.ownerDetail);
    const button = event.target.closest("[data-sale-status]");
    if (!button) return;
    const item = listingById(button.dataset.saleStatus);
    state.statuses[item.id] = item.status === "open" ? "dealing" : "done";
    persist();
    renderOwner();
    renderListings();
    toast("매물 거래 상태를 변경했습니다.");
  });

  $("ownerRequests").addEventListener("click", (event) => {
    const reply = event.target.closest("[data-reply]");
    if (reply) return chatForm(reply.dataset.reply);
    const approve = event.target.closest("[data-approve]");
    const reject = event.target.closest("[data-reject]");
    if (!approve && !reject) return;
    const request = state.requests.find((item) => item.id === (approve || reject).dataset[approve ? "approve" : "reject"]);
    if (request?.status !== "pending") return;
    const listing = listingById(request.listingId);
    if (!listing?.owner) return;
    if (approve) {
      if (!available(listing, request.start, request.end)) return toast("이미 예약된 기간이라 승인할 수 없습니다.");
      (state.bookings[listing.id] ||= []).push({ start: request.start, end: request.end });
      request.status = "approved";
      toast("대여 요청을 승인했습니다!");
    } else {
      request.status = "rejected";
      toast("대여 요청을 거절했습니다.");
    }
    persist();
    renderOwner();
    renderBuyerRequests();
    renderListings();
  });

  $("newListingButton").addEventListener("click", openNewListing);
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
    headerButton.textContent = isLoggedIn() ? "내 계정" : "로그인";
    updateBadges();
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
      renderAccount(result.user);
      password.value = confirm.value = "";
      setView("owner");
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
      renderAccount(null);
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
    .then((result) => {
      renderAccount(result.user);
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
const catalogReady = loadCatalog();
