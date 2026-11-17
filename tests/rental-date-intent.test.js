import assert from "node:assert/strict";
import test from "node:test";
import { hasDateSignal, parseRentalDates, resolveRentalDates, wantsBrowseWithoutDate } from "../server/rental-date-intent.js";

const TODAY = "2026-11-18"; // 수요일

test("상대 날짜·요일·주말을 오늘 기준 날짜로 바꾼다", () => {
  const cases = {
    "내일 트랙터 빌릴래": ["2026-11-19", "2026-11-19"],
    "모레": ["2026-11-20", "2026-11-20"],
    "내일모레": ["2026-11-20", "2026-11-20"],
    "금요일": ["2026-11-20", "2026-11-20"],
    "다음 주 월요일": ["2026-11-23", "2026-11-23"],
    "다음 주 화요일부터 이틀 트랙터 빌리고 싶어": ["2026-11-24", "2026-11-25"],
    "다음주 화요일부터 3일 동안": ["2026-11-24", "2026-11-26"],
    "이번 주말": ["2026-11-21", "2026-11-22"],
    "다음 주 월요일부터 이틀": ["2026-11-23", "2026-11-24"],
  };
  for (const [text, [start, end]] of Object.entries(cases)) {
    assert.deepEqual(parseRentalDates(text, TODAY), { start, end }, text);
  }
});

test("절대 날짜와 범위", () => {
  assert.deepEqual(parseRentalDates("11월 24일~26일", TODAY), { start: "2026-11-24", end: "2026-11-26" });
  assert.deepEqual(parseRentalDates("24일부터 26일까지", TODAY), { start: "2026-11-24", end: "2026-11-26" });
  assert.deepEqual(parseRentalDates("2026-11-25부터 2026-11-27까지로 해주세요.", TODAY), { start: "2026-11-25", end: "2026-11-27" });
  assert.deepEqual(parseRentalDates("12월 30일부터 1월 2일까지", TODAY), { start: "2026-12-30", end: "2027-01-02" });
  assert.deepEqual(parseRentalDates("5일에 빌릴게요", TODAY), { start: "2026-12-05", end: "2026-12-05" });
});

test("날짜가 아닌 말은 날짜로 보지 않는다", () => {
  for (const text of ["트랙터 빌리고 싶어", "3일 동안 빌려줘", "3일 빌릴게요", "100평 고추 두둑", "2번", "1.5평", "다음 주쯤", "주말에"]) {
    assert.equal(parseRentalDates(text, TODAY), null, text);
  }
});

test("이번 말 → 앞선 말 → 세션 → 화면 필터 순으로 기간을 정한다", () => {
  const history = [
    { role: "user", content: "다음 주 화요일에 트랙터 빌리고 싶어" },
    { role: "assistant", content: "찾았어요" },
  ];
  assert.equal(resolveRentalDates({ text: "내일로 바꿔줘", history, today: TODAY }).start, "2026-11-19");
  assert.deepEqual(resolveRentalDates({ text: "2번", history, today: TODAY }), { start: "2026-11-24", end: "2026-11-24", source: "history" });
  assert.equal(resolveRentalDates({ text: "2번", sessionSlots: { start: "2026-11-30", end: "2026-12-01" }, today: TODAY }).source, "session");
  assert.equal(resolveRentalDates({ text: "2번", sessionSlots: { start: "2026-11-01" }, uiCtx: { date: "2026-11-28" }, today: TODAY }).source, "screen");
  assert.equal(resolveRentalDates({ text: "트랙터 빌리고 싶어", today: TODAY }), null);
});

test("날짜 흔적과 날짜 없이 둘러보기 판단", () => {
  assert.equal(hasDateSignal("다음 달 초에"), true);
  assert.equal(hasDateSignal("트랙터 빌리고 싶어"), false);
  assert.equal(wantsBrowseWithoutDate("날짜는 상관없이 먼저 보여줘"), true);
  assert.equal(wantsBrowseWithoutDate("트랙터 빌리고 싶어"), false);
});
