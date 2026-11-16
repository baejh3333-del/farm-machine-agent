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

// 농농이 AI 도구 호출 에이전트. 서버에 AI 키가 없으면 { mode: "unavailable" }를 받는다.
export async function askAgent(message, { history = [], region } = {}) {
  const result = await apiFetch("/api/agent", {
    method: "POST",
    timeoutMs: 30000,
    json: { action: "chat", message, history, region },
  });
  if (!result || typeof result.mode !== "string") throw new Error("농농이 응답 형식이 올바르지 않습니다.");
  return result;
}

// 사용자가 승인한 작업만 서버에 실행을 맡긴다.
export async function executeAgentAction(pendingAction, requestId) {
  return apiFetch("/api/agent", {
    method: "POST",
    json: { action: "execute", pendingAction, requestId },
  });
}
