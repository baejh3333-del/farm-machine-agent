import assert from "node:assert/strict";
import { test } from "node:test";

import {
  estimatePrice,
  findRepairCenters,
  getInsuranceInfo,
  getRepairGuide,
  lookupMachineSpec,
} from "../server/photo-tools.js";

const listing = (id, type, price, extra = {}) => ({
  id, type, price, status: "open", modelId: null, machineType: "cultivator", ...extra,
});

const LISTINGS = [
  listing("a1", "rent", 40000, { modelId: "A" }),
  listing("a2", "rent", 50000, { modelId: "A" }),
  listing("a3", "rent", 60000, { modelId: "A" }),
  listing("a4", "sale", 3000000, { modelId: "A" }),
  listing("a5", "rent", 999999, { modelId: "A", status: "removed" }),
  listing("t1", "rent", 100000, { machineType: "tractor" }),
  listing("t2", "rent", 150000, { machineType: "tractor" }),
];

test("가격은 같은 모델 → 같은 기종 순으로 찾고 중앙값·범위를 낸다", () => {
  const result = estimatePrice(LISTINGS, { purpose: "rent", modelId: "A" });
  assert.deepEqual(
    { basis: result.basis, count: result.count, median: result.median, min: result.min, max: result.max, unit: result.unit, lowConfidence: result.lowConfidence },
    { basis: "model", count: 3, median: 50000, min: 40000, max: 60000, unit: "day", lowConfidence: false },
  );
  assert.match(result.note, /플랫폼 등록 매물 기준 참고가/);
});

test("모델 매물이 없으면 기종으로, 3건 미만이면 lowConfidence", () => {
  const result = estimatePrice(LISTINGS, { purpose: "rent", modelId: "없는모델", machineType: "tractor" });
  assert.equal(result.basis, "machineType");
  assert.equal(result.count, 2);
  assert.equal(result.lowConfidence, true);
});

test("비교 매물이 없으면 가격을 내지 않는다", () => {
  const result = estimatePrice(LISTINGS, { purpose: "sale", machineType: "combine" });
  assert.equal(result.basis, "none");
  assert.equal(result.count, 0);
  assert.equal(result.median, null);
  assert.match(result.note, /직접/);
});

test("짝수 건수 중앙값은 두 가운데 값의 평균을 원 단위로 반올림한다", () => {
  const result = estimatePrice(
    [listing("x", "rent", 10001, { machineType: "carrier" }), listing("y", "rent", 20000, { machineType: "carrier" })],
    { purpose: "rent", machineType: "carrier" },
  );
  assert.equal(result.median, 15001);
});

test("판매 가격은 total 단위로 계산한다", () => {
  assert.equal(estimatePrice(LISTINGS, { purpose: "sale", modelId: "A" }).unit, "total");
});

test("제원 조회는 카탈로그 모델을 돌려주고 없는 모델은 기종 수준으로 답한다", () => {
  const model = lookupMachineSpec({ modelId: "asia-amc900" });
  assert.equal(model.model.brand, "아세아텍");
  assert.ok(model.model.facts.length > 0);
  const typeOnly = lookupMachineSpec({ modelId: "nope", machineType: "tractor" });
  assert.equal(typeOnly.model, undefined);
  assert.equal(typeOnly.machineType.label, "트랙터");
  assert.ok(lookupMachineSpec({}).error);
});

test("수리 가이드는 증상 키워드로 고른다", () => {
  const result = getRepairGuide({ machineType: "cultivator", text: "시동이 안 걸려요" });
  assert.equal(result.guides[0].symptom, "noStart");
  assert.ok(result.guides[0].machineGroups.includes("engine"));
});

test("수리 가이드는 증상을 못 고르면 증상 목록을 준다", () => {
  const result = getRepairGuide({ machineType: "sprayer", text: "그냥 이상해요" });
  assert.deepEqual(result.guides, []);
  assert.ok(result.symptoms.length >= 4);
});

test("수리센터는 지역 기관이 먼저, 브랜드 제조사가 다음이다", async () => {
  const { centers } = await findRepairCenters({ region: "영양읍", brand: "대동" }, { fetchOffices: async () => ({ configured: false, items: [] }) });
  assert.notEqual(centers[0].kind, "maker");
  assert.equal(centers[1].kind, "maker");
  assert.ok(centers[1].brands.includes("대동"));
  assert.ok(centers.length <= 5);
});

test("임대사업소 API 결과를 합치고 중복을 없앤다", async () => {
  const office = { officeName: "OO 임대사업소", phone: "054-000-0000", region: "경북 영양군", address: "영양읍" };
  const { centers } = await findRepairCenters(
    { region: "영양읍" },
    { fetchOffices: async () => ({ configured: true, items: [office, { ...office }] }) },
  );
  assert.equal(centers.filter((center) => center.name === "OO 임대사업소").length, 1);
});

test("임대사업소 API가 실패해도 큐레이션 결과는 나온다", async () => {
  const { centers } = await findRepairCenters({ region: "영양읍" }, { fetchOffices: async () => { throw new Error("down"); } });
  assert.ok(centers.length > 0);
});

test("보험 안내는 역할에 맞는 상품만 준다", () => {
  const renter = getInsuranceInfo({ role: "renter" });
  assert.ok(renter.products.every((product) => product.audience.includes("renter")));
  assert.ok(renter.products.some((product) => product.id === "farmer-safety"));
  const owner = getInsuranceInfo({ role: "owner", machineType: "tractor" });
  assert.ok(owner.products.some((product) => product.id === "farm-machinery-comprehensive"));
});
