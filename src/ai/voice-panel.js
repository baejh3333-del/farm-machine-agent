// 농농이 채팅창의 음성 조작: 마이크 버튼(녹음·인식), 답변 듣기·다시 듣기·멈춤, 자동 읽기 설정.
// 음성 기능이 없거나 실패해도 글 입력과 기존 상담은 그대로 동작한다.
import { $ } from "../core/utils.js";
import { apiFetch } from "../core/store.js";
import {
  hasKoreanVoice,
  loadVoiceSettings,
  MAX_RECORD_SECONDS,
  prepareSpeech,
  rentalSummaryForSpeech,
  saveVoiceSettings,
  speak,
  startBrowserRecognition,
  startRecording,
  stopSpeaking,
  voiceSupport,
} from "./voice.js";

const MIC_LABELS = {
  idle: ["🎤", "말하기", "말로 질문하기"],
  recording: ["⏹", "다 말했어요", "녹음 끝내기"],
  processing: ["⏳", "바꾸는 중", "말씀을 글자로 바꾸는 중"],
};

export function createVoiceControls({ isBusy = () => false } = {}) {
  const input = $("aiInput");
  const mic = $("aiMicButton");
  const status = $("aiVoiceStatus");
  const support = voiceSupport();
  let settings = loadVoiceSettings();
  let mode = "none"; // server | browser | none
  let state = "idle";
  let session = null;
  let voiceOrigin = false;
  let speakingButton = null;

  const say = (text) => { status.textContent = text; };

  function setState(next, remaining) {
    state = next;
    const [icon, label, aria] = MIC_LABELS[next];
    mic.querySelector(".ai-mic-icon").textContent = icon;
    mic.querySelector(".ai-mic-label").textContent = next === "recording" && Number.isFinite(remaining) ? `${label} · ${remaining}초` : label;
    mic.setAttribute("aria-label", aria);
    mic.setAttribute("aria-pressed", String(next === "recording"));
    mic.dataset.state = next;
    mic.disabled = next === "processing";
  }

  async function detectMode() {
    let serverStt = false;
    if (support.record) {
      try {
        serverStt = Boolean((await apiFetch("/api/voice", { timeoutMs: 5000 }))?.serverStt);
      } catch {
        serverStt = false;
      }
    }
    mode = serverStt ? "server" : support.recognize ? "browser" : "none";
    mic.dataset.mode = mode;
  }

  function fillInput(text) {
    const current = input.value.trim();
    input.value = current ? `${current} ${text}` : text;
    voiceOrigin = true;
    input.focus({ preventScroll: true });
    input.setSelectionRange?.(input.value.length, input.value.length);
    say("들은 내용을 확인해 주세요. 틀린 곳은 고친 뒤 ‘전송’을 눌러 주세요.");
  }

  function friendly(error) {
    if (error?.code === "denied" || error?.code === "no-mic" || error?.code === "unsupported" || error?.code === "network" || error?.code === "decode") return error.message;
    if (error?.status === 429) return "음성 입력을 너무 자주 쓰셨어요. 잠시 뒤에 다시 하시거나 글로 적어 주세요.";
    if (error?.status && error.message) return error.message;
    if (error?.name === "AbortError" || error?.name === "TimeoutError") return "시간이 너무 걸려요. 다시 말씀하시거나 글로 적어 주세요.";
    return "인터넷 연결이 불안정해요. 다시 말씀하시거나 글로 적어 주세요.";
  }

  async function begin() {
    if (isBusy()) return;
    stopSpeaking();
    if (mode === "none") {
      say("이 기기에서는 음성 입력을 쓸 수 없어요. 아래 칸에 글로 적어 주세요.");
      input.focus();
      return;
    }
    say("마이크를 준비하고 있어요…");
    const onLimit = () => { if (state === "recording") finish(); };
    try {
      if (mode === "server") {
        session = await startRecording({
          maxSeconds: MAX_RECORD_SECONDS,
          onTick: (remaining) => { if (state === "recording") setState("recording", remaining); },
          onLimit,
        });
      } else {
        session = startBrowserRecognition({
          maxSeconds: MAX_RECORD_SECONDS,
          onInterim: (text) => { if (text) say(`들리는 말: ${text}`); },
          onLimit,
        });
      }
    } catch (error) {
      session = null;
      setState("idle");
      say(friendly(error));
      return;
    }
    setState("recording", MAX_RECORD_SECONDS);
    say(`듣고 있어요. 천천히 말씀하시고, 다 말하면 버튼을 한 번 더 눌러 주세요. 최대 ${MAX_RECORD_SECONDS}초예요.`);
  }

  async function finish() {
    if (state !== "recording" || !session) return;
    const current = session;
    session = null;
    setState("processing");
    say("말씀을 글자로 바꾸고 있어요…");
    try {
      let text;
      if (mode === "server") {
        const { base64 } = await current.stop();
        try {
          text = (await apiFetch("/api/voice", { method: "POST", json: { audio: base64 }, timeoutMs: 25000 }))?.text || "";
        } catch (error) {
          // 서버 인식이 꺼져 있으면 다음부터 브라우저 인식으로 바꾼다.
          if (error?.code === "VOICE_UNAVAILABLE") mode = support.recognize ? "browser" : "none";
          throw error;
        }
      } else {
        text = await current.stop();
      }
      if (text) fillInput(text);
      else say("잘 못 들었어요. 버튼을 누르고 다시 한 번 천천히 말씀해 주세요.");
    } catch (error) {
      say(friendly(error));
    } finally {
      setState("idle");
    }
  }

  function cancel() {
    if (state !== "recording" || !session) return;
    session.cancel();
    session = null;
    setState("idle");
    say("녹음을 멈췄어요.");
  }

  // ---------- 답변 읽어 주기 ----------

  function canSpeak() {
    return support.speak && hasKoreanVoice();
  }

  function markSpeaking(button) {
    if (speakingButton && speakingButton !== button) speakingButton.closest(".ai-speech")?.classList.remove("is-speaking");
    speakingButton = button;
    button?.closest(".ai-speech")?.classList.add("is-speaking");
  }

  function play(text, button) {
    const started = speak(text, {
      rate: settings.rate,
      onStart: () => markSpeaking(button),
      onEnd: () => {
        button?.closest(".ai-speech")?.classList.remove("is-speaking");
        if (button) button.textContent = "🔁 다시 듣기";
      },
    });
    if (!started) say("소리로 읽어 드리지 못했어요. 화면의 글을 봐 주세요.");
    return started;
  }

  /** 답변 말풍선에 듣기·다시 듣기·멈춤 버튼을 단다. 한국어 목소리가 없으면 달지 않는다. */
  function attachSpeech(bubble, text) {
    if (!canSpeak() || !text || bubble.querySelector(".ai-speech")) return null;
    const bar = document.createElement("div");
    bar.className = "ai-speech";
    const listen = document.createElement("button");
    listen.type = "button";
    listen.className = "button button-secondary ai-speech-btn";
    listen.textContent = "🔊 듣기";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "button button-secondary ai-speech-btn ai-speech-stop";
    stop.textContent = "⏸ 멈춤";
    listen.addEventListener("click", () => play(text, listen));
    stop.addEventListener("click", () => {
      stopSpeaking();
      bar.classList.remove("is-speaking");
      listen.textContent = "🔁 다시 듣기";
    });
    bar.append(listen, stop);
    bubble.append(bar);
    return listen;
  }

  /** 설정에 따라 이번 답변을 자동으로 읽는다(말로 물었을 때만 / 항상 / 끄기). */
  function autoSpeak(bubble, text, inputMode) {
    const listen = bubble?.querySelector(".ai-speech-btn");
    if (!listen || settings.autoplay === "off") return;
    if (settings.autoplay === "voice" && inputMode !== "voice") return;
    play(text, listen);
  }

  /** 대여 승인 카드에 음성 안내를 더한다. 말로 한 요청이면 내용 확인을 한 번 더 당부한다. */
  function decorateConfirmation(card, action, inputMode) {
    const summary = rentalSummaryForSpeech(action);
    if (inputMode === "voice") {
      const warn = document.createElement("div");
      warn.className = "ai-rec-notice ai-voice-warning";
      warn.textContent = "🎤 말로 하신 요청이에요. 매물·날짜·금액이 맞는지 꼭 확인해 주세요. 승인은 버튼으로만 돼요.";
      card.insertBefore(warn, card.querySelector(".ai-confirm-actions"));
    }
    if (!canSpeak()) return summary;
    const listen = document.createElement("button");
    listen.type = "button";
    listen.className = "button button-secondary ai-speech-btn";
    listen.textContent = "🔊 요청 내용 듣기";
    listen.addEventListener("click", () => play(summary, listen));
    card.querySelector(".ai-confirm-actions")?.append(listen);
    return summary;
  }

  /** 다음 전송이 음성에서 왔는지 알려 주고 표시를 지운다. */
  function consumeInputMode() {
    const result = voiceOrigin ? "voice" : "text";
    voiceOrigin = false;
    say("");
    return result;
  }

  // ---------- 설정과 초기화 ----------

  function bindSettings() {
    const autoplay = $("aiVoiceAutoplay");
    const rate = $("aiVoiceRate");
    autoplay.value = settings.autoplay;
    rate.value = String(settings.rate);
    autoplay.addEventListener("change", () => {
      settings = { ...settings, autoplay: autoplay.value };
      saveVoiceSettings(settings);
      if (settings.autoplay === "off") stopSpeaking();
    });
    rate.addEventListener("change", () => {
      settings = { ...settings, rate: Number(rate.value) };
      saveVoiceSettings(settings);
    });
  }

  mic.addEventListener("click", () => (state === "recording" ? finish() : begin()));
  mic.addEventListener("keydown", (event) => { if (event.key === "Escape") cancel(); });
  input.addEventListener("input", () => { if (!input.value.trim()) voiceOrigin = false; });
  bindSettings();
  setState("idle");
  const ready = Promise.all([
    detectMode(),
    prepareSpeech().then(() => { $("aiVoiceSettings").hidden = !canSpeak(); }),
  ]).catch(() => {});

  return { ready, attachSpeech, autoSpeak, decorateConfirmation, consumeInputMode, stopSpeaking, cancel, isRecording: () => state !== "idle" };
}
