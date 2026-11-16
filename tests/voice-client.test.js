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
