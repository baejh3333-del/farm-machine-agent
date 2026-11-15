import { recommend } from "../server/agent.js";
import { fail, handle, readJson } from "../server/http.js";

export default handle(["POST"], async (request) => {
  const body = await readJson(request);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 500) {
    fail(400, "INVALID_MESSAGE", "질문은 1~500자로 입력해 주세요.");
  }
  const context = body.context && typeof body.context === "object" && !Array.isArray(body.context)
    ? body.context
    : {};
  try {
    const result = await recommend(message, context);
    return { status: 200, body: result };
  } catch (error) {
    console.error("recommend failed", error instanceof Error ? error.message : "unknown");
    fail(502, "RECOMMEND_UNAVAILABLE", "추천 서비스에 일시적인 문제가 있습니다.");
  }
});
