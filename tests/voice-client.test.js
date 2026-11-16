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
