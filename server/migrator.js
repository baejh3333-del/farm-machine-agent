import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getMigrations } from "better-auth/db/migration";
import { buildAccountAuthOptions } from "./account-auth.js";
import { describeDatabaseTarget, getPool, usesLocalDatabase, withTransaction } from "./db.js";
import { buildMockListings } from "./listing-seed.js";

export const VALID_ENVS = new Set(["development", "test", "preview", "production"]);
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
export const DEMO_OWNER_ID = "demo-owner";
export const DEMO_ACCOUNT_EMAIL = "10jo@users.moa-farm.example.com";
const MIGRATION_LOCK_KEY = 724_901;

let processLock = Promise.resolve();

function withProcessLock(fn) {
  const run = processLock.then(fn, fn);
  processLock = run.then(() => {}, () => {});
  return run;
}

export function resolveExpectedEnv(explicitEnv) {
  const env = (explicitEnv || process.env.APP_ENV || process.env.VERCEL_ENV || (process.env.NODE_TEST_CONTEXT ? "test" : "development")).trim();
  if (!VALID_ENVS.has(env)) {
    const error = new Error(`Invalid environment '${env}'. Expected one of: ${[...VALID_ENVS].join(", ")}`);
    error.code = "INVALID_ENVIRONMENT";
    throw error;
  }
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== env) {
    const error = new Error(`Target environment '${env}' does not match VERCEL_ENV '${process.env.VERCEL_ENV}'`);
    error.code = "ENVIRONMENT_MISMATCH";
    throw error;
  }
  return env;
}

export function migrationChecksum(sql) {
  const normalized = sql.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

async function withMigrationLock(pool, fn) {
  return withProcessLock(async () => {
    if (pool?.isLocal) {
      return fn();
    }
    const client = await pool.connect();
    let unlockHealthy = false;
    try {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      return await fn();
    } finally {
      try {
        const res = await client.query("SELECT pg_advisory_unlock($1) AS unlocked", [MIGRATION_LOCK_KEY]);
        unlockHealthy = res?.rows?.[0]?.unlocked === true;
      } catch {
        unlockHealthy = false;
      }
      client.release(!unlockHealthy);
    }
  });
}

export async function inspectDatabase({ pool = getPool() } = {}) {
  const target = describeDatabaseTarget(pool);
  const tablesRes = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  const tables = tablesRes.rows.map((r) => r.table_name);
  const hasAppMeta = tables.includes("app_meta");
  const hasMigrations = tables.includes("schema_migrations");

  const meta = {};
  if (hasAppMeta) {
    const res = await pool.query("SELECT key, value FROM app_meta ORDER BY key");
    for (const row of res.rows) meta[row.key] = row.value;
  }

  const appliedMigrations = [];
  if (hasMigrations) {
    const res = await pool.query("SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version");
    appliedMigrations.push(...res.rows);
  }

  const counts = {};
  for (const name of ["user", "session", "listings", "favorites", "owned_machines", "rental_requests", "conversations", "messages"]) {
    if (tables.includes(name)) {
      const res = await pool.query(`SELECT count(*)::int AS count FROM "${name}"`);
      counts[name] = res.rows[0].count;
    }
  }

  let userIdType = null;
  if (tables.includes("user")) {
    const colRes = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'user' AND column_name = 'id'`
    );
    userIdType = colRes.rows[0]?.data_type ?? null;
  }

  const extRes = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`);

  return {
    target,
    tables,
    environment: meta.environment ?? null,
    writesFrozen: meta.writes_frozen === "true",
    appliedMigrations,
    counts,
    userIdType,
    btreeGistInstalled: extRes.rows.length > 0,
  };
}

export async function initEnvironment({ env: explicitEnv, pool = getPool() } = {}) {
  const env = resolveExpectedEnv(explicitEnv);
  const target = describeDatabaseTarget(pool);

  return withMigrationLock(pool, async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const existing = await pool.query("SELECT value FROM app_meta WHERE key = 'environment'");
    if (existing.rows.length) {
      const actual = existing.rows[0].value;
      if (actual !== env) {
        const error = new Error(
          `Refusing init: database already marked as '${actual}', cannot re-mark as '${env}'`
        );
        error.code = "ENVIRONMENT_MISMATCH";
        throw error;
      }
      await pool.query(
        "INSERT INTO app_meta (key, value) VALUES ('writes_frozen', 'false') ON CONFLICT (key) DO NOTHING"
      );
      return { initialized: false, environment: env, target };
    }

    await pool.query("INSERT INTO app_meta (key, value) VALUES ('environment', $1)", [env]);
    await pool.query(
      "INSERT INTO app_meta (key, value) VALUES ('writes_frozen', 'false') ON CONFLICT (key) DO NOTHING"
    );
    return { initialized: true, environment: env, target };
  });
}

export async function assertEnvironmentMarker({ env: explicitEnv, pool = getPool() } = {}) {
  const env = resolveExpectedEnv(explicitEnv);
  const existsRes = await pool.query("SELECT to_regclass('app_meta')::text AS reg");
  if (!existsRes.rows[0]?.reg) {
    const error = new Error(
      `Database environment marker is missing (app_meta table not found). Run db:init -- --env ${env} first.`
    );
    error.code = "ENVIRONMENT_UNINITIALIZED";
    throw error;
  }
  const envRes = await pool.query("SELECT value FROM app_meta WHERE key = 'environment'");
  if (!envRes.rows.length) {
    const error = new Error(
      `Database environment marker is unset. Run db:init -- --env ${env} first.`
    );
    error.code = "ENVIRONMENT_UNINITIALIZED";
    throw error;
  }
  const actual = envRes.rows[0].value;
  if (actual !== env) {
    const error = new Error(
      `Environment mismatch: target DB is marked '${actual}', expected '${env}'.`
    );
    error.code = "ENVIRONMENT_MISMATCH";
    throw error;
  }
  return env;
}

export async function runMigrations({
  env: explicitEnv,
  pool = getPool(),
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  runBetterAuth = true,
} = {}) {
  const env = await assertEnvironmentMarker({ env: explicitEnv, pool });
  const target = describeDatabaseTarget(pool);

  return withMigrationLock(pool, async () => {
    if (runBetterAuth) {
      const options = buildAccountAuthOptions({
        database: pool,
        secret: process.env.BETTER_AUTH_SECRET || "migration-only-placeholder-secret-0123456789abcdef",
        baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
      });
      const { runMigrations: runAuthMigrations } = await getMigrations(options);
      await runAuthMigrations();
    }

    const userIdCol = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'user' AND column_name = 'id'`
    );
    if (!userIdCol.rows.length) {
      const error = new Error("Better Auth 'user' table does not exist. Run Better Auth migration first.");
      error.code = "AUTH_SCHEMA_MISSING";
      throw error;
    }
    if (userIdCol.rows[0].data_type !== "text") {
      const error = new Error(`Expected "user".id type 'text', found '${userIdCol.rows[0].data_type}'`);
      error.code = "UNSUPPORTED_USER_ID_TYPE";
      throw error;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    const applied = [];
    const skipped = [];

    for (const file of files) {
      const sql = readFileSync(`${migrationsDir}/${file}`, "utf8");
      const checksum = migrationChecksum(sql);
      const existing = await pool.query("SELECT checksum FROM schema_migrations WHERE version = $1", [file]);

      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum) {
          const error = new Error(
            `Checksum mismatch for applied migration '${file}'. Refusing to continue.`
          );
          error.code = "MIGRATION_CHECKSUM_MISMATCH";
          throw error;
        }
        skipped.push(file);
        continue;
      }

      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [file, checksum]
        );
      }, pool, { statementMs: 0, lockMs: 0, idleInTransactionMs: 0 });
      applied.push(file);
    }

    return { environment: env, target, applied, skipped };
  });
}

export async function seedDemoListings({
  env: explicitEnv,
  allowProduction = false,
  pool = getPool(),
} = {}) {
  const env = await assertEnvironmentMarker({ env: explicitEnv, pool });
  if (env === "production" && !allowProduction) {
    const error = new Error("Refusing to seed demo listings into production without --allow-production");
    error.code = "SEED_FORBIDDEN_IN_PRODUCTION";
    throw error;
  }

  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, '시연 농가', 'demo-owner@users.moa-farm.example.com', false, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [DEMO_OWNER_ID]
    );

    const demoUserRes = await client.query(
      `SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
      [DEMO_ACCOUNT_EMAIL]
    );
    const tenJoId = demoUserRes.rows[0]?.id ?? DEMO_OWNER_ID;

    const listings = buildMockListings();
    let inserted = 0;

    for (let index = 0; index < listings.length; index++) {
      const item = listings[index];
      const ownerId = item.owner ? tenJoId : DEMO_OWNER_ID;
      const res = await client.query(
        `INSERT INTO listings (
          id, owner_id, type, model_id, title, brand, machine_type,
          crop_ids, operations, area_min, area_max, price, region,
          condition, inspected_at, included, pickup, description, summary,
          photo_key, status, is_demo, sort_order
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19,
          NULL, $20, true, $21
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          item.id,
          ownerId,
          item.type,
          item.modelId ?? null,
          item.title,
          item.brand,
          item.machineType,
          item.cropIds,
          item.operations,
          item.areaMin,
          item.areaMax,
          item.price,
          item.region,
          item.condition,
          item.inspectedAt,
          item.included,
          item.pickup,
          item.description,
          item.summary,
          item.status || "open",
          index,
        ]
      );
      inserted += res.rowCount ?? 0;
    }

    return { environment: env, totalDemo: listings.length, inserted };
  }, pool);
}

export async function setWritesFrozen({ env: explicitEnv, frozen, pool = getPool() } = {}) {
  const env = await assertEnvironmentMarker({ env: explicitEnv, pool });
  const value = frozen ? "true" : "false";
  await pool.query(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES ('writes_frozen', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [value]
  );
  return { environment: env, writesFrozen: Boolean(frozen) };
}

export async function isWritesFrozen({ pool = getPool() } = {}) {
  try {
    const res = await pool.query("SELECT value FROM app_meta WHERE key = 'writes_frozen'");
    return res.rows[0]?.value === "true";
  } catch (error) {
    // undefined_table (42P01): app_meta not created yet -> not frozen
    if (error?.code === "42P01") return false;
    throw error;
  }
}

let localDevReadyPromise;

/**
 * Explicit bootstrap for local dev-server only (never called during Vercel runtime or build).
 */
export function ensureLocalDevReady() {
  if (process.env.VERCEL || !usesLocalDatabase()) return Promise.resolve();
  localDevReadyPromise ??= (async () => {
    const pool = getPool();
    const env = resolveExpectedEnv();
    await initEnvironment({ env, pool });
    await runMigrations({ env, pool });
    const countRes = await pool.query("SELECT count(*)::int AS count FROM listings");
    if (countRes.rows[0].count === 0 && process.env.MOA_SKIP_DEMO_SEED !== "1") {
      await seedDemoListings({ env, pool });
    }
  })().catch((error) => {
    localDevReadyPromise = undefined;
    throw error;
  });
  return localDevReadyPromise;
}
