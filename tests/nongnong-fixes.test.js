// 농농 AI 상담 개선(문제 1~8) 회귀 테스트. 문제 1은 tests/voice-client.test.js에 있다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyKnownFactsToSearch, collectKnownFacts, runAgentTurn, searchListingsTool, shouldShowCards, settleReply, summarizeKnownFacts, tidyReply } from "../server/nongnong-agent.js";
import { runConfirmedAction } from "../api/agent.js";
import { isAffirmative } from "../server/nongnong.js";
import { buildMockListings } from "../server/listing-seed.js";
import { buildGptLiveInstructions } from "../server/gpt-live.js";
import { isUnclearUtterance, joinSpokenText, tidySpokenText } from "../src/ai/spoken-text.js";

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

// ───────── 문제 4 ─────────

const USER = { id: "11111111-1111-4111-8111-111111111111", name: "농부" };
const SALE = LISTINGS.find((item) => item.type === "sale" && item.status === "open" && item.condition !== "repair");

test("문제4: 실제 사례의 실행 요청(사투리 포함)은 한 번에 승인으로 본다", () => {
  for (const yes of ["네", "응 해줘", "확인은 했는데 내가 지금 손을 못 써서 너가 바로 구매해줘", "구매해줘", "바로 사 줘",
    "대여 예약해 주이소", "판매글 올려줘", "하모", "그려유", "야", "그라제", "네 살게예", "빌릴게유"]) {
    assert.equal(isAffirmative(yes), true, yes);
  }
  for (const no of ["구매할까 고민중이야", "구매는 안 돼", "구매해줘?", "검사해줘", "빌려주고 싶어", "다른 거요"]) {
    assert.equal(isAffirmative(no), false, no);
  }
});

test("문제4: 음성으로 '너가 바로 구매해줘'라고 하면 확인 카드 없이 같은 턴에서 구매 신청을 끝낸다", async (t) => {
  withKey(t);
  const sent = [];
  const deps = { beforeWrite: async () => {}, sendPurchaseMessage: async (_u, payload) => { sent.push(payload); return { conversation: { id: "c1" } }; } };
  const { call, calls } = scripted([
    toolUse("create_purchase_request", { listingId: SALE.id }),
    textReply("청기면 매물 구매 신청을 완료했어요."),
  ]);
  const result = await runAgentTurn("확인은 했는데 내가 지금 손을 못 써서 너가 바로 구매해줘", { user: USER, inputMode: "voice" }, { listings: LISTINGS, call, today: TODAY, deps });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].listingId, SALE.id);
  assert.equal(result.reservation.kind, "purchase");
  assert.match(result.reservation.number, /^P-/);
  assert.equal(result.pendingAction, undefined);
  assert.doesNotMatch(calls[0].system, /버튼을 눌러야 처리된다/);
  assert.match(calls[0].system, /확인은 최대 한 번만/);
  assert.match(calls[0].system, /화면 버튼을 직접 누르라고 하지 않는다/);
});

test("문제4: 답변·음성 전사의 띄어 쓴 기종명과 앞 쉼표를 정리한다", () => {
  assert.equal(tidyReply("청기면 D R G H-1400은 320만원이에요."), "청기면 DRGH-1400은 320만원이에요.");
  assert.equal(tidyReply(", 네 알겠어요"), "네 알겠어요");
  assert.equal(tidySpokenText("두루기계통상 D R G H-1400이요.네, 맞아요"), "두루기계통상 DRGH-1400이요. 네, 맞아요");
});

test("문제4: 실시간 음성 지시문은 분명한 요청을 바로 실행하고 버튼을 누르라고 하지 않게 한다", () => {
  const text = buildGptLiveInstructions({ region: "청기면" });
  assert.match(text, /Transaction policy:/);
  assert.match(text, /확인 없이 바로 <\|SpawnThinking\|>로 실행/);
  assert.doesNotMatch(text, /음성만으로 무단 실행 금지/);
  assert.match(text, /DRGH-1400/);
});

// ───────── 문제 5 ─────────

test("문제5: 직전에 보여 준 매물 카드(ID·순서)를 다음 턴 프롬프트에 넣어 '청기면 매물/첫 번째'로 바로 실행할 수 있다", async (t) => {
  withKey(t);
  const shown = LISTINGS.filter((item) => item.type === "sale" && item.cropIds.includes("sweetPotato")).slice(0, 3);
  const target = shown.find((item) => item.region === "청기면") || shown[0];
  const sent = [];
  const deps = { beforeWrite: async () => {}, sendPurchaseMessage: async (_u, payload) => { sent.push(payload); return { conversation: { id: "c1" } }; } };
  const { call, calls } = scripted([
    toolUse("create_purchase_request", { listingId: target.id }),
    textReply("구매 신청을 마쳤어요."),
  ]);
  const result = await runAgentTurn("청기면 매물로 구매해줘", {
    user: USER,
    inputMode: "voice",
    history: BUY_HISTORY,
    uiContext: { shownListingIds: shown.map(({ id }) => id) },
  }, { listings: LISTINGS, call, today: TODAY, deps });
  assert.match(calls[0].system, /최근 보여 준 매물/);
  for (const [i, item] of shown.entries()) assert.match(calls[0].system, new RegExp(`${i + 1}번: id=${item.id}`));
  assert.equal(sent[0].listingId, target.id);
  // 모델이 번호를 빠뜨려도 신청 번호를 답변에 붙인다.
  assert.match(result.reply, /^구매 신청을 마쳤어요\. 신청 번호는 P-[0-9A-F]{8}예요\.$/);
});

test("문제5: 쓰기 도구가 실패했는데 '잠시만 기다려 주세요'로 끝내면 이유와 다음 방법으로 바꾼다", () => {
  const reply = settleReply("죄송합니다. 매물 정보를 찾는 데 어려움이 있어 다시 한 번 매물 정보를 확인해 보겠습니다. 잠시만 기다려 주세요.", {
    out: {},
    toolCalls: [{ tool: "create_purchase_request", ok: false, result: { ok: false, error: "매물을 찾을 수 없습니다." } }],
  });
  assert.equal(reply, "구매 신청을 하지 못했어요. 이유: 매물을 찾을 수 없습니다. 다른 매물을 찾아 드리거나 조건을 바꿔 다시 해 드릴까요?");
});

test("문제5: 아무것도 실행하지 않고 '잠시 후 진행할게요'라고만 하면 그 약속 문장을 지운다", () => {
  assert.equal(
    settleReply("가격은 320만원, 청기면 매물로 맞는지 안내드렸어요. 잠시 후에 구매 요청 진행할게요.", { out: {}, toolCalls: [] }),
    "가격은 320만원, 청기면 매물로 맞는지 안내드렸어요.",
  );
  assert.equal(settleReply("잠시만 기다려 주세요.", { out: {}, toolCalls: [] }), "어떤 매물로 진행할지 한 번만 말씀해 주시면 바로 처리해 드릴게요.");
  assert.equal(settleReply("청기면 매물은 320만원이에요.", { out: {}, toolCalls: [] }), null);
});

test("문제5: 확인 대기 작업 실행 중 연결 오류가 나면 무한 대기 대신 다시 시도할 수 있게 작업을 돌려준다", async () => {
  const pending = { type: "purchase_request", listingId: "s2", title: "두루기계통상 DRB-1200PC · 청기면" };
  let attempts = 0;
  const run = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("socket hang up");
    return { outcome: "completed", reservation: { kind: "purchase", number: "P-ABCDEF12", listingId: "s2" } };
  };
  const first = await runConfirmedAction({ message: "네", pending, user: USER, requestId: "r1", run });
  assert.match(first.reply, /구매 신청을 하지 못했어요\. 이유: 서버 연결이 잠시 불안정했어요\. "다시 해줘"라고 말씀하시면 바로 다시 시도할게요\./);
  assert.deepEqual(first.pendingAction, pending);
  const second = await runConfirmedAction({ message: "다시 해줘", pending: first.pendingAction, user: USER, requestId: "r1", run });
  assert.equal(second.reply, "두루기계통상 DRB-1200PC 청기면 구매 신청을 완료했어요. 신청 번호는 P-ABCDEF12예요.");
  assert.equal(await runConfirmedAction({ message: "고민해볼게", pending, user: USER, requestId: "r1", run }), null);
  assert.equal(await runConfirmedAction({ message: "네", pending, user: null, requestId: "r1", run }), null);
});
