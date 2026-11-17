import { getPool, withTransaction } from "./db.js";
import { fail, HttpError } from "./http.js";
import { normalizeText, requireUuid } from "./validate.js";

const VALID_AI_MODES = new Set(["off", "copilot", "autonomous"]);
const VALID_SENDER_KINDS = new Set(["human", "ai_proxy", "system"]);
const VALID_AI_CONFIDENCES = new Set(["high", "medium", "low"]);
const VALID_AUTO_REPLY_TOPICS = new Set(["schedule", "spec", "availability", "compatibility", "weather"]);

function toIsoOrNull(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

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
    buyerAiMode: row.buyer_ai_mode ?? "off",
    ownerAiMode: row.owner_ai_mode ?? "off",
    buyerAiPolicy: row.buyer_ai_policy && typeof row.buyer_ai_policy === "object" ? row.buyer_ai_policy : {},
    ownerAiPolicy: row.owner_ai_policy && typeof row.owner_ai_policy === "object" ? row.owner_ai_policy : {},
    aiConsecutiveTurns: Number(row.ai_consecutive_turns ?? 0),
    aiPausedReason: row.ai_paused_reason ?? null,
    aiLastRunAt: toIsoOrNull(row.ai_last_run_at),
    aiDraftJson: row.ai_draft_json ?? null,
    lastMessage: lastMessage
      ? {
          id: String(lastMessage.id),
          seq: Number(lastMessage.seq),
          senderId: lastMessage.sender_id,
          body: lastMessage.body,
          senderKind: lastMessage.sender_kind ?? "human",
          aiConfidence: lastMessage.ai_confidence ?? null,
          replyToSeq: lastMessage.reply_to_seq != null ? Number(lastMessage.reply_to_seq) : null,
          escalationReason: lastMessage.escalation_reason ?? null,
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
    senderKind: row.sender_kind ?? "human",
    aiConfidence: row.ai_confidence ?? null,
    replyToSeq: row.reply_to_seq != null ? Number(row.reply_to_seq) : null,
    escalationReason: row.escalation_reason ?? null,
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

function validateMessageMeta(options = {}) {
  const senderKind = options.senderKind ?? "human";
  if (!VALID_SENDER_KINDS.has(senderKind)) {
    fail(400, "INVALID_SENDER_KIND", "올바르지 않은 발신 주체입니다.");
  }
  const aiConfidence = options.aiConfidence ?? null;
  if (aiConfidence !== null && !VALID_AI_CONFIDENCES.has(aiConfidence)) {
    fail(400, "INVALID_AI_CONFIDENCE", "올바르지 않은 AI 확신도입니다.");
  }
  const rawReplyToSeq = options.replyToSeq ?? null;
  let replyToSeq = null;
  if (rawReplyToSeq !== null) {
    const num = Number(rawReplyToSeq);
    if (!Number.isSafeInteger(num) || num < 1) {
      fail(400, "INVALID_REPLY_TO_SEQ", "올바르지 않은 응답 대상 순번입니다.");
    }
    replyToSeq = num;
  }
  const escalationReason = options.escalationReason
    ? normalizeText(options.escalationReason, { min: 1, max: 200, field: "에스컬레이션 사유" })
    : null;
  return { senderKind, aiConfidence, replyToSeq, escalationReason };
}

export async function sendMessage(user, payload, options = {}) {
  const { pool = getPool() } = options;
  const { senderKind, aiConfidence, replyToSeq, escalationReason } = validateMessageMeta(options);
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

      let seqRes;
      if (senderKind === "human") {
        seqRes = await client.query(
          `UPDATE conversations
           SET last_seq = last_seq + 1,
               updated_at = now(),
               ai_consecutive_turns = 0,
               ai_paused_reason = NULL,
               ai_draft_json = CASE WHEN ai_draft_json->>'targetUserId' = $2 THEN NULL ELSE ai_draft_json END
           WHERE id = $1
           RETURNING last_seq`,
          [lockedConv.id, user.id]
        );
      } else if (senderKind === "ai_proxy") {
        seqRes = await client.query(
          `UPDATE conversations
           SET last_seq = last_seq + 1,
               updated_at = now(),
               ai_consecutive_turns = ai_consecutive_turns + 1,
               ai_last_run_at = now(),
               ai_draft_json = CASE WHEN ai_draft_json->>'targetUserId' = $2 THEN NULL ELSE ai_draft_json END
           WHERE id = $1
           RETURNING last_seq`,
          [lockedConv.id, user.id]
        );
      } else {
        seqRes = await client.query(
          `UPDATE conversations
           SET last_seq = last_seq + 1,
               updated_at = now()
           WHERE id = $1
           RETURNING last_seq`,
          [lockedConv.id]
        );
      }
      const nextSeq = Number(seqRes.rows[0].last_seq);

      await client.query(
        `INSERT INTO messages (id, conversation_id, sender_id, seq, body, sender_kind, ai_confidence, reply_to_seq, escalation_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [messageId, lockedConv.id, user.id, nextSeq, body, senderKind, aiConfidence, replyToSeq, escalationReason]
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
      if (senderKind === "ai_proxy" && replyToSeq != null) {
        fail(409, "AI_REPLY_ALREADY_EXISTS", "이미 해당 메시지에 대한 AI 대리 응답이 존재합니다.");
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
            lm.sender_kind AS last_msg_sender_kind,
            lm.ai_confidence AS last_msg_ai_confidence,
            lm.reply_to_seq AS last_msg_reply_to_seq,
            lm.escalation_reason AS last_msg_escalation_reason,
            lm.created_at AS last_msg_created_at
     FROM conversations c
     JOIN listings l ON l.id = c.listing_id
     JOIN "user" ou ON ou.id = l.owner_id
     JOIN "user" bu ON bu.id = c.buyer_id
     LEFT JOIN LATERAL (
       SELECT m.id, m.seq, m.sender_id, m.body, m.sender_kind, m.ai_confidence, m.reply_to_seq, m.escalation_reason, m.created_at
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
            sender_kind: row.last_msg_sender_kind,
            ai_confidence: row.last_msg_ai_confidence,
            reply_to_seq: row.last_msg_reply_to_seq,
            escalation_reason: row.last_msg_escalation_reason,
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
      sender_kind: lastMessage.senderKind,
      ai_confidence: lastMessage.aiConfidence,
      reply_to_seq: lastMessage.replyToSeq,
      escalation_reason: lastMessage.escalationReason,
      created_at: lastMessage.createdAt,
    } : null),
    messages,
    hasMoreOlder,
  };
}

function sanitizeAiPolicy(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  if (typeof raw.instructions === "string") {
    out.instructions = raw.instructions.trim().slice(0, 500);
  }
  if (typeof raw.allowNegotiation === "boolean") {
    out.allowNegotiation = raw.allowNegotiation;
  }
  if (raw.minPrice === null) {
    out.minPrice = null;
  } else if (raw.minPrice !== undefined && Number.isFinite(Number(raw.minPrice)) && Number(raw.minPrice) >= 0) {
    out.minPrice = Math.trunc(Number(raw.minPrice));
  }
  if (typeof raw.allowDelivery === "boolean") {
    out.allowDelivery = raw.allowDelivery;
  }
  if (typeof raw.preferredPickupWindow === "string") {
    out.preferredPickupWindow = raw.preferredPickupWindow.trim().slice(0, 60);
  }
  if (raw.maxConsecutiveAiTurns !== undefined) {
    const turns = Number(raw.maxConsecutiveAiTurns);
    if (Number.isFinite(turns)) {
      out.maxConsecutiveAiTurns = Math.min(10, Math.max(1, Math.trunc(turns)));
    }
  }
  if (Array.isArray(raw.autoReplyOn)) {
    out.autoReplyOn = [...new Set(raw.autoReplyOn.filter((t) => typeof t === "string" && VALID_AUTO_REPLY_TOPICS.has(t)))];
  }
  if (typeof raw.desiredDate === "string") {
    out.desiredDate = raw.desiredDate.trim().slice(0, 30);
  }
  if (raw.areaPyeong !== undefined && Number.isFinite(Number(raw.areaPyeong)) && Number(raw.areaPyeong) > 0) {
    out.areaPyeong = Math.trunc(Number(raw.areaPyeong));
  }
  if (typeof raw.ownedModelId === "string") {
    out.ownedModelId = raw.ownedModelId.trim().slice(0, 80);
  }
  if (typeof raw.needDelivery === "boolean") {
    out.needDelivery = raw.needDelivery;
  }
  return out;
}

async function fetchLastMessageRow(db, conversationId) {
  const res = await db.query(
    `SELECT m.*, u.name AS sender_name
     FROM messages m
     JOIN "user" u ON u.id = m.sender_id
     WHERE m.conversation_id = $1
     ORDER BY m.seq DESC
     LIMIT 1`,
    [conversationId]
  );
  return res.rows[0] || null;
}

export async function updateConversationAiPolicy(user, payload, { pool = getPool() } = {}) {
  const conversationId = payload?.conversationId ? requireUuid(payload.conversationId, "대화방 ID") : null;
  const listingId = payload?.listingId ? normalizeText(payload.listingId, { min: 1, max: 80, field: "매물 ID" }) : null;
  if (!conversationId && !listingId) {
    fail(400, "INVALID_TARGET", "대화방 또는 매물을 지정해 주세요.");
  }

  const hasMode = payload?.mode !== undefined && payload?.mode !== null;
  const mode = hasMode ? String(payload.mode).trim() : null;
  if (hasMode && !VALID_AI_MODES.has(mode)) {
    fail(400, "INVALID_AI_MODE", "올바르지 않은 대리 응대 모드입니다.");
  }
  const hasPolicy = payload?.policy !== undefined;
  const policy = hasPolicy ? sanitizeAiPolicy(payload.policy) : null;

  return withTransaction(async (client) => {
    let lockedConv;
    let role;

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
      if (lockedConv.buyer_id === user.id) {
        role = "buyer";
      } else if (listing.owner_id === user.id) {
        role = "owner";
      } else {
        fail(403, "FORBIDDEN", "이 대화의 대리 응대 설정을 변경할 권한이 없습니다.");
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
      role = "buyer";
    }

    const nextMode = hasMode ? mode : (role === "buyer" ? lockedConv.buyer_ai_mode : lockedConv.owner_ai_mode);
    const nextPolicy = hasPolicy ? policy : (role === "buyer" ? lockedConv.buyer_ai_policy : lockedConv.owner_ai_policy);
    const isReenabling = nextMode === "copilot" || nextMode === "autonomous";
    const nextPausedReason = isReenabling ? null : lockedConv.ai_paused_reason;
    const nextTurns = isReenabling && lockedConv.ai_paused_reason ? 0 : lockedConv.ai_consecutive_turns;

    if (role === "buyer") {
      await client.query(
        `UPDATE conversations
         SET buyer_ai_mode = $2,
             buyer_ai_policy = $3::jsonb,
             ai_paused_reason = $4,
             ai_consecutive_turns = $5,
             ai_draft_json = CASE WHEN $2 = 'off' AND ai_draft_json->>'targetUserId' = $6 THEN NULL ELSE ai_draft_json END,
             updated_at = now()
         WHERE id = $1`,
        [lockedConv.id, nextMode, JSON.stringify(nextPolicy), nextPausedReason, nextTurns, user.id]
      );
    } else {
      await client.query(
        `UPDATE conversations
         SET owner_ai_mode = $2,
             owner_ai_policy = $3::jsonb,
             ai_paused_reason = $4,
             ai_consecutive_turns = $5,
             ai_draft_json = CASE WHEN $2 = 'off' AND ai_draft_json->>'targetUserId' = $6 THEN NULL ELSE ai_draft_json END,
             updated_at = now()
         WHERE id = $1`,
        [lockedConv.id, nextMode, JSON.stringify(nextPolicy), nextPausedReason, nextTurns, user.id]
      );
    }

    const convRow = await fetchConversationById(client, lockedConv.id);
    const lastMsgRow = await fetchLastMessageRow(client, lockedConv.id);
    return {
      conversation: toConversationDto(convRow, lastMsgRow),
      role,
    };
  }, pool);
}

export async function dismissAiDraft(user, payload, { pool = getPool() } = {}) {
  const conversationId = requireUuid(payload?.conversationId, "대화방 ID");
  return withTransaction(async (client) => {
    const convRes = await client.query(`SELECT * FROM conversations WHERE id = $1 FOR UPDATE`, [conversationId]);
    if (!convRes.rows.length) {
      fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
    }
    const lockedConv = convRes.rows[0];
    const listRes = await client.query(`SELECT id, owner_id FROM listings WHERE id = $1`, [lockedConv.listing_id]);
    const listing = listRes.rows[0];
    if (!listing) fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
    if (lockedConv.buyer_id !== user.id && listing.owner_id !== user.id) {
      fail(403, "FORBIDDEN", "이 대화에 접근할 수 없습니다.");
    }

    await client.query(
      `UPDATE conversations
       SET ai_draft_json = CASE WHEN ai_draft_json->>'targetUserId' = $2 THEN NULL ELSE ai_draft_json END,
           updated_at = now()
       WHERE id = $1`,
      [conversationId, user.id]
    );

    const convRow = await fetchConversationById(client, conversationId);
    const lastMsgRow = await fetchLastMessageRow(client, conversationId);
    return {
      conversation: toConversationDto(convRow, lastMsgRow),
    };
  }, pool);
}

export { fetchConversationById, toConversationDto, toMessageDto };
