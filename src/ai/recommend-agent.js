export async function askRecommendation(message, context) {
  const response = await fetch("/api/recommend", {
    method: "POST",
    signal: AbortSignal.timeout(6500),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, context }),
  });
  if (!response.ok) throw new Error(`추천 요청에 실패했습니다 (${response.status})`);
  const result = await response.json();
  if (!result || typeof result.reply !== "string" || !Array.isArray(result.listingIds)) throw new Error("추천 응답 형식이 올바르지 않습니다.");
  return result;
}
