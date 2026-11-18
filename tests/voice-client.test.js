import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_LIVE_VOICE,
  encodeWav,
  koreanWon,
  LIVE_VOICE_OPTIONS,
  loadLiveVoicePreference,
  loadVoiceSettings,
  pickKoreanVoice,
  rentalSummaryForSpeech,
  resampleToMono,
  saveLiveVoicePreference,
  saveVoiceSettings,
  textForSpeech,
  actionSummaryForSpeech,
  prepareSpeech,
  primeSpeech,
  speak,
  startBrowserRecognition,
  startRecording,
} from "../src/ai/voice.js";
import { parseWav } from "../server/voice.js";

test("브라우저 녹음을 16kHz 모노 16비트 WAV로 만들면 서버 검사를 통과한다", () => {
  const left = new Float32Array(48000).map((_, i) => Math.sin(i / 10));
  const right = new Float32Array(48000).map((_, i) => Math.sin(i / 10));
  const mono = resampleToMono([left, right], 48000, 16000);
  assert.equal(mono.length, 16000);
  const bytes = encodeWav(mono, 16000);
  const info = parseWav(Buffer.from(bytes));
  assert.equal(info.sampleRate, 16000);
  assert.equal(info.channels, 1);
  assert.equal(Math.round(info.seconds), 1);
});

test("WAV 변환은 -1~1 밖의 값을 잘라서 넘치지 않게 한다", () => {
  const bytes = encodeWav(new Float32Array([2, -2, 0.5]), 16000);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getInt16(44, true), 32767);
  assert.equal(view.getInt16(46, true), -32768);
  assert.equal(view.getInt16(48, true), Math.round(0.5 * 32767));
});

test("한국어 목소리를 고르고, 없으면 null", () => {
  const voices = [
    { name: "English", lang: "en-US", default: true },
    { name: "Yuna", lang: "ko-KR", localService: true },
    { name: "Google 한국의", lang: "ko-KR", localService: false },
  ];
  assert.equal(pickKoreanVoice(voices).name, "Yuna");
  assert.equal(pickKoreanVoice([{ name: "x", lang: "ko_KR" }]).name, "x");
  assert.equal(pickKoreanVoice([{ name: "English", lang: "en-US" }]), null);
  assert.equal(pickKoreanVoice(undefined), null);
});

test("금액은 시니어가 듣기 쉬운 만·천 단위로 읽는다", () => {
  assert.equal(koreanWon(135000), "13만 5천 원");
  assert.equal(koreanWon(45000), "4만 5천 원");
  assert.equal(koreanWon(1200000), "120만 원");
  assert.equal(koreanWon(800), "800원");
  assert.equal(koreanWon(10500), "1만 500원");
});

test("읽어 줄 글에서 이모지·기호·링크를 빼고 금액·날짜를 읽기 쉽게 바꾼다", () => {
  const text = textForSpeech("🚜 조건에 맞는 매물 2개! **45,000원**/일 · 2026-11-20 ~ 2026-11-22 https://x.y/z");
  assert.doesNotMatch(text, /🚜|\*|https?:/);
  assert.match(text, /4만 5천 원/);
  assert.match(text, /11월 20일/);
  assert.match(text, /11월 22일/);
});

test("대여 확인 카드를 음성 요약으로 바꾸고, \"네\"라고 하면 바로 신청한다고 말한다", () => {
  const summary = rentalSummaryForSpeech({
    title: "아세아텍 AMC-900 · 영양읍", region: "영양읍", start: "2026-11-20", end: "2026-11-22", days: 3, dailyPrice: 45000, totalPrice: 135000,
  });
  assert.match(summary, /아세아텍 AMC-900/);
  assert.match(summary, /11월 20일부터 11월 22일까지 3일/);
  assert.match(summary, /하루 4만 5천 원/);
  assert.match(summary, /모두 13만 5천 원/);
  assert.match(summary, /"네"라고 말씀해 주세요\. 바로 신청해 드릴게요\./);
  assert.doesNotMatch(summary, /승인 버튼|말로는 승인되지/);
});

test("음성 설정은 기본값(말했을 때만 자동 재생, 조금 느리게)을 쓰고 저장소가 없어도 깨지지 않는다", () => {
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  assert.deepEqual(loadVoiceSettings(storage), { autoplay: "voice", rate: 0.9 });
  saveVoiceSettings({ autoplay: "off", rate: 1 }, storage);
  assert.deepEqual(loadVoiceSettings(storage), { autoplay: "off", rate: 1 });
  memory.set("nongnong.voice", "{망가진 값");
  assert.deepEqual(loadVoiceSettings(storage), { autoplay: "voice", rate: 0.9 });
  memory.set("nongnong.voice", JSON.stringify({ autoplay: "loud", rate: 5 }));
  assert.deepEqual(loadVoiceSettings(storage), { autoplay: "voice", rate: 0.9 });
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(loadVoiceSettings(throwing), { autoplay: "voice", rate: 0.9 });
  assert.doesNotThrow(() => saveVoiceSettings({ autoplay: "off", rate: 1 }, throwing));
});

test("농농 확인 카드 요약: 날짜·요일·금액을 풀어 읽고, \"네\"라고 하면 바로 진행한다고 알려 준다", () => {
  const spoken = actionSummaryForSpeech({
    title: "대여 예약 확인",
    rows: [
      ["기계", "대동 트랙터 RX"],
      ["기간", "11월 17일(화) ~ 11월 18일(수) · 2일"],
      ["내야 하는 돈", "180,000원 (하루 90,000원)"],
    ],
  });
  assert.equal(
    spoken,
    "대여 예약 내용이에요. 기계, 대동 트랙터 RX. 기간, 11월 17일 화요일부터 11월 18일 수요일, 2일. 내야 하는 돈, 18만 원 (하루 9만 원). 맞으면 \"네\"라고 말씀해 주세요. 바로 진행해 드릴게요.",
  );
  assert.equal(textForSpeech("(3일) 11월 1일(일)"), "(3일) 11월 1일 일요일");
});

// ───────────── 브라우저 기능을 흉내 내어 녹음·인식·읽기의 실패 상황을 확인한다 ─────────────

function withGlobals(values, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const restore = () => {
    for (const [key, desc] of Object.entries(saved)) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

test("녹음기를 만들 수 없으면 마이크를 바로 끄고 알기 쉬운 오류를 낸다", async () => {
  let stoppedTracks = 0;
  const stream = { getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] };
  await withGlobals({
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    MediaRecorder: class { constructor() { throw new Error("no codec"); } },
  }, async () => {
    await assert.rejects(startRecording({ maxSeconds: 30 }), (error) => error.code === "unsupported");
  });
  assert.equal(stoppedTracks, 1);
});

class FakeRecognition {
  static instances = [];
  constructor() { FakeRecognition.instances.push(this); this.starts = 0; }
  start() { this.starts += 1; }
  stop() { setTimeout(() => this.onend?.(), 0); }
  abort() { setTimeout(() => this.onend?.(), 0); }
  say(text, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
  }
}

test("브라우저 인식: 말하다 쉬어서 끊겨도 다시 듣고, 앞에서 들은 말은 지키다", async () => {
  FakeRecognition.instances = [];
  await withGlobals({ SpeechRecognition: FakeRecognition }, async () => {
    const session = startBrowserRecognition({ maxSeconds: 30 });
    const rec = FakeRecognition.instances[0];
    rec.say("관리기 ");
    rec.onend(); // 잠깐 쉬어서 브라우저가 스스로 끝냄
    assert.equal(rec.starts, 2);
    rec.say("빌릴라꼬예");
    assert.equal(await session.stop(), "관리기 빌릴라꼬예");
  });
});

test("브라우저 인식: 마이크가 막히면 기다리지 않고 바로 알린다", async () => {
  FakeRecognition.instances = [];
  await withGlobals({ SpeechRecognition: FakeRecognition }, async () => {
    const failures = [];
    startBrowserRecognition({ maxSeconds: 30, onFailure: (error) => failures.push(error.code) });
    const rec = FakeRecognition.instances[0];
    rec.onerror({ error: "not-allowed" });
    rec.onend();
    assert.deepEqual(failures, ["denied"]);
    assert.equal(rec.starts, 1);
  });
});

function fakeSynth() {
  const spoken = [];
  return {
    spoken,
    getVoices: () => [{ lang: "ko-KR", name: "Yuna" }],
    cancel() {},
    speak(utterance) { spoken.push(utterance); },
  };
}

test("읽기: 긴 글은 문장마다 나눠 읽고, 마지막 문장이 끝나야 끝났다고 알린다", async () => {
  const synth = fakeSynth();
  await withGlobals({ speechSynthesis: synth, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } }, async () => {
    await prepareSpeech();
    let ended = 0;
    assert.equal(speak("트랙터를 찾았어요. 하루 90,000원이에요! 예약할까요?", { onEnd: () => { ended += 1; } }), true);
    assert.deepEqual(synth.spoken.map((u) => u.text), ["트랙터를 찾았어요.", "하루 9만 원이에요!", "예약할까요?"]);
    synth.spoken[0].onend();
    synth.spoken[1].onend();
    assert.equal(ended, 0);
    synth.spoken[2].onend();
    assert.equal(ended, 1);
  });
});

test("읽기 준비: 사용자가 누를 때 한 번만 빈 소리로 길을 터 둔다(아이폰 자동 읽기)", async () => {
  const synth = fakeSynth();
  await withGlobals({ speechSynthesis: synth, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } }, async () => {
    primeSpeech();
    primeSpeech();
    assert.equal(synth.spoken.length, 1);
    assert.equal(synth.spoken[0].text, "");
  });
});


// ---- createGptLiveController ----
const { createGptLiveController, describeLiveStartError } = await import("../src/ai/gpt-live.js");
const { liveSessionHistory } = await import("../src/ai/recommend-agent.js");

function makeAudio() {
  return { autoplay: false, srcObject: null, paused: false, pause() { this.paused = true; } };
}

function makeLive(overrides = {}) {
  const sent = [];
  const listeners = {};
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const channel = {
    readyState: overrides.channelState || "open",
    send: (s) => sent.push(JSON.parse(s)),
    addEventListener: (t, f) => { listeners[t] = f; },
    close() { channel.closedByClient = true; },
  };
  const order = [];
  class FakePC {
    constructor() { order.push("new"); this.iceGatheringState = "complete"; this.localDescription = { sdp: "offer-sdp" }; this.closed = false; FakePC.last = this; }
    addEventListener(t, f) { order.push(`listen:${t}`); (this.handlers ||= {})[t] = f; }
    removeEventListener() {}
    addTrack() { order.push("addTrack"); }
    createDataChannel(name) { order.push(`dc:${name}`); return channel; }
    async createOffer() { order.push("offer"); return { type: "offer", sdp: "offer-sdp" }; }
    async setLocalDescription() { order.push("setLocal"); }
    async setRemoteDescription(d) { order.push("setRemote"); this.remote = d; }
    close() { this.closed = true; }
  }
  const calls = { session: [], states: [], user: [], assistant: [], delegations: [] };
  const live = createGptLiveController({
    region: "영양읍",
    history: [{ role: "user", content: "hi" }],
    PeerConnectionCtor: FakePC,
    getUserMedia: overrides.getUserMedia || (async () => stream),
    createSession: async (a) => { calls.session.push(a); return { transport: { sdp: "answer-sdp" } }; },
    onState: (s) => calls.states.push(s),
    onUserTranscriptDelta: (e) => calls.user.push(e),
    onAssistantTranscriptDelta: (e) => calls.assistant.push(e),
    onClientDelegation: async (a) => { calls.delegations.push(a); return { spokenSummary: "요약", thinkingContext: "맥락" }; },
    audioElement: overrides.audioElement === undefined ? makeAudio() : overrides.audioElement,
    closeTimeoutMs: 50,
    // 가짜 이벤트는 사이에 침묵 없이 바로 이어 오므로, 기본은 "말 끝남" 판정을 바로 한다. 문제1 테스트만 따로 준다.
    userQuietMs: 0,
    ...overrides,
  });
  const emit = (e) => listeners.message({ data: JSON.stringify(e) });
  return { live, sent, emit, track, order, calls, FakePC, channel, listeners, stream };
}

test("gpt-live streamless remote track plays and server close releases microphone", async () => {
  const audio = makeAudio();
  class Stream { constructor(tracks) { this.tracks = tracks; } }
  const { live, emit, track, FakePC } = makeLive({ audioElement: audio, MediaStreamCtor: Stream });
  await live.start();
  const remoteTrack = { kind: "audio" };
  FakePC.last.handlers.track({ streams: [], track: remoteTrack });
  assert.deepEqual(audio.srcObject.tracks, [remoteTrack]);
  emit({ type: "session.started" });
  emit({ type: "session.closed" });
  assert.equal(live.state, "idle");
  assert.equal(track.stopped, true);
  assert.equal(audio.srcObject, null);
});

test("gpt-live 연결 순서: 데이터채널은 offer보다 먼저, 응답 SDP를 적용한다", async () => {
  const { live, order, calls, FakePC } = makeLive();
  await live.start();
  assert.ok(order.indexOf("dc:oai-events") < order.indexOf("offer"));
  assert.ok(order.indexOf("addTrack") < order.indexOf("dc:oai-events"));
  assert.equal(calls.session[0].sdp, "offer-sdp");
  assert.equal(calls.session[0].region, "영양읍");
  assert.deepEqual(FakePC.last.remote, { type: "answer", sdp: "answer-sdp" });
});

test("gpt-live session.started는 인사를 한 번만 보낸다", async () => {
  const { live, sent, emit, calls } = makeLive();
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.started" });
  assert.equal(live.ready, true);
  assert.equal(calls.states.at(-1), "listening");
  const greetings = sent.filter((m) => m.type === "session.commentary.append");
  assert.equal(greetings.length, 1);
  assert.equal(greetings[0].delegation_id, null);
});

test("gpt-live 전사 delta를 누적해 전달한다", async () => {
  const { live, emit, calls } = makeLive();
  await live.start();
  emit({ type: "session.input_transcript.delta", delta: "트랙터 ", start_ms: 0, end_ms: 10 });
  emit({ type: "session.input_transcript.delta", delta: "찾아줘", start_ms: 10, end_ms: 20 });
  assert.equal(calls.user[1].text, "트랙터 찾아줘");
  assert.equal(calls.user[1].startMs, 10);
  emit({ type: "session.output_transcript.delta", delta: "네", start_ms: 1, end_ms: 2 });
  assert.deepEqual(calls.assistant[0], { delta: "네", startMs: 1, endMs: 2 });
});

test("gpt-live client delegation은 thinking → 결과 commentary 순으로 응답한다", async () => {
  const { live, sent, emit, calls } = makeLive();
  await live.start();
  emit({ type: "session.input_transcript.delta", delta: "트랙터" });
  emit({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls.delegations, [{ delegationId: "d1", userText: "트랙터", userTurnCommitted: false }]);
  const types = sent.map((m) => `${m.type}:${m.delegation_id}`);
  assert.deepEqual(types, [
    "session.thinking.append:d1",
    "session.thinking.append:d1",
    "session.commentary.append:d1",
  ]);
  assert.equal(sent[2].content, "요약");
});

test("gpt-live server 대상 delegation은 무시한다", async () => {
  const { live, sent, emit, calls } = makeLive();
  await live.start();
  emit({ type: "session.delegation.created", delegation: { id: "d2", target: "server" } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 0);
  assert.equal(calls.delegations.length, 0);
});

test("gpt-live mute/unmute와 UI 이벤트 전달", async () => {
  const { live, sent, track } = makeLive();
  await live.start();
  live.setMuted(true);
  assert.equal(track.enabled, false);
  assert.equal(sent.at(-1).type, "session.input_audio.mute");
  live.setMuted(false);
  assert.equal(track.enabled, true);
  assert.equal(sent.at(-1).type, "session.input_audio.unmute");
  live.notifyUiEvent("예약이 확정되었습니다");
  assert.equal(sent.at(-1).type, "session.commentary.append");
  assert.equal(sent.at(-1).content, "예약이 확정되었습니다");
});

test("gpt-live stop은 session.close 후 마이크와 연결을 정리한다", async () => {
  const { live, sent, emit, track, FakePC } = makeLive();
  await live.start();
  const pc = FakePC.last;
  emit({ type: "session.started" });
  const stopping = live.stop();
  emit({ type: "session.closed" });
  await stopping;
  assert.equal(sent.at(-1).type, "session.close");
  assert.equal(track.stopped, true);
  assert.equal(pc.closed, true);
  assert.equal(live.state, "idle");
});


test("gpt-live 원격 오디오를 audio 요소에 연결하고 정리한다", async () => {
  const audio = makeAudio();
  const { live, FakePC } = makeLive({ audioElement: audio });
  await live.start();
  const remote = { id: "remote" };
  FakePC.last.handlers.track({ streams: [remote] });
  assert.equal(audio.srcObject, remote);
  assert.equal(audio.autoplay, true);
  await live.stop();
  assert.equal(audio.srcObject, null);
  assert.equal(audio.paused, true);
});

test("gpt-live 기본 audio 요소를 직접 만들고 stop 때 제거한다", async () => {
  let removed = false;
  const owned = { autoplay: false, srcObject: null, pause() {}, remove() { removed = true; } };
  const { live, FakePC } = makeLive({ audioElement: null, createAudioElement: () => owned });
  await live.start();
  FakePC.last.handlers.track({ streams: ["s"] });
  assert.equal(owned.srcObject, "s");
  await live.stop();
  assert.equal(removed, true);
});

test("gpt-live 채널이 open이 아니면 전송하지 않는다", async () => {
  const { live, sent, emit } = makeLive({ channelState: "connecting" });
  await live.start();
  emit({ type: "session.started" });
  assert.equal(live.notifyUiEvent("안내"), false);
  live.setMuted(true);
  assert.equal(sent.length, 0);
  assert.equal(live.muted, true);
});

test("gpt-live getUserMedia 중 stop하면 마이크를 정리하고 연결을 취소한다", async () => {
  let resolveMedia;
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const { live, FakePC, calls } = makeLive({ getUserMedia: () => new Promise((r) => { resolveMedia = r; }) });
  const starting = live.start();
  const rejected = assert.rejects(starting, { name: "AbortError" });
  await live.stop();
  resolveMedia(stream);
  await rejected;
  assert.equal(track.stopped, true);
  assert.equal(FakePC.last.closed, true);
  assert.equal(calls.session.length, 0);
  assert.equal(live.state, "idle");
});

test("gpt-live SDP 요청 중 stop하면 늦은 응답을 적용하지 않는다", async () => {
  let resolveSession;
  const { live, FakePC, track } = makeLive({ createSession: () => new Promise((r) => { resolveSession = r; }) });
  const starting = live.start();
  const rejected = assert.rejects(starting, { name: "AbortError" });
  await new Promise((r) => setTimeout(r, 5));
  await live.stop();
  resolveSession({ transport: { sdp: "late" } });
  await rejected;
  assert.equal(FakePC.last.remote, undefined);
  assert.equal(track.stopped, true);
});

test("gpt-live 중복 delegation은 한 번만 실행한다", async () => {
  const { live, emit, calls } = makeLive();
  await live.start();
  const e = { type: "session.delegation.created", delegation: { id: "dup", target: "client" } };
  emit(e); emit(e);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.delegations.length, 1);
});

test("gpt-live stop 뒤 늦은 delegation 응답은 전송하지 않는다", async () => {
  let release;
  const { live, sent, emit } = makeLive({ onClientDelegation: () => new Promise((r) => { release = r; }) });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.delegation.created", delegation: { id: "late", target: "client" } });
  const before = sent.length;
  const stopping = live.stop();
  emit({ type: "session.closed" });
  await stopping;
  release({ spokenSummary: "늦은 응답" });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.some((m) => m.content === "늦은 응답"), false);
  assert.ok(sent.length >= before);
});

test("gpt-live 예기치 않은 채널 종료 시 정리하고 오류를 알린다", async () => {
  const errors = [];
  const { live, listeners, track, FakePC } = makeLive({ onError: (e) => errors.push(e) });
  await live.start();
  listeners.close();
  assert.equal(live.state, "idle");
  assert.equal(live.ready, false);
  assert.equal(track.stopped, true);
  assert.equal(FakePC.last.closed, true);
  assert.equal(errors.length, 1);
});

test("gpt-live 피어 연결이 failed가 되면 정리한다", async () => {
  const { live, FakePC, track } = makeLive();
  await live.start();
  FakePC.last.connectionState = "failed";
  FakePC.last.handlers.connectionstatechange();
  assert.equal(live.state, "idle");
  assert.equal(track.stopped, true);
});

function httpError(status, code, message = "서버 오류") {
  return Object.assign(new Error(message), { status, code });
}

function namedError(name, message = name) {
  return Object.assign(new Error(message), { name });
}

test("gpt-live 시작 실패 분류: 서버·WebRTC 문제만 일반 음성 입력으로 넘긴다", () => {
  for (const error of [
    httpError(502, "LIVE_SESSION_FAILED"),
    httpError(503, "LIVE_UNAVAILABLE"),
    httpError(400, "INVALID_SDP"),
    httpError(504, "LIVE_TIMEOUT"),
    new Error("gpt-live 세션 응답에 SDP가 없습니다."),
    namedError("InvalidAccessError"),
  ]) {
    const failure = describeLiveStartError(error);
    assert.equal(failure.fallback, true, `${error.status || error.name} should fall back`);
    assert.equal(failure.reason, "unavailable");
    assert.match(failure.message, /실시간 음성/);
  }
  const timeout = describeLiveStartError(namedError("AbortError", "signal is aborted without reason"));
  assert.deepEqual([timeout.reason, timeout.fallback], ["timeout", true]);
  assert.doesNotMatch(timeout.message, /signal/);

  const denied = describeLiveStartError(namedError("NotAllowedError", "Permission denied"));
  assert.deepEqual([denied.reason, denied.fallback], ["microphone", false]);
  assert.match(denied.message, /마이크 권한/);
  assert.equal(describeLiveStartError(namedError("NotFoundError")).reason, "microphone");

  const limited = describeLiveStartError(httpError(429, "RATE_LIMITED", "요청이 너무 많아요."));
  assert.deepEqual([limited.reason, limited.fallback, limited.message], ["rate_limited", false, "요청이 너무 많아요."]);
  assert.equal(describeLiveStartError(httpError(401, "UNAUTHORIZED")).fallback, false);
});

test("gpt-live 세션 생성이 502면 오류를 한 번만 알리고 마이크·연결을 정리한다", async () => {
  const errors = [];
  const failure = httpError(502, "LIVE_SESSION_FAILED", "실시간 음성 대화를 시작하지 못했어요.");
  const { live, track, FakePC, calls } = makeLive({
    createSession: async () => { throw failure; },
    onError: (error, info) => errors.push({ error, info }),
  });
  await assert.rejects(live.start(), failure);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, failure);
  assert.deepEqual(errors[0].info, { fatal: true, source: "start" });
  assert.equal(track.stopped, true);
  assert.equal(FakePC.last.closed, true);
  assert.equal(live.state, "idle");
  assert.deepEqual(calls.states, ["connecting", "idle"]);
  await live.stop();
  assert.equal(errors.length, 1);
});

test("gpt-live 마이크 권한 거부는 세션 요청 없이 정리한다", async () => {
  const errors = [];
  const { live, FakePC, calls } = makeLive({
    getUserMedia: async () => { throw namedError("NotAllowedError", "Permission denied"); },
    onError: (error, info) => errors.push({ error, info }),
  });
  await assert.rejects(live.start(), { name: "NotAllowedError" });
  assert.equal(calls.session.length, 0);
  assert.equal(FakePC.last.closed, true);
  assert.deepEqual(errors.map((e) => e.info), [{ fatal: true, source: "start" }]);
  assert.equal(live.state, "idle");
});

test("gpt-live 위임 처리 실패는 대화를 끊지 않고 음성으로 사과한다", async () => {
  const errors = [];
  const { live, sent, emit } = makeLive({
    onClientDelegation: async () => { throw httpError(500, "AGENT_FAILED", "농농이 응답 실패"); },
    onError: (error, info) => errors.push({ error, info }),
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "트랙터" });
  emit({ type: "session.delegation.created", delegation: { id: "d-fail", target: "client" } });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(errors.map((e) => e.info), [{ fatal: false, source: "delegation" }]);
  const apology = sent.filter((m) => m.type === "session.commentary.append" && m.delegation_id === "d-fail");
  assert.equal(apology.length, 1);
  assert.match(apology[0].content, /죄송해요/);
  assert.match(apology[0].content, /한 번 더 해 주시면 바로 다시 할게요/);
  assert.equal(live.ready, true);
  assert.equal(live.state, "listening");
});

test("gpt-live 서버 error 이벤트는 치명적이지 않은 오류로 알리고 세션을 유지한다", async () => {
  const errors = [];
  const { live, emit, track } = makeLive({ onError: (error, info) => errors.push({ error, info }) });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "error", error: { message: "invalid event" } });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error.message, "invalid event");
  assert.deepEqual(errors[0].info, { fatal: false, source: "event" });
  assert.equal(live.ready, true);
  assert.equal(track.stopped, false);
});

test("gpt-live 예기치 않은 연결 종료는 치명적 오류로 알린다", async () => {
  const errors = [];
  const { live, listeners } = makeLive({ onError: (error, info) => errors.push(info) });
  await live.start();
  listeners.close();
  assert.deepEqual(errors, [{ fatal: true, source: "connection" }]);
});

test("gpt-live 자동 재생이 막히면 알리고 다음 터치 때 다시 재생하며 stop 때 리스너를 지운다", async () => {
  const errors = [];
  const gesture = new EventTarget();
  let plays = 0;
  const audio = {
    autoplay: false,
    srcObject: null,
    pause() {},
    play() {
      plays += 1;
      return plays === 1 ? Promise.reject(namedError("NotAllowedError")) : Promise.resolve();
    },
  };
  const { live, FakePC } = makeLive({ audioElement: audio, gestureTarget: gesture, onError: (error, info) => errors.push({ error, info }) });
  await live.start();
  FakePC.last.handlers.track({ streams: [{ id: "remote" }] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(errors.map((e) => e.info), [{ fatal: false, source: "audio" }]);
  assert.match(errors[0].error.message, /화면을 한 번 눌러/);
  gesture.dispatchEvent(new Event("pointerdown"));
  assert.equal(plays, 2);
  gesture.dispatchEvent(new Event("pointerdown"));
  assert.equal(plays, 2, "retry listener runs only once");

  // 두 번째 세션: 막힌 채로 stop하면 리스너가 남지 않는다.
  plays = 0;
  await live.stop();
  await live.start();
  FakePC.last.handlers.track({ streams: [{ id: "remote-2" }] });
  await new Promise((r) => setTimeout(r, 0));
  await live.stop();
  gesture.dispatchEvent(new Event("keydown"));
  assert.equal(plays, 1);
});

test("실시간 음성 세션 history는 역할·글이 온전한 최근 턴만 보낸다", () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `턴 ${i}` }));
  assert.equal(liveSessionHistory(many).length, 12);
  assert.equal(liveSessionHistory(many)[0].content, "턴 3");
  assert.deepEqual(liveSessionHistory([
    { role: "user", content: "  트랙터 찾아줘  ", extra: "drop" },
    { role: "assistant", content: "" },
    { role: "system", content: "무시" },
    { role: "assistant", content: { text: "객체" } },
    null,
    { role: "assistant", content: "찾았어요" },
  ]), [
    { role: "user", content: "트랙터 찾아줘" },
    { role: "assistant", content: "찾았어요" },
  ]);
  assert.deepEqual(liveSessionHistory(undefined), []);
});

test("실시간 음성 목소리 선택은 저장·검증되고 잘못된 값은 기본값(noeul)으로 돌아간다", () => {
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  assert.equal(loadLiveVoicePreference(null, storage), DEFAULT_LIVE_VOICE);
  assert.ok(LIVE_VOICE_OPTIONS.some((v) => v.id === "willow"));
  saveLiveVoicePreference("willow", storage);
  assert.equal(loadLiveVoicePreference(null, storage), "willow");
  assert.equal(loadLiveVoicePreference(["noeul", "marin"], storage), "noeul");
  saveLiveVoicePreference("unknown", storage);
  assert.equal(loadLiveVoicePreference(null, storage), "noeul");
});

test("gpt-live full-duplex: 말 끊기(barge-in), 발화 종료 후 듣기 복귀, 비위임 턴 기록 및 이어말하기", async () => {
  const committed = [];
  const { live, calls, emit, sent } = makeLive({
    voice: "marin",
    history: [{ role: "user", content: "고추밭 500평이에요" }],
    speakingIdleMs: 30,
    userQuietMs: 0,
    onTurnCommitted: (turn) => committed.push(turn),
  });
  await live.start();
  assert.equal(calls.session[0].voice, "marin");
  emit({ type: "session.started" });
  const greeting = sent.find((m) => m.type === "session.commentary.append");
  assert.match(greeting.content, /앞선 대화 내용/);

  // 1) 어시스턴트 발화 중 사용자가 말 끊기 → 어시스턴트 턴 커밋(interrupted: true) + listening 전환
  emit({ type: "session.output_transcript.delta", delta: "안녕하세요, 지난번 고추밭 " });
  assert.equal(live.state, "speaking");
  emit({ type: "session.input_transcript.delta", delta: "금요일에 빌려줘" });
  assert.equal(live.state, "listening");
  assert.deepEqual(committed, [{ role: "assistant", text: "안녕하세요, 지난번 고추밭", interrupted: true }]);

  // 2) 위임 없이 어시스턴트가 바로 답하고 발화가 끝나면 user/assistant 턴을 커밋하고 listening으로 복귀
  emit({ type: "session.output_transcript.delta", delta: "금요일은 비가 와서 월요일이 좋아요." });
  assert.equal(live.state, "speaking");
  assert.deepEqual(committed[1], { role: "user", text: "금요일에 빌려줘" });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(live.state, "listening");
  assert.deepEqual(committed[2], { role: "assistant", text: "금요일은 비가 와서 월요일이 좋아요.", interrupted: false });
});

test("gpt-live 처음 대화는 기본 인사, 마이크 제약(에코 제거)을 먼저 요청하고 안 되면 기본값으로 다시 연다", async () => {
  const requested = [];
  const track = { enabled: true, stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const { live, emit, sent } = makeLive({
    history: [],
    getUserMedia: async (constraints) => {
      requested.push(constraints);
      if (requested.length === 1) throw namedError("OverconstrainedError");
      return stream;
    },
  });
  await live.start();
  assert.equal(requested[0].audio.echoCancellation, true);
  assert.equal(requested[0].audio.channelCount, 1);
  assert.deepEqual(requested[1], { audio: true });
  emit({ type: "session.started" });
  assert.doesNotMatch(sent.find((m) => m.type === "session.commentary.append").content, /앞선 대화/);
});

test("gpt-live 마이크 끄기/켜기는 듣는 상태를 muted ↔ listening으로 맞추고, 말하는 중에는 말하기를 유지한다", async () => {
  const { live, emit, calls } = makeLive({ speakingIdleMs: 20 });
  await live.start();
  emit({ type: "session.started" });
  live.setMuted(true);
  assert.equal(live.state, "muted");
  live.setMuted(false);
  assert.equal(live.state, "listening");

  // 서버가 보낸 mute/unmute 이벤트도 상태에 반영한다.
  emit({ type: "session.input_audio.muted" });
  assert.equal(live.muted, true);
  assert.equal(live.state, "muted");
  emit({ type: "session.input_audio.unmuted" });
  assert.equal(live.state, "listening");

  // 말하는 중 마이크를 끄면 speaking 유지 → 발화가 끝나면 muted로 돌아간다.
  emit({ type: "session.output_transcript.delta", delta: "안내해 드릴게요" });
  live.setMuted(true);
  assert.equal(live.state, "speaking");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(live.state, "muted");
  assert.deepEqual(calls.states.slice(-2), ["speaking", "muted"]);
});

test("gpt-live 위임 턴 중복 방지: 맞장구 뒤 위임이면 이미 기록된 발화로 알리고, 위임 답변 낭독은 delegated로 표시한다", async () => {
  const committed = [];
  const { live, emit, calls } = makeLive({ speakingIdleMs: 20, onTurnCommitted: (t) => committed.push(t) });
  await live.start();
  emit({ type: "session.started" });

  // 맞장구("확인해 볼게요")가 먼저 나오면 사용자 발화가 그때 커밋된다.
  emit({ type: "session.input_transcript.delta", delta: "트랙터 빌려줘" });
  emit({ type: "session.output_transcript.delta", delta: "네, 확인해 볼게요." });
  emit({ type: "session.delegation.created", delegation: { id: "d-a", target: "client" } });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls.delegations[0], { delegationId: "d-a", userText: "트랙터 빌려줘", userTurnCommitted: true });
  assert.deepEqual(committed, [
    { role: "user", text: "트랙터 빌려줘" },
    { role: "assistant", text: "네, 확인해 볼게요.", interrupted: false },
  ]);

  // 위임 결과를 읽어 주는 발화는 delegated로 커밋된다(패널이 답변으로 이미 기록).
  emit({ type: "session.output_transcript.delta", delta: "요약을 읽어 드려요." });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(committed[2], { role: "assistant", text: "요약을 읽어 드려요.", interrupted: false, delegated: true });

  // 다음 사용자 턴부터는 일반 턴이고, 맞장구 없이 바로 위임되면 아직 기록되지 않은 발화다.
  emit({ type: "session.input_transcript.delta", delta: "금요일은?" });
  emit({ type: "session.delegation.created", delegation: { id: "d-b", target: "client" } });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls.delegations[1], { delegationId: "d-b", userText: "금요일은?", userTurnCommitted: false });
  emit({ type: "session.input_transcript.delta", delta: "고마워" });
  emit({ type: "session.output_transcript.delta", delta: "천만에요." });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(committed.slice(-2), [
    { role: "user", text: "고마워" },
    { role: "assistant", text: "천만에요.", interrupted: false },
  ]);
});

test("gpt-live commitPendingTurns는 말하던 중인 턴을 바로 기록하고 이후 stop에서 다시 기록하지 않는다", async () => {
  const committed = [];
  const { live, emit } = makeLive({ onTurnCommitted: (t) => committed.push(t) });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "콤바인 있어?" });
  emit({ type: "session.output_transcript.delta", delta: "네, 영양읍에" });
  live.commitPendingTurns();
  assert.deepEqual(committed, [
    { role: "user", text: "콤바인 있어?" },
    { role: "assistant", text: "네, 영양읍에", interrupted: true },
  ]);
  const stopping = live.stop();
  emit({ type: "session.closed" });
  await stopping;
  assert.equal(committed.length, 2);
});

test("gpt-live 마이크 트랙이 끊기면 세션을 정리하고 치명적 오류로 알린다", async () => {
  const errors = [];
  const track = Object.assign(new EventTarget(), { enabled: true, stopped: false, stop() { this.stopped = true; } });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const { live, emit } = makeLive({ getUserMedia: async () => stream, onError: (error, info) => errors.push({ error, info }) });
  await live.start();
  emit({ type: "session.started" });
  track.dispatchEvent(new Event("ended"));
  assert.deepEqual(errors.map((e) => e.info), [{ fatal: true, source: "connection" }]);
  assert.match(errors[0].error.message, /마이크 연결이 끊어졌어요/);
  assert.equal(live.state, "idle");
  assert.equal(track.stopped, true);
});

test("문제1: 음성 시작 시 농농이가 정해진 인사를 바로 먼저 보낸다", async () => {
  const { live, emit, sent } = makeLive({ history: [] });
  await live.start();
  emit({ type: "session.started" });
  const greeting = sent.find((m) => m.type === "session.commentary.append");
  assert.ok(greeting, "session.started 직후 인사 commentary가 있어야 한다");
  assert.match(greeting.content, /안녕하세요, 농농이에요\. 대여, 구매, 판매 중에 어떤 걸 도와드릴까요\?/);
});

test("문제1: 사용자가 먼저 말하고 있으면 인사로 끊지 않는다", async () => {
  const { live, emit, sent } = makeLive({ history: [], userQuietMs: 200 });
  await live.start();
  emit({ type: "session.input_transcript.delta", delta: "저기 트랙터" });
  emit({ type: "session.started" });
  assert.equal(sent.filter((m) => m.type === "session.commentary.append").length, 0);
});

test("문제1: 위임 결과가 사용자가 말하는 중에 오면 말이 끝날 때까지 미뤘다가 보낸다", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { live, emit, sent } = makeLive({
    userQuietMs: 60,
    onClientDelegation: async () => { await gate; return { spokenSummary: "청기면 매물 2개가 있어요." }; },
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "고구마 캐는 기계" });
  emit({ type: "session.delegation.created", delegation: { id: "dq", target: "client" } });
  await new Promise((r) => setTimeout(r, 70));
  // 사용자가 다시 말하기 시작한 순간 결과가 도착한다.
  emit({ type: "session.input_transcript.delta", delta: "그리고 청기면이요" });
  release();
  await new Promise((r) => setTimeout(r, 5));
  const result = () => sent.filter((m) => m.type === "session.commentary.append" && m.delegation_id === "dq");
  assert.equal(result().length, 0, "사용자가 말하는 중에는 결과를 말하지 않는다");
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(result().length, 1, "말이 끝난 뒤에 결과를 말한다");
});

test("문제1: 농농이 말하는 중 사용자가 끼어들면 소리를 즉시 끄고, 사용자가 말하는 동안 나머지 발화를 버린다", async () => {
  const audio = makeAudio();
  const committed = [];
  const { live, emit } = makeLive({ audioElement: audio, userQuietMs: 60, onTurnCommitted: (t) => committed.push(t) });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.output_transcript.delta", delta: "청기면 매물은 " });
  assert.equal(live.state, "speaking");
  emit({ type: "session.input_transcript.delta", delta: "잠깐만" });
  assert.equal(audio.muted, true, "끼어들면 농농이 음성을 바로 끈다");
  assert.equal(live.state, "listening");
  emit({ type: "session.output_transcript.delta", delta: "320만원이에요." });
  assert.equal(live.state, "listening", "사용자가 말하는 동안에는 말하지 않는다");
  assert.deepEqual(committed, [{ role: "assistant", text: "청기면 매물은", interrupted: true }]);
  await new Promise((r) => setTimeout(r, 80));
  emit({ type: "session.output_transcript.delta", delta: "네, 말씀하세요." });
  assert.equal(audio.muted, false, "사용자 말이 끝난 뒤의 새 답변은 다시 들린다");
  assert.equal(live.state, "speaking");
});
