// 농농이 음성 도우미: 녹음 → 16kHz 모노 WAV, 브라우저 음성 인식(대체 수단), 답변 읽어 주기, 음성 설정.
// 브라우저 기능이 없거나 실패해도 글 상담이 그대로 되도록, 모든 함수는 실패를 오류 코드로 알려 준다.

export const TARGET_SAMPLE_RATE = 16000;
export const MAX_RECORD_SECONDS = 30;
const SETTINGS_KEY = "nongnong.voice";
const DEFAULT_SETTINGS = Object.freeze({ autoplay: "voice", rate: 0.9 });
const AUTOPLAY_VALUES = ["voice", "always", "off"];
const RATE_VALUES = [0.8, 0.9, 1];

// ---------- 순수 함수 (테스트 가능) ----------

/** 여러 채널을 평균해 모노로 만들고 목표 샘플레이트로 줄인다(선형 보간). */
export function resampleToMono(channels, fromRate, toRate = TARGET_SAMPLE_RATE) {
  const length = channels[0]?.length || 0;
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i += 1) mono[i] += channel[i] / channels.length;
  if (fromRate === toRate) return mono;
  const outLength = Math.floor((length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, length - 1);
    out[i] = mono[index] + (mono[next] - mono[index]) * (position - index);
  }
  return out;
}

/** -1~1 실수 샘플을 16비트 PCM WAV 바이트로 만든다. */
export function encodeWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
  }
  return bytes;
}

/** 한국어 목소리를 고른다. 기기에 내장된 목소리를 먼저 쓴다. */
export function pickKoreanVoice(voices) {
  const korean = (Array.isArray(voices) ? voices : []).filter((voice) => /^ko([-_]|$)/i.test(voice?.lang || ""));
  return korean.find((voice) => voice.localService) || korean[0] || null;
}

/** 135000 → "13만 5천 원"처럼 듣기 쉬운 금액으로 읽는다. */
export function koreanWon(amount) {
  const value = Math.round(Number(amount));
  if (!Number.isFinite(value) || value < 0) return "";
  const man = Math.floor(value / 10000);
  const rest = value % 10000;
  const cheon = Math.floor(rest / 1000);
  const remainder = rest % 1000;
  const parts = [];
  if (man) parts.push(`${man.toLocaleString("ko-KR")}만`);
  if (cheon) parts.push(`${cheon}천`);
  if (remainder || !parts.length) parts.push(String(remainder));
  const last = parts.at(-1);
  return /[만천]$/.test(last) ? `${parts.join(" ")} 원` : `${parts.join(" ")}원`;
}

const monthDay = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return match ? `${Number(match[2])}월 ${Number(match[3])}일` : iso || "";
};

/** 화면용 답변을 읽어 주기 좋은 글로 바꾼다(이모지·기호·링크 제거, 금액·날짜 풀어 읽기). */
export function textForSpeech(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\p{Extended_Pictographic}|️/gu, "")
    .replace(/[*_`#>]/g, "")
    .replace(/(\d{4}-\d{2}-\d{2})/g, (date) => monthDay(date))
    .replace(/(\d+일)\(([일월화수목금토])\)/g, "$1 $2요일")
    .replace(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/g, (_, number) => koreanWon(Number(number.replaceAll(",", ""))))
    .replace(/\s*\/\s*일/g, " 하루에")
    .replace(/\s*~\s*/g, "부터 ")
    .replace(/\s*[·•|]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 대여 승인 카드를 소리로 요약한다. 말로는 승인되지 않는다는 것도 알려 준다. */
export function rentalSummaryForSpeech(action) {
  const title = String(action?.title || "선택하신").replace(/\s*·\s*/g, " ");
  const region = action?.region && !title.includes(action.region) ? ` ${action.region}` : "";
  return [
    `${title}${region} 매물을 ${monthDay(action?.start)}부터 ${monthDay(action?.end)}까지 ${action?.days}일 빌리는 요청이에요.`,
    `대여료는 하루 ${koreanWon(action?.dailyPrice)}, 모두 ${koreanWon(action?.totalPrice)}이에요.`,
    "내용이 맞으면 화면의 승인 버튼을 눌러 주세요. 말로는 승인되지 않아요.",
  ].join(" ");
}

/** 농농 승인 카드(제목과 항목 줄)를 소리로 요약한다. 말로는 승인되지 않는다는 것도 알려 준다. */
export function actionSummaryForSpeech(pending) {
  const title = String(pending?.title || "요청").replace(/\s*확인$/, "");
  const rows = (Array.isArray(pending?.rows) ? pending.rows : []).map(([label, value]) => `${label}, ${textForSpeech(value)}.`);
  return [`${title} 내용이에요.`, ...rows, "내용이 맞으면 화면의 승인 버튼을 눌러 주세요. 말로는 승인되지 않아요."].join(" ");
}

export function loadVoiceSettings(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) || "null");
    if (saved && AUTOPLAY_VALUES.includes(saved.autoplay) && RATE_VALUES.includes(saved.rate)) {
      return { autoplay: saved.autoplay, rate: saved.rate };
    }
  } catch {
    // 저장소를 쓸 수 없거나 값이 망가졌으면 기본값을 쓴다.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveVoiceSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 저장하지 못해도 이번 화면에서는 그대로 쓴다.
  }
}

// ---------- 브라우저 기능 ----------

export function voiceSupport() {
  const w = globalThis;
  return {
    record: Boolean(w.navigator?.mediaDevices?.getUserMedia && w.MediaRecorder && (w.AudioContext || w.webkitAudioContext)),
    recognize: Boolean(w.SpeechRecognition || w.webkitSpeechRecognition),
    speak: Boolean(w.speechSynthesis && w.SpeechSynthesisUtterance),
  };
}

export class VoiceInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function micError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return new VoiceInputError("denied", "마이크 사용이 허용되지 않았어요. 글로 적어 주셔도 돼요.");
  }
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") {
    return new VoiceInputError("no-mic", "마이크를 찾지 못했어요. 글로 적어 주셔도 돼요.");
  }
  return new VoiceInputError("unsupported", "이 기기에서는 녹음을 할 수 없어요. 글로 적어 주셔도 돼요.");
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(binary);
}

/**
 * 녹음을 시작한다. stop()은 { base64, seconds }(16kHz 모노 WAV)를 돌려준다.
 * maxSeconds가 되면 onLimit을 부른다(화면이 stop()을 부른다).
 */
export async function startRecording({ maxSeconds = MAX_RECORD_SECONDS, onTick, onLimit } = {}) {
  let stream;
  try {
    stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    throw micError(error);
  }
  const chunks = [];
  let recorder;
  try {
    recorder = new globalThis.MediaRecorder(stream);
  } catch {
    // 녹음기를 만들 수 없으면 켜 둔 마이크를 바로 끈다.
    stream.getTracks().forEach((track) => track.stop());
    throw new VoiceInputError("unsupported", "이 기기에서는 녹음을 할 수 없어요. 글로 적어 주셔도 돼요.");
  }
  recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) chunks.push(event.data); });
  const started = Date.now();
  const ticker = setInterval(() => {
    const elapsed = (Date.now() - started) / 1000;
    onTick?.(Math.max(0, Math.ceil(maxSeconds - elapsed)));
    if (elapsed >= maxSeconds) onLimit?.();
  }, 250);
  recorder.start(250);
  const release = () => {
    clearInterval(ticker);
    stream.getTracks().forEach((track) => track.stop());
  };

  const stopped = () => new Promise((resolve) => {
    if (recorder.state === "inactive") resolve();
    else {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    }
  });

  return {
    async stop() {
      await stopped();
      release();
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
      const context = new AudioCtx();
      try {
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
        let samples = resampleToMono(channels, audio.sampleRate, TARGET_SAMPLE_RATE);
        if (samples.length > maxSeconds * TARGET_SAMPLE_RATE) samples = samples.subarray(0, maxSeconds * TARGET_SAMPLE_RATE);
        return { base64: toBase64(encodeWav(samples, TARGET_SAMPLE_RATE)), seconds: samples.length / TARGET_SAMPLE_RATE };
      } catch {
        throw new VoiceInputError("decode", "녹음을 읽지 못했어요. 다시 말씀하시거나 글로 적어 주세요.");
      } finally {
        context.close?.().catch?.(() => {});
      }
    },
    cancel() {
      stopped().finally(release);
    },
  };
}

/**
 * 브라우저 음성 인식(서버 인식을 쓸 수 없을 때). 천천히 말하고 쉬어도 끊기지 않게 continuous로 듣는다.
 * stop()은 받아 적은 문장을 돌려준다.
 */
export function startBrowserRecognition({ maxSeconds = MAX_RECORD_SECONDS, onInterim, onLimit, onFailure } = {}) {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) throw new VoiceInputError("unsupported", "이 브라우저에서는 음성 인식을 할 수 없어요. 글로 적어 주셔도 돼요.");
  const recognition = new Recognition();
  recognition.lang = "ko-KR";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  let finalText = "";
  let failure = null;
  let stopping = false;
  const deadline = Date.now() + maxSeconds * 1000;
  let ended;
  const done = new Promise((resolve) => { ended = resolve; });
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0]?.transcript || "";
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    onInterim?.(`${finalText}${interim}`.trim());
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      failure = new VoiceInputError("denied", "마이크 사용이 허용되지 않았어요. 글로 적어 주셔도 돼요.");
    } else if (event.error === "network") {
      failure = new VoiceInputError("network", "인터넷 연결이 불안정해요. 글로 적어 주셔도 돼요.");
    } else if (event.error === "audio-capture") {
      failure = new VoiceInputError("no-mic", "마이크를 찾지 못했어요. 글로 적어 주셔도 돼요.");
    }
    if (failure) onFailure?.(failure);
  };
  // 휴대폰 브라우저는 잠깐만 쉬어도 듣기를 끝낸다. 사용자가 멈추기 전이면 앞의 말은 두고 다시 듣는다.
  recognition.onend = () => {
    if (!stopping && !failure && Date.now() < deadline) {
      try {
        recognition.start();
        return;
      } catch {
        // 다시 시작할 수 없으면 여기서 끝낸다.
      }
    }
    ended();
  };
  const limit = setTimeout(() => onLimit?.(), maxSeconds * 1000);
  recognition.start();
  return {
    async stop() {
      stopping = true;
      clearTimeout(limit);
      try { recognition.stop(); } catch { /* 이미 멈춤 */ }
      await done;
      if (failure) throw failure;
      return finalText.replace(/\s+/g, " ").trim();
    },
    cancel() {
      stopping = true;
      clearTimeout(limit);
      try { recognition.abort(); } catch { /* 이미 멈춤 */ }
    },
  };
}

let koreanVoice = null;

/** 기기의 한국어 목소리를 찾는다(목소리 목록은 늦게 채워질 수 있다). */
export function prepareSpeech(timeoutMs = 1500) {
  const synth = globalThis.speechSynthesis;
  if (!synth) return Promise.resolve(null);
  koreanVoice = pickKoreanVoice(synth.getVoices());
  if (koreanVoice) return Promise.resolve(koreanVoice);
  return new Promise((resolve) => {
    const finish = () => {
      koreanVoice = pickKoreanVoice(synth.getVoices());
      resolve(koreanVoice);
    };
    synth.addEventListener?.("voiceschanged", finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

// 읽는 중인 문장들. 브라우저가 중간에 치우지 않도록 참조를 들고 있는다.
let queue = [];
let primed = false;

/** 사용자가 버튼을 누른 그 순간에 한 번 빈 소리를 내 둔다. 아이폰은 이렇게 해야 나중에 자동으로 읽을 수 있다. */
export function primeSpeech() {
  const synth = globalThis.speechSynthesis;
  if (primed || !synth || !globalThis.SpeechSynthesisUtterance) return;
  primed = true;
  try {
    synth.speak(new globalThis.SpeechSynthesisUtterance(""));
  } catch {
    // 길을 터 두지 못해도 듣기 버튼은 그대로 쓸 수 있다.
  }
}

/** 글을 한국어 목소리로 읽는다. 긴 글이 중간에 끊기지 않게 문장마다 나눠 읽는다. 읽을 수 없으면 false. */
export function speak(text, { rate = DEFAULT_SETTINGS.rate, onStart, onEnd } = {}) {
  const synth = globalThis.speechSynthesis;
  const spoken = textForSpeech(text);
  if (!synth || !globalThis.SpeechSynthesisUtterance || !koreanVoice || !spoken) return false;
  synth.cancel();
  const sentences = spoken.match(/[^.!?。]+[.!?。]*/g)?.map((part) => part.trim()).filter(Boolean) || [spoken];
  const batch = sentences.map((sentence) => new globalThis.SpeechSynthesisUtterance(sentence));
  queue = batch;
  let finished = false;
  const end = () => {
    if (finished) return;
    finished = true;
    if (queue === batch) queue = [];
    onEnd?.();
  };
  batch.forEach((utterance, index) => {
    utterance.voice = koreanVoice;
    utterance.lang = koreanVoice.lang || "ko-KR";
    utterance.rate = rate;
    if (index === 0) utterance.onstart = () => onStart?.();
    utterance.onend = index === batch.length - 1 ? end : () => {};
    utterance.onerror = end;
    synth.speak(utterance);
  });
  return true;
}

export function stopSpeaking() {
  globalThis.speechSynthesis?.cancel();
}

export function hasKoreanVoice() {
  return Boolean(koreanVoice);
}
