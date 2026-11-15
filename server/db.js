import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Return PostgreSQL DATE values as 'YYYY-MM-DD' strings to avoid timezone shift.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

let pool;

/**
 * Returns today's calendar date in Asia/Seoul ('YYYY-MM-DD').
 */
export function kstToday(now = Date.now()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function readMs(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function pickMs(override, name, fallback) {
  return Number.isSafeInteger(override) && override >= 0 ? override : readMs(name, fallback);
}

/**
 * 트랜잭션 단위 서버 타임아웃(ms). 0이면 해당 타임아웃을 끈다.
 * 연결 시작 파라미터가 아니라 SET LOCAL로 적용하므로 PgBouncer/Neon 같은 트랜잭션 풀러에서도 동작한다.
 */
export function transactionTimeouts(overrides = {}) {
  return {
    statementMs: pickMs(overrides.statementMs, "DB_STATEMENT_TIMEOUT_MS", 10_000),
    lockMs: pickMs(overrides.lockMs, "DB_LOCK_TIMEOUT_MS", 5_000),
    idleInTransactionMs: pickMs(overrides.idleInTransactionMs, "DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", 15_000),
  };
}

function parseDatabaseTarget(connectionString) {
  const parsed = new URL(connectionString);
  return {
    mode: "pg",
    host: parsed.hostname || "unknown",
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\//, "") || "postgres",
  };
}

/**
 * Returns non-secret description of the configured database target.
 */
export function describeDatabaseTarget(activePool = pool) {
  if (activePool?.targetInfo) {
    return activePool.targetInfo;
  }
  if (activePool && activePool.isLocal === false) {
    if (process.env.DATABASE_URL) {
      return parseDatabaseTarget(process.env.DATABASE_URL);
    }
    return {
      mode: "pg",
      host: "custom",
      port: "5432",
      database: "postgres",
    };
  }
  if (!activePool && process.env.DATABASE_URL) {
    return parseDatabaseTarget(process.env.DATABASE_URL);
  }
  return {
    mode: "pglite",
    host: "local",
    port: null,
    database: localDataDir(),
  };
}

export function usesLocalDatabase() {
  return !process.env.DATABASE_URL;
}

function localDataDir() {
  if (process.env.MOA_LOCAL_DB) return process.env.MOA_LOCAL_DB;
  if (process.env.NODE_TEST_CONTEXT) return "memory://";
  return fileURLToPath(new URL("../data/pglite", import.meta.url));
}

/**
 * Creates a configured pg.Pool for multi-connection PostgreSQL server execution.
 */
export function createPgPool(connectionString, options = {}) {
  if (!connectionString) {
    throw new Error("PostgreSQL connectionString is required");
  }
  const requestedMax = Number(options.max);
  const max = Number.isFinite(requestedMax) ? Math.max(2, Math.trunc(requestedMax)) : 5;
  // 트랜잭션 밖 단일 쿼리의 클라이언트 측 상한. 0이면 끈다(마이그레이션 등 관리 작업).
  const queryTimeout = readMs("DB_QUERY_TIMEOUT_MS", 15_000);
  const pgPool = new pg.Pool({
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000,
    ...(queryTimeout > 0 ? { query_timeout: queryTimeout } : {}),
    ...options,
    connectionString,
    max,
  });
  pgPool.isLocal = false;
  pgPool.targetInfo = parseDatabaseTarget(connectionString);
  pgPool.on("error", (error) => console.warn("database pool error", error.message));
  return pgPool;
}

/**
 * Returns the shared PostgreSQL pool (pg.Pool in deployed/PG mode, PGlite adapter locally).
 */
export function getPool() {
  if (pool) return pool;
  if (process.env.DATABASE_URL) {
    pool = createPgPool(process.env.DATABASE_URL);
  } else if (process.env.VERCEL) {
    throw new Error("DATABASE_URL must be configured on Vercel");
  } else {
    pool = createPglitePool(localDataDir());
  }
  return pool;
}

/**
 * Allows tests to inject an isolated pool instance.
 */
export function setPool(customPool) {
  pool = customPool;
}

/**
 * Executes an async callback inside a single PostgreSQL transaction (BEGIN/COMMIT/ROLLBACK).
 * On a PostgreSQL server the transaction runs under statement/lock/idle timeouts so a stuck
 * lock wait cannot hold a pooled connection until the function itself times out.
 */
export async function withTransaction(fn, customPool = null, timeoutOverrides = {}) {
  const activePool = customPool || getPool();
  const client = await activePool.connect();
  try {
    if (activePool.isLocal) {
      // Embedded single-connection PGlite: no lock waits to bound.
      await client.query("BEGIN");
    } else {
      const t = transactionTimeouts(timeoutOverrides);
      await client.query(
        `BEGIN; SET LOCAL statement_timeout = ${t.statementMs}; SET LOCAL lock_timeout = ${t.lockMs}; ` +
          `SET LOCAL idle_in_transaction_session_timeout = ${t.idleInTransactionMs}`
      );
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Creates a pg.Pool-compatible adapter backed by embedded PGlite with btree_gist.
 */
export function createPglitePool(dataDir = "memory://") {
  let opening;
  let tail = Promise.resolve();
  let closed = false;

  const open = () => (opening ??= (async () => {
    const pkgName = "@electric-sql/pglite";
    const [{ PGlite }, { btree_gist }] = await Promise.all([
      import(pkgName),
      import(`${pkgName}/contrib/btree_gist`),
    ]);
    if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
    return PGlite.create(dataDir, {
      extensions: { btree_gist },
      parsers: { [DATE_OID]: (value) => value },
    });
  })());

  const lock = () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const ready = tail.then(() => release);
    tail = tail.then(() => held);
    return ready;
  };

  async function run(db, sql, params) {
    const command = /^\s*(\w+)/.exec(sql)?.[1]?.toUpperCase();
    if (params?.length) {
      const result = await db.query(sql, params);
      return { command, rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    }
    const results = await db.exec(sql);
    const last = results.at(-1) ?? { rows: [], affectedRows: 0 };
    return { command, rows: last.rows, rowCount: last.affectedRows ?? last.rows.length };
  }

  const adapter = {
    isLocal: true,
    async connect() {
      if (closed) throw new Error("Database pool is closed");
      const db = await open();
      const release = await lock();
      let released = false;
      return {
        query: (sql, params) => run(db, sql, params),
        release() {
          if (released) return;
          released = true;
          release();
        },
      };
    },
    async query(sql, params) {
      const client = await adapter.connect();
      try {
        return await client.query(sql, params);
      } finally {
        client.release();
      }
    },
    async end() {
      if (closed) return;
      closed = true;
      if (!opening) return;
      const db = await opening;
      await db.close();
    },
  };
  return adapter;
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}
