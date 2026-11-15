import { fail } from "./http.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function requireUuid(value, label = "요청 식별자") {
  if (!isUuid(value)) {
    fail(400, "INVALID_UUID", `${label} 형식이 올바르지 않습니다.`);
  }
  return value.trim().toLowerCase();
}

export function normalizeText(value, { min = 0, max = 500, field = "입력값", allowNewlines = false } = {}) {
  if (typeof value !== "string") {
    if (min > 0) fail(400, "INVALID_INPUT", `${field}을(를) 입력해 주세요.`);
    return "";
  }
  const normalized = allowNewlines
    ? value.replace(/\r\n/g, "\n").trim()
    : value.replace(/\s+/g, " ").trim();
  if (normalized.length < min || normalized.length > max) {
    fail(400, "INVALID_INPUT", `${field}은(는) ${min > 0 ? `${min}~` : ""}${max}자여야 합니다.`);
  }
  return normalized;
}

export function formatIsoDate(value) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
