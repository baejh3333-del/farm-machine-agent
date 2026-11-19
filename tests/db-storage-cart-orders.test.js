import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import sharp from "sharp";

import authHandler from "../api/auth/[...all].js";
import cartHandler from "../api/cart.js";
import ordersHandler from "../api/orders.js";
import photosHandler from "../api/photos.js";
import { resetAuthCache } from "../server/account-auth.js";
import { createPglitePool, setPool } from "../server/db.js";
import { initEnvironment, inspectDatabase, runMigrations, seedDemoListings } from "../server/migrator.js";
import {
  deletePhotoObject,
  getPhotoObject,
  getPhotoStorageMode,
  listPhotoObjects,
  newListingPhotoKey,
  putPhotoObject,
  reconcilePhotos,
} from "../server/storage.js";

let pool;
let server;
let baseUrl;
let savedEnv;

function patchResponse(res) {
  let code = 200;
  res.status = (c) => {
    code = c;
    return res;
  };
  res.json = (payload) => {
    if (!res.headersSent) {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

async function apiReq(path, { method = "GET", cookie = "", json, headers = {} } = {}) {
  const reqHeaders = { ...headers };
  if (cookie) reqHeaders.cookie = cookie;
  if (method !== "GET" && method !== "HEAD" && !reqHeaders.origin) {
    reqHeaders.origin = baseUrl;
  }
  let body;
  if (json !== undefined) {
    reqHeaders["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers: reqHeaders, body });
  const contentType = res.headers.get("content-type") || "";
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (contentType.includes("application/json")) {
    return { status: res.status, headers: res.headers, setCookie, body: await res.json() };
  }
  return { status: res.status, headers: res.headers, setCookie, buffer: Buffer.from(await res.arrayBuffer()) };
}

async function signUp(email, password, name) {
  const res = await apiReq("/api/auth/sign-up/email", {
    method: "POST",
    json: { email, password, name },
  });
  assert.equal(res.status, 200, `sign-up failed: ${JSON.stringify(res.body)}`);
  const cookie = res.setCookie.map((c) => c.split(";")[0]).join("; ");
  return { user: res.body.user, cookie };
}

test.before(async () => {
  savedEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    OBJECT_STORAGE_DIR: process.env.OBJECT_STORAGE_DIR,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    VERCEL: process.env.VERCEL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  };
  delete process.env.DATABASE_URL;
  delete process.env.OBJECT_STORAGE_DIR;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.VERCEL;
  process.env.BETTER_AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";

  pool = createPglitePool("memory://");
  setPool(pool);
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });
  await seedDemoListings({ env: "test", pool });

  const routes = new Map([
    ["/api/photos", photosHandler],
    ["/api/cart", cartHandler],
    ["/api/orders", ordersHandler],
  ]);

  server = createServer(async (req, res) => {
    patchResponse(res);
    const { pathname } = new URL(req.url || "/", "http://localhost");
    const handler = routes.get(pathname) || (pathname.startsWith("/api/auth/") ? authHandler : null);
    if (!handler) {
      res.writeHead(404).end("Not found");
      return;
    }
    await handler(req, res);
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
  process.env.BETTER_AUTH_URL = baseUrl;
  resetAuthCache();
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (pool) await pool.end();
  setPool(undefined);
  resetAuthCache();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("DB photo storage works without OBJECT_STORAGE_DIR or BLOB_READ_WRITE_TOKEN (including on Vercel)", async () => {
  assert.equal(getPhotoStorageMode(), "db");

  const user = await signUp("photo-user@example.com", "Password123!", "사진농부");
  const pngBuf = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 60, g: 140, b: 80 } },
  }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${pngBuf.toString("base64")}`;

  // Simulate Vercel without Blob token -> must NOT throw 503 OBJECT_STORAGE_UNCONFIGURED
  process.env.VERCEL = "1";
  try {
    const uploadRes = await apiReq("/api/photos", {
      method: "POST",
      cookie: user.cookie,
      headers: { origin: `https://127.0.0.1:${server.address().port}` },
      json: { photoDataUrl: dataUrl, filename: "tractor.png" },
    });
    assert.equal(uploadRes.status, 201);
    assert.ok(uploadRes.body.id, "DB stored_images id must be returned");
    assert.ok(uploadRes.body.key.startsWith("uploads/"));
    assert.ok(uploadRes.body.url.startsWith("/api/photos?key="));

    const byKey = await apiReq(uploadRes.body.url);
    assert.equal(byKey.status, 200);
    assert.equal(byKey.headers.get("content-type"), "image/webp");
    assert.ok(byKey.buffer.length > 0);

    const byId = await apiReq(`/api/photos?id=${encodeURIComponent(uploadRes.body.id)}`);
    assert.equal(byId.status, 200);
    assert.equal(byId.headers.get("content-type"), "image/webp");
    assert.deepEqual(byId.buffer, byKey.buffer);
  } finally {
    delete process.env.VERCEL;
  }

  // Listing photo put/get/list/reconcile/delete in DB mode
  const orphanKey = newListingPhotoKey("db-orphan-listing");
  const saved = await putPhotoObject(orphanKey, Buffer.from("orphan-webp"), "image/webp", { pool });
  assert.ok(saved.id);
  const fetched = await getPhotoObject(orphanKey, { pool });
  assert.equal(fetched?.buffer.toString(), "orphan-webp");

  const listed = await listPhotoObjects({ pool });
  assert.ok(listed.some((item) => item.key === orphanKey));

  // Age the orphan row in DB and reconcile
  await pool.query(
    `UPDATE stored_images SET created_at = now() - interval '2 hours' WHERE storage_key = $1`,
    [orphanKey]
  );
  const rec = await reconcilePhotos({ pool, minAgeMs: 60_000, now: Date.now() });
  assert.ok(rec.deletedKeys.includes(orphanKey));
  assert.equal(await getPhotoObject(orphanKey, { pool }), null);

  const delAgain = await deletePhotoObject(orphanKey, { pool });
  assert.equal(delAgain, false);
});

test("Cart & Orders REST APIs persist to DB, calculate authoritative prices, and enforce user isolation", async () => {
  // Unauthenticated access returns 401
  assert.equal((await apiReq("/api/cart")).status, 401);
  assert.equal((await apiReq("/api/orders")).status, 401);

  const buyerA = await signUp("buyer-a@example.com", "Password123!", "김구매");
  const buyerB = await signUp("buyer-b@example.com", "Password123!", "박다른");

  const rentRes = await pool.query(`SELECT id, price FROM listings WHERE type = 'rent' AND status = 'open' LIMIT 1`);
  const saleRes = await pool.query(`SELECT id, price FROM listings WHERE type = 'sale' AND status = 'open' LIMIT 1`);
  const rentListing = rentRes.rows[0];
  const saleListing = saleRes.rows[0];
  assert.ok(rentListing && saleListing);

  // Empty cart initially
  const emptyCart = await apiReq("/api/cart", { cookie: buyerA.cookie });
  assert.equal(emptyCart.status, 200);
  assert.equal(emptyCart.body.count, 0);
  assert.equal(emptyCart.body.totalAmount, 0);

  // Add rent listing (3 days: 2026-11-20 ~ 2026-11-22)
  const addRent = await apiReq("/api/cart", {
    method: "POST",
    cookie: buyerA.cookie,
    json: { listingId: rentListing.id, startDate: "2026-11-20", endDate: "2026-11-22", quantity: 1 },
  });
  assert.equal(addRent.status, 200);
  assert.equal(addRent.body.count, 1);
  assert.equal(addRent.body.item.days, 3);
  assert.equal(addRent.body.item.subtotal, Number(rentListing.price) * 3);

  // Add sale listing
  const addSale = await apiReq("/api/cart", {
    method: "POST",
    cookie: buyerA.cookie,
    json: { listingId: saleListing.id, quantity: 1 },
  });
  assert.equal(addSale.status, 200);
  assert.equal(addSale.body.count, 2);
  const expectedTotal = Number(rentListing.price) * 3 + Number(saleListing.price);
  assert.equal(addSale.body.totalAmount, expectedTotal);

  // Checkout from cart with idempotency UUID
  const clientOrderId = randomUUID();
  const orderPayload = {
    id: clientOrderId,
    fromCart: true,
    paymentMethod: "card",
    buyerName: "김구매",
    buyerPhone: "010-1234-5678",
    deliveryMethod: "delivery",
    deliveryAddress: "강원도 홍천군 홍천읍 123",
    note: "오전 배송 부탁드립니다.",
  };
  const checkout = await apiReq("/api/orders", {
    method: "POST",
    cookie: buyerA.cookie,
    json: orderPayload,
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.order.id, clientOrderId);
  assert.equal(checkout.body.order.status, "paid");
  assert.equal(checkout.body.order.totalAmount, expectedTotal);
  assert.equal(checkout.body.order.items.length, 2);
  assert.equal(checkout.body.cart.count, 0, "ordered items must be cleared from cart");

  // Idempotent retry returns 200 with same order
  const retry = await apiReq("/api/orders", {
    method: "POST",
    cookie: buyerA.cookie,
    json: orderPayload,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.order.orderNumber, checkout.body.order.orderNumber);

  // Buyer B cannot see Buyer A's orders or cancel them
  const ordersB = await apiReq("/api/orders", { cookie: buyerB.cookie });
  assert.equal(ordersB.status, 200);
  assert.equal(ordersB.body.orders.length, 0);

  const cancelByB = await apiReq("/api/orders", {
    method: "POST",
    cookie: buyerB.cookie,
    json: { action: "cancel", id: clientOrderId },
  });
  assert.equal(cancelByB.status, 403);

  // Buyer A can list & cancel own order
  const ordersA = await apiReq("/api/orders", { cookie: buyerA.cookie });
  assert.equal(ordersA.status, 200);
  assert.equal(ordersA.body.orders.length, 1);

  const cancelByA = await apiReq("/api/orders", {
    method: "POST",
    cookie: buyerA.cookie,
    json: { action: "cancel", id: clientOrderId },
  });
  assert.equal(cancelByA.status, 200);
  assert.equal(cancelByA.body.order.status, "cancelled");

  // Guest cart sync & DELETE /api/cart
  const synced = await apiReq("/api/cart", {
    method: "POST",
    cookie: buyerB.cookie,
    json: { action: "sync", items: [{ listingId: rentListing.id, days: 2 }, { listingId: saleListing.id }] },
  });
  assert.equal(synced.status, 200);
  assert.equal(synced.body.count, 2);

  const delOne = await apiReq(`/api/cart?listingId=${encodeURIComponent(saleListing.id)}`, {
    method: "DELETE",
    cookie: buyerB.cookie,
  });
  assert.equal(delOne.status, 200);
  assert.equal(delOne.body.count, 1);

  const delAll = await apiReq("/api/cart?all=1", {
    method: "DELETE",
    cookie: buyerB.cookie,
  });
  assert.equal(delAll.status, 200);
  assert.equal(delAll.body.count, 0);

  const dbInfo = await inspectDatabase({ pool });
  assert.ok("stored_images" in dbInfo.counts);
  assert.ok("cart_items" in dbInfo.counts);
  assert.ok("orders" in dbInfo.counts);
});
