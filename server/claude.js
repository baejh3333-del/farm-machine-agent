// Claude Messages API 호출 모듈. 키는 서버 환경 변수에만 두고 브라우저에 노출하지 않는다.
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

export function claudeEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function claudeModel() {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

/**
 * Messages API를 한 번 호출한다. 실패하면 예외 대신 null을 돌려 호출부가 규칙 기반 안내로 대체하게 한다.
 */
export async function callClaude({ system, messages, tools, toolChoice, maxTokens = 800, timeoutMs = 9000 }) {
  if (!claudeEnabled()) return null;
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY.trim(),
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: claudeModel(),
        max_tokens: maxTokens,
        system,
        messages,
        ...(tools?.length ? { tools } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      console.warn("Claude request failed", { status: response.status, type: data?.error?.type });
      return null;
    }
    const data = await response.json();
    return Array.isArray(data?.content) ? data : null;
  } catch (error) {
    console.warn("Claude response unavailable", error?.name);
    return null;
  }
}

/**
 * 지정한 JSON 스키마의 도구를 반드시 호출하게 해서 구조화된 결과를 받는다.
 * 입력은 JSON 문자열로만 전달해 사용자 문장이 지시문과 섞이지 않게 한다.
 */
export async function askClaudeJson(system, input, { name, description, schema }, options = {}) {
  const data = await callClaude({
    system,
    messages: [{ role: "user", content: JSON.stringify(input) }],
    tools: [{ name, description: description || "결과를 구조화해 반환한다.", input_schema: schema }],
    toolChoice: { type: "tool", name },
    maxTokens: options.maxTokens ?? 500,
    timeoutMs: options.timeoutMs ?? 7500,
  });
  const block = data?.content.find((item) => item.type === "tool_use" && item.name === name);
  return block && block.input && typeof block.input === "object" ? block.input : null;
}

export function textOf(data) {
  return (data?.content || []).filter((item) => item.type === "text").map((item) => item.text).join("").trim();
}
