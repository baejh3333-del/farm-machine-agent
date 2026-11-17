// 농농 AI 상담 개선(문제 1~8) 회귀 테스트. 문제 1은 tests/voice-client.test.js에 있다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyKnownFactsToSearch, collectKnownFacts, runAgentTurn, searchListingsTool, shouldShowCards, summarizeKnownFacts } from "../server/nongnong-agent.js";
import { buildMockListings } from "../server/listing-seed.js";
import { buildGptLiveInstructions } from "../server/gpt-live.js";
import { isUnclearUtterance, joinSpokenText } from "../src/ai/spoken-text.js";

const LISTINGS = buildMockListings();
const TODAY = "2026-11-16";

function withKey(t) {
  const prev = { AI_PROVIDER: process.env.AI_PROVIDER, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
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

const textReply = (text) => ({ content: [{ type: "text", text }] });
const toolUse = (name, input, id = `tu_${name}`) => ({ content: [{ type: "tool_use", id, name, input }] });

// ───────── 문제 2 ─────────

test("문제2: 중간 안내와 본 답변이 붙은 전사를 문장 사이 띄어쓰기로 정리하고 앞 쉼표를 지운다", () => {
  let text = "";
  for (const delta of [", 모아농 매물과 정보를 확인해볼게요.", "네, 어떤 농기계를 찾으세요?"]) text = joinSpokenText(text, delta);
  assert.equal(text, "모아농 매물과 정보를 확인해볼게요. 네, 어떤 농기계를 찾으세요?");
});

test("문제2: 알아들을 수 없는 음성 인식 결과는 다시 묻는 대상으로 본다", () => {
  for (const bad of ["", "  ", "...", "음", "으음", "♪♪"]) assert.equal(isUnclearUtterance(bad), true, bad);
  for (const ok of ["구매하려고 해", "네", "응", "어", "고구마", "320만원"]) assert.equal(isUnclearUtterance(ok), false, ok);
});

test("문제2: 이미 받은 목적·작물·지역은 [이미 받은 정보]로 넘기고 직전 질문 반복을 막는다", () => {
  const out = summarizeKnownFacts({
    history: [
      { role: "user", content: "구매하려고 해" },
      { role: "assistant", content: "아, 구매 쪽이시군요. 어떤 농기계를 구매하고 싶으신가요?" },
    ],
    text: "고구마를 심고 싶어, 청기면이야",
  });
  assert.match(out, /\[이미 받은 정보 — 다시 묻지 말 것\]/);
  assert.match(out, /목적: 구매/);
  assert.match(out, /작물: 고구마\(sweetPotato\)/);
  assert.match(out, /지역: 청기면/);
  assert.match(out, /\[직전 농농 질문 — 같은 질문 반복 금지\]\n어떤 농기계를 구매하고 싶으신가요\?/);
});

test("문제2: 에이전트 시스템 프롬프트에 대화 원칙과 이미 받은 정보가 들어가고, 음성은 출력 토큰을 줄인다", async (t) => {
  withKey(t);
  const { call, calls } = scripted([textReply("고구마 심을 때는 두둑·멀칭 작업이 필요해요.")]);
  await runAgentTurn("고구마를 심고 싶어", {
    history: [{ role: "user", content: "구매하려고 해" }, { role: "assistant", content: "어떤 농기계를 구매하고 싶으신가요?" }],
    inputMode: "voice",
  }, { listings: LISTINGS, call, today: TODAY });
  const { system, maxTokens } = calls[0];
  assert.match(system, /## 대화 원칙/);
  assert.match(system, /"잠시만요"·"확인해볼게요" 같은 중간 안내 문구를 붙이지 않는다/);
  assert.match(system, /목적: 구매/);
  assert.match(system, /작물: 고구마/);
  assert.match(system, /어떤 농기계를 구매하고 싶으신가요\?/);
  assert.equal(maxTokens, 600);
});

test("문제2: 실시간 음성 지시문은 중간 안내·반복 질문을 금지하고 못 알아들으면 다시 묻게 한다", () => {
  const text = buildGptLiveInstructions({ region: "영양읍" });
  assert.match(text, /Response style policy:/);
  assert.match(text, /중간 안내는 하지 않는다/);
  assert.match(text, /같은 질문이나 같은 문장을 반복하지 않는다/);
  assert.match(text, /잘 못 들었어요/);
});

// ───────── 문제 3 ─────────

const BUY_HISTORY = [
  { role: "user", content: "구매하려고 해" },
  { role: "assistant", content: "어떤 작물에 쓰실 건가요?" },
  { role: "user", content: "고구마 캐는 기계" },
];

test("문제3: 대화에서 '구매'라고 했으면 모델이 대여로 검색해도 구매 매물만 찾는다", () => {
  const known = collectKnownFacts({ history: BUY_HISTORY, text: "가까운 걸로 보여줘", uiCtx: { transaction: "rent" } });
  const input = applyKnownFactsToSearch({ cropId: null, operations: [], machineType: "rootHarvester", transaction: "rent" }, { ...known, text: "가까운 걸로 보여줘" });
  assert.equal(input.transaction, "sale");
  assert.equal(input.cropId, "sweetPotato");
  const result = searchListingsTool(input, LISTINGS, { region: "청기면" });
  assert.ok(result.count > 0);
  for (const item of result.results) {
    const original = LISTINGS.find(({ id }) => id === item.id);
    assert.equal(original.type, "sale");
    assert.equal(original.status, "open");
    assert.ok(original.cropIds.includes("sweetPotato"));
  }
});

test("문제3: 판매 완료·거래 중·수리 필요 매물은 추천 전에 걸러낸다", () => {
  const base = LISTINGS.filter((item) => item.type === "sale" && item.cropIds.includes("sweetPotato"));
  const blocked = base.map((item, i) => ({ ...item, status: ["dealing", "done", "open"][i % 3], condition: i % 3 === 2 ? "repair" : item.condition }));
  const result = searchListingsTool({ cropId: "sweetPotato", operations: [], transaction: "sale" }, blocked, { region: "청기면" });
  assert.equal(result.count, 0, JSON.stringify(result.results.map((r) => r.id)));
});

test("문제3: 같은 카드는 다시 추천·조건 변경이 아니면 또 띄우지 않는다", () => {
  const shown = ["a", "b", "c"];
  assert.equal(shouldShowCards(["a", "b", "c"], { shownListingIds: shown, text: "응" }), false);
  assert.equal(shouldShowCards(["a", "b"], { shownListingIds: shown, text: "가격이 얼마야" }), false);
  assert.equal(shouldShowCards(["a", "b", "c"], { shownListingIds: shown, text: "다른 거 추천해줘" }), true);
  assert.equal(shouldShowCards(["a", "b", "c"], { shownListingIds: shown, text: "청기면으로 바꿔줘" }), true);
  assert.equal(shouldShowCards(["a", "d"], { shownListingIds: shown, text: "응" }), true);
  assert.equal(shouldShowCards(["a"], { shownListingIds: [], text: "응" }), true);
});

test("문제3: 카드를 이미 보여 준 뒤 일반 답변 턴에서는 같은 매물 카드를 다시 보내지 않는다", async (t) => {
  withKey(t);
  const first = searchListingsTool({ cropId: "sweetPotato", operations: [], transaction: "sale" }, LISTINGS, { region: "청기면" });
  const shownIds = first.results.map(({ id }) => id);
  const { call } = scripted([
    toolUse("search_listings", { cropId: "sweetPotato", operations: [], transaction: "sale", region: null }),
    textReply("세 매물 모두 거래 가능해요."),
  ]);
  const result = await runAgentTurn("응 알겠어", {
    history: BUY_HISTORY,
    uiContext: { region: "청기면", transaction: "rent", shownListingIds: shownIds },
  }, { listings: LISTINGS, call, today: TODAY });
  assert.deepEqual(result.listingIds, []);
});

test("문제3: 카드를 보여 준 뒤에는 작물 이름만 나와도 자동 검색 카드를 또 붙이지 않는다", async (t) => {
  withKey(t);
  const { call } = scripted([textReply("고구마 수확기는 두둑 폭을 맞춰 보셔야 해요.")]);
  const result = await runAgentTurn("고구마 두둑 폭은 어떻게 해", {
    history: BUY_HISTORY,
    uiContext: { region: "청기면", shownListingIds: ["x1", "x2"] },
  }, { listings: LISTINGS, call, today: TODAY });
  assert.deepEqual(result.listingIds, []);
});
