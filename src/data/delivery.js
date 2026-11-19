// 매물의 운송 방식: 판매·대여글의 조건. 화면·서버·농농이 같은 규칙을 쓴다.
// owner_delivery: 판매자·대여해 주는 사람이 상대 농가까지 가져다준다(직접 운송)
// self_pickup:    구매자·대여자가 기계가 있는 곳에 와서 가져간다(직접 픽업)

export const DELIVERY_METHODS = ["owner_delivery", "self_pickup"];

const OWNER_DELIVERY_RE = /가져다|갖다\s*(?:드|줄|줘|주)|실어다|배달|배송|운송|운반|트럭|탁송|가져\s*갈\s*수\s*있|갖고\s*가\s*(?:드|줄)/;
const SELF_PICKUP_RE = /가지러|가져가|오셔도\s*(?:돼|되|괜찮)|오시면\s*(?:돼|되)|오셔서\s*(?:가져|실어|받아)|가져\s*가세요|실어\s*가|싣고\s*가|픽업|인수|방문\s*수령|직접\s*수령|와서\s*(?:가져|실어|받아)|찾아\s*가/;
const BOTH_RE = /둘\s*다|두\s*가지\s*다|양쪽\s*다|모두\s*(?:돼|가능|괜찮)|어느\s*쪽이든|협의\s*가능/;
// "운송은 빼 줘", "픽업은 안 돼요"처럼 한 방식을 빼라는 말
const DROP_OWNER_RE = /(?:운송|배달|배송|운반|가져다\s*(?:주는|드리는)\s*(?:건|거))\s*(?:은|는)?\s*(?:빼|안\s*(?:돼|해|할)|못\s*해|없)/;
const DROP_PICKUP_RE = /(?:픽업|가지러\s*오는\s*(?:건|거)|인수)\s*(?:은|는)?\s*(?:빼|안\s*(?:돼|해|할)|못\s*해|없)/;

/** 기존 "인수·전달 방법" 글에서 운송 방식을 추정한다(이관·하위 호환용). 판단이 안 되면 직접 픽업. */
export function inferDeliveryMethods(pickupText) {
  const text = String(pickupText || "");
  const methods = [];
  if (/운반|배송|배달|운송|가져다|갖다/.test(text)) methods.push("owner_delivery");
  if (/방문|인수|픽업|가지러|수령/.test(text)) methods.push("self_pickup");
  return methods.length ? methods : ["self_pickup"];
}

/** 순서를 고정하고 허용 값만 남긴다. */
export function cleanDeliveryMethods(value) {
  const list = Array.isArray(value) ? value : [];
  return DELIVERY_METHODS.filter((method) => list.includes(method));
}

/**
 * 사용자의 말(글·음성)에서 운송 방식을 읽는다.
 * @returns {{ methods: string[] | null, drop: string[] }} methods: 새로 정해진 방식(없으면 null), drop: 빼라고 한 방식
 */
export function readDeliveryFromText(text) {
  const raw = String(text || "");
  const drop = [];
  if (DROP_OWNER_RE.test(raw)) drop.push("owner_delivery");
  if (DROP_PICKUP_RE.test(raw)) drop.push("self_pickup");
  const stripped = raw.replace(DROP_OWNER_RE, " ").replace(DROP_PICKUP_RE, " ");
  if (BOTH_RE.test(stripped) && !drop.length) return { methods: [...DELIVERY_METHODS], drop };
  const methods = [];
  if (OWNER_DELIVERY_RE.test(stripped)) methods.push("owner_delivery");
  if (SELF_PICKUP_RE.test(stripped)) methods.push("self_pickup");
  return { methods: methods.length ? cleanDeliveryMethods(methods) : null, drop };
}

/** 사용자가 운송 방식을 말한 흔적이 있는지(모델이 추측해서 넣은 값을 걸러 낼 때 쓴다). */
export function hasDeliverySignal(text) {
  const raw = String(text || "");
  return OWNER_DELIVERY_RE.test(raw) || SELF_PICKUP_RE.test(raw) || BOTH_RE.test(raw) || DROP_OWNER_RE.test(raw) || DROP_PICKUP_RE.test(raw);
}

function won(n) {
  return `${Number(n).toLocaleString("ko-KR")}원`;
}

/** 매물의 운송 방식을 한 줄로: "직접 운송 가능(운송비 30,000원, 영양군 안) · 직접 픽업 가능(영양읍 창고)" */
export function deliveryLine(delivery, { type = "rent" } = {}) {
  const methods = cleanDeliveryMethods(delivery?.methods);
  if (!methods.length) return "";
  const parts = [];
  if (methods.includes("owner_delivery")) {
    const fee = Number.isSafeInteger(delivery?.fee) && delivery.fee >= 0 ? (delivery.fee === 0 ? "운송비 무료" : `운송비 ${won(delivery.fee)}`) : "운송비 협의";
    const area = String(delivery?.area || "").trim();
    parts.push(`직접 운송 가능(${fee}${area ? `, ${area}` : ""})`);
  }
  if (methods.includes("self_pickup")) {
    const who = type === "sale" ? "구매자" : "대여자";
    const place = String(delivery?.pickupPlace || "").trim();
    parts.push(`${who} 직접 픽업${place ? `(${place.slice(0, 40)})` : ""}`);
  }
  return parts.join(" · ");
}

/** 체크박스 라벨: 판매면 "구매자가 직접 픽업", 대여면 "대여자가 직접 픽업" */
export function pickupLabel(type) {
  return type === "sale" ? "구매자가 직접 픽업" : "대여자가 직접 픽업";
}

/** 서버 응답 매물에 delivery가 없을 때(마이그레이션 전·오래된 데이터) pickup 글로 채운다. */
export function deliveryOf(listing) {
  const methods = cleanDeliveryMethods(listing?.delivery?.methods);
  if (methods.length) return { ...listing.delivery, methods };
  return { methods: inferDeliveryMethods(listing?.pickup), fee: null, area: "", pickupPlace: String(listing?.pickup || "") };
}
