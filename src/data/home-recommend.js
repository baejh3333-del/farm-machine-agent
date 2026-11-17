// 홈 예약창의 실시간 추천.
// 작업·지역·날짜를 고를 때마다 조건에 맞는 매물을 거르고, 그중 보여줄 몇 대를 고른다.
// 1단계: 사용자가 직접 고른 조건(작업·지역·날짜)만으로 거르고 순서를 정한다.
// 2단계(예정): 찜 목록·이용 내역·계절 정보는 순서를 조정하는 데에만 쓴다(rankBoost 자리).

import { available } from "./recommendation.js";

export const blankHomeCriteria = () => ({
  transaction: "rent",
  operation: "",
  town: "",
  date: "",
  dateEnd: "",
});

function rentedOn(item, day) {
  return (item.booked || []).some((range) => range.start <= day && day <= range.end);
}

// 조건에 맞는 매물 전체 (순서 없음)
export function matchHomeCriteria(listings, criteria) {
  const c = { ...blankHomeCriteria(), ...criteria };
  return listings.filter((item) => {
    if (item.type !== c.transaction || item.status !== "open") return false;
    if (item.condition === "repair") return false;
    if (c.operation && !(item.operations || []).includes(c.operation)) return false;
    if (c.town && item.region !== c.town) return false;
    if (c.transaction === "rent" && c.date && !available(item, c.date, c.dateEnd || c.date)) return false;
    return true;
  });
}

// 정렬 점수: 낮을수록 먼저 보여준다
function baseScore(item, c, { operationById, today }) {
  let score = 0;
  // 고른 작업에 가장 잘 맞는 기종부터 (작업별 기본 기종 목록의 순서)
  if (c.operation) {
    const types = operationById?.[c.operation]?.defaultMachineTypes || [];
    const index = types.indexOf(item.machineType);
    score += (index === -1 ? types.length : index) * 10;
  }
  // 날짜를 안 골랐다면 오늘 바로 빌릴 수 있는 기계를 먼저
  if (c.transaction === "rent" && !c.date && today && rentedOn(item, today)) score += 100;
  return score;
}

/**
 * 추천 매물 고르기
 * @param {object[]} listings 전체 매물
 * @param {object} criteria { transaction, operation, town, date, dateEnd }
 * @param {object} options
 *   - limit: 보여줄 개수 (기본 3)
 *   - operationById: OPERATION_BY_ID
 *   - today: 오늘 날짜(YYYY-MM-DD)
 *   - tieBreak: (a, b) => number  같은 점수일 때 순서 (거리·가격 등)
 *   - rankBoost: (item) => number  2단계 개인화용. 작은 값일수록 앞으로. 조건 필터에는 영향 없음
 *   - displayPenalty: (item) => number  화면용 보정(예: 예시 사진이 없는 기종은 살짝 뒤로). 작업 적합도보다 약하게
 *   - visualKey: (item) => string  같은 사진이 겹치지 않게 고를 때 쓰는 값 (기본: 기종)
 * @returns {{ items: object[], total: number }}
 */
export function pickHomeRecommendations(listings, criteria, options = {}) {
  const { limit = 3, operationById = {}, today = "", tieBreak, rankBoost, visualKey, displayPenalty } = options;
  const c = { ...blankHomeCriteria(), ...criteria };
  const matched = matchHomeCriteria(listings, c);
  const scored = matched
    .map((item) => ({
      item,
      score:
        baseScore(item, c, { operationById, today }) +
        (displayPenalty ? Number(displayPenalty(item)) || 0 : 0) +
        (rankBoost ? Number(rankBoost(item)) || 0 : 0),
    }))
    .sort((a, b) => a.score - b.score || (tieBreak ? tieBreak(a.item, b.item) : 0) || String(a.item.id).localeCompare(String(b.item.id)));

  // 같은 기종(같은 사진)만 3대 나오지 않게, 서로 다른 것을 먼저 하나씩 고른다
  const picked = [];
  const seenTypes = new Set();
  const seenVisuals = new Set();
  for (const { item } of scored) {
    if (picked.length >= limit) break;
    const visual = visualKey ? visualKey(item) : item.machineType;
    if (seenTypes.has(item.machineType) || seenVisuals.has(visual)) continue;
    seenTypes.add(item.machineType);
    seenVisuals.add(visual);
    picked.push(item);
  }
  for (const { item } of scored) {
    if (picked.length >= limit) break;
    if (picked.includes(item) || seenTypes.has(item.machineType)) continue;
    seenTypes.add(item.machineType);
    picked.push(item);
  }
  for (const { item } of scored) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return { items: picked, total: matched.length };
}
