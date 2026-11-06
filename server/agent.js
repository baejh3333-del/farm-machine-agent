import { CROP_BY_ID, OPERATION_BY_ID } from "../src/data/farm-machines.js";
import { recommendationGuide, selectMatchingListings } from "../src/data/recommendation.js";
import { listListings } from "./listings-db.js";

function extractText(response) {
  return (response.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("");
}

export function selectCandidates(message, context = {}) {
  const allowedIds = Array.isArray(context.candidateIds) ? new Set(context.candidateIds.slice(0, 8)) : null;
  const listings = listListings().filter(({ id }) => !allowedIds || allowedIds.has(id));
  return selectMatchingListings(message, context, listings);
}

export async function recommend(message, context = {}) {
  const selection = selectCandidates(message, context);
  const { cropId, operations, transaction, candidates } = selection;
  const guide = recommendationGuide(selection);
  if (!guide.listingIds.length || !process.env.OPENAI_API_KEY) return guide;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
        store: false,
        max_output_tokens: 500,
        instructions: "농기계 매물을 비교하는 한국어 상담사다. 입력 조건과 제공된 후보 데이터만 사용하라. 답변에서 어떤 작업에 맞는지 설명한 뒤 가격, 작업기 구성, 인수 방식 중 확인 가능한 차이 한두 가지를 비교하라. 거래 전 확인할 구체적인 사항 하나를 덧붙여라. 날짜나 예산이 비어 있으면 확인된 것처럼 말하지 마라. 가격, 재고, 기계 성능, 안전성, 호환성은 지어내거나 보증하지 마라. 후보별 한줄 요약은 적합한 작물과 작업을 후보 자료에 근거해 짧게 작성하라.",
        input: JSON.stringify({
          question: message, crop: CROP_BY_ID[cropId].name,
          operation: operations.map((id) => OPERATION_BY_ID[id].label).join(", "), transaction,
          areaPyeong: selection.areaPyeong, budget: selection.maxPrice, start: selection.date, end: selection.dateEnd,
          candidates: candidates.slice(0, 3).map(({ id, title, price, region, machineType, areaMin, areaMax, summary, condition, included, pickup }) => ({ id, title, price, region, machineType, areaMin, areaMax, summary, condition, included, pickup })),
        }),
        text: { format: { type: "json_schema", name: "farm_machine_recommendation", strict: true, schema: { type: "object", properties: { reply: { type: "string" }, listingIds: { type: "array", items: { type: "string" } }, summaries: { type: "array", items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: false } } }, required: ["reply", "listingIds", "summaries"], additionalProperties: false } } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI API error ${response.status}`);
    const result = JSON.parse(extractText(await response.json()));
    const { listingIds } = guide;
    const summaries = Object.fromEntries((Array.isArray(result.summaries) ? result.summaries : []).filter((item) => listingIds.includes(item.id) && typeof item.text === "string").map((item) => [item.id, item.text.slice(0, 160)]));
    return { mode: "ai", reply: (typeof result.reply === "string" && result.reply.trim() || guide.reply).slice(0, 1000), listingIds, summaries };
  } catch {
    return guide;
  } finally {
    clearTimeout(timeout);
  }
}
