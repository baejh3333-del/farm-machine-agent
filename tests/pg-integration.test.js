import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";

import accountHandler from "../api/account.js";
import conversationsHandler from "../api/conversations.js";
import listingsHandler from "../api/listings.js";
import meHandler from "../api/me.js";
import photosHandler from "../api/photos.js";
import recommendHandler from "../api/recommend.js";
import requestsHandler from "../api/requests.js";
import { resetAuthCache } from "../server/account-auth.js";
import { recommend } from "../server/agent.js";
import { getConversationMessages, sendMessage } from "../server/chat.js";
import { createPglitePool, kstToday, setPool } from "../server/db.js";
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
  rejectRentalRequest,
} from "../server/rentals.js";
import { listPhotoObjects, newListingPhotoKey, putPhotoObject, reconcilePhotos } from "../server/storage.js";
import { addOwnedMachine } from "../server/user-data.js";

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

test("1. 명시적 마이그레이션, 체크섬 검증, 환경 마커 가드 및 btree_gist/user.id 확인", async () => {
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
  assert.deepEqual(migRes.applied, ["0001_initial_schema.sql"]);

  const info = await inspectDatabase({ pool });
  assert.equal(info.environment, "test");
  assert.equal(info.userIdType, "text");
  assert.equal(info.btreeGistInstalled, true);
  assert.equal(info.writesFrozen, false);

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

  // Seed test DB and confirm 100 demo items in PostgreSQL + live recommend uses PG
  const seedRes = await seedDemoListings({ env: "test", pool });
  assert.equal(seedRes.inserted, 100);

  const rec = await recommend("고추 두둑 대여", { maxPrice: 70000 }, { pool });
  assert.ok(rec.listingIds.length > 0);
  const pgListings = await fetchListings({ pool });
  assert.equal(pgListings.length, 100);
});

test("2. 회원가입 및 A/B/C 계정 세션, write-freeze 503 차단 및 복구", async () => {
  userA = await signupHttp(baseUrl, "farmer_a", "농부A");
  userB = await signupHttp(baseUrl, "farmer_b", "농부B");
  userC = await signupHttp(baseUrl, "farmer_c", "농부C");

  // Enable write freeze and always unfreeze in finally so subsequent tests aren't affected
  await setWritesFrozen({ env: "test", frozen: true, pool });
  try {
    // Reads remain available
    const getListings = await apiReq(baseUrl, "/api/listings");
    assert.equal(getListings.status, 200);
    assert.equal(getListings.body.listings.length, 100);

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

test("3. 서버 이미지 검증·EXIF 제거·교체/실패 정리 및 reconcile 고아 객체 정리", async () => {
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

test("4. 동시 중복 대여 승인 레이스, GiST 배타 제약, KST 날짜 경계, 취소·재승인 및 활성 예약 보호", async () => {
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

test("5. 클라이언트 UUID 멱등성(4개 엔드포인트) 및 상태 전이 재시도 200·충돌 409", async () => {
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

test("6. A/B/C 다중 사용자 권한 분리, 1:1 대화 격리 및 seq 순서·페이지네이션", async () => {
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
