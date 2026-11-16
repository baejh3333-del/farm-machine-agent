import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, parseWav, transcribe, voiceCapabilities, voiceProvider } from "../server/voice.js";

const VOICE_ENV = ["VOICE_STT_PROVIDER", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_STT_MODEL", "ZAI_API_KEY", "ZAI_BASE_URL", "ZAI_ASR_MODEL"];

function withEnv(t, values) {
  const previous = Object.fromEntries(VOICE_ENV.map((name) => [name, process.env[name]]));
  for (const name of VOICE_ENV) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

/** 16kHz 모노 16비트 PCM WAV를 만든다. */
function wav(seconds, { sampleRate = 16000, channels = 1, bits = 16, format = 1 } = {}) {
  const dataBytes = Math.round(seconds * sampleRate) * channels * (bits / 8);
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(format, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  buffer.writeUInt16LE(channels * (bits / 8), 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

test("WAV 머리말에서 길이를 읽고, 30초를 넘거나 WAV가 아니면 거절한다", () => {
  const info = parseWav(wav(3));
  assert.equal(info.sampleRate, 16000);
  assert.equal(info.channels, 1);
  assert.equal(Math.round(info.seconds), 3);
  assert.throws(() => parseWav(wav(MAX_AUDIO_SECONDS + 1)), (err) => err.code === "AUDIO_TOO_LONG");
  assert.throws(() => parseWav(Buffer.from("not audio at all, definitely not a wav file header")), (err) => err.code === "INVALID_AUDIO");
  assert.throws(() => parseWav(wav(1, { format: 3 })), (err) => err.code === "INVALID_AUDIO", "PCM만 받는다");
  assert.throws(() => parseWav(Buffer.alloc(MAX_AUDIO_BYTES + 1)), (err) => err.code === "AUDIO_TOO_LARGE");
  assert.ok(wav(MAX_AUDIO_SECONDS).length <= MAX_AUDIO_BYTES, "30초 16kHz 모노 WAV는 크기 제한 안에 들어간다");
});

test("음성 인식 공급자: OpenAI 키가 있으면 OpenAI, Z.ai는 명시할 때만, 없으면 브라우저", (t) => {
  withEnv(t, { ZAI_API_KEY: "z" });
  assert.equal(voiceProvider(), null, "Z.ai는 한국어 지원이 공식 문서에 없어서 자동으로 고르지 않는다");
  process.env.VOICE_STT_PROVIDER = "zai";
  assert.equal(voiceProvider(), "zai");
  delete process.env.VOICE_STT_PROVIDER;
  process.env.OPENAI_API_KEY = "o";
  assert.equal(voiceProvider(), "openai");
  process.env.VOICE_STT_PROVIDER = "none";
  assert.equal(voiceProvider(), null);
  process.env.VOICE_STT_PROVIDER = "openai";
  delete process.env.OPENAI_API_KEY;
  assert.equal(voiceProvider(), null, "지정한 공급자의 키가 없으면 다른 공급자로 바꾸지 않는다");
  assert.deepEqual(voiceCapabilities(), { serverStt: false, provider: null, maxSeconds: MAX_AUDIO_SECONDS });
});

test("OpenAI 인식은 한국어·농기계 용어 힌트와 함께 multipart로 보내고 글자만 돌려준다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "okey" });
  let sent;
  t.mock.method(globalThis, "fetch", async (url, request) => {
    sent = { url, request };
    return Response.json({ text: "  고추밭에 두둑 만들 관리기 빌리고 싶어예  " });
  });
  const result = await transcribe(wav(2));
  assert.equal(sent.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(sent.request.headers.authorization, "Bearer okey");
  const form = sent.request.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("model"), "gpt-4o-mini-transcribe");
  assert.equal(form.get("language"), "ko");
  assert.match(form.get("prompt"), /관리기/);
  assert.equal(form.get("file").type, "audio/wav");
  assert.deepEqual(result, { text: "고추밭에 두둑 만들 관리기 빌리고 싶어예", provider: "openai" });
});

test("Z.ai 인식은 glm-asr-2512에 multipart로 보낸다(명시했을 때)", async (t) => {
  withEnv(t, { VOICE_STT_PROVIDER: "zai", ZAI_API_KEY: "zkey" });
  let sent;
  t.mock.method(globalThis, "fetch", async (url, request) => {
    sent = { url, request };
    return Response.json({ id: "x", text: "감자 캐는 기계" });
  });
  const result = await transcribe(wav(2));
  assert.equal(sent.url, "https://api.z.ai/api/paas/v4/audio/transcriptions");
  assert.equal(sent.request.body.get("model"), "glm-asr-2512");
  assert.equal(sent.request.body.get("stream"), "false");
  assert.equal(result.text, "감자 캐는 기계");
});

test("공급자 오류는 원문·키 없이 분류해서 던진다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "secret-key" });
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "rate_limit_exceeded", message: "secret-key user said 집 주소" } }, { status: 429 }));
  await assert.rejects(() => transcribe(wav(1)), (err) => err.code === "TRANSCRIBE_FAILED" && err.status === 502);
  assert.doesNotMatch(JSON.stringify(logs), /secret-key|집 주소/);
});

test("공급자가 없으면 VOICE_UNAVAILABLE", async (t) => {
  withEnv(t, {});
  await assert.rejects(() => transcribe(wav(1)), (err) => err.code === "VOICE_UNAVAILABLE" && err.status === 503);
});

test("인식이 제한 시간을 넘기면 취소하고 VOICE_TIMEOUT", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "okey" });
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(() => transcribe(wav(1), { timeoutMs: 20 }), (err) => err.code === "VOICE_TIMEOUT" && err.status === 504);
});
