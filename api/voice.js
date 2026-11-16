import { fail, handle, MAX_UPLOAD_JSON_BYTES, readJson } from "../server/http.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import { MAX_AUDIO_BYTES, transcribe, voiceCapabilities, VoiceError } from "../server/voice.js";

// GET: 서버 음성 인식 사용 가능 여부(화면이 브라우저 인식으로 대신할지 정한다)
// POST { audio: base64 WAV }: 음성을 글자로 바꾼다. 음성은 저장하지 않는다.
export default handle(["GET", "POST"], async (request) => {
  if (request.method === "GET") return { status: 200, body: voiceCapabilities() };

  const body = await readJson(request, { maxBytes: MAX_UPLOAD_JSON_BYTES });
  // 비용이 드는 작업이라 음성을 해석하기 전에 호출 제한부터 검사한다.
  await enforceRateLimit(request, "voice");
  const audio = typeof body.audio === "string" ? body.audio : "";
  if (!audio) fail(400, "INVALID_AUDIO", "녹음 파일이 없어요. 다시 말씀해 주세요.");
  if (audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4) fail(413, "AUDIO_TOO_LARGE", "녹음이 너무 길어요. 30초 안으로 말씀해 주세요.");
  try {
    const result = await transcribe(Buffer.from(audio, "base64"));
    return { status: 200, body: result };
  } catch (error) {
    if (error instanceof VoiceError) fail(error.status, error.code, error.message);
    throw error;
  }
});
