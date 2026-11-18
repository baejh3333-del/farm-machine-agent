import { assertWritesAllowed, fail, handle, queryParams, readJson, requireUser } from "../server/http.js";
import { notifyAlimtalkSafe } from "../server/integrations/alimtalk.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import {
  dismissAiDraft,
  getConversationMessages,
  getListingInboundPolicy,
  isTradeAction,
  listConversationsForUser,
  markConversationRead,
  resumeConversation,
  retryAiJob,
  runTradeAction,
  sendMessage,
  setListingInboundPolicy,
  takeoverConversation,
  updateConversationAiPolicy,
} from "../server/chat.js";
import { runDelegatedChatReply, scheduleDelegatedReply } from "../server/delegated-chat.js";

const MESSAGE_RATE_ACTIONS = new Set(["send", "mark_read", "update_ai_policy", "takeover", "resume", "dismiss_ai_draft", "set_inbound_policy"]);

/** 역할의 유효 모드는 그 역할이 명시적으로 저장한 모드뿐이다(시연 농가 암묵 위임 없음). */
function roleMode(conv, role) {
  return role === "buyer" ? conv.buyerAiMode : conv.ownerAiMode;
}

export default handle(["GET", "POST"], async (request) => {
  const user = await requireUser(request);

  if (request.method === "GET") {
    // GET은 읽기 전용이다. 읽음 처리·정책 변경 등 어떤 쓰기도 하지 않는다.
    const query = queryParams(request);
    const mode = query.get("mode");
    const conversationId = query.get("conversationId");
    const listingId = query.get("listingId");

    if (mode === "inbound_policy") {
      if (!listingId) fail(400, "INVALID_TARGET", "매물을 지정해 주세요.");
      const result = await getListingInboundPolicy(user, listingId);
      return { status: 200, body: result };
    }

    const afterSeq = query.get("after_seq") ?? query.get("afterSeq");
    const beforeSeq = query.get("before_seq") ?? query.get("beforeSeq");
    const limit = query.get("limit");

    if (conversationId || (listingId && mode !== "list")) {
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
  const body = await readJson(request);
  const action = typeof body.action === "string" ? body.action.trim() : "send";
  await enforceRateLimit(request, MESSAGE_RATE_ACTIONS.has(action) ? "message" : "recommend", { userId: user.id });

  if (action === "update_ai_policy") {
    const result = await updateConversationAiPolicy(user, body);
    const conv = result.conversation;
    let aiReplyScheduled = false;
    // 내 역할이 자동 응대이고 일시정지가 없으며, 내가 볼 수 있는 마지막 메시지가 상대방 것일 때만 "내 역할"로 예약한다.
    if (
      conv &&
      roleMode(conv, result.role) === "autonomous" &&
      !conv.aiPausedReason &&
      conv.lastMessage &&
      conv.lastMessage.senderKind !== "system" &&
      conv.lastMessage.senderId !== user.id
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

  if (action === "mark_read") {
    const result = await markConversationRead(user, body);
    return { status: 200, body: result };
  }

  if (action === "takeover") {
    const result = await takeoverConversation(user, body);
    return { status: 200, body: result };
  }

  if (action === "resume") {
    const { resumeTrigger, mode, ...result } = await resumeConversation(user, body);
    let aiReplyScheduled = false;
    if (resumeTrigger && mode === "autonomous") {
      await scheduleDelegatedReply(resumeTrigger);
      aiReplyScheduled = true;
    }
    return { status: 200, body: { ...result, aiReplyScheduled } };
  }

  if (action === "retry_ai_job") {
    const result = await retryAiJob(user, body);
    // 다시 큐에 넣은 "내 역할" 작업을 즉시 처리 경로로도 깨운다(중복 이벤트는 큐가 제거한다).
    await scheduleDelegatedReply({
      conversationId: result.conversation.id,
      triggerSeq: Number(body.triggerSeq),
      targetRole: result.role,
    });
    return { status: 200, body: result };
  }

  if (action === "set_inbound_policy") {
    const result = await setListingInboundPolicy(user, body);
    return { status: 200, body: result };
  }

  if (isTradeAction(action)) {
    const result = await runTradeAction(user, action, body);
    return { status: 200, body: result };
  }

  if (action === "dismiss_ai_draft") {
    const result = await dismissAiDraft(user, body);
    return { status: 200, body: result };
  }

  if (action === "generate_ai_draft") {
    const convState = await getConversationMessages(user.id, {
      conversationId: body.conversationId ?? null,
      listingId: body.listingId ?? null,
      limit: 1,
    });
    if (!convState.conversation) {
      fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
    }
    const conv = convState.conversation;
    const targetRole = conv.myRole;
    const mode = roleMode(conv, targetRole);
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
  if (!result.idempotent && conv && msgKind !== "system" && result.senderRole) {
    // 상대 역할의 대리 응답만 예약한다. 상대가 명시적으로 켠 모드일 때만이며, 상대의 일시정지는 실행 단계에서 다시 확인한다.
    const counterpartRole = result.senderRole === "buyer" ? "owner" : "buyer";
    const counterpartMode = roleMode(conv, counterpartRole);
    if (counterpartMode === "autonomous" || counterpartMode === "copilot") {
      await scheduleDelegatedReply({
        conversationId: conv.id,
        triggerSeq: result.message.seq,
        targetRole: counterpartRole,
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
