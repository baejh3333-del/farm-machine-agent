// gpt-live-1 WebRTC 브라우저 클라이언트: 마이크/원격 오디오 + oai-events DataChannel 수명주기.
// 계약: onState("idle"|"connecting"|"listening"|"muted"|"speaking"|"thinking"), ready/muted/state getter,
// start()/stop()/setMuted()/notifyUiEvent()/commitPendingTurns(). start()는 stop()으로 취소되면 AbortError로 reject한다.
// onTurnCommitted({ role, text, interrupted?, delegated? }): delegated 턴은 위임 답변을 읽어 준 것이라 패널이 이미 기록했다.
// onClientDelegation({ delegationId, userText, userTurnCommitted }): userTurnCommitted면 그 발화는 이미 커밋됐다.
// onError(error, { fatal, source }): fatal이면 세션은 이미 정리 중이고(source: "start"|"connection"),
// fatal이 아니면 대화는 계속된다(source: "delegation"|"event"|"audio").
import { createLiveVoiceSession } from "./recommend-agent.js";
import { joinSpokenText, tidySpokenText } from "./spoken-text.js";

export const GREETING_TEXT = "안녕하세요, 농농이에요. 대여, 구매, 판매 중에 어떤 걸 도와드릴까요?";
// 연결되자마자 농농이가 먼저 말하게 한다. 사용자가 이미 말하고 있으면 인사를 건너뛴다(말 끊기 방지).
const GREETING = `지금 바로 첫 인사로 "${GREETING_TEXT}" 이 한 문장만 말하고, 사용자의 대답을 기다려 주세요.`;
const CONTINUE_GREETING = "앞선 대화 내용과 조건을 기억한 상태에서, 한 문장으로 짧게 인사하고 이어서 도와드릴 점을 여쭤 주세요.";
// 사용자에게 읽어 주는 말이 아니라 모델에게 주는 진행 상황이다. "확인해볼게요" 같은 중간 안내를 매번 말하지 않게 한다.
const PROGRESS = "백엔드 조회 중이다. 결과가 오기 전에는 '확인해볼게요', '잠시만요' 같은 중간 안내를 하지 말고 조용히 기다린다. 결과가 오면 결과만 짧게 말한다.";

function abortError() {
  const error = new Error("gpt-live 연결이 취소되었습니다.");
  error.name = "AbortError";
  return error;
}

const MIC_ERROR_MESSAGES = {
  NotAllowedError: "마이크 권한이 꺼져 있어요. 주소창 옆 자물쇠 아이콘에서 마이크를 허용해 주세요.",
  SecurityError: "마이크 권한이 꺼져 있어요. 주소창 옆 자물쇠 아이콘에서 마이크를 허용해 주세요.",
  NotFoundError: "연결된 마이크를 찾지 못했어요. 마이크를 확인하시거나 글로 적어 주세요.",
  OverconstrainedError: "연결된 마이크를 찾지 못했어요. 마이크를 확인하시거나 글로 적어 주세요.",
  NotReadableError: "다른 앱이 마이크를 쓰고 있어요. 그 앱을 닫고 다시 눌러 주세요.",
};

// 실시간 음성 시작 실패를 사용자 안내와 처리 방식으로 바꾼다.
// fallback=true면 이 기기에서 실시간 음성을 접고 일반 음성/글 입력으로 넘긴다(서버·WebRTC 문제).
// 마이크 권한·요청 제한·로그인 문제는 일반 음성 입력도 같은 원인으로 막히거나 곧 풀리므로 접지 않는다.
export function describeLiveStartError(error) {
  const name = error?.name || "";
  const status = Number(error?.status) || 0;
  if (MIC_ERROR_MESSAGES[name]) return { reason: "microphone", fallback: false, message: MIC_ERROR_MESSAGES[name] };
  if (error?.code === "AUTH_CHANGED") return { reason: "auth", fallback: false, message: error.message };
  if (status === 429) {
    return { reason: "rate_limited", fallback: false, message: error.message || "요청이 많아요. 잠시 후 다시 시도해 주세요." };
  }
  if (status === 401 || status === 403) {
    return { reason: "auth", fallback: false, message: error.message || "로그인 상태를 확인한 뒤 다시 시도해 주세요." };
  }
  if (name === "AbortError" && !status) {
    return { reason: "timeout", fallback: true, message: "실시간 음성 연결 시간이 초과됐어요." };
  }
  return { reason: "unavailable", fallback: true, message: "지금은 실시간 음성 대화를 쓸 수 없어요." };
}

const CAPTURE = { capture: true };

function defaultGestureTarget() {
  return typeof document !== "undefined" && document?.addEventListener ? document : null;
}

function defaultAudioElement() {
  if (typeof document === "undefined" || !document.createElement) return null;
  const el = document.createElement("audio");
  el.autoplay = true;
  el.setAttribute?.("playsinline", "");
  el.style && (el.style.display = "none");
  document.body?.appendChild(el);
  return el;
}

export function createGptLiveController({
  region,
  voice,
  uiContext = null,
  history = [],
  createSession = createLiveVoiceSession,
  PeerConnectionCtor = globalThis.RTCPeerConnection,
  getUserMedia = (c) => globalThis.navigator.mediaDevices.getUserMedia(c),
  audioElement = null,
  createAudioElement = defaultAudioElement,
  MediaStreamCtor = globalThis.MediaStream,
  gestureTarget = defaultGestureTarget(),
  iceTimeoutMs = 2500,
  closeTimeoutMs = 15000,
  speakingIdleMs = 1500,
  // 사용자의 마지막 음성 전사 뒤 이 시간 안에는 아직 말하는 중으로 본다(그동안 농농이 말을 시작하지 않는다).
  userQuietMs = 700,
  onState = () => {},
  onUserTranscriptDelta = () => {},
  onAssistantTranscriptDelta = () => {},
  onTurnCommitted = () => {},
  onClientDelegation = async () => ({}),
  onError = () => {},
} = {}) {
  let gen = 0;
  let session = null; // { gen, connection, events, stream, audio, ownsAudio, closeResolve, seen:Set }
  let startPromise = null;
  let stopPromise = null;
  let ready = false;
  let greeted = false;
  let muted = false;
  let state = "idle";
  let userText = "";
  let assistantText = "";
  let pendingUserText = "";
  let lastUserCommit = ""; // 마지막으로 기록(커밋)한 사용자 발화: 위임 때 같은 턴을 두 번 남기지 않는다.
  let delegatedReply = false; // 위임 결과를 읽어 주는 중인 발화는 패널이 이미 답변으로 기록했다.
  let speakingTimer = null;
  let seq = 0;
  let lastUserAudioAt = 0; // 마지막 사용자 전사 delta 시각
  let outputSuppressed = false; // 사용자가 끼어든 뒤 남은 농농이 음성은 끈다.
  let speechQueue = []; // 사용자가 말하는 동안 미뤄 둔 commentary
  let speechTimer = null;

  const setState = (next) => { if (state !== next) { state = next; onState(next); } };
  const idleState = () => (muted ? "muted" : "listening");
  // 듣는 중/마이크 꺼짐 사이만 바꾼다. 말하는 중·확인 중일 때는 그 상태를 유지한다.
  const syncIdleState = () => { if (state === "listening" || state === "muted") setState(idleState()); };
  const id = (p) => `${p}_${Date.now()}_${seq++}`;
  const current = (s) => s && session === s && s.gen === gen;

  const userSpeakingNow = () => Boolean(lastUserAudioAt) && Date.now() - lastUserAudioAt < userQuietMs;

  function clearSpeechTimer() {
    if (speechTimer) {
      clearTimeout(speechTimer);
      speechTimer = null;
    }
  }

  // 사용자가 말하는 중이면 농농이가 말할 내용(commentary)을 미뤘다가 말이 끝난 뒤 보낸다.
  function flushSpeechQueue(s) {
    clearSpeechTimer();
    if (!current(s) || !speechQueue.length) return;
    if (userSpeakingNow()) {
      const wait = Math.max(20, userQuietMs - (Date.now() - lastUserAudioAt));
      speechTimer = setTimeout(() => flushSpeechQueue(s), wait);
      speechTimer?.unref?.();
      return;
    }
    const queued = speechQueue;
    speechQueue = [];
    for (const payload of queued) send(payload, s);
  }

  function speakWhenQuiet(payload, s = session) {
    if (!s) return false;
    if (!userSpeakingNow() && !speechQueue.length) return send(payload, s);
    speechQueue.push(payload);
    flushSpeechQueue(s);
    return true;
  }

  function setOutputSuppressed(s, next) {
    outputSuppressed = next;
    if (s?.audio) {
      try { s.audio.muted = next; } catch { /* ignore */ }
    }
  }

  function clearSpeakingTimer() {
    if (speakingTimer) {
      clearTimeout(speakingTimer);
      speakingTimer = null;
    }
  }

  function flushUserTurn() {
    const text = userText.trim();
    userText = "";
    if (text) {
      lastUserCommit = text;
      onTurnCommitted({ role: "user", text });
    }
  }

  function flushAssistantTurn({ interrupted = false } = {}) {
    clearSpeakingTimer();
    const text = tidySpokenText(assistantText);
    assistantText = "";
    if (text) onTurnCommitted({ role: "assistant", text, interrupted, ...(delegatedReply ? { delegated: true } : {}) });
  }

  function scheduleSpeakingIdle(s) {
    clearSpeakingTimer();
    if (!Number.isFinite(speakingIdleMs) || speakingIdleMs <= 0) return;
    speakingTimer = setTimeout(() => {
      speakingTimer = null;
      if (!current(s)) return;
      flushAssistantTurn();
      if (state === "speaking") setState(idleState());
    }, speakingIdleMs);
    speakingTimer?.unref?.();
  }

  function send(payload, s = session) {
    if (!s || !s.events || s.events.readyState !== "open") return false;
    try { s.events.send(JSON.stringify(payload)); return true; } catch { return false; }
  }

  function release(s) {
    if (!s || s.released) return;
    s.released = true;
    clearSpeakingTimer();
    try { s.removeGestureRetry?.(); } catch { /* ignore */ }
    try { s.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { s.events?.close?.(); } catch { /* ignore */ }
    try { s.connection?.close?.(); } catch { /* ignore */ }
    if (s.audio) {
      try { s.audio.pause?.(); } catch { /* ignore */ }
      s.audio.srcObject = null;
      if (s.ownsAudio) { try { s.audio.remove?.(); } catch { /* ignore */ } }
    }
    s.closeResolve?.();
  }

  function teardown(s) {
    const active = session === s;
    if (active) {
      flushUserTurn();
      flushAssistantTurn();
    }
    release(s);
    if (active) {
      clearSpeechTimer();
      speechQueue = [];
      lastUserAudioAt = 0;
      outputSuppressed = false;
      session = null;
      ready = false;
      greeted = false;
      userText = "";
      assistantText = "";
      pendingUserText = "";
      lastUserCommit = "";
      delegatedReply = false;
      setState("idle");
    }
  }

  async function handleDelegation(s, event) {
    if (event.delegation?.target !== "client") return;
    const delegationId = event.delegation.id;
    if (s.seen.has(delegationId)) return;
    s.seen.add(delegationId);
    flushAssistantTurn();
    const utterance = (userText.trim() || pendingUserText).trim();
    // 위임 전에 짧은 맞장구가 먼저 나오면 사용자 발화가 이미 기록됐을 수 있다.
    const userTurnCommitted = Boolean(utterance) && utterance === lastUserCommit;
    pendingUserText = utterance;
    lastUserCommit = utterance; // 패널이 이 발화를 위임 턴으로 기록한다.
    userText = "";
    delegatedReply = true;
    setState("thinking");
    send({ type: "session.thinking.append", event_id: id("progress"), delegation_id: delegationId, content: PROGRESS }, s);
    let result = {};
    try {
      result = (await onClientDelegation({ delegationId, userText: utterance, userTurnCommitted })) || {};
    } catch (error) {
      if (current(s)) onError(error, { fatal: false, source: "delegation" });
      result = { spokenSummary: "죄송합니다, 확인 중 문제가 생겼습니다. 잠시 후 다시 말씀해 주세요." };
    }
    if (!current(s)) return;
    const { spokenSummary, thinkingContext } = result;
    if (thinkingContext) {
      send({ type: "session.thinking.append", event_id: id("think"), delegation_id: delegationId, content: String(thinkingContext).slice(0, 800) }, s);
    }
    if (spokenSummary) {
      // 결과가 늦게 와도 사용자가 말하는 중이면 끝날 때까지 기다렸다가 말한다.
      speakWhenQuiet({ type: "session.commentary.append", event_id: id("result"), delegation_id: delegationId, content: String(spokenSummary).slice(0, 800) }, s);
    }
    if (state === "thinking") setState(idleState());
  }

  function handleEvent(s, raw) {
    if (!current(s)) return;
    let event;
    try { event = JSON.parse(typeof raw === "string" ? raw : raw?.data); } catch { return; }
    if (!event || typeof event.type !== "string") return;
    switch (event.type) {
      case "session.started": {
        ready = true;
        setState(idleState());
        if (muted) send({ type: "session.input_audio.mute", event_id: id("mute") }, s);
        const opening = Array.isArray(history) && history.length > 0 ? CONTINUE_GREETING : GREETING;
        if (!greeted && userSpeakingNow()) {
          greeted = true; // 사용자가 먼저 말을 시작했으면 인사로 끊지 않는다.
        } else if (!greeted && send({ type: "session.commentary.append", event_id: id("greeting"), delegation_id: null, content: opening }, s)) {
          greeted = true;
        }
        break;
      }
      case "session.input_transcript.delta":
        clearSpeakingTimer();
        lastUserAudioAt = Date.now();
        // 사용자가 말을 끊고 들어오면(barge-in) 농농이 소리를 바로 끄고, 직전 발화를 마무리한 뒤 듣는 상태로 바꾼다.
        if (state === "speaking") {
          setOutputSuppressed(s, true);
          flushAssistantTurn({ interrupted: true });
          setState(idleState());
        }
        if (!userText) delegatedReply = false; // 새 사용자 턴: 이후 발화는 위임 답변이 아니다.
        userText += event.delta || "";
        pendingUserText = userText;
        onUserTranscriptDelta({ delta: event.delta || "", text: userText, startMs: event.start_ms, endMs: event.end_ms });
        break;
      case "session.output_transcript.delta":
        if (outputSuppressed) {
          // 사용자가 끼어든 뒤 아직 말하는 중이면 끊긴 발화의 나머지를 버린다. 말이 끝난 뒤의 새 답변은 다시 들린다.
          if (userSpeakingNow()) break;
          setOutputSuppressed(s, false);
        }
        flushUserTurn();
        assistantText = joinSpokenText(assistantText, event.delta || "");
        if (state !== "thinking") setState("speaking");
        onAssistantTranscriptDelta({ delta: event.delta || "", startMs: event.start_ms, endMs: event.end_ms });
        scheduleSpeakingIdle(s);
        break;
      case "session.delegation.created":
        handleDelegation(s, event).catch((e) => { if (current(s)) onError(e, { fatal: false, source: "delegation" }); });
        break;
      case "session.input_audio.muted":
        muted = true;
        s.stream?.getAudioTracks?.().forEach((t) => { t.enabled = false; });
        syncIdleState();
        break;
      case "session.input_audio.unmuted":
        muted = false;
        s.stream?.getAudioTracks?.().forEach((t) => { t.enabled = true; });
        syncIdleState();
        break;
      case "session.closed":
        s.closing = true;
        s.closeResolve?.();
        teardown(s);
        break;
      case "error":
        // 서버 error 이벤트는 대개 한 요청만 실패한 것이다. 세션이 끝나면 session.closed/채널 종료로 따로 정리된다.
        onError(new Error(event.error?.message || event.message || "gpt-live 오류"), { fatal: false, source: "event" });
        break;
      default:
        console.debug?.("gpt_live_event", event.type);
    }
  }

  function waitIce(s) {
    const pc = s.connection;
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, iceTimeoutMs);
      function done() {
        clearTimeout(timer);
        pc.removeEventListener?.("icegatheringstatechange", check);
        resolve();
      }
      function check() { if (pc.iceGatheringState === "complete") done(); }
      s.abortIce = done;
      pc.addEventListener?.("icegatheringstatechange", check);
    });
  }

  function unexpected(s, message) {
    if (!current(s) || s.closing) return;
    onError(new Error(message), { fatal: true, source: "connection" });
    teardown(s);
  }

  // 자동 재생이 막히면(아이폰 Safari 등) 소리 없이 대화가 이어지므로, 다음 터치/키 입력 때 다시 재생한다.
  function playRemoteAudio(s) {
    let playing;
    try { playing = s.audio.play?.(); } catch { return; }
    playing?.catch?.((error) => {
      if (!current(s) || error?.name !== "NotAllowedError" || s.removeGestureRetry) return;
      if (gestureTarget?.addEventListener) {
        const retry = () => {
          s.removeGestureRetry?.();
          if (current(s) && s.audio) {
            try { s.audio.play?.()?.catch?.(() => {}); } catch { /* ignore */ }
          }
        };
        s.removeGestureRetry = () => {
          gestureTarget.removeEventListener?.("pointerdown", retry, CAPTURE);
          gestureTarget.removeEventListener?.("keydown", retry, CAPTURE);
          s.removeGestureRetry = () => {};
        };
        gestureTarget.addEventListener("pointerdown", retry, CAPTURE);
        gestureTarget.addEventListener("keydown", retry, CAPTURE);
      }
      onError(new Error("농농이 목소리가 자동으로 재생되지 않았어요. 화면을 한 번 눌러 주세요."), { fatal: false, source: "audio" });
    });
  }

  async function doStart() {
    const myGen = ++gen;
    const s = {
      gen: myGen, connection: null, events: null, stream: null, audio: null, ownsAudio: false,
      closeResolve: null, closing: false, released: false, seen: new Set(),
    };
    session = s;
    setState("connecting");
    const check = () => { if (!current(s)) throw abortError(); };
    try {
      s.connection = new PeerConnectionCtor();
      s.audio = audioElement || createAudioElement?.() || null;
      s.ownsAudio = Boolean(s.audio) && !audioElement;
      s.connection.addEventListener("track", (e) => {
        if (!current(s) || !s.audio) return;
        s.audio.autoplay = true;
        s.audio.srcObject = e.streams?.[0] || (e.track && MediaStreamCtor ? new MediaStreamCtor([e.track]) : null);
        playRemoteAudio(s);
      });
      s.connection.addEventListener("connectionstatechange", () => {
        const st = s.connection?.connectionState;
        if (st === "failed" || st === "closed") unexpected(s, "gpt-live 연결이 끊어졌습니다.");
      });
      let stream;
      try {
        stream = await getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        if (err?.name !== "OverconstrainedError") throw err;
        stream = await getUserMedia({ audio: true });
      }
      if (!current(s)) { stream?.getTracks?.().forEach((t) => t.stop()); throw abortError(); }
      s.stream = stream;
      stream.getAudioTracks?.().forEach((t) => {
        t.enabled = !muted;
        t.addEventListener?.("ended", () => unexpected(s, "마이크 연결이 끊어졌어요. 마이크를 확인하고 다시 눌러 주세요."));
      });
      stream.getTracks().forEach((track) => s.connection.addTrack(track, stream));
      s.events = s.connection.createDataChannel("oai-events");
      s.events.addEventListener("message", (e) => handleEvent(s, e.data));
      s.events.addEventListener("close", () => unexpected(s, "gpt-live 데이터 채널이 닫혔습니다."));
      const offer = await s.connection.createOffer();
      check();
      await s.connection.setLocalDescription(offer);
      check();
      await waitIce(s);
      check();
      const result = await createSession({ sdp: s.connection.localDescription.sdp, region, voice, uiContext, history });
      check();
      if (!result?.transport?.sdp) throw new Error("gpt-live 세션 응답에 SDP가 없습니다.");
      await s.connection.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
      check();
    } catch (error) {
      const stale = !current(s);
      if (!stale) { onError(error, { fatal: true, source: "start" }); teardown(s); } else release(s);
      throw error;
    }
  }

  function start() {
    if (startPromise) return startPromise;
    if (session && !stopPromise) return Promise.resolve();
    const run = async () => {
      if (stopPromise) await stopPromise;
      await doStart();
    };
    startPromise = run().finally(() => { startPromise = null; });
    return startPromise;
  }

  function setMuted(next) {
    muted = Boolean(next);
    session?.stream?.getAudioTracks?.().forEach((t) => { t.enabled = !muted; });
    send({ type: muted ? "session.input_audio.mute" : "session.input_audio.unmute", event_id: id("mute") });
    if (session) syncIdleState();
    return muted;
  }

  // 진행 중인 사용자/어시스턴트 발화를 지금 기록한다(목소리 변경·종료 직전에 대화 기억을 잃지 않게).
  function commitPendingTurns() {
    if (!session) return;
    flushUserTurn();
    flushAssistantTurn({ interrupted: state === "speaking" });
  }

  function notifyUiEvent(text) {
    if (!text) return false;
    return speakWhenQuiet({ type: "session.commentary.append", event_id: id("ui"), delegation_id: null, content: String(text).slice(0, 800) });
  }

  function stop() {
    if (stopPromise) return stopPromise;
    const s = session;
    if (!s) return Promise.resolve();
    stopPromise = (async () => {
      s.closing = true;
      const graceful = ready && send({ type: "session.close" }, s);
      if (graceful) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, closeTimeoutMs);
          s.closeResolve = () => { clearTimeout(timer); resolve(); };
        });
      }
      gen += 1; // 진행 중인 start/delegation 응답을 모두 무효화
      s.abortIce?.();
      teardown(s);
    })().finally(() => { stopPromise = null; });
    // 연결 중이면 즉시 무효화해 대기 중인 await가 자원을 정리하게 한다.
    if (!ready) { gen += 1; s.abortIce?.(); teardown(s); }
    return stopPromise;
  }

  return {
    start,
    stop,
    setMuted,
    commitPendingTurns,
    notifyUiEvent,
    get state() { return state; },
    get ready() { return ready; },
    get muted() { return muted; },
  };
}
