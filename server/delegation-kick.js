// 트래픽 기반 대리 응대 큐 스윕(Vercel Hobby 호환).
// Hobby 요금제의 Vercel Cron은 하루 1회만 허용되므로, 정기 크론(/api/delegation-jobs)은 하루 1회 백스톱으로 두고
// 재시도(30초·2분·10분 백오프)와 만료 임대 회수는 사용자 요청에 얹어 처리한다.
// - 대화방 조회(채팅 화면은 2.5~4초마다 폴링)마다 그 대화방의 만기 작업을 처리한다(대화방당 CONV_INTERVAL_MS에 1회).
// - 어느 요청이든 전체 큐를 GLOBAL_INTERVAL_MS에 1회, 누락 이벤트 보충은 BACKFILL_INTERVAL_MS에 1회 돌린다.
// - 횟수 제한은 모든 인스턴스가 공유하는 rate_limits 행으로 판정한다(같은 창을 가장 먼저 연 요청만 실행).
//   같은 인스턴스 안에서는 메모리 메모로 DB 왕복도 줄인다.
// - 응답을 늦추지 않도록 전부 waitUntil 백그라운드에서 실행하며, 실패해도 요청에는 영향이 없다.
//   처리 중 인스턴스가 죽어도 임대 만료 후 다음 스윕이 회수한다(큐는 at-least-once).
import { getPool } from "./db.js";
import { isWritesFrozen } from "./migrator.js";
import { scheduleWaitUntil } from "./wait-until.js";

export const CONV_INTERVAL_MS = 10_000;
export const GLOBAL_INTERVAL_MS = 60_000;
export const BACKFILL_INTERVAL_MS = 15 * 60_000;

const memo = new Map();
const MEMO_MAX = 500;

export function resetDelegationKickMemo() {
  memo.clear();
}

export function isDelegationKickEnabled(env = process.env) {
  if (env.DELEGATION_KICK === "0") return false;
  // 테스트 실행 중에는 명시적으로 켠 경우에만 동작해 다른 테스트의 큐 상태를 건드리지 않는다.
  if (env.NODE_TEST_CONTEXT && env.DELEGATION_KICK !== "1") return false;
  return true;
}

function memoAllows(key, start) {
  if (memo.get(key) === start) return false;
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(key, start);
  return true;
}

/**
 * 고정 창마다 한 요청만 true를 받는다. 모든 인스턴스가 rate_limits 행 하나를 두고 경쟁한다.
 * 같은 창이 이미 열렸으면 UPDATE의 WHERE가 거짓이라 행이 돌아오지 않는다.
 */
export async function acquireTick(pool, key, intervalMs, now = Date.now()) {
  const start = Math.floor(now / intervalMs) * intervalMs;
  if (!memoAllows(key, start)) return false;
  const res = await pool.query(
    `INSERT INTO rate_limits (key, window_start, expires_at, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (key) DO UPDATE SET
       window_start = EXCLUDED.window_start,
       expires_at = EXCLUDED.expires_at,
       count = 1
     WHERE rate_limits.window_start < EXCLUDED.window_start
     RETURNING key`,
    [key, start, start + intervalMs]
  );
  return res.rows.length > 0;
}

/**
 * 실제 스윕. 테스트에서 직접 await할 수 있도록 kickDelegationQueue와 분리했다.
 * @returns {Promise<{conversation: object|null, global: object|null, skipped?: string}>}
 */
export async function runDelegationKick({
  conversationId = null,
  pool = getPool(),
  now = Date.now(),
  processJobs = null,
} = {}) {
  const out = { conversation: null, global: null };
  if (await isWritesFrozen({ pool })) return { ...out, skipped: "WRITES_FROZEN" };
  const runJobs = processJobs ?? (await import("./delegation-queue.js")).processDelegationJobs;

  if (conversationId && (await acquireTick(pool, `delegation-kick:conv:${conversationId}`, CONV_INTERVAL_MS, now))) {
    out.conversation = await runJobs({ pool, conversationId, limit: 2, concurrency: 1, budgetMs: 15_000 });
  }
  if (await acquireTick(pool, "delegation-kick:all", GLOBAL_INTERVAL_MS, now)) {
    const backfill = await acquireTick(pool, "delegation-kick:backfill", BACKFILL_INTERVAL_MS, now);
    out.global = await runJobs({ pool, limit: 3, concurrency: 1, budgetMs: 20_000, backfill });
  }
  return out;
}

/**
 * 요청 처리 중에 호출한다. 응답을 기다리게 하지 않고 백그라운드로 스윕을 예약한다.
 * conversationId는 형식이 맞는 UUID일 때만 대화방 단위 스윕에 쓴다.
 */
export function kickDelegationQueue({ conversationId = null, env = process.env, ...rest } = {}) {
  if (!isDelegationKickEnabled(env)) return null;
  const convId =
    typeof conversationId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)
      ? conversationId.toLowerCase()
      : null;
  const task = runDelegationKick({ conversationId: convId, ...rest }).catch((error) => {
    console.warn("delegation_kick_failed", error?.code ?? (error instanceof Error ? error.name : "unknown"));
    return null;
  });
  // 서버리스에서 waitUntil이 없더라도 응답을 막지 않는다(놓친 작업은 다음 스윕이 회수).
  scheduleWaitUntil(task, { awaitFallback: false }).catch(() => {});
  return task;
}
