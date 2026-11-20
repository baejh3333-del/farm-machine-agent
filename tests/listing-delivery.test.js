// 판매·대여 매물의 운송 방식(직접 운송 / 구매자·대여자 직접 픽업) 체크 조건
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanDeliveryMethods, deliveryLine, deliveryOf, hasDeliverySignal, inferDeliveryMethods, pickupLabel, readDeliveryFromText } from "../src/data/delivery.js";
import { normalizeListingFields } from "../server/listings-service.js";
import { toListingDto } from "../server/listings-db.js";
import { executeListingAction, resolveDelivery, runAgentTurn, searchListingsTool } from "../server/nongnong-agent.js";
import { extractTaskSlots } from "../src/ai/gpt-live.js";
import { buildMockListings } from "../server/listing-seed.js";

const LISTINGS = buildMockListings();
const TODAY = "2026-11-16";
const AI_ENV = ["AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"];
function withKey(t) {
  const previous = Object.fromEntries(AI_ENV.map((name) => [name, process.env[name]]));
  for (const name of AI_ENV) delete process.env[name];
  process.env.ANTHROPIC_API_KEY = "test";
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}
function scripted(responses) {
  const calls = [];
  const call = async (request) => {
    calls.push(structuredClone(request));
    const next = responses.shift();
    return next === undefined ? null : next;
  };
  return { call, calls };
}
const BASE = { type: "rent", machineType: "tractor", brand: "대동", title: "대동 트랙터", cropIds: ["pepper"], operations: ["till"], areaMin: 100, areaMax: 2000, price: 150000, region: "영양읍", condition: "good", inspectedAt: "2026-11-01" };

test("사용자 말(글·음성)에서 운송 방식을 읽는다", () => {
  const cases = {
    "트럭으로 가져다 드릴 수 있어요, 운송비 3만 원": ["owner_delivery"],
    "배달해 드려요": ["owner_delivery"],
    "가지러 오셔야 해요": ["self_pickup"],
    "와서 가져가세요": ["self_pickup"],
    "창고에서 인수": ["self_pickup"],
    "둘 다 돼요": ["owner_delivery", "self_pickup"],
    "가져다 드릴 수도 있고 오셔도 돼요": ["owner_delivery", "self_pickup"],
    "협의 가능": ["owner_delivery", "self_pickup"],
  };
  for (const [text, methods] of Object.entries(cases)) assert.deepEqual(readDeliveryFromText(text).methods, methods, text);
  assert.deepEqual(readDeliveryFromText("아니 운송은 빼 줘").drop, ["owner_delivery"]);
  assert.deepEqual(readDeliveryFromText("픽업은 안 돼요").drop, ["self_pickup"]);
  for (const vague of ["알아서 해요", "상관없어요"]) {
    assert.equal(readDeliveryFromText(vague).methods, null, vague);
    assert.equal(hasDeliverySignal(vague), false, vague);
  }
});

test("기존 인수·전달 방법 글로 운송 방식을 추정하고, 한 줄로 보여 준다", () => {
  assert.deepEqual(inferDeliveryMethods("운반 협의"), ["owner_delivery"]);
  assert.deepEqual(inferDeliveryMethods("영양읍 창고 직접 인수"), ["self_pickup"]);
  assert.deepEqual(inferDeliveryMethods(""), ["self_pickup"]);
  assert.deepEqual(cleanDeliveryMethods(["self_pickup", "x", "owner_delivery"]), ["owner_delivery", "self_pickup"]);
  assert.equal(
    deliveryLine({ methods: ["owner_delivery", "self_pickup"], fee: 30000, area: "영양군 안", pickupPlace: "영양읍 창고" }, { type: "sale" }),
    "직접 운송 가능(운송비 30,000원, 영양군 안) · 구매자 직접 픽업(영양읍 창고)",
  );
  assert.equal(deliveryLine({ methods: ["owner_delivery"], fee: null }), "직접 운송 가능(운송비 협의)");
  assert.equal(pickupLabel("sale"), "구매자가 직접 픽업");
  assert.equal(pickupLabel("rent"), "대여자가 직접 픽업");
  assert.deepEqual(deliveryOf({ pickup: "운반 협의" }).methods, ["owner_delivery"]);
});

test("매물 저장 검증: 하나 이상 필수, 직접 운송이 없으면 운송비·범위는 저장하지 않는다", () => {
  const both = normalizeListingFields({ ...BASE, delivery: { methods: ["self_pickup", "owner_delivery"], fee: 30000, area: "영양군 안", pickupPlace: "영양읍 창고" } });
  assert.deepEqual(both.delivery, { methods: ["owner_delivery", "self_pickup"], fee: 30000, area: "영양군 안" });
  assert.equal(both.pickup, "영양읍 창고");
  const pickupOnly = normalizeListingFields({ ...BASE, delivery: { methods: ["self_pickup"], fee: 30000, area: "영양군 안" } });
  assert.deepEqual(pickupOnly.delivery, { methods: ["self_pickup"], fee: null, area: "" });
  assert.throws(() => normalizeListingFields({ ...BASE, delivery: { methods: [] } }), (e) => e.status === 400 && /하나 이상/.test(e.message));
  assert.throws(() => normalizeListingFields({ ...BASE, delivery: { methods: ["teleport"] } }), (e) => e.status === 400);
  // 예전 화면처럼 delivery 없이 pickup 글만 보내면 글로 추정한다.
  assert.deepEqual(normalizeListingFields({ ...BASE, pickup: "운반 협의" }).delivery.methods, ["owner_delivery"]);
});

test("조회 응답: 저장된 운송 방식, 마이그레이션 전(컬럼 없음)에는 pickup 글로 추정", () => {
  const row = { id: "a", owner_id: "o", type: "rent", title: "t", brand: "b", machine_type: "tractor", crop_ids: [], operations: [], area_min: 1, area_max: 2, price: 1, region: "영양읍", condition: "good", inspected_at: "2026-11-01", pickup: "영양읍 창고", created_at: "x", updated_at: "x", status: "open" };
  assert.deepEqual(toListingDto({ ...row, delivery_methods: ["owner_delivery", "self_pickup"], delivery_fee: 30000, delivery_area: "영양군 안" }).delivery, { methods: ["owner_delivery", "self_pickup"], fee: 30000, area: "영양군 안", pickupPlace: "영양읍 창고" });
  assert.deepEqual(toListingDto({ ...row, pickup: "운반 협의" }).delivery.methods, ["owner_delivery"]);
});

test("농농 초안: 사용자가 말하지 않은 운송 방식은 모델이 넣어도 비우고, 말했으면 체크한다", () => {
  assert.deepEqual(resolveDelivery({ methods: ["owner_delivery"], fee: 30000 }, { saidText: "트랙터 팔래요" }).methods, []);
  const said = resolveDelivery({ methods: [], fee: 30000 }, { saidText: "트랙터 팔래요. 트럭으로 가져다 드릴 수 있어요, 운송비 3만 원" });
  assert.deepEqual(said.methods, ["owner_delivery"]);
  assert.equal(said.fee, 30000);
  // 운송비를 말하지 않았으면 모델이 지어낸 운송비는 버린다.
  assert.equal(resolveDelivery({ methods: ["owner_delivery"], fee: 50000 }, { saidText: "가져다 드려요" }).fee, null);
  // 가장 최근 말의 "운송은 빼 줘"만 반영한다.
  const history = "둘 다 돼요\n아니 운송은 빼 줘";
  assert.deepEqual(resolveDelivery({ methods: ["owner_delivery", "self_pickup"] }, { saidText: history, latestText: "아니 운송은 빼 줘" }).methods, ["self_pickup"]);
  // 픽업 장소의 전화번호·상세 주소는 지운다.
  assert.equal(resolveDelivery({ methods: ["self_pickup"], pickupPlace: "영양읍 서부리 123번지" }, { saidText: "가지러 오세요" }).pickupPlace, "");
  // 화면 카드에서 고른 값(saidText 없음)은 그대로 쓴다.
  assert.deepEqual(resolveDelivery({ methods: ["self_pickup"], pickupPlace: "영양읍 창고" }).methods, ["self_pickup"]);
});

test("농농 대화: '가져다 드릴 수 있어요, 운송비 3만 원' → 초안에 직접 운송·운송비가 채워진다", async (t) => {
  withKey(t);
  const { call } = scripted([
    { content: [{ type: "tool_use", id: "d1", name: "prepare_listing_draft", input: { type: "rent", title: "대동 트랙터 빌려드려요", description: "트랙터 대여", machineType: "tractor", price: 150000, delivery: { methods: ["owner_delivery"], fee: 30000, area: "영양군 안" } } }] },
    { content: [{ type: "text", text: "초안을 만들었어요." }] },
  ]);
  const result = await runAgentTurn("트랙터 빌려줄게요. 2019년식, 500시간, 로터리 없어요. 트럭으로 가져다 드릴 수 있어요, 운송비 3만 원. 대행운용은 안 할게요", {}, { listings: LISTINGS, call, today: TODAY });
  assert.deepEqual(result.listingDraft.delivery.methods, ["owner_delivery"]);
  assert.equal(result.listingDraft.delivery.fee, 30000);
});

test("농농 대화: 운송 방식 없이 바로 등록하려 하면 막고 운송 방식을 묻게 한다", async (t) => {
  withKey(t);
  const { call, calls } = scripted([
    { content: [{ type: "tool_use", id: "l1", name: "create_listing", input: { type: "rent", machineType: "tractor", title: "트랙터 빌려드려요", price: 80000 } }] },
    { content: [{ type: "text", text: "가져다주실 수 있나요, 아니면 가지러 와야 하나요?" }] },
  ]);
  const created = [];
  const result = await runAgentTurn("네 올려 주세요", { user: { id: "u1" }, history: [{ role: "user", content: "대행운용은 안 할게요" }] }, {
    listings: LISTINGS, call, today: TODAY,
    deps: { createListing: async (u, payload) => { created.push(payload); return { listing: { id: payload.id } }; } },
  });
  assert.equal(created.length, 0);
  assert.equal(result.createdListing, undefined);
  assert.match(JSON.parse(calls[1].messages.at(-1).content[0].content).error, /운송 방식을 정해야/);
});

test("초안 카드의 '바로 등록': 운송 방식이 없으면 실패, 있으면 그 값으로 등록한다", async () => {
  const sent = [];
  const createListing = async (u, payload) => { sent.push(payload); return { listing: { id: payload.id, title: payload.title } }; };
  const action = { type: "create_listing", listingType: "rent", machineType: "tractor", title: "트랙터", price: 80000, region: "영양읍" };
  const none = await executeListingAction({ id: "u1" }, { ...action, delivery: { methods: [] } }, { requestId: "11111111-1111-4111-8111-111111111111", createListing });
  assert.equal(none.outcome, "failed");
  assert.equal(none.code, "DELIVERY_REQUIRED");
  const ok = await executeListingAction({ id: "u1" }, { ...action, delivery: { methods: ["self_pickup"], pickupPlace: "영양읍 창고" } }, { requestId: "22222222-2222-4222-8222-222222222222", createListing });
  assert.equal(ok.outcome, "completed");
  assert.deepEqual(sent[0].delivery.methods, ["self_pickup"]);
  assert.equal(sent[0].pickup, "영양읍 창고");
});

test("검색: '가져다주는 매물'만 찾으면 직접 운송 매물만, 운송 방식을 결과에 담는다", () => {
  const delivered = searchListingsTool({ machineType: "tractor", transaction: "rent", delivery: "owner_delivery" }, LISTINGS, {});
  assert.ok(delivered.results.length > 0);
  for (const item of delivered.results) assert.match(item.delivery, /직접 운송 가능/);
  const pickup = searchListingsTool({ machineType: "tractor", transaction: "rent", delivery: "self_pickup" }, LISTINGS, {});
  for (const item of pickup.results) assert.match(item.delivery, /직접 픽업/);
});

test("음성 정정: '아니 가지러 오셔야 해'는 운송 조건을 가진 작업을 바로잡는다", () => {
  assert.ok(extractTaskSlots("아니 가지러 오셔야 해").cats.has("delivery"));
  assert.ok(extractTaskSlots("트랙터 팔래요, 가져다 드릴게요").cats.has("delivery"));
  assert.equal(extractTaskSlots("내일 트랙터 빌릴래").cats.has("delivery"), false);
});
