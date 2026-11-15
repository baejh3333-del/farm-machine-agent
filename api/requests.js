import { assertWritesAllowed, fail, handle, readJson, requireUser } from "../server/http.js";
import {
  approveRentalRequest,
  cancelRentalRequest,
  createRentalRequest,
  listRequestsForUser,
  rejectRentalRequest,
} from "../server/rentals.js";

export default handle(["GET", "POST"], async (request) => {
  const user = await requireUser(request);

  if (request.method === "GET") {
    const data = await listRequestsForUser(user.id);
    return { status: 200, body: data };
  }

  await assertWritesAllowed();
  const body = await readJson(request);
  const action = typeof body.action === "string" ? body.action.trim() : "";

  switch (action) {
    case "create": {
      const result = await createRentalRequest(user, body);
      return { status: result.status, body: { request: result.request, idempotent: result.idempotent } };
    }
    case "approve": {
      const result = await approveRentalRequest(user, body.id);
      return { status: result.status, body: { request: result.request, idempotent: result.idempotent } };
    }
    case "reject": {
      const result = await rejectRentalRequest(user, body.id);
      return { status: result.status, body: { request: result.request, idempotent: result.idempotent } };
    }
    case "cancel": {
      const result = await cancelRentalRequest(user, body.id);
      return { status: result.status, body: { request: result.request, idempotent: result.idempotent } };
    }
    default:
      fail(400, "UNKNOWN_ACTION", "지원하지 않는 대여 요청 작업입니다.");
  }
});
