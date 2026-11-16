import { assertWritesAllowed, fail, handle, HttpError, readJson, requireUser } from "../server/http.js";
import { executeRentalRequest, runAgentTurn } from "../server/nongnong-agent.js";
import { enforceRateLimit } from "../server/rate-limit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default handle(["POST"], async (request) => {
  const started = Date.now();
  const body = await readJson(request);
  const action = body.action === "execute" ? "execute" : "chat";

  if (action === "chat") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 500) fail(400, "INVALID_MESSAGE", "질문은 1~500자로 입력해 주세요.");
    await enforceRateLimit(request, "recommend");
    const result = await runAgentTurn(message, {
      history: Array.isArray(body.history) ? body.history : [],
      region: typeof body.region === "string" ? body.region : undefined,
    }, { timeoutMs: Math.max(1, 25000 - (Date.now() - started)) });
    if (!result) fail(502, "AGENT_UNAVAILABLE", "농농이가 잠시 답할 수 없어요. 잠시 후 다시 시도해 주세요.");
    return { status: 200, body: result };
  }

  // 사용자가 화면에서 승인한 대여 요청만 실행한다. 모델 응답이 아니라 로그인 사용자 권한으로 처리한다.
  const user = await requireUser(request);
  await assertWritesAllowed();
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!UUID.test(requestId)) fail(400, "INVALID_REQUEST_ID", "요청 식별자가 올바르지 않습니다.");
  const pending = body.pendingAction;
  if (!pending || typeof pending !== "object" || pending.type !== "rental_request") {
    fail(400, "INVALID_ACTION", "승인할 작업 내용이 올바르지 않습니다.");
  }
  await enforceRateLimit(request, "rental", { userId: user.id });
  try {
    const result = await executeRentalRequest(user, pending, { requestId });
    return { status: 200, body: result };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status === 401 || error.status >= 500) throw error;
    return { status: 200, body: { outcome: "failed", code: error.code, message: error.message } };
  }
});
