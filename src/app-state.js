// 화면 상태(필터·보기 등, 이 브라우저에 저장)와 서버에서 받은 매물 목록.
import { app } from "./app.js";
import { toast } from "./ui.js";
import { cleanupLegacyData } from "./user-store.js";

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
  transaction: "rent",
  region: "영양읍",
  sort: "distance",
  selectedCrop: "all",
  filters: blankFilters(),
  aiSummaries: {},
};
// 예전 버전이 브라우저에 남긴 대여 요청·채팅·소유자 데이터는 이제 서버에 있으므로 지운다.
export const legacyTradeDataRemoved = cleanupLegacyData();
export let state;
try {
  state = { ...structuredClone(defaults), ...JSON.parse(localStorage.getItem("moa-farm-v1") || "{}") };
  state.filters = { ...blankFilters(), ...(state.filters || {}) };
} catch {
  state = structuredClone(defaults);
}
export function persist() {
  try {
    localStorage.setItem("moa-farm-v1", JSON.stringify(state));
  } catch {
    toast("브라우저 저장 공간이 부족합니다. 사진 크기를 줄여 주세요.");
  }
  app.updateBadges?.();
}

let catalog = [];
let catalogState = "loading";
let catalogPromise;

export const allListings = () => catalog;
export const catalogStatus = () => catalogState;
export function listingById(id) {
  return catalog.find((item) => item.id === id);
}
async function fetchCatalog() {
  try {
    const response = await fetch("/api/listings", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`매물 조회 실패 (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.listings)) throw new Error("잘못된 매물 응답");
    catalog = data.listings;
    catalogState = "ready";
  } catch (error) {
    console.error(error);
    catalogState = "error";
  }
  app.renderAll?.();
}

// 매물을 (다시) 받아 온다. 로그인·승인 뒤에도 불러 "내 매물"·예약 표시를 새로 맞춘다.
export function loadCatalog() {
  catalogPromise = fetchCatalog();
  return catalogPromise;
}
export const catalogReady = () => catalogPromise ?? loadCatalog();
