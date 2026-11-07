import { SPEC_BY_ID, checkModelCompatibility } from "./machine-specifications.js";
import { available } from "./recommendation.js";

export function rentalDays(start, end) {
  const parse = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return NaN;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
  };
  const days = (parse(end) - parse(start)) / 86400000 + 1;
  return Number.isInteger(days) && days > 0 ? days : 0;
}

export function findCompatibleRentals(listings, { mode, modelId, operation, start, end, today, onlyCompatible = false }) {
  const days = rentalDays(start, end);
  if (!days || start < today) return { error: "오늘 이후의 대여 시작일과 반납일을 선택해 주세요.", results: [] };
  if (mode === "owned" && SPEC_BY_ID[modelId]?.role !== "powerUnit") return { error: "먼저 내 트랙터·관리기를 등록하고 기준 기계로 선택해 주세요.", results: [] };
  const candidates = listings.filter((item) => available(item, start, end));
  const implementsList = candidates.filter((item) => SPEC_BY_ID[item.modelId]?.role === "implement" && (!operation || item.operations.includes(operation)));
  const results = [];
  if (mode === "owned") {
    for (const implement of implementsList) {
      const verdict = checkModelCompatibility(modelId, implement.modelId);
      if (onlyCompatible && verdict.status !== "compatible") continue;
      results.push({ implement, verdict, days, dailyPrice: implement.price, totalPrice: implement.price * days });
    }
  } else {
    for (const implement of implementsList) {
      for (const power of candidates.filter((item) => SPEC_BY_ID[item.modelId]?.role === "powerUnit")) {
        const verdict = checkModelCompatibility(power.modelId, implement.modelId);
        if (verdict.status !== "compatible") continue;
        const dailyPrice = power.price + implement.price;
        results.push({ power, implement, verdict, days, dailyPrice, totalPrice: dailyPrice * days });
      }
    }
  }
  const rank = { compatible: 0, check: 1, incompatible: 2 };
  results.sort((a, b) => rank[a.verdict.status] - rank[b.verdict.status] || a.totalPrice - b.totalPrice || a.implement.id.localeCompare(b.implement.id) || (a.power?.id || "").localeCompare(b.power?.id || ""));
  return { results, days, error: null };
}
