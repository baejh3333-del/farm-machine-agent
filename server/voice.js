// 농농이 음성 인식(음성 → 글). 키는 서버 환경 변수에만 두고, 음성은 인식에만 쓰고 저장하지 않는다.
// 브라우저가 16kHz 모노 16비트 PCM WAV로 바꿔 보낸다(Z.ai는 wav/mp3만 받고, 30초 이하만 처리한다).
//
// 공급자 선택(VOICE_STT_PROVIDER):
//   비우면 OPENAI_API_KEY가 있을 때 OpenAI. 없으면 서버 인식 없이 브라우저 음성 인식을 쓴다.
//   zai: Z.ai glm-asr-2512. 공식 문서에 한국어 지원이 명시돼 있지 않아 직접 지정할 때만 쓴다.
//   none: 서버 인식을 끈다.

export const MAX_AUDIO_SECONDS = 30;
// 30초 × 16kHz × 2바이트 = 960,000바이트 + 머리말. 여유를 조금 둔다.
export const MAX_AUDIO_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 20000;

export const DEFAULT_OPENAI_STT_MODEL = "gpt-4o-mini-transcribe";
export const DEFAULT_ZAI_ASR_MODEL = "glm-asr-2512";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";

// OpenAI 인식에 주는 힌트: 상황 설명과 자주 나오는 농기계·작업·지역 낱말.
export const FARM_PROMPT =
  "경상도·전라도·충청도 사투리가 섞인 농업인의 농기계 상담입니다. 들리는 그대로 받아 적어 주세요. " +
  "자주 나오는 말: 관리기, 트랙터, 로터리, 휴립피복기, 멀칭, 두둑, 고랑, 정식기, 이앙기, 콤바인, 방제기, 분무기, " +
  "감자 파종기, 굴취기, 운반차, 경운기, 대여, 반납, 고추, 감자, 배추, 벼, 평, 영양읍, 청기면, 입암면, 수비면, 아세아, 대동, 얀마.";

const env = (name) => process.env[name]?.trim() || "";

export class VoiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function voiceProvider() {
  const chosen = env("VOICE_STT_PROVIDER").toLowerCase();
  if (chosen === "none") return null;
  if (chosen === "openai") return env("OPENAI_API_KEY") ? "openai" : null;
  if (chosen === "zai") return env("ZAI_API_KEY") ? "zai" : null;
  return env("OPENAI_API_KEY") ? "openai" : null;
}

export function voiceCapabilities() {
  const provider = voiceProvider();
  return { serverStt: Boolean(provider), provider, maxSeconds: MAX_AUDIO_SECONDS };
}

/** PCM WAV 머리말을 검사하고 길이를 계산한다. 다른 형식이나 30초를 넘는 녹음은 거절한다. */
export function parseWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_AUDIO_BYTES) {
    throw new VoiceError(413, "AUDIO_TOO_LARGE", `녹음이 너무 길어요. ${MAX_AUDIO_SECONDS}초 안으로 말씀해 주세요.`);
  }
  const invalid = () => new VoiceError(400, "INVALID_AUDIO", "녹음 파일을 읽지 못했어요. 다시 말씀해 주세요.");
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw invalid();
  let offset = 12;
  let format = null;
  let dataBytes = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= buffer.length) {
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      dataBytes = Math.min(size, buffer.length - body);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!format || dataBytes === null || format.audioFormat !== 1 || !format.byteRate || ![1, 2].includes(format.channels)
    || format.bitsPerSample !== 16 || format.sampleRate < 8000 || format.sampleRate > 48000) {
    throw invalid();
  }
  const seconds = dataBytes / format.byteRate;
  if (seconds < 0.3) throw new VoiceError(400, "AUDIO_TOO_SHORT", "말씀이 너무 짧아요. 버튼을 누르고 천천히 말씀해 주세요.");
  if (seconds > MAX_AUDIO_SECONDS + 0.5) {
    throw new VoiceError(413, "AUDIO_TOO_LONG", `녹음이 너무 길어요. ${MAX_AUDIO_SECONDS}초 안으로 나눠서 말씀해 주세요.`);
  }
  return { sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bitsPerSample, seconds };
}

function providerRequest(provider, wavBuffer) {
  const form = new FormData();
  form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "voice.wav");
  if (provider === "openai") {
    form.append("model", env("OPENAI_STT_MODEL") || DEFAULT_OPENAI_STT_MODEL);
    form.append("language", "ko");
    form.append("prompt", FARM_PROMPT);
    form.append("response_format", "json");
    const base = (env("OPENAI_BASE_URL") || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
    return { url: `${base}/audio/transcriptions`, key: env("OPENAI_API_KEY"), form };
  }
  form.append("model", env("ZAI_ASR_MODEL") || DEFAULT_ZAI_ASR_MODEL);
  form.append("stream", "false");
  const base = (env("ZAI_BASE_URL") || DEFAULT_ZAI_BASE_URL).replace(/\/+$/, "");
  return { url: `${base}/audio/transcriptions`, key: env("ZAI_API_KEY"), form };
}

/** WAV 녹음을 글자로 바꾼다. 로그에는 공급자·상태·길이만 남기고 음성·글자·키는 남기지 않는다. */
export async function transcribe(wavBuffer, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const provider = voiceProvider();
  if (!provider) throw new VoiceError(503, "VOICE_UNAVAILABLE", "지금은 서버 음성 인식을 쓸 수 없어요.");
  const info = parseWav(wavBuffer);
  const { url, key, form } = providerRequest(provider, wavBuffer);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("voice timeout", "TimeoutError")), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) {
      console.warn("voice_transcribe_failed", { provider, status: response.status, seconds: Math.round(info.seconds), elapsedMs: Date.now() - started });
      throw new VoiceError(502, "TRANSCRIBE_FAILED", "말씀을 글자로 바꾸지 못했어요. 다시 말씀하시거나 글로 적어 주세요.");
    }
    const data = await response.json().catch(() => null);
    const text = typeof data?.text === "string" ? data.text.replace(/\s+/g, " ").trim().slice(0, 500) : "";
    return { text, provider };
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      console.warn("voice_transcribe_timeout", { provider, seconds: Math.round(info.seconds) });
      throw new VoiceError(504, "VOICE_TIMEOUT", "글자로 바꾸는 데 시간이 너무 걸려요. 다시 말씀하시거나 글로 적어 주세요.");
    }
    console.warn("voice_transcribe_error", { provider, name: error?.name });
    throw new VoiceError(502, "TRANSCRIBE_FAILED", "말씀을 글자로 바꾸지 못했어요. 다시 말씀하시거나 글로 적어 주세요.");
  } finally {
    clearTimeout(timer);
  }
}
