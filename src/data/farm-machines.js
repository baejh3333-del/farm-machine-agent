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

const distanceCache = new Map();

export function distanceKm(from, to) {
  const values = {
    영양읍: { 영양읍: 2, 청기면: 6, 입암면: 8, 수비면: 18 },
    청기면: { 영양읍: 6, 청기면: 2, 입암면: 11, 수비면: 13 },
    입암면: { 영양읍: 8, 청기면: 11, 입암면: 2, 수비면: 21 },
    수비면: { 영양읍: 18, 청기면: 13, 입암면: 21, 수비면: 2 },
  };
  const max = values[from]?.[to] ?? 30;
  const key = `${from}:${to}`;
  if (!distanceCache.has(key)) {
    const min = max - 1.5;
    distanceCache.set(key, Math.round((min + Math.random() * (max - min)) * 10) / 10);
  }
  return distanceCache.get(key);
}
