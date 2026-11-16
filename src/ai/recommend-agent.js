import { apiFetch } from "../core/store.js";

export async function askRecommendation(message, context) {
  const response = await fetch("/api/recommend", {
    method: "POST",
    signal: AbortSignal.timeout(9500),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, context }),
  });
  if (!response.ok) throw new Error(`추천 요청에 실패했습니다 (${response.status})`);
  const result = await response.json();
  if (!result || typeof result.reply !== "string" || !Array.isArray(result.listingIds)) throw new Error("추천 응답 형식이 올바르지 않습니다.");
  return result;
}

// 농농 통합 에이전트(/api/agent). 서버에 AI 키가 없으면 { mode: "unavailable" }를 받는다.
export async function askAgent(message, { history = [], region, uiContext, image, savedDraft } = {}) {
  const result = await apiFetch("/api/agent", {
    method: "POST",
    timeoutMs: image ? 50000 : 30000,
    json: {
      action: "chat",
      message,
      history,
      region,
      ...(uiContext ? { uiContext } : {}),
      ...(image ? { image } : {}),
      ...(savedDraft ? { savedDraft } : {}),
    },
  });
  if (!result || typeof result.mode !== "string") throw new Error("농농이 응답 형식이 올바르지 않습니다.");
  return result;
}

// 사용자가 원탭 또는 확인 카드로 승인한 작업(대여 요청·구매 신청·매물 등록)을 서버에 실행을 맡긴다.
export async function executeAgentAction(pendingAction, requestId) {
  return apiFetch("/api/agent", {
    method: "POST",
    json: { action: "execute", pendingAction, requestId },
  });
}
