import { assertWritesAllowed, fail, handle, queryParams, readJson, requireUser } from "../server/http.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import { getConversationMessages, listConversationsForUser, sendMessage } from "../server/chat.js";

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
  if (action !== "send") {
    fail(400, "UNKNOWN_ACTION", "지원하지 않는 대화 요청입니다.");
  }
  const result = await sendMessage(user, body);
  return {
    status: result.status,
    body: {
      conversation: result.conversation,
      message: result.message,
      idempotent: result.idempotent,
    },
  };
});
