import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { getConversationMessages, sendMessage } from "../server/chat.js";
import { createPgPool, createPglitePool, describeDatabaseTarget, kstToday } from "../server/db.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, inspectDatabase, runMigrations } from "../server/migrator.js";
import { approveRentalRequest, createRentalRequest } from "../server/rentals.js";
import { addOwnedMachine } from "../server/user-data.js";

function shiftDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Multi-client pool harness backed by PGlite SQL execution.
 * Delegates statements to backingPool.query so holding an outer lock client never deadlocks PGlite's mutex.
 */
function createRaceHarnessPool(backingPool, { onQuery, onTopLevelQuery } = {}) {
  let clientSeq = 0;
  return {
    isLocal: false,
    targetInfo: { mode: "pg", host: "multi-client-harness", port: "5432", database: "race_harness" },
    async query(sql, params) {
      if (onTopLevelQuery) {
        const override = await onTopLevelQuery({ sql, params });
        if (override !== undefined) return override;
      }
      return backingPool.query(sql, params);
    },
    async connect() {
      const clientId = ++clientSeq;
      return {
        clientId,
        async query(sql, params) {
          if (onQuery) {
            const override = await onQuery({ clientId, sql, params });
            if (override !== undefined) return override;
          }
          return backingPool.query(sql, params);
        },
        release() {},
      };
    },
    async end() {},
  };
}

// ---------------------------------------------------------------------------
// Suite A: Non-local pg.Pool execution paths & concurrent rollback recovery
// Always runnable without external database credentials.
// ---------------------------------------------------------------------------

test("[pg.Pool 실행 경로] createPgPool(max>=2) 및 describeDatabaseTarget(pool) 검증", async () => {
  const created = createPgPool("postgres://demo_user:supersecret@pg.example.internal:5433/moa_preview", {
    max: 1,
  });
  try {
    assert.equal(created.isLocal, false);
    assert.equal(created.options.max, 2, "multi-connection pool must enforce max >= 2");
    const desc = describeDatabaseTarget(created);
    assert.deepEqual(desc, {
      mode: "pg",
      host: "pg.example.internal",
      port: "5433",
      database: "moa_preview",
    });
    assert.equal(JSON.stringify(desc).includes("supersecret"), false);
  } finally {
    await created.end();
  }
});

test("[pg.Pool 실행 경로] withMigrationLock: non-local pool에서 pg_advisory_lock/unlock 및 실패 시 연결 폐기(release(true))", async () => {
  const backing = createPglitePool("memory://");
  const prevDbUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  const events = [];
  let activeCrit = 0;
  let maxOverlap = 0;
  let unlockMode = "ok";
  let clientSeq = 0;
  const releasedFlags = [];

  const nonLocalPool = {
    isLocal: false,
    targetInfo: { mode: "pg", host: "advisory-harness", port: "5432", database: "test" },
    async query(sql, params) {
      return backing.query(sql, params);
    },
    async connect() {
      const id = ++clientSeq;
      return {
        async query(sql, params) {
          if (sql.includes("pg_advisory_lock(")) {
            events.push(`c${id}:lock:${params[0]}`);
            activeCrit += 1;
            maxOverlap = Math.max(maxOverlap, activeCrit);
            return { rows: [{ pg_advisory_lock: "" }], rowCount: 1 };
          }
          if (sql.includes("pg_advisory_unlock(")) {
            events.push(`c${id}:unlock:${params[0]}`);
            activeCrit -= 1;
            if (unlockMode === "false") {
              return { rows: [{ unlocked: false }], rowCount: 1 };
            }
            if (unlockMode === "throw") {
              throw new Error("simulated unlock transport error");
            }
            return { rows: [{ unlocked: true }], rowCount: 1 };
          }
          return backing.query(sql, params);
        },
        release(destroy = false) {
          releasedFlags.push({ clientId: id, destroy });
        },
      };
    },
  };

  try {
    // 1) Even with DATABASE_URL unset, non-local pool executes pg_advisory_lock & clean release(false)
    const [r1, r2] = await Promise.all([
      initEnvironment({ env: "test", pool: nonLocalPool }),
      initEnvironment({ env: "test", pool: nonLocalPool }),
    ]);
    assert.equal(r1.target.mode, "pg");
    assert.equal(r2.target.mode, "pg");
    assert.equal(maxOverlap, 1, "concurrent migration callers must not overlap inside lock");
    assert.ok(events.includes("c1:lock:724901"));
    assert.ok(events.includes("c1:unlock:724901"));
    assert.equal(releasedFlags[0].destroy, false);

    // 2) Unlock returning false discards client via release(true)
    unlockMode = "false";
    await runMigrations({ env: "test", pool: nonLocalPool });
    assert.equal(releasedFlags.at(-1).destroy, true, "client must be destroyed when pg_advisory_unlock returns false");

    // 3) Unlock throwing discards client via release(true) without masking work or crashing
    unlockMode = "throw";
    await assert.doesNotReject(() => initEnvironment({ env: "test", pool: nonLocalPool }));
    assert.equal(releasedFlags.at(-1).destroy, true, "client must be destroyed when pg_advisory_unlock throws");
  } finally {
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDbUrl;
    await backing.end();
  }
});

test("[pg.Pool 실행 경로] READ COMMITTED 23505 롤백 복구(4개 UUID 엔드포인트), parent lock 순서, post-lock chat 재조회 및 23P01 처리", async () => {
  const backing = createPglitePool("memory://");
  const today = kstToday();
  const userA = { id: "pool-user-a", name: "사용자A" };
  const userB = { id: "pool-user-b", name: "사용자B" };

  try {
    await initEnvironment({ env: "test", pool: backing });
    await runMigrations({ env: "test", pool: backing });
    await backing.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, 'a@example.com', false, now(), now()),
              ($3, $4, 'b@example.com', false, now(), now())`,
      [userA.id, userA.name, userB.id, userB.name]
    );

    // 1) addOwnedMachine locks parent "user" row FIRST and recovers cleanly from 23505 on PK race
    const queryOrder = [];
    const ownedPool = createRaceHarnessPool(backing, {
      onQuery({ clientId, sql }) {
        if (clientId === 1) queryOrder.push(sql.trim());
        // Simulate Client 2 seeing 0 rows on owned_machines WHERE id = $1 BEFORE Client 1 inserts
        if (clientId === 2 && sql.includes("FROM owned_machines") && sql.includes("WHERE id = $1")) {
          return { rows: [], rowCount: 0 };
        }
      },
    });
    const ownedId = randomUUID();
    const o1 = await addOwnedMachine(userB.id, { id: ownedId, modelId: "asia-amc900", name: "경합관리기" }, { pool: ownedPool });
    assert.equal(o1.idempotent, false);
    assert.ok(
      queryOrder.findIndex((s) => s.includes('FROM "user" WHERE id = $1 FOR UPDATE')) !== -1,
      "addOwnedMachine must lock parent user row"
    );
    assert.ok(
      queryOrder.findIndex((s) => s.includes('FROM "user" WHERE id = $1 FOR UPDATE')) <
        queryOrder.findIndex((s) => s.includes("FROM owned_machines WHERE user_id = $1 FOR UPDATE")),
      "parent user lock must precede owned_machines user query"
    );
    // Client 2 bypasses pre-check -> INSERT hits real PG 23505 -> rolls back -> re-queries winner
    const o2 = await addOwnedMachine(userB.id, { id: ownedId, modelId: "asia-amc900", name: "경합관리기" }, { pool: ownedPool });
    assert.equal(o2.idempotent, true);
    assert.equal(o2.userData.ownedMachines.length, 1);

    await assert.rejects(
      () => addOwnedMachine(userB.id, { id: ownedId, modelId: "asia-amc900", name: "다른이름" }, { pool: ownedPool }),
      (err) => err.status === 409 && err.code === "IDEMPOTENCY_CONFLICT"
    );

    // 2) createListing: Client 2 misses pre-check & FOR UPDATE lock -> hits real 23505 on INSERT -> returns 200 idempotent
    const listId = randomUUID();
    const listPayload = {
      id: listId,
      type: "rent",
      modelId: "asia-amc900",
      title: "23505 복구 테스트 매물",
      region: "영양읍",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 50000,
      areaMin: 200,
      areaMax: 1000,
      condition: "good",
      inspectedAt: today,
    };
    const l1 = await createListing(userA, listPayload, { pool: backing });
    assert.equal(l1.status, 201);

    let listRaceDone = false;
    const preCheckPool = createRaceHarnessPool(backing, {
      onTopLevelQuery({ sql }) {
        if (!listRaceDone && sql.includes("SELECT * FROM listings WHERE id = $1 LIMIT 1")) {
          return { rows: [], rowCount: 0 };
        }
      },
      onQuery({ sql }) {
        if (!listRaceDone && sql.includes("FROM listings WHERE id = $1 FOR UPDATE")) {
          listRaceDone = true;
          return { rows: [], rowCount: 0 };
        }
      },
    });
    const l2 = await createListing(userA, listPayload, { pool: preCheckPool });
    assert.equal(l2.status, 200);
    assert.equal(l2.idempotent, true);

    // 3) createRentalRequest: Client 2 sees 0 rows on initial FOR UPDATE -> INSERT hits real 23505 -> 200 idempotent
    const reqId = randomUUID();
    const rStart = shiftDate(today, 3);
    const rEnd = shiftDate(today, 5);
    const rq1 = await createRentalRequest(userB, { id: reqId, listingId: listId, start: rStart, end: rEnd, note: "race" }, { pool: backing });
    assert.equal(rq1.status, 201);

    const reqRacePool = createRaceHarnessPool(backing, {
      onQuery({ sql }) {
        if (sql.includes("SELECT * FROM rental_requests WHERE id = $1 FOR UPDATE")) {
          return { rows: [], rowCount: 0 };
        }
      },
    });
    const rq2 = await createRentalRequest(userB, { id: reqId, listingId: listId, start: rStart, end: rEnd, note: "race" }, { pool: reqRacePool });
    assert.equal(rq2.status, 200);
    assert.equal(rq2.idempotent, true);

    // 4) sendMessage: post-lock re-check skips last_seq increment, AND 23505 catch still recovers cleanly
    const msgId1 = randomUUID();
    const m1 = await sendMessage(userB, { id: msgId1, listingId: listId, body: "첫 메시지" }, { pool: backing });
    const convId = m1.conversation.id;
    let bumpedSeqDuringPostLock = false;
    const chatPostLockPool = createRaceHarnessPool(backing, {
      onQuery({ sql }) {
        if (sql.includes("FROM messages m") && sql.includes("FOR UPDATE OF m")) {
          // Only simulate pre-lock miss on first call; return real row on post-lock recheck
          if (!bumpedSeqDuringPostLock) {
            bumpedSeqDuringPostLock = true;
            return { rows: [], rowCount: 0 };
          }
        }
        if (sql.includes("UPDATE conversations") && sql.includes("last_seq = last_seq + 1")) {
          throw new Error("should NOT bump last_seq when post-lock check finds messageId");
        }
      },
    });
    const m1PostLockRetry = await sendMessage(userB, { id: msgId1, conversationId: convId, body: "첫 메시지" }, { pool: chatPostLockPool });
    assert.equal(m1PostLockRetry.status, 200);
    assert.equal(m1PostLockRetry.idempotent, true);
    assert.equal(m1PostLockRetry.conversation.lastSeq, 1, "last_seq must stay 1 without wasted increment");

    // Also test 23505 INSERT fallback when both pre-lock and post-lock checks see 0 rows
    const chat23505Pool = createRaceHarnessPool(backing, {
      onQuery({ sql }) {
        if (sql.includes("FROM messages m") && sql.includes("FOR UPDATE OF m")) {
          return { rows: [], rowCount: 0 };
        }
      },
    });
    const m1Fallback = await sendMessage(userB, { id: msgId1, conversationId: convId, body: "첫 메시지" }, { pool: chat23505Pool });
    assert.equal(m1Fallback.status, 200);
    assert.equal(m1Fallback.idempotent, true);

    // 5) approveRentalRequest catches PostgreSQL 23P01 GiST exclusion error even if overlap check is bypassed
    const reqOverlapId = randomUUID();
    await createRentalRequest(userB, { id: reqOverlapId, listingId: listId, start: shiftDate(today, 4), end: shiftDate(today, 6) }, { pool: backing });
    await approveRentalRequest(userA, reqId, { pool: backing });

    const gistBypassPool = createRaceHarnessPool(backing, {
      onQuery({ sql }) {
        if (sql.includes("SELECT 1 FROM rental_requests") && sql.includes("status = 'approved'")) {
          return { rows: [], rowCount: 0 };
        }
      },
    });
    await assert.rejects(
      () => approveRentalRequest(userA, reqOverlapId, { pool: gistBypassPool }),
      (err) => err.status === 409 && err.code === "DATE_OVERLAP"
    );
  } finally {
    await backing.end();
  }
});

// ---------------------------------------------------------------------------
// Suite B: Live Multi-Connection PostgreSQL Server Tests (TEST_DATABASE_URL)
// Runs ONLY when TEST_DATABASE_URL points to an isolated PostgreSQL database.
// Explicitly skipped when TEST_DATABASE_URL is not configured.
// ---------------------------------------------------------------------------

const TEST_DB_URL = process.env.TEST_DATABASE_URL?.trim() || "";
const skipReason = !TEST_DB_URL
  ? "TEST_DATABASE_URL 미설정 — 다중 연결 실제 PostgreSQL 서버 테스트 미실행 (PGlite 단일 연결로 대체하지 않음)"
  : false;

let liveRawPool = null;
let livePool = null;
let liveSchema = null;

function createSchemaScopedPool(rawPool, schemaName) {
  return {
    isLocal: false,
    targetInfo: rawPool.targetInfo,
    async connect() {
      const client = await rawPool.connect();
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
      await rawPool.end();
    },
  };
}

if (TEST_DB_URL) {
  before(async () => {
    if (
      process.env.APP_ENV === "production" ||
      process.env.VERCEL_ENV === "production" ||
      (process.env.DATABASE_URL && process.env.DATABASE_URL === TEST_DB_URL)
    ) {
      throw new Error("SAFETY_REFUSAL: TEST_DATABASE_URL must be strictly isolated from production DATABASE_URL");
    }

    liveRawPool = createPgPool(TEST_DB_URL, { max: 6 });

    // Refuse if public.app_meta already identifies this server/database as production
    const regRes = await liveRawPool.query(`SELECT to_regclass('public.app_meta')::text AS reg`);
    if (regRes.rows[0]?.reg) {
      const envRes = await liveRawPool.query(`SELECT value FROM public.app_meta WHERE key = 'environment'`);
      if (envRes.rows[0]?.value === "production") {
        await liveRawPool.end();
        liveRawPool = null;
        throw new Error("SAFETY_REFUSAL: target database public.app_meta is marked 'production'");
      }
    }

    liveSchema = `test_moa_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await liveRawPool.query(`CREATE SCHEMA "${liveSchema}"`);
    await liveRawPool.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    livePool = createSchemaScopedPool(liveRawPool, liveSchema);

    await initEnvironment({ env: "test", pool: livePool });
    await runMigrations({ env: "test", pool: livePool });
  });

  after(async () => {
    if (liveRawPool && liveSchema) {
      await liveRawPool.query(`DROP SCHEMA IF EXISTS "${liveSchema}" CASCADE`).catch(() => {});
    }
    if (livePool) {
      await livePool.end().catch(() => {});
    }
  });
}

test("[실제 PG 서버 pg.Pool] B1. 다중 연결 pg_advisory_lock 경합 직렬화 및 inspectDatabase 확인", { skip: skipReason }, async () => {
  const c1 = await livePool.connect();
  const c2 = await livePool.connect();
  try {
    const [p1, p2] = await Promise.all([
      c1.query(`SELECT pg_backend_pid() AS pid`),
      c2.query(`SELECT pg_backend_pid() AS pid`),
    ]);
    assert.notEqual(p1.rows[0].pid, p2.rows[0].pid, "pg.Pool must use distinct server connections");

    await c1.query(`SELECT pg_advisory_lock(724901)`);
    const tryRes = await c2.query(`SELECT pg_try_advisory_lock(724901) AS acquired`);
    assert.equal(tryRes.rows[0].acquired, false, "second backend must not acquire held session advisory lock");
    const unlockRes = await c1.query(`SELECT pg_advisory_unlock(724901) AS unlocked`);
    assert.equal(unlockRes.rows[0].unlocked, true);

    const retryRes = await c2.query(`SELECT pg_try_advisory_lock(724901) AS acquired`);
    assert.equal(retryRes.rows[0].acquired, true);
    await c2.query(`SELECT pg_advisory_unlock(724901)`);

    const info = await inspectDatabase({ pool: livePool });
    assert.equal(info.target.mode, "pg");
    assert.equal(info.environment, "test");
    assert.equal(info.btreeGistInstalled, true);
    assert.equal(info.userIdType, "text");
  } finally {
    c1.release();
    c2.release();
  }
});

test("[실제 PG 서버 pg.Pool] B2. 실제 동시 트랜잭션 겹치는 대여 승인 경합 및 직접 SQL 23P01 배타 제약", { skip: skipReason }, async () => {
  const today = kstToday();
  const userA = { id: `pg-a-${randomUUID()}`, name: "서버A" };
  const userB = { id: `pg-b-${randomUUID()}`, name: "서버B" };
  const userC = { id: `pg-c-${randomUUID()}`, name: "서버C" };
  await livePool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, false, now(), now()),
            ($4, $5, $6, false, now(), now()),
            ($7, $8, $9, false, now(), now())`,
    [
      userA.id, userA.name, `${userA.id}@example.com`,
      userB.id, userB.name, `${userB.id}@example.com`,
      userC.id, userC.name, `${userC.id}@example.com`,
    ]
  );

  const listingId = randomUUID();
  await createListing(userA, {
    id: listingId,
    type: "rent",
    modelId: "asia-amc900",
    title: "다중연결 대여 경합 매물",
    region: "영양읍",
    cropIds: ["pepper"],
    operations: ["till"],
    price: 55000,
    areaMin: 200,
    areaMax: 1000,
    condition: "good",
    inspectedAt: today,
  }, { pool: livePool });

  const r1 = randomUUID();
  const r2 = randomUUID();
  await createRentalRequest(userB, { id: r1, listingId, start: shiftDate(today, 2), end: shiftDate(today, 4) }, { pool: livePool });
  await createRentalRequest(userC, { id: r2, listingId, start: shiftDate(today, 3), end: shiftDate(today, 5) }, { pool: livePool });

  const settled = await Promise.allSettled([
    approveRentalRequest(userA, r1, { pool: livePool }),
    approveRentalRequest(userA, r2, { pool: livePool }),
  ]);
  const wins = settled.filter((s) => s.status === "fulfilled");
  const losses = settled.filter((s) => s.status === "rejected");
  assert.equal(wins.length, 1);
  assert.equal(losses.length, 1);
  assert.equal(losses[0].reason.status, 409);
  assert.equal(losses[0].reason.code, "DATE_OVERLAP");

  // Direct multi-connection GiST exclusion test across two open transactions
  const r3 = randomUUID();
  const r4 = randomUUID();
  await createRentalRequest(userB, { id: r3, listingId, start: shiftDate(today, 10), end: shiftDate(today, 12) }, { pool: livePool });
  await createRentalRequest(userC, { id: r4, listingId, start: shiftDate(today, 11), end: shiftDate(today, 13) }, { pool: livePool });

  const tx1 = await livePool.connect();
  const tx2 = await livePool.connect();
  try {
    await tx1.query("BEGIN");
    await tx1.query(`UPDATE rental_requests SET status = 'approved' WHERE id = $1`, [r3]);
    await tx2.query("BEGIN");
    // Under READ COMMITTED, tx2 blocks on GiST index until tx1 commits, then fails 23P01
    const tx2Promise = tx2.query(`UPDATE rental_requests SET status = 'approved' WHERE id = $1`, [r4])
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, code: err.code }));
    await new Promise((r) => setTimeout(r, 80));
    await tx1.query("COMMIT");
    const tx2Outcome = await tx2Promise;
    assert.equal(tx2Outcome.ok, false);
    assert.equal(tx2Outcome.code, "23P01");
    await tx2.query("ROLLBACK").catch(() => {});
  } finally {
    tx1.release();
    tx2.release();
  }
});

test("[실제 PG 서버 pg.Pool] B3. 지연된 채팅 쓰기 중 잠금 없는 after_seq 조회 비차단 및 커밋 후 누락 없는 조회", { skip: skipReason }, async () => {
  const today = kstToday();
  const owner = { id: `pg-chat-o-${randomUUID()}`, name: "판매자" };
  const buyer = { id: `pg-chat-b-${randomUUID()}`, name: "구매자" };
  await livePool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, false, now(), now()),
            ($4, $5, $6, false, now(), now())`,
    [owner.id, owner.name, `${owner.id}@example.com`, buyer.id, buyer.name, `${buyer.id}@example.com`]
  );
  const listingId = randomUUID();
  await createListing(owner, {
    id: listingId,
    type: "sale",
    brand: "대동",
    machineType: "tractor",
    title: "지연 채팅 테스트 매물",
    region: "청기면",
    cropIds: ["rice"],
    operations: ["level"],
    price: 9000000,
    areaMin: 500,
    areaMax: 2000,
    condition: "good",
    inspectedAt: today,
  }, { pool: livePool });

  const first = await sendMessage(buyer, { id: randomUUID(), listingId, body: "msg-1" }, { pool: livePool });
  const convId = first.conversation.id;

  // Writer 1 acquires FOR UPDATE lock on conversations and delays 150ms before committing seq=2
  const delayedClient = await livePool.connect();
  let readerResultDuringLock;
  let queuedWritePromise;
  try {
    await delayedClient.query("BEGIN");
    await delayedClient.query(`SELECT * FROM conversations WHERE id = $1 FOR UPDATE`, [convId]);
    const seqRes = await delayedClient.query(
      `UPDATE conversations SET last_seq = last_seq + 1, updated_at = now() WHERE id = $1 RETURNING last_seq`,
      [convId]
    );
    const delayedSeq = Number(seqRes.rows[0].last_seq);
    assert.equal(delayedSeq, 2);
    await delayedClient.query(
      `INSERT INTO messages (id, conversation_id, sender_id, seq, body) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), convId, owner.id, delayedSeq, "delayed-seq-2"]
    );

    // Lock-free SELECT poll must NOT block behind delayed writer's FOR UPDATE lock
    queuedWritePromise = sendMessage(buyer, { id: randomUUID(), conversationId: convId, body: "queued-seq-3" }, { pool: livePool });
    readerResultDuringLock = await Promise.race([
      getConversationMessages(buyer.id, { conversationId: convId, afterSeq: 1, pool: livePool }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("lock-free reader blocked by delayed writer")), 100)),
    ]);
    assert.deepEqual(readerResultDuringLock.messages, []);

    await new Promise((r) => setTimeout(r, 80));
    await delayedClient.query("COMMIT");
  } finally {
    delayedClient.release();
  }

  const queuedResult = await queuedWritePromise;
  assert.equal(queuedResult.message.seq, 3);

  const afterCommit = await getConversationMessages(buyer.id, { conversationId: convId, afterSeq: 1, pool: livePool });
  assert.deepEqual(afterCommit.messages.map((m) => m.seq), [2, 3]);
});

test("[실제 PG 서버 pg.Pool] B4. 0행 시작 동시 보유 기계 추가 및 동일 UUID 재시도 경합", { skip: skipReason }, async () => {
  const userId = `pg-owned-${randomUUID()}`;
  await livePool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, '차고사용자', $2, false, now(), now())`,
    [userId, `${userId}@example.com`]
  );

  // Two distinct machines submitted concurrently starting from 0 rows
  const [mA, mB] = await Promise.all([
    addOwnedMachine(userId, { id: randomUUID(), modelId: "asia-amc900", name: "동시관리기A" }, { pool: livePool }),
    addOwnedMachine(userId, { id: randomUUID(), modelId: "daedong-dk450", name: "동시트랙터B" }, { pool: livePool }),
  ]);
  assert.equal(mA.idempotent, false);
  assert.equal(mB.idempotent, false);

  // Concurrent same-UUID retry starting simultaneously across connections
  const retryId = randomUUID();
  const retryPair = await Promise.all([
    addOwnedMachine(userId, { id: retryId, modelId: "asia-amc900", name: "중복재시도" }, { pool: livePool }),
    addOwnedMachine(userId, { id: retryId, modelId: "asia-amc900", name: "중복재시도" }, { pool: livePool }),
  ]);
  assert.equal(retryPair.filter((r) => !r.idempotent).length, 1);
  assert.equal(retryPair.filter((r) => r.idempotent).length, 1);
  assert.equal(retryPair[1].userData.ownedMachines.length, 3);
  assert.equal(retryPair[1].userData.ownedMachines.filter((m) => m.isSelected).length, 1);
});
