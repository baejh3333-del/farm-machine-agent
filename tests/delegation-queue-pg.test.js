// 실제 PostgreSQL 다중 연결에서 delegation_jobs 큐의 동시성(중복 enqueue, SKIP LOCKED 임대, 임대 토큰)을 검증한다.
// TEST_DATABASE_URL이 격리된 DB를 가리킬 때만 실행되며, 미설정이면 명시적으로 건너뛴다(PGlite로 대체하지 않음).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createPgPool } from "../server/db.js";
import { enqueueDelegatedReply, processDelegationJobs } from "../server/delegation-queue.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL?.trim() || "";
const skipReason = !TEST_DB_URL
  ? "TEST_DATABASE_URL 미설정 — 실제 PostgreSQL 큐 동시성 테스트 미실행 (PGlite 단일 연결로 대체하지 않음)"
  : false;

let rawPool = null;
let pool = null;
let schema = null;

function schemaScopedPool(raw, schemaName) {
  return {
    isLocal: false,
    targetInfo: raw.targetInfo,
    async connect() {
      const client = await raw.connect();
      try {
        await client.query(`SET search_path TO "${schemaName}", public`);
        return client;
      } catch (err) {
        client.release(true);
        throw err;
      }
    },
    async query(sql, params) {
      const client = await this.connect();
      try {
        return await client.query(sql, params);
      } finally {
        client.release();
      }
    },
    async end() {
      await raw.end();
    },
  };
}

async function makeConversation() {
  const ownerId = `dqpg_o_${randomUUID().slice(0, 8)}`;
  const buyerId = `dqpg_b_${randomUUID().slice(0, 8)}`;
  for (const id of [ownerId, buyerId]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, false, now(), now())`,
      [id, `${id}@example.invalid`]
    );
  }
  const { listing } = await createListing(
    { id: ownerId, name: ownerId },
    {
      id: randomUUID(),
      title: "PG 큐 테스트 관리기",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 100000,
      region: "영양읍",
      condition: "good",
      description: "x",
    },
    { pool }
  );
  const conv = await pool.query(
    `INSERT INTO conversations (listing_id, buyer_id, last_seq, owner_ai_mode) VALUES ($1, $2, 1, 'autonomous') RETURNING id`,
    [listing.id, buyerId]
  );
  return String(conv.rows[0].id);
}

if (TEST_DB_URL) {
  before(async () => {
    if (
      process.env.APP_ENV === "production" ||
      process.env.VERCEL_ENV === "production" ||
      (process.env.DATABASE_URL && process.env.DATABASE_URL === TEST_DB_URL)
    ) {
      throw new Error("SAFETY_REFUSAL: TEST_DATABASE_URL must be isolated from production DATABASE_URL");
    }
    rawPool = createPgPool(TEST_DB_URL, { max: 8 });
    const reg = await rawPool.query(`SELECT to_regclass('public.app_meta')::text AS reg`);
    if (reg.rows[0]?.reg) {
      const env = await rawPool.query(`SELECT value FROM public.app_meta WHERE key = 'environment'`);
      if (env.rows[0]?.value === "production") {
        await rawPool.end();
        rawPool = null;
        throw new Error("SAFETY_REFUSAL: target database is marked production");
      }
    }
    schema = `test_dq_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await rawPool.query(`CREATE SCHEMA "${schema}"`);
    await rawPool.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    pool = schemaScopedPool(rawPool, schema);
    await initEnvironment({ env: "test", pool });
    await runMigrations({ env: "test", pool });
  });

  after(async () => {
    if (rawPool && schema) await rawPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    if (pool) await pool.end().catch(() => {});
  });
}

test("[실제 PG] DQ1. 서로 다른 연결 8개가 같은 이벤트를 동시에 enqueue해도 작업은 1건", { skip: skipReason }, async () => {
  const conversationId = await makeConversation();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => enqueueDelegatedReply({ conversationId, triggerSeq: 1, targetRole: "owner", pool }))
  );
  assert.equal(results.filter((r) => r.created).length, 1);
  const cnt = await pool.query(`SELECT count(*)::int AS c FROM delegation_jobs WHERE conversation_id = $1`, [conversationId]);
  assert.equal(cnt.rows[0].c, 1);
});

test("[실제 PG] DQ2. 동시 스윕 3개(각 동시성 3)가 작업 12건을 정확히 1회씩만 실행", { skip: skipReason }, async () => {
  const ids = [];
  for (let i = 0; i < 12; i += 1) {
    const conversationId = await makeConversation();
    const { jobId } = await enqueueDelegatedReply({ conversationId, triggerSeq: 1, targetRole: "owner", pool });
    ids.push(jobId);
  }
  const runs = new Map();
  const runner = async (job) => {
    runs.set(job.id, (runs.get(job.id) || 0) + 1);
    await new Promise((r) => setTimeout(r, 30));
    return { action: "replied" };
  };
  const stats = await Promise.all(
    Array.from({ length: 3 }, () => processDelegationJobs({ pool, runner, limit: 20, concurrency: 3 }))
  );
  for (const id of ids) assert.equal(runs.get(id), 1, `job ${id} must run exactly once`);
  assert.equal(stats.reduce((n, s) => n + s.succeeded, 0) >= ids.length, true);
  const left = await pool.query(
    `SELECT count(*)::int AS c FROM delegation_jobs WHERE id = ANY($1::uuid[]) AND status <> 'succeeded'`,
    [ids]
  );
  assert.equal(left.rows[0].c, 0);
});

test("[실제 PG] DQ3. 임대가 만료된 작업을 다른 연결이 회수하면 원래 처리기의 늦은 결과는 버려진다", { skip: skipReason }, async () => {
  const conversationId = await makeConversation();
  const { jobId } = await enqueueDelegatedReply({ conversationId, triggerSeq: 1, targetRole: "owner", pool });
  let inner = null;
  const slow = async () => {
    await pool.query(`UPDATE delegation_jobs SET lease_until = now() - interval '1 second' WHERE id = $1`, [jobId]);
    inner = await processDelegationJobs({ pool, conversationId, runner: async () => ({ action: "replied" }) });
    return { skipped: true, reason: "LLM_FAILED" };
  };
  const outer = await processDelegationJobs({ pool, conversationId, runner: slow });
  assert.equal(inner.succeeded, 1);
  assert.equal(outer.leaseLost, 1);
  const row = await pool.query(`SELECT status, attempts FROM delegation_jobs WHERE id = $1`, [jobId]);
  assert.equal(row.rows[0].status, "succeeded");
  assert.equal(row.rows[0].attempts, 2);
});
