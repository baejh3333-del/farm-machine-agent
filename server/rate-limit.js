import { createHmac } from "node:crypto";
import { getPool } from "./db.js";
import { HttpError } from "./http.js";

// 고정 창(fixed window) 호출 제한. 횟수는 rate_limits 테이블에 저장해 모든 인스턴스가 공유한다.
// 일일 제한은 한국 시간 자정에 초기화한다.

const MINUTE = 60_000;
const DAY = 86_400_000;
const KST = 9 * 3_600_000;

function readLimit(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

const perMinute = (max) => ({ scope: "client", name: "minute", window: MINUTE, offset: 0, max });
const perDay = (max) => ({ scope: "client", name: "day", window: DAY, offset: KST, max });
const globalPerDay = (max) => ({ scope: "all", name: "day", window: DAY, offset: KST, max });

/**
 * 정책별 제한. max가 0이면 해당 제한을 끈다.
 * failOpen=false: 횟수를 확인할 수 없으면 요청을 거부한다(외부 과금이 걸린 추천 API).
 * failOpen=true: 횟수를 확인할 수 없어도 요청을 통과시킨다(핵심 쓰기 기능이 제한 저장소 장애로 멈추지 않도록).
 */
export function ratePolicies(env = process.env) {
  return {
    recommend: {
      failOpen: false,
      limits: [
        perMinute(readLimit(env, "RECOMMEND_LIMIT_PER_MINUTE", 15)),
        perDay(readLimit(env, "RECOMMEND_LIMIT_PER_DAY", 150)),
        globalPerDay(readLimit(env, "RECOMMEND_GLOBAL_LIMIT_PER_DAY", 3000)),
      ],
    },
    message: { failOpen: true, limits: [perMinute(30), perDay(1000)] },
    listing: { failOpen: true, limits: [perMinute(20), perDay(200)] },
    rental: { failOpen: true, limits: [perMinute(10), perDay(50)] },
  };
}

function firstHeader(value) {
  return String(Array.isArray(value) ? value[0] : value ?? "").split(",")[0].trim();
}

// Vercel은 전달 헤더를 직접 덮어써 외부에서 위조한 값을 전달하지 않는다.
// 로컬 개발 서버에서는 전달 헤더를 믿지 않고 소켓 주소만 쓴다.
export function clientAddress(request, env = process.env) {
  if (env.VERCEL) {
    const forwarded =
      firstHeader(request.headers?.["x-vercel-forwarded-for"]) || firstHeader(request.headers?.["x-forwarded-for"]);
    if (forwarded) return forwarded;
  }
  return request.socket?.remoteAddress || "unknown";
}

// DB에 원래 IP를 남기지 않도록 서버 비밀값으로 HMAC 처리한다.
function addressId(address, env) {
  return createHmac("sha256", env.BETTER_AUTH_SECRET || "moa-local-rate-limit")
    .update(address)
    .digest("base64url")
    .slice(0, 24);
}

function windowStart(now, { window, offset }) {
  return Math.floor((now + offset) / window) * window - offset;
}

async function hit(pool, entries, now) {
  const params = entries.flatMap(({ key, start, expiresAt }) => [key, start, expiresAt]);
  const values = entries.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, 1)`);
  // SET 절의 rate_limits.* 는 갱신 전 값을 가리키므로 같은 창이면 +1, 새 창이면 1부터 센다.
  const { rows } = await pool.query(
    `INSERT INTO rate_limits (key, window_start, expires_at, count)
     VALUES ${values.join(", ")}
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = EXCLUDED.window_start
         THEN rate_limits.count + 1 ELSE 1 END,
       window_start = EXCLUDED.window_start,
       expires_at = EXCLUDED.expires_at
     RETURNING key, count`,
    params
  );
  if (Math.random() < 0.01) {
    pool.query("DELETE FROM rate_limits WHERE expires_at < $1", [now]).catch(() => {});
  }
  const counts = new Map(rows.map((row) => [row.key, Number(row.count)]));
  return entries.map(({ key }) => counts.get(key));
}

/**
 * 요청 1건을 세고 허용 여부를 돌려준다. 로그인 사용자는 계정 단위, 그 외는 IP 단위로 센다.
 * 개별 제한을 먼저 확인하고 통과한 요청만 전체 한도에 센다.
 * 그래야 차단된 클라이언트가 요청을 계속 보내 전체 한도를 소진하지 못한다.
 */
export async function checkRateLimit(request, policyName, options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const pool = options.pool ?? getPool();
  const policy = (options.policies ?? ratePolicies(env))[policyName];
  if (!policy) throw new Error(`Unknown rate limit policy '${policyName}'`);
  const limits = policy.limits.filter(({ max }) => max > 0);
  const subject = options.userId
    ? `u:${options.userId}`
    : `ip:${addressId(clientAddress(request, env), env)}`;

  for (const scope of ["client", "all"]) {
    const group = limits.filter((limit) => limit.scope === scope);
    if (!group.length) continue;
    const entries = group.map((limit) => {
      const start = windowStart(now, limit);
      return {
        key: `${policyName}:${scope === "client" ? subject : "all"}:${limit.name}`,
        start,
        expiresAt: start + limit.window,
      };
    });
    const counts = await hit(pool, entries, now);
    const retryAfter = Math.max(
      0,
      ...group.map((limit, i) => (counts[i] > limit.max ? Math.ceil((entries[i].expiresAt - now) / 1000) : 0))
    );
    if (retryAfter) return { allowed: false, retryAfter };
  }
  return { allowed: true };
}

/**
 * 한도를 넘으면 429(Retry-After 포함)를 던진다.
 * 테스트 실행 중에는 ENABLE_RATE_LIMIT=1일 때만 동작한다.
 */
export async function enforceRateLimit(request, policyName, options = {}) {
  const env = options.env ?? process.env;
  if (env.NODE_TEST_CONTEXT && env.ENABLE_RATE_LIMIT !== "1") return;
  const policy = (options.policies ?? ratePolicies(env))[policyName];
  let result;
  try {
    result = await checkRateLimit(request, policyName, options);
  } catch (error) {
    console.error(
      "rate limit check failed",
      policyName,
      error?.code ?? "",
      error instanceof Error ? error.message : "unknown"
    );
    if (policy?.failOpen) return;
    throw new HttpError(503, "RATE_LIMIT_UNAVAILABLE", "일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!result.allowed) {
    throw new HttpError(429, "TOO_MANY_REQUESTS", "요청이 많습니다. 잠시 후 다시 시도해 주세요.", {
      "Retry-After": String(result.retryAfter),
    });
  }
}
