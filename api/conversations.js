import { assertWritesAllowed, fail, handle, queryParams, readJson, requireUser } from "../server/http.js";
import { notifyAlimtalkSafe } from "../server/integrations/alimtalk.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import {
  getConversationMessages,
  isTradeAction,
  listConversationsForUser,
  markConversationRead,
  runTradeAction,
  sendMessage,
} from "../server/chat.js";

const MESSAGE_RATE_ACTIONS = new Set(["send", "mark_read"]);

export default handle(["GET", "POST"], async (request) => {
  const user = await requireUser(request);

  if (request.method === "GET") {
    // GET은 읽기 전용이다. 읽음 처리 등 어떤 쓰기도 하지 않는다.
    const query = queryParams(request);
    const mode = query.get("mode");
    const conversationId = query.get("conversationId");
    const listingId = query.get("listingId");
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

  if (action === "mark_read") {
    const result = await markConversationRead(user, body);
    return { status: 200, body: result };
  }

  if (isTradeAction(action)) {
    const result = await runTradeAction(user, action, body);
    return { status: 200, body: result };
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

  return {
    status: result.status,
    body: {
      conversation: result.conversation,
      message: result.message,
      idempotent: result.idempotent,
    },
  };
});
