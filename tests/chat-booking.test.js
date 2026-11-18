// 채팅만으로 예약: 대여 날짜 우선 추천 · 직전 매물 기억 · 반복 추천 방지
import assert from "node:assert/strict";
import { test } from "node:test";

import { gateSearchInput, refersToShownListing, runAgentTurn, wantsNewSearch } from "../server/nongnong-agent.js";
import { isAffirmative } from "../server/nongnong.js";
import { buildMockListings } from "../server/listing-seed.js";

const LISTINGS = buildMockListings();
const TODAY = "2026-11-16";
const rentable = LISTINGS.find((item) => item.type === "rent" && item.status === "open" && item.condition !== "repair" && !item.booked.length);
const saleItem = LISTINGS.find((item) => item.type === "sale" && item.status === "open");
const forSale = LISTINGS.find((item) => item.type === "sale");

const AI_ENV = ["AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"];

function withEnv(t, values) {
  const previous = Object.fromEntries(AI_ENV.map((name) => [name, process.env[name]]));
  for (const name of AI_ENV) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function withKey(t, value) {
  withEnv(t, { ANTHROPIC_API_KEY: value });
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

// ───────── 채팅만으로 예약: 날짜 우선 추천 · 직전 매물 · 반복 추천 방지 ─────────
import { isAffirmative as sharedAffirmative } from "../src/ai/affirm.js";

const rentListings = LISTINGS.filter((item) => item.type === "rent" && item.status === "open" && item.condition !== "repair");

test("[날짜 우선] 대여 요청에 날짜가 없으면 검색하지 않고 날짜 질문과 날짜 선택지를 돌려준다", async (t) => {
  withKey(t, "test");
  const { call, calls } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "search_listings", input: { machineType: "tractor", transaction: "rent" } }] },
    { content: [{ type: "text", text: "트랙터를 찾아 드릴게요. 언제부터 며칠 빌리실 건가요?" }] },
  ]);
  const result = await runAgentTurn("트랙터 빌리고 싶어", {}, { listings: LISTINGS, call, today: TODAY });
  const toolResult = JSON.parse(calls[1].messages.at(-1).content[0].content);
  assert.equal(toolResult.needDate, true);
  assert.deepEqual(result.listingIds, []);
  assert.equal(result.askDate, true);
});

test("[날짜 우선] 모델이 날짜를 지어내도 사용자가 날짜를 말하지 않았으면 검색하지 않는다", async (t) => {
  withKey(t, "test");
  const { call, calls } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "search_listings", input: { machineType: "tractor", transaction: "rent", start: "2026-11-20", end: "2026-11-20" } }] },
    { content: [{ type: "text", text: "언제 빌리실 건가요?" }] },
  ]);
  const result = await runAgentTurn("트랙터 빌리고 싶어", {}, { listings: LISTINGS, call, today: TODAY });
  assert.equal(JSON.parse(calls[1].messages.at(-1).content[0].content).needDate, true);
  assert.deepEqual(result.listingIds, []);
});

test("[날짜 우선] 날짜를 말하면 모델이 날짜를 빠뜨려도 서버가 그 기간으로 검색해 예약된 매물을 뺀다", async (t) => {
  withKey(t, "test");
  const booked = { ...rentListings[0], id: "booked-tractor", booked: [{ start: "2026-11-20", end: "2026-11-21" }] };
  const free = { ...rentListings[0], id: "free-tractor", booked: [] };
  const { call, calls } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "search_listings", input: { machineType: rentListings[0].machineType, transaction: "rent" } }] },
    { content: [{ type: "text", text: "그 기간에 빌릴 수 있는 매물이에요." }] },
  ]);
  const result = await runAgentTurn("11월 20일부터 21일까지 빌리고 싶어", {}, { listings: [booked, free], call, today: TODAY });
  const toolResult = JSON.parse(calls[1].messages.at(-1).content[0].content);
  assert.equal(toolResult.start, "2026-11-20");
  assert.equal(toolResult.end, "2026-11-21");
  assert.ok(result.listingIds.includes("free-tractor"));
  assert.ok(!result.listingIds.includes("booked-tractor"));
  assert.deepEqual(result.searchDates, { start: "2026-11-20", end: "2026-11-21" });
});

test("[날짜 우선] 구매는 날짜 없이 바로 검색한다 (모델이 거래 유형을 빠뜨려도)", () => {
  const gate = gateSearchInput({ machineType: "tractor" }, { text: "트랙터 사고 싶어", today: TODAY, saleIntent: true });
  assert.equal(gate.block, undefined);
  assert.equal(gate.input.transaction, "sale");
});

test("[날짜 우선] '날짜는 상관없이 보여줘'는 날짜 없이 둘러볼 수 있다", () => {
  const gate = gateSearchInput({ machineType: "tractor", transaction: "rent" }, { text: "날짜는 상관없이 먼저 보여줘", today: TODAY, browseWithoutDate: true });
  assert.equal(gate.block, undefined);
});

test("[직전 매물] 직전 목록이 [직전에 보여준 매물] 블록으로 들어가고, '2번'은 다시 검색하지 않는다", async (t) => {
  withKey(t, "test");
  const ids = rentListings.slice(0, 3).map(({ id }) => id);
  const { call, calls } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "search_listings", input: { machineType: rentListings[0].machineType, transaction: "rent", start: "2026-11-20" } }] },
    { content: [{ type: "text", text: `2번 ${rentListings[1].title}으로 진행할게요.` }] },
  ]);
  const result = await runAgentTurn("2번", {
    history: [{ role: "user", content: "11월 20일에 빌리고 싶어" }, { role: "assistant", content: "3개 찾았어요." }],
    uiContext: { lastShownListings: ids.map((id, i) => ({ no: i + 1, id })) },
  }, { listings: LISTINGS, call, today: TODAY });
  assert.match(calls[0].system, /\[직전에 보여준 매물\]/);
  assert.match(calls[0].system, new RegExp(`2번 id=${ids[1]}`));
  assert.equal(JSON.parse(calls[1].messages.at(-1).content[0].content).useShownListings, true);
  assert.deepEqual(result.listingIds, []);
});

test("[직전 매물] 가짜 id는 [직전에 보여준 매물]에 들어가지 않는다", async (t) => {
  withKey(t, "test");
  const { call, calls } = scripted([{ content: [{ type: "text", text: "어떤 매물인가요?" }] }]);
  await runAgentTurn("1번", { uiContext: { lastShownListings: [{ id: "fake-id-123" }, { id: rentListings[0].id }] } }, { listings: LISTINGS, call, today: TODAY });
  assert.doesNotMatch(calls[0].system, /fake-id-123/);
  assert.match(calls[0].system, new RegExp(`1번 id=${rentListings[0].id}`));
});

test("[대기 중인 확인] 떠 있는 확인 카드가 프롬프트에 들어가고, 채팅 '네'로 그 매물·날짜 그대로 예약한다", async (t) => {
  withKey(t, "test");
  const target = rentable;
  const { call, calls } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "create_rental_request", input: { listingId: target.id, start: "2026-11-20", end: "2026-11-21" } }] },
    { content: [{ type: "text", text: "예약 요청을 보냈어요." }] },
  ]);
  const created = [];
  const deps = {
    createRentalRequest: async (user, req) => { created.push(req); return { request: { id: req.id, days: 2, totalPrice: target.price * 2 } }; },
  };
  const result = await runAgentTurn("네", {
    user: { id: "buyer-1" },
    uiContext: { pendingConfirmation: { type: "rental_request", listingId: target.id, start: "2026-11-20", end: "2026-11-21" } },
  }, { listings: LISTINGS, call, today: TODAY, deps });
  assert.match(calls[0].system, /\[대기 중인 확인\]/);
  assert.match(calls[0].system, new RegExp(`id=${target.id}`));
  assert.equal(created.length, 1);
  assert.equal(created[0].listingId, target.id);
  assert.equal(result.reservation.start, "2026-11-20");
});

test("[반복 추천 방지] 예약 진행 중에는 기종·'빌릴게요'가 있어도 서버 자동 추천을 붙이지 않는다", async (t) => {
  withKey(t, "test");
  const ids = rentListings.slice(0, 3).map(({ id }) => id);
  const { call } = scripted([{ content: [{ type: "text", text: "1번 매물로 11월 24일에 진행할까요?" }] }]);
  const result = await runAgentTurn("그 트랙터 11월 24일에 빌릴게요", {
    uiContext: { lastShownListings: ids.map((id) => ({ id })) },
  }, { listings: LISTINGS, call, today: TODAY });
  assert.deepEqual(result.listingIds, []);
});

test("[반복 추천 방지] '다른 거 보여줘'는 다시 찾을 수 있다", () => {
  assert.equal(wantsNewSearch("다른 거 보여줘"), true);
  assert.equal(wantsNewSearch("2번"), false);
  assert.equal(refersToShownListing("2번"), true);
  assert.equal(refersToShownListing("아까 그 트랙터"), true);
  assert.equal(refersToShownListing("트랙터 빌리고 싶어"), false);
  const gate = gateSearchInput({ machineType: "tractor", transaction: "rent", start: "2026-11-20" }, {
    text: "2번 말고 다른 거 보여줘", today: TODAY, userDateSignal: true, hasShownListings: true,
  });
  assert.equal(gate.block, undefined);
});

test("[긍정 판정] 번호만 말하면 승인이 아니고, 실행 동사가 있으면 승인이다 (화면·서버 같은 규칙)", () => {
  for (const no of ["2번", "2번이요", "2번으로", "1번 좋아요"]) assert.equal(sharedAffirmative(no), false, no);
  for (const yes of ["2번으로 예약해줘", "1번으로 해 주세요", "2번 진행", "네", "예약해 줘"]) assert.equal(sharedAffirmative(yes), true, yes);
  assert.equal(isAffirmative, sharedAffirmative);
});

test("[긍정 판정] '승인할게'처럼 '예약해줘'가 아닌 다양한 긍정 표현도 승인으로 본다", () => {
  const yes = ["승인할게", "승인할게요", "승인합니다", "승인해 주세요", "네 승인할게요", "확정할게", "요청 보내줘", "보내 주세요", "응 보내",
    "좋네", "알겠어요", "알았어", "당연하죠", "물론이죠", "그렇게 하자", "이대로 해줘", "그대로 진행", "ㄱㄱ", "고고", "예스", "yes",
    "동의합니다", "부탁할게요", "예약할게", "넵넵", "그래그래"];
  for (const text of yes) assert.equal(sharedAffirmative(text), true, text);
});

test("[긍정 판정] 부정·보류·질문이 섞이면 승인으로 보지 않는다", () => {
  const no = ["승인 안 할게", "보내지 마", "안 보내", "나중에 할게", "아직 승인 안 했어", "승인할까?", "승인할까", "괜찮아요",
    "좋아 근데 다른 날로", "네 근데 3일로 바꿔줘", "그대로 두고 날짜만 바꿔줘", "보내기 전에 날짜 확인해줘", "확인", "2번"];
  for (const text of no) assert.equal(sharedAffirmative(text), false, text);
});
