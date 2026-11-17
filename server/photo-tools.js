// 농농이 사진 상담 도구가 쓰는 순수 조회·계산 함수. 모델 판단 없이 검증 데이터만 돌려준다.
import { MACHINE_BY_ID } from "../src/data/farm-machines.js";
import { SPEC_BY_ID } from "../src/data/machine-specifications.js";
import { fetchRentalOffices } from "./integrations/rental-offices.js";
import { INSURANCE_PRODUCTS } from "./knowledge/insurance.js";
import { REPAIR_CENTERS } from "./knowledge/repair-centers.js";
import { MACHINE_GROUP_BY_TYPE, REPAIR_GUIDES } from "./knowledge/repair-guides.js";

const PRICE_NOTE = "플랫폼 등록 매물 기준 참고가예요. 실제 시세와 다를 수 있어요.";
const MAX_CENTERS = 5;

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** 비슷한 등록 매물의 중앙값·범위로 참고가를 낸다. 상태 보정은 하지 않는다. */
export function estimatePrice(listings, { purpose, modelId, machineType } = {}) {
  const type = purpose === "sale" ? "sale" : "rent";
  const unit = type === "sale" ? "total" : "day";
  const open = (Array.isArray(listings) ? listings : []).filter(
    (item) => item.type === type && item.status === "open" && Number.isFinite(Number(item.price)) && Number(item.price) > 0,
  );
  let basis = "none";
  let matches = [];
  if (modelId) {
    matches = open.filter((item) => item.modelId === modelId);
    if (matches.length) basis = "model";
  }
  if (!matches.length && machineType) {
    matches = open.filter((item) => item.machineType === machineType);
    if (matches.length) basis = "machineType";
  }
  if (!matches.length) {
    return { basis: "none", count: 0, median: null, min: null, max: null, unit, lowConfidence: true, note: `비슷한 매물이 없어 가격을 추천하기 어려워요. 가격은 직접 정해 주세요. ${PRICE_NOTE}` };
  }
  const prices = matches.map((item) => Number(item.price)).sort((a, b) => a - b);
  const lowConfidence = prices.length < 3;
  return {
    basis,
    count: prices.length,
    median: median(prices),
    min: prices[0],
    max: prices.at(-1),
    unit,
    lowConfidence,
    note: lowConfidence ? `비슷한 매물이 ${prices.length}건뿐이라 근거가 적어요. ${PRICE_NOTE}` : PRICE_NOTE,
  };
}

export function lookupMachineSpec({ modelId, machineType } = {}) {
  const spec = modelId ? SPEC_BY_ID[modelId] : null;
  if (spec) {
    return {
      model: { id: spec.id, brand: spec.brand, model: spec.model, machineType: spec.machineType, facts: spec.facts, unknowns: spec.unknowns, sources: spec.sources },
      machineType: { id: spec.machineType, label: MACHINE_BY_ID[spec.machineType]?.label || spec.machineType },
    };
  }
  const type = MACHINE_BY_ID[machineType];
  if (type) return { machineType: { id: type.id, label: type.label }, note: "카탈로그에 없는 모델이라 기종 수준으로만 안내해요." };
  return { error: "모델이나 기종을 알 수 없어요." };
}

/** 기종과 증상(또는 사용자 말)으로 안전 자가점검 가이드를 고른다. */
export function getRepairGuide({ machineType, symptom, text } = {}) {
  const group = MACHINE_GROUP_BY_TYPE[machineType];
  if (!group) return { error: "기종을 먼저 알려 주세요.", guides: [] };
  const forGroup = REPAIR_GUIDES.filter((guide) => guide.machineGroups.includes(group));
  let guides = symptom ? forGroup.filter((guide) => guide.symptom === symptom) : [];
  if (!guides.length && typeof text === "string" && text.trim()) {
    guides = forGroup.filter((guide) => guide.keywords.some((keyword) => text.includes(keyword))).slice(0, 1);
  }
  return {
    guides,
    symptoms: forGroup.map(({ symptom: id, symptomLabel }) => ({ id, label: symptomLabel })),
    note: guides.length
      ? "이 단계만 안내하세요. 중단 조건에 해당하면 바로 수리센터로 연결하세요."
      : "증상을 고를 수 없어요. 증상 목록에서 사용자에게 물어보세요.",
  };
}

const servesRegion = (center, region) => center.regions === "all" || (Array.isArray(center.regions) && center.regions.includes(region));

/** 지역 기관 → 해당 브랜드 제조사 → 나머지 제조사 순으로 최대 5곳. 임대사업소 API는 설정돼 있을 때만 덧붙인다. */
export async function findRepairCenters({ region, brand } = {}, { fetchOffices = fetchRentalOffices } = {}) {
  const local = REPAIR_CENTERS.filter((center) => center.kind !== "maker" && region && servesRegion(center, region));
  const brandMakers = REPAIR_CENTERS.filter((center) => center.kind === "maker" && brand && center.brands.includes(brand));
  const otherMakers = REPAIR_CENTERS.filter((center) => center.kind === "maker" && !brandMakers.includes(center));

  let offices = [];
  try {
    const result = await fetchOffices({ region: region || "" });
    if (result?.configured && Array.isArray(result.items)) {
      offices = result.items
        .filter((item) => item?.officeName && item?.phone)
        .map((item, index) => ({
          id: `office-${index}-${item.officeName}`,
          name: item.officeName,
          kind: "public",
          brands: [],
          regions: region ? [region] : [],
          services: "농기계 임대사업소 (공공데이터)",
          phone: item.phone,
          url: null,
          address: item.address || "",
          source: { title: "공공데이터포털 · 농기계 임대사업소 정보", url: "https://www.data.go.kr" },
          checkedAt: new Date().toISOString().slice(0, 10),
        }));
    }
  } catch {
    offices = [];
  }

  const seen = new Set();
  const centers = [];
  for (const center of [...local, ...offices, ...brandMakers, ...otherMakers]) {
    const key = `${center.name}|${center.phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    centers.push(center);
  }
  return {
    centers: centers.slice(0, MAX_CENTERS),
    note: "전화번호와 사이트는 이 결과에 있는 것만 안내하세요. 확인일도 함께 보여 주세요.",
  };
}

export function getInsuranceInfo({ role, machineType } = {}) {
  const audience = role === "owner" ? "owner" : "renter";
  const products = INSURANCE_PRODUCTS.filter(
    (product) => product.audience.includes(audience)
      && (product.machineTypes === "all" || !machineType || product.machineTypes.includes(machineType) || audience === "owner"),
  );
  return {
    products,
    note: "보험료는 기계와 조건에 따라 달라 확정해서 말하지 마세요. 가입은 지역 농협에서 확인하도록 안내하세요.",
  };
}
