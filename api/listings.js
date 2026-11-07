import { listListings } from "../server/listings-db.js";
import { currentUser, handle, query, requireUser } from "../server/http.js";

// GET /api/listings          공개 매물 (로그인했으면 owner로 내 매물 표시)
// GET /api/listings?owner=me 내 매물만
export default handle(["GET"], async (request) => {
  const ownerOnly = query(request).get("owner") === "me";
  const user = ownerOnly ? await requireUser(request) : await currentUser(request);
  return { body: { listings: await listListings({ viewerId: user?.id ?? null, ownerOnly }) } };
});
