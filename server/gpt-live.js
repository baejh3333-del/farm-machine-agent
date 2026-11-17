// gpt-live-1 공식 WebRTC 세션 생성기(POST /v1/live/sessions).
// API 키와 시스템 프롬프트는 서버에만 두고, 브라우저는 SDP Offer만 보내 Answer를 받는다.
import { DEFAULT_OPENAI_LIVE_MODEL, DEFAULT_OPENAI_LIVE_VOICE, VoiceError } from "./voice.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_SDP_LENGTH = 65_536;
const MAX_SEED_HISTORY = 12;
// session.input은 렌더링 기준 8,192토큰(기본값)으로 제한된다. 한국어는 글자당 토큰이 많아
// 12개×500자를 그대로 넣으면 넘칠 수 있으므로 최근 대화부터 합계 글자 수를 제한한다.
const MAX_SEED_HISTORY_CHARS = 2_400;
const MAX_ERROR_BODY_CHARS = 8_192;
const MAX_LOGGED_MESSAGE_CHARS = 300;
// 400 응답이 선택 필드를 가리킬 때만 한 번씩 빼고 다시 시도한다(SDP 오퍼는 세션이 만들어지지 않았으니 재사용 가능).
const MAX_SESSION_ATTEMPTS = 4;
const SAFE_TOKEN = /^[A-Za-z0-9_.:\-[\]]{1,120}$/;
const SAFE_QUOTED = /^[A-Za-z0-9_.:\-[\]]{1,64}$/;
const SDP_START = /\bv=0\b|\bo=-\s/;
const SDP_LINE = /\b(?:a=(?:ice|fingerprint|candidate|group|msid|setup|rtpmap|mid|sctp)|m=(?:audio|application|video)\b|c=IN\s)/gi;

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

export function seedInputFromHistory(history, { maxChars = MAX_SEED_HISTORY_CHARS } = {}) {
  if (!Array.isArray(history)) return [];
  const items = [];
  let budget = maxChars;
  // 최근 대화가 더 중요하므로 뒤에서부터 예산 안에서 채우고 마지막에 원래 순서로 되돌린다.
  for (const entry of history.slice(-MAX_SEED_HISTORY).reverse()) {
    if (budget <= 0) break;
    if (!entry || typeof entry !== "object") continue;
    const rawText = typeof entry.text === "string"
      ? entry.text
      : typeof entry.content === "string"
        ? entry.content
        : "";
    const text = rawText.replace(/\s+/g, " ").trim().slice(0, Math.min(500, budget));
    if (!text) continue;
    budget -= text.length;
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
  return items.reverse();
}

function safeToken(value) {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

/**
 * OpenAI 오류 메시지를 로그에 남겨도 되는 형태로 줄인다.
 * API 키·Bearer 토큰·SDP·사용자 발화(따옴표 안 문장, 한글 등 비ASCII)는 지우고 300자로 자른다.
 */
export function sanitizeUpstreamMessage(message, secrets = []) {
  if (typeof message !== "string" || !message) return undefined;
  let text = message;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join("[redacted]");
  }
  // SDP 본문이 섞여 있으면 그 지점부터 잘라 낸다. "missing a=fingerprint" 같은 속성 이름 하나는 진단용으로 남긴다.
  const sdpLines = [...text.matchAll(SDP_LINE)];
  const sdpAt = text.search(SDP_START);
  const cutAt = sdpAt >= 0 ? sdpAt : sdpLines.length >= 2 ? sdpLines[0].index : -1;
  if (cutAt >= 0) text = `${text.slice(0, cutAt)}[redacted-sdp]`;
  text = text.split(/\r?\n|\\r\\n|\\n/)[0];
  text = text
    .replace(/\b(?:sk|rk|pk|sess|ek)-[A-Za-z0-9_-]{6,}/g, "[redacted-key]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(["'`])([^"'`]{0,4000})\1/g, (match, quote, inner) => (SAFE_QUOTED.test(inner) ? match : `${quote}[redacted]${quote}`))
    .replace(/[^\x20-\x7E]+/g, "[redacted]")
    .replace(/(?:\[redacted\]\s*){2,}/g, "[redacted] ")
    .trim();
  return text.slice(0, MAX_LOGGED_MESSAGE_CHARS) || undefined;
}

/** 실패 응답 본문을 안전하게 읽어 { type, code, param, message, rawMessage } 로 정리한다. */
async function readUpstreamError(response, secrets) {
  let raw = "";
  try {
    raw = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS);
  } catch {
    raw = "";
  }
  let error = null;
  try {
    const parsed = JSON.parse(raw);
    error = parsed && typeof parsed === "object" ? (parsed.error && typeof parsed.error === "object" ? parsed.error : parsed) : null;
  } catch {
    error = null;
  }
  const rawMessage = typeof error?.message === "string" ? error.message : "";
  return {
    type: safeToken(error?.type),
    code: safeToken(typeof error?.code === "number" ? String(error.code) : error?.code),
    param: safeToken(error?.param),
    message: sanitizeUpstreamMessage(rawMessage, secrets),
    rawMessage,
  };
}

/**
 * 400 오류가 선택 필드를 가리키면 그 필드를 빼고 다시 시도할 단계를 고른다.
 * 모델·transport(SDP) 같은 필수 값 오류는 다시 시도하지 않는다.
 */
function chooseFallback(status, details, state) {
  if (status !== 400 && status !== 422) return null;
  const param = details.param || "";
  const message = details.rawMessage.toLowerCase();
  const mentionsVoice = !param && /\bvoice\b/.test(message);
  if (!state.dropVoice && (param.startsWith("session.audio") || mentionsVoice)) return "voice";
  if (param.startsWith("session.input") || (!param && /\binput\b|token limit|too many tokens|history/.test(message))) {
    if (state.hasHistory && !state.dropHistory) return "history";
    if (!state.dropInput) return "input";
  }
  if (!state.dropDelegation && param.startsWith("session.delegation")) return "delegation";
  return null;
}

function buildSessionPayload({ model, voice, region, history, sdp, state }) {
  const session = { model };
  if (!state.dropVoice) session.audio = { output: { voice } };
  session.instructions = buildGptLiveInstructions({ region });
  if (!state.dropInput) {
    session.input = [
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
      ...(state.dropHistory ? [] : history),
    ];
  }
  // delegation을 빼거나 null로 두면 공식 스펙상 client 위임과 같다.
  if (!state.dropDelegation) session.delegation = { type: "client" };
  return {
    session,
    // SDP는 줄 끝 CRLF까지 의미가 있으므로 다듬지 않고 브라우저가 만든 그대로 보낸다(공식 예제와 동일).
    transport: { type: "webrtc", sdp },
  };
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

  // 예전에는 sdp.trim()으로 마지막 줄의 CRLF까지 지웠다. SDP의 모든 줄은 CRLF로 끝나야 하므로
  // 앞뒤 공백을 정리한 뒤 마지막 CRLF를 하나 다시 붙인다(브라우저 원본 오퍼와 같은 형태).
  const transportSdp = `${sdp.trim()}\r\n`;
  const seededHistory = seedInputFromHistory(history);
  const state = {
    hasHistory: seededHistory.length > 0,
    dropVoice: false,
    dropHistory: false,
    dropInput: false,
    dropDelegation: false,
  };
  const dropped = [];

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("live session timeout", "TimeoutError")), timeoutMs);
  try {
    let response;
    for (let attempt = 1; ; attempt += 1) {
      const payload = buildSessionPayload({ model, voice, region, history: seededHistory, sdp: transportSdp, state });
      response = await fetchImpl(`${baseUrl}/live/sessions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (response.ok) break;

      const details = await readUpstreamError(response, [apiKey, transportSdp.trim()]);
      const fallback = attempt < MAX_SESSION_ATTEMPTS ? chooseFallback(response.status, details, state) : null;
      // 키·SDP·사용자 발화는 남기지 않고 원인 파악에 필요한 구조화된 값만 남긴다.
      console.warn("gpt_live_session_failed", {
        status: response.status,
        type: details.type,
        code: details.code,
        param: details.param,
        message: details.message,
        requestId: safeToken(response.headers?.get?.("x-request-id")),
        model: safeToken(model),
        voice: state.dropVoice ? undefined : safeToken(voice),
        historyItems: state.dropHistory || state.dropInput ? 0 : seededHistory.length,
        attempt,
        dropped: dropped.length ? dropped.join(",") : undefined,
        retryWithout: fallback || undefined,
        elapsedMs: Date.now() - started,
      });
      if (!fallback) {
        throw new VoiceError(502, "LIVE_SESSION_FAILED", "실시간 음성 대화를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      if (fallback === "voice") state.dropVoice = true;
      if (fallback === "history") state.dropHistory = true;
      if (fallback === "input") state.dropInput = true;
      if (fallback === "delegation") state.dropDelegation = true;
      dropped.push(fallback);
    }
    if (dropped.length) {
      console.warn("gpt_live_session_fallback_succeeded", { dropped: dropped.join(","), elapsedMs: Date.now() - started });
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
