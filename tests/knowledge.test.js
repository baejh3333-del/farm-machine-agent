import assert from "node:assert/strict";
import { test } from "node:test";

import { MACHINE_TYPES } from "../src/data/farm-machines.js";
import { INSURANCE_PRODUCTS } from "../server/knowledge/insurance.js";
import { REPAIR_CENTERS } from "../server/knowledge/repair-centers.js";
import { MACHINE_GROUP_BY_TYPE, REPAIR_GUIDES } from "../server/knowledge/repair-guides.js";

const SYMPTOMS = ["noStart", "lowPowerSmoke", "noiseVibration", "leak", "implementNotWorking", "afterStorage"];
const GROUPS = ["engine", "implement", "sprayer"];
const PHONE = /^(0\d{1,2}-\d{3,4}-\d{4}|1\d{3}-\d{4})$/;
const MAKERS = ["대동", "아세아텍", "얀마", "혼다", "강농", "두루기계통상"];

test("모든 지식 항목에 출처 URL과 확인일이 있다", () => {
  for (const item of [...REPAIR_GUIDES, ...REPAIR_CENTERS, ...INSURANCE_PRODUCTS]) {
    assert.match(item.source?.url || "", /^https:\/\//, `${item.id} 출처 URL`);
    assert.ok(item.source?.title, `${item.id} 출처 제목`);
    assert.match(item.checkedAt || "", /^\d{4}-\d{2}-\d{2}$/, `${item.id} 확인일`);
  }
});

test("수리 가이드는 6개 증상 × 3개 기종군을 덮는다", () => {
  for (const group of GROUPS) {
    for (const symptom of SYMPTOMS) {
      if (group === "sprayer" && symptom === "implementNotWorking") continue;
      assert.ok(
        REPAIR_GUIDES.some((guide) => guide.symptom === symptom && guide.machineGroups.includes(group)),
        `${group} × ${symptom} 가이드 없음`,
      );
    }
  }
});

test("자가점검 단계는 엔진 정지로 시작하고 위험 작업을 안내하지 않는다", () => {
  const danger = /분해|해체|뜯어|용접|유압 호스를 풀|노즐.*(입|손가락)|작동 중/;
  for (const guide of REPAIR_GUIDES) {
    assert.match(guide.safetyFirst[0], /엔진.*(끄|정지)/, `${guide.id} 첫 안전 수칙`);
    for (const step of guide.steps) assert.doesNotMatch(step.text, danger, `${guide.id}: ${step.text}`);
    assert.ok(guide.stopIf.length >= 2, `${guide.id} 중단 조건`);
    assert.ok(guide.steps.length >= 3 && guide.steps.length <= 6, `${guide.id} 단계 수`);
  }
});

test("모든 기종이 기종군에 연결된다", () => {
  for (const { id } of MACHINE_TYPES) assert.ok(GROUPS.includes(MACHINE_GROUP_BY_TYPE[id]), id);
});

test("수리센터 연락처는 국내 번호 형식이거나 null이고, 전화·사이트 중 하나는 있다", () => {
  for (const center of REPAIR_CENTERS) {
    assert.ok(center.phone === null || PHONE.test(center.phone), `${center.id} 전화 ${center.phone}`);
    assert.ok(center.url === null || /^https?:\/\//.test(center.url), `${center.id} 사이트`);
    assert.ok(center.phone || center.url, `${center.id} 연락처 없음`);
    assert.ok(["public", "coop", "maker"].includes(center.kind));
  }
});

test("영양군 기관 1곳 이상과 카탈로그 제조사 A/S 창구가 있다", () => {
  assert.ok(REPAIR_CENTERS.some((c) => c.kind !== "maker" && Array.isArray(c.regions) && c.regions.includes("영양읍")));
  for (const brand of MAKERS) {
    assert.ok(REPAIR_CENTERS.some((c) => c.kind === "maker" && c.brands.includes(brand)), `${brand} A/S 창구 없음`);
  }
});

test("보험은 빌려주는 사람과 빌리는 사람 모두에게 안내할 항목이 있다", () => {
  assert.ok(INSURANCE_PRODUCTS.some((p) => p.audience.includes("owner")));
  assert.ok(INSURANCE_PRODUCTS.some((p) => p.audience.includes("renter")));
  for (const product of INSURANCE_PRODUCTS) {
    assert.ok(product.whereToJoin.length >= 1 && product.checklist.length >= 1, product.id);
  }
});

test("[리뷰] 기계를 다시 움직이는 단계는 시동을 다시 건 뒤라고 밝히고, 배터리 단자 연결은 맡기지 않는다", () => {
  const rerun = /속도를 낮|예열|돌려 보|돌려 새|돌려|시동이 걸리면/;
  for (const guide of REPAIR_GUIDES) {
    for (const step of guide.steps) {
      if (rerun.test(step.text)) assert.match(step.text, /^\(다시 시동한 뒤\)/, `${guide.id}: ${step.text}`);
      assert.doesNotMatch(step.text, /단자는 다시 연결/, `${guide.id}: ${step.text}`);
    }
  }
});
