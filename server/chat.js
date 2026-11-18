import { getPool, withTransaction } from "./db.js";
import { fail, HttpError } from "./http.js";
import { normalizeText, requireUuid } from "./validate.js";

const VALID_AI_MODES = new Set(["off", "copilot", "autonomous"]);
const VALID_SENDER_KINDS = new Set(["human", "ai_proxy", "system"]);
const VALID_AI_CONFIDENCES = new Set(["high", "medium", "low"]);
const VALID_AUTO_REPLY_TOPICS = new Set(["schedule", "spec", "availability", "compatibility", "weather"]);
const VALID_BUDGET_UNITS = new Set(["total", "daily"]);
const VALID_TRANSPORT_PAYERS = new Set(["buyer", "owner", "none", "split"]);
const ROLES = new Set(["buyer", "owner"]);

/**
 * 양측 모두에게 보이는 시스템 메시지 사유. 그 외 사유(에스컬레이션·연속 응대 상한 등)의 시스템 메시지는
 * 발신 역할 본인에게만 보이며, 서버가 상대방 응답·안 읽음 계산에서 제외한다.
 * 이 사유들의 본문에는 합의된 공개 조건만 담아야 하며 비공개 한도·요약을 넣지 않는다(작성: delegated-chat).
 */
export const SHARED_SYSTEM_REASONS = Object.freeze(["rental_handoff", "both_ai_handoff", "transaction_completed"]);
const SHARED_SYSTEM_REASON_SET = new Set(SHARED_SYSTEM_REASONS);
const SHARED_SYSTEM_SQL = SHARED_SYSTEM_REASONS.map((r) => `'${r}'`).join(", ");

function toIsoOrNull(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

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

function roleState(row, role) {
  if (!role) return null;
  const policy = row[`${role}_ai_policy`];
  return {
    mode: row[`${role}_ai_mode`] ?? "off",
    pause: row[`${role}_ai_pause`] ?? null,
    policy: policy && typeof policy === "object" ? policy : {},
    policyVersion: Number(row[`${role}_ai_policy_version`] ?? 0),
    draft: row[`${role}_ai_draft_json`] ?? null,
    lastReadSeq: Number(row[`${role}_last_read_seq`] ?? 0),
  };
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
    aiConfidence: row.ai_confidence ?? null,
    replyToSeq: row.reply_to_seq != null ? Number(row.reply_to_seq) : null,
    escalationReason: row.escalation_reason ?? null,
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
    aiConfidence: lastMessage.ai_confidence ?? null,
    replyToSeq: lastMessage.reply_to_seq != null ? Number(lastMessage.reply_to_seq) : null,
    escalationReason: lastMessage.escalation_reason ?? null,
    visibility: messageVisibility(lastMessage),
    createdAt: lastMessage.created_at instanceof Date ? lastMessage.created_at.toISOString() : String(lastMessage.created_at),
  };
}

/**
 * 대화 DTO. 반드시 viewerId 관점으로 투영된다.
 * - 상대방의 정책·초안·일시정지 사유·에스컬레이션 요약은 포함하지 않는다.
 * - 레거시 필드명(aiPausedReason, aiDraftJson, buyerAiPolicy, ownerAiPolicy, waitingForUser, escalationSummary)은
 *   viewer 본인 역할의 값으로 채워 호환성을 유지한다.
 * viewerId가 없거나 참여자가 아니면 비공개 필드를 모두 비운 중립 DTO를 만든다.
 */
function toConversationDto(row, lastMessage = null, options = {}) {
  const { viewerId = null, unreadCount = 0, trade = null, jobs = null } = options;
  const myRole = resolveConversationRole(row, viewerId);
  const mine = roleState(row, myRole);
  const counterpart = myRole ? roleState(row, otherRole(myRole)) : null;

  const pause = mine?.pause ?? null;
  const draft = mine?.draft ?? null;
  const waitingForUser = Boolean(
    (typeof pause === "string" && pause.startsWith("escalated:")) || draft?.waitingForUser
  );
  const escalationSummary =
    typeof draft?.summaryForUser === "string" && draft.summaryForUser
      ? draft.summaryForUser
      : (typeof pause === "string" && pause.startsWith("escalated:") &&
          lastMessage?.sender_kind === "system" && lastMessage?.sender_id === viewerId
        ? lastMessage.body
        : null);
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
    buyerAiMode: row.buyer_ai_mode ?? "off",
    ownerAiMode: row.owner_ai_mode ?? "off",
    buyerAiPolicy: myRole === "buyer" ? mine.policy : {},
    ownerAiPolicy: myRole === "owner" ? mine.policy : {},
    aiConsecutiveTurns: Number(row.ai_consecutive_turns ?? 0),
    aiPausedReason: pause,
    aiLastRunAt: toIsoOrNull(row.ai_last_run_at),
    aiDraftJson: draft,
    waitingForUser,
    escalationSummary,
    myRole,
    counterpartRole: myRole ? otherRole(myRole) : null,
    counterpartAiActive: Boolean(counterpart && counterpart.mode !== "off" && !counterpart.pause),
    myLastReadSeq: mine ? Math.min(mine.lastReadSeq, lastSeq) : 0,
    unreadCount: mine ? Number(unreadCount ?? 0) : 0,
    myAiState: mine
      ? {
          mode: mine.mode,
          pause,
          waitingForUser,
          policyVersion: mine.policyVersion,
          policy: mine.policy,
          draft,
          evaluation: trade?.myEvaluation ?? negotiation?.myEvaluation ?? null,
          jobs: jobs ?? null,
        }
      : null,
    stage: trade?.stage ?? "inquiry",
    negotiation,
    order: trade?.order ?? trade?.linkedOrder ?? null,
    lastMessage: toLastMessageDto(lastMessage, row),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// 협상(trade-negotiation.js)·실행 큐(delegation-queue.js) 연동. 순환 import를 피하려고 동적으로 불러온다.
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

function loadQueueModule() {
  return loadPeerModule("./delegation-queue.js");
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

async function fetchJobState(db, convRow, viewerId) {
  const role = resolveConversationRole(convRow, viewerId);
  if (!role) return null;
  const mod = await loadQueueModule();
  if (!mod || typeof mod.getDelegationJobState !== "function") return null;
  return mod.getDelegationJobState({ conversationId: String(convRow.id), targetRole: role, pool: db });
}

/** 내 역할의 마지막 읽음 이후, 내가 볼 수 있는 상대(사람·AI) 메시지 수. 내 AI 발신은 세지 않는다. */
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

/** viewer 관점 DTO(안 읽음·협상 요약 포함, 상세 조회는 실행 상태까지). */
async function buildViewerConversation(db, convRow, viewerId, { inTransaction = false, lastMessageRow, detail = true } = {}) {
  const lastRow = lastMessageRow && isMessageVisibleTo(lastMessageRow, viewerId)
    ? lastMessageRow
    : await fetchLastVisibleMessageRow(db, convRow.id, viewerId);
  const unread = await countUnread(db, [String(convRow.id)], viewerId);
  const trade = await fetchTradeSummary(db, convRow, viewerId, { inTransaction, detail });
  // 큐 조회는 트랜잭션 밖(풀)에서만 한다(단일 연결 PGlite 교착 방지).
  const jobs = detail && !inTransaction ? await fetchJobState(db, convRow, viewerId) : null;
  return toConversationDto(convRow, lastRow, {
    viewerId,
    unreadCount: unread.get(String(convRow.id)) ?? 0,
    trade,
    jobs,
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

/**
 * 구매자의 대화방을 만들거나 가져와 잠근다. 새로 만들 때만 판매자가 매물 단위로 명시 저장한
 * "들어오는 문의" 정책을 판매자 칸에 복사한다(정책 행의 owner_id가 현재 소유자와 같을 때만).
 */
async function ensureBuyerConversation(client, listing, buyerId) {
  await client.query(
    `INSERT INTO conversations (listing_id, buyer_id, last_seq, owner_ai_mode, owner_ai_policy, owner_ai_policy_version)
     SELECT $1, $2, 0,
            COALESCE(p.mode, 'off'),
            COALESCE(p.policy, '{}'::jsonb),
            COALESCE(p.policy_version, 0)
     FROM (SELECT 1) AS seed
     LEFT JOIN listing_ai_policies p ON p.listing_id = $1 AND p.owner_id = $3
     ON CONFLICT (listing_id, buyer_id) DO NOTHING`,
    [listing.id, buyerId, listing.owner_id]
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

      const pauseCol = roleCol(role, "ai_pause");
      const draftCol = roleCol(role, "ai_draft_json");
      const modeCol = roleCol(role, "ai_mode");
      let seqRes;
      if (senderKind === "human") {
        // 자동 응대 중인 본인이 직접 보낸 메시지는 "직접 이어받기"로 본다. 다시 맡기기(resume) 전까지 자동 전송하지 않는다.
        // 상대방의 일시정지·초안은 건드리지 않는다. 레거시 공유 ai_paused_reason은 권한 근거가 아니므로 갱신하지 않는다.
        seqRes = await client.query(
          `UPDATE conversations
           SET last_seq = last_seq + 1,
               updated_at = now(),
               ai_consecutive_turns = 0,
               ${pauseCol} = CASE
                 WHEN ${modeCol} = 'autonomous' AND ${pauseCol} IS DISTINCT FROM 'transaction_completed' THEN 'takeover'
                 ELSE ${pauseCol}
               END,
               ${draftCol} = NULL,
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
               ${draftCol} = NULL,
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
      if (senderKind === "ai_proxy" && replyToSeq != null) {
        fail(409, "AI_REPLY_ALREADY_EXISTS", "이미 해당 메시지에 대한 AI 대리 응답이 존재합니다.");
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
            ai_confidence: row.last_msg_ai_confidence,
            reply_to_seq: row.last_msg_reply_to_seq,
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

function parseIsoDateOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

function sanitizeStringArray(raw, maxItems = 20, maxLen = 40) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(
    raw
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim().slice(0, maxLen))
  )].slice(0, maxItems);
}

/** 0 이상의 정수 금액. 비었거나 숫자가 아니면 null(미정). 미입력 한도를 정가 등으로 채우지 않는다. */
function moneyOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.trunc(num);
}

export function sanitizeAiPolicy(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const fullDelegation = typeof raw.fullDelegation === "boolean" ? raw.fullDelegation : false;
  const autoExecuteTransaction = typeof raw.autoExecuteTransaction === "boolean"
    ? raw.autoExecuteTransaction
    : fullDelegation;
  const targetStart = parseIsoDateOrNull(raw.targetStart);
  let targetEnd = parseIsoDateOrNull(raw.targetEnd);
  if (targetStart && targetEnd && targetEnd < targetStart) {
    targetEnd = targetStart;
  }

  const out = {
    fullDelegation,
    autoExecuteTransaction,
    intent: raw.intent === "rent" || raw.intent === "sale" ? raw.intent : null,
    targetStart,
    targetEnd,
    targetPrice: moneyOrNull(raw.targetPrice),
    maxBudget: moneyOrNull(raw.maxBudget),
    minPrice: moneyOrNull(raw.minPrice),
    budgetUnit: VALID_BUDGET_UNITS.has(raw.budgetUnit) ? raw.budgetUnit : null,
    requiredQuestions: sanitizeStringArray(raw.requiredQuestions, 10, 120),
    // 운송비: null = 미정(0원으로 간주하지 않음). 명시적 숫자만 저장한다.
    transportFee: moneyOrNull(raw.transportFee),
    transportPayer: VALID_TRANSPORT_PAYERS.has(raw.transportPayer) ? raw.transportPayer : null,
    areaPyeong:
      raw.areaPyeong !== null && raw.areaPyeong !== undefined && raw.areaPyeong !== "" &&
      Number.isFinite(Number(raw.areaPyeong)) && Number(raw.areaPyeong) > 0
        ? Number(raw.areaPyeong)
        : null,
    cropIds: sanitizeStringArray(raw.cropIds, 20, 40),
    operations: sanitizeStringArray(raw.operations, 20, 40),
    ownedModelId: typeof raw.ownedModelId === "string" && raw.ownedModelId.trim()
      ? raw.ownedModelId.trim().slice(0, 80)
      : null,
    region: typeof raw.region === "string" && raw.region.trim()
      ? raw.region.trim().slice(0, 40)
      : null,
    pickupPreference: typeof raw.pickupPreference === "string"
      ? raw.pickupPreference.trim().slice(0, 120)
      : "",
    customRules: typeof raw.customRules === "string"
      ? raw.customRules.trim().slice(0, 300)
      : "",
    maxConsecutiveAiTurns: fullDelegation ? 6 : 4,
  };

  if (typeof raw.instructions === "string") {
    out.instructions = raw.instructions.trim().slice(0, 500);
  }
  if (typeof raw.allowNegotiation === "boolean") {
    out.allowNegotiation = raw.allowNegotiation;
  }
  if (typeof raw.allowDelivery === "boolean") {
    out.allowDelivery = raw.allowDelivery;
  }
  if (typeof raw.preferredPickupWindow === "string") {
    out.preferredPickupWindow = raw.preferredPickupWindow.trim().slice(0, 60);
  }
  if (raw.maxConsecutiveAiTurns !== undefined && raw.maxConsecutiveAiTurns !== null && raw.maxConsecutiveAiTurns !== "") {
    const turns = Number(raw.maxConsecutiveAiTurns);
    if (Number.isFinite(turns)) {
      out.maxConsecutiveAiTurns = Math.min(10, Math.max(1, Math.trunc(turns)));
    }
  }
  if (Array.isArray(raw.autoReplyOn)) {
    out.autoReplyOn = [...new Set(raw.autoReplyOn.filter((t) => typeof t === "string" && VALID_AUTO_REPLY_TOPICS.has(t)))];
  }
  if (Array.isArray(raw.chips)) {
    out.chips = sanitizeStringArray(raw.chips, 12, 40);
  }
  if (typeof raw.desiredDate === "string") {
    out.desiredDate = raw.desiredDate.trim().slice(0, 30);
  }
  if (typeof raw.needDelivery === "boolean") {
    out.needDelivery = raw.needDelivery;
  }
  return out;
}

async function viewerResult(client, conversationId, userId, extra = {}) {
  const convRow = await fetchConversationById(client, conversationId);
  return {
    conversation: await buildViewerConversation(client, convRow, userId, { inTransaction: true, detail: false }),
    ...extra,
  };
}

/**
 * 내 역할의 대리 응대 모드·정책 저장. 정책 버전을 올려 생성 중이던 응답이 커밋되지 않게 한다.
 * 일시정지(직접 이어받기·확인 대기)는 resume:true(명시적 다시 맡기기)일 때만 해제된다.
 */
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
  const resume = payload?.resume === true;

  return withTransaction(async (client) => {
    let lockedConv;
    let role;

    if (conversationId) {
      ({ conv: lockedConv, role } = await lockConversationForUser(client, conversationId, user.id, "이 대화의 대리 응대 설정을 변경할 권한이 없습니다."));
      if (listingId && lockedConv.listing_id !== listingId) {
        fail(400, "CONVERSATION_MISMATCH", "대화방과 매물 정보가 일치하지 않습니다.");
      }
    } else {
      lockedConv = await lockListingForBuyer(client, listingId, user.id);
      role = "buyer";
    }

    const current = roleState(lockedConv, role);
    const nextMode = hasMode ? mode : current.mode;
    const nextPolicy = hasPolicy ? policy : current.policy;
    const doResume = resume && nextMode !== "off" && current.pause !== "transaction_completed";
    const nextPause = doResume ? null : current.pause;

    await client.query(
      `UPDATE conversations
       SET ${roleCol(role, "ai_mode")} = $2,
           ${roleCol(role, "ai_policy")} = $3::jsonb,
           ${roleCol(role, "ai_policy_version")} = ${roleCol(role, "ai_policy_version")} + 1,
           ${roleCol(role, "ai_pause")} = $4,
           ${roleCol(role, "ai_draft_json")} = CASE WHEN $2 = 'off' OR $5::boolean THEN NULL ELSE ${roleCol(role, "ai_draft_json")} END,
           ai_consecutive_turns = CASE WHEN $5::boolean THEN 0 ELSE ai_consecutive_turns END,
           ai_draft_json = CASE WHEN $2 = 'off' AND ai_draft_json->>'targetUserId' = $6 THEN NULL ELSE ai_draft_json END,
           updated_at = now()
       WHERE id = $1`,
      [lockedConv.id, nextMode, JSON.stringify(nextPolicy), nextPause, doResume, user.id]
    );

    return viewerResult(client, lockedConv.id, user.id, { role });
  }, pool);
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

/** 직접 이어받기: 내 AI 자동 전송을 멈춘다. 정책 버전을 올려 생성 중이던 응답이 커밋되지 않게 한다. */
export async function takeoverConversation(user, payload, { pool = getPool() } = {}) {
  const conversationId = requireUuid(payload?.conversationId, "대화방 ID");
  return withTransaction(async (client) => {
    const { conv, role } = await lockConversationForUser(client, conversationId, user.id);
    const pauseCol = roleCol(role, "ai_pause");
    await client.query(
      `UPDATE conversations
       SET ${pauseCol} = CASE WHEN ${pauseCol} = 'transaction_completed' THEN ${pauseCol} ELSE 'takeover' END,
           ${roleCol(role, "ai_policy_version")} = ${roleCol(role, "ai_policy_version")} + 1,
           updated_at = now()
       WHERE id = $1`,
      [conv.id]
    );
    return viewerResult(client, conv.id, user.id, { role });
  }, pool);
}

/**
 * 다시 맡기기: 내 역할의 일시정지만 해제한다. 내가 볼 수 있는 마지막 메시지가 상대방 것이면
 * resumeTrigger로 알려 API가 "내 역할"의 대리 응답을 예약하게 한다.
 */
export async function resumeConversation(user, payload, { pool = getPool() } = {}) {
  const conversationId = requireUuid(payload?.conversationId, "대화방 ID");
  return withTransaction(async (client) => {
    const { conv, role } = await lockConversationForUser(client, conversationId, user.id);
    const state = roleState(conv, role);
    if (state.mode === "off") {
      fail(400, "AI_MODE_OFF", "대리 응대 모드를 먼저 켜 주세요.");
    }
    if (state.pause === "transaction_completed") {
      fail(409, "TRANSACTION_ALREADY_APPLIED", "이미 거래 신청이 접수된 대화입니다. 이후 대화는 직접 진행해 주세요.");
    }
    await client.query(
      `UPDATE conversations
       SET ${roleCol(role, "ai_pause")} = NULL,
           ${roleCol(role, "ai_policy_version")} = ${roleCol(role, "ai_policy_version")} + 1,
           ${roleCol(role, "ai_draft_json")} = NULL,
           ai_consecutive_turns = 0,
           updated_at = now()
       WHERE id = $1`,
      [conv.id]
    );
    const lastRow = await fetchLastVisibleMessageRow(client, conv.id, user.id);
    const resumeTrigger =
      lastRow && lastRow.sender_kind !== "system" && lastRow.sender_id !== user.id
        ? { conversationId: String(conv.id), triggerSeq: Number(lastRow.seq), targetRole: role }
        : null;
    return viewerResult(client, conv.id, user.id, { role, mode: state.mode, resumeTrigger });
  }, pool);
}

export async function dismissAiDraft(user, payload, { pool = getPool() } = {}) {
  const conversationId = requireUuid(payload?.conversationId, "대화방 ID");
  return withTransaction(async (client) => {
    const { conv, role } = await lockConversationForUser(client, conversationId, user.id);
    await client.query(
      `UPDATE conversations
       SET ${roleCol(role, "ai_draft_json")} = NULL,
           ai_draft_json = CASE WHEN ai_draft_json->>'targetUserId' = $2 THEN NULL ELSE ai_draft_json END,
           updated_at = now()
       WHERE id = $1`,
      [conv.id, user.id]
    );
    return viewerResult(client, conv.id, user.id, { role });
  }, pool);
}

/** 실패한 내 역할의 대리 응답 작업을 다시 큐에 넣는다. 상대 역할 작업은 건드릴 수 없다. */
export async function retryAiJob(user, payload, { pool = getPool() } = {}) {
  const conversationId = requireUuid(payload?.conversationId, "대화방 ID");
  const triggerSeq = Number(payload?.triggerSeq);
  if (!Number.isSafeInteger(triggerSeq) || triggerSeq < 1) {
    fail(400, "INVALID_SEQ", "triggerSeq 파라미터가 올바르지 않습니다.");
  }
  const convRow = await fetchConversationById(pool, conversationId);
  if (!convRow) fail(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없습니다.");
  const role = resolveConversationRole(convRow, user.id);
  if (!role) fail(403, "FORBIDDEN", "이 대화에 접근할 수 없습니다.");
  const mod = await loadQueueModule();
  if (!mod || typeof mod.requeueFailedDelegationJob !== "function") {
    fail(501, "DELEGATION_QUEUE_UNAVAILABLE", "자동 응대 재시도를 사용할 수 없습니다.");
  }
  const result = await mod.requeueFailedDelegationJob({ conversationId: String(convRow.id), targetRole: role, triggerSeq, pool });
  if (!result?.requeued) {
    fail(409, "JOB_NOT_RETRYABLE", "다시 시도할 실패 작업이 없습니다.");
  }
  return {
    role,
    requeued: true,
    jobId: result.jobId ?? null,
    conversation: await buildViewerConversation(pool, convRow, user.id, { detail: true }),
  };
}

// ---------------------------------------------------------------------------
// 판매자 매물 단위 "들어오는 문의 맡기기" 정책 (새 대화에만 적용)

function toInboundPolicyDto(row) {
  if (!row) return null;
  return {
    listingId: row.listing_id,
    mode: row.mode,
    policy: row.policy && typeof row.policy === "object" ? row.policy : {},
    policyVersion: Number(row.policy_version),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

async function requireOwnedListing(db, listingId, userId) {
  const cleanListingId = normalizeText(listingId, { min: 1, max: 80, field: "매물 ID" });
  const res = await db.query(`SELECT id, owner_id, status FROM listings WHERE id = $1`, [cleanListingId]);
  const listing = res.rows[0];
  if (!listing) fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
  if (listing.owner_id !== userId) {
    fail(403, "FORBIDDEN", "본인 매물의 문의 위임만 설정할 수 있습니다.");
  }
  return listing;
}

export async function getListingInboundPolicy(user, listingId, { pool = getPool() } = {}) {
  const listing = await requireOwnedListing(pool, listingId, user.id);
  const res = await pool.query(
    `SELECT * FROM listing_ai_policies WHERE listing_id = $1 AND owner_id = $2`,
    [listing.id, user.id]
  );
  return { inboundPolicy: toInboundPolicyDto(res.rows[0]) };
}

export async function setListingInboundPolicy(user, payload, { pool = getPool() } = {}) {
  const mode = String(payload?.mode ?? "").trim();
  if (!VALID_AI_MODES.has(mode)) {
    fail(400, "INVALID_AI_MODE", "올바르지 않은 대리 응대 모드입니다.");
  }
  const policy = sanitizeAiPolicy(payload?.policy ?? {});
  return withTransaction(async (client) => {
    const listing = await requireOwnedListing(client, payload?.listingId, user.id);
    if (listing.status === "removed") {
      fail(409, "INVALID_LISTING_STATE", "삭제된 매물에는 문의 위임을 설정할 수 없습니다.");
    }
    const res = await client.query(
      `INSERT INTO listing_ai_policies (listing_id, owner_id, mode, policy, policy_version)
       VALUES ($1, $2, $3, $4::jsonb, 1)
       ON CONFLICT (listing_id) DO UPDATE
         SET owner_id = EXCLUDED.owner_id,
             mode = EXCLUDED.mode,
             policy = EXCLUDED.policy,
             policy_version = listing_ai_policies.policy_version + 1,
             updated_at = now()
       RETURNING *`,
      [listing.id, user.id, mode, JSON.stringify(policy)]
    );
    return { inboundPolicy: toInboundPolicyDto(res.rows[0]) };
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
      senderKind: "human",
      source: "human",
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
