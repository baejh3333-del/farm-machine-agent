import { assertWritesAllowed, fail, handle, readJson, requireUser } from "../server/http.js";
import { notifyAlimtalkSafe } from "../server/integrations/alimtalk.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import {
  approveRentalRequest,
  cancelRentalRequest,
  createRentalRequest,
  listRequestsForUser,
  rejectRentalRequest,
} from "../server/rentals.js";

const RENTAL_TEMPLATE_BY_ACTION = {
  create: "rental_requested",
  approve: "rental_approved",
  reject: "rental_rejected",
  cancel: "rental_cancelled",
};

function dispatchRentalNotification(action, result, recipientPhone) {
  const templateKey = RENTAL_TEMPLATE_BY_ACTION[action];
  if (!templateKey || result?.idempotent || !recipientPhone) return;
  const req = result.request;
  notifyAlimtalkSafe({
    to: recipientPhone,
    templateKey,
    variables: {
      requesterName: req?.requesterName,
      listingTitle: req?.listingTitle,
      start: req?.start,
      end: req?.end,
    },
  });
}

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
      await enforceRateLimit(request, "rental", { userId: user.id });
      const result = await createRentalRequest(user, body);
      dispatchRentalNotification(action, result, body.recipientPhone);
      return { status: result.status, body: { request: result.request, idempotent: result.idempotent } };
    }
    case "approve": {
      const result = await approveRentalRequest(user, body.id);
      dispatchRentalNotification(action, result, body.recipientPhone);
      return { status: result.status, body: { request: result.request, idempotent: result.idempotent } };
    }
    case "reject": {
      const result = await rejectRentalRequest(user, body.id);
      dispatchRentalNotification(action, result, body.recipientPhone);
      return { status: result.status, body: { request: result.request, idempotent: result.idempotent } };
    }
    case "cancel": {
      const result = await cancelRentalRequest(user, body.id);
      dispatchRentalNotification(action, result, body.recipientPhone);
      return { status: result.status, body: { request: result.request, idempotent: result.idempotent } };
    }
    default:
      fail(400, "UNKNOWN_ACTION", "지원하지 않는 대여 요청 작업입니다.");
  }
});
