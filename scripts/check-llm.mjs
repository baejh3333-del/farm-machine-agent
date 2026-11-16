import { callLLM, llmProvider } from "../server/llm.js";

// Run only from a trusted server environment. Do not print keys, prompts,
// provider response bodies or custom endpoint URLs.
const modes = [
  { name: "text" },
  { name: "structured", tools: [{ name: "health_result", description: "Return the health result", input_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } }], toolChoice: { type: "tool", name: "health_result" } },
];
for (const mode of modes) {
  let failure;
  const result = await callLLM({
    system: "This is a health check. Respond with the JSON object {\"ok\":true}.",
    messages: [{ role: "user", content: "Health check" }],
    tools: mode.tools,
    toolChoice: mode.toolChoice,
    maxTokens: 100,
    onError: (diagnostic) => { failure = diagnostic; },
  });
  const ok = mode.name === "structured"
    ? result?.content.some((block) => block.type === "tool_use" && block.name === "health_result" && block.input?.ok === true)
    : result?.content.some((block) => block.type === "text" && block.text?.trim());
  console.log(JSON.stringify({ check: mode.name, provider: llmProvider(), ok: Boolean(ok), ...(failure ? { failure } : {}) }));
  if (!ok) {
    process.exitCode = 1;
    break;
  }
}
