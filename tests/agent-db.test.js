import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { setupAgentDb } from "./helpers/agent-db.js";
import { inspectDatabase } from "../server/migrator.js";

let pool;
let cleanup;

before(async () => {
  ({ pool, cleanup } = await setupAgentDb());
});

after(async () => {
  await cleanup();
});

test("DB 점검은 미검증 제약과 마이그레이션 불일치를 읽기만 한다", async () => {
  const initial = await inspectDatabase({ pool });
  assert.deepEqual(initial.pendingMigrations, []);
  assert.deepEqual(initial.checksumMismatches, []);
  assert.ok(initial.unvalidatedConstraints.some((row) => row.constraint_name === "rental_requests_days_range_check"));
  await pool.query("BEGIN");
  try {
    await pool.query("UPDATE schema_migrations SET checksum = 'bad' WHERE version = '0001_initial_schema.sql'");
    await pool.query("DELETE FROM schema_migrations WHERE version = '0003_agent_core.sql'");
    const info = await inspectDatabase({ pool });
    assert.deepEqual(info.pendingMigrations, ["0003_agent_core.sql"]);
    assert.deepEqual(info.checksumMismatches, ["0001_initial_schema.sql"]);
    assert.deepEqual((await inspectDatabase({ pool })).pendingMigrations, info.pendingMigrations);
  } finally {
    await pool.query("ROLLBACK");
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
