// 디자인 화면(홈·매물 찾기·매물 상세)이 함께 쓰는 실제 매물 데이터 변환
import { MACHINE_BY_ID, MACHINE_TYPES } from "../data/farm-machines.js";
import { available } from "../data/recommendation.js";
import { allListings, listingById, activeFavorites } from "../core/store.js";
import { getListingPhotoSrc, machineImage, today } from "../core/utils.js";

export const WD = ["일", "월", "화", "수", "목", "금", "토"];
export const K = (y, m, d) => y * 10000 + (m + 1) * 100 + d;
export const P = (k) => [Math.floor(k / 10000), Math.floor(k / 100) % 100, k % 100];
export const isoToKey = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
};
export const keyToIso = (k) => {
  if (!k) return "";
  const [y, m, d] = P(k);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
export function todayKey() {
  return isoToKey(today()) || 20261120;
}
export function todayYm() {
  const [y, m] = P(todayKey());
  return y * 12 + (m - 1);
}

export const won = (p) => (Math.round(p / 1000) / 10).toLocaleString("ko-KR") + "만원";
export const bigWon = (p) => Math.round(p / 10000).toLocaleString("ko-KR") + "만원";

// 캔버스 디자인에 쓰인 사진(트랙터·관리기·경운기)은 그대로 쓰고, 나머지는 기종 사진을 쓴다
const DESIGN_PHOTO = {
  tractor: "/src/design/assets/tractor.jpg",
  rotavator: "/src/design/assets/tractor.jpg",
  cultivator: "/src/design/assets/cultivator.jpg",
  ridingCultivator: "/src/design/assets/cultivator.jpg",
  tiller: "/src/design/assets/tiller.jpg",
};
export function photoOf(item) {
  return getListingPhotoSrc(item) || DESIGN_PHOTO[item?.machineType] || machineImage(item?.machineType).replace(/^\.\//, "/");
}

// 매물 찾기의 '농기계 종류' 묶음
export const TYPE_GROUPS = {
  tractor: ["tractor", "rotavator", "plow", "loader"],
  cultivator: ["cultivator", "ridingCultivator", "ridger", "ridgeMulcher"],
  tiller: ["tiller"],
  harvester: ["potatoHarvester", "rootHarvester", "forageHarvester", "thresher"],
  sprayer: ["sprayer", "speedSprayer", "agriDrone"],
  carrier: ["carrier", "aerialLift"],
  combine: ["combine"],
};
export const groupOf = (machineType) =>
  Object.keys(TYPE_GROUPS).find((g) => TYPE_GROUPS[g].includes(machineType)) || "";

// 홈 예약창의 '하려는 작업'과 매물 작업 연결
export const TASK_OPS = {
  "밭 갈기": ["till", "deepTill", "level"],
  "두둑 만들기": ["ridge", "ridgeBuild", "mulch", "hill"],
  "파종·정식": ["seed", "directSeed", "transplant", "ricePlant", "garlicOnionPlant"],
  "방제": ["spray", "droneSpray", "orchardSpray"],
  "수확": ["potatoHarvest", "rootHarvest", "riceHarvest", "thresh", "forageBale"],
  "운반": ["transport"],
};
export const doesTask = (item, task) => !task || (item.operations || []).some((op) => (TASK_OPS[task] || []).includes(op));

export const typeLabel = (machineType) => MACHINE_BY_ID[machineType]?.label || "농기계";

export function nameOf(item) {
  const label = typeLabel(item.machineType);
  const model = item.model || item.specification?.model || "";
  return model ? `${label} ${model}` : label;
}

// '경북 영양군 영양읍 …' → '영양군 영양읍'
export function placeOf(item) {
  const words = String(item.pickup || item.delivery?.pickupPlace || "").split(/\s+/).filter(Boolean);
  const area = words.slice(1, 3).join(" ");
  return area || item.region || "위치 확인 필요";
}
export function areaKey(item, depth = 2) {
  return String(item.pickup || "").split(/\s+/).slice(0, depth).join(" ");
}

// 실제 후기가 있는 매물만 별점을 보여 주고, 없으면 새 매물로 표시한다
export function ratingOf(item) {
  const list = Array.isArray(item.reviews) ? item.reviews : [];
  if (!list.length) return null;
  const avg = list.reduce((a, r) => a + (Number(r.rating) || 0), 0) / list.length;
  return { avg, count: list.length };
}

export const openListings = (type) => allListings().filter((it) => it.status === "open" && (!type || it.type === type));
export const isFav = (id) => activeFavorites().includes(id);
export { available, listingById };

export const TYPES = [
  ["all", "전체"],
  ...MACHINE_TYPES.map((m) => [m.id, m.label]),
];

const GROUP_LABELS = { harvester: "수확기", sprayer: "방제기", carrier: "운반차" };

export function machineFilterLabel(type, query = "") {
  const q = String(query || "").trim();
  if (q) return q;
  if (!type || type === "all") return "";
  return MACHINE_BY_ID[type]?.label || GROUP_LABELS[type] || "농기계";
}

export function matchesMachineFilter(item, type, query = "") {
  if (type && type !== "all") {
    return item.machineType === type || groupOf(item.machineType) === type;
  }
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    typeLabel(item.machineType),
    nameOf(item),
    item.brand || item.specification?.brand || "",
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

export function buildTypeChoices(type, query, onPick) {
  const q = String(query || "").trim().toLowerCase();
  const list = q
    ? TYPES.filter(([id, label]) => id === "all" || label.toLowerCase().includes(q))
    : TYPES;
  return list.map(([id, label]) => {
    const sel = type === id && !q;
    return {
      id,
      label,
      bg: sel ? "#111111" : "#FFFFFF",
      color: sel ? "#FFFFFF" : "#111111",
      border: sel ? "#111111" : "#E2E2E2",
      pick: () => onPick(id, label),
    };
  });
}

// 화면끼리 넘겨주는 검색 조건 (홈 → 매물 찾기 → 상세)
export const shared = {
  loc: null, // '경북 영양군' 같은 지역 앞부분
  start: null, end: null, // 날짜 키 (20261120)
  type: "all",
  typeQuery: "",
  task: null,
  tab: "all",
};

// 위치 고르기 목록: 매물이 많은 지역부터
export function locationChoices(limit = 5) {
  const counts = new Map();
  for (const it of openListings()) {
    const key = areaKey(it, 2);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, n]) => ({ key, n }));
}
