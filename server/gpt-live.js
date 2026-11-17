// gpt-live-1 공식 WebRTC 세션 생성기(POST /v1/live/sessions).
// API 키와 시스템 프롬프트는 서버에만 두고, 브라우저는 SDP Offer만 보내 Answer를 받는다.
import { DEFAULT_OPENAI_LIVE_MODEL, DEFAULT_OPENAI_LIVE_VOICE, VoiceError } from "./voice.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_SDP_LENGTH = 65_536;
const MAX_SEED_HISTORY = 12;

/**
 * gpt-live-1 공식 프롬프트 템플릿(guides/live-prompting)에 맞춘 농농이 실시간 음성 지시문.
 */
export function buildGptLiveInstructions({ region = "영양읍" } = {}) {
  const safeRegion = typeof region === "string" && region.trim() ? region.trim() : "영양읍";
  return [
    `너는 농기계 대여·구매·거래 플랫폼 모아농의 따뜻하고 믿음직한 한국어 음성 도우미 '농농이'다. 기본 안내 기준 지역은 ${safeRegion}이다.`,
    "고령 농업인과 바쁜 현장 사용자를 배려해 경상도·전라도·충청도 사투리를 자연스럽게 알아듣고, 쉽고 또렷한 한국어 존댓말로 짧게 답한다.",
    "날짜, 금액, 평수, 마력, 기종명 등 중요한 숫자와 조건은 말로 분명하게 되읽어 확인한다.",
    "",
    "Backchannel policy:",
    'Use moderate, warm Korean backchannels like "네", "아, 그러시군요", "알겠습니다" while listening so the user knows you are following without interrupting their train of thought.',
    "",
    "Interruption policy:",
    "When the user interrupts or starts speaking while you are talking, stop speaking right away and listen until they finish before responding.",
    "",
    "Delegation policy:",
    "Backend tools:",
    "- 매물 검색 (지역·작물·작업·기종·거래방식·예산별 대여/판매 매물 조회)",
    "- 예약 가능일·비용 계산 (대여 기간별 가능 여부 및 총 대여료 계산)",
    "- 기상청 날씨·적합일 추천 (작업 예정일 강수·기온 및 작업 적합일 안내)",
    "- 농장 면적·트랙터 호환성 확인 (평수 기준 작업량, 마력·작업기 호환성 확인)",
    "- 사진/수리/시세/보험 안내 (기계 사진 판별, 수리센터·시세·농기계 보험 상담)",
    "- 대여·구매·거래전담 확인 카드 생성 (실행 전 반드시 화면 승인 카드 생성, 음성만으로 무단 실행 금지)",
    "",
    "Generate <|SpawnThinking|> when:",
    "- The user asks to search listings, check availability, pricing, weather, farm/tractor compatibility, photo/repair/market price/insurance info, or wants to reserve, buy, or delegate a machine.",
    "- The user changes a condition such as region, date, crop, area, budget, or machine type.",
    "",
    "Do not generate <|SpawnThinking|> when:",
    "- Responding to simple greetings or small talk.",
    "- Repeating or clarifying results already provided in the conversation.",
    "- Asking a brief clarifying question before enough criteria exist.",
    "",
    "Generate <|SpawnThinking|> before giving an answer that depends on backend work. Do not guess the result while waiting.",
  ].join("\n");
}

function seedInputFromHistory(history) {
  if (!Array.isArray(history)) return [];
  const items = [];
  for (const entry of history.slice(-MAX_SEED_HISTORY)) {
    if (!entry || typeof entry !== "object") continue;
    const rawText = typeof entry.text === "string"
      ? entry.text
      : typeof entry.content === "string"
        ? entry.content
        : "";
    const text = rawText.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!text) continue;
    const isAssistant = entry.role === "assistant" || entry.role === "model";
    items.push({
      type: "message",
      role: isAssistant ? "assistant" : "user",
      content: [
        {
          type: isAssistant ? "output_text" : "input_text",
          text,
        },
      ],
    });
  }
  return items;
}

/**
 * OpenAI POST /v1/live/sessions 로 WebRTC SDP Offer를 교환하고 세션 ID와 SDP Answer를 돌려준다.
 */
export async function createGptLiveSession({
  sdp,
  region,
  history = [],
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof sdp !== "string" || !sdp.trim() || sdp.length > MAX_SDP_LENGTH) {
    throw new VoiceError(400, "INVALID_SDP", "음성 연결 정보(SDP)가 올바르지 않아요.");
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new VoiceError(503, "LIVE_UNAVAILABLE", "지금은 실시간 음성 대화를 쓸 수 없어요.");
  }

  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  const model = process.env.OPENAI_LIVE_MODEL?.trim() || DEFAULT_OPENAI_LIVE_MODEL;
  const voice = process.env.OPENAI_LIVE_VOICE?.trim() || DEFAULT_OPENAI_LIVE_VOICE;

  const payload = {
    session: {
      model,
      audio: {
        output: {
          voice,
        },
      },
      instructions: buildGptLiveInstructions({ region }),
      input: [
        {
          type: "message",
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "한국어로 짧고 친근하게 인사하며 어떤 농사일이나 농기계를 찾으시는지 여쭤보고, 말씀을 기다려 주세요.",
            },
          ],
        },
        ...seedInputFromHistory(history),
      ],
      delegation: {
        type: "client",
      },
    },
    transport: {
      type: "webrtc",
      sdp: sdp.trim(),
    },
  };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("live session timeout", "TimeoutError")), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/live/sessions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn("gpt_live_session_failed", { status: response.status, elapsedMs: Date.now() - started });
      throw new VoiceError(502, "LIVE_SESSION_FAILED", "실시간 음성 대화를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }

    const data = await response.json().catch(() => null);
    const sessionId = data?.session?.id;
    const answerSdp = data?.transport?.sdp;
    if (typeof sessionId !== "string" || !sessionId || typeof answerSdp !== "string" || !answerSdp) {
      console.warn("gpt_live_session_invalid_response", { elapsedMs: Date.now() - started });
      throw new VoiceError(502, "LIVE_SESSION_FAILED", "실시간 음성 연결 응답이 올바르지 않아요.");
    }

    return {
      session: { id: sessionId },
      transport: {
        type: data?.transport?.type || "webrtc",
        sdp: answerSdp,
      },
    };
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      console.warn("gpt_live_session_timeout", { elapsedMs: Date.now() - started });
      throw new VoiceError(504, "LIVE_TIMEOUT", "실시간 음성 연결 시간이 초과됐어요. 다시 시도해 주세요.");
    }
    console.warn("gpt_live_session_error", { name: error?.name });
    throw new VoiceError(502, "LIVE_SESSION_FAILED", "실시간 음성 대화를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    clearTimeout(timer);
  }
}
