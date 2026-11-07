import { getPool } from "./db.js";
import { fail } from "./http.js";
import { DEMO_OWNER_ID, ensureSchema } from "./schema.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DAYS = 60;
const MAX_PENDING = 20;

export const kstToday = (now = Date.now()) => new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);

function validDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const REQUEST_COLUMNS = `
  r.id, r.listing_id, l.title AS listing_title, r.start_date::text AS start_date, r.end_date::text AS end_date,
  r.note, r.status, r.created_at, r.decided_at, r.requester_id, l.owner_id, u.name AS requester_name`;
const REQUEST_FROM = `
  rental_request r JOIN listing l ON l.id = r.listing_id JOIN "user" u ON u.id = r.requester_id`;

function toRequest(row) {
  return {
    id: row.id, listingId: row.listing_id, listingTitle: row.listing_title,
    start: row.start_date, end: row.end_date, note: row.note, status: row.status,
    createdAt: row.created_at, decidedAt: row.decided_at,
    requesterName: row.requester_name,
    demoOwner: row.owner_id === DEMO_OWNER_ID,
  };
}

async function findRequest(id) {
  const { rows } = await getPool().query(`SELECT ${REQUEST_COLUMNS} FROM ${REQUEST_FROM} WHERE r.id = $1`, [id]);
  return rows[0];
}

// 신청할 때는 겹치는 예약만 확인하고 예약을 잡지는 않는다. 최종 확정은 승인할 때 한다.
export async function createRequest(user, input) {
  await ensureSchema();
  const listingId = typeof input.listingId === "string" ? input.listingId.slice(0, 80) : "";
  const { start, end } = input;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  if (!listingId) fail(400, "INVALID_LISTING", "매물을 선택해 주세요.");
  if (!validDate(start) || !validDate(end) || end < start) fail(400, "INVALID_PERIOD", "시작일과 반납일을 확인해 주세요.");
  if (start < kstToday()) fail(400, "PAST_DATE", "오늘 이후 날짜를 선택해 주세요.");
  if ((Date.parse(end) - Date.parse(start)) / 86_400_000 + 1 > MAX_DAYS) fail(400, "PERIOD_TOO_LONG", `대여 기간은 ${MAX_DAYS}일 이내로 선택해 주세요.`);
  const pool = getPool();
  const { rows: [{ pending }] } = await pool.query(
    "SELECT count(*)::int AS pending FROM rental_request WHERE requester_id = $1 AND status = 'pending'", [user.id]);
  if (pending >= MAX_PENDING) fail(429, "TOO_MANY_PENDING", "대기 중인 신청이 너무 많아요. 기존 신청을 정리한 뒤 다시 시도해 주세요.");

  const { rows } = await pool.query(`
    INSERT INTO rental_request (listing_id, requester_id, start_date, end_date, note)
    SELECT l.id, $2, $3, $4, $5
    FROM listing l
    WHERE l.id = $1 AND l.type = 'rent' AND l.status = 'open' AND l.condition <> 'repair'
      AND l.owner_id <> $2
      AND NOT EXISTS (
        SELECT 1 FROM booking b
        WHERE b.listing_id = l.id AND b.period && daterange($3::date, $4::date, '[]'))
    ON CONFLICT (listing_id, requester_id, start_date, end_date) WHERE status = 'pending' DO NOTHING
    RETURNING id
  `, [listingId, user.id, start, end, note]);
  if (rows[0]) return { created: true, request: toRequest(await findRequest(rows[0].id)) };

  // 넣지 못한 이유를 다시 확인해서 알려 준다.
  const { rows: [reason] } = await pool.query(`
    SELECT l.type, l.status, l.condition, l.owner_id,
      EXISTS (SELECT 1 FROM booking b WHERE b.listing_id = l.id AND b.period && daterange($3::date, $4::date, '[]')) AS overlap,
      (SELECT r.id FROM rental_request r WHERE r.listing_id = l.id AND r.requester_id = $2
        AND r.start_date = $3 AND r.end_date = $4 AND r.status = 'pending') AS existing
    FROM listing l WHERE l.id = $1 AND l.status <> 'hidden'
  `, [listingId, user.id, start, end]);
  if (!reason) fail(404, "NOT_FOUND", "매물을 찾지 못했어요.");
  if (reason.owner_id === user.id) fail(409, "OWN_LISTING", "내 매물에는 대여 신청을 할 수 없어요.");
  if (reason.existing) return { created: false, request: toRequest(await findRequest(reason.existing)) };
  if (reason.overlap) fail(409, "PERIOD_BOOKED", "이미 예약된 기간이 있어요. 다른 날짜를 선택해 주세요.");
  fail(409, "NOT_AVAILABLE", "지금은 대여할 수 없는 매물이에요.");
}

export async function listRequests(user, role) {
  await ensureSchema();
  const ownerView = role === "owner";
  const { rows } = await getPool().query(`
    SELECT ${REQUEST_COLUMNS} FROM ${REQUEST_FROM}
    WHERE ${ownerView ? "l.owner_id" : "r.requester_id"} = $1
    ORDER BY (r.status = 'pending') DESC, r.created_at DESC
    LIMIT 100
  `, [user.id]);
  return rows.map(toRequest);
}

function requireId(id) {
  if (typeof id !== "string" || !UUID.test(id)) fail(404, "NOT_FOUND", "신청을 찾지 못했어요.");
  return id;
}

const APPROVE = `
  WITH target AS (
    SELECT r.id, r.listing_id, r.start_date, r.end_date
    FROM rental_request r JOIN listing l ON l.id = r.listing_id
    WHERE r.id = $1 AND l.owner_id = $2 AND l.type = 'rent' AND r.status = 'pending'
    FOR UPDATE OF r
  ), booked AS (
    INSERT INTO booking (listing_id, request_id, period)
    SELECT listing_id, id, daterange(start_date, end_date, '[]') FROM target
    RETURNING request_id
  )
  UPDATE rental_request SET status = 'approved', decided_at = now()
  WHERE id IN (SELECT request_id FROM booked)
  RETURNING id`;

// 승인은 한 문장으로 처리한다. 예약 삽입이 겹침 제약(booking_no_overlap)에 걸리면 문장 전체가 취소된다.
// 같은 요청을 동시에 승인하면 FOR UPDATE에서 하나씩 처리되고, 뒤의 것은 이미 승인된 상태를 본다.
export async function approveRequest(user, rawId) {
  await ensureSchema();
  const id = requireId(rawId);
  // 겹치는 예약을 동시에 넣으면 서로를 기다리다 Postgres가 한쪽을 교착(40P01)으로 끊을 수 있다.
  // 다시 시도하면 먼저 끝난 쪽이 커밋된 뒤라 겹침(23P01) 또는 성공으로 정리된다.
  for (let attempt = 1; ; attempt += 1) {
    try {
      const { rows } = await getPool().query(APPROVE, [id, user.id]);
      if (rows[0]) return toRequest(await findRequest(id));
      break;
    } catch (error) {
      if (error.code === "23P01") fail(409, "PERIOD_BOOKED", "이 기간에 이미 승인된 예약이 있어요.");
      if (error.code === "40P01" && attempt < 3) continue;
      if (error.code !== "23505") throw error;
      break;
    }
  }
  return decided(user, id, "approved");
}

export async function rejectRequest(user, rawId) {
  await ensureSchema();
  const id = requireId(rawId);
  const { rows } = await getPool().query(`
    UPDATE rental_request r SET status = 'rejected', decided_at = now()
    FROM listing l
    WHERE r.id = $1 AND l.id = r.listing_id AND l.owner_id = $2 AND r.status = 'pending'
    RETURNING r.id
  `, [id, user.id]);
  if (rows[0]) return toRequest(await findRequest(id));
  return decided(user, id, "rejected");
}

// 신청자는 대기 중인 신청, 또는 대여 시작 전인 승인 신청을 취소할 수 있다. 승인 취소면 예약도 지운다.
// 한 문장으로 쓰면, 막 승인되어 커밋된 예약을 그 문장의 스냅샷이 보지 못해 예약이 남을 수 있다.
// 그래서 먼저 행을 잠그고(승인과 순서를 정하고), 다음 문장에서 새 스냅샷으로 예약을 지운다.
export async function cancelRequest(user, rawId) {
  await ensureSchema();
  const id = requireId(rawId);
  const client = await getPool().connect();
  let outcome;
  try {
    await client.query("BEGIN");
    const { rows: [row] } = await client.query(
      "SELECT status, start_date::text AS start_date FROM rental_request WHERE id = $1 AND requester_id = $2 FOR UPDATE",
      [id, user.id]);
    if (!row) outcome = "NOT_FOUND";
    else if (row.status === "cancelled") outcome = "DONE";
    else if (row.status === "approved" && row.start_date <= kstToday()) outcome = "ALREADY_STARTED";
    else if (row.status !== "pending" && row.status !== "approved") outcome = "ALREADY_DECIDED";
    else {
      await client.query("DELETE FROM booking WHERE request_id = $1", [id]);
      await client.query("UPDATE rental_request SET status = 'cancelled', decided_at = now() WHERE id = $1", [id]);
      outcome = "DONE";
    }
    await client.query(outcome === "DONE" ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (outcome === "NOT_FOUND") fail(404, "NOT_FOUND", "신청을 찾지 못했어요.");
  if (outcome === "ALREADY_STARTED") fail(409, "ALREADY_STARTED", "대여 시작일부터는 취소할 수 없어요. 소유 농가에 문의해 주세요.");
  if (outcome === "ALREADY_DECIDED") fail(409, "ALREADY_DECIDED", "이미 처리된 신청이에요.");
  return toRequest(await findRequest(id));
}

// 바뀐 행이 없을 때: 권한이 없거나, 이미 같은 결과이거나(반복 클릭), 다른 결과로 처리된 경우다.
async function decided(user, id, wanted) {
  const row = await findRequest(id);
  if (!row || row.owner_id !== user.id) fail(404, "NOT_FOUND", "신청을 찾지 못했어요.");
  if (row.status === wanted) return toRequest(row);
  fail(409, "ALREADY_DECIDED", "이미 처리된 신청이에요.");
}
