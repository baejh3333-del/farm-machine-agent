import {
  assertWritesAllowed,
  currentUser,
  fail,
  handle,
  MAX_UPLOAD_JSON_BYTES,
  queryParams,
  readJson,
  requireUser,
} from "../server/http.js";
import { fetchListings } from "../server/listings-db.js";
import { createListing, updateListing } from "../server/listings-service.js";
import { enforceRateLimit } from "../server/rate-limit.js";

export default handle(["GET", "POST"], async (request) => {
  if (request.method === "GET") {
    const viewer = await currentUser(request);
    const query = queryParams(request);
    const includeRemoved = query.get("includeRemoved") === "1";
    const ownerOnly = query.get("owner") === "1";
    const listings = await fetchListings({
      viewerId: viewer?.id ?? null,
      includeRemoved,
      ownerOnly,
    });
    return { status: 200, body: { listings } };
  }

  const user = await requireUser(request);
  await assertWritesAllowed();
  // 2MB 본문 읽기와 이미지 재인코딩 전에 확인한다.
  await enforceRateLimit(request, "listing", { userId: user.id });
  const body = await readJson(request, { maxBytes: MAX_UPLOAD_JSON_BYTES });
  const action = typeof body.action === "string" ? body.action.trim() : "create";

  if (action === "create") {
    const result = await createListing(user, body);
    return { status: result.status, body: { listing: result.listing, idempotent: result.idempotent } };
  }

  if (action === "update" || action === "status" || action === "remove") {
    const result = await updateListing(user, { ...body, action });
    return { status: result.status, body: { listing: result.listing, idempotent: result.idempotent } };
  }

  fail(400, "UNKNOWN_ACTION", "지원하지 않는 매물 요청입니다.");
});
