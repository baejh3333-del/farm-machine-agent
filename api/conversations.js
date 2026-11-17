import { assertWritesAllowed, fail, handle, queryParams, readJson, requireUser } from "../server/http.js";
import { notifyAlimtalkSafe } from "../server/integrations/alimtalk.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import {
  dismissAiDraft,
  getConversationMessages,
  listConversationsForUser,
  sendMessage,
  updateConversationAiPolicy,
} from "../server/chat.js";
import { runDelegatedChatReply, scheduleDelegatedReply } from "../server/delegated-chat.js";

export default handle(["GET", "POST"], async (request) => {
  const user = await requireUser(request);

  if (request.method === "GET") {
    const query = queryParams(request);
    const conversationId = query.get("conversationId");
    const listingId = query.get("listingId");
    const afterSeq = query.get("after_seq") ?? query.get("afterSeq");
    const beforeSeq = query.get("before_seq") ?? query.get("beforeSeq");
    const limit = query.get("limit");

    if (conversationId || (listingId && query.get("mode") !== "list")) {
      const result = await getConversationMessages(user.id, {
        conversationId,
        listingId,
        afterSeq,
        beforeSeq,
        limit,
      });
      return { status: 200, body: result };
    }

    const conversations = await listConversationsForUser(user.id, { listingId });
    return { status: 200, body: { conversations } };
  }

  await assertWritesAllowed();
  await enforceRateLimit(request, "message", { userId: user.id });
  const body = await readJson(request);
  const action = typeof body.action === "string" ? body.action.trim() : "send";

  if (action === "update_ai_policy") {
    const result = await updateConversationAiPolicy(user, body);
    const conv = result.conversation;
    const roleMode = result.role === "buyer" ? conv?.buyerAiMode : conv?.ownerAiMode;
    let aiReplyScheduled = false;
    if (
      conv &&
      roleMode === "autonomous" &&
      !conv.aiPausedReason &&
      conv.lastMessage &&
      conv.lastMessage.senderId !== user.id &&
      conv.lastMessage.senderKind !== "system"
    ) {
      await scheduleDelegatedReply({
        conversationId: conv.id,
        triggerSeq: conv.lastMessage.seq,
        targetRole: result.role,
      });
      aiReplyScheduled = true;
    }
    return { status: 200, body: { ...result, aiReplyScheduled } };
  }

  if (action === "dismiss_ai_draft") {
    const result = await dismissAiDraft(user, body);
    return { status: 200, body: result };
  }

  if (action === "generate_ai_draft") {
    await enforceRateLimit(request, "recommend", { userId: user.id });
    const convState = await getConversationMessages(user.id, {
      conversationId: body.conversationId ?? null,
      listingId: body.listingId ?? null,
      limit: 1,
    });
    if (!convState.conversation) {
      fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
    }
    const conv = convState.conversation;
    const targetRole = conv.buyerId === user.id ? "buyer" : "owner";
    const mode = targetRole === "buyer" ? conv.buyerAiMode : conv.ownerAiMode;
    if (mode !== "copilot" && mode !== "autonomous") {
      fail(400, "AI_MODE_OFF", "대리 응대 모드를 먼저 켜 주세요.");
    }
    const replyResult = await runDelegatedChatReply({
      conversationId: conv.id,
      triggerSeq: conv.lastSeq,
      targetRole,
      forceDraft: true,
    });
    const refreshed = await getConversationMessages(user.id, { conversationId: conv.id, limit: 1 });
    return {
      status: 200,
      body: {
        conversation: refreshed.conversation,
        result: replyResult,
      },
    };
  }

  if (action !== "send") {
    fail(400, "UNKNOWN_ACTION", "지원하지 않는 대화 요청입니다.");
  }
  const result = await sendMessage(user, body);
  if (!result.idempotent && body.recipientPhone) {
    notifyAlimtalkSafe({
      to: body.recipientPhone,
      templateKey: "chat_message",
      variables: {
        senderName: user.name,
        listingTitle: result.conversation?.listingTitle,
        preview: result.message?.body,
      },
    });
  }

  let aiReplyScheduled = false;
  const conv = result.conversation;
  const msgKind = result.message?.senderKind ?? "human";
  if (!result.idempotent && conv && msgKind !== "system" && !conv.aiPausedReason) {
    const targetRole = conv.buyerId === user.id ? "owner" : "buyer";
    const targetMode = targetRole === "owner" ? conv.ownerAiMode : conv.buyerAiMode;
    if (targetMode === "autonomous" || targetMode === "copilot") {
      await scheduleDelegatedReply({
        conversationId: conv.id,
        triggerSeq: result.message.seq,
        targetRole,
      });
      aiReplyScheduled = true;
    }
  }

  return {
    status: result.status,
    body: {
      conversation: result.conversation,
      message: result.message,
      idempotent: result.idempotent,
      aiReplyScheduled,
    },
  };
});
