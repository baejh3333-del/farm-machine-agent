import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSpokenSummary,
  classifyDispatchResult,
  createDispatchTimer,
  describeWriteOutcome,
  isWriteOutcome,
  pickServerTiming,
  stripDuplicateMachineList,
  uniqueListingIds,
} from "../src/ai/voice-dispatch.js";
import { createTurnTiming } from "../api/agent.js";
import { runAgentTurn } from "../server/nongnong-agent.js";
import { buildMockListings } from "../server/listing-seed.js";

test("uniqueListingIds keeps server order, drops duplicates/blank/non-string ids", () => {
  assert.deepEqual(uniqueListingIds(["b", "a", "b", " ", 3, null, " a ", "c"], 6), ["b", "a", "c"]);
  assert.deepEqual(uniqueListingIds(["a", "b", "c"], 2), ["a", "b"]);
  assert.deepEqual(uniqueListingIds(undefined), []);
});

test("isWriteOutcome / describeWriteOutcome only treat server-confirmed writes as authoritative", () => {
  assert.equal(isWriteOutcome({ listingIds: ["a"], reply: "찾았어요" }), false);
  assert.equal(isWriteOutcome({ pendingAction: { type: "rental_request" } }), false, "pending confirmation is not a write");
  assert.equal(isWriteOutcome({ favoriteAction: { listingId: "a", favorite: true, synced: false } }), false, "client-side sync pending");
  assert.equal(isWriteOutcome({ reservation: { kind: "rental", number: "R-1" } }), true);
  assert.equal(isWriteOutcome({ delegatedTransaction: { listingId: "a" } }), true);
  assert.equal(isWriteOutcome({ executedAction: "purchase_request" }), true);
  assert.match(describeWriteOutcome({ reservation: { kind: "rental", number: "R-7" } }), /대여 예약 요청.*R-7/);
  assert.match(describeWriteOutcome({ reservation: { kind: "purchase" } }), /구매 신청/);
  assert.equal(describeWriteOutcome({ listingIds: [] }), "");
});

test("buildSpokenSummary does not re-read the card list and deduplicates repeated sentences", () => {
  const reply = "조건에 맞는 트랙터 2대를 찾았어요.\n\n### 추천 매물\n1. **트랙터 A** 영양읍 일 8만 원\n2. **트랙터 B** 일 9만 원";
  const spoken = buildSpokenSummary(reply, { listingCount: 2 });
  assert.equal(spoken, "조건에 맞는 트랙터 2대를 찾았어요.");
  assert.doesNotMatch(spoken, /트랙터 A|\*\*|#/);

  const repeated = buildSpokenSummary("금요일은 비가 와요. 금요일은 비가 와요! 월요일이 좋아요.");
  assert.equal(repeated, "금요일은 비가 와요. 월요일이 좋아요.");

  // A confirmed write the reply forgot to mention is stated first.
  const write = buildSpokenSummary("다른 것도 도와드릴까요?", { result: { reservation: { kind: "rental", number: "R-9" } } });
  assert.match(write, /^대여 예약 요청이 접수됐어요\. 신청 번호는 R-9예요\. 다른 것도/);
  // ...but not twice when the reply already says it.
  const said = buildSpokenSummary("대여 예약 요청을 완료했어요.", { result: { reservation: { kind: "rental" } } });
  assert.equal(said, "대여 예약 요청을 완료했어요.");

  assert.ok(buildSpokenSummary("가. ".repeat(500), { maxLength: 100 }).length <= 100);
  assert.equal(stripDuplicateMachineList("- a\n- b", 2), "조건에 맞는 매물 2건을 찾았어요. 아래 카드에서 비교해 보세요.");
});

test("classifyDispatchResult keeps authoritative writes and drops stale reads", () => {
  const fresh = { sameSession: true, sameLive: true, superseded: false };
  assert.equal(classifyDispatchResult({ ...fresh, write: false }), "render_and_speak");
  assert.equal(classifyDispatchResult({ ...fresh, superseded: true, write: false }), "drop");
  assert.equal(classifyDispatchResult({ ...fresh, superseded: true, write: true }), "render_and_speak");
  assert.equal(classifyDispatchResult({ ...fresh, sameLive: false, write: false }), "drop");
  assert.equal(classifyDispatchResult({ ...fresh, sameLive: false, write: true }), "render");
  assert.equal(classifyDispatchResult({ ...fresh, sameSession: false, write: false }), "drop");
  assert.equal(classifyDispatchResult({ ...fresh, sameSession: false, write: true }), "notify");
});

test("createDispatchTimer records first-only relative marks and only content-free extras", () => {
  let clock = 1000;
  const timer = createDispatchTimer(() => clock);
  clock = 1040;
  timer.mark("request");
  clock = 1900;
  timer.mark("response");
  clock = 2500;
  timer.mark("response");
  const snap = timer.snapshot({ cards: 2, write: false, outcome: "spoken", userText: "트랙터 찾아줘 ".repeat(10), reply: { text: "x" } });
  assert.deepEqual(snap.marks, { dispatch: 0, request: 40, response: 900 });
  assert.equal(snap.cards, 2);
  assert.equal(snap.outcome, "spoken");
  assert.equal("userText" in snap, false, "long free text is never copied");
  assert.equal("reply" in snap, false);
  assert.deepEqual(pickServerTiming({ firstModelMs: 12.4, usefulResultMs: "900", reply: "secret", totalMs: -1 }), { firstModelMs: 12, usefulResultMs: 900 });
  assert.equal(pickServerTiming(null), null);
});

test("createTurnTiming measures first model call, useful result and catalog read once", async () => {
  let clock = 0;
  const timing = createTurnTiming(0, () => clock);
  clock = 5;
  const catalog = timing.measureCatalog(new Promise((resolve) => setTimeout(() => { clock = 25; resolve([]); }, 1)));
  clock = 30;
  timing.model({ phase: "start" });
  clock = 400;
  timing.model({ phase: "end" });
  clock = 410;
  timing.model({ phase: "start" });
  clock = 800;
  timing.useful();
  clock = 900;
  timing.useful();
  await catalog;
  clock = 950;
  assert.deepEqual(timing.snapshot(), { modelCalls: 2, firstModelMs: 30, firstModelDoneMs: 400, usefulResultMs: 800, catalogMs: 20, totalMs: 950 });
});

test("runAgentTurn reports content-free model call start/end through deps.onModelCall", async (t) => {
  const previous = process.env.ANTHROPIC_API_KEY;
  const previousProvider = process.env.AI_PROVIDER;
  process.env.ANTHROPIC_API_KEY = "test";
  delete process.env.AI_PROVIDER;
  t.after(() => {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous;
    if (previousProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = previousProvider;
  });
  const events = [];
  const order = [];
  const call = async () => {
    order.push("call");
    return { content: [{ type: "text", text: "어떤 작물을 키우세요?" }] };
  };
  const result = await runAgentTurn("기계 찾아줘", { inputMode: "voice" }, {
    listings: buildMockListings(),
    call,
    today: "2026-11-16",
    deps: {
      onModelCall: (event) => { events.push(event); order.push(`model:${event.phase}`); },
      onTurnComplete: () => order.push("complete"),
    },
  });
  assert.equal(result.mode, "agent");
  assert.deepEqual(order, ["model:start", "call", "model:end", "complete"]);
  assert.deepEqual(events, [{ round: 0, phase: "start" }, { round: 0, phase: "end", ok: true }]);
  for (const event of events) assert.equal(JSON.stringify(event).includes("기계"), false, "no content in timing events");
});
