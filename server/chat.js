import { getPool, withTransaction } from "./db.js";
import { fail, HttpError } from "./http.js";
import { normalizeText, requireUuid } from "./validate.js";

const ROLES = new Set(["buyer", "owner"]);

/**
 * 양측 모두에게 보이는 시스템 메시지 사유. 그 외 사유의 시스템 메시지(이전 AI 대리 응대 기능이 남긴
 * 본인 전용 안내 등 기존 행)는 발신 역할 본인에게만 보이며, 상대방 응답·안 읽음 계산에서 제외한다.
 * 새 메시지는 모두 사람(human) 발신이며, 이 필터는 이미 저장된 행의 비공개 내용이 새지 않게 하려고 둔다.
 */
export const SHARED_SYSTEM_REASONS = Object.freeze(["rental_handoff", "both_ai_handoff", "transaction_completed"]);
const SHARED_SYSTEM_REASON_SET = new Set(SHARED_SYSTEM_REASONS);
const SHARED_SYSTEM_SQL = SHARED_SYSTEM_REASONS.map((r) => `'${r}'`).join(", ");

/** 대화 행(owner_id 포함)과 사용자로부터 서버가 역할을 결정한다. 참여자가 아니면 null. */
export function resolveConversationRole(convRow, userId) {
  if (!convRow || !userId) return null;
  if (convRow.buyer_id === userId) return "buyer";
  if (convRow.owner_id === userId) return "owner";
  return null;
}

function otherRole(role) {
  return role === "buyer" ? "owner" : "buyer";
}

/** 역할 칸 컬럼명은 서버가 결정한 역할로만 만든다. */
function roleCol(role, suffix) {
  if (!ROLES.has(role)) throw new Error(`invalid role ${role}`);
  return `${role}_${suffix}`;
}

export function isMessageVisibleTo(row, viewerId) {
  const kind = row.sender_kind ?? row.senderKind ?? "human";
  if (kind !== "system") return true;
  const reason = row.escalation_reason ?? row.escalationReason ?? null;
  if (!reason || SHARED_SYSTEM_REASON_SET.has(reason)) return true;
  return (row.sender_id ?? row.senderId) === viewerId;
}

/** SQL용 가시성 조건. alias는 messages 별칭, param은 viewer ID 바인드 위치. */
function visibleMessageSql(alias, param) {
  return `(${alias}.sender_kind <> 'system' OR ${alias}.escalation_reason IS NULL OR ${alias}.escalation_reason IN (${SHARED_SYSTEM_SQL}) OR ${alias}.sender_id = ${param})`;
}

function lastReadSeqOf(row, role) {
  if (!role) return 0;
  return Number(row[`${role}_last_read_seq`] ?? 0);
}

function senderRoleOf(row, conv) {
  const kind = row.sender_kind ?? "human";
  if (kind === "system") return "system";
  if (!conv) return null;
  if (row.sender_id === conv.buyer_id) return "buyer";
  if (row.sender_id === conv.owner_id) return "owner";
  return null;
}

function messageVisibility(row) {
  const kind = row.sender_kind ?? "human";
  if (kind !== "system") return "both";
  const reason = row.escalation_reason ?? null;
  return !reason || SHARED_SYSTEM_REASON_SET.has(reason) ? "both" : "self";
}

function toMessageDto(row, conv = null) {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    seq: Number(row.seq),
    senderId: row.sender_id,
    senderName: row.sender_name ?? null,
    senderRole: senderRoleOf(row, conv),
    body: row.body,
    senderKind: row.sender_kind ?? "human",
    visibility: messageVisibility(row),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function toLastMessageDto(lastMessage, row) {
  if (!lastMessage) return null;
  return {
    id: String(lastMessage.id),
    seq: Number(lastMessage.seq),
    senderId: lastMessage.sender_id,
    senderRole: senderRoleOf(lastMessage, row),
    body: lastMessage.body,
    senderKind: lastMessage.sender_kind ?? "human",
    visibility: messageVisibility(lastMessage),
    createdAt: lastMessage.created_at instanceof Date ? lastMessage.created_at.toISOString() : String(lastMessage.created_at),
  };
}

/**
 * 대화 DTO. viewerId 관점으로 투영된다(내 역할·안 읽음·읽음 위치).
 * viewerId가 없거나 참여자가 아니면 역할 관련 값을 비운 중립 DTO를 만든다.
 */
function toConversationDto(row, lastMessage = null, options = {}) {
  const { viewerId = null, unreadCount = 0, trade = null } = options;
  const myRole = resolveConversationRole(row, viewerId);
  const lastSeq = Number(row.last_seq);
  const negotiation = trade?.negotiation ?? null;

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
    lastSeq,
    myRole,
    counterpartRole: myRole ? otherRole(myRole) : null,
    myLastReadSeq: myRole ? Math.min(lastReadSeqOf(row, myRole), lastSeq) : 0,
    unreadCount: myRole ? Number(unreadCount ?? 0) : 0,
    stage: trade?.stage ?? "inquiry",
    negotiation,
    order: trade?.order ?? trade?.linkedOrder ?? null,
    lastMessage: toLastMessageDto(lastMessage, row),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// 협상(trade-negotiation.js) 연동. 순환 import를 피하려고 동적으로 불러온다.
// 모듈 누락을 숨기지 않는다. TRADE_NEGOTIATION_OPTIONAL=1(개발·이행 테스트 전용)일 때만 생략한다.

const peerModuleCache = new Map();

async function loadPeerModule(specifier) {
  if (!peerModuleCache.has(specifier)) {
    peerModuleCache.set(specifier, import(specifier));
  }
  try {
    return await peerModuleCache.get(specifier);
  } catch (error) {
    peerModuleCache.delete(specifier);
    if (process.env.TRADE_NEGOTIATION_OPTIONAL === "1" && error?.code === "ERR_MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

export function loadTradeModule() {
  return loadPeerModule("./trade-negotiation.js");
}

async function fetchTradeSummary(db, convRow, viewerId, { inTransaction = false, detail = true } = {}) {
  const mod = await loadTradeModule();
  if (!mod) return null;
  const viewerRole = resolveConversationRole(convRow, viewerId);
  if (!viewerRole) return null;
  const opts = inTransaction ? { client: db } : { pool: db };
  if (detail && typeof mod.getNegotiationState === "function") {
    return mod.getNegotiationState(
      { conversationId: String(convRow.id), viewerUserId: viewerId, conv: convRow, viewerRole },
      opts
    );
  }
  if (typeof mod.getConversationTradeSummary === "function") {
    return mod.getConversationTradeSummary(db, { conv: convRow, viewerRole, viewerUserId: viewerId, ...opts });
  }
  if (typeof mod.getTradeSummaries === "function") {
    const out = await mod.getTradeSummaries([String(convRow.id)], viewerId, opts);
    return (out instanceof Map ? out.get(String(convRow.id)) : out?.[String(convRow.id)]) ?? null;
  }
  throw new Error("trade-negotiation.js에 대화 요약 export가 없습니다.");
}

/** 내 역할의 마지막 읽음 이후, 내가 볼 수 있는 상대 메시지 수. */
async function countUnread(db, conversationIds, viewerId) {
  if (!conversationIds.length) return new Map();
  const res = await db.query(
    `SELECT c.id, COUNT(m.id)::int AS unread
     FROM conversations c
     LEFT JOIN messages m
       ON m.conversation_id = c.id
      AND m.sender_id <> $2
      AND m.seq > CASE WHEN c.buyer_id = $2 THEN c.buyer_last_read_seq ELSE c.owner_last_read_seq END
      AND ${visibleMessageSql("m", "$2")}
     WHERE c.id = ANY($1::uuid[])
     GROUP BY c.id`,
    [conversationIds, viewerId]
  );
  return new Map(res.rows.map((r) => [String(r.id), Number(r.unread)]));
}

async function fetchLastVisibleMessageRow(db, conversationId, viewerId) {
  const res = await db.query(
    `SELECT m.*, u.name AS sender_name
     FROM messages m
     JOIN "user" u ON u.id = m.sender_id
     WHERE m.conversation_id = $1 AND ${visibleMessageSql("m", "$2")}
     ORDER BY m.seq DESC
     LIMIT 1`,
    [conversationId, viewerId]
  );
  return res.rows[0] || null;
}

/** viewer 관점 DTO(안 읽음·협상 요약 포함). */
async function buildViewerConversation(db, convRow, viewerId, { inTransaction = false, lastMessageRow, detail = true } = {}) {
  const lastRow = lastMessageRow && isMessageVisibleTo(lastMessageRow, viewerId)
    ? lastMessageRow
    : await fetchLastVisibleMessageRow(db, convRow.id, viewerId);
  const unread = await countUnread(db, [String(convRow.id)], viewerId);
  const trade = await fetchTradeSummary(db, convRow, viewerId, { inTransaction, detail });
  return toConversationDto(convRow, lastRow, {
    viewerId,
    unreadCount: unread.get(String(convRow.id)) ?? 0,
    trade,
  });
}

// ---------------------------------------------------------------------------

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

/** 대화 행을 잠그고 호출자의 역할을 서버에서 결정한다. 참여자가 아니면 403. */
async function lockConversationForUser(client, conversationId, userId, forbiddenMessage = "이 대화에 접근할 수 없습니다.") {
  const convRes = await client.query(
    `SELECT c.*, l.owner_id, l.type AS listing_type, l.status AS listing_status
     FROM conversations c
     JOIN listings l ON l.id = c.listing_id
     WHERE c.id = $1
     FOR UPDATE OF c`,
    [conversationId]
  );
  if (!convRes.rows.length) {
    fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
  }
  const conv = convRes.rows[0];
  const role = resolveConversationRole(conv, userId);
  if (!role) {
    fail(403, "FORBIDDEN", forbiddenMessage);
  }
  return { conv, role };
}

/** 구매자의 대화방을 만들거나 가져와 잠근다. */
async function ensureBuyerConversation(client, listing, buyerId) {
  await client.query(
    `INSERT INTO conversations (listing_id, buyer_id, last_seq)
     VALUES ($1, $2, 0)
     ON CONFLICT (listing_id, buyer_id) DO NOTHING`,
    [listing.id, buyerId]
  );
  const lockedRes = await client.query(
    `SELECT * FROM conversations WHERE listing_id = $1 AND buyer_id = $2 FOR UPDATE`,
    [listing.id, buyerId]
  );
  return { ...lockedRes.rows[0], owner_id: listing.owner_id, listing_type: listing.type, listing_status: listing.status };
}

async function lockListingForBuyer(client, listingId, userId) {
  const listRes = await client.query(`SELECT id, owner_id, status, type FROM listings WHERE id = $1`, [listingId]);
  const listing = listRes.rows[0];
  if (!listing) {
    fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
  }
  if (listing.owner_id === userId) {
    fail(403, "SELF_INQUIRY_FORBIDDEN", "본인이 등록한 매물에는 구매자 문의를 시작할 수 없습니다.");
  }
  const priorConv = await client.query(
    `SELECT id FROM conversations WHERE listing_id = $1 AND buyer_id = $2`,
    [listingId, userId]
  );
  if (!priorConv.rows.length && listing.status === "removed") {
    fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
  }
  return ensureBuyerConversation(client, listing, userId);
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

async function idempotentResult(db, existing, userId, inTransaction) {
  const convRow = await fetchConversationById(db, existing.conversation_id);
  return {
    status: 200,
    idempotent: true,
    senderRole: resolveConversationRole(convRow, userId),
    conversation: await buildViewerConversation(db, convRow, userId, { inTransaction, lastMessageRow: existing, detail: false }),
    message: toMessageDto(existing, convRow),
  };
}

export async function sendMessage(user, payload, options = {}) {
  const { pool = getPool() } = options;
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
        return idempotentResult(client, preExisting, user.id, true);
      }

      let lockedConv;
      let role;
      if (conversationId) {
        ({ conv: lockedConv, role } = await lockConversationForUser(client, conversationId, user.id, "이 대화에 메시지를 보낼 권한이 없습니다."));
        if (listingId && lockedConv.listing_id !== listingId) {
          fail(400, "CONVERSATION_MISMATCH", "대화방과 매물 정보가 일치하지 않습니다.");
        }
      } else {
        lockedConv = await lockListingForBuyer(client, listingId, user.id);
        role = "buyer";
      }

      // Re-check under READ COMMITTED after acquiring conversations FOR UPDATE so concurrent same-UUID retries do not bump last_seq.
      const existingAfterLock = await findExistingMessage(client, messageId, { lock: true });
      if (existingAfterLock) {
        if (!matchesIdempotentMessage(existingAfterLock, user.id, body, conversationId, listingId)) {
          fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
        }
        return idempotentResult(client, existingAfterLock, user.id, true);
      }

      const seqRes = await client.query(
        `UPDATE conversations
         SET last_seq = last_seq + 1,
             updated_at = now()
         WHERE id = $1
         RETURNING last_seq`,
        [lockedConv.id]
      );
      const nextSeq = Number(seqRes.rows[0].last_seq);

      await client.query(
        `INSERT INTO messages (id, conversation_id, sender_id, seq, body, sender_kind)
         VALUES ($1, $2, $3, $4, $5, 'human')`,
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
        senderRole: role,
        conversation: await buildViewerConversation(client, convRow, user.id, {
          inTransaction: true,
          lastMessageRow: insertedMsgRes.rows[0],
          detail: false,
        }),
        message: toMessageDto(insertedMsgRes.rows[0], convRow),
      };
    }, pool);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.code === "23505") {
      const existing = await findExistingMessage(pool, messageId);
      if (existing && matchesIdempotentMessage(existing, user.id, body, conversationId, listingId)) {
        return idempotentResult(pool, existing, user.id, false);
      }
      fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
    }
    throw error;
  }
}

/** 대화 목록(읽기 전용). 마지막 메시지·안 읽음은 viewer가 볼 수 있는 메시지 기준이다. */
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
            lm.escalation_reason AS last_msg_escalation_reason,
            lm.created_at AS last_msg_created_at
     FROM conversations c
     JOIN listings l ON l.id = c.listing_id
     JOIN "user" ou ON ou.id = l.owner_id
     JOIN "user" bu ON bu.id = c.buyer_id
     LEFT JOIN LATERAL (
       SELECT m.id, m.seq, m.sender_id, m.body, m.sender_kind, m.escalation_reason, m.created_at
       FROM messages m
       WHERE m.conversation_id = c.id AND ${visibleMessageSql("m", "$1")}
       ORDER BY m.seq DESC
       LIMIT 1
     ) lm ON true
     WHERE (c.buyer_id = $1 OR l.owner_id = $1)${filterSql}
     ORDER BY c.updated_at DESC, c.id DESC`,
    params
  );

  const ids = res.rows.map((row) => String(row.id));
  const unreadById = await countUnread(pool, ids, userId);
  let summaries = new Map();
  if (ids.length) {
    const mod = await loadTradeModule();
    if (mod && typeof mod.getTradeSummaries === "function") {
      const out = await mod.getTradeSummaries(ids, userId, { pool });
      summaries = out instanceof Map ? out : new Map(Object.entries(out || {}));
    } else if (mod) {
      for (const row of res.rows) {
        summaries.set(String(row.id), await fetchTradeSummary(pool, row, userId, { detail: false }));
      }
    }
  }

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
            escalation_reason: row.last_msg_escalation_reason,
            created_at: row.last_msg_created_at,
          }
        : null,
      {
        viewerId: userId,
        unreadCount: unreadById.get(String(row.id)) ?? 0,
        trade: summaries.get(String(row.id)) ?? null,
      }
    )
  );
}

/** 대화 조회. 읽기 전용이며 읽음 처리 등 어떤 쓰기도 하지 않는다(mark_read는 별도 POST). */
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
    if (!resolveConversationRole(convRow, userId)) {
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
      // 대화가 아직 없을 때 화면이 역할을 추측하지 않도록 서버가 매물 기준 역할을 알려 준다.
      const prospectiveRole = listRes.rows[0].owner_id === userId ? "owner" : "buyer";
      return { conversation: null, messages: [], hasMoreOlder: false, myRole: prospectiveRole };
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
       WHERE m.conversation_id = $1 AND m.seq > $2 AND ${visibleMessageSql("m", "$4")}
       ORDER BY m.seq ASC
       LIMIT $3`,
      [convRow.id, seq, safeLimit, userId]
    );
    messages = res.rows.map((row) => toMessageDto(row, convRow));
  } else if (beforeSeq !== null && beforeSeq !== undefined && String(beforeSeq).trim() !== "") {
    const seq = Number(beforeSeq);
    if (!Number.isSafeInteger(seq) || seq < 1) {
      fail(400, "INVALID_SEQ", "beforeSeq 파라미터가 올바르지 않습니다.");
    }
    const res = await pool.query(
      `SELECT m.*, u.name AS sender_name
       FROM messages m
       JOIN "user" u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 AND m.seq < $2 AND ${visibleMessageSql("m", "$4")}
       ORDER BY m.seq DESC
       LIMIT $3`,
      [convRow.id, seq, safeLimit + 1, userId]
    );
    hasMoreOlder = res.rows.length > safeLimit;
    messages = res.rows.slice(0, safeLimit).reverse().map((row) => toMessageDto(row, convRow));
  } else {
    const res = await pool.query(
      `SELECT m.*, u.name AS sender_name
       FROM messages m
       JOIN "user" u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 AND ${visibleMessageSql("m", "$3")}
       ORDER BY m.seq DESC
       LIMIT $2`,
      [convRow.id, safeLimit + 1, userId]
    );
    hasMoreOlder = res.rows.length > safeLimit;
    messages = res.rows.slice(0, safeLimit).reverse().map((row) => toMessageDto(row, convRow));
  }

  return {
    conversation: await buildViewerConversation(pool, convRow, userId, { inTransaction: false, detail: true }),
    messages,
    hasMoreOlder,
    myRole: resolveConversationRole(convRow, userId),
  };
}

async function viewerResult(client, conversationId, userId, extra = {}) {
  const convRow = await fetchConversationById(client, conversationId);
  return {
    conversation: await buildViewerConversation(client, convRow, userId, { inTransaction: true, detail: false }),
    ...extra,
  };
}

/** 화면에서 실제로 본 메시지까지 읽음 처리한다. 뒤로 가지 않으며 last_seq를 넘지 않는다. */
export async function markConversationRead(user, payload, { pool = getPool() } = {}) {
  const conversationId = requireUuid(payload?.conversationId, "대화방 ID");
  const readSeq = Number(payload?.readSeq);
  if (payload?.readSeq === null || payload?.readSeq === undefined || !Number.isSafeInteger(readSeq) || readSeq < 0) {
    fail(400, "INVALID_SEQ", "readSeq 파라미터가 올바르지 않습니다.");
  }
  return withTransaction(async (client) => {
    const { conv, role } = await lockConversationForUser(client, conversationId, user.id);
    const col = roleCol(role, "last_read_seq");
    await client.query(
      `UPDATE conversations
       SET ${col} = GREATEST(${col}, LEAST($2::bigint, last_seq))
       WHERE id = $1`,
      [conv.id, readSeq]
    );
    return viewerResult(client, conv.id, user.id, { role });
  }, pool);
}

// ---------------------------------------------------------------------------
// 구조화 제안·합의·신청(trade-negotiation.js). 역할은 서버가 잠근 대화 행으로 결정해 넘긴다.

const TRADE_ACTIONS = Object.freeze({
  submit_offer: "submitOffer",
  accept_offer: "acceptOffer",
  reject_offer: "rejectOffer",
  apply_offer: "applyAgreedOffer",
});

export function isTradeAction(action) {
  return Object.hasOwn(TRADE_ACTIONS, action);
}

export async function runTradeAction(user, action, payload, { pool = getPool() } = {}) {
  if (!isTradeAction(action)) fail(400, "UNKNOWN_ACTION", "지원하지 않는 대화 요청입니다.");
  const exportName = TRADE_ACTIONS[action];
  const conversationId = requireUuid(payload?.conversationId, "대화방 ID");
  const mod = await loadTradeModule();
  if (!mod || typeof mod[exportName] !== "function") {
    fail(501, "TRADE_NEGOTIATION_UNAVAILABLE", "가격 제안 기능을 아직 사용할 수 없습니다.");
  }
  return withTransaction(async (client) => {
    const { conv, role } = await lockConversationForUser(client, conversationId, user.id);
    const offer = payload?.offer && typeof payload.offer === "object" ? payload.offer : (payload?.terms ?? null);
    const termsVersion = payload?.termsVersion ?? payload?.version ?? null;
    const params = {
      client,
      conv,
      conversationId,
      actorRole: role,
      actorUserId: user.id,
      offer,
      terms: offer,
      baseTermsVersion: payload?.baseTermsVersion ?? null,
      offerId: payload?.offerId ?? null,
      termsVersion,
      version: termsVersion,
    };
    const result = await mod[exportName](params, { client });
    return viewerResult(client, conv.id, user.id, {
      role,
      offer: result?.offer ?? null,
      order: result?.order ?? null,
      ...(result?.idempotent !== undefined ? { idempotent: Boolean(result.idempotent) } : {}),
    });
  }, pool);
}

export { fetchConversationById, toConversationDto, toMessageDto };
