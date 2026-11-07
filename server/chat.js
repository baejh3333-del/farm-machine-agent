import { getPool } from "./db.js";
import { fail } from "./http.js";
import { DEMO_OWNER_ID, ensureSchema } from "./schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 대화는 (매물, 구매자) 한 쌍마다 하나다. 볼 수 있는 사람은 그 구매자와 매물 소유자뿐이다.
const CONVERSATION_SELECT = `
  SELECT c.id, c.listing_id, l.title AS listing_title, c.buyer_id, l.owner_id,
         buyer.name AS buyer_name, owner.name AS owner_name, c.created_at,
         m.body AS last_body, m.sender_id AS last_sender, m.created_at AS last_at
  FROM conversation c
  JOIN listing l ON l.id = c.listing_id
  JOIN "user" buyer ON buyer.id = c.buyer_id
  JOIN "user" owner ON owner.id = l.owner_id
  LEFT JOIN LATERAL (
    SELECT body, sender_id, created_at FROM message
    WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
  ) m ON true`;

function toConversation(row, user) {
  const role = row.buyer_id === user.id ? "buyer" : "owner";
  return {
    id: row.id, listingId: row.listing_id, listingTitle: row.listing_title, role,
    counterpartName: role === "buyer" ? row.owner_name : row.buyer_name,
    demoOwner: row.owner_id === DEMO_OWNER_ID,
    lastMessage: row.last_body ? { body: row.last_body, fromOwner: row.last_sender === row.owner_id, at: row.last_at } : null,
  };
}

async function findConversation(user, id) {
  if (typeof id !== "string" || !UUID.test(id)) fail(404, "NOT_FOUND", "대화를 찾지 못했어요.");
  const { rows: [row] } = await getPool().query(
    `${CONVERSATION_SELECT} WHERE c.id = $1 AND (c.buyer_id = $2 OR l.owner_id = $2)`, [id, user.id]);
  if (!row) fail(404, "NOT_FOUND", "대화를 찾지 못했어요.");
  return row;
}

export async function openConversation(user, input) {
  await ensureSchema();
  const listingId = typeof input.listingId === "string" ? input.listingId.slice(0, 80) : "";
  const pool = getPool();
  const { rows: [listing] } = await pool.query("SELECT owner_id FROM listing WHERE id = $1 AND status <> 'hidden'", [listingId]);
  if (!listing) fail(404, "NOT_FOUND", "매물을 찾지 못했어요.");
  if (listing.owner_id === user.id) fail(409, "OWN_LISTING", "내 매물에는 문의할 수 없어요.");
  const { rows: [{ id }] } = await pool.query(`
    INSERT INTO conversation (listing_id, buyer_id) VALUES ($1, $2)
    ON CONFLICT (listing_id, buyer_id) DO UPDATE SET listing_id = EXCLUDED.listing_id
    RETURNING id
  `, [listingId, user.id]);
  return getConversation(user, id);
}

export async function listConversations(user) {
  await ensureSchema();
  const { rows } = await getPool().query(`
    ${CONVERSATION_SELECT}
    WHERE c.buyer_id = $1 OR l.owner_id = $1
    ORDER BY COALESCE(m.created_at, c.created_at) DESC
    LIMIT 50
  `, [user.id]);
  return rows.map((row) => toConversation(row, user));
}

export async function getConversation(user, id) {
  await ensureSchema();
  const row = await findConversation(user, id);
  const { rows } = await getPool().query(`
    SELECT id, sender_id, body, created_at FROM (
      SELECT id, sender_id, body, created_at FROM message
      WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 200
    ) recent ORDER BY created_at
  `, [row.id]);
  return {
    conversation: toConversation(row, user),
    messages: rows.map((message) => ({
      id: message.id, body: message.body, createdAt: message.created_at,
      mine: message.sender_id === user.id, fromOwner: message.sender_id === row.owner_id,
    })),
  };
}

export async function sendMessage(user, input) {
  await ensureSchema();
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > 500) fail(400, "INVALID_MESSAGE", "메시지는 1~500자로 입력해 주세요.");
  const row = await findConversation(user, input.id);
  await getPool().query("INSERT INTO message (conversation_id, sender_id, body) VALUES ($1, $2, $3)", [row.id, user.id, body]);
  return getConversation(user, row.id);
}
