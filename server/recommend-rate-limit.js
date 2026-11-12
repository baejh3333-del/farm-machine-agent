import { createHash } from "node:crypto";
import { isIP } from "node:net";

const perClientLimit = 12;
const totalLimit = 120;
const windowSeconds = 60;
let localWindow;
let database;

async function postgresLimiter() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recommendation_rate_limit (
        id integer PRIMARY KEY CHECK (id = 1),
        window_id bigint NOT NULL,
        total integer NOT NULL,
        clients jsonb NOT NULL
      )
    `);
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

async function consumeSharedQuota(client) {
  database ??= postgresLimiter().catch((error) => {
    database = undefined;
    throw error;
  });
  const pool = await database;
  // The row lock serializes quotas across instances. New windows replace the old client counts.
  const { rowCount } = await pool.query(`
    INSERT INTO recommendation_rate_limit AS quota (id, window_id, total, clients)
    VALUES (1, floor(extract(epoch FROM statement_timestamp()) / $4::integer)::bigint, 1, jsonb_build_object($1::text, 1))
    ON CONFLICT (id) DO UPDATE SET
      window_id = EXCLUDED.window_id,
      total = CASE WHEN quota.window_id < EXCLUDED.window_id THEN 1 ELSE quota.total + 1 END,
      clients = CASE WHEN quota.window_id < EXCLUDED.window_id THEN EXCLUDED.clients
        ELSE jsonb_set(quota.clients, ARRAY[$1::text], to_jsonb(coalesce((quota.clients ->> $1)::integer, 0) + 1))
      END
    WHERE quota.window_id < EXCLUDED.window_id OR (
      quota.window_id = EXCLUDED.window_id AND quota.total < $2::integer
      AND coalesce((quota.clients ->> $1)::integer, 0) < $3::integer
    )
    RETURNING id
  `, [client, totalLimit, perClientLimit, windowSeconds]);
  return rowCount > 0;
}

export async function recommendationQuota(request) {
  if (!process.env.OPENAI_API_KEY) return "guide";

  const hosted = Boolean(process.env.VERCEL);
  const address = hosted ? request.headers?.["x-vercel-forwarded-for"] : request.socket?.remoteAddress;
  if (typeof address !== "string" || !isIP(address)) return "guide";
  const client = createHash("sha256").update(address).digest("hex");
  if (hosted || process.env.DATABASE_URL) {
    if (!process.env.DATABASE_URL) return "guide";
    return await consumeSharedQuota(client) ? "allow" : "limited";
  }

  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  if (localWindow?.id !== windowId) localWindow = { id: windowId, total: 0, clients: new Map() };
  const count = localWindow.clients.get(client) || 0;
  if (localWindow.total >= totalLimit || count >= perClientLimit) return "limited";
  localWindow.clients.set(client, count + 1);
  localWindow.total++;
  return "allow";
}
