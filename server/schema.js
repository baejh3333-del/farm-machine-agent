import { getMigrations } from "better-auth/db/migration";
import { buildAccountAuthOptions } from "./account-auth.js";
import { getPool, usesLocalDatabase } from "./db.js";
import { buildMockListings } from "./listing-seed.js";

// 스키마를 바꾸면 SCHEMA_VERSION을 올리고 DDL 끝에 변경 문장을 더한다.
export const SCHEMA_VERSION = 1;
export const DEMO_OWNER_ID = "demo-owner";
export const DEMO_ACCOUNT_EMAIL = "10jo@users.moa-farm.example.com";
const MIGRATION_LOCK = 4_247_001;

export const DDL = `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS listing (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES "user"(id),
  type          TEXT NOT NULL CHECK (type IN ('rent', 'sale')),
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  brand         TEXT NOT NULL,
  machine_type  TEXT NOT NULL,
  model_id      TEXT,
  crop_ids      TEXT[] NOT NULL CHECK (cardinality(crop_ids) > 0),
  operations    TEXT[] NOT NULL CHECK (cardinality(operations) > 0),
  area_min      INTEGER NOT NULL CHECK (area_min > 0),
  area_max      INTEGER NOT NULL CHECK (area_max >= area_min),
  price         INTEGER NOT NULL CHECK (price >= 0),
  region        TEXT NOT NULL,
  condition     TEXT NOT NULL CHECK (condition IN ('good', 'used', 'repair')),
  inspected_at  DATE NOT NULL,
  included      TEXT NOT NULL DEFAULT '',
  pickup        TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  summary       TEXT NOT NULL DEFAULT '',
  photo_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dealing', 'done', 'hidden')),
  is_demo       BOOLEAN NOT NULL DEFAULT false,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_owner_idx ON listing (owner_id);
CREATE INDEX IF NOT EXISTS listing_browse_idx ON listing (type, status);

CREATE TABLE IF NOT EXISTS rental_request (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    TEXT NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  requester_id  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL CHECK (end_date >= start_date),
  note          TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rental_request_listing_idx ON rental_request (listing_id, status);
CREATE INDEX IF NOT EXISTS rental_request_requester_idx ON rental_request (requester_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS rental_request_pending_once
  ON rental_request (listing_id, requester_id, start_date, end_date) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS booking (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  TEXT NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  request_id  UUID UNIQUE REFERENCES rental_request(id),
  period      DATERANGE NOT NULL CHECK (NOT isempty(period)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_no_overlap EXCLUDE USING gist (listing_id WITH =, period WITH &&)
);

CREATE TABLE IF NOT EXISTS conversation (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  TEXT NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  buyer_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, buyer_id)
);

CREATE TABLE IF NOT EXISTS message (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  sender_id        TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  body             TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_conversation_idx ON message (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS favorite (
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  listing_id  TEXT NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS owned_machine (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  model_id    TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owned_machine_user_idx ON owned_machine (user_id);

CREATE TABLE IF NOT EXISTS moa_schema (version INTEGER PRIMARY KEY);
`;

// 데모 농가(로그인할 수 없는 시스템 사용자), 시드 매물, 시드 예약을 한 문장으로 넣는다.
// 이미 있는 매물은 건드리지 않고, 이번에 새로 넣은 매물에만 시드 예약을 붙이므로 여러 번 실행해도 같다.
const SEED = `
WITH owner AS (
  INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  VALUES ($1, '데모 농가', 'demo-owner@users.moa-farm.example.com', false, now(), now())
  ON CONFLICT (id) DO NOTHING
  RETURNING id
), inserted AS (
  INSERT INTO listing (id, owner_id, type, title, brand, machine_type, model_id, crop_ids, operations,
    area_min, area_max, price, region, condition, inspected_at, included, pickup, description, summary,
    status, is_demo, sort_order)
  SELECT s.id, $1, s.type, s.title, s.brand, s.machine_type, s.model_id, s.crop_ids, s.operations,
    s.area_min, s.area_max, s.price, s.region, s.condition, s.inspected_at, s.included, s.pickup,
    s.description, s.summary, s.status, true, s.sort_order
  FROM json_to_recordset($2::json) AS s(id text, type text, title text, brand text, machine_type text,
    model_id text, crop_ids text[], operations text[], area_min int, area_max int, price int, region text,
    condition text, inspected_at date, included text, pickup text, description text, summary text,
    status text, sort_order int)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO booking (listing_id, period)
SELECT b.listing_id, daterange(b.start_date, b.end_date, '[]')
FROM json_to_recordset($3::json) AS b(listing_id text, start_date date, end_date date)
WHERE b.listing_id IN (SELECT id FROM inserted)
`;

export function seedRows() {
  const listings = buildMockListings();
  return {
    listings: listings.map((item, index) => ({
      id: item.id, type: item.type, title: item.title, brand: item.brand, machine_type: item.machineType,
      model_id: item.modelId ?? null, crop_ids: item.cropIds, operations: item.operations,
      area_min: item.areaMin, area_max: item.areaMax, price: item.price, region: item.region,
      condition: item.condition, inspected_at: item.inspectedAt, included: item.included, pickup: item.pickup,
      description: item.description, summary: item.summary, status: item.status, sort_order: index,
    })),
    bookings: listings.flatMap((item) => item.booked.map(({ start, end }) => ({ listing_id: item.id, start_date: start, end_date: end }))),
    // 시드에서 owner: true였던 매물은 시연 계정(10jo)의 것이다.
    demoAccountListingIds: listings.filter((item) => item.owner).map((item) => item.id),
  };
}

async function installedVersion(pool) {
  try {
    const { rows } = await pool.query("SELECT max(version) AS version FROM moa_schema", []);
    return rows[0]?.version ?? 0;
  } catch (error) {
    if (error.code === "42P01") return 0;
    throw error;
  }
}

// 시연 계정이 있으면 시드에서 그 계정 소유였던 매물을 넘겨준다. 계정을 나중에 만들어도 다음 실행 때 반영된다.
export async function assignDemoOwnership(pool = getPool()) {
  const { demoAccountListingIds } = seedRows();
  await pool.query(`
    UPDATE listing SET owner_id = u.id, updated_at = now()
    FROM "user" u
    WHERE u.email = $1 AND listing.id = ANY($2::text[]) AND listing.owner_id = $3
  `, [DEMO_ACCOUNT_EMAIL, demoAccountListingIds, DEMO_OWNER_ID]);
}

async function install(pool) {
  const { runMigrations } = await getMigrations(buildAccountAuthOptions());
  await runMigrations();
  const client = await pool.connect();
  try {
    await client.query(`BEGIN; ${DDL} COMMIT;`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const { listings, bookings } = seedRows();
  await pool.query(SEED, [DEMO_OWNER_ID, JSON.stringify(listings), JSON.stringify(bookings)]);
  await pool.query("INSERT INTO moa_schema (version) VALUES ($1) ON CONFLICT DO NOTHING", [SCHEMA_VERSION]);
}

// 여러 서버 인스턴스가 동시에 처음 뜨면 마이그레이션이 겹친다. 한 연결이 세션 잠금을 잡고 있는 동안
// 다른 인스턴스는 기다렸다가, 잠금을 얻은 뒤 버전을 다시 확인한다. better-auth 마이그레이션도 이 안에서 돈다.
async function withMigrationLock(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}

async function migrate() {
  const pool = getPool();
  if (await installedVersion(pool) < SCHEMA_VERSION) {
    // 로컬 PGlite는 연결이 하나라 잠금을 잡으면 마이그레이션이 그 연결을 기다리며 멈춘다. 프로세스도 하나뿐이라 필요 없다.
    if (usesLocalDatabase()) await install(pool);
    else await withMigrationLock(pool, async () => { if (await installedVersion(pool) < SCHEMA_VERSION) await install(pool); });
  }
  await assignDemoOwnership(pool);
}

let ensured;
// 인스턴스마다 처음 한 번만 확인한다. 실패하면 다음 요청에서 다시 시도한다.
export function ensureSchema() {
  ensured ??= migrate().catch((error) => {
    ensured = undefined;
    throw error;
  });
  return ensured;
}
