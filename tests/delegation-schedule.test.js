// P0 배포 준비: Hobby 호환 크론 + 트래픽 기반 대리 응대 스윕 + 마이그레이션 준비 상태 점검.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { resetAuthCache } from "../server/account-auth.js";
import { createPglitePool, setPool } from "../server/db.js";
import {
  acquireTick,
  CONV_INTERVAL_MS,
  GLOBAL_INTERVAL_MS,
  isDelegationKickEnabled,
  kickDelegationQueue,
  resetDelegationKickMemo,
  runDelegationKick,
} from "../server/delegation-kick.js";
import { enqueueDelegatedReply, processDelegationJobs } from "../server/delegation-queue.js";
import { classifyError } from "../server/http.js";
import {
  DEFAULT_MIGRATIONS_DIR,
  initEnvironment,
  inspectDatabase,
  migrationReadiness,
  runMigrations,
  setWritesFrozen,
} from "../server/migrator.js";

let pool;
const prevAppEnv = process.env.APP_ENV;
const prevDbUrl = process.env.DATABASE_URL;

async function makeConversation(db = pool) {
  const owner = `o_${randomUUID().slice(0, 8)}`;
  const buyer = `b_${randomUUID().slice(0, 8)}`;
  for (const id of [owner, buyer]) {
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, false, now(), now())`,
      [id, `${id}@example.test`]
    );
  }
  const listingId = `l_${randomUUID().slice(0, 8)}`;
  await db.query(
    `INSERT INTO listings (id, owner_id, type, title, brand, machine_type, crop_ids, operations, area_min, area_max,
       price, region, condition, inspected_at, description, summary)
     VALUES ($1, $2, 'rent', '관리기', '아세아', 'cultivator', ARRAY['pepper'], ARRAY['till'], 1, 10,
       100000, '영양읍', 'good', '2026-11-01', '설명', '요약')`,
    [listingId, owner]
  );
  const conv = await db.query(
    `INSERT INTO conversations (listing_id, buyer_id, last_seq) VALUES ($1, $2, 1) RETURNING id`,
    [listingId, buyer]
  );
  const conversationId = String(conv.rows[0].id);
  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_id, seq, body) VALUES ($1, $2, $3, 1, '내일 대여 가능할까요?')`,
    [randomUUID(), conversationId, buyer]
  );
  return { owner, buyer, listingId, conversationId };
}

before(async () => {
  delete process.env.DATABASE_URL;
  process.env.APP_ENV = "test";
  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });
});

after(async () => {
  await pool?.end();
  if (prevAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = prevAppEnv;
  if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = prevDbUrl;
});

test("S1. vercel.json 크론은 모두 Hobby 한도(하루 1회, 분·시 고정)를 지킨다", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(config.crons) && config.crons.length > 0, "대리 응대 백스톱 크론은 남아 있어야 한다");
  assert.ok(config.crons.some((c) => c.path === "/api/delegation-jobs"));
  for (const cron of config.crons) {
    const fields = cron.schedule.trim().split(/\s+/);
    assert.equal(fields.length, 5, cron.schedule);
    const [minute, hour, dom, month] = fields;
    assert.match(minute, /^\d{1,2}$/, `분은 하나의 값이어야 함: ${cron.schedule}`);
    assert.match(hour, /^\d{1,2}$/, `시는 하나의 값이어야 함: ${cron.schedule}`);
    assert.equal(dom, "*");
    assert.equal(month, "*");
  }
});

test("S2. acquireTick: 같은 창은 모든 인스턴스를 통틀어 한 번만, 다음 창에서 다시 열린다", async () => {
  resetDelegationKickMemo();
  const t0 = 1_800_000_000_000;
  const key = `test:${randomUUID()}`;
  assert.equal(await acquireTick(pool, key, 10_000, t0), true);
  assert.equal(await acquireTick(pool, key, 10_000, t0 + 1), false, "같은 인스턴스 메모");
  resetDelegationKickMemo(); // 다른 인스턴스(메모 없음)를 흉내 낸다
  assert.equal(await acquireTick(pool, key, 10_000, t0 + 2), false, "다른 인스턴스도 DB 행에 막힌다");
  const racers = await Promise.all(
    Array.from({ length: 5 }, () => {
      resetDelegationKickMemo();
      return acquireTick(pool, key, 10_000, t0 + 10_000);
    })
  );
  assert.equal(racers.filter(Boolean).length, 1, "새 창은 정확히 한 요청만 연다");
});

test("S3. 크론 없이도 채팅 폴링만으로 만기 재시도가 처리되고, 창 안의 중복 폴링은 다시 돌지 않는다", async () => {
  resetDelegationKickMemo();
  const { conversationId } = await makeConversation();
  const { jobId } = await enqueueDelegatedReply({ conversationId, triggerSeq: 1, targetRole: "owner", pool });

  let calls = 0;
  let fail = true;
  const runner = async () => {
    calls += 1;
    return fail ? { skipped: true, reason: "LLM_FAILED" } : { action: "replied" };
  };
  const processJobs = (opts) => processDelegationJobs({ ...opts, runner });

  const t0 = Date.now();
  const first = await runDelegationKick({ conversationId, pool, now: t0, processJobs });
  assert.equal(first.conversation.retried, 1, "첫 시도는 일시 실패 → 백오프 재시도");

  // 백오프(30초)가 지난 상황을 만들고, 다음 대화방 창에서 폴링한다.
  fail = false;
  await pool.query(`UPDATE delegation_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [jobId]);
  const sameWindow = await runDelegationKick({ conversationId, pool, now: t0 + 1, processJobs });
  assert.equal(sameWindow.conversation, null, "같은 창의 폴링은 대화방 스윕을 다시 돌리지 않는다");

  const next = await runDelegationKick({ conversationId, pool, now: t0 + CONV_INTERVAL_MS + 1, processJobs });
  const done = (next.conversation?.succeeded ?? 0) + (sameWindow.global?.succeeded ?? 0) + (next.global?.succeeded ?? 0);
  assert.equal(done, 1, "만기 재시도는 다음 창에서 처리된다");
  const row = await pool.query(`SELECT status, attempts FROM delegation_jobs WHERE id = $1`, [jobId]);
  assert.equal(row.rows[0].status, "succeeded");
  assert.equal(Number(row.rows[0].attempts), 2);
  assert.equal(calls, 2);
});

test("S4. 전체 스윕은 GLOBAL 창마다 한 번, 만료 임대(죽은 처리기)도 회수한다", async () => {
  resetDelegationKickMemo();
  const { conversationId } = await makeConversation();
  const { jobId } = await enqueueDelegatedReply({ conversationId, triggerSeq: 1, targetRole: "owner", pool });
  await pool.query(
    `UPDATE delegation_jobs SET status = 'running', attempts = 1, lease_token = $2, lease_owner = 'dead',
       lease_until = now() - interval '1 second' WHERE id = $1`,
    [jobId, randomUUID()]
  );
  const runner = async () => ({ action: "replied" });
  const processJobs = (opts) => processDelegationJobs({ ...opts, runner });
  const base = (Math.floor(Date.now() / GLOBAL_INTERVAL_MS) + 10) * GLOBAL_INTERVAL_MS;
  const a = await runDelegationKick({ pool, now: base, processJobs });
  assert.ok(a.global, "새 전체 창에서 스윕이 돈다");
  const b = await runDelegationKick({ pool, now: base + 5_000, processJobs });
  assert.equal(b.global, null, "같은 전체 창에서는 다시 돌지 않는다");
  const row = await pool.query(`SELECT status FROM delegation_jobs WHERE id = $1`, [jobId]);
  assert.equal(row.rows[0].status, "succeeded");
});

test("S5. 쓰기 동결 중에는 스윕하지 않는다", async () => {
  resetDelegationKickMemo();
  await setWritesFrozen({ env: "test", frozen: true, pool });
  try {
    let called = false;
    const res = await runDelegationKick({ pool, now: Date.now() + 3_600_000, processJobs: async () => { called = true; return {}; } });
    assert.equal(res.skipped, "WRITES_FROZEN");
    assert.equal(called, false);
  } finally {
    await setWritesFrozen({ env: "test", frozen: false, pool });
  }
});

test("S6. kickDelegationQueue: 끄기 스위치, 테스트 중 기본 꺼짐, 잘못된 대화방 id는 무시", async () => {
  assert.equal(isDelegationKickEnabled({}), true);
  assert.equal(isDelegationKickEnabled({ DELEGATION_KICK: "0" }), false);
  assert.equal(isDelegationKickEnabled({ NODE_TEST_CONTEXT: "child" }), false);
  assert.equal(isDelegationKickEnabled({ NODE_TEST_CONTEXT: "child", DELEGATION_KICK: "1" }), true);
  assert.equal(kickDelegationQueue({ conversationId: randomUUID(), env: { DELEGATION_KICK: "0" } }), null);

  resetDelegationKickMemo();
  const seen = [];
  const task = kickDelegationQueue({
    conversationId: "not-a-uuid'; DROP TABLE x;--",
    env: { DELEGATION_KICK: "1" },
    pool,
    now: Date.now() + 7_200_000,
    processJobs: async (opts) => {
      seen.push(opts.conversationId ?? null);
      return { claimed: 0 };
    },
  });
  assert.ok(task, "켜져 있으면 백그라운드 작업을 돌려준다");
  const out = await task;
  assert.equal(out.conversation, null, "형식이 틀린 id로는 대화방 스윕을 하지 않는다");
  assert.deepEqual(seen, [null], "전체 스윕만 실행");
});

test("S7. 미적용 마이그레이션으로 없는 테이블·열은 500이 아니라 503 SCHEMA_NOT_READY", () => {
  for (const code of ["42P01", "42703"]) {
    const err = Object.assign(new Error("relation does not exist"), { code });
    const out = classifyError(err);
    assert.equal(out.status, 503);
    assert.equal(out.code, "SCHEMA_NOT_READY");
  }
});

test("S8. 마지막 운영 배포 스키마(0001~0007, 레거시 데이터 포함)에서 0008~0010 업그레이드 후 준비 완료", async () => {
  const all = readdirSync(DEFAULT_MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const released = all.filter((f) => f < "0008");
  assert.deepEqual(released.at(-1), "0007_insurance_consult_unique.sql");
  const dir = mkdtempSync(join(tmpdir(), "moa-mig-"));
  const legacyPool = createPglitePool("memory://");
  try {
    for (const f of released) copyFileSync(join(DEFAULT_MIGRATIONS_DIR, f), join(dir, f));
    await initEnvironment({ env: "test", pool: legacyPool });
    await runMigrations({ env: "test", pool: legacyPool, migrationsDir: dir });

    const before = migrationReadiness(await inspectDatabase({ pool: legacyPool }));
    assert.equal(before.ready, false);
    assert.deepEqual(before.problems, ["PENDING_MIGRATIONS"]);
    assert.deepEqual(before.pendingMigrations, [
      "0008_education_certificates.sql",
      "0008_role_scoped_ai_state.sql",
      "0009_trade_offers.sql",
      "0010_delegation_jobs.sql",
    ]);

    // 레거시 공유 상태(일시정지·초안)와 기존 대여 신청이 있는 운영 데이터를 흉내 낸다.
    const { conversationId, buyer, listingId } = await makeConversation(legacyPool);
    await legacyPool.query(
      `UPDATE conversations SET owner_ai_mode = 'autonomous', ai_paused_reason = 'escalated:price',
         ai_draft_json = $2::jsonb WHERE id = $1`,
      [conversationId, JSON.stringify({ targetRole: "buyer", targetUserId: buyer, body: "초안" })]
    );
    await legacyPool.query(
      `INSERT INTO rental_requests (id, listing_id, requester_id, start_date, end_date, daily_price, days, total_price)
       VALUES ($1, $2, $3, '2026-12-01', '2026-12-02', 100000, 2, 200000)`,
      [randomUUID(), listingId, buyer]
    );

    const upgrade = await runMigrations({ env: "test", pool: legacyPool });
    assert.deepEqual(upgrade.applied, before.pendingMigrations);
    const afterInfo = migrationReadiness(await inspectDatabase({ pool: legacyPool }));
    assert.equal(afterInfo.ready, true, JSON.stringify(afterInfo));

    const conv = await legacyPool.query(
      `SELECT buyer_ai_pause, owner_ai_pause, buyer_ai_draft_json, buyer_last_read_seq, owner_last_read_seq
       FROM conversations WHERE id = $1`,
      [conversationId]
    );
    assert.equal(conv.rows[0].buyer_ai_pause, "escalated:price", "초안 대상(구매자) 역할로 일시정지 이관");
    assert.equal(conv.rows[0].owner_ai_pause, null);
    assert.equal(conv.rows[0].buyer_ai_draft_json.body, "초안");
    assert.equal(Number(conv.rows[0].owner_last_read_seq), 1, "기존 대화가 안 읽음으로 보이지 않는다");
    const rr = await legacyPool.query(`SELECT created_via, offer_id FROM rental_requests WHERE listing_id = $1`, [listingId]);
    assert.equal(rr.rows[0].created_via, "human");
    assert.equal(rr.rows[0].offer_id, null);

    // 업그레이드된 DB에서 새 큐와 이수증 테이블이 바로 동작한다.
    const job = await enqueueDelegatedReply({ conversationId, triggerSeq: 1, targetRole: "owner", pool: legacyPool });
    assert.equal(job.created, true);
    const cert = await legacyPool.query(`SELECT to_regclass('education_certificates')::text AS reg`);
    assert.equal(cert.rows[0].reg, "education_certificates");

    // 재실행은 아무것도 바꾸지 않는다(멱등).
    const again = await runMigrations({ env: "test", pool: legacyPool });
    assert.deepEqual(again.applied, []);
  } finally {
    await legacyPool.end();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("S9. 체크섬이 바뀐 적용 마이그레이션은 준비 안 됨으로 보고한다", async () => {
  const info = await inspectDatabase({ pool });
  assert.equal(migrationReadiness(info).ready, true);
  const tampered = migrationReadiness({ ...info, checksumMismatches: ["0001_initial_schema.sql"] });
  assert.equal(tampered.ready, false);
  assert.deepEqual(tampered.problems, ["CHECKSUM_MISMATCH"]);
  const uninit = migrationReadiness({ ...info, environment: null });
  assert.deepEqual(uninit.problems, ["ENVIRONMENT_UNINITIALIZED"]);
});
