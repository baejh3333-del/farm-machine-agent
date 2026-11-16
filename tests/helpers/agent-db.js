import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CROP_BY_ID, MACHINE_BY_ID, OPERATION_BY_ID } from "../../src/data/farm-machines.js";
import { createPglitePool, setPool } from "../../server/db.js";
import { createListing } from "../../server/listings-service.js";
import { initEnvironment, runMigrations } from "../../server/migrator.js";

export const TEST_USERS = ["u-a", "u-b", "u-c"];

export async function insertUser(pool, id, name) {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, false, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [id, name, `${id}@users.moa-farm.example.com`]
  );
}

/**
 * 메모리 PGlite에 전체 마이그레이션을 적용하고 u-a/u-b/u-c 사용자를 넣는다.
 * 반환한 cleanup을 after()에서 호출한다.
 */
export async function setupAgentDb() {
  const prevEnv = {
    APP_ENV: process.env.APP_ENV,
    OBJECT_STORAGE_DIR: process.env.OBJECT_STORAGE_DIR,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  delete process.env.DATABASE_URL;
  process.env.APP_ENV = "test";
  const tempDir = await mkdtemp(join(tmpdir(), "moa-agent-db-"));
  process.env.OBJECT_STORAGE_DIR = join(tempDir, "objects");

  const pool = createPglitePool("memory://");
  setPool(pool);
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });
  for (const id of TEST_USERS) await insertUser(pool, id, `농가 ${id}`);

  async function cleanup() {
    await pool.end();
    setPool(undefined);
    await rm(tempDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  return { pool, cleanup };
}

export function shiftDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** createListing에 넘길 수 있는 유효한 payload(id 제외). */
export function listingPayload(overrides = {}) {
  return {
    type: "rent",
    title: "테스트 관리기",
    brand: "테스트",
    machineType: Object.keys(MACHINE_BY_ID)[0],
    cropIds: [Object.keys(CROP_BY_ID)[0]],
    operations: [Object.keys(OPERATION_BY_ID)[0]],
    areaMin: 100,
    areaMax: 1000,
    price: 50_000,
    region: "충북 괴산",
    ...overrides,
  };
}

/** ownerId 소유의 매물을 만들고 listing DTO를 돌려준다. setupAgentDb()가 등록한 풀을 쓴다. */
export async function makeListing(ownerId, overrides = {}) {
  const result = await createListing({ id: ownerId }, { id: randomUUID(), ...listingPayload(overrides) });
  return result.listing;
}
