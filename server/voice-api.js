// /api/voice 처리. Vercel 무료 플랜 함수 개수(12개) 제한 때문에 따로 함수를 두지 않고
// vercel.json rewrites로 /api/agent?route=voice에 넘겨 api/agent.js가 이 처리기를 부른다.
import { createGptLiveSession } from "./gpt-live.js";
import { fail, handle, MAX_UPLOAD_JSON_BYTES, readJson } from "./http.js";
import { enforceRateLimit } from "./rate-limit.js";
import { MAX_AUDIO_BYTES, transcribe, voiceCapabilities, VoiceError } from "./voice.js";

// GET: 실시간 음성(gpt-live-1) 및 서버 음성 인식 사용 가능 여부
// POST { action: "live_session", sdp, region?, history? }: gpt-live-1 WebRTC 세션 생성
// POST { audio: base64 WAV }: 레거시/폴백 음성 → 글 변환(음성 저장 안 함)
export default handle(["GET", "POST"], async (request) => {
  if (request.method === "GET") return { status: 200, body: voiceCapabilities() };

  const body = await readJson(request, { maxBytes: MAX_UPLOAD_JSON_BYTES });
  // 비용이 드는 작업이라 외부 API 호출 전에 호출 제한부터 검사한다.
  await enforceRateLimit(request, "voice");

  if (body.action === "live_session" || typeof body.sdp === "string") {
    try {
      const result = await createGptLiveSession({
        sdp: body.sdp,
        region: typeof body.region === "string" ? body.region : undefined,
        voice: typeof body.voice === "string" ? body.voice : undefined,
        uiContext: body.uiContext && typeof body.uiContext === "object" ? body.uiContext : undefined,
        history: Array.isArray(body.history) ? body.history : [],
      });
      return { status: 201, body: result };
    } catch (error) {
      if (error instanceof VoiceError) fail(error.status, error.code, error.message);
      throw error;
    }
  }

  const audio = typeof body.audio === "string" ? body.audio : "";
  if (!audio) fail(400, "INVALID_AUDIO", "녹음 파일이 없어요. 다시 말씀해 주세요.");
  if (audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4) {
    fail(413, "AUDIO_TOO_LARGE", "녹음이 너무 길어요. 30초 안으로 말씀해 주세요.");
  }
  try {
    const result = await transcribe(Buffer.from(audio, "base64"));
    return { status: 200, body: result };
  } catch (error) {
    if (error instanceof VoiceError) fail(error.status, error.code, error.message);
    throw error;
  }
});
