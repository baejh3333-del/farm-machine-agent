// gpt-live-1 WebRTC 브라우저 클라이언트: 마이크/원격 오디오 + oai-events DataChannel 수명주기.
// 계약: onState("idle"|"connecting"|"listening"|"speaking"|"thinking"), ready/muted/state getter,
// start()/stop()/setMuted()/notifyUiEvent(). start()는 stop()으로 취소되면 AbortError로 reject한다.
import { createLiveVoiceSession } from "./recommend-agent.js";

const GREETING = "한국어로 반갑게 인사하며 어떤 농사일이나 농기계를 찾으시는지 여쭤보고 대답을 기다려 주세요.";
const PROGRESS = "모아농 매물과 기상·호환성 정보를 확인하고 있습니다.";

function abortError() {
  const error = new Error("gpt-live 연결이 취소되었습니다.");
  error.name = "AbortError";
  return error;
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
  history = [],
  createSession = createLiveVoiceSession,
  PeerConnectionCtor = globalThis.RTCPeerConnection,
  getUserMedia = (c) => globalThis.navigator.mediaDevices.getUserMedia(c),
  audioElement = null,
  createAudioElement = defaultAudioElement,
  MediaStreamCtor = globalThis.MediaStream,
  iceTimeoutMs = 2500,
  closeTimeoutMs = 15000,
  onState = () => {},
  onUserTranscriptDelta = () => {},
  onAssistantTranscriptDelta = () => {},
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
  let pendingUserText = "";
  let seq = 0;

  const setState = (next) => { if (state !== next) { state = next; onState(next); } };
  const id = (p) => `${p}_${Date.now()}_${seq++}`;
  const current = (s) => s && session === s && s.gen === gen;

  function send(payload, s = session) {
    if (!s || !s.events || s.events.readyState !== "open") return false;
    try { s.events.send(JSON.stringify(payload)); return true; } catch { return false; }
  }

  function release(s) {
    if (!s || s.released) return;
    s.released = true;
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
    release(s);
    if (session === s) {
      session = null;
      ready = false;
      greeted = false;
      userText = "";
      pendingUserText = "";
      setState("idle");
    }
  }

  async function handleDelegation(s, event) {
    if (event.delegation?.target !== "client") return;
    const delegationId = event.delegation.id;
    if (s.seen.has(delegationId)) return;
    s.seen.add(delegationId);
    const utterance = userText.trim() || pendingUserText;
    pendingUserText = utterance;
    userText = "";
    setState("thinking");
    send({ type: "session.thinking.append", event_id: id("progress"), delegation_id: delegationId, content: PROGRESS }, s);
    let result = {};
    try {
      result = (await onClientDelegation({ delegationId, userText: utterance })) || {};
    } catch (error) {
      if (current(s)) onError(error);
      result = { spokenSummary: "죄송합니다, 확인 중 문제가 생겼습니다. 잠시 후 다시 말씀해 주세요." };
    }
    if (!current(s)) return;
    const { spokenSummary, thinkingContext } = result;
    if (thinkingContext) {
      send({ type: "session.thinking.append", event_id: id("think"), delegation_id: delegationId, content: String(thinkingContext).slice(0, 800) }, s);
    }
    if (spokenSummary) {
      send({ type: "session.commentary.append", event_id: id("result"), delegation_id: delegationId, content: String(spokenSummary).slice(0, 800) }, s);
    }
    if (state === "thinking") setState("listening");
  }

  function handleEvent(s, raw) {
    if (!current(s)) return;
    let event;
    try { event = JSON.parse(typeof raw === "string" ? raw : raw?.data); } catch { return; }
    if (!event || typeof event.type !== "string") return;
    switch (event.type) {
      case "session.started":
        ready = true;
        setState("listening");
        if (muted) send({ type: "session.input_audio.mute", event_id: id("mute") }, s);
        if (!greeted && send({ type: "session.commentary.append", event_id: id("greeting"), delegation_id: null, content: GREETING }, s)) {
          greeted = true;
        }
        break;
      case "session.input_transcript.delta":
        userText += event.delta || "";
        pendingUserText = userText;
        onUserTranscriptDelta({ delta: event.delta || "", text: userText, startMs: event.start_ms, endMs: event.end_ms });
        break;
      case "session.output_transcript.delta":
        if (state !== "thinking") setState("speaking");
        onAssistantTranscriptDelta({ delta: event.delta || "", startMs: event.start_ms, endMs: event.end_ms });
        break;
      case "session.delegation.created":
        handleDelegation(s, event).catch((e) => { if (current(s)) onError(e); });
        break;
      case "session.input_audio.muted":
        muted = true;
        s.stream?.getAudioTracks?.().forEach((t) => { t.enabled = false; });
        break;
      case "session.input_audio.unmuted":
        muted = false;
        s.stream?.getAudioTracks?.().forEach((t) => { t.enabled = true; });
        break;
      case "session.closed":
        s.closing = true;
        s.closeResolve?.();
        teardown(s);
        break;
      case "error":
        onError(new Error(event.error?.message || event.message || "gpt-live 오류"));
        break;
      default:
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
    onError(new Error(message));
    teardown(s);
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
        try { s.audio.play?.()?.catch?.(() => {}); } catch { /* autoplay blocked */ }
      });
      s.connection.addEventListener("connectionstatechange", () => {
        const st = s.connection?.connectionState;
        if (st === "failed" || st === "closed") unexpected(s, "gpt-live 연결이 끊어졌습니다.");
      });
      const stream = await getUserMedia({ audio: true });
      if (!current(s)) { stream?.getTracks?.().forEach((t) => t.stop()); throw abortError(); }
      s.stream = stream;
      stream.getAudioTracks?.().forEach((t) => { t.enabled = !muted; });
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
      const result = await createSession({ sdp: s.connection.localDescription.sdp, region, history });
      check();
      if (!result?.transport?.sdp) throw new Error("gpt-live 세션 응답에 SDP가 없습니다.");
      await s.connection.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
      check();
    } catch (error) {
      const stale = !current(s);
      if (!stale) { onError(error); teardown(s); } else release(s);
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
    return muted;
  }

  function notifyUiEvent(text) {
    if (!text) return false;
    return send({ type: "session.commentary.append", event_id: id("ui"), delegation_id: null, content: String(text).slice(0, 800) });
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
    notifyUiEvent,
    get state() { return state; },
    get ready() { return ready; },
    get muted() { return muted; },
  };
}
