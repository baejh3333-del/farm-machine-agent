import { fail, handle, query, readJson, requireUser } from "../server/http.js";
import { getConversation, listConversations, openConversation, sendMessage } from "../server/chat.js";

// GET  /api/conversations              내 대화 목록(구매자·소유자 모두)
// GET  /api/conversations?id=...       대화와 메시지
// POST /api/conversations?action=open  { listingId } 구매자가 문의 시작(이미 있으면 그 대화)
// POST /api/conversations?action=send  { id, body } 메시지 보내기
export default handle(["GET", "POST"], async (request) => {
  if (request.method === "GET") {
    const user = await requireUser(request);
    const id = query(request).get("id");
    return { body: id ? await getConversation(user, id) : { conversations: await listConversations(user) } };
  }
  const body = readJson(request);
  const user = await requireUser(request);
  const action = query(request).get("action");
  if (action === "open") return { body: await openConversation(user, body) };
  if (action === "send") return { body: await sendMessage(user, body) };
  fail(404, "UNKNOWN_ACTION", "지원하지 않는 요청입니다.");
});
