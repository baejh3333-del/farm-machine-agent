import { rentalDays } from "../src/data/compatibility.js";
import { getPool, kstToday, withTransaction } from "./db.js";
import { fail, HttpError } from "./http.js";
import { formatIsoDate, normalizeText, requireUuid } from "./validate.js";

export const MAX_RENTAL_DAYS = 365;

function deriveRequestFields(row, approvedRanges, viewerId, today) {
  const start = formatIsoDate(row.start_date);
  const end = formatIsoDate(row.end_date);
  const ownerId = row.owner_id;
  const requesterId = row.requester_id;
  const isOwner = viewerId === ownerId;
  const isRequester = viewerId === requesterId;

  let derivedState = row.status;
  if (row.status === "pending") {
    const overlapsApproved = approvedRanges.some((r) => !(end < r.start || start > r.end));
    if (overlapsApproved) derivedState = "conflict";
    else if (row.operator_conflict) derivedState = "operator_conflict";
    else if (start < today) derivedState = "expired";
    else derivedState = "approvable";
  } else if (row.status === "approved") {
    if (today < start) derivedState = "upcoming";
    else if (today <= end) derivedState = "active";
    else derivedState = "completed";
  }

  return {
    id: String(row.id),
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    listingType: row.listing_type,
    listingStatus: row.listing_status,
    listingRegion: row.listing_region,
    listingOwnerId: ownerId,
    listingOwnerName: row.owner_name,
    requesterId,
    requesterName: row.requester_name,
    start,
    end,
    note: row.note ?? "",
    dailyPrice: Number(row.daily_price),
    rentalOperator: row.rental_operator ?? null,
    days: Number(row.days),
    totalPrice: Number(row.total_price),
    status: row.status,
    derivedState,
    canApprove: isOwner && row.status === "pending" && derivedState === "approvable" && row.listing_status === "open" && row.listing_type === "rent",
    canReject: isOwner && row.status === "pending",
    canCancel:
      (row.status === "pending" && isRequester) ||
      (row.status === "approved" && today < start && (isRequester || isOwner)),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    decidedAt: row.decided_at ? (row.decided_at instanceof Date ? row.decided_at.toISOString() : String(row.decided_at)) : null,
  };
}

async function fetchRequestWithJoins(db, requestId) {
  const res = await db.query(
    `SELECT r.*,
            l.owner_id,
            l.title AS listing_title,
            l.type AS listing_type,
            l.status AS listing_status,
            l.region AS listing_region,
            ou.name AS owner_name,
            ru.name AS requester_name,
            EXISTS (
              SELECT 1 FROM rental_requests booked_operator
              WHERE booked_operator.operator_owner_id = r.operator_owner_id
                AND booked_operator.status = 'approved'
                AND daterange(booked_operator.start_date, booked_operator.end_date, '[]')
                    && daterange(r.start_date, r.end_date, '[]')
            ) AS operator_conflict
     FROM rental_requests r
     JOIN listings l ON l.id = r.listing_id
     JOIN "user" ou ON ou.id = l.owner_id
     JOIN "user" ru ON ru.id = r.requester_id
     WHERE r.id = $1
     LIMIT 1`,
    [requestId]
  );
  return res.rows[0] || null;
}

async function fetchApprovedRangesByListing(db, listingIds) {
  const map = new Map();
  if (!listingIds.length) return map;
  const res = await db.query(
    `SELECT listing_id, start_date, end_date
     FROM rental_requests
     WHERE status = 'approved' AND listing_id = ANY($1::text[])`,
    [listingIds]
  );
  for (const r of res.rows) {
    const list = map.get(r.listing_id) || [];
    list.push({ start: formatIsoDate(r.start_date), end: formatIsoDate(r.end_date) });
    map.set(r.listing_id, list);
  }
  return map;
}

async function buildSingleRequestDto(db, requestId, viewerId, today) {
  const row = await fetchRequestWithJoins(db, requestId);
  if (!row) return null;
  const rangesMap = await fetchApprovedRangesByListing(db, [row.listing_id]);
  return deriveRequestFields(row, rangesMap.get(row.listing_id) || [], viewerId, today);
}

export async function listRequestsForUser(userId, { today = kstToday(), pool = getPool() } = {}) {
  const res = await pool.query(
    `SELECT r.*,
            l.owner_id,
            l.title AS listing_title,
            l.type AS listing_type,
            l.status AS listing_status,
            l.region AS listing_region,
            ou.name AS owner_name,
            ru.name AS requester_name,
            EXISTS (
              SELECT 1 FROM rental_requests booked_operator
              WHERE booked_operator.operator_owner_id = r.operator_owner_id
                AND booked_operator.status = 'approved'
                AND daterange(booked_operator.start_date, booked_operator.end_date, '[]')
                    && daterange(r.start_date, r.end_date, '[]')
            ) AS operator_conflict
     FROM rental_requests r
     JOIN listings l ON l.id = r.listing_id
     JOIN "user" ou ON ou.id = l.owner_id
     JOIN "user" ru ON ru.id = r.requester_id
     WHERE r.requester_id = $1 OR l.owner_id = $1
     ORDER BY r.created_at DESC, r.id DESC`,
    [userId]
  );

  const listingIds = [...new Set(res.rows.map((r) => r.listing_id))];
  const rangesMap = await fetchApprovedRangesByListing(pool, listingIds);

  const incoming = [];
  const outgoing = [];
  for (const row of res.rows) {
    const dto = deriveRequestFields(row, rangesMap.get(row.listing_id) || [], userId, today);
    if (row.owner_id === userId) incoming.push(dto);
    if (row.requester_id === userId) outgoing.push(dto);
  }

  const approvableCount = incoming.filter((r) => r.canApprove).length;
  return { incoming, outgoing, approvableCount };
}

function sameOperator(left, right) {
  return left?.name === right?.name
    && left?.experience === right?.experience
    && left?.dailyPrice === right?.dailyPrice;
}

function matchesRentalIdempotency(existing, userId, listingId, start, end, note, operator) {
  return (
    existing.requester_id === userId &&
    existing.listing_id === listingId &&
    formatIsoDate(existing.start_date) === start &&
    formatIsoDate(existing.end_date) === end &&
    (existing.note ?? "") === note &&
    sameOperator(existing.rental_operator, operator)
  );
}

export async function createRentalRequest(user, payload, { today = kstToday(), pool = getPool() } = {}) {
  const id = requireUuid(payload?.id, "대여 요청 ID");
  const listingId = normalizeText(payload?.listingId, { min: 1, max: 80, field: "매물 ID" });
  const start = normalizeText(payload?.start ?? payload?.from, { min: 10, max: 10, field: "대여 시작일" });
  const end = normalizeText(payload?.end ?? payload?.to, { min: 10, max: 10, field: "반납일" });
  const days = rentalDays(start, end);
  if (!days || start < today) {
    fail(400, "INVALID_RENTAL_PERIOD", "오늘 이후의 올바른 대여 시작일과 반납일을 선택해 주세요.");
  }
  if (days > MAX_RENTAL_DAYS) {
    fail(400, "RENTAL_PERIOD_TOO_LONG", `대여 기간은 최대 ${MAX_RENTAL_DAYS}일까지 요청할 수 있습니다.`);
  }
  const note = normalizeText(payload?.note ?? "", { min: 0, max: 500, field: "요청 메모", allowNewlines: true });

  const operator = payload?.rentalOperator ?? null;
  if (operator !== null && (
    typeof operator.name !== "string" ||
    typeof operator.experience !== "string" ||
    !Number.isSafeInteger(operator.dailyPrice) || operator.dailyPrice < 1
  )) {
    fail(400, "INVALID_OPERATOR_QUOTE", "작업자 정보와 요금을 다시 확인해 주세요.");
  }

  try {
    return await withTransaction(async (client) => {
      const existingRes = await client.query(`SELECT * FROM rental_requests WHERE id = $1 FOR UPDATE`, [id]);
      if (existingRes.rows.length) {
        const existing = existingRes.rows[0];
        if (!matchesRentalIdempotency(existing, user.id, listingId, start, end, note, operator)) {
          fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
        }
        const requestDto = await buildSingleRequestDto(client, id, user.id, today);
        return { status: 200, idempotent: true, request: requestDto };
      }

      const listingRes = await client.query(`SELECT * FROM listings WHERE id = $1 FOR UPDATE`, [listingId]);
      if (!listingRes.rows.length || listingRes.rows[0].status === "removed") {
        fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
      }
      const listing = listingRes.rows[0];

      if (listing.owner_id === user.id) {
        fail(403, "SELF_RENTAL_FORBIDDEN", "본인이 등록한 매물에는 대여를 요청할 수 없습니다.");
      }
      if (listing.type !== "rent") {
        fail(409, "INVALID_LISTING_TYPE", "대여 매물에만 대여를 요청할 수 있습니다.");
      }
      if (listing.status !== "open") {
        fail(409, "LISTING_UNAVAILABLE", "현재 대여 요청을 받을 수 없는 상태입니다.");
      }

      const overlapRes = await client.query(
        `SELECT 1 FROM rental_requests
         WHERE listing_id = $1 AND status = 'approved'
           AND NOT (end_date < $2::date OR start_date > $3::date)
         LIMIT 1`,
        [listingId, start, end]
      );
      if (overlapRes.rows.length) {
        fail(409, "DATE_OVERLAP", "선택한 기간에는 이미 확정된 예약이 있습니다.");
      }

      const dailyPrice = Number(listing.price);
      if (operator && !sameOperator(listing.rental_operator, operator)) {
        fail(409, "OPERATOR_OPTION_CHANGED", "대행운용서비스 내용이 바뀌었어요. 새 요금과 작업자 이력을 확인해 주세요.");
      }
      const acceptedOperator = operator ? listing.rental_operator : null;
      const operatorDailyPrice = acceptedOperator?.dailyPrice ?? 0;
      const totalPrice = (dailyPrice + operatorDailyPrice) * days;

      await client.query(
        `INSERT INTO rental_requests (
          id, listing_id, requester_id, start_date, end_date,
          note, daily_price, days, total_price, status, rental_operator, operator_owner_id, operator_daily_price
        ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, 'pending', $10, $11, $12)`,
        [id, listingId, user.id, start, end, note, dailyPrice, days, totalPrice, acceptedOperator, acceptedOperator ? listing.owner_id : null, operatorDailyPrice]
      );

      const requestDto = await buildSingleRequestDto(client, id, user.id, today);
      if (requestDto.derivedState === "operator_conflict") {
        fail(409, "OPERATOR_DATE_OVERLAP", "같은 기간에 이미 확정된 대행운용서비스(작업자 동반) 예약이 있습니다.");
      }
      return { status: 201, idempotent: false, request: requestDto };
    }, pool);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.code === "23505") {
      const existingRes = await pool.query(`SELECT * FROM rental_requests WHERE id = $1 LIMIT 1`, [id]);
      const existing = existingRes.rows[0];
      if (existing && matchesRentalIdempotency(existing, user.id, listingId, start, end, note, operator)) {
        const requestDto = await buildSingleRequestDto(pool, id, user.id, today);
        return { status: 200, idempotent: true, request: requestDto };
      }
      fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
    }
    throw error;
  }
}

async function lockListingAndRequest(client, requestId) {
  const lookup = await client.query(`SELECT listing_id FROM rental_requests WHERE id = $1`, [requestId]);
  if (!lookup.rows.length) {
    fail(404, "REQUEST_NOT_FOUND", "대여 요청을 찾을 수 없습니다.");
  }
  const listingId = lookup.rows[0].listing_id;

  // Fixed lock order: listing row FIRST, rental_requests row SECOND
  const listingRes = await client.query(`SELECT * FROM listings WHERE id = $1 FOR UPDATE`, [listingId]);
  const reqRes = await client.query(`SELECT * FROM rental_requests WHERE id = $1 FOR UPDATE`, [requestId]);
  if (!listingRes.rows.length || !reqRes.rows.length) {
    fail(404, "REQUEST_NOT_FOUND", "대여 요청을 찾을 수 없습니다.");
  }
  return { listing: listingRes.rows[0], req: reqRes.rows[0] };
}

export async function approveRentalRequest(user, requestId, { today = kstToday(), pool = getPool() } = {}) {
  const id = requireUuid(requestId, "대여 요청 ID");

  return withTransaction(async (client) => {
    const { listing, req } = await lockListingAndRequest(client, id);
    if (listing.owner_id !== user.id) {
      fail(403, "FORBIDDEN", "매물 등록자만 대여 요청을 승인할 수 있습니다.");
    }
    if (req.status === "approved") {
      const requestDto = await buildSingleRequestDto(client, id, user.id, today);
      return { status: 200, idempotent: true, request: requestDto };
    }
    if (req.status !== "pending") {
      fail(409, "INVALID_STATE_TRANSITION", "대기 중인 요청만 승인할 수 있습니다.");
    }
    if (listing.status === "removed" || listing.type !== "rent" || listing.status !== "open") {
      fail(409, "LISTING_UNAVAILABLE", "현재 승인할 수 없는 매물 상태입니다.");
    }

    const start = formatIsoDate(req.start_date);
    const end = formatIsoDate(req.end_date);
    if (start < today) {
      fail(409, "REQUEST_EXPIRED", "대여 시작일이 지난 요청은 승인할 수 없습니다.");
    }

    const overlapRes = await client.query(
      `SELECT 1 FROM rental_requests
       WHERE listing_id = $1 AND status = 'approved' AND id <> $2
         AND NOT (end_date < $3::date OR start_date > $4::date)
       LIMIT 1`,
      [listing.id, id, start, end]
    );
    if (overlapRes.rows.length) {
      fail(409, "DATE_OVERLAP", "이미 승인된 다른 예약과 기간이 겹칩니다.");
    }

    try {
      await client.query(
        `UPDATE rental_requests SET status = 'approved', decided_at = now() WHERE id = $1`,
        [id]
      );
    } catch (error) {
      if (error?.constraint === "rental_requests_operator_no_overlap") {
        fail(409, "OPERATOR_DATE_OVERLAP", "같은 기간에 이미 확정된 대행운용서비스(작업자 동반) 예약이 있습니다.");
      }
      if (error?.code === "23P01") {
        fail(409, "DATE_OVERLAP", "이미 승인된 다른 예약과 기간이 겹칩니다.");
      }
      throw error;
    }

    const requestDto = await buildSingleRequestDto(client, id, user.id, today);
    return { status: 200, idempotent: false, request: requestDto };
  }, pool);
}

export async function rejectRentalRequest(user, requestId, { today = kstToday(), pool = getPool() } = {}) {
  const id = requireUuid(requestId, "대여 요청 ID");

  return withTransaction(async (client) => {
    const { listing, req } = await lockListingAndRequest(client, id);
    if (listing.owner_id !== user.id) {
      fail(403, "FORBIDDEN", "매물 등록자만 대여 요청을 거절할 수 있습니다.");
    }
    if (req.status === "rejected") {
      const requestDto = await buildSingleRequestDto(client, id, user.id, today);
      return { status: 200, idempotent: true, request: requestDto };
    }
    if (req.status !== "pending") {
      fail(409, "INVALID_STATE_TRANSITION", "대기 중인 요청만 거절할 수 있습니다.");
    }

    await client.query(
      `UPDATE rental_requests SET status = 'rejected', decided_at = now() WHERE id = $1`,
      [id]
    );
    const requestDto = await buildSingleRequestDto(client, id, user.id, today);
    return { status: 200, idempotent: false, request: requestDto };
  }, pool);
}

export async function cancelRentalRequest(user, requestId, { today = kstToday(), pool = getPool() } = {}) {
  const id = requireUuid(requestId, "대여 요청 ID");

  return withTransaction(async (client) => {
    const { listing, req } = await lockListingAndRequest(client, id);
    const isRequester = req.requester_id === user.id;
    const isOwner = listing.owner_id === user.id;
    if (!isRequester && !isOwner) {
      fail(403, "FORBIDDEN", "대여 예약을 취소할 권한이 없습니다.");
    }

    if (req.status === "cancelled") {
      const requestDto = await buildSingleRequestDto(client, id, user.id, today);
      return { status: 200, idempotent: true, request: requestDto };
    }

    if (req.status === "pending") {
      if (!isRequester) {
        fail(403, "FORBIDDEN", "요청자만 대기 중인 요청을 취소할 수 있습니다.");
      }
    } else if (req.status === "approved") {
      const start = formatIsoDate(req.start_date);
      if (!(today < start)) {
        fail(409, "CANCEL_WINDOW_PASSED", "대여 시작일 당일 이후에는 확정된 예약을 취소할 수 없습니다.");
      }
    } else {
      fail(409, "INVALID_STATE_TRANSITION", "거절된 요청은 취소할 수 없습니다.");
    }

    await client.query(
      `UPDATE rental_requests SET status = 'cancelled', decided_at = COALESCE(decided_at, now()) WHERE id = $1`,
      [id]
    );
    const requestDto = await buildSingleRequestDto(client, id, user.id, today);
    return { status: 200, idempotent: false, request: requestDto };
  }, pool);
}
