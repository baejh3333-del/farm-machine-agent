import { fromNodeHeaders } from "better-auth/node";
import { sessionUser } from "./account-auth.js";
import { isWritesFrozen } from "./migrator.js";

export const MAX_JSON_BYTES = 16_384;
export const MAX_UPLOAD_JSON_BYTES = 2_000_000;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(status, code, message) {
  throw new HttpError(status, code, message);
}

export function expectedOrigin(request) {
  const https = process.env.VERCEL || process.env.BETTER_AUTH_URL?.startsWith("https://");
  return `${https ? "https" : "http"}://${request.headers.host}`;
}

export async function currentUser(request) {
  return sessionUser(fromNodeHeaders(request.headers));
}

export async function requireUser(request) {
  const user = await currentUser(request);
  if (!user) fail(401, "LOGIN_REQUIRED", "로그인이 필요합니다.");
  return user;
}

export async function assertWritesAllowed() {
  if (await isWritesFrozen()) {
    fail(503, "WRITES_FROZEN", "현재 점검 중으로 일시적으로 변경 작업이 제한되었습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export async function readJson(request, { maxBytes = MAX_JSON_BYTES } = {}) {
  if (request.headers.origin !== expectedOrigin(request)) {
    fail(403, "INVALID_ORIGIN", "허용되지 않은 요청 출처입니다.");
  }
  const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    fail(415, "INVALID_CONTENT_TYPE", "JSON 형식의 요청만 지원합니다.");
  }
  const declaredLen = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    fail(413, "BODY_TOO_LARGE", "요청 크기가 허용 한도를 초과했습니다.");
  }

  let body;
  try {
    if (request.body !== undefined) {
      if (typeof request.body === "string" || Buffer.isBuffer(request.body)) {
        const text = String(request.body);
        if (Buffer.byteLength(text, "utf8") > maxBytes) fail(413, "BODY_TOO_LARGE", "요청 크기가 허용 한도를 초과했습니다.");
        body = JSON.parse(text);
      } else {
        const serialized = JSON.stringify(request.body);
        if (Buffer.byteLength(serialized, "utf8") > maxBytes) fail(413, "BODY_TOO_LARGE", "요청 크기가 허용 한도를 초과했습니다.");
        body = request.body;
      }
    } else {
      const chunks = [];
      let total = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) {
          request.resume();
          fail(413, "BODY_TOO_LARGE", "요청 크기가 허용 한도를 초과했습니다.");
        }
        chunks.push(buf);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, "INVALID_JSON", "JSON 형식이 올바르지 않습니다.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "INVALID_BODY", "요청 본문 형식이 올바르지 않습니다.");
  }
  return body;
}

export function queryParams(request) {
  return new URL(request.url, "http://localhost").searchParams;
}

export function sendJson(response, status, body, extraHeaders = {}) {
  response
    .writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    })
    .end(JSON.stringify(body));
}

export function handle(methods, fn) {
  return async function apiHandler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    if (!methods.includes(request.method)) {
      response.setHeader("Allow", methods.join(", "));
      return sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", error: "지원하지 않는 요청 방식입니다." });
    }
    try {
      const result = await fn(request, response);
      if (response.writableEnded) return;
      const status = result?.status ?? 200;
      const body = result?.body ?? {};
      return sendJson(response, status, body, result?.headers);
    } catch (error) {
      if (error instanceof HttpError) {
        return sendJson(response, error.status, { code: error.code, error: error.message });
      }
      console.error("api failed", request.url?.split("?")[0], error instanceof Error ? error.message : "unknown");
      return sendJson(response, 503, { code: "UNAVAILABLE", error: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
    }
  };
}
