// 검수된 작물-작업 연결을 UI와 추천 API가 함께 사용한다.
// 기계 적합성은 예시이며 실제 작업기 호환·현장 상태는 게시자 확인이 필요하다.
export const CROPS = [
  { id: "pepper", name: "고추", emoji: "", description: "두둑·멀칭·정식·방제" },
  { id: "rice", name: "벼", emoji: "", description: "논 준비·이앙·수확" },
  { id: "cabbage", name: "배추", emoji: "", description: "두둑·멀칭·정식" },
  { id: "potato", name: "감자", emoji: "", description: "파종·북주기·굴취" },
];

export const STAGES = [
  { id: "prepare", label: "밭·논 준비", operations: ["till", "ridge", "mulch", "level"] },
  { id: "plant", label: "심기", operations: ["transplant", "seed", "ricePlant"] },
  { id: "care", label: "생육 관리", operations: ["spray", "water", "hill"] },
  { id: "harvest", label: "수확", operations: ["riceHarvest", "potatoHarvest", "transport"] },
];

export const OPERATIONS = [
  { id: "till", label: "흙갈이·로터리", stage: "prepare" },
  { id: "ridge", label: "두둑·고랑 만들기", stage: "prepare" },
  { id: "mulch", label: "멀칭·비닐 피복", stage: "prepare" },
  { id: "level", label: "논 고르기", stage: "prepare" },
  { id: "transplant", label: "모종 심기", stage: "plant" },
  { id: "seed", label: "씨감자 파종", stage: "plant" },
  { id: "ricePlant", label: "모 심기", stage: "plant" },
  { id: "spray", label: "방제", stage: "care" },
  { id: "water", label: "관수", stage: "care" },
  { id: "hill", label: "북주기", stage: "care" },
  { id: "riceHarvest", label: "벼 수확", stage: "harvest" },
  { id: "potatoHarvest", label: "감자 굴취", stage: "harvest" },
  { id: "transport", label: "수확물 운반", stage: "harvest" },
];

export const MACHINE_TYPES = [
  { id: "cultivator", label: "관리기", emoji: "" },
  { id: "tractor", label: "트랙터", emoji: "" },
  { id: "ridgeMulcher", label: "휴립·멀칭기", emoji: "" },
  { id: "transplanter", label: "정식기", emoji: "" },
  { id: "ricePlanter", label: "이앙기", emoji: "" },
  { id: "sprayer", label: "방제기", emoji: "" },
  { id: "potatoPlanter", label: "감자 파종기", emoji: "" },
  { id: "combine", label: "콤바인", emoji: "" },
  { id: "potatoHarvester", label: "감자 굴취기", emoji: "" },
  { id: "carrier", label: "운반차", emoji: "" },
];

export const CROP_OPERATIONS = {
  pepper: ["till", "ridge", "mulch", "transplant", "spray", "water", "transport"],
  rice: ["till", "level", "ricePlant", "spray", "riceHarvest", "transport"],
  cabbage: ["till", "ridge", "mulch", "transplant", "spray", "water", "transport"],
  potato: ["till", "ridge", "mulch", "seed", "hill", "spray", "potatoHarvest", "transport"],
};

export const CROP_BY_ID = Object.fromEntries(CROPS.map((item) => [item.id, item]));
export const OPERATION_BY_ID = Object.fromEntries(OPERATIONS.map((item) => [item.id, item]));
export const MACHINE_BY_ID = Object.fromEntries(MACHINE_TYPES.map((item) => [item.id, item]));

export const REGION_COORDS = {
  영양읍: { name: "영양읍", lat: 36.6667, lng: 129.1124, nx: 88, ny: 108 },
  청기면: { name: "청기면", lat: 36.7064, lng: 129.0695, nx: 87, ny: 109 },
  입암면: { name: "입암면", lat: 36.5992, lng: 129.0888, nx: 88, ny: 107 },
  수비면: { name: "수비면", lat: 36.7988, lng: 129.2116, nx: 89, ny: 111 },
};

function stableHash(str) {
  let h = 2166136261;
  const text = String(str || "");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function listingCoords(itemOrRegion, itemId = "") {
  const region = typeof itemOrRegion === "string" ? itemOrRegion : itemOrRegion?.region;
  const id = typeof itemOrRegion === "string" ? itemId : itemOrRegion?.id || itemId;
  const base = REGION_COORDS[region] || REGION_COORDS["영양읍"];
  if (!id) return { lat: base.lat, lng: base.lng };
  const h1 = stableHash(`${id}:lat`);
  const h2 = stableHash(`${id}:lng`);
  const latOffset = ((h1 % 1000) / 1000 - 0.5) * 0.026;
  const lngOffset = ((h2 % 1000) / 1000 - 0.5) * 0.032;
  return {
    lat: Number((base.lat + latOffset).toFixed(6)),
    lng: Number((base.lng + lngOffset).toFixed(6)),
  };
}

export function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const distanceCache = new Map();

export function distanceKm(from, to, itemId) {
  const fromCoords =
    from && typeof from === "object" && Number.isFinite(from.lat) && Number.isFinite(from.lng)
      ? from
      : REGION_COORDS[from] || REGION_COORDS["영양읍"];
  const fromKey =
    from && typeof from === "object" && Number.isFinite(from.lat)
      ? `${from.lat.toFixed(4)},${from.lng.toFixed(4)}`
      : String(from || "영양읍");

  const key = JSON.stringify([fromKey, to, itemId || ""]);
  if (!distanceCache.has(key)) {
    const toCoords = listingCoords(to, itemId);
    const raw = haversineKm(fromCoords, toCoords);
    const distance = Math.max(0.2, Math.round(raw * 10) / 10);
    distanceCache.set(key, distance);
  }
  return distanceCache.get(key);
}

