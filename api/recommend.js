import { recommend } from "../server/agent.js";
import { recommendationQuota } from "../server/recommend-rate-limit.js";

const maxBodyBytes = 10000;

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
    .end(JSON.stringify(data));
}

async function readBody(request) {
  if (Number(request.headers["content-length"]) > maxBodyBytes) return undefined;
  if (request.body !== undefined) {
    const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    return Buffer.byteLength(body) <= maxBodyBytes ? JSON.parse(body) : undefined;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      request.resume();
      return undefined;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "POST만 지원합니다." });
  }
  let body;
  try { body = await readBody(request); }
  catch { return json(response, 400, { error: "JSON 형식이 올바르지 않습니다." }); }
  if (body === undefined) return json(response, 413, { error: "요청 본문이 너무 큽니다." });
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 500) return json(response, 400, { error: "질문은 1~500자로 입력해 주세요." });
  const context = body.context && typeof body.context === "object" ? body.context : {};
  const quota = await recommendationQuota(request).catch((error) => {
    console.error("recommendation rate limit unavailable", error.code || error.name);
    return "guide";
  });
  if (quota === "limited") {
    response.setHeader("Retry-After", "60");
    return json(response, 429, { error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." });
  }
  try {
    const result = await recommend(message, context, { allowModel: quota === "allow" });
    return json(response, 200, result);
  } catch (error) {
    console.error("recommend failed", error instanceof Error ? error.message : "unknown");
    return json(response, 502, { error: "추천 서비스에 일시적인 문제가 있습니다." });
  }
}
