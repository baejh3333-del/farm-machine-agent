import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createPglitePool, setPool } from "../server/db.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";

let tempDir;
let pool;
let prevEnv = {};

async function insertUser(p, id, name) {
  await p.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, false, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [id, name, `${id}@users.moa-farm.example.com`]
  );
}

before(async () => {
  prevEnv = {
    APP_ENV: process.env.APP_ENV,
    OBJECT_STORAGE_DIR: process.env.OBJECT_STORAGE_DIR,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  delete process.env.DATABASE_URL;
  process.env.APP_ENV = "test";
  tempDir = await mkdtemp(join(tmpdir(), "moa-agent-db-"));
  process.env.OBJECT_STORAGE_DIR = join(tempDir, "objects");

  pool = createPglitePool("memory://");
  setPool(pool);
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });

  await insertUser(pool, "u-a", "농가 A");
  await insertUser(pool, "u-b", "농가 B");
  await insertUser(pool, "u-c", "농가 C");
});

after(async () => {
  await pool.end();
  setPool(undefined);
  await rm(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("0003: 테이블·컬럼·제약이 존재한다", async () => {
  const t = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`);
  const names = new Set(t.rows.map((r) => r.table_name));
  for (const n of ["agent_sessions", "agent_messages", "agent_actions",
                   "purchase_orders", "agent_tool_calls", "farm_profiles"]) assert.ok(names.has(n), n);

  const s = randomUUID();
  await pool.query(`INSERT INTO agent_sessions (id, user_id) VALUES ($1, 'u-a')`, [s]);
  const row = (await pool.query(`SELECT intent, stage, slots, last_seq FROM agent_sessions WHERE id = $1`, [s])).rows[0];
  assert.deepEqual([row.intent, row.stage, row.slots, row.last_seq], [null, "collecting", {}, 0]);

  // 세션당 열린 초안은 하나
  const open = (st) => pool.query(
    `INSERT INTO agent_actions (id, session_id, user_id, kind, payload, status, result_id, expires_at)
     VALUES ($1, $2, 'u-a', 'purchase_order', '{}', $3, $4, now() + interval '30 minutes')`,
    [randomUUID(), s, st, randomUUID()]);
  await open("collecting");
  await assert.rejects(() => open("awaiting_confirm"), (e) => e.code === "23505");

  // 잘못된 상태값·역할 거부
  await assert.rejects(() => pool.query(`UPDATE agent_sessions SET intent = 'gift' WHERE id = $1`, [s]), (e) => e.code === "23514");
  await assert.rejects(() => pool.query(
    `INSERT INTO agent_messages (id, session_id, seq, role, body) VALUES ($1, $2, 1, 'system', 'x')`,
    [randomUUID(), s]), (e) => e.code === "23514");

  const cols = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE (table_name = 'rental_requests' AND column_name = 'agent_session_id')
        OR (table_name = 'listings' AND column_name = 'source')`);
  assert.equal(cols.rows.length, 2);
});
