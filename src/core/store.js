import { toast, today } from "./utils.js";

export const UI_PREFS_KEY = "moa-farm-v1";
export const GUEST_FAV_KEY = "moa-guest-favorites-v1";

export const blankFilters = () => ({
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
  viewMode: "list",
  transaction: "rent",
  region: "홍천 비발디파크",
  userCoords: {
    lat: 37.6456,
    lng: 127.6844,
    source: "default",
  },
  sort: "distance",
  selectedCrop: "all",
  filters: blankFilters(),
  aiSummaries: {},
};

function sanitizeUserCoords(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const coords = {
    lat,
    lng,
    source: typeof raw.source === "string" && raw.source ? raw.source : "gps",
  };
  if (Number.isFinite(Number(raw.accuracy))) {
    coords.accuracy = Number(raw.accuracy);
  }
  return coords;
}

export let state;
try {
  const saved = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "{}");
  state = {
    view: typeof saved.view === "string" ? saved.view : defaults.view,
    viewMode: saved.viewMode === "map" ? "map" : defaults.viewMode,
    transaction: saved.transaction === "sale" ? "sale" : defaults.transaction,
    region: typeof saved.region === "string" ? saved.region : defaults.region,
    userCoords: sanitizeUserCoords(saved.userCoords) ?? (typeof saved.region === "string" ? null : structuredClone(defaults.userCoords)),
    sort: typeof saved.sort === "string" ? saved.sort : defaults.sort,
    selectedCrop: typeof saved.selectedCrop === "string" ? saved.selectedCrop : defaults.selectedCrop,
    filters: { ...blankFilters(), ...(saved.filters || {}) },
    aiSummaries: saved.aiSummaries && typeof saved.aiSummaries === "object" ? saved.aiSummaries : {},
  };
} catch {
  state = structuredClone(defaults);
}

export function readGuestFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_FAV_KEY) || "[]");
    return Array.isArray(raw) ? [...new Set(raw.filter((v) => typeof v === "string" && v.trim()))] : [];
  } catch {
    return [];
  }
}

export const runtime = {
  accountUser: null,
  authEpoch: 0,
  activeControllers: new Set(),
  guestFavorites: readGuestFavorites(),
  serverFavorites: [],
  incomingRequests: [],
  outgoingRequests: [],
  approvableRequestCount: 0,
  userConversations: [],
  chatPollTimer: null,
  pendingIntent: null,
  dismissGuestImport: false,
  onSessionExpiredHandler: null,
  draft: structuredClone(state.filters),
  catalog: [],
  catalogState: "loading",
  catalogReady: Promise.resolve(),
  weatherData: null,
  forecastDays: [],
  weatherExpanded: false,
  selectedForecastDate: "",
  mapConfig: null,
  userCoords: state.userCoords || null,
  selectedMapListingId: "",
};

export function isLoggedIn() {
  return Boolean(runtime.accountUser);
}

export function activeFavorites() {
  return isLoggedIn() ? runtime.serverFavorites : runtime.guestFavorites;
}

export function saveGuestFavorites(list) {
  runtime.guestFavorites = [...new Set(list.filter((v) => typeof v === "string" && v.trim()))];
  try {
    localStorage.setItem(GUEST_FAV_KEY, JSON.stringify(runtime.guestFavorites));
  } catch {
    toast("브라우저 저장 공간이 부족합니다.");
  }
}

export function clearGuestFavorites() {
  runtime.guestFavorites = [];
  try {
    localStorage.removeItem(GUEST_FAV_KEY);
  } catch {
    // ignore
  }
}

export function stopChatPolling() {
  if (runtime.chatPollTimer) {
    clearInterval(runtime.chatPollTimer);
    runtime.chatPollTimer = null;
  }
}

export function bumpAuthEpoch() {
  runtime.authEpoch += 1;
  stopChatPolling();
  for (const controller of runtime.activeControllers) {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }
  runtime.activeControllers.clear();
  return runtime.authEpoch;
}

export function resetAccountRuntimeState() {
  runtime.serverFavorites = [];
  runtime.incomingRequests = [];
  runtime.outgoingRequests = [];
  runtime.approvableRequestCount = 0;
  runtime.userConversations = [];
  runtime.dismissGuestImport = false;
  runtime.educationCertificate = null;
}

export async function apiFetch(url, options = {}) {
  const epoch = runtime.authEpoch;
  const controller = new AbortController();
  runtime.activeControllers.add(controller);
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

    if (epoch !== runtime.authEpoch) {
      const staleErr = new Error("계정 상태가 변경되었습니다.");
      staleErr.code = "AUTH_CHANGED";
      throw staleErr;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && isLoggedIn() && runtime.onSessionExpiredHandler) {
        runtime.onSessionExpiredHandler();
      }
      const err = new Error(data?.error || `요청 처리에 실패했습니다. (${response.status})`);
      err.status = response.status;
      err.code = data?.code || "REQUEST_FAILED";
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
    runtime.activeControllers.delete(controller);
  }
}

export function persist(onUpdateBadges) {
  try {
    localStorage.setItem(
      UI_PREFS_KEY,
      JSON.stringify({
        view: state.view,
        viewMode: state.viewMode,
        transaction: state.transaction,
        region: state.region,
        userCoords: state.userCoords,
        sort: state.sort,
        selectedCrop: state.selectedCrop,
        filters: state.filters,
        aiSummaries: state.aiSummaries,
      }),
    );
  } catch {
    toast("브라우저 저장 공간이 부족합니다.");
  }
  if (typeof onUpdateBadges === "function") onUpdateBadges();
}

export function allListings() {
  return runtime.catalog;
}

export function listingById(id) {
  return allListings().find((item) => item.id === id);
}

export function rentedNow(item) {
  if (item.type !== "rent") return false;
  const now = today();
  return (item.booked || []).some((range) => range.start <= now && now <= range.end);
}

export function statusLabel(item) {
  if (item.type === "sale") return item.status === "done" ? "판매 완료" : item.status === "dealing" ? "거래 중" : "판매 가능";
  if (item.condition === "repair") return "정비 중";
  return rentedNow(item) ? "대여 중" : "대여 가능";
}

export function statusClass(item) {
  if (item.type === "rent" && item.condition !== "repair" && item.status === "open" && rentedNow(item)) return "rented";
  return item.status !== "open" || item.condition === "repair" ? "warn" : "ok";
}
