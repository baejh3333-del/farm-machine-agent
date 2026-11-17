import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";

import accountHandler from "../api/account.js";
import agentHandler from "../api/agent.js";
import conversationsHandler from "../api/conversations.js";
import listingsHandler from "../api/listings.js";
import meHandler from "../api/me.js";
import photosHandler from "../api/photos.js";
import recommendHandler from "../api/recommend.js";
import requestsHandler from "../api/requests.js";
import { resetAuthCache } from "../server/account-auth.js";
import { saveDraftPhoto } from "../server/listing-drafts.js";
import { recommend } from "../server/agent.js";
import { getConversationMessages, sendMessage } from "../server/chat.js";
import { createPglitePool, kstToday, setPool } from "../server/db.js";
import { classifyError } from "../server/http.js";
import { fetchListings } from "../server/listings-db.js";
import { createListing, updateListing } from "../server/listings-service.js";
import {
  DEFAULT_MIGRATIONS_DIR,
  initEnvironment,
  inspectDatabase,
  runMigrations,
  seedDemoListings,
  setWritesFrozen,
} from "../server/migrator.js";
import {
  approveRentalRequest,
  cancelRentalRequest,
  createRentalRequest,
  listRequestsForUser,
  MAX_RENTAL_DAYS,
  rejectRentalRequest,
} from "../server/rentals.js";
import { checkRateLimit, enforceRateLimit } from "../server/rate-limit.js";
import { getPhotoObject, listPhotoObjects, newListingPhotoKey, putPhotoObject, reconcilePhotos } from "../server/storage.js";
import { addOwnedMachine } from "../server/user-data.js";
import { CROPS, OPERATIONS, MACHINE_TYPES } from "../src/data/farm-machines.js";
import { MACHINE_SPECIFICATIONS } from "../src/data/machine-specifications.js";
import { buildMockListings } from "../server/listing-seed.js";

function shiftDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function patchRes(res) {
  let code = 200;
  res.status = (c) => { code = c; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
    return res;
  };
}

async function apiReq(baseUrl, path, { method = "GET", cookie = "", json = undefined, origin = baseUrl } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (method !== "GET" && method !== "HEAD") {
    headers.origin = origin;
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const setCookie = response.headers.getSetCookie?.() || [];
  const nextCookie = setCookie.length
    ? setCookie.map((c) => c.split(";")[0]).join("; ")
    : cookie;
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body, cookie: nextCookie };
}

async function signupHttp(baseUrl, username, name, password = "Password123!") {
  const res = await apiReq(baseUrl, "/api/account?action=signup", {
    method: "POST",
    json: { username, name, password },
  });
  assert.equal(res.status, 200, `signup failed for ${username}: ${JSON.stringify(res.body)}`);
  assert.ok(res.cookie.includes("better-auth.session_token"), "missing session cookie on signup");
  return { user: res.body.user, cookie: res.cookie };
}

let tempDir;
let pool;
let server;
let baseUrl;
let prevEnv = {};
let userA;
let userB;
let userC;

before(async () => {
  prevEnv = {
    APP_ENV: process.env.APP_ENV,
    OBJECT_STORAGE_DIR: process.env.OBJECT_STORAGE_DIR,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  delete process.env.DATABASE_URL;
  process.env.APP_ENV = "test";
  tempDir = await mkdtemp(join(tmpdir(), "moa-pg-int-"));
  process.env.OBJECT_STORAGE_DIR = join(tempDir, "objects");

  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();

  const routeMap = new Map([
    ["/api/account", accountHandler],
    ["/api/listings", listingsHandler],
    ["/api/recommend", recommendHandler],
    ["/api/agent", agentHandler],
    ["/api/voice", agentHandler],
    ["/api/me", meHandler],
    ["/api/requests", requestsHandler],
    ["/api/conversations", conversationsHandler],
    ["/api/photos", photosHandler],
  ]);

  server = createServer(async (req, res) => {
    patchRes(res);
    const { pathname } = new URL(req.url || "/", "http://127.0.0.1");
    const handler = routeMap.get(pathname);
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    await handler(req, res);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  setPool(undefined);
  resetAuthCache();
  await rm(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("[PGlite 로컬 엔진] 1. 명시적 마이그레이션, 체크섬 검증, 환경 마커 가드 및 btree_gist/user.id 확인", async () => {
  await assert.rejects(
    () => runMigrations({ env: "test", pool }),
    (err) => err.code === "ENVIRONMENT_UNINITIALIZED"
  );

  const initRes = await initEnvironment({ env: "test", pool });
  assert.equal(initRes.initialized, true);
  assert.equal(initRes.environment, "test");

  await assert.rejects(
    () => initEnvironment({ env: "production", pool }),
    (err) => err.code === "ENVIRONMENT_MISMATCH"
  );

  const migRes = await runMigrations({ env: "test", pool });
  assert.deepEqual(migRes.applied, [
    "0001_initial_schema.sql",
    "0002_rate_limits_and_rental_bounds.sql",
    "0003_agent_core.sql",
    "0004_catalog_reference.sql",
    "0005_delegated_chat.sql",
    "0006_insurance_consults.sql",
  ]);

  const info = await inspectDatabase({ pool });
  assert.equal(info.environment, "test");
  assert.equal(info.userIdType, "text");
  assert.equal(info.btreeGistInstalled, true);
  assert.equal(info.writesFrozen, false);
  assert.equal(info.counts.crop_catalog, CROPS.length);
  assert.equal(info.counts.operation_catalog, OPERATIONS.length);
  assert.equal(info.counts.machine_type_catalog, MACHINE_TYPES.length);
  assert.equal(info.counts.machine_model_specs, MACHINE_SPECIFICATIONS.length);

  // Tampered migration checksum must be rejected
  const badMigrationsDir = join(tempDir, "bad-migrations");
  await cp(DEFAULT_MIGRATIONS_DIR, badMigrationsDir, { recursive: true });
  const origSql = await readFile(join(badMigrationsDir, "0001_initial_schema.sql"), "utf8");
  await writeFile(join(badMigrationsDir, "0001_initial_schema.sql"), `${origSql}\n-- modified`, "utf8");

  await assert.rejects(
    () => runMigrations({ env: "test", pool, migrationsDir: badMigrationsDir, runBetterAuth: false }),
    (err) => err.code === "MIGRATION_CHECKSUM_MISMATCH"
  );

  // Separate production-marked DB refuses demo seed without --allow-production
  const prodPool = createPglitePool("memory://");
  try {
    await initEnvironment({ env: "production", pool: prodPool });
    await runMigrations({ env: "production", pool: prodPool });
    await assert.rejects(
      () => seedDemoListings({ env: "production", pool: prodPool }),
      (err) => err.code === "SEED_FORBIDDEN_IN_PRODUCTION"
    );
  } finally {
    await prodPool.end();
  }

  const expectedMockCount = buildMockListings().length;
  // Seed test DB and confirm all demo items in PostgreSQL + live recommend uses PG
  const seedRes = await seedDemoListings({ env: "test", pool });
  assert.equal(seedRes.inserted, expectedMockCount);

  const rec = await recommend("고추 두둑 대여", { maxPrice: 70000 }, { pool });
  assert.ok(rec.listingIds.length > 0);
  const pgListings = await fetchListings({ pool });
  assert.equal(pgListings.length, expectedMockCount);
});

test("[PGlite 로컬 엔진] 2. 회원가입 및 A/B/C 계정 세션, write-freeze 503 차단 및 복구", async () => {
  userA = await signupHttp(baseUrl, "farmer_a", "농부A");
  userB = await signupHttp(baseUrl, "farmer_b", "농부B");
  userC = await signupHttp(baseUrl, "farmer_c", "농부C");

  // Enable write freeze and always unfreeze in finally so subsequent tests aren't affected
  await setWritesFrozen({ env: "test", frozen: true, pool });
  try {
    // Reads remain available
    const getListings = await apiReq(baseUrl, "/api/listings");
    assert.equal(getListings.status, 200);
    assert.equal(getListings.body.listings.length, buildMockListings().length);

    const getSess = await apiReq(baseUrl, "/api/account?action=session", { cookie: userA.cookie });
    assert.equal(getSess.status, 200);
    assert.equal(getSess.body.user.id, userA.user.id);

    // All write endpoints (including signup) reject with 503 WRITES_FROZEN
    const frozenSignup = await apiReq(baseUrl, "/api/account?action=signup", {
      method: "POST",
      json: { username: "blocked_u", name: "차단유저", password: "Password123!" },
    });
    assert.equal(frozenSignup.status, 503);
    assert.equal(frozenSignup.body.code, "WRITES_FROZEN");

    const frozenListing = await apiReq(baseUrl, "/api/listings", {
      method: "POST",
      cookie: userA.cookie,
      json: { action: "create", id: randomUUID(), type: "rent", title: "테스트" },
    });
    assert.equal(frozenListing.status, 503);
    assert.equal(frozenListing.body.code, "WRITES_FROZEN");

    const frozenFav = await apiReq(baseUrl, "/api/me", {
      method: "POST",
      cookie: userB.cookie,
      json: { action: "toggleFavorite", listingId: getListings.body.listings[0].id },
    });
    assert.equal(frozenFav.status, 503);
    assert.equal(frozenFav.body.code, "WRITES_FROZEN");

    const frozenReq = await apiReq(baseUrl, "/api/requests", {
      method: "POST",
      cookie: userB.cookie,
      json: { action: "create", id: randomUUID() },
    });
    assert.equal(frozenReq.status, 503);
    assert.equal(frozenReq.body.code, "WRITES_FROZEN");

    const frozenChat = await apiReq(baseUrl, "/api/conversations", {
      method: "POST",
      cookie: userB.cookie,
      json: { action: "send", id: randomUUID(), body: "안녕" },
    });
    assert.equal(frozenChat.status, 503);
    assert.equal(frozenChat.body.code, "WRITES_FROZEN");
  } finally {
    await setWritesFrozen({ env: "test", frozen: false, pool });
  }

  // Unfreeze restores writes cleanly
  const listingsSnap = await apiReq(baseUrl, "/api/listings");
  const unblockedFav = await apiReq(baseUrl, "/api/me", {
    method: "POST",
    cookie: userB.cookie,
    json: { action: "toggleFavorite", listingId: listingsSnap.body.listings[0].id, favorite: true },
  });
  assert.equal(unblockedFav.status, 200);
  assert.equal(unblockedFav.body.isFavorite, true);
});

test("[PGlite 로컬 엔진] 3. 서버 이미지 검증·EXIF 제거·교체/실패 정리 및 reconcile 고아 객체 정리", async () => {
  // Build PNG + JPEG with synthetic EXIF metadata
  const rawJpegWithExif = await sharp({
    create: { width: 48, height: 32, channels: 3, background: { r: 70, g: 140, b: 80 } },
  })
    .withMetadata({ exif: { IFD0: { Copyright: "EXIF_SHOULD_BE_STRIPPED", Make: "MockCam" } } })
    .jpeg({ quality: 85 })
    .toBuffer();

  const jpegMeta = await sharp(rawJpegWithExif).metadata();
  assert.ok(jpegMeta.exif, "test input JPEG should carry EXIF before upload");

  const listingId = randomUUID();
  const basePayload = {
    action: "create",
    id: listingId,
    type: "rent",
    modelId: "asia-amc900",
    title: "사진 검증 테스트 관리기",
    region: "영양읍",
    cropIds: ["pepper"],
    operations: ["till"],
    price: 45000,
    areaMin: 200,
    areaMax: 1200,
    condition: "good",
    inspectedAt: kstToday(),
    included: "로터리 포함",
    pickup: "영양읍 직거래",
    description: "EXIF 제거 테스트용 매물입니다.",
    photoDataUrl: `data:image/jpeg;base64,${rawJpegWithExif.toString("base64")}`,
  };

  // Reject oversized (>1MB) and spoofed magic bytes
  const tooBigRes = await apiReq(baseUrl, "/api/listings", {
    method: "POST",
    cookie: userA.cookie,
    json: {
      ...basePayload,
      id: randomUUID(),
      photoDataUrl: `data:image/jpeg;base64,${Buffer.alloc(1024 * 1024 + 32, 0xff).toString("base64")}`,
    },
  });
  assert.equal(tooBigRes.status, 413);

  const spoofRes = await apiReq(baseUrl, "/api/listings", {
    method: "POST",
    cookie: userA.cookie,
    json: {
      ...basePayload,
      id: randomUUID(),
      photoDataUrl: `data:image/jpeg;base64,${Buffer.from("<script>alert(1)</script>not-a-jpeg").toString("base64")}`,
    },
  });
  assert.equal(spoofRes.status, 400);

  // Create listing with valid JPEG + EXIF -> converted to stripped WebP
  const created = await apiReq(baseUrl, "/api/listings", {
    method: "POST",
    cookie: userA.cookie,
    json: basePayload,
  });
  assert.equal(created.status, 201);
  const firstKey = created.body.listing.photoKey;
  assert.ok(firstKey && firstKey.startsWith(`listings/${listingId}/`));

  const photoRes = await apiReq(baseUrl, created.body.listing.photoUrl);
  assert.equal(photoRes.status, 200);
  assert.equal(photoRes.headers.get("content-type"), "image/webp");
  assert.equal(photoRes.headers.get("x-content-type-options"), "nosniff");
  const storedMeta = await sharp(photoRes.body).metadata();
  assert.equal(storedMeta.format, "webp");
  assert.equal(storedMeta.exif, undefined);
  assert.equal(storedMeta.icc, undefined);
  assert.equal(storedMeta.xmp, undefined);

  // Failed DB insert after photo upload cleans up newly written object immediately
  const failedId = randomUUID();
  const keysBeforeFail = new Set((await listPhotoObjects()).map((o) => o.key));
  await assert.rejects(
    () => createListing({ id: "missing-fk-owner" }, { ...basePayload, id: failedId }, { pool }),
    (err) => err?.code === "23503"
  );
  const keysAfterFail = new Set((await listPhotoObjects()).map((o) => o.key));
  assert.deepEqual(keysAfterFail, keysBeforeFail, "failed DB write must not leave orphan photo objects");

  // Replacing photo deletes old object after commit and preserves new key
  const rawPng = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 90, b: 180 } },
  }).png().toBuffer();

  const updated = await apiReq(baseUrl, "/api/listings", {
    method: "POST",
    cookie: userA.cookie,
    json: {
      action: "update",
      id: listingId,
      title: "사진 교체 완료 관리기",
      photoDataUrl: `data:image/png;base64,${rawPng.toString("base64")}`,
    },
  });
  assert.equal(updated.status, 200);
  const secondKey = updated.body.listing.photoKey;
  assert.notEqual(secondKey, firstKey);

  const oldPhotoRes = await apiReq(baseUrl, `/api/photos?key=${encodeURIComponent(firstKey)}`);
  assert.equal(oldPhotoRes.status, 404);
  const newPhotoRes = await apiReq(baseUrl, updated.body.listing.photoUrl);
  assert.equal(newPhotoRes.status, 200);

  // Hiding listing sets status='removed', while reconcile preserves removed listing photo and deletes old orphan
  const removed = await apiReq(baseUrl, "/api/listings", {
    method: "POST",
    cookie: userA.cookie,
    json: { action: "remove", id: listingId },
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.listing.status, "removed");

  const orphanKey = newListingPhotoKey("orphan-deleted-attempt");
  await putPhotoObject(orphanKey, Buffer.from("orphan"), "image/webp");
  const orphanPath = join(process.env.OBJECT_STORAGE_DIR, orphanKey);
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
  await utimes(orphanPath, twoHoursAgo, twoHoursAgo);

  const recRes = await reconcilePhotos({ pool, minAgeMs: 60_000, now: Date.now() });
  assert.ok(recRes.deletedKeys.includes(orphanKey), "aged orphan must be pruned");
  assert.ok(!recRes.deletedKeys.includes(secondKey), "removed listing photo_key must be preserved");
  const removedPhotoStillExists = await apiReq(baseUrl, `/api/photos?key=${encodeURIComponent(secondKey)}`);
  assert.equal(removedPhotoStillExists.status, 200);
});

test("[PGlite 로컬 엔진] 4. 중복 대여 승인 직렬화, GiST 배타 제약, KST 날짜 경계, 취소·재승인 및 활성 예약 보호", async () => {
  const today = kstToday();
  const futureStart = shiftDate(today, 3);
  const futureEnd = shiftDate(today, 5);
  const overlapStart = shiftDate(today, 4);
  const overlapEnd = shiftDate(today, 6);

  // User A creates a rental listing
  const listingId = randomUUID();
  const created = await createListing(userA.user, {
    id: listingId,
    type: "rent",
    modelId: "asia-amc900",
    title: "동시성 테스트 관리기",
    region: "청기면",
    cropIds: ["pepper"],
    operations: ["ridge"],
    price: 50000,
    areaMin: 200,
    areaMax: 1000,
    condition: "good",
    inspectedAt: today,
  }, { pool });
  assert.equal(created.status, 201);

  // Self-rental is forbidden
  await assert.rejects(
    () => createRentalRequest(userA.user, { id: randomUUID(), listingId, start: futureStart, end: futureEnd }, { pool }),
    (err) => err.status === 403 && err.code === "SELF_RENTAL_FORBIDDEN"
  );

  // User B and User C submit overlapping pending requests
  const reqBId = randomUUID();
  const reqCId = randomUUID();
  const rB = await createRentalRequest(userB.user, { id: reqBId, listingId, start: futureStart, end: futureEnd, note: "B 요청" }, { pool });
  const rC = await createRentalRequest(userC.user, { id: reqCId, listingId, start: overlapStart, end: overlapEnd, note: "C 요청" }, { pool });
  assert.equal(rB.status, 201);
  assert.equal(rC.status, 201);

  // Pending requests must NOT block stock yet
  const listingsBeforeApprove = await fetchListings({ pool });
  const targetBefore = listingsBeforeApprove.find((l) => l.id === listingId);
  assert.equal(targetBefore.booked.length, 0);

  // User A concurrently approves BOTH overlapping requests
  const results = await Promise.allSettled([
    approveRentalRequest(userA.user, reqBId, { pool }),
    approveRentalRequest(userA.user, reqCId, { pool }),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one overlapping approval must succeed");
  assert.equal(rejected.length, 1, "the second overlapping approval must fail");
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(rejected[0].reason.code, "DATE_OVERLAP");

  const winnerId = fulfilled[0].value.request.id;
  const loserId = winnerId === reqBId ? reqCId : reqBId;

  // Non-approved request MUST remain pending with derivedState === 'conflict', and approvableCount === 0
  const ownerInbox = await listRequestsForUser(userA.user.id, { pool });
  assert.equal(ownerInbox.approvableCount, 0);
  const loserDto = ownerInbox.incoming.find((r) => r.id === loserId);
  assert.equal(loserDto.status, "pending");
  assert.equal(loserDto.derivedState, "conflict");
  assert.equal(loserDto.canApprove, false);

  // PostgreSQL EXCLUDE USING gist enforces no-overlap even on raw SQL update
  await assert.rejects(
    () => pool.query(`UPDATE rental_requests SET status = 'approved' WHERE id = $1`, [loserId]),
    (err) => err?.code === "23P01"
  );

  // Active booking blocks listing removal and switching type to 'sale'
  await assert.rejects(
    () => updateListing(userA.user, { action: "remove", id: listingId }, { pool }),
    (err) => err.status === 409 && err.code === "ACTIVE_BOOKING_EXISTS"
  );
  await assert.rejects(
    () => updateListing(userA.user, { action: "update", id: listingId, type: "sale" }, { pool }),
    (err) => err.status === 409 && err.code === "ACTIVE_BOOKING_EXISTS"
  );

  // Cancelling future approved reservation (today < start_date) succeeds and frees dates for loser request
  const cancelRes = await cancelRentalRequest(userB.user.id === (winnerId === reqBId ? userB.user.id : userC.user.id) ? userB.user : userC.user, winnerId, { pool });
  assert.equal(cancelRes.request.status, "cancelled");

  const afterCancelApprove = await approveRentalRequest(userA.user, loserId, { pool });
  assert.equal(afterCancelApprove.request.status, "approved");

  // Past-start-date pending request is 'expired' and cannot be approved
  const expiredReqId = randomUUID();
  const yesterday = shiftDate(today, -1);
  await pool.query(
    `INSERT INTO rental_requests (id, listing_id, requester_id, start_date, end_date, daily_price, days, total_price, status)
     VALUES ($1, $2, $3, $4::date, $4::date, 50000, 1, 50000, 'pending')`,
    [expiredReqId, listingId, userB.user.id, yesterday]
  );
  const inboxWithExpired = await listRequestsForUser(userA.user.id, { pool });
  const expiredDto = inboxWithExpired.incoming.find((r) => r.id === expiredReqId);
  assert.equal(expiredDto.derivedState, "expired");
  assert.equal(inboxWithExpired.approvableCount, 0);
  await assert.rejects(
    () => approveRentalRequest(userA.user, expiredReqId, { pool }),
    (err) => err.status === 409 && err.code === "REQUEST_EXPIRED"
  );

  // Same-day / active approved reservation CANNOT be cancelled (today >= start_date)
  const sameDayReqId = randomUUID();
  await createRentalRequest(userB.user, { id: sameDayReqId, listingId, start: today, end: today }, { pool });
  await approveRentalRequest(userA.user, sameDayReqId, { pool });
  await assert.rejects(
    () => cancelRentalRequest(userB.user, sameDayReqId, { pool }),
    (err) => err.status === 409 && err.code === "CANCEL_WINDOW_PASSED"
  );
});

test("[PGlite 로컬 엔진] 5. 클라이언트 UUID 멱등성(4개 엔드포인트) 및 상태 전이 재시도 200·충돌 409", async () => {
  const today = kstToday();

  // 1) Listing creation idempotency
  const listId = randomUUID();
  const listPayload = {
    id: listId,
    type: "rent",
    modelId: "asia-amc900",
    title: "멱등성 테스트 매물",
    region: "입암면",
    cropIds: ["pepper"],
    operations: ["till"],
    price: 40000,
    areaMin: 200,
    areaMax: 800,
    condition: "good",
    inspectedAt: today,
  };
  const l1 = await createListing(userA.user, listPayload, { pool });
  const l2 = await createListing(userA.user, listPayload, { pool });
  assert.equal(l1.status, 201);
  assert.equal(l2.status, 200);
  assert.equal(l2.idempotent, true);

  await assert.rejects(
    () => createListing(userA.user, { ...listPayload, title: "다른 제목" }, { pool }),
    (err) => err.status === 409 && err.code === "IDEMPOTENCY_CONFLICT"
  );
  await assert.rejects(
    () => createListing(userB.user, listPayload, { pool }),
    (err) => err.status === 409 && err.code === "IDEMPOTENCY_CONFLICT"
  );

  // 2) Owned machine idempotency & partial unique is_selected
  const m1Id = randomUUID();
  const m2Id = randomUUID();
  const add1 = await addOwnedMachine(userB.user.id, { id: m1Id, modelId: "asia-amc900", name: "우리 관리기" }, { pool });
  const add1Retry = await addOwnedMachine(userB.user.id, { id: m1Id, modelId: "asia-amc900", name: "우리 관리기" }, { pool });
  assert.equal(add1.idempotent, false);
  assert.equal(add1Retry.idempotent, true);
  assert.equal(add1Retry.userData.ownedMachines.length, 1);

  await assert.rejects(
    () => addOwnedMachine(userB.user.id, { id: m1Id, modelId: "asia-amc900", name: "다른 이름" }, { pool }),
    (err) => err.status === 409 && err.code === "IDEMPOTENCY_CONFLICT"
  );
  await assert.rejects(
    () => addOwnedMachine(userC.user.id, { id: m1Id, modelId: "asia-amc900", name: "우리 관리기" }, { pool }),
    (err) => err.status === 409 && err.code === "IDEMPOTENCY_CONFLICT"
  );

  const add2 = await addOwnedMachine(userB.user.id, { id: m2Id, modelId: "daedong-dk450", name: "트랙터" }, { pool });
  assert.equal(add2.userData.selectedOwnedMachineId, m2Id);
  assert.equal(add2.userData.ownedMachines.filter((m) => m.isSelected).length, 1);

  // User C starts from 0 owned machines: Promise.all concurrent inserts + concurrent same-UUID retries
  const c1Id = randomUUID();
  const c2Id = randomUUID();
  const [c1Res, c2Res] = await Promise.all([
    addOwnedMachine(userC.user.id, { id: c1Id, modelId: "asia-amc900", name: "C관리기1" }, { pool }),
    addOwnedMachine(userC.user.id, { id: c2Id, modelId: "daedong-dk450", name: "C트랙터2" }, { pool }),
  ]);
  assert.equal(c1Res.idempotent, false);
  assert.equal(c2Res.idempotent, false);
  const cRetryPair = await Promise.all([
    addOwnedMachine(userC.user.id, { id: c1Id, modelId: "asia-amc900", name: "C관리기1" }, { pool }),
    addOwnedMachine(userC.user.id, { id: c1Id, modelId: "asia-amc900", name: "C관리기1" }, { pool }),
  ]);
  assert.ok(cRetryPair.every((r) => r.idempotent === true));
  assert.equal(cRetryPair[1].userData.ownedMachines.length, 2);
  assert.equal(cRetryPair[1].userData.ownedMachines.filter((m) => m.isSelected).length, 1);

  // 3) Rental request idempotency & transition retry idempotency
  const reqId = randomUUID();
  const rStart = shiftDate(today, 10);
  const rEnd = shiftDate(today, 11);
  const rq1 = await createRentalRequest(userB.user, { id: reqId, listingId: listId, start: rStart, end: rEnd, note: "테스트" }, { pool });
  const rq2 = await createRentalRequest(userB.user, { id: reqId, listingId: listId, start: rStart, end: rEnd, note: "테스트" }, { pool });
  assert.equal(rq1.status, 201);
  assert.equal(rq2.status, 200);
  assert.equal(rq2.idempotent, true);

  await assert.rejects(
    () => createRentalRequest(userC.user, { id: reqId, listingId: listId, start: rStart, end: rEnd, note: "테스트" }, { pool }),
    (err) => err.status === 409 && err.code === "IDEMPOTENCY_CONFLICT"
  );

  const ap1 = await approveRentalRequest(userA.user, reqId, { pool });
  const ap2 = await approveRentalRequest(userA.user, reqId, { pool });
  assert.equal(ap1.idempotent, false);
  assert.equal(ap2.idempotent, true);

  const reqRejectId = randomUUID();
  await createRentalRequest(userC.user, { id: reqRejectId, listingId: listId, start: shiftDate(today, 14), end: shiftDate(today, 15) }, { pool });
  const rj1 = await rejectRentalRequest(userA.user, reqRejectId, { pool });
  const rj2 = await rejectRentalRequest(userA.user, reqRejectId, { pool });
  assert.equal(rj1.idempotent, false);
  assert.equal(rj2.idempotent, true);

  // 4) Chat message idempotency
  const msgId = randomUUID();
  const mSend1 = await sendMessage(userB.user, { id: msgId, listingId: listId, body: "인수 시간 문의합니다" }, { pool });
  const mSend2 = await sendMessage(userB.user, { id: msgId, listingId: listId, body: "인수 시간 문의합니다" }, { pool });
  assert.equal(mSend1.status, 201);
  assert.equal(mSend2.status, 200);
  assert.equal(mSend2.idempotent, true);
  assert.equal(mSend1.message.seq, mSend2.message.seq);

  await assert.rejects(
    () => sendMessage(userB.user, { id: msgId, listingId: listId, body: "변조된 메시지" }, { pool }),
    (err) => err.status === 409 && err.code === "IDEMPOTENCY_CONFLICT"
  );
  await assert.rejects(
    () => sendMessage(userC.user, { id: msgId, listingId: listId, body: "인수 시간 문의합니다" }, { pool }),
    (err) => err.status === 409 && err.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("[PGlite 로컬 엔진] 6. A/B/C 다중 사용자 권한 분리, 1:1 대화 격리 및 seq 순서·페이지네이션", async () => {
  const listId = randomUUID();
  await createListing(userA.user, {
    id: listId,
    type: "sale",
    brand: "대동",
    machineType: "tractor",
    title: "사용자 격리 및 채팅 순서 매물",
    region: "수비면",
    cropIds: ["rice"],
    operations: ["level"],
    price: 12000000,
    areaMin: 1000,
    areaMax: 5000,
    condition: "used",
    inspectedAt: kstToday(),
  }, { pool });

  // Non-owner cannot edit/remove
  const editByB = await apiReq(baseUrl, "/api/listings", {
    method: "POST",
    cookie: userB.cookie,
    json: { action: "status", id: listId, status: "done" },
  });
  assert.equal(editByB.status, 403);

  // Self-inquiry forbidden for owner without conversationId
  await assert.rejects(
    () => sendMessage(userA.user, { id: randomUUID(), listingId: listId, body: "셀프 문의" }, { pool }),
    (err) => err.status === 403 && err.code === "SELF_INQUIRY_FORBIDDEN"
  );

  // Buyer B starts conversation with Owner A
  const firstMsg = await sendMessage(userB.user, { id: randomUUID(), listingId: listId, body: "직거래 가능할까요?" }, { pool });
  const convId = firstMsg.conversation.id;

  // Third party C cannot read or post in A<->B conversation
  const readByC = await apiReq(baseUrl, `/api/conversations?conversationId=${encodeURIComponent(convId)}`, {
    cookie: userC.cookie,
  });
  assert.equal(readByC.status, 403);

  const sendByC = await apiReq(baseUrl, "/api/conversations", {
    method: "POST",
    cookie: userC.cookie,
    json: { action: "send", id: randomUUID(), conversationId: convId, body: "제3자 침입" },
  });
  assert.equal(sendByC.status, 403);

  // Concurrent writes on the same conversation serialize seq cleanly without gaps or duplicates
  const batch = await Promise.all([
    sendMessage(userA.user, { id: randomUUID(), conversationId: convId, body: "msg-2" }, { pool }),
    sendMessage(userB.user, { id: randomUUID(), conversationId: convId, body: "msg-3" }, { pool }),
    sendMessage(userA.user, { id: randomUUID(), conversationId: convId, body: "msg-4" }, { pool }),
    sendMessage(userB.user, { id: randomUUID(), conversationId: convId, body: "msg-5" }, { pool }),
  ]);
  const seqs = batch.map((r) => r.message.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, [2, 3, 4, 5]);

  // Pagination: initial limit 2 gets [4, 5] with hasMoreOlder=true; before_seq=4 limit 2 gets [2, 3]
  const pageLatest = await getConversationMessages(userB.user.id, { conversationId: convId, limit: 2, pool });
  assert.deepEqual(pageLatest.messages.map((m) => m.seq), [4, 5]);
  assert.equal(pageLatest.hasMoreOlder, true);

  const pageOlder = await getConversationMessages(userB.user.id, {
    conversationId: convId,
    beforeSeq: 4,
    limit: 2,
    pool,
  });
  assert.deepEqual(pageOlder.messages.map((m) => m.seq), [2, 3]);
  assert.equal(pageOlder.hasMoreOlder, true);

  const pageOldest = await getConversationMessages(userB.user.id, {
    conversationId: convId,
    beforeSeq: 2,
    limit: 2,
    pool,
  });
  assert.deepEqual(pageOldest.messages.map((m) => m.seq), [1]);
  assert.equal(pageOldest.hasMoreOlder, false);

  // Forward polling with after_seq never misses seq
  const poll1 = await getConversationMessages(userB.user.id, { conversationId: convId, afterSeq: 2, pool });
  assert.deepEqual(poll1.messages.map((m) => m.seq), [3, 4, 5]);
});

test("[PGlite 로컬 엔진] 7. 대여 기간 상한·BIGINT 합계, 오류 분류, 호출 제한(429·Retry-After)", async () => {
  const today = kstToday();
  const start = shiftDate(today, 10);

  // --- 대여 기간 상한 및 합계 오버플로 방지 ---
  const listingId = randomUUID();
  const created = await createListing(userA.user, {
    id: listingId,
    type: "rent",
    modelId: "asia-amc900",
    title: "기간 상한 테스트 관리기",
    region: "청기면",
    cropIds: ["pepper"],
    operations: ["ridge"],
    price: 500_000_000,
    areaMin: 200,
    areaMax: 1000,
    condition: "good",
    inspectedAt: today,
  }, { pool });
  assert.equal(created.status, 201);

  await assert.rejects(
    () => createRentalRequest(userB.user, { id: randomUUID(), listingId, start, end: shiftDate(start, MAX_RENTAL_DAYS) }, { pool }),
    (err) => err.status === 400 && err.code === "RENTAL_PERIOD_TOO_LONG"
  );
  await assert.rejects(
    () => createRentalRequest(userB.user, { id: randomUUID(), listingId, start, end: "9999-12-31" }, { pool }),
    (err) => err.status === 400 && err.code === "RENTAL_PERIOD_TOO_LONG"
  );

  const maxReq = await createRentalRequest(
    userB.user,
    { id: randomUUID(), listingId, start, end: shiftDate(start, MAX_RENTAL_DAYS - 1) },
    { pool }
  );
  assert.equal(maxReq.status, 201);
  assert.equal(maxReq.request.days, MAX_RENTAL_DAYS);
  assert.equal(maxReq.request.totalPrice, 500_000_000 * MAX_RENTAL_DAYS, "INTEGER 범위를 넘는 합계도 저장된다");

  // DB 제약이 서버 검증과 별개로 상한과 일수 일관성을 지킨다
  await assert.rejects(
    () => pool.query(
      `INSERT INTO rental_requests (id, listing_id, requester_id, start_date, end_date, daily_price, days, total_price)
       VALUES ($1, $2, $3, $4::date, $5::date, 1000, 400, 400000)`,
      [randomUUID(), listingId, userB.user.id, start, shiftDate(start, 399)]
    ),
    (err) => err?.code === "23514"
  );
  await assert.rejects(
    () => pool.query(
      `INSERT INTO rental_requests (id, listing_id, requester_id, start_date, end_date, daily_price, days, total_price)
       VALUES ($1, $2, $3, $4::date, $5::date, 1000, 5, 5000)`,
      [randomUUID(), listingId, userB.user.id, start, shiftDate(start, 1)]
    ),
    (err) => err?.code === "23514"
  );

  // --- 예상하지 못한 오류 분류: 일시적 오류만 503 ---
  const pgError = (code) => Object.assign(new Error("db"), { code });
  assert.equal(classifyError(pgError("22003")).status, 400);
  assert.equal(classifyError(pgError("23514")).status, 400);
  assert.equal(classifyError(pgError("23503")).status, 409);
  assert.equal(classifyError(pgError("40P01")).status, 503);
  assert.equal(classifyError(pgError("55P03")).status, 503);
  assert.equal(classifyError(pgError("57014")).status, 503);
  assert.equal(classifyError(pgError("ECONNRESET")).status, 503);
  assert.equal(classifyError(new Error("timeout exceeded when trying to connect")).status, 503);
  assert.deepEqual(
    [classifyError(new TypeError("x is not a function")).status, classifyError(new TypeError("x")).code],
    [500, "SERVER_ERROR"]
  );

  // --- 호출 제한: 저장소(rate_limits 테이블) 기반 카운트 ---
  const fakeReq = (ip) => ({ headers: {}, socket: { remoteAddress: ip } });
  const policies = {
    probe: {
      failOpen: false,
      limits: [
        { scope: "client", name: "minute", window: 60_000, offset: 0, max: 2 },
        { scope: "all", name: "day", window: 86_400_000, offset: 9 * 3_600_000, max: 4 },
      ],
    },
    soft: { failOpen: true, limits: [{ scope: "client", name: "minute", window: 60_000, offset: 0, max: 1 }] },
  };
  const now = Date.UTC(2026, 10, 7, 12, 0, 30);
  const opts = { env: {}, now, pool, policies };

  assert.equal((await checkRateLimit(fakeReq("198.51.100.1"), "probe", opts)).allowed, true);
  assert.equal((await checkRateLimit(fakeReq("198.51.100.1"), "probe", opts)).allowed, true);
  assert.deepEqual(await checkRateLimit(fakeReq("198.51.100.1"), "probe", opts), { allowed: false, retryAfter: 30 });
  // 차단된 요청을 계속 보내도 전체 한도는 소진되지 않는다
  for (let i = 0; i < 5; i += 1) await checkRateLimit(fakeReq("198.51.100.1"), "probe", opts);
  assert.equal((await checkRateLimit(fakeReq("198.51.100.2"), "probe", opts)).allowed, true, "다른 IP는 따로 센다");
  assert.equal((await checkRateLimit(fakeReq("198.51.100.1"), "probe", { ...opts, userId: "user-x" })).allowed, true, "로그인 사용자는 계정 단위로 센다");
  assert.equal((await checkRateLimit(fakeReq("198.51.100.3"), "probe", opts)).allowed, false, "전체 한도 4회 초과 시 차단");
  assert.equal(
    (await checkRateLimit(fakeReq("198.51.100.1"), "probe", { ...opts, now: now + 86_400_000 })).allowed,
    true,
    "다음 창에서는 초기화된다"
  );

  const stored = await pool.query("SELECT key FROM rate_limits WHERE key LIKE 'probe:%'");
  assert.ok(stored.rows.length > 0);
  assert.ok(stored.rows.every((row) => !row.key.includes("198.51.100")), "원래 IP를 저장하지 않는다");

  // 저장소 장애: 추천(fail-closed)은 503, 쓰기 정책(fail-open)은 통과
  const brokenPool = { query: async () => { throw new Error("db down"); } };
  await assert.rejects(
    () => enforceRateLimit(fakeReq("198.51.100.9"), "probe", { ...opts, pool: brokenPool }),
    (err) => err.status === 503 && err.code === "RATE_LIMIT_UNAVAILABLE"
  );
  await enforceRateLimit(fakeReq("198.51.100.9"), "soft", { ...opts, pool: brokenPool });

  // --- HTTP 경로: /api/recommend 429 + Retry-After ---
  const prev = {
    ENABLE_RATE_LIMIT: process.env.ENABLE_RATE_LIMIT,
    RECOMMEND_LIMIT_PER_MINUTE: process.env.RECOMMEND_LIMIT_PER_MINUTE,
  };
  process.env.ENABLE_RATE_LIMIT = "1";
  process.env.RECOMMEND_LIMIT_PER_MINUTE = "2";
  try {
    const call = () => apiReq(baseUrl, "/api/recommend", {
      method: "POST",
      json: { message: "멀칭이 뭐야?", context: { draft: "멀칭은 두둑에 비닐을 덮는 작업입니다." } },
    });
    let limited = null;
    // 분 경계를 넘더라도 3회 연속 호출이 한 창에 들어가도록 여유 있게 반복한다
    for (let i = 0; i < 6 && !limited; i += 1) {
      const res = await call();
      if (res.status === 429) limited = res;
      else assert.equal(res.status, 200);
    }
    assert.ok(limited, "분당 한도 2회를 넘으면 429");
    assert.equal(limited.body.code, "TOO_MANY_REQUESTS");
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("[PGlite 로컬 엔진] 8. 농농이 에이전트: 승인한 대여 요청만 로그인 사용자로 실행하고 실제 상태로 결과를 분류", async () => {
  const today = kstToday();
  const start = shiftDate(today, 10);
  const end = shiftDate(today, 12);
  const listingId = randomUUID();
  const created = await createListing(userA.user, {
    id: listingId,
    type: "rent",
    modelId: "asia-amc900",
    title: "농농이 승인 테스트 관리기",
    region: "청기면",
    cropIds: ["pepper"],
    operations: ["ridge"],
    price: 40000,
    areaMin: 200,
    areaMax: 1000,
    condition: "good",
    inspectedAt: today,
  }, { pool });
  assert.equal(created.status, 201);
  const pendingAction = { type: "rental_request", listingId, start, end, note: "농농이로 요청" };

  // AI 키가 없으면 대화는 규칙 기반 상담으로 넘긴다
  const prevKeys = { ZAI_API_KEY: process.env.ZAI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  delete process.env.ZAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const chat = await apiReq(baseUrl, "/api/agent", { method: "POST", json: { message: "고추 두둑 빌릴래요" } });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.mode, "unavailable");

    // 사진만 보내도(질문 없음) 400이 아니다
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 120, b: 60 } } }).png().toBuffer();
    const photoOnly = await apiReq(baseUrl, "/api/agent", { method: "POST", json: { message: "", image: `data:image/png;base64,${png.toString("base64")}` } });
    assert.equal(photoOnly.status, 200, JSON.stringify(photoOnly.body));
    assert.equal(photoOnly.body.mode, "unavailable");

    // HEIC 등 지원하지 않는 사진은 친절한 400
    const heic = await apiReq(baseUrl, "/api/agent", { method: "POST", json: { message: "이거 뭐예요", image: "data:image/heic;base64,AAAAGGZ0eXBoZWlj" } });
    assert.equal(heic.status, 400);
    assert.equal(heic.body.code, "INVALID_PHOTO");
    assert.match(heic.body.error, /JPG·PNG·WebP/);

    // 사진도 질문도 없으면 400
    const empty = await apiReq(baseUrl, "/api/agent", { method: "POST", json: { message: "" } });
    assert.equal(empty.status, 400);

    // [리뷰] 사진 디코딩보다 호출 제한을 먼저 검사한다(디코딩 비용을 횟수에 넣음)
    const prevLimit = { ENABLE_RATE_LIMIT: process.env.ENABLE_RATE_LIMIT, RECOMMEND_LIMIT_PER_MINUTE: process.env.RECOMMEND_LIMIT_PER_MINUTE };
    process.env.ENABLE_RATE_LIMIT = "1";
    process.env.RECOMMEND_LIMIT_PER_MINUTE = "1";
    try {
      const statuses = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await apiReq(baseUrl, "/api/agent", { method: "POST", json: { message: "x", image: "data:image/heic;base64,AAAAGGZ0eXBoZWlj" } });
        statuses.push(res.status);
      }
      assert.ok(statuses.includes(429), `호출 제한이 사진 검사보다 먼저여야 함: ${statuses}`);
    } finally {
      for (const [k, v] of Object.entries(prevLimit)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  } finally {
    for (const [k, v] of Object.entries(prevKeys)) if (v !== undefined) process.env[k] = v;
  }

  // 로그인하지 않으면 실행하지 않는다
  const anonymous = await apiReq(baseUrl, "/api/agent", {
    method: "POST",
    json: { action: "execute", pendingAction, requestId: randomUUID() },
  });
  assert.equal(anonymous.status, 401);

  // 잘못된 요청 형식은 거절한다
  const badAction = await apiReq(baseUrl, "/api/agent", {
    method: "POST",
    cookie: userB.cookie,
    json: { action: "execute", pendingAction: { ...pendingAction, type: "delete_listing" }, requestId: randomUUID() },
  });
  assert.equal(badAction.status, 400);

  // 승인된 요청은 실행 후 저장 상태를 다시 확인해 completed로 안내한다
  const requestId = randomUUID();
  const done = await apiReq(baseUrl, "/api/agent", {
    method: "POST",
    cookie: userB.cookie,
    json: { action: "execute", pendingAction, requestId },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.outcome, "completed");
  assert.equal(done.body.request.id, requestId);
  assert.equal(done.body.request.status, "pending");
  const { outgoing } = await listRequestsForUser(userB.user.id, { pool });
  assert.ok(outgoing.some((item) => item.id === requestId && item.listingId === listingId));

  // 같은 요청 ID로 다시 눌러도 중복 생성하지 않는다
  const retry = await apiReq(baseUrl, "/api/agent", {
    method: "POST",
    cookie: userB.cookie,
    json: { action: "execute", pendingAction, requestId },
  });
  assert.equal(retry.body.outcome, "completed");
  assert.equal(retry.body.idempotent, true);

  // 서비스 규칙에 막히면 failed와 이유를 안내한다(본인 매물)
  const selfRental = await apiReq(baseUrl, "/api/agent", {
    method: "POST",
    cookie: userA.cookie,
    json: { action: "execute", pendingAction, requestId: randomUUID() },
  });
  assert.equal(selfRental.status, 200);
  assert.equal(selfRental.body.outcome, "failed");
  assert.equal(selfRental.body.code, "SELF_RENTAL_FORBIDDEN");
});

test("[PGlite 로컬 엔진] 9. 초안 사진 저장과 draftPhotoKey 등록", async () => {
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();
  const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;

  const draft = await saveDraftPhoto(userB.user, dataUrl);
  assert.match(draft.listingId, /^[0-9a-f-]{36}$/);
  assert.ok(draft.photoKey.startsWith(`listings/${draft.listingId}/`));
  assert.equal(draft.photoUrl, `/api/photos?key=${encodeURIComponent(draft.photoKey)}`);
  assert.ok(await getPhotoObject(draft.photoKey), "초안 사진이 저장소에 있어야 한다");

  const today = kstToday();
  const fields = {
    type: "sale", modelId: "asia-amc900", title: "농농이 초안 관리기", region: "청기면",
    cropIds: ["pepper"], operations: ["ridge"], price: 1200000, areaMin: 200, areaMax: 1000,
    condition: "good", inspectedAt: today, description: "농농이가 쓴 소개글",
  };

  const created = await createListing(userB.user, { id: draft.listingId, ...fields, draftPhotoKey: draft.photoKey }, { pool });
  assert.equal(created.status, 201);
  assert.equal(created.listing.photoKey, draft.photoKey);
  const objects = (await listPhotoObjects()).filter((obj) => obj.key.startsWith(`listings/${draft.listingId}/`));
  assert.equal(objects.length, 1, "새로 업로드하지 않고 초안 키를 그대로 쓴다");

  await assert.rejects(
    () => createListing(userB.user, { id: randomUUID(), ...fields, draftPhotoKey: draft.photoKey }, { pool }),
    (err) => err.status === 400 && err.code === "INVALID_DRAFT_PHOTO",
  );
  const otherId = randomUUID();
  await assert.rejects(
    () => createListing(userB.user, { id: otherId, ...fields, draftPhotoKey: `listings/${otherId}/${randomUUID()}.webp` }, { pool }),
    (err) => err.status === 400 && err.code === "INVALID_DRAFT_PHOTO",
  );
  await assert.rejects(() => saveDraftPhoto(null, dataUrl), (err) => err.status === 401);
});

test("[PGlite 로컬 엔진] 10. /api/agent 원탭 구매 신청 및 원탭 매물 등록 실행", async () => {
  const today = kstToday();
  const createdSale = await createListing(userA.user, {
    id: randomUUID(),
    type: "sale",
    title: "원탭 구매 테스트 트랙터",
    brand: "대동",
    machineType: "tractor",
    cropIds: ["pepper"],
    operations: ["till"],
    price: 5200000,
    region: "영양읍",
    areaMin: 300,
    areaMax: 2000,
    condition: "good",
    inspectedAt: today,
  }, { pool });
  assert.equal(createdSale.status, 201);
  const targetSaleId = createdSale.listing.id;

  const buyReqId = randomUUID();
  const buyRes = await apiReq(baseUrl, "/api/agent", {
    method: "POST",
    cookie: userB.cookie,
    json: {
      action: "execute",
      requestId: buyReqId,
      pendingAction: { type: "purchase_request", listingId: targetSaleId },
    },
  });
  assert.equal(buyRes.status, 200, JSON.stringify(buyRes.body));
  assert.equal(buyRes.body.outcome, "completed");
  assert.equal(buyRes.body.reservation.kind, "purchase");
  assert.equal(buyRes.body.reservation.listingId, targetSaleId);

  const listReqId = randomUUID();
  const listRes = await apiReq(baseUrl, "/api/agent", {
    method: "POST",
    cookie: userB.cookie,
    json: {
      action: "execute",
      requestId: listReqId,
      pendingAction: {
        type: "create_listing",
        listingType: "sale",
        machineType: "cultivator",
        title: "원탭 등록 관리기",
        price: 1550000,
        region: "청기면",
        description: "연식: 2021년식",
      },
    },
  });
  assert.equal(listRes.status, 200, JSON.stringify(listRes.body));
  assert.equal(listRes.body.outcome, "completed");
  assert.equal(listRes.body.createdListing.title, "원탭 등록 관리기");
  assert.equal(listRes.body.listing.type, "sale");
});

test("[PGlite 로컬 엔진] 11. 농농이 음성 인식: 기능 확인, WAV 검증, 공급자 없음 503, 호출 제한", async (t) => {
  const keys = ["VOICE_STT_PROVIDER", "OPENAI_API_KEY", "ZAI_API_KEY", "ENABLE_RATE_LIMIT", "VOICE_LIMIT_PER_MINUTE"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  for (const k of keys) delete process.env[k];

  const wav = (seconds) => {
    const dataBytes = Math.round(seconds * 16000) * 2;
    const b = Buffer.alloc(44 + dataBytes);
    b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + dataBytes, 4); b.write("WAVE", 8, "ascii");
    b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
    b.write("data", 36, "ascii"); b.writeUInt32LE(dataBytes, 40);
    return b.toString("base64");
  };

  // 키가 없으면 서버 인식이 없다고 알려 주고(브라우저 인식으로), 인식 요청은 503
  const viaRewrite = await apiReq(baseUrl, "/api/agent?route=voice");
  assert.equal(viaRewrite.status, 200);
  assert.deepEqual(viaRewrite.body, { serverStt: false, provider: null, maxSeconds: 30, liveAvailable: false, liveModel: "gpt-live-1", liveVoice: "noeul" });
  const caps = await apiReq(baseUrl, "/api/voice");
  assert.equal(caps.status, 200);
  assert.deepEqual(caps.body, { serverStt: false, provider: null, maxSeconds: 30, liveAvailable: false, liveModel: "gpt-live-1", liveVoice: "noeul" });
  const none = await apiReq(baseUrl, "/api/voice", { method: "POST", json: { audio: wav(1) } });
  assert.equal(none.status, 503);
  assert.equal(none.body.code, "VOICE_UNAVAILABLE");

  process.env.OPENAI_API_KEY = "okey";
  // 형식이 틀리면 공급자를 부르지 않고 400
  const realFetch = globalThis.fetch;
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).startsWith("https://api.openai.com/")) {
      providerCalls += 1;
      return Response.json({ text: "관리기 빌릴라꼬예" });
    }
    return realFetch(url, init);
  });
  const bad = await apiReq(baseUrl, "/api/voice", { method: "POST", json: { audio: Buffer.from("hello").toString("base64") } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "INVALID_AUDIO");
  const long = await apiReq(baseUrl, "/api/voice", { method: "POST", json: { audio: wav(31) } });
  assert.equal(long.status, 413);
  const missing = await apiReq(baseUrl, "/api/voice", { method: "POST", json: {} });
  assert.equal(missing.status, 400);
  assert.equal(providerCalls, 0);

  const ok = await apiReq(baseUrl, "/api/voice", { method: "POST", json: { audio: wav(2) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { text: "관리기 빌릴라꼬예", provider: "openai" });
  assert.equal(providerCalls, 1);

  // 호출 제한은 음성 해석 전에 검사한다
  process.env.ENABLE_RATE_LIMIT = "1";
  process.env.VOICE_LIMIT_PER_MINUTE = "1";
  const statuses = [];
  for (let i = 0; i < 4; i += 1) {
    statuses.push((await apiReq(baseUrl, "/api/voice", { method: "POST", json: { audio: "not-base64-audio" } })).status);
  }
  assert.ok(statuses.includes(429), `호출 제한: ${statuses}`);
});
