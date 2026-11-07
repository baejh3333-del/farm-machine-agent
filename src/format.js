// 면적 표시 도우미 (㎡ → 평)
export const toPyeong = (sqm) => Math.max(1, Math.round(Number(sqm) / 3.305785));
export const areaLabel = (minSqm, maxSqm) => `약 ${toPyeong(minSqm).toLocaleString()}~${toPyeong(maxSqm).toLocaleString()}평`;
export const areaFullLabel = (minSqm, maxSqm) =>
  `약 ${toPyeong(minSqm).toLocaleString()}~${toPyeong(maxSqm).toLocaleString()}평 (${Number(minSqm).toLocaleString()}~${Number(maxSqm).toLocaleString()}㎡)`;
