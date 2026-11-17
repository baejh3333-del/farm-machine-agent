import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeWav,
  koreanWon,
  loadVoiceSettings,
  pickKoreanVoice,
  rentalSummaryForSpeech,
  resampleToMono,
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

test("대여 승인 카드를 음성 요약으로 바꾸고, 실행은 버튼으로만 한다고 말한다", () => {
  const summary = rentalSummaryForSpeech({
    title: "아세아텍 AMC-900 · 영양읍", region: "영양읍", start: "2026-11-20", end: "2026-11-22", days: 3, dailyPrice: 45000, totalPrice: 135000,
  });
  assert.match(summary, /아세아텍 AMC-900/);
  assert.match(summary, /11월 20일부터 11월 22일까지 3일/);
  assert.match(summary, /하루 4만 5천 원/);
  assert.match(summary, /모두 13만 5천 원/);
  assert.match(summary, /승인 버튼/);
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

test("농농 승인 카드 요약: 날짜·요일·금액을 풀어 읽고, 말로는 승인되지 않는다고 알려 준다", () => {
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
    "대여 예약 내용이에요. 기계, 대동 트랙터 RX. 기간, 11월 17일 화요일부터 11월 18일 수요일, 2일. 내야 하는 돈, 18만 원 (하루 9만 원). 내용이 맞으면 화면의 승인 버튼을 눌러 주세요. 말로는 승인되지 않아요.",
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
const { createGptLiveController } = await import("../src/ai/gpt-live.js");

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
  assert.deepEqual(calls.delegations, [{ delegationId: "d1", userText: "트랙터" }]);
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
