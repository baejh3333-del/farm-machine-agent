import { randomUUID } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import { sessionUser } from "./account-auth.js";
import { isWritesFrozen } from "./migrator.js";

export const MAX_JSON_BYTES = 16_384;
export const MAX_UPLOAD_JSON_BYTES = 2_000_000;

export class HttpError extends Error {
  constructor(status, code, message, headers = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
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

const PG_CODE_RE = /^[0-9A-Z]{5}$/;
// 직렬화 실패·교착·잠금/문장 타임아웃·서버 종료/시작 중: 다시 시도하면 성공할 수 있는 오류
const RETRYABLE_PG_CODES = new Set(["40001", "40P01", "55P03", "57014", "57P01", "57P02", "57P03", "25P03"]);
const RETRYABLE_NET_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * 예상하지 못한 오류를 응답 상태로 분류한다.
 * 일시적 오류만 503(재시도 안내)으로, 영구 오류는 400/409/500으로 돌려준다.
 */
export function classifyError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = error instanceof Error ? error.message : "";
  const pgCode = PG_CODE_RE.test(code) ? code : "";
  if (
    RETRYABLE_PG_CODES.has(pgCode) ||
    /^(08|53)/.test(pgCode) ||
    RETRYABLE_NET_CODES.has(code) ||
    /timeout|Connection terminated/i.test(message)
  ) {
    return { status: 503, code: "UNAVAILABLE", message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }
  // 없는 테이블·열: 배포된 코드보다 DB 마이그레이션이 늦은 상태. 500 대신 503으로 알려 원인을 구분한다.
  if (pgCode === "42P01" || pgCode === "42703") {
    return { status: 503, code: "SCHEMA_NOT_READY", message: "서비스 준비 중입니다. 잠시 후 다시 시도해 주세요." };
  }
  if (/^22/.test(pgCode) || pgCode === "23502" || pgCode === "23514") {
    return { status: 400, code: "INVALID_INPUT", message: "입력값을 처리할 수 없습니다. 내용을 확인해 주세요." };
  }
  if (/^23/.test(pgCode)) {
    return { status: 409, code: "CONFLICT", message: "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요." };
  }
  return { status: 500, code: "SERVER_ERROR", message: "요청을 처리하지 못했습니다." };
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
        return sendJson(response, error.status, { code: error.code, error: error.message }, error.headers);
      }
      const outcome = classifyError(error);
      const requestId = String(request.headers?.["x-vercel-id"] || randomUUID());
      // detail/hint에는 사용자 입력이 섞일 수 있어 남기지 않고, 원인 추적에 필요한 식별 정보와 스택만 기록한다.
      console.error(
        "api failed",
        JSON.stringify({
          requestId,
          method: request.method,
          path: request.url?.split("?")[0],
          status: outcome.status,
          errorCode: typeof error?.code === "string" ? error.code : null,
          constraint: error?.constraint ?? null,
          table: error?.table ?? null,
        }),
        error instanceof Error ? error.stack : String(error)
      );
      if (response.headersSent) {
        if (!response.writableEnded) response.end();
        return;
      }
      return sendJson(response, outcome.status, { code: outcome.code, error: outcome.message, requestId });
    }
  };
}
