// P0 배포 준비: Hobby 호환 vercel.json(크론·함수 수·rewrite) + 마이그레이션 준비 상태 점검.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { resetAuthCache } from "../server/account-auth.js";
import { createPglitePool, setPool } from "../server/db.js";
import { classifyError } from "../server/http.js";
import {
  DEFAULT_MIGRATIONS_DIR,
  initEnvironment,
  inspectDatabase,
  migrationReadiness,
  runMigrations,
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

test("S1. vercel.json 크론이 있다면 모두 Hobby 한도(하루 1회, 분·시 고정)를 지키고, 제거된 대리 응대 스윕 크론은 없다", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const crons = config.crons || [];
  assert.ok(!crons.some((c) => c.path === "/api/delegation-jobs"), "대리 응대 스윕 크론은 제거되어야 한다");
  for (const cron of crons) {
    const fields = cron.schedule.trim().split(/\s+/);
    assert.equal(fields.length, 5, cron.schedule);
    const [minute, hour, dom, month] = fields;
    assert.match(minute, /^\d{1,2}$/, `분은 하나의 값이어야 함: ${cron.schedule}`);
    assert.match(hour, /^\d{1,2}$/, `시는 하나의 값이어야 함: ${cron.schedule}`);
    assert.equal(dom, "*");
    assert.equal(month, "*");
  }
});

// 배포 프로젝트는 Vercel Pro 팀이라 Hobby의 배포당 함수 12개 제한은 검사하지 않는다.
test("S1b. vercel.json의 functions·rewrite 대상이 실제 함수로 이어진다", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  for (const key of Object.keys(config.functions || {})) {
    assert.ok(statSync(new URL(`../${key}`, import.meta.url)).isFile(), `functions 설정 대상 없음: ${key}`);
  }
  for (const rewrite of config.rewrites || []) {
    const target = new URL(rewrite.destination, "http://localhost").pathname;
    assert.ok(statSync(new URL(`..${target}.js`, import.meta.url)).isFile(), `rewrite 대상 없음: ${rewrite.destination}`);
  }
  assert.ok(!(config.rewrites || []).some((r) => r.source === "/api/delegation-jobs"), "대리 응대 스윕 rewrite는 제거되어야 한다");
  assert.ok(!Object.hasOwn(config.functions || {}, "api/agent-chat-reply.js"), "대리 응대 함수 설정은 제거되어야 한다");
});

test("S7. 미적용 마이그레이션으로 없는 테이블·열은 500이 아니라 503 SCHEMA_NOT_READY", () => {
  for (const code of ["42P01", "42703"]) {
    const err = Object.assign(new Error("relation does not exist"), { code });
    const out = classifyError(err);
    assert.equal(out.status, 503);
    assert.equal(out.code, "SCHEMA_NOT_READY");
  }
});

test("S8. 운영 배포 스키마(0001~0007, 레거시 데이터 포함)에서 현재 스키마로 업그레이드 후 준비 완료", async () => {
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
    assert.deepEqual(before.pendingMigrations, all.slice(released.length));

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

    // 업그레이드된 DB에서 이수증 테이블이 바로 동작한다.
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
