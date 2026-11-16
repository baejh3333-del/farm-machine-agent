import { getConversationMessages } from "../server/chat.js";
import { runDelegatedChatReply } from "../server/delegated-chat.js";
import { assertWritesAllowed, fail, handle, readJson, requireUser } from "../server/http.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import { requireUuid } from "../server/validate.js";

export default handle(["POST"], async (request) => {
  const user = await requireUser(request);
  await assertWritesAllowed();
  await enforceRateLimit(request, "recommend", { userId: user.id });

  const body = await readJson(request);
  const conversationId = requireUuid(body?.conversationId, "대화방 ID");

  const convState = await getConversationMessages(user.id, { conversationId, limit: 1 });
  const conv = convState.conversation;
  if (!conv) {
    fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
  }

  const targetRole = conv.buyerId === user.id ? "buyer" : "owner";
  const mode = targetRole === "buyer" ? conv.buyerAiMode : conv.ownerAiMode;
  if (mode !== "copilot" && mode !== "autonomous") {
    fail(400, "AI_MODE_OFF", "대리 응대 모드를 먼저 켜 주세요.");
  }

  const forceDraft = typeof body?.forceDraft === "boolean" ? body.forceDraft : mode === "copilot";
  const triggerSeq = body?.triggerSeq != null ? Number(body.triggerSeq) : conv.lastSeq;

  const result = await runDelegatedChatReply({
    conversationId: conv.id,
    triggerSeq,
    targetRole,
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
