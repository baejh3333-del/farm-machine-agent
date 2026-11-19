import {
  assertWritesAllowed,
  handle,
  readJson,
  requireUser,
} from "../server/http.js";
import { cancelOrder, createOrder, listOrders } from "../server/cart-orders.js";

export default handle(["GET", "POST"], async (request) => {
  const user = await requireUser(request);

  if (request.method === "GET") {
    const result = await listOrders(user.id);
    return { status: 200, body: result };
  }

  await assertWritesAllowed();
  const body = await readJson(request);

  if (body.action === "cancel") {
    const result = await cancelOrder(user.id, body.id);
    return { status: 200, body: result };
  }

  const result = await createOrder(user.id, body);
  return { status: result.idempotent ? 200 : 201, body: { order: result.order, cart: result.cart } };
});
