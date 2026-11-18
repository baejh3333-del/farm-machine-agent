import test from "node:test";
import assert from "node:assert/strict";
import { describeTask, extractTaskSlots, pickCorrectionTarget, resolveClarificationAnswer } from "../src/ai/gpt-live.js";

const task = (id, text, active = true) => ({ id, text, slots: extractTaskSlots(text), active });

test("extractTaskSlots finds explicit machine/weather/date/region/price/deal slots", () => {
  const s = extractTaskSlots("20일에 영양읍 트랙터 얼마야");
  assert.deepEqual([...s.cats].sort(), ["date", "machine", "price", "region"]);
  assert.ok(s.values.has("트랙터") && s.values.has("20일") && s.values.has("영양읍"));
  assert.deepEqual([...extractTaskSlots("내일 날씨 알려줘").cats].sort(), ["date", "weather"]);
  assert.equal(extractTaskSlots("아니 그게 아니라").cats.size, 0);
});

test("pickCorrectionTarget prefers explicit value, then slot kind, then the one active task", () => {
  const a = task("A", "트랙터 찾아줘");
  const b = task("B", "내일 날씨 알려줘");
  assert.equal(pickCorrectionTarget("아니 콤바인으로", [a, b]).target, a);
  assert.equal(pickCorrectionTarget("아니 모레로", [a, b]).target, b);
  assert.equal(pickCorrectionTarget("트랙터 말고 콤바인", [a, task("C", "콤바인 가격", true)]).target.id, "A");
  // settled tractor + pending weather: the machine correction still targets the tractor
  assert.equal(pickCorrectionTarget("아니 콤바인으로", [task("A", "트랙터 찾아줘", false), b]).target.id, "A");
  // two machine tasks pending → ask
  const amb = pickCorrectionTarget("아니 이앙기로", [a, task("C", "콤바인도 찾아줘")]);
  assert.deepEqual(amb.ambiguous.map((t) => t.id), ["A", "C"]);
  // two machine tasks, only one still pending → the pending one
  assert.equal(pickCorrectionTarget("아니 이앙기로", [task("A", "트랙터 찾아줘", false), task("C", "콤바인 찾아줘")]).target.id, "C");
  // slot-less correction: unique active task (weak), several → ask, none matching kind → nothing
  assert.equal(pickCorrectionTarget("아니 그게 아니라", [task("A", "트랙터", false), b]).weak, true);
  assert.ok(pickCorrectionTarget("아니 그게 아니라", [a, b]).ambiguous);
  assert.equal(pickCorrectionTarget("아니 영양읍으로", [a, b]).none, true);
  assert.equal(pickCorrectionTarget("아니", []).none, true);
});

test("resolveClarificationAnswer understands slot, ordinal, all and keep answers", () => {
  const a = task("A", "트랙터 찾아줘");
  const c = task("C", "콤바인도 찾아줘");
  assert.deepEqual(resolveClarificationAnswer("트랙터요", [a, c]), [a]);
  assert.deepEqual(resolveClarificationAnswer("두 번째 거요", [a, c]), [c]);
  assert.deepEqual(resolveClarificationAnswer("처음 거", [a, c]), [a]);
  assert.deepEqual(resolveClarificationAnswer("둘 다 바꿔", [a, c]), [a, c]);
  assert.deepEqual(resolveClarificationAnswer("그대로 두세요", [a, c]), []);
  assert.equal(resolveClarificationAnswer("음", [a, c]), null);
  assert.equal(describeTask(task("W", "관리기 20일 예약해줘")), "관리기 예약");
  assert.equal(describeTask(task("B", "내일 날씨 알려줘")), "내일 날씨 확인");
});
