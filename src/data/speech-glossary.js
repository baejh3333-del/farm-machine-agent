// 음성 인식·사투리 이해를 돕는 단어집. 서버 STT 힌트(prompt), 실시간 음성 지시문, 브라우저 인식 후보 선택,
// 에이전트의 표준어 풀이에 같은 목록을 쓴다.

// 농기계·작업 이름(인식 힌트)
export const MACHINE_TERMS = [
  "관리기", "승용관리기", "트랙터", "경운기", "로터리", "로타베이터", "쟁기", "휴립피복기", "휴립·멀칭기", "멀칭", "두둑", "고랑",
  "정식기", "이앙기", "콤바인", "방제기", "분무기", "SS기", "드론", "운반차", "굴취기", "땅속작물 수확기", "고구마 수확기",
  "감자 파종기", "마늘 파종기", "배토기", "예초기", "탈곡기", "건조기", "선별기", "베일러", "프론트로더", "작업기", "마력",
];

// 매물이 많은 지역 이름(인식 힌트)
export const REGION_TERMS = ["영양읍", "청기면", "입암면", "수비면", "석보면", "일월면", "영양군"];

// 자주 나오는 작물 이름(인식 힌트)
export const CROP_TERMS = [
  "고추", "고구마", "감자", "배추", "벼", "콩", "옥수수", "마늘", "양파", "무", "대파", "생강", "사과", "배", "복숭아", "포도",
  "들깨", "참깨", "땅콩", "수박", "참외", "딸기", "인삼", "부추", "당근",
];

// 브랜드·기종 이름(인식 힌트)
export const BRAND_TERMS = ["두루기계통상", "DRGH-1400", "아세아텍", "대동", "얀마", "불스", "현대농기계", "국제", "LS엠트론", "혼다", "강농"];

// 사투리 → 표준어. 왼쪽이 들리면 오른쪽 뜻으로 알아듣는다(단어 경계에서만 바꾼다).
export const DIALECT_TO_STANDARD = [
  ["나락", "벼"],
  ["꼬치", "고추"], ["꼬추", "고추"],
  ["배차", "배추"], ["뱁추", "배추"],
  ["정구지", "부추"],
  ["강냉이", "옥수수"], ["옥시기", "옥수수"], ["옥수시", "옥수수"],
  ["하지감자", "감자"],
  ["트랙타", "트랙터"], ["뜨락또르", "트랙터"],
  ["로타리", "로터리"],
  ["딸딸이", "경운기"],
  ["비니루", "비닐"],
  ["맹글", "만들"], ["맨들", "만들"],
  ["멫", "몇"],
  ["우째", "어떻게"], ["어찌케", "어떻게"], ["어뜨케", "어떻게"],
  ["머꼬", "뭐예요"], ["뭐꼬", "뭐예요"], ["뭣이여", "뭐예요"],
  ["하모", "네"], ["그려", "네"], ["기여", "네"], ["그라제", "네"], ["맞심더", "맞아요"], ["좋심더", "좋아요"],
  ["고마 됐다", "그만해도 된다"], ["됐심더", "됐어요"],
  ["해 주이소", "해 주세요"], ["해 주소", "해 주세요"], ["해 도", "해 줘"], ["해 도라", "해 줘"], ["해 주랑께", "해 주세요"], ["해 줘유", "해 주세요"],
  ["빌리고 싶어예", "빌리고 싶어요"], ["사고 싶어예", "사고 싶어요"],
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 사투리 낱말을 표준어로 바꾼 글. 바뀐 것이 없으면 원문 그대로. */
export function normalizeDialect(text) {
  let out = String(text || "");
  for (const [dialect, standard] of DIALECT_TO_STANDARD) {
    // 낱말 앞이 한글이 아닐 때만 바꾼다(뒤에는 조사가 붙을 수 있다). 한 글자 낱말은 뒤도 끊겨 있어야 한다.
    const after = dialect.length <= 1 ? "(?![가-힣])" : "";
    out = out.replace(new RegExp(`(?<![가-힣])${escapeRegExp(dialect)}${after}`, "g"), standard);
  }
  return out;
}

/** 인식 힌트 단어 전체(중복 제거). */
export function speechHintTerms() {
  return [...new Set([...MACHINE_TERMS, ...CROP_TERMS, ...REGION_TERMS, ...BRAND_TERMS])];
}

/**
 * 브라우저 음성 인식이 여러 후보를 줄 때, 농기계·작물·지역 단어가 더 많이 맞는 후보를 고른다.
 * 점수가 같으면 인식기가 준 순서(신뢰도 순)를 따른다.
 */
export function pickBestTranscript(alternatives) {
  const list = (Array.isArray(alternatives) ? alternatives : [])
    .map((alt) => (typeof alt === "string" ? alt : alt?.transcript || ""))
    .filter(Boolean);
  if (!list.length) return "";
  const terms = speechHintTerms();
  let best = list[0];
  let bestScore = -1;
  for (const candidate of list) {
    const normalized = normalizeDialect(candidate);
    const score = terms.reduce((sum, term) => sum + (normalized.includes(term) ? term.length : 0), 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
