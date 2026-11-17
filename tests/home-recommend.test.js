import test from "node:test";
import assert from "node:assert/strict";
import { pickHomeRecommendations, matchHomeCriteria } from "../src/data/home-recommend.js";

const ops = { till: { defaultMachineTypes: ["tractor", "rotavator", "cultivator"] } };
const rent = (id, extra = {}) => ({
  id, type: "rent", status: "open", condition: "good", machineType: "cultivator",
  operations: ["till"], region: "영양읍", price: 50000, booked: [], ...extra,
});

const listings = [
  rent("a", { machineType: "cultivator" }),
  rent("b", { machineType: "tractor", region: "청기면" }),
  rent("c", { machineType: "tractor", booked: [{ start: "2026-04-10", end: "2026-04-11" }] }),
  rent("d", { machineType: "rotavator" }),
  rent("e", { machineType: "sprayer", operations: ["spray"] }),
  rent("f", { condition: "repair" }),
  { ...rent("g"), type: "sale" },
];

test("작업을 고르면 그 작업을 하는 매물만 남는다", () => {
  const out = matchHomeCriteria(listings, { operation: "spray" });
  assert.deepEqual(out.map((x) => x.id), ["e"]);
});

test("지역을 고르면 그 읍면 매물만 남는다", () => {
  const out = matchHomeCriteria(listings, { town: "청기면" });
  assert.deepEqual(out.map((x) => x.id), ["b"]);
});

test("날짜를 고르면 그 기간에 예약된 매물은 빠진다", () => {
  const out = matchHomeCriteria(listings, { date: "2026-04-10", dateEnd: "2026-04-10" });
  assert.ok(!out.some((x) => x.id === "c"));
  assert.ok(out.some((x) => x.id === "a"));
});

test("정비 중·판매 매물은 대여 추천에서 빠지고, 구매 탭에서는 판매 매물만 나온다", () => {
  const rentIds = matchHomeCriteria(listings, {}).map((x) => x.id);
  assert.ok(!rentIds.includes("f") && !rentIds.includes("g"));
  assert.deepEqual(matchHomeCriteria(listings, { transaction: "sale" }).map((x) => x.id), ["g"]);
});

test("작업에 가장 맞는 기종부터, 서로 다른 기종으로 3대를 고른다", () => {
  const { items, total } = pickHomeRecommendations(listings, { operation: "till" }, { operationById: ops });
  assert.equal(total, 4);
  assert.deepEqual(items.map((x) => x.machineType), ["tractor", "rotavator", "cultivator"]);
});

test("rankBoost는 순서만 바꾸고 조건 밖 매물을 넣지 않는다", () => {
  const { items } = pickHomeRecommendations(listings, { operation: "till" }, {
    operationById: ops,
    rankBoost: (item) => (item.machineType === "cultivator" ? -1000 : 0),
  });
  assert.equal(items[0].machineType, "cultivator");
  assert.ok(items.every((x) => x.operations.includes("till")));
});
