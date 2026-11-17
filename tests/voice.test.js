import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import agentOrVoice from "../api/agent.js";
import { buildGptLiveInstructions, createGptLiveSession } from "../server/gpt-live.js";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, parseWav, transcribe, voiceCapabilities, voiceProvider } from "../server/voice.js";
import voiceApi from "../server/voice-api.js";

const VOICE_ENV = [
  "VOICE_STT_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_STT_MODEL",
  "OPENAI_LIVE_MODEL",
  "OPENAI_LIVE_VOICE",
  "ZAI_API_KEY",
  "ZAI_BASE_URL",
  "ZAI_ASR_MODEL",
];

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

function mockHttp({ method = "GET", url = "/api/voice", body } = {}) {
  const headers = { host: "localhost:3000" };
  if (method !== "GET") {
    headers.origin = "http://localhost:3000";
    headers["content-type"] = "application/json";
  }
  const request = { method, url, headers, body, socket: { remoteAddress: "127.0.0.1" } };
  const responseHeaders = {};
  let statusCode = 200;
  let rawBody = "";
  const response = Object.assign(new EventEmitter(), {
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
    },
    writeHead(status, extra = {}) {
      statusCode = status;
      for (const [k, v] of Object.entries(extra)) {
        responseHeaders[k.toLowerCase()] = v;
      }
      this.headersSent = true;
      return this;
    },
    end(chunk = "") {
      rawBody += String(chunk);
      this.writableEnded = true;
      return this;
    },
  });
  return {
    request,
    response,
    result() {
      return {
        status: statusCode,
        headers: responseHeaders,
        body: rawBody ? JSON.parse(rawBody) : null,
      };
    },
  };
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

test("음성 인식 공급자 및 voiceCapabilities: OpenAI 키가 있으면 liveAvailable과 OpenAI STT 활성화", (t) => {
  withEnv(t, { ZAI_API_KEY: "z" });
  assert.equal(voiceProvider(), null, "Z.ai는 한국어 지원이 공식 문서에 없어서 자동으로 고르지 않는다");
  process.env.VOICE_STT_PROVIDER = "zai";
  assert.equal(voiceProvider(), "zai");
  delete process.env.VOICE_STT_PROVIDER;
  process.env.OPENAI_API_KEY = "o";
  assert.equal(voiceProvider(), "openai");
  assert.deepEqual(voiceCapabilities(), {
    serverStt: true,
    provider: "openai",
    maxSeconds: MAX_AUDIO_SECONDS,
    liveAvailable: true,
    liveModel: "gpt-live-1",
    liveVoice: "noeul",
  });
  process.env.VOICE_STT_PROVIDER = "none";
  assert.equal(voiceProvider(), null);
  process.env.VOICE_STT_PROVIDER = "openai";
  delete process.env.OPENAI_API_KEY;
  assert.equal(voiceProvider(), null, "지정한 공급자의 키가 없으면 다른 공급자로 바꾸지 않는다");
  assert.deepEqual(voiceCapabilities(), {
    serverStt: false,
    provider: null,
    maxSeconds: MAX_AUDIO_SECONDS,
    liveAvailable: false,
    liveModel: "gpt-live-1",
    liveVoice: "noeul",
  });
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

test("buildGptLiveInstructions는 공식 live-prompting 정책 섹션과 SpawnThinking 규칙을 포함한다", () => {
  const instructions = buildGptLiveInstructions({ region: "청기면" });
  assert.match(instructions, /농농이/);
  assert.match(instructions, /청기면/);
  assert.match(instructions, /Backchannel policy:/);
  assert.match(instructions, /Interruption policy:/);
  assert.match(instructions, /Delegation policy:/);
  assert.match(instructions, /Backend tools:/);
  assert.match(instructions, /Generate <\|SpawnThinking\|> when:/);
  assert.match(instructions, /Do not generate <\|SpawnThinking\|> when:/);
  assert.match(
    instructions,
    /Generate <\|SpawnThinking\|> before giving an answer that depends on backend work\. Do not guess the result while waiting\./,
  );
});

test("createGptLiveSession은 SDP를 검증하고 OpenAI /live/sessions와 WebRTC SDP를 교환한다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "live-key" });

  await assert.rejects(
    () => createGptLiveSession({ sdp: "" }),
    (err) => err.code === "INVALID_SDP" && err.status === 400,
  );
  await assert.rejects(
    () => createGptLiveSession({ sdp: "x".repeat(65537) }),
    (err) => err.code === "INVALID_SDP" && err.status === 400,
  );

  let sent;
  const result = await createGptLiveSession({
    sdp: "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n",
    region: "입암면",
    history: [
      { role: "user", text: "고추밭 관리기 있어요?" },
      { role: "assistant", text: "영양읍에 두 대 있어요." },
    ],
    fetchImpl: async (url, req) => {
      sent = { url, req, body: JSON.parse(req.body) };
      return Response.json({
        session: { id: "live_sess_123" },
        transport: { type: "webrtc", sdp: "v=0\r\nanswer\r\n" },
      }, { status: 201 });
    },
  });

  assert.equal(sent.url, "https://api.openai.com/v1/live/sessions");
  assert.equal(sent.req.headers.authorization, "Bearer live-key");
  assert.equal(sent.body.session.model, "gpt-live-1");
  assert.equal(sent.body.session.audio.output.voice, "noeul");
  assert.equal(sent.body.session.delegation.type, "client");
  assert.match(sent.body.session.instructions, /입암면/);
  assert.equal(sent.body.session.input.length, 3);
  assert.equal(sent.body.session.input[0].role, "developer");
  assert.equal(sent.body.session.input[1].role, "user");
  assert.equal(sent.body.session.input[2].role, "assistant");
  assert.equal(sent.body.session.input[2].content[0].type, "output_text");
  assert.equal(sent.body.transport.type, "webrtc");
  assert.match(sent.body.transport.sdp, /^v=0/);
  assert.deepEqual(result, {
    session: { id: "live_sess_123" },
    transport: { type: "webrtc", sdp: "v=0\r\nanswer\r\n" },
  });
});

test("createGptLiveSession은 키가 없으면 LIVE_UNAVAILABLE(503), 업스트림 오류 시 키를 노출하지 않는다", async (t) => {
  withEnv(t, {});
  await assert.rejects(
    () => createGptLiveSession({ sdp: "v=0\r\n" }),
    (err) => err.code === "LIVE_UNAVAILABLE" && err.status === 503,
  );

  process.env.OPENAI_API_KEY = "super-secret-live-key";
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  await assert.rejects(
    () => createGptLiveSession({
      sdp: "v=0\r\n",
      fetchImpl: async () => Response.json({ error: { message: "super-secret-live-key" } }, { status: 500 }),
    }),
    (err) => err.code === "LIVE_SESSION_FAILED" && err.status === 502,
  );
  assert.doesNotMatch(JSON.stringify(logs), /super-secret-live-key/);
});

test("GET /api/voice 및 POST /api/voice(live_session + STT 폴백 + /api/agent?route=voice 위임)", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "okey" });

  // 1. GET /api/voice via api/agent.js?route=voice
  const getCtx = mockHttp({ method: "GET", url: "/api/agent?route=voice" });
  await agentOrVoice(getCtx.request, getCtx.response);
  const getRes = getCtx.result();
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.liveAvailable, true);
  assert.equal(getRes.body.liveModel, "gpt-live-1");
  assert.equal(getRes.body.liveVoice, "noeul");
  assert.equal(getRes.body.serverStt, true);

  // 2. POST /api/voice action: "live_session"
  t.mock.method(globalThis, "fetch", async (url, req) => {
    if (String(url).endsWith("/live/sessions")) {
      return Response.json({
        session: { id: "live_abc" },
        transport: { type: "webrtc", sdp: "v=0\r\nanswer-sdp\r\n" },
      }, { status: 201 });
    }
    if (String(url).endsWith("/audio/transcriptions")) {
      return Response.json({ text: "트랙터 대여" });
    }
    throw new Error(`unexpected fetch url: ${url} (${req?.method})`);
  });

  const liveCtx = mockHttp({
    method: "POST",
    url: "/api/voice",
    body: { action: "live_session", sdp: "v=0\r\noffer-sdp\r\n", region: "영양읍" },
  });
  await voiceApi(liveCtx.request, liveCtx.response);
  const liveRes = liveCtx.result();
  assert.equal(liveRes.status, 201);
  assert.deepEqual(liveRes.body, {
    session: { id: "live_abc" },
    transport: { type: "webrtc", sdp: "v=0\r\nanswer-sdp\r\n" },
  });

  // 3. POST /api/voice WAV STT fallback
  const sttCtx = mockHttp({
    method: "POST",
    url: "/api/voice",
    body: { audio: wav(1).toString("base64") },
  });
  await voiceApi(sttCtx.request, sttCtx.response);
  const sttRes = sttCtx.result();
  assert.equal(sttRes.status, 200);
  assert.deepEqual(sttRes.body, { text: "트랙터 대여", provider: "openai" });
});
