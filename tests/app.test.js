import test from "node:test";
import assert from "node:assert/strict";
import { CROP_OPERATIONS, MACHINE_TYPES } from "../src/data/farm-machines.js";
import { listListings } from "../server/listings-db.js";
import { recommend, selectCandidates } from "../server/agent.js";
import { selectMatchingListings } from "../src/data/recommendation.js";
import { conversationTurn } from "../src/ai/conversation.js";

const LISTINGS = listListings();

test("인사와 기능 질문은 작물 입력을 강요하지 않는다", () => {
  const greeting = conversationTurn("안녕", {});
  assert.match(greeting.reply, /안녕하세요/);
  assert.equal(greeting.question, undefined);
  const help = conversationTurn("뭐해", {}, greeting);
  assert.match(help.reply, /장비를 고르는/);
  assert.equal(help.question, undefined);
});

test("상담 중 다른 질문에 답한 후에도 기존 조건과 질문이 유지된다", () => {
  const initial = conversationTurn("고추 두둑 장비 대여", {});
  assert.equal(initial.field, "area");
  const interrupted = conversationTurn("왜 물어봐?", {}, initial);
  assert.match(interrupted.reply, /권장 면적/);
  assert.equal(interrupted.field, "area");
  assert.equal(interrupted.question, initial.question);
  const resumed = conversationTurn("300", {}, interrupted);
  assert.equal(resumed.field, "date");
  assert.equal(resumed.context.areaPyeong, 300);
  assert.deepEqual(resumed.context.cropIds, ["pepper"]);
});

test("상담이 필요한 조건을 한 번에 하나씩 묻고 짧은 답을 누적한다", () => {
  const filters = { transaction: "rent" };
  let turn;
  for (const [message, expected] of [
    ["농기계 좀 찾아줘", "crop"], ["고추", "operation"], ["두둑", "transaction"],
    ["대여", "area"], ["300", "date"], ["2026-11-20 ~ 2026-11-22", "budget"], ["7만원", undefined],
  ]) {
    turn = conversationTurn(message, filters, turn);
    assert.equal(turn.field, expected);
  }
  const selection = selectMatchingListings(turn.message, turn.context, LISTINGS);
  assert.equal(selection.cropId, "pepper");
  assert.deepEqual(selection.operations, ["ridge"]);
  assert.equal(selection.areaPyeong, 300);
  assert.equal(selection.maxPrice, 70000);
  assert.equal(selection.dateEnd, "2026-11-22");
  assert.ok(selection.candidates.length);
});

test("작업을 먼저 입력해도 유지하며 선택 조건은 건너뛸 수 있다", () => {
  const filters = {};
  const first = conversationTurn("두둑 만들 장비를 빌려요", filters);
  assert.equal(first.field, "crop");
  const second = conversationTurn("고추", filters, first);
  assert.equal(second.field, "area");
  const third = conversationTurn("바로 추천", filters, second);
  assert.deepEqual(third.context.operations, ["ridge"]);
  assert.equal(third.question, null);
});

test("목 DB는 현재 카탈로그의 모든 기종과 두 거래 방식을 포함한다", () => {
  assert.equal(LISTINGS.length, 100);
  assert.equal(new Set(LISTINGS.map(({ id }) => id)).size, 100);
  assert.deepEqual(new Set(LISTINGS.map(({ machineType }) => machineType)), new Set(MACHINE_TYPES.map(({ id }) => id)));
  for (const { id } of MACHINE_TYPES) {
    assert.equal(LISTINGS.filter((item) => item.machineType === id && item.type === "rent").length, 6);
    assert.equal(LISTINGS.filter((item) => item.machineType === id && item.type === "sale").length, 4);
  }
  assert.ok(LISTINGS.every((item) => item.cropIds.every((crop) => item.operations.every((op) => CROP_OPERATIONS[crop]?.includes(op)))));
});

test("작물·작업·거래 방식·예산으로 실제 후보를 좁힌다", () => {
  const result = selectCandidates("고추 두둑 대여", { maxPrice: 70000 });
  assert.equal(result.cropId, "pepper");
  assert.equal(result.operationId, "ridge");
  assert.equal(result.transaction, "rent");
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every((item) => item.cropIds.includes("pepper") && item.operations.includes("ridge") && item.type === "rent" && item.price <= 70000));
});

test("면적과 예약일을 반영한다", () => {
  const first = LISTINGS.find((item) => item.type === "rent" && item.booked.length);
  assert.ok(first);
  const day = first.booked[0].start;
  const message = `${first.cropIds[0] === "pepper" ? "고추" : first.cropIds[0] === "rice" ? "벼" : first.cropIds[0] === "cabbage" ? "배추" : "감자"} 대여`;
  const result = selectCandidates(message, { date: day });
  assert.ok(!result.candidates.some((item) => item.id === first.id));
});

test("질문의 면적과 구매 예산도 해석한다", () => {
  const result = selectCandidates("고추밭 300평 두둑 기계를 구매하고 싶어요. 예산 80만원", {});
  assert.equal(result.transaction, "sale");
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every((item) => item.price <= 800000 && item.areaMin <= 300 * 3.305785 && item.areaMax >= 300 * 3.305785));
});

test("시작일이 비어 있어도 반납일까지 예약이 겹치면 제외한다", () => {
  const item = LISTINGS.find(({ id }) => id === "r1");
  const context = { date: "2026-11-08", dateEnd: "2026-11-09" };
  assert.equal(selectMatchingListings("고추 두둑 대여", context, [item]).candidates.length, 0);
  assert.equal(selectMatchingListings("고추 두둑 대여", { ...context, dateEnd: context.date }, [item]).candidates.length, 1);
});

test("겸용 장비 요청은 모든 작업과 예산을 충족하며 등록 순서와 무관하다", () => {
  const question = "고추 두둑과 비닐 작업, 대여료 7만원 이하";
  const context = { sort: "price" };
  const { candidates } = selectMatchingListings(question, context, LISTINGS);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((item) => item.operations.includes("ridge") && item.operations.includes("mulch") && item.price <= 70000));
  assert.deepEqual(selectMatchingListings(question, context, [...LISTINGS].reverse()).candidates, candidates);
});

test("서버 추천은 브라우저에서 제외한 매물을 다시 추가하지 않는다", () => {
  const question = "고추 흙갈이 대여";
  const { candidates } = selectCandidates(question);
  assert.ok(candidates.length > 1);
  const candidateIds = candidates.slice(1).map(({ id }) => id);
  assert.deepEqual(selectCandidates(question, { candidateIds }).candidates.map(({ id }) => id), candidateIds);
  assert.deepEqual(selectCandidates(question, { candidateIds: [] }).candidates, []);
});

test("API 키가 없어도 안내 응답과 유효한 매물 ID를 반환한다", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await recommend("고추 두둑 대여", { maxPrice: 70000 });
    assert.equal(result.mode, "guide");
    assert.ok(result.reply.includes("고추"));
    assert.ok(result.listingIds.length > 0);
    assert.ok(result.listingIds.every((id) => LISTINGS.some((item) => item.id === id)));
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("예산 범위 표현과 '만' 단위 축약 응답을 올바르게 해석한다", () => {
  const rangeResult = selectMatchingListings("고추 두둑 대여 5만원~7만원", {}, LISTINGS);
  assert.equal(rangeResult.maxPrice, 70000);

  let turn = conversationTurn("고추 두둑 장비 대여", {});
  turn = conversationTurn("300", {}, turn);
  turn = conversationTurn("건너뛰기", {}, turn);
  assert.equal(turn.field, "budget");
  turn = conversationTurn("7만", {}, turn);
  assert.equal(turn.field, undefined);
  assert.equal(turn.context.maxPrice, 70000);
});

test("대화 초안(draft) 모드는 끼어들기 여부와 대기 질문에 맞춰 폴백 응답을 구성한다", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const simpleGreeting = await recommend("ㅎㅇ", {
      draft: "안녕하세요! 저는 농농이에요.",
      interruption: true,
    });
    assert.equal(simpleGreeting.mode, "guide");
    assert.equal(simpleGreeting.showChoices, false);
    assert.deepEqual(simpleGreeting.listingIds, []);

    const midFlowInterruption = await recommend("멀칭이 뭐야?", {
      draft: "멀칭은 흙 표면을 비닐 같은 재료로 덮는 작업이에요.",
      nextQuestion: "작업할 농지는 대략 몇 평인가요?",
      field: "area",
      interruption: true,
    });
    assert.equal(midFlowInterruption.mode, "guide");
    assert.equal(midFlowInterruption.showChoices, true);
    assert.match(midFlowInterruption.reply, /멀칭은 흙 표면을/);
    assert.match(midFlowInterruption.reply, /작업할 농지는 대략 몇 평인가요\?/);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
