import { getConversationMessages } from "../server/chat.js";
import { runDelegatedChatReply } from "../server/delegated-chat.js";
import { assertWritesAllowed, fail, handle, readJson, requireUser } from "../server/http.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import { requireUuid } from "../server/validate.js";

/**
 * 호출자 "본인 역할"의 대리 응답(초안 또는 자동 응답)을 실행한다.
 * 역할은 서버가 대화 참여 관계로 결정한다. 요청 본문의 targetRole로 상대방 AI를 실행할 수 없다.
 */
export default handle(["POST"], async (request) => {
  const user = await requireUser(request);
  await assertWritesAllowed();
  await enforceRateLimit(request, "recommend", { userId: user.id });

  const body = await readJson(request);
  const conversationId = requireUuid(body?.conversationId, "대화방 ID");

  const convState = await getConversationMessages(user.id, { conversationId, limit: 1 });
  const conv = convState.conversation;
  if (!conv || !conv.myRole) {
    fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
  }

  const selfRole = conv.myRole;
  const requestedRole = body?.targetRole;
  if (requestedRole !== undefined && requestedRole !== null && requestedRole !== selfRole) {
    fail(403, "TARGET_ROLE_FORBIDDEN", "상대방의 대리 응대는 실행할 수 없습니다.");
  }

  const mode = selfRole === "buyer" ? conv.buyerAiMode : conv.ownerAiMode;
  if (mode !== "copilot" && mode !== "autonomous") {
    fail(400, "AI_MODE_OFF", "대리 응대 모드를 먼저 켜 주세요.");
  }

  const forceDraft = typeof body?.forceDraft === "boolean" ? body.forceDraft : mode === "copilot";
  const triggerSeq = body?.triggerSeq != null ? Number(body.triggerSeq) : conv.lastSeq;
  if (!Number.isSafeInteger(triggerSeq) || triggerSeq < 0) {
    fail(400, "INVALID_SEQ", "triggerSeq 파라미터가 올바르지 않습니다.");
  }

  const result = await runDelegatedChatReply({
    conversationId: conv.id,
    triggerSeq,
    targetRole: selfRole,
    forceDraft,
  });

  const refreshed = await getConversationMessages(user.id, { conversationId: conv.id, limit: 1 });
  return {
    status: 200,
    body: {
      conversation: refreshed.conversation,
      result,
    },
  };
});
