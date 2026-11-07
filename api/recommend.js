import { recommend } from "../server/agent.js";
import { recommendLimitResponse } from "../server/rate-limit.js";

export const MAX_BODY_BYTES = 10_000;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "POST만 지원합니다." });
  }
  if (Number(request.headers?.["content-length"]) > MAX_BODY_BYTES) {
    return response.status(413).json({ error: "요청이 너무 큽니다." });
  }
  let body;
  try {
    // Vercel은 JSON 본문을 미리 파싱하고, 형식이 틀리면 request.body를 읽을 때 오류를 던진다.
    body = request.body;
    if (typeof body === "string") body = JSON.parse(body);
  } catch {
    return response.status(400).json({ error: "JSON 형식이 올바르지 않습니다." });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 500) return response.status(400).json({ error: "질문은 1~500자로 입력해 주세요." });
  const context = body.context && typeof body.context === "object" ? body.context : {};
  const limited = await recommendLimitResponse(request);
  if (limited) {
    for (const [name, value] of Object.entries(limited.headers)) response.setHeader(name, value);
    return response.status(limited.status).json(limited.body);
  }
  try {
    const result = await recommend(message, context);
    return response.status(200).json(result);
  } catch (error) {
    console.error("recommend failed", error instanceof Error ? error.message : "unknown");
    return response.status(502).json({ error: "추천 서비스에 일시적인 문제가 있습니다." });
  }
}
