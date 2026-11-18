// 실시간 음성 전사(조각 단위 delta)를 화면·대화 기록용 글로 이어 붙이는 도우미.
// 중간 안내 문구와 본 답변이 ", 모아농 …확인해볼게요.네, …"처럼 붙어 나오지 않게 한다.

const LEADING_PUNCT = /^[\s,.;:·…、，。]+/;
const SENTENCE_END = /[.?!。？！]$/;

/** 이전까지 쌓인 글(prev)에 새 조각(delta)을 붙인다. */
export function joinSpokenText(prev, delta) {
  const before = typeof prev === "string" ? prev : "";
  let chunk = typeof delta === "string" ? delta : "";
  if (!chunk) return before;
  if (!before.trim()) return chunk.replace(LEADING_PUNCT, "");
  if (SENTENCE_END.test(before) && /^[^\s.,?!]/.test(chunk)) chunk = ` ${chunk}`;
  return before + chunk;
}

/** 음성 인식 결과가 비었거나 한글·숫자가 거의 없는 조각이면 알아듣지 못한 것으로 본다. */
export function isUnclearUtterance(text) {
  const clean = String(text || "").replace(/[\s.,!?~…·'"]/g, "");
  if (!clean) return true;
  const meaningful = clean.match(/[가-힣0-9A-Za-z]/g)?.length || 0;
  if (meaningful === 0) return true;
  // "음", "으", "흠" 같은 추임새만 들린 경우("어"·"응"은 대답일 수 있어 뺀다)
  return /^[음아으흠엉]+$/.test(clean);
}
/** 모델 전사에 섞이는 "D R G H-1400" 같은 띄어 쓴 영문 기종명을 "DRGH-1400"으로 붙인다. */
export function tidySpokenText(text) {
  return String(text || "")
    .replace(LEADING_PUNCT, "")
    .replace(/\b(?:[A-Z] ){1,}[A-Z](?=\b|[-\d])/g, (match) => match.replace(/ /g, ""))
    .replace(/([.?!])(?=[가-힣])/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

