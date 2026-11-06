import { recommend } from "../server/agent.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "POST만 지원합니다." });
  let body = request.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return response.status(400).json({ error: "JSON 형식이 올바르지 않습니다." }); }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 500) return response.status(400).json({ error: "질문은 1~500자로 입력해 주세요." });
  const context = body.context && typeof body.context === "object" ? body.context : {};
  try {
    const result = await recommend(message, context);
    return response.status(200).json(result);
  } catch (error) {
    console.error("recommend failed", error instanceof Error ? error.message : "unknown");
    return response.status(502).json({ error: "추천 서비스에 일시적인 문제가 있습니다." });
  }
}
