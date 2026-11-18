import test from "node:test";
import assert from "node:assert/strict";
import { CROPS, MACHINE_TYPES, OPERATIONS } from "../src/data/farm-machines.js";
import { MACHINE_SPECIFICATIONS, SPEC_BY_ID, checkModelCompatibility, getSpecificationDefaults } from "../src/data/machine-specifications.js";
import { buildMockListings } from "../server/listing-seed.js";
import { listListings } from "../server/listings-db.js";

test("모든 시드 매물과 DB 응답이 실제 모델의 동일 사양을 사용한다", () => {
  const expectedListings = buildMockListings().length;
  for (const listings of [buildMockListings(), listListings()]) {
    assert.ok(listings.length > MACHINE_TYPES.length * 10);
    assert.equal(listings.length, expectedListings);
    assert.ok(new Set(listings.map((item) => item.modelId)).size >= MACHINE_TYPES.length);
    for (const item of listings) {
      const model = SPEC_BY_ID[item.modelId];
      assert.ok(model);
      assert.equal(item.brand, model.brand);
      assert.equal(item.machineType, model.machineType);
      assert.ok(item.title.includes(model.model));
      assert.deepEqual(item.specification.specs, model.specs);
      assert.equal(item.demo, true);
      assert.doesNotMatch(item.included, /로터리 포함/);
    }
  }
  for (const model of MACHINE_SPECIFICATIONS) {
    assert.ok(model.sources.length);
    assert.ok(model.sources.every((source) => new URL(source.url).protocol === "https:"));
  }
});

test("확장된 한국 농기계·작물·작업 카탈로그와 기종별 기본값이 모두 유효하다", () => {
  assert.equal(CROPS.length, 51);
  assert.equal(OPERATIONS.length, 29);
  assert.equal(MACHINE_TYPES.length, 31);
  assert.equal(MACHINE_SPECIFICATIONS.length, 206);
  assert.equal(new Set(CROPS.map((c) => c.id)).size, CROPS.length);
  assert.equal(new Set(OPERATIONS.map((o) => o.id)).size, OPERATIONS.length);
  assert.equal(new Set(MACHINE_TYPES.map((m) => m.id)).size, MACHINE_TYPES.length);
  assert.equal(new Set(MACHINE_SPECIFICATIONS.map((m) => m.id)).size, MACHINE_SPECIFICATIONS.length);
  for (const mt of MACHINE_TYPES) {
    assert.ok(MACHINE_SPECIFICATIONS.some((m) => m.machineType === mt.id), `${mt.id} 모델 누락`);
    const defs = getSpecificationDefaults(mt.id);
    assert.ok(defs.cropIds.length > 0 && defs.operations.length > 0);
    assert.ok(defs.areaMin > 0 && defs.areaMax >= defs.areaMin);
  }
});

test("제조사 명시 관리기 조합만 승인하고 다른 본체·출력 미달·브랜드 전용을 거른다", () => {
  assert.equal(checkModelCompatibility("asia-amc900", "asia-fm120n").status, "compatible");
  assert.equal(checkModelCompatibility("asia-amc1000", "asia-fm120n").status, "compatible");
  assert.equal(checkModelCompatibility("daedong-dk550", "asia-fm120n").status, "incompatible");
  assert.equal(checkModelCompatibility("asia-amc900", "knong-kgph9000").status, "incompatible");
  assert.equal(checkModelCompatibility("kubota-b2320", "dooroo-drp1006sg").status, "incompatible");
  assert.equal(checkModelCompatibility("tym-t75", "daedong-dl7000").status, "incompatible");
});

test("출력 범위가 맞더라도 미확인 연결을 호환으로 판정하지 않는다", () => {
  assert.equal(checkModelCompatibility("daedong-dk550", "knong-kgph9000").status, "check");
  assert.equal(checkModelCompatibility("daedong-dk600", "duru-dr950an").status, "check");
  assert.equal(checkModelCompatibility("missing", "asia-fm120n").status, "check");
  assert.equal(checkModelCompatibility("daedong-dk550", "daedong-drp60d").status, "notApplicable");
});

test("불명확한 출력 단위와 원문 표 오류를 임의 보정하지 않는다", () => {
  assert.equal(SPEC_BY_ID["knong-kgph9000"].specs.publishedTractorPowerRange.basis, "unspecified");
  assert.equal(SPEC_BY_ID["daedong-dk600"].specs.nominalPowerPs, 58);
  assert.equal(SPEC_BY_ID["daedong-dxm73gf5"].specs.weightKg, undefined);
  assert.equal(SPEC_BY_ID["asia-fm120n"].specs.weightKg, undefined);
});
