// 사용자의 짧은 답이 "실행해도 된다"는 긍정인지 판단한다. 서버(쓰기 승인 확인)와 화면(채팅 "네"로 확인 카드 실행)이 같은 규칙을 쓴다.

const AFFIRMATIVE = [
  /^(?:네+|넵|예+|응+|웅|어+|그래(?:요)?|좋아(?:요)?|좋습니다|ㅇㅇ+|ㅇㅋ+|오케이|ok(?:ay)?|콜|맞아(?:요)?|부탁(?:해요|드려요|합니다))$/i,
  /(?:그걸로|그거로|이걸로|이거로|그것으로|이것으로)\s*(?:해|할게|예약|올려|진행|부탁)/,
  /(?:예약|신청|진행|등록|올려)\s*(?:해\s*)?(?:줘|주세요|줄래|주실래요|드려요|부탁|해요|할게요|합니다|하자|할래요)/,
  /(?:그거|그걸|이거|이걸)\s*(?:할게요|할게|할래요|살게요|빌릴게요)/,
  // "2번"처럼 번호만 말한 것은 매물을 고른 것이지 실행 승인이 아니다. 실행 동사가 함께 있을 때만 긍정으로 본다.
  /^\d+\s*번(?:\s*(?:으로|로))?\s*(?:해\s*(?:줘|주세요)|할게요|예약|진행)/,
];
const NEGATIVE_OR_UNSURE = /(?:아니|안\s*돼|안돼|싫|별로|비싸|다른\s*(?:거|것)|글쎄|생각해\s*볼|모르겠|잠깐|잠시만|말고|취소)/;

export function isAffirmative(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/[?？]\s*$/.test(raw)) return false;
  const normalized = raw.replace(/[.!~…,\s]+$/g, "").replace(/^[\s,]+/, "").trim();
  if (!normalized || NEGATIVE_OR_UNSURE.test(normalized)) return false;
  if (/^(?:음+|흠+|어\.{2,})/.test(normalized)) return false;
  const lead = normalized.replace(/^(?:네|예|응|좋아요|ㅇㅇ|오케이)[,\s]+/, "");
  return AFFIRMATIVE.some((pattern) => pattern.test(normalized) || pattern.test(lead));
}
