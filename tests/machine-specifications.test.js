import test from "node:test";
import assert from "node:assert/strict";
import { MACHINE_SPECIFICATIONS, SPEC_BY_ID, checkModelCompatibility } from "../src/data/machine-specifications.js";
import { buildMockListings } from "../server/listing-seed.js";
import { listListings } from "../server/listings-db.js";

test("모든 시드 매물과 DB 응답이 실제 모델의 동일 사양을 사용한다", () => {
  for (const listings of [buildMockListings(), listListings()]) {
    assert.equal(listings.length, 100);
    assert.equal(new Set(listings.map((item) => item.modelId)).size, 12);
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

test("제조사 명시 관리기 조합만 승인하고 다른 본체를 거른다", () => {
  assert.equal(checkModelCompatibility("asia-amc900", "asia-fm120n").status, "compatible");
  assert.equal(checkModelCompatibility("daedong-dk550", "asia-fm120n").status, "incompatible");
  assert.equal(checkModelCompatibility("asia-amc900", "knong-kgph9000").status, "incompatible");
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
