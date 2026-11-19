import {
  assertWritesAllowed,
  expectedOrigin,
  fail,
  handle,
  queryParams,
  readJson,
  requireUser,
} from "../server/http.js";
import {
  addOrUpdateCartItem,
  clearCart,
  getCart,
  removeCartItem,
  syncGuestCart,
} from "../server/cart-orders.js";

export default handle(["GET", "POST", "DELETE"], async (request) => {
  const user = await requireUser(request);

  if (request.method === "GET") {
    const cart = await getCart(user.id);
    return { status: 200, body: cart };
  }

  await assertWritesAllowed();

  if (request.method === "DELETE") {
    if (request.headers.origin !== expectedOrigin(request)) {
      fail(403, "INVALID_ORIGIN", "허용되지 않은 요청 출처입니다.");
    }
    const params = queryParams(request);
    if (params.get("all") === "1" || params.get("all") === "true") {
      const cart = await clearCart(user.id);
      return { status: 200, body: cart };
    }
    const id = params.get("id");
    const listingId = params.get("listingId");
    if (id || listingId) {
      const cart = await removeCartItem(user.id, { id, listingId });
      return { status: 200, body: cart };
    }
    const body = await readJson(request);
    if (body.all) {
      const cart = await clearCart(user.id);
      return { status: 200, body: cart };
    }
    const cart = await removeCartItem(user.id, { id: body.id, listingId: body.listingId });
    return { status: 200, body: cart };
  }

  const body = await readJson(request);
  const action = body.action || "add";

  switch (action) {
    case "add":
    case "upsert":
    case "update": {
      const result = await addOrUpdateCartItem(user.id, body);
      return { status: 200, body: result };
    }
    case "remove": {
      const result = await removeCartItem(user.id, { id: body.id, listingId: body.listingId });
      return { status: 200, body: result };
    }
    case "clear": {
      const result = await clearCart(user.id);
      return { status: 200, body: result };
    }
    case "sync": {
      const result = await syncGuestCart(user.id, body.items);
      return { status: 200, body: result };
    }
    default:
      fail(400, "UNKNOWN_ACTION", "지원하지 않는 장바구니 요청입니다.");
  }
});
