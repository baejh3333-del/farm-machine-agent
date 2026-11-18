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

// 서버가 실제 내부 조회를 실행할 때 보내는 진행 문구만 통과시킨다(짧은 한국어 한 문장, 같은 문구는 한 번).
// 도구 이름·인자 같은 원자료, 기호가 섞인 문구, 진행이 아닌 줄은 버린다.
export function safeProgressLabel(label) {
  if (typeof label !== "string") return "";
  const text = label.replace(/\s+/g, " ").trim();
  if (!text || text.length > 60 || !/[가-힣]/.test(text) || /[{}[\]<>_=`\\\u0000-\u001f\u007f]/.test(text)) return "";
  return text;
}

export function progressForwarder(onProgress) {
  const seen = new Set();
  return (event) => {
    if (event?.type !== "progress") return;
    const label = safeProgressLabel(event.label);
    if (!label || seen.has(label)) return;
    seen.add(label);
    onProgress({ label });
  };
}

// 농농 통합 에이전트(/api/agent). 서버에 AI 키가 없으면 { mode: "unavailable" }를 받는다.
// insuranceOffer: 예약 뒤 보험 추천 흐름의 진행 상태, insuranceAsked: 이 대화에서 이미 물었는지.
export async function askAgent(
  message,
  { history = [], region, inputMode = "text", delegationId = null, sessionId = null, uiContext, image, savedDraft, insuranceOffer, insuranceAsked = false, fullDelegation, pendingAction = null, onProgress = null } = {},
) {
  const mergedUiContext = uiContext || fullDelegation
    ? { ...(uiContext || {}), ...(fullDelegation ? { fullDelegation: true } : {}) }
    : undefined;
  const result = await apiFetch("/api/agent", {
    method: "POST",
    timeoutMs: image ? 50000 : 30000,
    json: {
      action: "chat",
      ...(message ? { message } : {}),
      history,
      region,
      inputMode: inputMode === "voice" ? "voice" : "text",
      ...(delegationId ? { delegationId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(mergedUiContext ? { uiContext: mergedUiContext } : {}),
      ...(image ? { image } : {}),
      ...(savedDraft ? { savedDraft } : {}),
      ...(insuranceOffer ? { insuranceOffer } : {}),
      ...(pendingAction && typeof pendingAction === "object" ? { pendingAction } : {}),
      insuranceAsked,
      ...(typeof onProgress === "function" ? { stream: true } : {}),
    },
    ...(typeof onProgress === "function" ? { onStreamEvent: progressForwarder(onProgress) } : {}),
  });
  if (!result || typeof result.mode !== "string") throw new Error("농농이 응답 형식이 올바르지 않습니다.");
  return result;
}

// 사용자가 원탭 또는 확인 카드로 승인한 작업(대여 요청·구매 신청·매물 등록·거래 전담)을 서버에 실행을 맡긴다.
export async function executeAgentAction(pendingAction, requestId, { insuranceAsked = false } = {}) {
  return apiFetch("/api/agent", {
    method: "POST",
    ...(pendingAction?.type === "create_listing" ? { timeoutMs: 45000 } : {}),
    json: { action: "execute", pendingAction, requestId, insuranceAsked },
  });
}

// 부재중 거래 전담 위임을 서버에 요청한다.
export async function delegateTransactionAction(pendingAction, requestId = crypto.randomUUID(), options = {}) {
  return executeAgentAction({ ...pendingAction, type: "delegate_transaction", fullDelegation: true }, requestId, options);
}

// 날짜 선택 시 기상 예보를 확인한다. 오프라인·오류 시 fail-open으로 null을 반환한다.
export async function fetchWeatherForecast({ region = "영양읍", date, endDate, days = 7 } = {}) {
  try {
    const params = new URLSearchParams({
      region: region || "영양읍",
      ...(date ? { date } : {}),
      ...(endDate ? { endDate } : {}),
      days: String(days),
    });
    return await apiFetch(`/api/weather?${params.toString()}`, { timeoutMs: 3500 });
  } catch {
    return null;
  }
}

// 실시간 음성 세션에 넘길 대화 맥락: 역할·글이 온전한 최근 턴만 { role, content }로 보낸다.
export function liveSessionHistory(history, limit = 12) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => (entry?.role === "user" || entry?.role === "assistant")
      && typeof entry.content === "string" && entry.content.trim())
    .slice(-limit)
    .map(({ role, content }) => ({ role, content: content.trim() }));
}

// gpt-live-1 WebRTC 세션을 만든다. 브라우저 SDP offer를 서버가 OpenAI에 중계하고 answer SDP를 돌려준다.
export async function createLiveVoiceSession({ sdp, region, voice, uiContext, history = [] }) {
  return apiFetch("/api/voice", {
    method: "POST",
    timeoutMs: 20000,
    json: {
      action: "live_session",
      sdp,
      region,
      ...(typeof voice === "string" && voice.trim() ? { voice: voice.trim() } : {}),
      ...(uiContext && typeof uiContext === "object" ? { uiContext } : {}),
      history: liveSessionHistory(history),
    },
  });
}
