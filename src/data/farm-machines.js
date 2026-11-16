// 검수된 작물-작업 연결을 UI와 추천 API가 함께 사용한다.
// 기계 적합성은 예시이며 실제 작업기 호환·현장 상태는 게시자 확인이 필요하다.
export const CROPS = [
  { id: "pepper", name: "고추", emoji: "", category: "채소", description: "두둑·멀칭·정식·주기적 방제·운반", peakWorkMonths: [4, 5, 6, 7, 8, 9] },
  { id: "rice", name: "벼", emoji: "", category: "식량작물", description: "논 준비·써레질·이앙·드론방제·콤바인 수확", peakWorkMonths: [4, 5, 7, 8, 9, 10] },
  { id: "cabbage", name: "배추", emoji: "", category: "채소", description: "두둑·멀칭·정식·방제·관수·수확운반", peakWorkMonths: [4, 5, 8, 9, 10, 11] },
  { id: "potato", name: "감자", emoji: "", category: "채소", description: "파종·북주기·방제·감자굴취", peakWorkMonths: [3, 4, 6, 7, 8, 10] },
  { id: "soybean", name: "콩", emoji: "", category: "식량작물", description: "로터리·두둑파종·북주기·콤바인 수확·탈곡선별", peakWorkMonths: [5, 6, 7, 8, 10, 11] },
  { id: "corn", name: "옥수수", emoji: "", category: "식량작물", description: "멀칭파종·북주기·방제·식용수확 및 사료곤포", peakWorkMonths: [4, 5, 7, 8, 9] },
  { id: "sweetPotato", name: "고구마", emoji: "", category: "식량작물", description: "두둑·멀칭·순 정식·줄기파쇄·굴취 수확", peakWorkMonths: [4, 5, 9, 10] },
  { id: "barleyWheat", name: "보리·밀", emoji: "", category: "식량작물", description: "답리작 세조파종·배수골·추비방제·콤바인 수확", peakWorkMonths: [10, 11, 2, 3, 5, 6] },
  { id: "garlic", name: "마늘", emoji: "", category: "채소", description: "심경·비닐피복·마늘파종·방제·줄기절단·굴취", peakWorkMonths: [9, 10, 4, 5, 6] },
  { id: "onion", name: "양파", emoji: "", category: "채소", description: "두둑·멀칭·양파정식·방제·줄기절단·굴취", peakWorkMonths: [10, 11, 4, 5, 6] },
  { id: "radish", name: "무", emoji: "", category: "채소", description: "심경·두둑·직파·방제·관수·굴취/운반", peakWorkMonths: [3, 4, 8, 9, 10, 11] },
  { id: "greenOnion", name: "대파", emoji: "", category: "채소", description: "깊이갈이·정식·연백 북주기·방제·굴취", peakWorkMonths: [4, 5, 7, 8, 10, 11] },
  { id: "ginger", name: "생강", emoji: "", category: "채소", description: "심경·종강파종·차광/관수·서리전 굴취", peakWorkMonths: [4, 5, 7, 8, 10, 11] },
  { id: "apple", name: "사과", emoji: "", category: "과수", description: "동계·하계 전정 및 파쇄·SS방제·과원제초·운반", peakWorkMonths: [2, 3, 5, 6, 7, 9, 10, 11] },
  { id: "pear", name: "배", emoji: "", category: "과수", description: "전정·잔가지 파쇄·SS방제·초생제초·수확운반", peakWorkMonths: [2, 3, 4, 6, 8, 9, 10] },
  { id: "peach", name: "복숭아", emoji: "", category: "과수", description: "전정·잔가지 파쇄·SS방제·예초·수확운반", peakWorkMonths: [2, 3, 5, 6, 7, 8, 9] },
  { id: "grape", name: "포도", emoji: "", category: "과수", description: "전정·파쇄·비가림/노지 방제·예초·운반", peakWorkMonths: [2, 3, 5, 6, 8, 9, 10] },
  { id: "strawberry", name: "딸기", emoji: "", category: "시설·특용", description: "시설 토양로터리·두둑·정식·방제·전동운반", peakWorkMonths: [8, 9, 11, 12, 1, 2, 3, 4] },
  { id: "tomato", name: "토마토", emoji: "", category: "시설·특용", description: "하우스 경운·멀칭·정식·관비·방제·운반", peakWorkMonths: [3, 4, 5, 6, 9, 10, 11] },
  { id: "sesame", name: "참깨·들깨", emoji: "", category: "시설·특용", description: "로터리·비닐피복·직파/정식·예방방제·탈곡선별", peakWorkMonths: [5, 6, 7, 8, 9, 10] },
];

export const STAGES = [
  { id: "prepare", label: "밭·논 준비", operations: ["deepTill", "till", "spreadFertilizer", "ridge", "mulch", "level"] },
  { id: "plant", label: "심기", operations: ["transplant", "seed", "ricePlant", "directSeed", "garlicOnionPlant"] },
  { id: "care", label: "생육 관리", operations: ["spray", "orchardSpray", "droneSpray", "water", "hill", "weedMow"] },
  { id: "orchard", label: "과원·전정 관리", operations: ["pruneShred"] },
  { id: "harvest", label: "수확", operations: ["riceHarvest", "potatoHarvest", "rootHarvest", "thresh", "forageBale", "transport"] },
];

export const OPERATIONS = [
  { id: "till", label: "흙갈이·로터리", stage: "prepare", defaultMachineTypes: ["tractor", "rotavator", "cultivator", "tiller"] },
  { id: "deepTill", label: "심경·쟁기질", stage: "prepare", defaultMachineTypes: ["tractor", "plow"] },
  { id: "spreadFertilizer", label: "비료·퇴비 살포", stage: "prepare", defaultMachineTypes: ["spreader", "tractor", "loader"] },
  { id: "ridge", label: "두둑·고랑 만들기", stage: "prepare", defaultMachineTypes: ["ridgeMulcher", "cultivator", "tractor"] },
  { id: "mulch", label: "멀칭·비닐 피복", stage: "prepare", defaultMachineTypes: ["ridgeMulcher", "cultivator"] },
  { id: "level", label: "논 고르기", stage: "prepare", defaultMachineTypes: ["tractor", "rotavator"] },
  { id: "transplant", label: "모종 심기", stage: "plant", defaultMachineTypes: ["transplanter", "tractor"] },
  { id: "seed", label: "씨감자 파종", stage: "plant", defaultMachineTypes: ["potatoPlanter", "tractor"] },
  { id: "ricePlant", label: "모 심기", stage: "plant", defaultMachineTypes: ["ricePlanter"] },
  { id: "directSeed", label: "밭작물·맥류 직파", stage: "plant", defaultMachineTypes: ["tractor", "ridingCultivator"] },
  { id: "garlicOnionPlant", label: "마늘·양파 파종·정식", stage: "plant", defaultMachineTypes: ["garlicOnionPlanter", "transplanter", "tractor"] },
  { id: "spray", label: "방제", stage: "care", defaultMachineTypes: ["sprayer", "tractor", "cultivator"] },
  { id: "orchardSpray", label: "과수 SS 방제", stage: "care", defaultMachineTypes: ["speedSprayer", "sprayer"] },
  { id: "droneSpray", label: "드론 방제", stage: "care", defaultMachineTypes: ["agriDrone"] },
  { id: "water", label: "관수", stage: "care", defaultMachineTypes: ["sprayer", "cultivator"] },
  { id: "hill", label: "북주기", stage: "care", defaultMachineTypes: ["cultivator", "ridingCultivator", "tractor"] },
  { id: "weedMow", label: "제초·예초", stage: "care", defaultMachineTypes: ["mower", "ridingCultivator", "cultivator"] },
  { id: "pruneShred", label: "전정·잔가지 파쇄", stage: "orchard", defaultMachineTypes: ["shredder", "tractor"] },
  { id: "riceHarvest", label: "벼 수확", stage: "harvest", defaultMachineTypes: ["combine"] },
  { id: "potatoHarvest", label: "감자 굴취", stage: "harvest", defaultMachineTypes: ["potatoHarvester", "tractor"] },
  { id: "rootHarvest", label: "땅속작물·마늘·양파 굴취/수확", stage: "harvest", defaultMachineTypes: ["rootHarvester", "tractor", "cultivator"] },
  { id: "thresh", label: "탈곡·선별", stage: "harvest", defaultMachineTypes: ["thresher", "combine"] },
  { id: "forageBale", label: "사료작물 수확·곤포", stage: "harvest", defaultMachineTypes: ["baler", "tractor", "loader"] },
  { id: "transport", label: "수확물 운반", stage: "harvest", defaultMachineTypes: ["carrier", "tiller", "loader", "tractor"] },
];

export const MACHINE_TYPES = [
  { id: "cultivator", label: "관리기", emoji: "", role: "powerUnit", areaMin: 300, areaMax: 1500, description: "밭작물 소규모·하우스 경운, 배토, 두둑성형, 비닐피복 작업의 핵심 보행형 동력 본체" },
  { id: "tractor", label: "트랙터", emoji: "", role: "powerUnit", areaMin: 1000, areaMax: 30000, description: "20~140+ PS 대역의 범용 농작업 동력 본체. 후방 3점 히치(Cat I/II) 및 PTO(540/750/1000 rpm)로 다양한 작업기 구동" },
  { id: "ridgeMulcher", label: "휴립·멀칭기", emoji: "", role: "implement", areaMin: 300, areaMax: 10000, description: "두둑 성형과 비닐 피복을 단독 또는 동시 수행하는 작업기. 관리기 전용과 트랙터 3점 히치용으로 구분" },
  { id: "transplanter", label: "정식기", emoji: "", role: "standalone", areaMin: 300, areaMax: 5000, description: "고추·배추·양파 등 육묘 트레이 모종을 일정 주간과 깊이로 정식하는 보행형·승용형 기계" },
  { id: "ricePlanter", label: "이앙기", emoji: "", role: "standalone", areaMin: 1000, areaMax: 20000, description: "논에 벼 모를 4조·6조·8조 등으로 정밀 이앙하는 자주식 승용 농기계" },
  { id: "sprayer", label: "방제기", emoji: "", role: "standalone", areaMin: 300, areaMax: 3000, description: "소규모 밭·하우스·과수원 약제 살포용 배부식 및 이동식 동력분무기" },
  { id: "potatoPlanter", label: "감자 파종기", emoji: "", role: "implement", areaMin: 1000, areaMax: 15000, description: "로터리·두둑성형·씨감자 파종·비닐피복·복토를 일괄 또는 단독 수행하는 트랙터 부착 작업기" },
  { id: "combine", label: "콤바인", emoji: "", role: "standalone", areaMin: 1500, areaMax: 30000, description: "벼·보리·콩 등의 예취, 탈곡, 선별을 동시에 수행하는 자주식 수확기" },
  { id: "potatoHarvester", label: "감자 굴취기", emoji: "", role: "implement", areaMin: 1000, areaMax: 15000, description: "땅속의 감자·고구마를 진동 체인 또는 굴취 날로 캐내는 트랙터 부착형 수확기" },
  { id: "carrier", label: "운반차", emoji: "", role: "standalone", areaMin: 300, areaMax: 10000, description: "농산물·비료·자재를 과수원·밭·임도에서 운반하는 궤도형·사륜형 동력 운반차" },
  { id: "tiller", label: "경운기", emoji: "", role: "powerUnit", areaMin: 500, areaMax: 5000, description: "한국 농촌의 전통적인 다목적 보행형 디젤 동력기. 로터리·쟁기·트레일러(운반) 연결 가능" },
  { id: "rotavator", label: "로타베이터", emoji: "", role: "implement", areaMin: 1000, areaMax: 30000, description: "트랙터 후방 3점 히치·PTO에 연결해 흙을 잘게 부수고(쇄토) 논·밭을 평탄화하는 필수 작업기" },
  { id: "speedSprayer", label: "SS기 (스피드스프레이어)", emoji: "", role: "standalone", areaMin: 2000, areaMax: 30000, description: "과수원에서 대형 송풍기와 고압 노즐로 병해충 약제를 고속·광역 살포하는 자주식 방제기" },
  { id: "agriDrone", label: "농업용 방제 드론", emoji: "", role: "standalone", areaMin: 2000, areaMax: 50000, description: "무인 회전익 비행체로 액상 농약 및 입제 비료·종자를 고속 정밀 살포하는 항공 방제 장비" },
  { id: "ridingCultivator", label: "승용관리기", emoji: "", role: "powerUnit", areaMin: 1000, areaMax: 15000, description: "높은 최저지상고와 좁은 타이어 폭으로 작물 생육 중에도 고랑 주행하며 방제·배토·비료살포를 수행하는 승용 동력체" },
  { id: "garlicOnionPlanter", label: "마늘·양파 파종기", emoji: "", role: "implement", areaMin: 1000, areaMax: 20000, description: "씨마늘 등을 6~8조로 정밀 점파·줄파종하며 두둑성형·비닐피복을 동시 수행하는 트랙터 부착형 파종기" },
  { id: "rootHarvester", label: "땅속작물 수확기", emoji: "", role: "implement", areaMin: 1000, areaMax: 20000, description: "마늘·양파·생강 등 땅속작물을 진동 날로 굴취하고 흙을 분리하는 트랙터 부착형 수확기" },
  { id: "plow", label: "쟁기 (심경쟁기)", emoji: "", role: "implement", areaMin: 1000, areaMax: 30000, description: "트랙터 3점 히치에 장착해 토양을 깊이 갈아엎고(반전) 경반층을 파쇄하는 작업기" },
  { id: "spreader", label: "비료·퇴비 살포기", emoji: "", role: "implement", areaMin: 1000, areaMax: 30000, description: "화학비료, 유기질 비료 또는 축분 퇴비를 균일하게 살포하는 트랙터·승용관리기 부착/견인 작업기" },
  { id: "loader", label: "프론트로더", emoji: "", role: "implement", areaMin: 1000, areaMax: 30000, description: "트랙터 전방에 장착해 흙·퇴비 적재, 톤백(대형 포대) 리프팅, 제설 등을 수행하는 유압식 작업기" },
  { id: "baler", label: "원형 베일러", emoji: "", role: "implement", areaMin: 3000, areaMax: 50000, description: "트랙터 PTO로 구동하며 볏짚이나 사료작물을 픽업해 원형 곤포(베일)로 압축 성형하는 작업기" },
  { id: "mower", label: "예초기 (승용 제초기)", emoji: "", role: "standalone", areaMin: 300, areaMax: 10000, description: "논둑·밭둑·과수원 하부 잡초를 제거하는 배부식 예초기 및 승용/보행 자주식 제초기" },
  { id: "shredder", label: "잔가지·목재 파쇄기", emoji: "", role: "standalone", areaMin: 500, areaMax: 15000, description: "과수원 전정 가지, 고춧대, 깻대 등 영농 부산물을 파쇄해 퇴비화하는 엔진·모터·트랙터 구동 파쇄기" },
  { id: "thresher", label: "탈곡기 (콩·잡곡)", emoji: "", role: "standalone", areaMin: 500, areaMax: 10000, description: "수확한 콩·들깨·잡곡 등의 꼬투리에서 알곡을 털어내고 풍구로 정선하는 수확 후 처리 기계" },
];

export const CROP_OPERATIONS = {
  pepper: ["deepTill", "till", "spreadFertilizer", "ridge", "mulch", "transplant", "spray", "water", "transport"],
  rice: ["deepTill", "till", "spreadFertilizer", "level", "ricePlant", "spray", "droneSpray", "riceHarvest", "transport"],
  cabbage: ["deepTill", "till", "spreadFertilizer", "ridge", "mulch", "transplant", "spray", "water", "transport"],
  potato: ["deepTill", "till", "spreadFertilizer", "ridge", "mulch", "seed", "hill", "spray", "potatoHarvest", "transport"],
  soybean: ["deepTill", "till", "spreadFertilizer", "ridge", "directSeed", "hill", "spray", "droneSpray", "riceHarvest", "thresh", "transport"],
  corn: ["till", "spreadFertilizer", "ridge", "mulch", "directSeed", "hill", "spray", "forageBale", "transport"],
  sweetPotato: ["deepTill", "till", "spreadFertilizer", "ridge", "mulch", "transplant", "spray", "rootHarvest", "transport"],
  barleyWheat: ["till", "spreadFertilizer", "directSeed", "spray", "droneSpray", "riceHarvest", "thresh", "transport"],
  garlic: ["deepTill", "till", "spreadFertilizer", "ridge", "mulch", "garlicOnionPlant", "spray", "water", "rootHarvest", "transport"],
  onion: ["deepTill", "till", "spreadFertilizer", "ridge", "mulch", "garlicOnionPlant", "spray", "water", "rootHarvest", "transport"],
  radish: ["deepTill", "till", "spreadFertilizer", "ridge", "mulch", "directSeed", "spray", "water", "rootHarvest", "transport"],
  greenOnion: ["deepTill", "till", "spreadFertilizer", "ridge", "transplant", "hill", "spray", "water", "rootHarvest", "transport"],
  ginger: ["deepTill", "till", "spreadFertilizer", "ridge", "mulch", "directSeed", "spray", "water", "rootHarvest", "transport"],
  apple: ["spreadFertilizer", "orchardSpray", "water", "weedMow", "pruneShred", "transport"],
  pear: ["spreadFertilizer", "orchardSpray", "water", "weedMow", "pruneShred", "transport"],
  peach: ["spreadFertilizer", "orchardSpray", "water", "weedMow", "pruneShred", "transport"],
  grape: ["spreadFertilizer", "orchardSpray", "water", "weedMow", "pruneShred", "transport"],
  strawberry: ["till", "spreadFertilizer", "ridge", "mulch", "transplant", "spray", "water", "transport"],
  tomato: ["till", "spreadFertilizer", "ridge", "mulch", "transplant", "spray", "water", "transport"],
  sesame: ["till", "spreadFertilizer", "ridge", "mulch", "directSeed", "transplant", "spray", "thresh", "transport"],
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

