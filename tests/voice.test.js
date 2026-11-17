import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import agentOrVoice from "../api/agent.js";
import {
  buildGptLiveInstructions,
  createGptLiveSession,
  sanitizeUpstreamMessage,
  seedInputFromHistory,
} from "../server/gpt-live.js";
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

const OFFER_SDP = "v=0\r\no=- 4611 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-ufrag:abcd\r\n";

test("createGptLiveSession 요청 본문은 공식 POST /v1/live/sessions 스키마와 정확히 일치하고 SDP 끝 CRLF를 지킨다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "live-key" });
  let body;
  await createGptLiveSession({
    sdp: `  ${OFFER_SDP}  `,
    history: [{ role: "assistant", text: "네, 말씀하세요." }],
    fetchImpl: async (_url, req) => {
      body = JSON.parse(req.body);
      return Response.json({ session: { id: "live_1" }, transport: { type: "webrtc", sdp: "v=0\r\n" } }, { status: 201 });
    },
  });

  assert.deepEqual(Object.keys(body).sort(), ["session", "transport"]);
  assert.deepEqual(Object.keys(body.session).sort(), ["audio", "delegation", "input", "instructions", "model"]);
  assert.deepEqual(body.session.audio, { output: { voice: "noeul" } });
  assert.deepEqual(body.session.delegation, { type: "client" });
  assert.deepEqual(body.transport, { type: "webrtc", sdp: OFFER_SDP }, "앞뒤 공백만 정리하고 마지막 CRLF는 남긴다");
  for (const item of body.session.input) {
    assert.equal(item.type, "message");
    assert.equal(item.content.length, 1, "초기 대화 항목은 텍스트 파트 하나만 허용된다");
    assert.equal(item.content[0].type, item.role === "assistant" ? "output_text" : "input_text");
  }

  // 마지막 CRLF가 빠진 오퍼(이전 sdp.trim() 결과와 같은 형태)는 CRLF를 붙여 보낸다.
  await createGptLiveSession({
    sdp: OFFER_SDP.trimEnd(),
    fetchImpl: async (_url, req) => {
      body = JSON.parse(req.body);
      return Response.json({ session: { id: "live_2" }, transport: { type: "webrtc", sdp: "v=0\r\n" } }, { status: 201 });
    },
  });
  assert.equal(body.transport.sdp, OFFER_SDP);
});

test("seedInputFromHistory는 최근 대화부터 글자 예산 안에서 원래 순서대로 채운다", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `${i}번 `.padEnd(400, "가") }));
  const items = seedInputFromHistory(history);
  const total = items.reduce((sum, item) => sum + item.content[0].text.length, 0);
  assert.ok(items.length <= 12);
  assert.ok(total <= 2400, `history chars ${total}`);
  assert.match(items.at(-1).content[0].text, /^19번/, "가장 최근 대화가 마지막에 온다");
  assert.equal(items.at(-1).role, "assistant");
  assert.equal(items.at(-1).content[0].type, "output_text");
  assert.deepEqual(seedInputFromHistory("nope"), []);
});

test("sanitizeUpstreamMessage는 키·Bearer·SDP·사용자 발화를 지우고 설정값은 남긴다", () => {
  const msg = sanitizeUpstreamMessage(
    "Invalid value 'noeul' for session.audio.output.voice; key sk-proj-abcdefghijkl Bearer my-live-key said '고추밭 관리기 빌려줘' sdp v=0\r\no=- 1 2 IN IP4",
    ["my-live-key"],
  );
  assert.match(msg, /'noeul'/);
  assert.match(msg, /session\.audio\.output\.voice/);
  assert.doesNotMatch(msg, /sk-proj|my-live-key|고추밭|o=-|IN IP4/);
  assert.equal(sanitizeUpstreamMessage("Invalid SDP offer: missing a=fingerprint"), "Invalid SDP offer: missing a=fingerprint");
  assert.equal(
    sanitizeUpstreamMessage("Bad offer m=audio 9 UDP/TLS/RTP/SAVPF 111 a=ice-ufrag:abcd a=fingerprint:sha-256 AB:CD"),
    "Bad offer [redacted-sdp]",
  );
  assert.ok(sanitizeUpstreamMessage("x".repeat(1000)).length <= 300);
  assert.equal(sanitizeUpstreamMessage(undefined), undefined);
});

test("업스트림 400은 status/type/code/param/message를 구조화해 남기되 키·SDP·발화는 남기지 않는다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "super-secret-live-key" });
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  let calls = 0;
  await assert.rejects(
    () => createGptLiveSession({
      sdp: OFFER_SDP,
      history: [{ role: "user", text: "우리 집 주소는 영양읍 비밀길 1번지" }],
      fetchImpl: async () => {
        calls += 1;
        return Response.json({
          error: {
            type: "invalid_request_error",
            code: "invalid_value",
            param: "transport.sdp",
            message: `Invalid SDP offer super-secret-live-key '우리 집 주소는 영양읍 비밀길 1번지' ${OFFER_SDP}`,
          },
        }, { status: 400, headers: { "x-request-id": "req_abc123" } });
      },
    }),
    (err) => err.code === "LIVE_SESSION_FAILED" && err.status === 502,
  );
  assert.equal(calls, 1, "필수 값(SDP) 오류는 다시 시도하지 않는다");
  const [event, details] = logs.find(([name]) => name === "gpt_live_session_failed");
  assert.equal(event, "gpt_live_session_failed");
  assert.equal(details.status, 400);
  assert.equal(details.type, "invalid_request_error");
  assert.equal(details.code, "invalid_value");
  assert.equal(details.param, "transport.sdp");
  assert.equal(details.requestId, "req_abc123");
  assert.equal(details.model, "gpt-live-1");
  assert.match(details.message, /^Invalid SDP offer/);
  assert.equal(details.retryWithout, undefined);
  assert.doesNotMatch(JSON.stringify(logs), /super-secret-live-key|비밀길|ice-ufrag|o=- 4611/);
});

test("JSON이 아닌 오류 본문도 안전하게 처리한다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "live-key" });
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  await assert.rejects(
    () => createGptLiveSession({ sdp: OFFER_SDP, fetchImpl: async () => new Response("<html>bad gateway</html>", { status: 400 }) }),
    (err) => err.code === "LIVE_SESSION_FAILED",
  );
  const details = logs.find(([name]) => name === "gpt_live_session_failed")[1];
  assert.equal(details.status, 400);
  assert.equal(details.code, undefined);
  assert.equal(details.message, undefined);
});

test("400이 voice를 가리키면 voice 없이(기본 marin) 한 번 다시 시도한다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "live-key" });
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  const bodies = [];
  const result = await createGptLiveSession({
    sdp: OFFER_SDP,
    fetchImpl: async (_url, req) => {
      bodies.push(JSON.parse(req.body));
      if (bodies.length === 1) {
        return Response.json({
          error: { type: "invalid_request_error", code: "invalid_value", param: "session.audio.output.voice", message: "Invalid voice 'noeul'." },
        }, { status: 400 });
      }
      return Response.json({ session: { id: "live_fallback" }, transport: { type: "webrtc", sdp: "v=0\r\nanswer\r\n" } }, { status: 201 });
    },
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].session.audio.output.voice, "noeul");
  assert.equal(bodies[1].session.audio, undefined);
  assert.deepEqual(bodies[1].session.input, bodies[0].session.input, "다른 설정은 그대로 둔다");
  assert.equal(bodies[1].transport.sdp, bodies[0].transport.sdp, "같은 SDP 오퍼를 다시 쓴다");
  assert.equal(result.session.id, "live_fallback");
  const failed = logs.find(([name]) => name === "gpt_live_session_failed")[1];
  assert.equal(failed.retryWithout, "voice");
  assert.ok(logs.some(([name, d]) => name === "gpt_live_session_fallback_succeeded" && d.dropped === "voice"));
});

test("400이 session.input을 가리키면 이전 대화를 빼고, 그래도 실패하면 input 전체를 뺀다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "live-key" });
  t.mock.method(console, "warn", () => {});
  const bodies = [];
  const result = await createGptLiveSession({
    sdp: OFFER_SDP,
    history: [{ role: "user", text: "트랙터" }, { role: "assistant", text: "네" }],
    fetchImpl: async (_url, req) => {
      bodies.push(JSON.parse(req.body));
      if (bodies.length < 3) {
        return Response.json({
          error: { type: "invalid_request_error", code: "invalid_value", param: `session.input[${bodies.length === 1 ? 2 : 0}]`, message: "Invalid input." },
        }, { status: 400 });
      }
      return Response.json({ session: { id: "live_ok" }, transport: { type: "webrtc", sdp: "v=0\r\n" } }, { status: 201 });
    },
  });
  assert.equal(bodies.length, 3);
  assert.equal(bodies[0].session.input.length, 3);
  assert.equal(bodies[1].session.input.length, 1);
  assert.equal(bodies[1].session.input[0].role, "developer");
  assert.equal(bodies[2].session.input, undefined);
  assert.equal(bodies[2].session.audio.output.voice, "noeul");
  assert.equal(result.session.id, "live_ok");
});

test("400이 delegation을 가리키면 delegation 없이(=client 기본값) 다시 시도하고, 같은 오류가 반복되면 멈춘다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "live-key" });
  t.mock.method(console, "warn", () => {});
  const bodies = [];
  await assert.rejects(
    () => createGptLiveSession({
      sdp: OFFER_SDP,
      fetchImpl: async (_url, req) => {
        bodies.push(JSON.parse(req.body));
        return Response.json({
          error: { type: "invalid_request_error", code: "unknown_parameter", param: "session.delegation", message: "Unknown parameter." },
        }, { status: 400 });
      },
    }),
    (err) => err.code === "LIVE_SESSION_FAILED" && err.status === 502,
  );
  assert.equal(bodies.length, 2, "같은 필드는 한 번만 빼고 다시 시도한다");
  assert.deepEqual(bodies[0].session.delegation, { type: "client" });
  assert.equal(bodies[1].session.delegation, undefined);
});

test("401/429/500 같은 400이 아닌 오류는 다시 시도하지 않는다", async (t) => {
  withEnv(t, { OPENAI_API_KEY: "live-key" });
  t.mock.method(console, "warn", () => {});
  for (const status of [401, 429, 500]) {
    let calls = 0;
    await assert.rejects(
      () => createGptLiveSession({
        sdp: OFFER_SDP,
        fetchImpl: async () => {
          calls += 1;
          return Response.json({ error: { type: "x", code: "y", param: "session.audio.output.voice", message: "voice" } }, { status });
        },
      }),
      (err) => err.code === "LIVE_SESSION_FAILED",
    );
    assert.equal(calls, 1, `status ${status}`);
  }
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
