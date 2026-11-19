import assert from "node:assert/strict";
import test from "node:test";
import { cleanOperatorProfile, detectOperatorChoice, hasOperatorService, withOperatorLine } from "../server/operator-service.js";

test("대행운영서비스 사용·제공 여부를 말에서 읽는다", () => {
  for (const yes of ["대행운영 사용할게요", "대행운영서비스 제공할게요", "대행 운영 해 주세요", "작업자 동반으로 빌릴게요", "기사 포함이면 좋겠어요", "대행운영 할게요"]) {
    assert.equal(detectOperatorChoice(yes), true, yes);
  }
  for (const no of ["대행운영 없이 할게요", "대행운영 안 할게요", "대행운영서비스는 필요 없어요", "대행운영 사용 안 함", "대행운영은 제공 안 해요", "대행운영 말고 기계만요"]) {
    assert.equal(detectOperatorChoice(no), false, no);
  }
  for (const none of ["트랙터 빌리고 싶어요", "네", "아니요", ""]) assert.equal(detectOperatorChoice(none), null, none);
});

test("작업자 정보는 이름·이력·하루 추가 요금이 모두 있어야 한다", () => {
  assert.deepEqual(cleanOperatorProfile({ name: " 김영수 ", experience: "트랙터 15년", dailyPrice: 80000 }), { name: "김영수", experience: "트랙터 15년", dailyPrice: 80000 });
  assert.equal(cleanOperatorProfile({ name: "김영수", experience: "", dailyPrice: 80000 }), null);
  assert.equal(cleanOperatorProfile({ name: "김영수", experience: "15년", dailyPrice: 0 }), null);
  assert.equal(cleanOperatorProfile(null), null);
});

test("대여글 소개글 맨 위에 '대행운영서비스 제공중' 줄을 하나만 넣는다", () => {
  const op = { name: "김영수", experience: "15년", dailyPrice: 80000 };
  const once = withOperatorLine("관리 잘된 경운기예요.", op);
  assert.equal(once, "✅ 대행운영서비스 제공중 (작업자 김영수, 하루 +80,000원)\n관리 잘된 경운기예요.");
  assert.equal(withOperatorLine(once, op), once);
  assert.equal(withOperatorLine(once, null), "관리 잘된 경운기예요.");
  assert.equal(hasOperatorService({ type: "rent", rentalOperator: op }), true);
  assert.equal(hasOperatorService({ type: "sale", rentalOperator: op }), false);
  assert.equal(hasOperatorService({ type: "rent", rentalOperator: null }), false);
});
