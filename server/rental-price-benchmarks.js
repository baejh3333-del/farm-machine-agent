/**
 * 기종별 1일 임대 기준가격 설정
 *
 * 실제 전국 임대사업소 가격표를 검증해 평균이 확정된 기종만
 * 아래 객체에 원 단위 숫자로 등록한다.
 *
 * 값이 없거나 null인 기종은 기존 시드 가격을 그대로 유지한다.
 * 검증되지 않은 추정 가격을 임의로 넣지 않는다.
 */
export const RENT_PRICE_BENCHMARKS = {
  // 예시: cultivator: 25000,
};

/**
 * 트랙터는 마력 구간별로 기준가격을 적용한다.
 * 모델명/요약에서 마력을 확인할 수 없거나 구간 밖이면 기존 가격을 유지한다.
 */
function getBenchmarkKey(item) {
  if (item.machineType !== "tractor") return item.machineType;

  const text = `${item.title || ""} ${item.summary || ""}`;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:마력|HP|PS)/i);
  if (!match) return null;

  const horsepower = Number(match[1]);
  if (horsepower >= 25 && horsepower <= 35) return "tractor_25_35";
  if (horsepower >= 48 && horsepower <= 60) return "tractor_48_60";
  if (horsepower >= 75 && horsepower <= 85) return "tractor_75_85";

  return null;
}

/**
 * 기준가격이 등록된 대여 매물만 조정한다.
 *
 * 조정률 = 기준가격 / 해당 기종의 기존 대여 평균
 * 새 가격 = 기존 개별 가격 × 조정률
 *
 * 따라서 기존 매물 간 상대적인 가격 편차를 최대한 유지한다.
 * 판매 매물, 기준가격 미확정 기종, 마력 판별 불가 트랙터는 변경하지 않는다.
 */
export function adjustRentalPrices(listings) {
  const groups = {};

  for (const item of listings) {
    if (item.type !== "rent") continue;

    const key = getBenchmarkKey(item);
    const benchmark = RENT_PRICE_BENCHMARKS[key];

    if (!key || !Number.isFinite(benchmark) || benchmark <= 0) continue;

    if (!groups[key]) groups[key] = { total: 0, count: 0 };
    groups[key].total += Number(item.price);
    groups[key].count += 1;
  }

  return listings.map((item) => {
    if (item.type !== "rent") return item;

    const key = getBenchmarkKey(item);
    const benchmark = RENT_PRICE_BENCHMARKS[key];
    const group = groups[key];

    if (!key || !Number.isFinite(benchmark) || benchmark <= 0 || !group || group.count === 0) {
      return item;
    }

    const oldAverage = group.total / group.count;
    if (!Number.isFinite(oldAverage) || oldAverage <= 0) return item;

    const adjustmentRate = benchmark / oldAverage;
    const adjustedPrice = Math.round((Number(item.price) * adjustmentRate) / 1000) * 1000;

    return { ...item, price: adjustedPrice };
  });
}
