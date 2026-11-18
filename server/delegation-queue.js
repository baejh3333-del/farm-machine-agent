// 대리 응대 실행 영속 큐.
// - 같은 수신 이벤트(대화방·역할·트리거 seq)는 delegation_jobs 1행으로만 기록된다(멱등 enqueue).
// - 처리기는 FOR UPDATE SKIP LOCKED로 작업을 임대하고, 임대 토큰이 맞을 때만 결과를 기록한다.
// - 일시 오류는 제한된 횟수만큼 지수 백오프로 재시도하고, 이후 failed로 남겨 사용자에게 보이게 한다.
// - 정기 스윕(api/delegation-jobs.js, 서버 비밀 필요)이 만료 임대·재시도·누락 이벤트를 회수하므로
//   사용자가 앱을 닫아도 처리된다. 실행기는 at-least-once이며, 결과 멱등성은 runDelegatedChatReply의
//   (conversation, reply_to_seq, sender) 유니크 인덱스와 커밋 재검증이 보장한다.
import { randomUUID } from "node:crypto";
import { getPool, withTransaction } from "./db.js";

export const DEFAULT_MAX_ATTEMPTS = 4;
export const DEFAULT_LEASE_MS = 120_000;
export const RETRY_BACKOFF_MS = Object.freeze([30_000, 120_000, 600_000]);
export const BACKFILL_WINDOW_HOURS = 24;

// 다시 시도하면 결과가 달라질 수 있는 실행기 반환 사유
export const RETRYABLE_REASONS = new Set(["LLM_FAILED", "LLM_NO_ACTION", "LOCK_BUSY", "LLM_UNAVAILABLE"]);

const VALID_ROLES = new Set(["buyer", "owner"]);
const VALID_SOURCES = new Set(["event", "chain", "backfill", "manual"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireJobKey({ conversationId, triggerSeq, targetRole }) {
  const convId = typeof conversationId === "string" ? conversationId.trim().toLowerCase() : "";
  if (!UUID_RE.test(convId)) throw new TypeError("delegation job requires a conversation UUID");
  const seq = Number(triggerSeq);
  if (!Number.isSafeInteger(seq) || seq < 1) throw new TypeError("delegation job requires a positive triggerSeq");
  if (!VALID_ROLES.has(targetRole)) throw new TypeError(`delegation job requires buyer|owner role, got ${targetRole}`);
  return { convId, seq, role: targetRole };
}

export function backoffDelayMs(attempts) {
  const idx = Math.min(Math.max(1, Number(attempts) || 1), RETRY_BACKOFF_MS.length) - 1;
  return RETRY_BACKOFF_MS[idx];
}

function sanitizeReason(value) {
  if (value == null) return null;
  const s = String(value).replace(/[^A-Za-z0-9_:.-]/g, "_").slice(0, 120);
  return s || null;
}

// 오류 문구에는 비밀값·사용자 입력이 섞일 수 있어 코드와 짧은 클래스명만 남긴다.
function sanitizeError(error) {
  const code = typeof error?.code === "string" ? error.code.slice(0, 40) : "";
  const name = error instanceof Error ? error.name : typeof error;
  return `${name}${code ? `:${code}` : ""}`.replace(/[^A-Za-z0-9_:.-]/g, "_").slice(0, 300);
}

function summarizeResult(result) {
  if (!result || typeof result !== "object") return { kind: "empty" };
  const out = {};
  for (const key of ["action", "reason", "skipped", "aborted", "paused", "seq", "replyToSeq", "nextTargetRole", "aiPausedReason"]) {
    if (result[key] !== undefined && (typeof result[key] !== "object" || result[key] === null)) out[key] = result[key];
  }
  return out;
}

/**
 * 실행기 반환값을 큐 결과로 분류한다.
 * @returns {"retry"|"succeeded"}
 */
export function classifyRunResult(result) {
  if (result && typeof result === "object") {
    if (result.retryable === true) return "retry";
    if ((result.skipped || result.aborted) && RETRYABLE_REASONS.has(result.reason)) return "retry";
  }
  return "succeeded";
}

/**
 * 수신 이벤트를 큐에 기록한다. 같은 (대화방, 역할, seq)는 1건만 남는다.
 * client를 넘기면 호출자의 트랜잭션 안에서 메시지 커밋과 함께 기록된다.
 */
export async function enqueueDelegatedReply(params = {}) {
  const { pool = getPool(), client = null, source = "event", maxAttempts = DEFAULT_MAX_ATTEMPTS } = params;
  const { convId, seq, role } = requireJobKey(params);
  const cleanSource = VALID_SOURCES.has(source) ? source : "event";
  const attemptsCap = Math.min(20, Math.max(1, Math.trunc(Number(maxAttempts)) || DEFAULT_MAX_ATTEMPTS));
  const db = client || pool;
  const ins = await db.query(
    `INSERT INTO delegation_jobs (conversation_id, target_role, trigger_seq, kind, source, max_attempts)
     VALUES ($1, $2, $3, 'reply', $4, $5)
     ON CONFLICT (conversation_id, target_role, trigger_seq, kind) DO NOTHING
     RETURNING id, status`,
    [convId, role, seq, cleanSource, attemptsCap]
  );
  if (ins.rows.length) {
    return { jobId: String(ins.rows[0].id), created: true, status: ins.rows[0].status };
  }
  const existing = await db.query(
    `SELECT id, status FROM delegation_jobs
     WHERE conversation_id = $1 AND target_role = $2 AND trigger_seq = $3 AND kind = 'reply'`,
    [convId, role, seq]
  );
  const row = existing.rows[0];
  return { jobId: row ? String(row.id) : null, created: false, status: row?.status ?? null };
}

/**
 * 실패로 끝난 작업을 사용자의 [다시 시도]로 다시 대기열에 넣는다.
 */
export async function requeueFailedDelegationJob(params = {}) {
  const { pool = getPool(), client = null } = params;
  const { convId, seq, role } = requireJobKey(params);
  const res = await (client || pool).query(
    `UPDATE delegation_jobs
     SET status = 'queued', attempts = 0, next_attempt_at = now(), lease_token = NULL, lease_owner = NULL,
         lease_until = NULL, source = 'manual', finished_at = NULL, updated_at = now()
     WHERE conversation_id = $1 AND target_role = $2 AND trigger_seq = $3 AND kind = 'reply' AND status = 'failed'
     RETURNING id`,
    [convId, role, seq]
  );
  return { requeued: res.rows.length > 0, jobId: res.rows[0] ? String(res.rows[0].id) : null };
}

/**
 * 거래 관리 화면용 역할별 실행 상태. 메시지 본문이나 오류 원문은 포함하지 않는다.
 */
export async function getDelegationJobState({ conversationId, targetRole, pool = getPool() } = {}) {
  const { convId, role } = requireJobKey({ conversationId, targetRole, triggerSeq: 1 });
  const res = await pool.query(
    `SELECT trigger_seq, status, attempts, last_reason, next_attempt_at, updated_at, finished_at
     FROM delegation_jobs
     WHERE conversation_id = $1 AND target_role = $2
     ORDER BY trigger_seq DESC
     LIMIT 20`,
    [convId, role]
  );
  const iso = (v) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  const pending = res.rows.filter((r) => ["queued", "running", "retry"].includes(r.status));
  const failed = res.rows.filter((r) => r.status === "failed");
  const lastOk = res.rows.find((r) => r.status === "succeeded");
  return {
    pending: pending.map((r) => ({
      triggerSeq: Number(r.trigger_seq),
      status: r.status,
      attempts: Number(r.attempts),
      nextAttemptAt: iso(r.next_attempt_at),
    })),
    failed: failed.map((r) => ({
      triggerSeq: Number(r.trigger_seq),
      attempts: Number(r.attempts),
      lastReason: r.last_reason ?? null,
      updatedAt: iso(r.updated_at),
    })),
    lastSucceededAt: lastOk ? iso(lastOk.finished_at) : null,
  };
}

async function defaultRunner(job, { pool, runnerOptions = {} }) {
  const { runDelegatedChatReply } = await import("./delegated-chat.js");
  return runDelegatedChatReply({
    ...runnerOptions,
    conversationId: job.conversationId,
    triggerSeq: job.triggerSeq,
    targetRole: job.targetRole,
    pool,
    onScheduleNext: (next) => enqueueDelegatedReply({ ...next, pool, source: "chain" }),
  });
}

/**
 * 누락된 수신 이벤트 보충: 자동 응대(autonomous) 역할의 최신 메시지가 상대방 발신인데
 * 해당 seq 작업이 없는 경우만 기록한다(메시지 커밋 직후 프로세스가 죽은 경우 등).
 * 일시정지·정책 재검사는 실행기가 다시 하므로 여기서는 후보만 고른다.
 */
export async function backfillMissedEvents({ pool = getPool(), windowHours = BACKFILL_WINDOW_HOURS, limit = 50 } = {}) {
  const res = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (m.conversation_id)
              m.conversation_id, m.seq, m.sender_id, m.sender_kind, m.created_at
       FROM messages m
       WHERE m.created_at > now() - make_interval(hours => $1::int)
       ORDER BY m.conversation_id, m.seq DESC
     ),
     candidates AS (
       SELECT lt.conversation_id, lt.seq, r.role
       FROM latest lt
       JOIN conversations c ON c.id = lt.conversation_id
       JOIN listings l ON l.id = c.listing_id
       CROSS JOIN LATERAL (VALUES
         ('buyer', c.buyer_ai_mode, c.buyer_id),
         ('owner', c.owner_ai_mode, l.owner_id)
       ) AS r(role, mode, user_id)
       WHERE lt.sender_kind <> 'system'
         AND r.mode = 'autonomous'
         AND lt.sender_id <> r.user_id
         AND lt.seq = c.last_seq
     )
     SELECT cd.conversation_id, cd.seq, cd.role
     FROM candidates cd
     WHERE NOT EXISTS (
       SELECT 1 FROM delegation_jobs j
       WHERE j.conversation_id = cd.conversation_id AND j.target_role = cd.role AND j.trigger_seq = cd.seq
     )
     LIMIT $2`,
    [Math.max(1, Math.trunc(Number(windowHours)) || BACKFILL_WINDOW_HOURS), Math.max(1, Math.trunc(Number(limit)) || 50)]
  );
  let created = 0;
  for (const row of res.rows) {
    const out = await enqueueDelegatedReply({
      conversationId: String(row.conversation_id),
      triggerSeq: Number(row.seq),
      targetRole: row.role,
      pool,
      source: "backfill",
    });
    if (out.created) created += 1;
  }
  return created;
}

async function claimOne({ pool, leaseMs, workerId, conversationId }) {
  return withTransaction(async (client) => {
    const params = [];
    let filter = "";
    if (conversationId) {
      params.push(conversationId);
      filter = ` AND conversation_id = $${params.length}`;
    }
    const pick = await client.query(
      `SELECT id FROM delegation_jobs
       WHERE ((status IN ('queued', 'retry') AND next_attempt_at <= now())
              OR (status = 'running' AND lease_until < now()))${filter}
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      params
    );
    if (!pick.rows.length) return null;
    const token = randomUUID();
    const upd = await client.query(
      `UPDATE delegation_jobs
       SET status = 'running', attempts = attempts + 1, lease_token = $2, lease_owner = $3,
           lease_until = now() + make_interval(secs => $4::double precision), updated_at = now()
       WHERE id = $1
       RETURNING id, conversation_id, target_role, trigger_seq, attempts, max_attempts`,
      [pick.rows[0].id, token, workerId.slice(0, 80), leaseMs / 1000]
    );
    const row = upd.rows[0];
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      targetRole: row.target_role,
      triggerSeq: Number(row.trigger_seq),
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      leaseToken: token,
    };
  }, pool);
}

async function finishJob(pool, job, { status, reason = null, error = null, result = null, delayMs = 0 }) {
  const res = await pool.query(
    `UPDATE delegation_jobs
     SET status = $3,
         last_reason = $4,
         last_error = $5,
         result = $6::jsonb,
         next_attempt_at = CASE WHEN $3 = 'retry' THEN now() + make_interval(secs => $7::double precision) ELSE next_attempt_at END,
         finished_at = CASE WHEN $3 IN ('succeeded', 'failed') THEN now() ELSE NULL END,
         lease_token = NULL, lease_owner = NULL, lease_until = NULL,
         updated_at = now()
     WHERE id = $1 AND lease_token = $2 AND status = 'running'
     RETURNING id`,
    [job.id, job.leaseToken, status, sanitizeReason(reason), error, result ? JSON.stringify(result) : null, delayMs / 1000]
  );
  // 임대가 만료돼 다른 처리기가 가져간 경우 결과를 덮어쓰지 않는다.
  return res.rows.length > 0;
}

async function runClaimedJob(job, { pool, runner, runnerOptions }) {
  let outcome;
  let reason = null;
  let errorText = null;
  let summary = null;
  try {
    const result = await runner(job, { pool, runnerOptions });
    summary = summarizeResult(result);
    reason = result?.reason ?? result?.action ?? null;
    outcome = classifyRunResult(result);
  } catch (error) {
    outcome = "retry";
    reason = "RUNNER_ERROR";
    errorText = sanitizeError(error);
    console.warn("delegation_job_failed", { jobId: job.id, attempts: job.attempts, error: errorText });
  }

  if (outcome === "succeeded") {
    const ok = await finishJob(pool, job, { status: "succeeded", reason, result: summary });
    return ok ? "succeeded" : "lease_lost";
  }
  if (job.attempts >= job.maxAttempts) {
    const ok = await finishJob(pool, job, { status: "failed", reason, error: errorText, result: summary });
    return ok ? "failed" : "lease_lost";
  }
  const ok = await finishJob(pool, job, {
    status: "retry",
    reason,
    error: errorText,
    result: summary,
    delayMs: backoffDelayMs(job.attempts),
  });
  return ok ? "retried" : "lease_lost";
}

/**
 * 대기·재시도·만료 임대 작업을 처리한다. 정기 스윕과 요청 직후 빠른 경로가 같은 함수를 쓴다.
 * budgetMs가 지나면 새 작업을 더 가져오지 않는다(이미 시작한 작업은 끝까지 수행).
 */
export async function processDelegationJobs(options = {}) {
  const {
    pool = getPool(),
    runner = defaultRunner,
    runnerOptions = {}, // 테스트용: 기본 실행기에 넘길 추가 인자(예: LLM 스텁 call, today)
    limit = 5,
    concurrency = 2,
    budgetMs = 25_000,
    leaseMs = DEFAULT_LEASE_MS,
    conversationId = null,
    backfill = false,
    workerId = `w-${process.pid}-${randomUUID().slice(0, 8)}`,
    now = () => Date.now(),
  } = options;

  const stats = { claimed: 0, succeeded: 0, retried: 0, failed: 0, leaseLost: 0, backfilled: 0 };
  const cleanConv = conversationId ? requireJobKey({ conversationId, triggerSeq: 1, targetRole: "buyer" }).convId : null;

  if (backfill && !cleanConv) {
    stats.backfilled = await backfillMissedEvents({ pool });
  }

  const started = now();
  const max = Math.max(0, Math.trunc(Number(limit)) || 0);
  const lanes = Math.max(1, Math.min(8, Math.trunc(Number(concurrency)) || 1));

  const lane = async () => {
    while (stats.claimed < max && now() - started < budgetMs) {
      stats.claimed += 1; // 다른 레인이 상한을 넘지 않도록 먼저 예약
      const job = await claimOne({ pool, leaseMs, workerId, conversationId: cleanConv });
      if (!job) {
        stats.claimed -= 1;
        return;
      }
      const res = await runClaimedJob(job, { pool, runner, runnerOptions });
      if (res === "succeeded") stats.succeeded += 1;
      else if (res === "retried") stats.retried += 1;
      else if (res === "failed") stats.failed += 1;
      else stats.leaseLost += 1;
    }
  };

  await Promise.all(Array.from({ length: lanes }, lane));
  return stats;
}
