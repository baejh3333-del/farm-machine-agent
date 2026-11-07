import { createHmac } from "node:crypto";
import { getPool } from "./db.js";

// /api/recommend 호출 제한. 응답이 실패하면 화면은 규칙 기반 추천으로 돌아가므로,
// 제한을 확인할 수 없을 때도 OpenAI를 호출하지 않는 쪽(fail-closed)으로 처리한다.

const MINUTE = 60_000;
const DAY = 86_400_000;
const KST = 9 * 3_600_000;

function readLimit(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

// max가 0이면 해당 제한을 끈다. 일일 제한은 한국 시간 자정에 초기화한다.
export function recommendLimits(env = process.env) {
  return [
    { scope: "ip", name: "minute", window: MINUTE, offset: 0, max: readLimit(env, "RECOMMEND_LIMIT_PER_MINUTE", 15) },
    { scope: "ip", name: "day", window: DAY, offset: KST, max: readLimit(env, "RECOMMEND_LIMIT_PER_DAY", 150) },
    { scope: "all", name: "day", window: DAY, offset: KST, max: readLimit(env, "RECOMMEND_GLOBAL_LIMIT_PER_DAY", 3000) },
  ];
}

function firstHeader(value) {
  return String(Array.isArray(value) ? value[0] : value ?? "").split(",")[0].trim();
}

// Vercel은 x-forwarded-for를 직접 덮어써 외부에서 위조한 값을 전달하지 않는다.
// 로컬 개발 서버에서는 전달 헤더를 믿지 않고 소켓 주소만 쓴다.
export function clientAddress(request, env = process.env) {
  if (env.VERCEL) {
    const forwarded = firstHeader(request.headers?.["x-vercel-forwarded-for"]) || firstHeader(request.headers?.["x-forwarded-for"]);
    if (forwarded) return forwarded;
  }
  return request.socket?.remoteAddress || "unknown";
}

// DB에 원래 IP를 남기지 않도록 서버 비밀값으로 HMAC 처리한다.
function addressId(address, env) {
  return createHmac("sha256", env.BETTER_AUTH_SECRET || "moa-local-rate-limit").update(address).digest("base64url").slice(0, 24);
}

export function createMemoryStore() {
  const buckets = new Map();
  return {
    async hit(entries, now) {
      if (buckets.size > 10_000) {
        for (const [key, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(key);
      }
      return entries.map(({ key, start, expiresAt }) => {
        const bucket = buckets.get(key);
        const count = bucket?.start === start ? bucket.count + 1 : 1;
        buckets.set(key, { start, expiresAt, count });
        return count;
      });
    },
  };
}

export function createPostgresStore(pool) {
  let ready;
  return {
    async hit(entries, now) {
      ready ??= pool.query(`
        CREATE TABLE IF NOT EXISTS recommend_rate_limit (
          key TEXT PRIMARY KEY,
          window_start BIGINT NOT NULL,
          expires_at BIGINT NOT NULL,
          count INTEGER NOT NULL
        )
      `).catch((error) => {
        ready = undefined;
        throw error;
      });
      await ready;
      const params = entries.flatMap(({ key, start, expiresAt }) => [key, start, expiresAt]);
      const values = entries.map((_, index) => `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3}, 1)`);
      // SET 절의 recommend_rate_limit.* 는 갱신 전 값을 가리키므로 같은 창이면 +1, 새 창이면 1부터 센다.
      const { rows } = await pool.query(`
        INSERT INTO recommend_rate_limit (key, window_start, expires_at, count)
        VALUES ${values.join(", ")}
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN recommend_rate_limit.window_start = EXCLUDED.window_start
            THEN recommend_rate_limit.count + 1 ELSE 1 END,
          window_start = EXCLUDED.window_start,
          expires_at = EXCLUDED.expires_at
        RETURNING key, count
      `, params);
      if (Math.random() < 0.01) {
        pool.query("DELETE FROM recommend_rate_limit WHERE expires_at < $1", [now]).catch(() => {});
      }
      const counts = new Map(rows.map((row) => [row.key, Number(row.count)]));
      return entries.map(({ key }) => counts.get(key));
    },
  };
}

let defaultStore;
function getDefaultStore(env = process.env) {
  if (defaultStore) return defaultStore;
  if (env.DATABASE_URL) {
    // 앱 데이터와 같은 연결 풀을 쓴다.
    defaultStore = createPostgresStore(getPool());
  } else {
    if (env.VERCEL) console.warn("DATABASE_URL is not set; recommend rate limit is per instance only");
    defaultStore = createMemoryStore();
  }
  return defaultStore;
}

function windowStart(now, { window, offset }) {
  return Math.floor((now + offset) / window) * window - offset;
}

// IP 제한을 먼저 확인하고, 통과한 요청만 전체 일일 한도에 센다.
// 그래야 한 IP가 차단된 뒤에도 요청을 계속 보내 전체 한도를 소진하지 못한다.
export async function checkRecommendLimit(request, options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const store = options.store ?? getDefaultStore(env);
  const limits = (options.limits ?? recommendLimits(env)).filter(({ max }) => max > 0);
  const id = addressId(clientAddress(request, env), env);
  for (const scope of ["ip", "all"]) {
    const group = limits.filter((limit) => limit.scope === scope);
    if (!group.length) continue;
    const entries = group.map((limit) => {
      const start = windowStart(now, limit);
      return { key: scope === "ip" ? `ip:${id}:${limit.name}` : `all:${limit.name}`, start, expiresAt: start + limit.window };
    });
    const counts = await store.hit(entries, now);
    const retryAfter = Math.max(0, ...group.map((limit, index) =>
      counts[index] > limit.max ? Math.ceil((entries[index].expiresAt - now) / 1000) : 0));
    if (retryAfter) return { allowed: false, retryAfter };
  }
  return { allowed: true };
}

// 두 서버(Vercel 함수, 로컬 개발 서버)가 같은 응답을 쓰도록 상태·헤더·본문만 돌려준다.
export async function recommendLimitResponse(request, options) {
  try {
    const result = await checkRecommendLimit(request, options);
    if (result.allowed) return null;
    return {
      status: 429,
      headers: { "Retry-After": String(result.retryAfter) },
      body: { error: "요청이 많아 잠시 후 다시 시도해 주세요." },
    };
  } catch (error) {
    console.error("recommend rate limit failed", error instanceof Error ? error.message : "unknown");
    return { status: 503, headers: {}, body: { error: "추천 서비스에 일시적인 문제가 있습니다." } };
  }
}
