// 대행운영서비스: 생산자(대여해 주는 사람)가 기계와 함께 작업자를 보내 대신 작업해 주고 하루 추가 요금을 받는 서비스.
// 데이터는 기존 "작업자 동반 대여"(listings.rental_operator, rental_requests.rental_operator)를 그대로 쓴다.

export const OPERATOR_SERVICE_LABEL = "대행운영서비스";

const MENTION = /대행\s*운영|대리\s*운[용영]|작업자\s*(?:동반|포함|같이|딸린|보내)|기사\s*(?:포함|같이|딸린|동반)/;
const NEGATIVE = /없이|안\s*(?:할|쓸|써|해|함|씀|쓰|하|필요|원)|필요\s*(?:없|없어|없음)|사용\s*(?:안|않)|이용\s*(?:안|않)|제공\s*(?:안|않|못)|빼고|말고|아니|않을|안요|싫/;

/**
 * 사용자의 말에서 대행운영서비스 사용(소비자)·제공(생산자) 여부를 읽는다.
 * "대행운영 사용할게요" → true, "대행운영 없이 할게요" → false, 언급이 없으면 null.
 */
export function detectOperatorChoice(text) {
  const said = String(text || "");
  if (!MENTION.test(said)) return null;
  return NEGATIVE.test(said) ? false : true;
}

/** 작업자 이름·이력·하루 추가 요금을 검사한다. 하나라도 맞지 않으면 null. */
export function cleanOperatorProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const experience = typeof input.experience === "string" ? input.experience.trim() : "";
  const dailyPrice = Number(input.dailyPrice);
  if (!name || name.length > 40) return null;
  if (!experience || experience.length > 300) return null;
  if (!Number.isSafeInteger(dailyPrice) || dailyPrice < 1 || dailyPrice > 500_000_000) return null;
  return { name, experience, dailyPrice };
}

function won(value) {
  return `${Number(value).toLocaleString("ko-KR")}원`;
}

/** 대여글 소개글 맨 위에 붙는 한 줄 */
export function operatorBadgeLine(operator) {
  return `✅ ${OPERATOR_SERVICE_LABEL} 제공중 (작업자 ${operator.name}, 하루 +${won(operator.dailyPrice)})`;
}

/** 소개글에 대행운영서비스 줄을 맨 위에 하나만 넣는다(없으면 빼고). */
export function withOperatorLine(description, operator) {
  const rest = String(description || "")
    .split("\n")
    .filter((line) => !line.includes(`${OPERATOR_SERVICE_LABEL} 제공중`))
    .join("\n")
    .trim();
  return operator ? `${operatorBadgeLine(operator)}${rest ? `\n${rest}` : ""}`.slice(0, 1000) : rest;
}

/** 매물에 대행운영서비스가 있는지 */
export function hasOperatorService(listing) {
  return Boolean(listing?.type === "rent" && cleanOperatorProfile(listing?.rentalOperator));
}
