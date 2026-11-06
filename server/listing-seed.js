import { CROP_BY_ID, MACHINE_BY_ID, OPERATION_BY_ID } from "../src/data/farm-machines.js";

const seed = [
  { id: "r1", type: "rent", title: "대동 관리기 8마력 · 로터리 포함", brand: "대동", machineType: "cultivator", cropIds: ["pepper", "cabbage", "potato"], operations: ["till", "ridge"], areaMin: 100, areaMax: 3500, price: 45000, region: "영양읍", condition: "good", inspectedAt: "2026-10-21", included: "로터리 작업기", pickup: "직접 인수", description: "고추밭 흙갈이와 두둑 작업에 사용했습니다. 현장에서 작동 확인 가능합니다.", summary: "고추·배추·감자 100~3,500㎡ 밭의 흙갈이와 두둑 작업에 쓰는 관리기입니다.", booked: [{ start: "2026-11-09", end: "2026-11-10" }], owner: true },
  { id: "r2", type: "rent", title: "두둑·멀칭 겸용 휴립피복기", brand: "아세아", machineType: "ridgeMulcher", cropIds: ["pepper", "cabbage", "potato"], operations: ["ridge", "mulch"], areaMin: 300, areaMax: 5000, price: 65000, region: "청기면", condition: "good", inspectedAt: "2026-10-08", included: "피복 작업기", pickup: "운반 협의", description: "두둑을 만들며 비닐을 씌웁니다. 필름 폭과 두둑 폭을 문의해 주세요.", summary: "고추·배추·감자 밭에서 두둑을 만들고 멀칭하는 겸용 장비입니다.", booked: [], owner: false },
  { id: "r3", type: "rent", title: "고추·배추 모종 정식기", brand: "아세아", machineType: "transplanter", cropIds: ["pepper", "cabbage"], operations: ["transplant"], areaMin: 300, areaMax: 5000, price: 70000, region: "청기면", condition: "good", inspectedAt: "2026-10-02", included: "기본 부속품", pickup: "직접 인수", description: "트레이와 모종 크기, 두둑 간격을 먼저 확인해 주세요.", summary: "고추·배추 모종을 옮겨 심는 장비로, 트레이와 두둑 규격 확인이 필요합니다.", booked: [], owner: false },
  { id: "r4", type: "rent", title: "동력 분무기 · 호스 세트", brand: "한일", machineType: "sprayer", cropIds: ["pepper", "cabbage", "potato"], operations: ["spray"], areaMin: 100, areaMax: 5000, price: 30000, region: "입암면", condition: "good", inspectedAt: "2026-09-28", included: "호스·노즐", pickup: "직접 인수", description: "사용 전 시동·노즐 상태를 함께 점검해 드립니다.", summary: "고추·배추·감자 밭의 방제에 쓰며 호스와 노즐이 포함됩니다.", booked: [], owner: false },
  { id: "r5", type: "rent", title: "벼 이앙기 6조식", brand: "국제", machineType: "ricePlanter", cropIds: ["rice"], operations: ["ricePlant"], areaMin: 1000, areaMax: 12000, price: 160000, region: "수비면", condition: "good", inspectedAt: "2026-10-15", included: "기본 구성", pickup: "운반 협의", description: "육묘 상자 규격, 논 진입로와 평탄도를 먼저 확인해 주세요.", summary: "벼 모를 논에 옮겨 심는 6조식 이앙기로 육묘·진입로 확인이 필요합니다.", booked: [], owner: false },
  { id: "r6", type: "rent", title: "벼 수확용 콤바인 4조식", brand: "대동", machineType: "combine", cropIds: ["rice"], operations: ["riceHarvest"], areaMin: 2000, areaMax: 20000, price: 230000, region: "수비면", condition: "good", inspectedAt: "2026-10-17", included: "기본 구성", pickup: "운반 협의", description: "논 바닥 상태와 수확물 운반 방법을 미리 상의해 주세요.", summary: "벼 수확에 쓰는 콤바인으로 논 진입과 수확물 운반 계획이 필요합니다.", booked: [], owner: false },
  { id: "r7", type: "rent", title: "감자 파종기 2열", brand: "태광", machineType: "potatoPlanter", cropIds: ["potato"], operations: ["seed"], areaMin: 500, areaMax: 8000, price: 80000, region: "입암면", condition: "good", inspectedAt: "2026-10-12", included: "파종 작업기", pickup: "직접 인수", description: "씨감자 크기와 두둑 간격에 맞는지 확인해 주세요.", summary: "감자밭에 씨감자를 두 줄로 심는 장비이며 씨감자 규격 확인이 필요합니다.", booked: [], owner: false },
  { id: "r8", type: "rent", title: "감자 굴취기", brand: "아세아", machineType: "potatoHarvester", cropIds: ["potato"], operations: ["potatoHarvest"], areaMin: 500, areaMax: 8000, price: 90000, region: "청기면", condition: "good", inspectedAt: "2026-10-05", included: "굴취 작업기", pickup: "운반 협의", description: "돌과 토양 수분에 따라 작업성이 달라집니다. 굴취 폭을 확인해 주세요.", summary: "감자를 캐는 작업기로 밭의 돌·수분과 굴취 폭을 확인해야 합니다.", booked: [], owner: false },
  { id: "s1", type: "sale", title: "국제 관리기 7마력 판매", brand: "국제", machineType: "cultivator", cropIds: ["pepper", "cabbage", "potato"], operations: ["till", "ridge"], areaMin: 100, areaMax: 3000, price: 680000, region: "영양읍", condition: "used", inspectedAt: "2026-10-11", included: "로터리 작업기", pickup: "현장 확인 후 인수", description: "시동과 로터리 작동을 현장에서 확인할 수 있습니다.", summary: "고추·배추·감자 소규모 밭의 흙갈이에 쓰며 로터리가 포함된 중고 관리기입니다.", booked: [], owner: true },
  { id: "s2", type: "sale", title: "대동 휴립피복기 판매", brand: "대동", machineType: "ridgeMulcher", cropIds: ["pepper", "cabbage"], operations: ["ridge", "mulch"], areaMin: 300, areaMax: 5000, price: 1250000, region: "청기면", condition: "good", inspectedAt: "2026-10-08", included: "피복 작업기", pickup: "현장 확인 후 인수", description: "두둑 폭과 필름 규격을 현장에서 확인해 주세요.", summary: "고추·배추 밭 두둑 성형과 멀칭에 쓰는 겸용 기계입니다.", booked: [], owner: false },
  { id: "s3", type: "sale", title: "중고 이앙기 6조식", brand: "국제", machineType: "ricePlanter", cropIds: ["rice"], operations: ["ricePlant"], areaMin: 1000, areaMax: 12000, price: 3200000, region: "수비면", condition: "good", inspectedAt: "2026-09-15", included: "기본 구성", pickup: "현장 확인 후 인수", description: "올해 모내기까지 사용했고 현장 작동 확인 가능합니다.", summary: "벼 모심기에 쓰는 6조식 이앙기로 논과 육묘 규격을 확인하세요.", booked: [], owner: false },
  { id: "s4", type: "sale", title: "중형 농업용 방제기", brand: "한일", machineType: "sprayer", cropIds: ["pepper", "cabbage"], operations: ["spray"], areaMin: 300, areaMax: 7000, price: 420000, region: "입암면", condition: "good", inspectedAt: "2026-10-02", included: "호스·노즐", pickup: "직접 인수", description: "부속품과 작동 상태를 직접 확인할 수 있습니다.", summary: "고추·배추 방제에 쓰는 중형 기계로 호스와 노즐이 포함됩니다.", booked: [], owner: false },
];

const originalListings = seed.map((item) => ({ ...item, status: "open" }));

const fields = ["pepper", "cabbage", "potato"];
const allCrops = [...fields, "rice"];
const regions = ["영양읍", "청기면", "입암면", "수비면"];

// Specifications and prices are fictional demo data, not model or price claims.
const profiles = {
  cultivator: [fields, ["till", "ridge"], [100, 3500], [40000, 600000], "로터리·두둑 작업기", ["소형 로터리형", "두둑 성형형", "폭 조절형"]],
  tractor: [allCrops, ["till"], [1000, 18000], [130000, 8500000], "로터리 작업기", ["35마력", "45마력", "55마력"]],
  ridgeMulcher: [fields, ["ridge", "mulch"], [300, 5000], [55000, 900000], "피복 롤러", ["1두둑형", "폭 조절형", "배토판 포함"]],
  transplanter: [["pepper", "cabbage"], ["transplant"], [300, 6000], [65000, 1000000], "모종 트레이 거치대", ["1조식", "2조식", "주간 조절형"]],
  ricePlanter: [["rice"], ["ricePlant"], [700, 15000], [120000, 2300000], "예비 모판 받침", ["4조식", "6조식", "8조식"]],
  sprayer: [allCrops, ["spray"], [100, 9000], [25000, 350000], "호스·노즐", ["이동식", "릴 호스형", "탱크형"]],
  potatoPlanter: [["potato"], ["seed"], [400, 8500], [65000, 850000], "씨감자 투입통", ["1열", "2열", "간격 조절형"]],
  combine: [["rice"], ["riceHarvest"], [1800, 22000], [190000, 9500000], "곡물 배출 장치", ["3조식", "4조식", "5조식"]],
  potatoHarvester: [["potato"], ["potatoHarvest"], [400, 9000], [75000, 1100000], "굴취날·진동 선별판", ["1열", "2열", "굴취 깊이 조절형"]],
  carrier: [allCrops, ["transport"], [100, 18000], [45000, 1300000], "적재함·고정 고리", ["소형 궤도형", "덤프형", "사륜형"]],
};

export function buildMockListings() {
  const listings = [...originalListings];
  Object.entries(profiles).forEach(([machineType, profile], kind) => {
    for (const [type, target] of [["rent", 6], ["sale", 4]]) {
      const existing = originalListings.filter((item) => item.machineType === machineType && item.type === type).length;
      for (let slot = existing; slot < target; slot++) {
        const [baseCrops, baseOperations, [areaMin, max], prices, baseIncluded, variants] = profile;
        const cropIds = machineType === "tractor" && slot % 3 === 1 ? ["rice"]
          : machineType === "cultivator" && slot % 3 === 2 ? ["potato"] : baseCrops;
        const operations = machineType === "tractor" && slot % 3 === 1 ? ["till", "level"]
          : machineType === "cultivator" && slot % 3 === 2 ? ["ridge", "hill"] : baseOperations;
        const included = operations.includes("level") ? "로터리·균평판" : operations.includes("hill") ? "배토기" : baseIncluded;
        const label = MACHINE_BY_ID[machineType].label;
        const variant = variants[slot % variants.length];
        const region = regions[(kind + slot + (type === "sale" ? 1 : 0)) % regions.length];
        const condition = type === "sale" && slot % 2 === 1 ? "used" : "good";
        const work = operations.map((id) => OPERATION_BY_ID[id].label).join(", ");
        const cropNames = cropIds.map((id) => CROP_BY_ID[id].name).join("·");
        listings.push({
          id: `mock-${machineType}-${type}-${slot + 1}`, type,
          title: `${variant} ${label} · ${region}`, brand: "데모 장비", machineType, cropIds, operations,
          areaMin, areaMax: max + (slot % 3) * 250,
          price: type === "rent" ? prices[0] + slot * 5000 : prices[1] + slot * 150000,
          region, condition,
          inspectedAt: `2026-10-${String(1 + (kind * 3 + slot * 5) % 28).padStart(2, "0")}`,
          included,
          pickup: type === "sale" ? "현장 확인 후 인수" : slot % 2 ? "운반 협의" : "직접 인수",
          description: `시연용 가상 매물입니다. ${included} 구성과 작동 상태를 인수 전에 확인하는 설정입니다.`,
          summary: `${cropNames}의 ${work}에 쓰는 ${label}입니다. ${included} 포함.`,
          booked: type === "rent" && slot % 3 === 0 ? [{ start: "2026-11-14", end: "2026-11-15" }] : [],
          owner: false, status: "open",
        });
      }
    }
  });
  return listings;
}
