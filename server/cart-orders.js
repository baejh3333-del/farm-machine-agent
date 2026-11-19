import { randomBytes, randomUUID } from "node:crypto";
import { getPool, kstToday, withTransaction } from "./db.js";
import { fail, HttpError } from "./http.js";
import { photoPublicUrl } from "./storage.js";
import { formatIsoDate, isUuid, normalizeText, requireUuid } from "./validate.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PAYMENT_METHODS = new Set(["card", "bank_transfer", "easy_pay"]);
const VALID_DELIVERY_METHODS = new Set(["pickup", "delivery"]);

function parseOptionalDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !ISO_DATE_RE.test(value.trim())) {
    fail(400, "INVALID_DATE", `${label} 형식이 올바르지 않습니다. (YYYY-MM-DD)`);
  }
  const clean = value.trim();
  const [y, m, d] = clean.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    fail(400, "INVALID_DATE", `${label}이(가) 유효한 날짜가 아닙니다.`);
  }
  return clean;
}

function diffDaysInclusive(startDate, endDate) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  if (endMs < startMs) {
    fail(400, "INVALID_DATE_RANGE", "종료일은 시작일보다 빠를 수 없습니다.");
  }
  const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
  if (days < 1 || days > 365) {
    fail(400, "INVALID_RENTAL_DAYS", "대여 기간은 1일~365일 사이여야 합니다.");
  }
  return days;
}

function parseQuantity(raw) {
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    fail(400, "INVALID_QUANTITY", "수량은 1~20 사이의 정수여야 합니다.");
  }
  return n;
}

function parseDays(raw) {
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    fail(400, "INVALID_RENTAL_DAYS", "대여 기간은 1일~365일 사이여야 합니다.");
  }
  return n;
}

function resolveRentalTerms(listingType, payload = {}) {
  const quantity = parseQuantity(payload.quantity);
  if (listingType !== "rent") {
    return { startDate: null, endDate: null, days: 1, quantity };
  }
  const startDate = parseOptionalDate(payload.startDate, "대여 시작일");
  const endDate = parseOptionalDate(payload.endDate, "대여 종료일");
  if ((startDate && !endDate) || (!startDate && endDate)) {
    fail(400, "INVALID_DATE_RANGE", "대여 시작일과 종료일을 모두 입력해 주세요.");
  }
  const days = startDate && endDate ? diffDaysInclusive(startDate, endDate) : parseDays(payload.days);
  return { startDate, endDate, days, quantity };
}

function computeSubtotal(type, unitPrice, days, quantity) {
  return type === "rent" ? unitPrice * days * quantity : unitPrice * quantity;
}

function toCartItemDto(row) {
  const unitPrice = Number(row.price);
  const days = row.type === "rent" ? Number(row.days) : 1;
  const quantity = Number(row.quantity);
  return {
    id: String(row.id),
    listingId: row.listing_id,
    type: row.type,
    title: row.title,
    brand: row.brand,
    region: row.region,
    machineType: row.machine_type,
    photoUrl: row.photo_key ? photoPublicUrl(row.photo_key) ?? null : null,
    unitPrice,
    quantity,
    startDate: row.start_date ? formatIsoDate(row.start_date) : null,
    endDate: row.end_date ? formatIsoDate(row.end_date) : null,
    days,
    subtotal: computeSubtotal(row.type, unitPrice, days, quantity),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function toOrderDto(row) {
  const items = Array.isArray(row.items) ? row.items : JSON.parse(row.items || "[]");
  return {
    id: String(row.id),
    orderNumber: row.order_number,
    userId: row.user_id,
    status: row.status,
    paymentMethod: row.payment_method,
    totalAmount: Number(row.total_amount),
    buyerName: row.buyer_name,
    buyerPhone: row.buyer_phone,
    deliveryMethod: row.delivery_method,
    deliveryAddress: row.delivery_address,
    note: row.note,
    items,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    paidAt: row.paid_at ? (row.paid_at instanceof Date ? row.paid_at.toISOString() : String(row.paid_at)) : null,
  };
}

function generateOrderNumber() {
  const datePart = kstToday().replace(/-/g, "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `MOA-${datePart}-${suffix}`;
}

export async function getCart(userId, { pool = getPool(), client = null } = {}) {
  const db = client || pool;
  const res = await db.query(
    `SELECT c.id, c.listing_id, c.start_date, c.end_date, c.days, c.quantity, c.created_at, c.updated_at,
            l.type, l.title, l.brand, l.region, l.machine_type, l.price, l.photo_key
     FROM cart_items c
     JOIN listings l ON l.id = c.listing_id
     WHERE c.user_id = $1 AND l.status <> 'removed'
     ORDER BY c.updated_at DESC, c.created_at DESC`,
    [userId]
  );
  const items = res.rows.map(toCartItemDto);
  const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
  return { items, totalAmount, count: items.length };
}

export async function addOrUpdateCartItem(userId, payload, { pool = getPool() } = {}) {
  const listingId = normalizeText(payload?.listingId, { min: 1, max: 80, field: "매물 ID" });

  return withTransaction(async (client) => {
    const listingRes = await client.query(
      `SELECT id, type, status FROM listings WHERE id = $1 LIMIT 1`,
      [listingId]
    );
    const listing = listingRes.rows[0];
    if (!listing || listing.status === "removed") {
      fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
    }

    const terms = resolveRentalTerms(listing.type, payload);
    const upsertRes = await client.query(
      `INSERT INTO cart_items (id, user_id, listing_id, start_date, end_date, days, quantity, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (user_id, listing_id) DO UPDATE SET
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         days = EXCLUDED.days,
         quantity = EXCLUDED.quantity,
         updated_at = now()
       RETURNING id`,
      [randomUUID(), userId, listingId, terms.startDate, terms.endDate, terms.days, terms.quantity]
    );
    const itemId = String(upsertRes.rows[0].id);
    const cart = await getCart(userId, { client });
    const item = cart.items.find((entry) => entry.id === itemId) || null;
    return { item, ...cart };
  }, pool);
}

export async function removeCartItem(userId, { id, listingId } = {}, { pool = getPool() } = {}) {
  return withTransaction(async (client) => {
    if (id) {
      const cleanId = requireUuid(id, "장바구니 항목 ID");
      await client.query(`DELETE FROM cart_items WHERE id = $1 AND user_id = $2`, [cleanId, userId]);
    } else if (listingId) {
      const cleanListingId = normalizeText(listingId, { min: 1, max: 80, field: "매물 ID" });
      await client.query(`DELETE FROM cart_items WHERE listing_id = $1 AND user_id = $2`, [cleanListingId, userId]);
    } else {
      fail(400, "INVALID_INPUT", "삭제할 장바구니 항목 ID 또는 매물 ID가 필요합니다.");
    }
    return getCart(userId, { client });
  }, pool);
}

export async function clearCart(userId, { pool = getPool() } = {}) {
  await pool.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);
  return { items: [], totalAmount: 0, count: 0 };
}

export async function syncGuestCart(userId, rawItems, { pool = getPool() } = {}) {
  const input = Array.isArray(rawItems) ? rawItems.slice(0, 50) : [];
  if (!input.length) {
    return getCart(userId, { pool });
  }

  return withTransaction(async (client) => {
    const candidateIds = [...new Set(
      input
        .map((item) => (typeof item?.listingId === "string" ? item.listingId.trim() : ""))
        .filter((id) => id.length > 0 && id.length <= 80)
    )];
    if (candidateIds.length) {
      const listingsRes = await client.query(
        `SELECT id, type FROM listings WHERE id = ANY($1::text[]) AND status <> 'removed'`,
        [candidateIds]
      );
      const listingById = new Map(listingsRes.rows.map((r) => [r.id, r]));

      for (const entry of input) {
        const listingId = typeof entry?.listingId === "string" ? entry.listingId.trim() : "";
        const listing = listingById.get(listingId);
        if (!listing) continue;
        let terms;
        try {
          terms = resolveRentalTerms(listing.type, entry);
        } catch {
          continue;
        }
        await client.query(
          `INSERT INTO cart_items (id, user_id, listing_id, start_date, end_date, days, quantity, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (user_id, listing_id) DO UPDATE SET
             start_date = EXCLUDED.start_date,
             end_date = EXCLUDED.end_date,
             days = EXCLUDED.days,
             quantity = EXCLUDED.quantity,
             updated_at = now()`,
          [randomUUID(), userId, listingId, terms.startDate, terms.endDate, terms.days, terms.quantity]
        );
      }
    }
    return getCart(userId, { client });
  }, pool);
}

export async function listOrders(userId, { pool = getPool(), limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
  const res = await pool.query(
    `SELECT id, order_number, user_id, status, payment_method, total_amount,
            buyer_name, buyer_phone, delivery_method, delivery_address, note, items, created_at, paid_at
     FROM orders
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );
  return { orders: res.rows.map(toOrderDto) };
}

export async function createOrder(userId, payload, { pool = getPool() } = {}) {
  const orderId = payload?.id !== undefined && payload?.id !== null && payload?.id !== ""
    ? requireUuid(payload.id, "주문 ID")
    : randomUUID();

  const paymentMethod = typeof payload?.paymentMethod === "string" ? payload.paymentMethod.trim() : "";
  if (!VALID_PAYMENT_METHODS.has(paymentMethod)) {
    fail(400, "INVALID_PAYMENT_METHOD", "지원하는 결제 수단(카드결제, 계좌이체, 간편결제)을 선택해 주세요.");
  }

  const deliveryMethod = typeof payload?.deliveryMethod === "string" && payload.deliveryMethod.trim()
    ? payload.deliveryMethod.trim()
    : "pickup";
  if (!VALID_DELIVERY_METHODS.has(deliveryMethod)) {
    fail(400, "INVALID_DELIVERY_METHOD", "수령 방법(직접 수령 또는 배송)을 선택해 주세요.");
  }

  const buyerName = normalizeText(payload?.buyerName, { min: 1, max: 60, field: "주문자 이름" });
  const buyerPhone = normalizeText(payload?.buyerPhone, { min: 1, max: 30, field: "연락처" });
  const deliveryAddress = normalizeText(payload?.deliveryAddress ?? "", {
    min: deliveryMethod === "delivery" ? 1 : 0,
    max: 200,
    field: "배송 주소",
  });
  const note = normalizeText(payload?.note ?? "", { min: 0, max: 500, field: "요청 사항", allowNewlines: true });
  const shouldClearCart = payload?.clearCart !== false;

  try {
    return await withTransaction(async (client) => {
      const existingRes = await client.query(
        `SELECT id, order_number, user_id, status, payment_method, total_amount,
                buyer_name, buyer_phone, delivery_method, delivery_address, note, items, created_at, paid_at
         FROM orders WHERE id = $1 LIMIT 1`,
        [orderId]
      );
      if (existingRes.rows.length) {
        const existing = existingRes.rows[0];
        if (existing.user_id !== userId) {
          fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 주문 식별자와 충돌합니다.");
        }
        const cart = await getCart(userId, { client });
        return { order: toOrderDto(existing), cart, idempotent: true };
      }

      let requestedItems = Array.isArray(payload?.items) ? payload.items : [];
      if (!requestedItems.length && payload?.fromCart) {
        const currentCart = await getCart(userId, { client });
        requestedItems = currentCart.items.map((item) => ({
          listingId: item.listingId,
          startDate: item.startDate,
          endDate: item.endDate,
          days: item.days,
          quantity: item.quantity,
        }));
      }

      if (!requestedItems.length) {
        fail(400, "EMPTY_ORDER", "결제할 항목이 없습니다.");
      }
      if (requestedItems.length > 50) {
        fail(400, "TOO_MANY_ITEMS", "한 번에 최대 50건까지 결제할 수 있습니다.");
      }

      const listingIds = [...new Set(
        requestedItems.map((entry) => normalizeText(entry?.listingId, { min: 1, max: 80, field: "매물 ID" }))
      )];
      const listingsRes = await client.query(
        `SELECT id, type, title, brand, region, machine_type, price, photo_key, status
         FROM listings
         WHERE id = ANY($1::text[]) AND status <> 'removed'`,
        [listingIds]
      );
      const listingById = new Map(listingsRes.rows.map((r) => [r.id, r]));

      const orderItems = [];
      let totalAmount = 0;

      for (const entry of requestedItems) {
        const listingId = normalizeText(entry?.listingId, { min: 1, max: 80, field: "매물 ID" });
        const listing = listingById.get(listingId);
        if (!listing) {
          fail(404, "LISTING_NOT_FOUND", `매물을 찾을 수 없습니다. (${listingId})`);
        }
        const terms = resolveRentalTerms(listing.type, entry);
        const unitPrice = Number(listing.price);
        const subtotal = computeSubtotal(listing.type, unitPrice, terms.days, terms.quantity);
        totalAmount += subtotal;
        orderItems.push({
          listingId: listing.id,
          type: listing.type,
          title: listing.title,
          brand: listing.brand,
          region: listing.region,
          machineType: listing.machine_type,
          photoUrl: listing.photo_key ? photoPublicUrl(listing.photo_key) ?? null : null,
          unitPrice,
          quantity: terms.quantity,
          startDate: terms.startDate,
          endDate: terms.endDate,
          days: terms.days,
          subtotal,
        });
      }

      const orderNumber = generateOrderNumber();
      const insertRes = await client.query(
        `INSERT INTO orders (
           id, order_number, user_id, status, payment_method, total_amount,
           buyer_name, buyer_phone, delivery_method, delivery_address, note, items, paid_at
         ) VALUES (
           $1, $2, $3, 'paid', $4, $5,
           $6, $7, $8, $9, $10, $11::jsonb, now()
         )
         RETURNING id, order_number, user_id, status, payment_method, total_amount,
                   buyer_name, buyer_phone, delivery_method, delivery_address, note, items, created_at, paid_at`,
        [
          orderId,
          orderNumber,
          userId,
          paymentMethod,
          totalAmount,
          buyerName,
          buyerPhone,
          deliveryMethod,
          deliveryAddress,
          note,
          JSON.stringify(orderItems),
        ]
      );

      if (shouldClearCart) {
        await client.query(
          `DELETE FROM cart_items WHERE user_id = $1 AND listing_id = ANY($2::text[])`,
          [userId, listingIds]
        );
      }

      const cart = await getCart(userId, { client });
      return { order: toOrderDto(insertRes.rows[0]), cart, idempotent: false };
    }, pool);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.code === "23505" && isUuid(payload?.id)) {
      const existingRes = await pool.query(
        `SELECT id, order_number, user_id, status, payment_method, total_amount,
                buyer_name, buyer_phone, delivery_method, delivery_address, note, items, created_at, paid_at
         FROM orders WHERE id = $1 LIMIT 1`,
        [orderId]
      );
      const existing = existingRes.rows[0];
      if (existing && existing.user_id === userId) {
        const cart = await getCart(userId, { pool });
        return { order: toOrderDto(existing), cart, idempotent: true };
      }
      fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 주문 식별자와 충돌합니다.");
    }
    throw error;
  }
}

export async function cancelOrder(userId, orderId, { pool = getPool() } = {}) {
  const id = requireUuid(orderId, "주문 ID");
  return withTransaction(async (client) => {
    const res = await client.query(
      `SELECT id, order_number, user_id, status, payment_method, total_amount,
              buyer_name, buyer_phone, delivery_method, delivery_address, note, items, created_at, paid_at
       FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const existing = res.rows[0];
    if (!existing) {
      fail(404, "ORDER_NOT_FOUND", "주문 내역을 찾을 수 없습니다.");
    }
    if (existing.user_id !== userId) {
      fail(403, "FORBIDDEN", "다른 사용자의 주문은 취소할 수 없습니다.");
    }
    if (existing.status === "cancelled") {
      return { order: toOrderDto(existing) };
    }
    const updated = await client.query(
      `UPDATE orders SET status = 'cancelled' WHERE id = $1
       RETURNING id, order_number, user_id, status, payment_method, total_amount,
                 buyer_name, buyer_phone, delivery_method, delivery_address, note, items, created_at, paid_at`,
      [id]
    );
    return { order: toOrderDto(updated.rows[0]) };
  }, pool);
}
