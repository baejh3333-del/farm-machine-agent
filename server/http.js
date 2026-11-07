import { fromNodeHeaders } from "better-auth/node";
import { sessionUser } from "./account-auth.js";

export const MAX_JSON_BYTES = 10_000;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status, code, message) => { throw new HttpError(status, code, message); };

export async function currentUser(request) {
  return sessionUser(fromNodeHeaders(request.headers));
}

export async function requireUser(request) {
  const user = await currentUser(request);
  if (!user) fail(401, "LOGIN_REQUIRED", "로그인이 필요합니다.");
  return user;
}

function expectedOrigin(request) {
  const https = process.env.VERCEL || process.env.BETTER_AUTH_URL?.startsWith("https://");
  return `${https ? "https" : "http"}://${request.headers.host}`;
}

// 쓰기 요청은 /api/account와 같은 규칙을 따른다: 같은 출처, JSON, 크기 제한.
export function readJson(request) {
  if (request.headers.origin !== expectedOrigin(request)) fail(403, "INVALID_ORIGIN", "허용되지 않은 요청입니다.");
  const type = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") fail(415, "INVALID_CONTENT_TYPE", "JSON 요청만 받습니다.");
  if (Number(request.headers["content-length"]) > MAX_JSON_BYTES) fail(413, "BODY_TOO_LARGE", "요청이 너무 큽니다.");
  let body;
  try {
    // Vercel은 JSON을 미리 파싱하고, 형식이 틀리면 request.body를 읽을 때 오류를 던진다.
    body = request.body;
    if (typeof body === "string" || Buffer.isBuffer(body)) body = JSON.parse(String(body));
  } catch {
    fail(400, "INVALID_JSON", "JSON 형식이 올바르지 않습니다.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "INVALID_BODY", "요청 형식이 올바르지 않습니다.");
  return body;
}

export function query(request) {
  return new URL(request.url, "http://localhost").searchParams;
}

// 핸들러는 { status, body }를 돌려주거나 HttpError를 던진다.
export function handle(methods, fn) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    if (!methods.includes(request.method)) {
      response.setHeader("Allow", methods.join(", "));
      return response.status(405).json({ code: "METHOD_NOT_ALLOWED", error: "지원하지 않는 요청입니다." });
    }
    try {
      const { status = 200, body } = await fn(request, response);
      return response.status(status).json(body);
    } catch (error) {
      if (error instanceof HttpError) return response.status(error.status).json({ code: error.code, error: error.message });
      console.error("api failed", request.url?.split("?")[0], error instanceof Error ? error.message : "unknown");
      return response.status(503).json({ code: "UNAVAILABLE", error: "잠시 후 다시 시도해 주세요." });
    }
  };
}
