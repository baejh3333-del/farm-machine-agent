// 농농이 사진 상담 도구가 쓰는 순수 조회·계산 함수. 모델 판단 없이 검증 데이터만 돌려준다.
import { MACHINE_BY_ID } from "../src/data/farm-machines.js";
import { getRegionCoords } from "../src/data/korea-regions.js";
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

const servesRegion = (center, region) =>
  center.regions === "all"
  || (Array.isArray(center.regions) && center.regions.some((r) => region === r || region.includes(r) || r.includes(region)));

const matchesBrand = (center, brand) =>
  Array.isArray(center.brands) && center.brands.some((b) => brand === b || brand.includes(b) || b.includes(brand));

/** 지역 기관 → 해당 브랜드 제조사 → 나머지 제조사 순으로 최대 5곳. 임대사업소 API는 설정돼 있을 때만 덧붙인다. */
export async function findRepairCenters({ region, brand } = {}, { fetchOffices = fetchRentalOffices } = {}) {
  const local = REPAIR_CENTERS.filter((center) => center.kind !== "maker" && region && servesRegion(center, region));
  const brandMakers = REPAIR_CENTERS.filter((center) => center.kind === "maker" && brand && matchesBrand(center, brand));
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

// ── 가까운 수리센터 ──
export const NEARBY_CENTER_LIMIT = 3;
const NEARBY_MAX_KM = 100;

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 사용자가 설정한 지역에서 가까운 수리센터를 거리순으로 고른다(기본 3곳).
 * 1) 위치가 확인된 지역 창구(공공·지역)를 거리순으로, 100km 안쪽만
 * 2) 공공데이터 임대사업소(연동돼 있을 때)
 * 3) 모자라면 제조사 전국 A/S 창구(같은 제조사 먼저)로 채운다.
 * 전화번호·사이트는 등록된 공식 정보만 쓴다.
 */
export async function findNearestRepairCenters({ region, brand, limit = NEARBY_CENTER_LIMIT } = {}, { fetchOffices = fetchRentalOffices } = {}) {
  const origin = getRegionCoords(region || "");
  const originName = origin?.name || region || "";
  const located = [];

  for (const center of REPAIR_CENTERS) {
    if (center.kind === "maker" || !center.location) continue;
    const place = getRegionCoords(center.location);
    if (!place) continue;
    located.push({ ...center, distanceKm: Math.round(distanceKm(origin, place) * 10) / 10 });
  }

  try {
    const result = await fetchOffices({ region: region || "" });
    if (result?.configured && Array.isArray(result.items)) {
      result.items
        .filter((item) => item?.officeName && item?.phone)
        .forEach((item, index) => {
          const place = getRegionCoords(item.region || item.address || "");
          located.push({
            id: `office-${index}-${item.officeName}`,
            name: item.officeName,
            kind: "public",
            brands: [],
            services: "농기계 임대사업소 (공공데이터)",
            phone: item.phone,
            url: null,
            address: item.address || "",
            source: { title: "공공데이터포털 · 농기계 임대사업소 정보", url: "https://www.data.go.kr" },
            checkedAt: new Date().toISOString().slice(0, 10),
            distanceKm: place ? Math.round(distanceKm(origin, place) * 10) / 10 : null,
          });
        });
    }
  } catch {
    // 공공데이터 연동이 안 되면 등록된 창구만 쓴다.
  }

  const nearby = located
    .filter((center) => center.distanceKm === null || center.distanceKm <= NEARBY_MAX_KM)
    .sort((a, b) => (a.distanceKm ?? NEARBY_MAX_KM) - (b.distanceKm ?? NEARBY_MAX_KM));
  const makers = REPAIR_CENTERS.filter((center) => center.kind === "maker");
  const brandMakers = brand ? makers.filter((center) => center.brands.includes(brand)) : [];
  const otherMakers = makers.filter((center) => !brandMakers.includes(center));
  const fill = [...brandMakers, ...otherMakers].map((center) => ({ ...center, distanceKm: null, nationwide: true }));

  const seen = new Set();
  const centers = [];
  for (const center of [...nearby, ...fill]) {
    const key = `${center.name}|${center.phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    centers.push(center);
    if (centers.length >= limit) break;
  }
  return {
    origin: originName,
    centers,
    note: "가까운 순서예요. 위치가 확인된 지역 창구가 부족하면 제조사 전국 A/S 창구로 채웠어요. 전화번호와 사이트는 이 결과에 있는 것만 안내하세요.",
  };
}
