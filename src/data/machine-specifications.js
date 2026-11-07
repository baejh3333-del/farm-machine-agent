// Actual model specifications; rental price, stock, condition and bookings remain demo data.
// null means unverified, never a wildcard or a compatible connection.
const asia = (id) => `https://www.asiakor.com/mobile/design/subpage/goods.php?catalog=${id}&category=`;
const registry = "https://www.gunsan.go.kr/_cms/board/eFileDownload/95/8545851/ed8338a8650cf3cb8a45575fe684aa17#page=117";
const source = (url, title, note = "제조사 공개 제품 사양") => ({ url, title, note, checkedAt: "2026-11-07" });
const connection = (hostType, label, extra = {}) => ({ hostType, label, hitchCategory: null, pinDiameterMm: null, ptoSpline: null, ptoRpm: null, ...extra });
const standalone = connection(null, "독립 구동 · 트랙터/관리기 연결 불필요");

export const MACHINE_SPECIFICATIONS = [
  {
    id: "asia-amc900", brand: "아세아텍", model: "AMC-900", machineType: "cultivator", role: "powerUnit",
    specs: { engineModel: "GB290L", displacementCc: 296, ratedPowerKw: 4.8, maxPowerKw: 5.8, weightKg: 162, ptoRpm: [714, 1350] },
    facts: [["엔진", "GB290L · 296 cc"], ["출력", "정격 4.8 kW / 최대 5.8 kW"], ["기체 중량", "162 kg"], ["PTO 회전수", "714 / 1,350 rpm"]],
    connection: connection("cultivator", "아세아 관리기 전용 히치핀 방식", { family: "asia-900", ptoRpm: [714, 1350] }),
    sources: [source(asia("G1619677688"), "아세아텍 AMC-900")],
    unknowns: ["히치핀 직경", "PTO 축 치수", "연식별 엔진 사양"],
  },
  ...[["450", 45, 33.5], ["550", 55, 41], ["600", 58, 43]].map(([series, ps, kw]) => ({
    id: `daedong-dk${series}`, brand: "대동", model: `DK${series}HSRQ5`, machineType: "tractor", role: "powerUnit",
    specs: { nominalPowerPs: ps, enginePowerKw: kw, engineRpm: 2600, displacementCc: 1826, ptoRpm: [540, 750, 1000], rearHydraulicPorts: 6 },
    facts: [["호칭 마력", `${ps} PS`], ["엔진 출력", `${kw} kW / 2,600 rpm`], ["배기량", "1,826 cc"], ["독립형 PTO", "540 / 750 / 1,000 rpm"], ["후방 유압 인출구", "6개"]],
    connection: connection("tractor", "트랙터 작업기 연결 · 히치 세부 규격 확인 필요", { ptoRpm: [540, 750, 1000] }),
    sources: [source("https://ko.daedong.co.kr/product/12", "대동 DK 시리즈 · 상세 형식별 제원")],
    unknowns: ["3점 히치 카테고리", "핀 직경", "PTO 축 규격", "작업 위치별 승강력"],
  })),
  {
    id: "asia-fm120n", brand: "아세아텍", model: "FM-120N", machineType: "ridgeMulcher", role: "implement",
    specs: { dimensionsMm: [1400, 1420, 800], roundRidgeFilmWidthMm: [750, 1200], squareRidgeFilmWidthMm: [750, 1800] },
    facts: [["크기 (로타리 부착 상태)", "1,400 × 1,420 × 800 mm"], ["둥근 두둑 비닐 폭", "750~1,200 mm"], ["각 두둑 비닐 폭", "750~1,800 mm"], ["제조사 부착 가능 기종", "아세아 880 / 900 / 1000 시리즈"]],
    connection: connection("cultivator", "아세아 관리기 전용", { approvedModelIds: ["asia-amc900"] }),
    sources: [source(asia("G1619677610"), "아세아텍 FM-120N")],
    unknowns: ["히치핀 직경", "PTO 입력 회전수", "중량: 원문 단위 오류로 수치 채택 보류"],
  },
  {
    id: "yanmar-ph1r", brand: "얀마", model: "PH1,R", machineType: "transplanter", role: "standalone",
    specs: { dimensionsMm: [1900, 1340, 1220], weightKg: 163, ratedPowerKw: 1.6, rows: 1, plantSpacingMm: [200, 500], ridgeHeightMm: [0, 300] },
    facts: [["형식", "1조식 · 일본 R 사양"], ["크기", "1,900 × 1,340 × 1,220 mm"], ["중량 / 정격 출력", "163 kg / 1.6 kW"], ["주간 / 두둑 높이", "200~500 mm / 0~300 mm"]],
    connection: standalone,
    sources: [source("https://www.yanmar.com/jp/agri/products/vegetable/vegetable_replant/ph1r/spec.html", "얀마 PH1,R 제원", "일본 R 사양. 국내 유통 사양과 동일하다고 가정하지 않음")],
    unknowns: ["국내 유통 사양", "실제 모종·트레이 적합성"],
  },
  {
    id: "daedong-drp60d", brand: "대동", model: "DRP60D", machineType: "ricePlanter", role: "standalone",
    specs: { nominalPowerPs: 24, maxPowerKw: 17.9, displacementCc: 1007, rows: 6, dimensionsMm: [3330, 2200, 2275] },
    facts: [["이앙 조수", "6조식"], ["디젤 엔진", "24 PS · 1,007 cc"], ["최대 출력", "17.9 kW / 3,000 rpm"], ["크기", "3,330 × 2,200 × 2,275 mm"]],
    connection: standalone, sources: [source("https://ko.daedong.co.kr/product/34", "대동 DRP60D")], unknowns: ["육묘 상자·모 상태 적합성"],
  },
  {
    id: "honda-wjr2525t", brand: "혼다", model: "WJR2525T", machineType: "sprayer", role: "standalone",
    specs: { chemicalTankL: 25, dryWeightKg: 10, displacementCc: 25, flowLMin: 6.6 },
    facts: [["형식", "배부식 동력분무기 · 에콰도르 공개 사양"], ["약액 탱크", "25 L"], ["건조 중량", "10 kg"], ["배기량 / 토출량", "25 cc / 6.6 L/min"]],
    connection: standalone, sources: [source("https://motos.honda.com.ec/producto-de-fuerza/fumigadora-de-mochila-wjr2525-1", "혼다 WJR2525T 제원", "해외 사양. 엔진 행정·출력 표기에 의문이 있어 해당 값 제외")], unknowns: ["국내 유통 사양", "노즐·호스 연결 규격"],
  },
  {
    id: "knong-kgph9000", brand: "강농", model: "KG-PH9000", machineType: "potatoPlanter", role: "implement",
    specs: { rows: 2, publishedTractorPowerRange: { min: 50, max: 90, unit: "마력(원문)", basis: "unspecified" } },
    facts: [["파종", "2줄 재배"], ["부착 방식", "트랙터 부착형"], ["제조사 안내 트랙터 범위", "50~90마력 (원문 단위·출력 기준 미명시)"], ["배종 구동", "지륜 바퀴 동력 전달"]],
    connection: connection("tractor", "트랙터 부착형 · 로터리/성형부 구성 확인 필요"),
    sources: [source("https://www.knong.kr/blank-6", "강농 KG-PH9000")], unknowns: ["히치 카테고리·핀", "로터리 PTO 입력 규격", "유압 요구량", "기체 중량", "적용 마력의 PS/HP 및 엔진/PTO 기준"],
  },
  {
    id: "daedong-dxm73gf5", brand: "대동", model: "DXM73GF5", machineType: "combine", role: "standalone",
    specs: { nominalPowerPs: 73, rows: 4, dimensionsMm: [4390, 2505, 3155] },
    facts: [["예취 조수", "4조식"], ["호칭 마력", "73 PS"], ["크기", "4,390 × 2,505 × 3,155 mm"]],
    connection: standalone, sources: [source("https://ko.daedong.co.kr/product/25", "대동 DXM73GF5", "웹 제원표 일부 행이 어긋나 있어 중량·배기량 등 제외")], unknowns: ["중량·엔진 세부 제원: 원문 표 오류로 재확인 필요"],
  },
  {
    id: "duru-dr950an", brand: "두루기계통상", model: "DR-950AN", machineType: "potatoHarvester", role: "implement",
    specs: { workingWidthMm: 950, publishedTractorPowerRange: { min: 43, max: null, unit: "마력(원문)", basis: "unspecified" } },
    facts: [["작업 폭", "950 mm"], ["적용 트랙터", "43마력 이상 (2026 목록집 기준)"], ["용도", "트랙터용 감자 수확기"]],
    connection: connection("tractor", "트랙터 부착형 · 상세 연결 규격 확인 필요"),
    sources: [source(registry, "한국농기계공업협동조합 2026 목록집 · 인쇄 115쪽", "군산시 공개 원문. 유통 자료의 35마력과 달라 2026 목록의 43마력 채택")],
    unknowns: ["연식별 적용 마력 차이", "마력의 PS/HP 및 엔진/PTO 기준", "히치·PTO 규격", "승강력·중량"],
  },
  {
    id: "daedong-mechron2450", brand: "대동", model: "Mechron2450", machineType: "carrier", role: "standalone",
    specs: { maxPowerKw: 18, displacementCc: 1007, dimensionsMm: [3045, 1640, 1990], weightKg: 1050 },
    facts: [["최대 출력", "18 kW / 3,200 rpm"], ["디젤 엔진 배기량", "1,007 cc"], ["크기", "3,045 × 1,640 × 1,990 mm"], ["중량", "1,050 kg"]],
    connection: standalone, sources: [source("https://ko.daedong.co.kr/product/36", "대동 Mechron2450")], unknowns: ["세부 옵션별 적재 한도"],
  },
];

export const SPEC_BY_ID = Object.fromEntries(MACHINE_SPECIFICATIONS.map((model) => [model.id, model]));

export function applyModelSpecification(listing, index = 0) {
  const models = MACHINE_SPECIFICATIONS.filter((model) => model.machineType === listing.machineType);
  const model = models[index % models.length];
  if (!model) return listing;
  const label = model.role === "implement" ? "작업기 단품 · 동력 본체 별도" : model.role === "powerUnit" ? "본체 · 부착 작업기 별도 확인" : "독립 구동 본체";
  return { ...listing, modelId: model.id, model: model.model, brand: model.brand, specification: model,
    title: `${model.brand} ${model.model} · ${listing.region}`,
    included: label,
    description: `실제 ${model.model}의 공개 사양을 참조한 가상 매물입니다. 가격·점검일·예약·작업 면적은 시연용입니다. ${label}.`,
    summary: `${model.brand} ${model.model}. ${model.facts[0][1]}. ${label}.`,
    demo: true,
  };
}

// Manufacturer-listed pairings only. Power alone cannot establish compatibility.
export function checkModelCompatibility(powerUnitId, implementId) {
  const power = SPEC_BY_ID[powerUnitId];
  const implement = SPEC_BY_ID[implementId];
  if (!power || !implement) return { status: "check", reason: "모델 사양 확인 필요" };
  if (implement.role !== "implement") return { status: "notApplicable", reason: "부착 작업기가 아닙니다" };
  if (power.role !== "powerUnit" || power.machineType !== implement.connection.hostType) {
    return { status: "incompatible", reason: "동력 본체 종류가 다릅니다" };
  }
  if (implement.connection.approvedModelIds?.includes(power.id)) {
    return { status: "compatible", reason: "제조사가 부착 가능 기종으로 명시했습니다. 실제 연식·부속 구성은 인수 전에 확인하세요." };
  }
  return { status: "check", reason: "히치·PTO·승강력 등 상세 연결 규격 확인 필요" };
}
