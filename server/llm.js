// 농농이 AI 모델 호출 모듈. OpenAI(GPT)와 Anthropic(Claude)을 지원한다.
// 에이전트 코드는 Anthropic Messages 형식(content 블록: text / tool_use / tool_result)으로만 다루고,
// OpenAI를 쓸 때는 이 모듈이 OpenAI chat/completions 형식으로 바꿔 보내고 받는다.
// 키는 서버 환경 변수에만 두고 브라우저에 노출하지 않는다.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const env = (name) => process.env[name]?.trim() || "";
// 다음 공급자로 넘어가려면 남아 있어야 하는 최소 시간 예산.
const MIN_FALLBACK_BUDGET_MS = 1_500;

const PROVIDERS = {
  openai: () => Boolean(env("OPENAI_API_KEY")),
  anthropic: () => Boolean(env("ANTHROPIC_API_KEY")),
};

const MODEL_CONFIG = {
  openai: ["OPENAI_MODEL", DEFAULT_OPENAI_MODEL],
  anthropic: ["ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL],
};

/** 사용할 공급자 목록. AI_PROVIDER가 지정되면 그 하나만, 비어 있으면 키가 있는 공급자를 우선순위대로 반환한다. */
export function llmProviders() {
  const chosen = env("AI_PROVIDER").toLowerCase();
  if (chosen) return PROVIDERS[chosen]?.() ? [chosen] : [];
  return Object.keys(PROVIDERS).filter((name) => PROVIDERS[name]());
}

/** 사용할 공급자. AI_PROVIDER로 지정하고, 없으면 키가 있는 쪽(OpenAI → Anthropic 순)을 쓴다. */
export function llmProvider() {
  return llmProviders()[0] || null;
}

export function llmEnabled() {
  return llmProvider() !== null;
}

export function llmModel(provider = llmProvider()) {
  const [key, fallback] = MODEL_CONFIG[provider] || MODEL_CONFIG.anthropic;
  return env(key) || fallback;
}

// ---------- OpenAI 형식 변환 ----------

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

// { type: "web_search" }는 공급자 내장 웹 검색을 뜻하는 표시다. 공급자마다 형식으로 바꿔 보낸다.
const isWebSearch = (tool) => tool?.type === "web_search";

export function toOpenAiTools(tools = []) {
  return tools
    .filter((tool) => !isWebSearch(tool))
    .map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));
}

function toAnthropicTools(tools = []) {
  return tools.map((tool) => (isWebSearch(tool) ? { type: "web_search_20250305", name: "web_search", max_uses: 3 } : tool));
}

function cleanSources(items) {
  const seen = new Set();
  return items
    .filter((item) => typeof item?.url === "string" && /^https?:\/\//.test(item.url) && !seen.has(item.url) && seen.add(item.url))
    .slice(0, 5)
    .map((item) => ({ title: String(item.title || item.url).slice(0, 120), url: item.url }));
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
  const sources = cleanSources((Array.isArray(data.web_search) ? data.web_search : []).map((item) => ({ title: item?.title, url: item?.link })));
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
  return sources.length ? { content, sources } : { content };
}

async function callOpenAi({ system, messages, tools, toolChoice, maxTokens, signal }) {
  // OpenAI 호출. 구조화 결과가 필요하면 JSON 모드로 받아 도구 호출처럼 돌려준다.
  const forced = toolChoice?.type === "tool" ? tools?.find((tool) => tool.name === toolChoice.name) : null;
  const systemText = forced
    ? `${system}\n\n다른 설명 없이 아래 JSON 스키마에 맞는 JSON 객체 하나만 출력하라.\n${JSON.stringify(forced.input_schema)}`
    : system;
  const base = (env("OPENAI_BASE_URL") || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  const callTools = (tools || []).filter((tool) => tool?.type !== "web_search");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${env("OPENAI_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: llmModel("openai"),
      max_completion_tokens: maxTokens,
      messages: toOpenAiMessages(systemText, messages),
      ...(forced ? { response_format: { type: "json_object" } } : {}),
      ...(!forced && callTools.length ? { tools: toOpenAiTools(callTools), tool_choice: "auto" } : {}),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw providerError(response.status, data?.error?.code ?? data?.error?.type);
  }
  return fromOpenAiResponse(await response.json(), forced?.name);
}

async function callAnthropic({ system, messages, tools, toolChoice, maxTokens, signal }) {
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    signal,
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
      ...(tools?.length ? { tools: toAnthropicTools(tools) } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw providerError(response.status, data?.error?.type);
  }
  const data = await response.json();
  if (!Array.isArray(data?.content)) return null;
  const sources = cleanSources(data.content
    .filter((block) => block.type === "web_search_tool_result" && Array.isArray(block.content))
    .flatMap((block) => block.content.map((item) => ({ title: item?.title, url: item?.url }))));
  return sources.length ? { ...data, sources } : data;
}

/**
 * 모델을 한 번 호출한다. 결과는 공급자와 관계없이 { content: [text | tool_use 블록] } 형식이다.
 * 실패하면 예외 대신 null을 돌려 호출부가 규칙 기반 안내로 대체하게 한다.
 */
function providerError(status, code) {
  const error = new Error("LLM provider request failed");
  error.status = status;
  // Only known codes are logged; upstream text may contain input or credentials.
  const value = String(code ?? "");
  error.providerCode = /^(?:\d{4}|authentication_error|permission_error|not_found_error|invalid_request_error|rate_limit_error|overloaded_error|api_error|insufficient_quota|rate_limit_exceeded|invalid_api_key|model_not_found)$/.test(value) ? value : undefined;
  return error;
}

export function classifyLlmError(error) {
  const code = error?.providerCode;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timeout";
  if (code === "1113" || code === "insufficient_quota") return "quota_exhausted";
  if (code === "invalid_api_key" || error?.status === 401) return "authentication";
  if (error?.status === 403) return "permission";
  if (code === "1211" || code === "model_not_found" || error?.status === 404) return "model_or_endpoint";
  if (code === "rate_limit_exceeded" || error?.status === 429) return "rate_limit";
  if (error?.status >= 500) return "provider_unavailable";
  if (error?.status >= 400) return "invalid_request";
  if (error?.name === "SyntaxError" || error?.name === "InvalidLlmResponse") return "invalid_response";
  return "network_or_configuration";
}

export async function callLLM({ system, messages, tools, toolChoice, maxTokens = 800, timeoutMs = 9000, signal, onError }) {
  const providers = llmProviders();
  if (!providers.length) {
    onError?.({ category: env("AI_PROVIDER") && !PROVIDERS[env("AI_PROVIDER").toLowerCase()] ? "invalid_provider" : "missing_key" });
    return null;
  }
  // timeoutMs는 공급자별이 아니라 이 호출 전체의 시간 예산이다. 바깥 signal이 없는 호출자
  // (delegated-chat, askLLMJson)도 공급자 수만큼 대기 시간이 늘지 않게, 남은 예산 안에서만 다음 공급자로 넘어간다.
  const deadline = Date.now() + timeoutMs;
  for (let i = 0; i < providers.length; i += 1) {
    if (signal?.aborted) return null;
    const remainingMs = deadline - Date.now();
    if (i > 0 && remainingMs < MIN_FALLBACK_BUDGET_MS) {
      console.warn("llm_fallback_skipped", { provider: providers[i], remainingMs });
      return null;
    }
    const provider = providers[i];
    const started = Date.now();
    try {
      const call = provider === "anthropic" ? callAnthropic : callOpenAi;
      const timeout = AbortSignal.timeout(Math.max(1, remainingMs));
      const result = await call({ system, messages, tools, toolChoice, maxTokens, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!Array.isArray(result?.content) || !result.content.some((block) =>
        (block.type === "text" && typeof block.text === "string" && block.text.trim()) ||
        (block.type === "tool_use" && typeof block.name === "string" && block.name.trim()))) {
        const error = new Error("Empty or invalid LLM response");
        error.name = "InvalidLlmResponse";
        throw error;
      }
      return result;
    } catch (error) {
      const diagnostic = {
        provider,
        category: classifyLlmError(error),
        status: error?.status,
        code: error?.providerCode,
        elapsedMs: Date.now() - started,
        ...(i < providers.length - 1 ? { fallbackTo: providers[i + 1] } : {}),
      };
      console.warn("llm_request_failed", diagnostic);
      onError?.(diagnostic);
      if (signal?.aborted || i === providers.length - 1) return null;
    }
  }
  return null;
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
