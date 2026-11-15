import { getPool, withTransaction } from "./db.js";
import { fail, HttpError } from "./http.js";
import { normalizeText, requireUuid } from "./validate.js";

function toConversationDto(row, lastMessage = null) {
  return {
    id: String(row.id),
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    listingType: row.listing_type,
    listingStatus: row.listing_status ?? null,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    lastSeq: Number(row.last_seq),
    lastMessage: lastMessage
      ? {
          id: String(lastMessage.id),
          seq: Number(lastMessage.seq),
          senderId: lastMessage.sender_id,
          body: lastMessage.body,
          createdAt: lastMessage.created_at instanceof Date ? lastMessage.created_at.toISOString() : String(lastMessage.created_at),
        }
      : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function toMessageDto(row) {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    seq: Number(row.seq),
    senderId: row.sender_id,
    senderName: row.sender_name ?? null,
    body: row.body,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

async function fetchConversationById(db, conversationId) {
  const res = await db.query(
    `SELECT c.*,
            l.owner_id,
            l.title AS listing_title,
            l.type AS listing_type,
            l.status AS listing_status,
            ou.name AS owner_name,
            bu.name AS buyer_name
     FROM conversations c
     JOIN listings l ON l.id = c.listing_id
     JOIN "user" ou ON ou.id = l.owner_id
     JOIN "user" bu ON bu.id = c.buyer_id
     WHERE c.id = $1
     LIMIT 1`,
    [conversationId]
  );
  return res.rows[0] || null;
}

function matchesIdempotentMessage(row, userId, body, conversationId, listingId) {
  if (row.sender_id !== userId || row.body !== body) return false;
  if (conversationId && String(row.conversation_id).toLowerCase() !== conversationId) return false;
  if (listingId && row.listing_id !== listingId) return false;
  return true;
}

async function findExistingMessage(db, messageId, { lock = false } = {}) {
  const lockClause = lock ? " FOR UPDATE OF m" : " LIMIT 1";
  const res = await db.query(
    `SELECT m.*, c.listing_id, u.name AS sender_name
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN "user" u ON u.id = m.sender_id
     WHERE m.id = $1${lockClause}`,
    [messageId]
  );
  return res.rows[0] || null;
}

export async function sendMessage(user, payload, { pool = getPool() } = {}) {
  const messageId = requireUuid(payload?.id ?? payload?.messageId, "메시지 ID");
  const body = normalizeText(payload?.body, { min: 1, max: 500, field: "메시지 내용", allowNewlines: true });
  const conversationId = payload?.conversationId ? requireUuid(payload.conversationId, "대화방 ID") : null;
  const listingId = payload?.listingId ? normalizeText(payload.listingId, { min: 1, max: 80, field: "매물 ID" }) : null;

  if (!conversationId && !listingId) {
    fail(400, "INVALID_TARGET", "대화방 또는 매물을 지정해 주세요.");
  }

  try {
    return await withTransaction(async (client) => {
      const preExisting = await findExistingMessage(client, messageId, { lock: true });
      if (preExisting) {
        if (!matchesIdempotentMessage(preExisting, user.id, body, conversationId, listingId)) {
          fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
        }
        const convRow = await fetchConversationById(client, preExisting.conversation_id);
        return {
          status: 200,
          idempotent: true,
          conversation: toConversationDto(convRow, preExisting),
          message: toMessageDto(preExisting),
        };
      }

      let lockedConv;
      if (conversationId) {
        const convRes = await client.query(`SELECT * FROM conversations WHERE id = $1 FOR UPDATE`, [conversationId]);
        if (!convRes.rows.length) {
          fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
        }
        lockedConv = convRes.rows[0];
        if (listingId && lockedConv.listing_id !== listingId) {
          fail(400, "CONVERSATION_MISMATCH", "대화방과 매물 정보가 일치하지 않습니다.");
        }
        const listRes = await client.query(`SELECT id, owner_id, status FROM listings WHERE id = $1`, [lockedConv.listing_id]);
        const listing = listRes.rows[0];
        if (!listing) fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
        if (lockedConv.buyer_id !== user.id && listing.owner_id !== user.id) {
          fail(403, "FORBIDDEN", "이 대화에 메시지를 보낼 권한이 없습니다.");
        }
      } else {
        const listRes = await client.query(`SELECT id, owner_id, status FROM listings WHERE id = $1`, [listingId]);
        const listing = listRes.rows[0];
        if (!listing) {
          fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
        }
        if (listing.owner_id === user.id) {
          fail(403, "SELF_INQUIRY_FORBIDDEN", "본인이 등록한 매물에는 구매자 문의를 시작할 수 없습니다.");
        }
        const priorConv = await client.query(
          `SELECT id FROM conversations WHERE listing_id = $1 AND buyer_id = $2`,
          [listingId, user.id]
        );
        if (!priorConv.rows.length && listing.status === "removed") {
          fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
        }
        await client.query(
          `INSERT INTO conversations (listing_id, buyer_id, last_seq)
           VALUES ($1, $2, 0)
           ON CONFLICT (listing_id, buyer_id) DO NOTHING`,
          [listingId, user.id]
        );
        const lockedRes = await client.query(
          `SELECT * FROM conversations WHERE listing_id = $1 AND buyer_id = $2 FOR UPDATE`,
          [listingId, user.id]
        );
        lockedConv = lockedRes.rows[0];
      }

      // Re-check under READ COMMITTED after acquiring conversations FOR UPDATE so concurrent same-UUID retries do not bump last_seq.
      const existingAfterLock = await findExistingMessage(client, messageId, { lock: true });
      if (existingAfterLock) {
        if (!matchesIdempotentMessage(existingAfterLock, user.id, body, conversationId, listingId)) {
          fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
        }
        const convRow = await fetchConversationById(client, existingAfterLock.conversation_id);
        return {
          status: 200,
          idempotent: true,
          conversation: toConversationDto(convRow, existingAfterLock),
          message: toMessageDto(existingAfterLock),
        };
      }

      const seqRes = await client.query(
        `UPDATE conversations
         SET last_seq = last_seq + 1, updated_at = now()
         WHERE id = $1
         RETURNING last_seq`,
        [lockedConv.id]
      );
      const nextSeq = Number(seqRes.rows[0].last_seq);

      await client.query(
        `INSERT INTO messages (id, conversation_id, sender_id, seq, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [messageId, lockedConv.id, user.id, nextSeq, body]
      );

      const insertedMsgRes = await client.query(
        `SELECT m.*, u.name AS sender_name
         FROM messages m
         JOIN "user" u ON u.id = m.sender_id
         WHERE m.id = $1`,
        [messageId]
      );
      const convRow = await fetchConversationById(client, lockedConv.id);
      return {
        status: 201,
        idempotent: false,
        conversation: toConversationDto(convRow, insertedMsgRes.rows[0]),
        message: toMessageDto(insertedMsgRes.rows[0]),
      };
    }, pool);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.code === "23505") {
      const existing = await findExistingMessage(pool, messageId);
      if (existing && matchesIdempotentMessage(existing, user.id, body, conversationId, listingId)) {
        const convRow = await fetchConversationById(pool, existing.conversation_id);
        return {
          status: 200,
          idempotent: true,
          conversation: toConversationDto(convRow, existing),
          message: toMessageDto(existing),
        };
      }
      fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
    }
    throw error;
  }
}

export async function listConversationsForUser(userId, { listingId = null, pool = getPool() } = {}) {
  const params = [userId];
  let filterSql = "";
  if (listingId) {
    params.push(listingId.trim());
    filterSql = ` AND c.listing_id = $2`;
  }

  const res = await pool.query(
    `SELECT c.*,
            l.owner_id,
            l.title AS listing_title,
            l.type AS listing_type,
            l.status AS listing_status,
            ou.name AS owner_name,
            bu.name AS buyer_name,
            lm.id AS last_msg_id,
            lm.seq AS last_msg_seq,
            lm.sender_id AS last_msg_sender_id,
            lm.body AS last_msg_body,
            lm.created_at AS last_msg_created_at
     FROM conversations c
     JOIN listings l ON l.id = c.listing_id
     JOIN "user" ou ON ou.id = l.owner_id
     JOIN "user" bu ON bu.id = c.buyer_id
     LEFT JOIN LATERAL (
       SELECT m.id, m.seq, m.sender_id, m.body, m.created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.seq DESC
       LIMIT 1
     ) lm ON true
     WHERE (c.buyer_id = $1 OR l.owner_id = $1)${filterSql}
     ORDER BY c.updated_at DESC, c.id DESC`,
    params
  );

  return res.rows.map((row) =>
    toConversationDto(
      row,
      row.last_msg_id
        ? {
            id: row.last_msg_id,
            seq: row.last_msg_seq,
            sender_id: row.last_msg_sender_id,
            body: row.last_msg_body,
            created_at: row.last_msg_created_at,
          }
        : null
    )
  );
}

export async function getConversationMessages(
  userId,
  { conversationId = null, listingId = null, afterSeq = null, beforeSeq = null, limit = 50, pool = getPool() } = {}
) {
  const safeLimit = Math.min(100, Math.max(1, Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 50));

  let convRow = null;
  if (conversationId) {
    const cleanConvId = requireUuid(conversationId, "대화방 ID");
    convRow = await fetchConversationById(pool, cleanConvId);
    if (!convRow) {
      fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
    }
    if (convRow.buyer_id !== userId && convRow.owner_id !== userId) {
      fail(403, "FORBIDDEN", "이 대화에 접근할 수 없습니다.");
    }
  } else if (listingId) {
    const cleanListingId = normalizeText(listingId, { min: 1, max: 80, field: "매물 ID" });
    const listRes = await pool.query(`SELECT id, owner_id, status FROM listings WHERE id = $1 LIMIT 1`, [cleanListingId]);
    if (!listRes.rows.length) {
      fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
    }
    const existingRes = await pool.query(
      `SELECT id FROM conversations WHERE listing_id = $1 AND buyer_id = $2 LIMIT 1`,
      [cleanListingId, userId]
    );
    if (!existingRes.rows.length) {
      if (listRes.rows[0].status === "removed") {
        fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
      }
      return { conversation: null, messages: [], hasMoreOlder: false };
    }
    convRow = await fetchConversationById(pool, existingRes.rows[0].id);
  } else {
    fail(400, "INVALID_TARGET", "대화방 또는 매물을 지정해 주세요.");
  }

  let messages = [];
  let hasMoreOlder = false;

  if (afterSeq !== null && afterSeq !== undefined && String(afterSeq).trim() !== "") {
    const seq = Number(afterSeq);
    if (!Number.isSafeInteger(seq) || seq < 0) {
      fail(400, "INVALID_SEQ", "seq 파라미터가 올바르지 않습니다.");
    }
    const res = await pool.query(
      `SELECT m.*, u.name AS sender_name
       FROM messages m
       JOIN "user" u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 AND m.seq > $2
       ORDER BY m.seq ASC
       LIMIT $3`,
      [convRow.id, seq, safeLimit]
    );
    messages = res.rows.map(toMessageDto);
  } else if (beforeSeq !== null && beforeSeq !== undefined && String(beforeSeq).trim() !== "") {
    const seq = Number(beforeSeq);
    if (!Number.isSafeInteger(seq) || seq < 1) {
      fail(400, "INVALID_SEQ", "beforeSeq 파라미터가 올바르지 않습니다.");
    }
    const res = await pool.query(
      `SELECT m.*, u.name AS sender_name
       FROM messages m
       JOIN "user" u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 AND m.seq < $2
       ORDER BY m.seq DESC
       LIMIT $3`,
      [convRow.id, seq, safeLimit + 1]
    );
    hasMoreOlder = res.rows.length > safeLimit;
    messages = res.rows.slice(0, safeLimit).reverse().map(toMessageDto);
  } else {
    const res = await pool.query(
      `SELECT m.*, u.name AS sender_name
       FROM messages m
       JOIN "user" u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.seq DESC
       LIMIT $2`,
      [convRow.id, safeLimit + 1]
    );
    hasMoreOlder = res.rows.length > safeLimit;
    messages = res.rows.slice(0, safeLimit).reverse().map(toMessageDto);
  }

  const lastMessage = messages[messages.length - 1] || null;
  return {
    conversation: toConversationDto(convRow, lastMessage ? {
      id: lastMessage.id,
      seq: lastMessage.seq,
      sender_id: lastMessage.senderId,
      body: lastMessage.body,
      created_at: lastMessage.createdAt,
    } : null),
    messages,
    hasMoreOlder,
  };
}
