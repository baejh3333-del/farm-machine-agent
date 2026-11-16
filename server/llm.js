// 농농이 AI 모델 호출 모듈. Z.ai(GLM)와 Anthropic(Claude)을 지원한다.
// 에이전트 코드는 Anthropic Messages 형식(content 블록: text / tool_use / tool_result)으로만 다루고,
// Z.ai를 쓸 때는 이 모듈이 OpenAI 호환 chat/completions 형식으로 바꿔 보내고 받는다.
// 키는 서버 환경 변수에만 두고 브라우저에 노출하지 않는다.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
export const DEFAULT_ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";
export const DEFAULT_ZAI_MODEL = "glm-5.3";
export const DEFAULT_ZAI_VISION_MODEL = "glm-5.3-flash";

const env = (name) => process.env[name]?.trim() || "";

/** 사용할 공급자. AI_PROVIDER로 지정하고, 없으면 키가 있는 쪽(Z.ai 우선)을 쓴다. */
export function llmProvider() {
  const chosen = env("AI_PROVIDER").toLowerCase();
  if (chosen === "zai") return env("ZAI_API_KEY") ? "zai" : null;
  if (chosen === "anthropic") return env("ANTHROPIC_API_KEY") ? "anthropic" : null;
  if (env("ZAI_API_KEY")) return "zai";
  if (env("ANTHROPIC_API_KEY")) return "anthropic";
  return null;
}

export function llmEnabled() {
  return llmProvider() !== null;
}

export function llmModel(provider = llmProvider(), { vision = false } = {}) {
  if (provider === "zai") {
    return vision ? env("ZAI_VISION_MODEL") || DEFAULT_ZAI_VISION_MODEL : env("ZAI_MODEL") || DEFAULT_ZAI_MODEL;
  }
  return env("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL;
}

// ---------- Z.ai(OpenAI 호환) 형식 변환 ----------

function stringify(content) {
  return typeof content === "string" ? content : JSON.stringify(content);
}

/** Anthropic 형식 대화를 OpenAI 호환 messages로 바꾼다. */
export function toOpenAiMessages(system, messages) {
  const out = system ? [{ role: "system", content: system }] : [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    const blocks = Array.isArray(message.content) ? message.content : [];
    if (message.role === "assistant") {
      const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
      const toolCalls = blocks
        .filter((block) => block.type === "tool_use")
        .map((block) => ({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }));
      out.push({ role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    const parts = [];
    for (const block of blocks) {
      if (block.type === "tool_result") out.push({ role: "tool", tool_call_id: block.tool_use_id, content: stringify(block.content) });
      else if (block.type === "text") parts.push({ type: "text", text: block.text });
      else if (block.type === "image" && block.source?.type === "base64") {
        parts.push({ type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } });
      }
    }
    if (parts.some((part) => part.type === "image_url")) out.push({ role: "user", content: parts });
    else if (parts.length) out.push({ role: "user", content: parts.map((part) => part.text).join("\n") });
  }
  return out;
}

export function hasImage(messages) {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((block) => block.type === "image"));
}

export function toOpenAiTools(tools = []) {
  return tools.map(({ name, description, input_schema: parameters }) => ({ type: "function", function: { name, description, parameters } }));
}

function parseJson(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(cleaned);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** OpenAI 호환 응답을 Anthropic 형식 content 블록으로 바꾼다. */
export function fromOpenAiResponse(data, forcedTool) {
  const message = data?.choices?.[0]?.message;
  if (!message) return null;
  const text = typeof message.content === "string" ? message.content : "";
  if (forcedTool) {
    const input = parseJson(text);
    return input ? { content: [{ type: "tool_use", id: "forced_0", name: forcedTool, input }] } : null;
  }
  const content = [];
  if (text.trim()) content.push({ type: "text", text });
  (message.tool_calls || []).forEach((call, index) => {
    if (call?.type && call.type !== "function") return;
    content.push({
      type: "tool_use",
      id: call.id || `call_${index}`,
      name: call.function?.name,
      input: parseJson(call.function?.arguments) ?? {},
    });
  });
  return { content };
}

async function callZai({ system, messages, tools, toolChoice, maxTokens, timeoutMs }) {
  // Z.ai는 tool_choice로 auto만 지원하므로, 구조화 결과가 필요하면 JSON 모드로 받아 도구 호출처럼 돌려준다.
  const forced = toolChoice?.type === "tool" ? tools?.find((tool) => tool.name === toolChoice.name) : null;
  const systemText = forced
    ? `${system}\n\n다른 설명 없이 아래 JSON 스키마에 맞는 JSON 객체 하나만 출력하라.\n${JSON.stringify(forced.input_schema)}`
    : system;
  const base = (env("ZAI_BASE_URL") || DEFAULT_ZAI_BASE_URL).replace(/\/+$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${env("ZAI_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: llmModel("zai", { vision: hasImage(messages) }),
      max_tokens: maxTokens,
      messages: toOpenAiMessages(systemText, messages),
      thinking: { type: "disabled" },
      ...(forced ? { response_format: { type: "json_object" } } : {}),
      ...(!forced && tools?.length ? { tools: toOpenAiTools(tools), tool_choice: "auto" } : {}),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    console.warn("Z.ai request failed", { status: response.status, code: data?.error?.code });
    return null;
  }
  return fromOpenAiResponse(await response.json(), forced?.name);
}

async function callAnthropic({ system, messages, tools, toolChoice, maxTokens, timeoutMs }) {
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "x-api-key": env("ANTHROPIC_API_KEY"),
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: llmModel("anthropic"),
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools?.length ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    console.warn("Anthropic request failed", { status: response.status, type: data?.error?.type });
    return null;
  }
  const data = await response.json();
  return Array.isArray(data?.content) ? data : null;
}

/**
 * 모델을 한 번 호출한다. 결과는 공급자와 관계없이 { content: [text | tool_use 블록] } 형식이다.
 * 실패하면 예외 대신 null을 돌려 호출부가 규칙 기반 안내로 대체하게 한다.
 */
export async function callLLM({ system, messages, tools, toolChoice, maxTokens = 800, timeoutMs = 9000 }) {
  const provider = llmProvider();
  if (!provider) return null;
  try {
    const call = provider === "zai" ? callZai : callAnthropic;
    const result = await call({ system, messages, tools, toolChoice, maxTokens, timeoutMs });
    return Array.isArray(result?.content) ? result : null;
  } catch (error) {
    console.warn("AI response unavailable", { provider, error: error?.name });
    return null;
  }
}

/**
 * 지정한 JSON 스키마로 구조화된 결과를 받는다.
 * 입력은 JSON 문자열로만 전달해 사용자 문장이 지시문과 섞이지 않게 한다.
 */
export async function askLLMJson(system, input, { name, description, schema }, options = {}) {
  const data = await callLLM({
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
