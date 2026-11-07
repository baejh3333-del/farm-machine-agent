import { fail, handle, query, readJson, requireUser } from "../server/http.js";
import { approveRequest, cancelRequest, createRequest, listRequests, rejectRequest } from "../server/rentals.js";

const actions = { approve: approveRequest, reject: rejectRequest, cancel: cancelRequest };

// GET  /api/requests?role=requester|owner   내가 보낸 신청 / 내 매물에 들어온 신청
// POST /api/requests                         { listingId, start, end, note } 대여 신청
// POST /api/requests?action=approve|reject   { id } 소유자 승인·거절
// POST /api/requests?action=cancel           { id } 신청자 취소
export default handle(["GET", "POST"], async (request) => {
  if (request.method === "GET") {
    const user = await requireUser(request);
    const role = query(request).get("role") === "owner" ? "owner" : "requester";
    return { body: { requests: await listRequests(user, role) } };
  }
  const body = readJson(request);
  const user = await requireUser(request);
  const action = query(request).get("action");
  if (!action) {
    const { created, request: rental } = await createRequest(user, body);
    return { status: created ? 201 : 200, body: { request: rental } };
  }
  if (!Object.hasOwn(actions, action)) fail(404, "UNKNOWN_ACTION", "지원하지 않는 요청입니다.");
  return { body: { request: await actions[action](user, body.id) } };
});
