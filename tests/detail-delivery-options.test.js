// 매물 상세 '받는 방법' & '옵션' 목업 구현 및 서버 검증·영속성·브라우저 E2E 테스트
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { resetAuthCache } from "../server/account-auth.js";
import { createOrder } from "../server/cart-orders.js";
import { closePool, getPool, kstToday, setPool } from "../server/db.js";
import { buildMockListings } from "../server/listing-seed.js";
import { fetchListingById } from "../server/listings-db.js";
import { createListing } from "../server/listings-service.js";
import { seedDemoListings } from "../server/migrator.js";
import { createRentalRequest, listRequestsForUser } from "../server/rentals.js";
import { runtime } from "../src/core/store.js";
import { buildDetailRentalOptions, calculateRentalQuote } from "../src/data/rental-options.js";
import { ensureHongcheonRandomListing } from "../src/views/map-weather.js";
import { openFavoriteDetail, seedGuestFavorites, signupOnLoginView } from "./helpers/nav.js";

const DEMO_ID = "hc-vivaldi-1";
const OTHER_RENT_ID = "r1";

function shiftDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

let tempDir;
let server;
let baseUrl;
let browser;
let prevEnv = {};

before(async () => {
  prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    APP_ENV: process.env.APP_ENV,
    MOA_LOCAL_DB: process.env.MOA_LOCAL_DB,
    OBJECT_STORAGE_DIR: process.env.OBJECT_STORAGE_DIR,
  };
  tempDir = await mkdtemp(join(tmpdir(), "moa-detail-opts-"));
  delete process.env.DATABASE_URL;
  process.env.APP_ENV = "test";
  process.env.MOA_LOCAL_DB = join(tempDir, "pglite");
  process.env.OBJECT_STORAGE_DIR = join(tempDir, "objects");
  await closePool().catch(() => {});
  setPool(undefined);
  resetAuthCache();

  const { createAppServer } = await import("../dev-server.js");
  server = await createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

after(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  await closePool().catch(() => {});
  setPool(undefined);
  resetAuthCache();
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("정적 시드와 오프라인 대체 경로에서 예시 대여 매물(hc-vivaldi-1)만 배달 +2만원과 5개 옵션 카드를 제공한다", () => {
  const listings = buildMockListings();
  const demo = listings.find((l) => l.id === DEMO_ID);
  assert.ok(demo, "hc-vivaldi-1 시드가 있어야 함");
  assert.deepEqual(demo.delivery.methods, ["owner_delivery", "self_pickup"]);
  assert.equal(demo.delivery.fee, 20000);
  assert.ok(demo.rentalOperator, "농작업 대행 제공");
  assert.deepEqual(demo.rentalOptions.map((o) => o.id), ["ridger", "fuel", "care"]);

  const detailOpts = buildDetailRentalOptions(demo);
  assert.deepEqual(
    detailOpts.map((o) => [o.id, o.t, o.unit, o.per]),
    [
      ["work", "농작업 대행", 110000, "day"],
      ["ridger", "두둑 성형기 같이 빌리기", 10000, "day"],
      ["lesson", "처음 쓰는 법 알려 주기", 0, "once"],
      ["fuel", "연료 가득 채워 받기", 30000, "once"],
      ["care", "고장 걱정 없는 안심 보장", 5000, "day"],
    ],
  );

  // 다른 시드 매물은 데모 추가 옵션을 기본 노출하지 않고 자기 운송 방식을 유지한다
  const othersWithAddons = listings.filter((l) => l.id !== DEMO_ID && (l.rentalOptions || []).length > 0);
  assert.equal(othersWithAddons.length, 0);
  const r1 = listings.find((l) => l.id === OTHER_RENT_ID);
  assert.deepEqual(r1.delivery.methods, ["self_pickup"]);
  assert.equal(r1.delivery.fee, null);
  const r1Opts = buildDetailRentalOptions(r1);
  assert.deepEqual(r1Opts.map((o) => o.id), ["lesson"]);
  assert.equal(r1Opts[0].d, "받을 때 시동부터 작업까지 알려 달라고 소유주에게 부탁해요.");
  assert.equal(detailOpts.find((o) => o.id === "lesson")?.d, "받을 때 30분 동안 시동부터 작업까지 알려 드려요.");

  // 오프라인 정적 대체 매물 경로도 동일하게 동작한다
  runtime.catalog = [];
  const fallback = ensureHongcheonRandomListing({ randomize: false });
  assert.deepEqual(fallback.delivery.methods, ["owner_delivery", "self_pickup"]);
  assert.equal(fallback.delivery.fee, 20000);
  assert.equal(buildDetailRentalOptions(fallback).length, 5);
});

test("시드 DB·실제 등록 매물·서버 검증 및 견적 일관성(대여 요청·주문)", async () => {
  const pool = getPool();
  const seeded = await fetchListingById(DEMO_ID, { pool });
  assert.ok(seeded);
  assert.deepEqual(seeded.delivery.methods, ["owner_delivery", "self_pickup"]);
  assert.equal(seeded.delivery.fee, 20000);
  assert.equal(seeded.delivery.area, "서면·남면·홍천읍까지, 15km 안");
  assert.deepEqual(seeded.rentalOptions.map((o) => o.id), ["ridger", "fuel", "care"]);

  // 시드 재실행 시 기존 데모 매물 행이 새 배달비·범위·옵션으로 갱신되고, 변경 없을 때는 멱등(0건 갱신)이다
  await pool.query(
    `UPDATE listings SET delivery_fee = NULL, delivery_area = '', rental_options = '[]'::jsonb WHERE id = $1`,
    [DEMO_ID],
  );
  const reseeded = await seedDemoListings({ env: "test", pool });
  assert.equal(reseeded.inserted, 1);
  const afterReseed = await fetchListingById(DEMO_ID, { pool });
  assert.equal(afterReseed.delivery.fee, 20000);
  assert.equal(afterReseed.delivery.area, "서면·남면·홍천읍까지, 15km 안");
  assert.deepEqual(afterReseed.rentalOptions.map((o) => o.id), ["ridger", "fuel", "care"]);
  const idempotentSeed = await seedDemoListings({ env: "test", pool });
  assert.equal(idempotentSeed.inserted, 0);

  // 테스트용 사용자 2명 생성
  const ownerId = `owner_${randomUUID().slice(0, 8)}`;
  const renterId = `renter_${randomUUID().slice(0, 8)}`;
  for (const [id, name] of [[ownerId, "실매물소유자"], [renterId, "대여테스터"]]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, false, now(), now())`,
      [id, name, `${id}@example.test`],
    );
  }

  // 실제 사용자가 등록한 매물은 데모 옵션을 기본 광고하지 않는다
  const created = await createListing(
    { id: ownerId },
    {
      id: randomUUID(),
      type: "rent",
      title: "실제 사용자 트랙터",
      brand: "대동",
      machineType: "tractor",
      cropIds: ["potato"],
      operations: ["till"],
      areaMin: 500,
      areaMax: 5000,
      price: 100000,
      region: "춘천시",
      condition: "good",
      inspectedAt: kstToday(),
      delivery: { methods: ["self_pickup"], pickupPlace: "춘천시 신북읍 창고" },
    },
    { pool },
  );
  assert.deepEqual(created.listing.rentalOptions, []);
  assert.deepEqual(created.listing.delivery.methods, ["self_pickup"]);

  const start = shiftDate(kstToday(), 10);
  const end = shiftDate(kstToday(), 12); // 3일

  // 실매물에 데모 옵션이나 미지원 배달 방식을 넘기면 서버가 409로 거부한다
  await assert.rejects(
    () => createRentalRequest(
      { id: renterId },
      {
        id: randomUUID(),
        listingId: created.listing.id,
        start,
        end,
        deliveryMethod: "owner_delivery",
      },
      { pool },
    ),
    (err) => err.status === 409 && err.code === "DELIVERY_OPTION_CHANGED",
  );

  await assert.rejects(
    () => createRentalRequest(
      { id: renterId },
      {
        id: randomUUID(),
        listingId: created.listing.id,
        start,
        end,
        deliveryMethod: "self_pickup",
        rentalOptions: [{ id: "ridger", unitPrice: 10000, pricing: "per_day" }],
      },
      { pool },
    ),
    (err) => err.status === 409 && err.code === "RENTAL_OPTION_CHANGED",
  );

  // 예시 매물에서 옵션 가격이나 배달 요금을 변조해도 서버가 409로 거부한다
  await assert.rejects(
    () => createRentalRequest(
      { id: renterId },
      {
        id: randomUUID(),
        listingId: DEMO_ID,
        start,
        end,
        deliveryMethod: "owner_delivery",
        deliveryFee: 1000,
      },
      { pool },
    ),
    (err) => err.status === 409 && err.code === "DELIVERY_OPTION_CHANGED",
  );

  await assert.rejects(
    () => createRentalRequest(
      { id: renterId },
      {
        id: randomUUID(),
        listingId: DEMO_ID,
        start,
        end,
        deliveryMethod: "self_pickup",
        rentalOptions: [{ id: "fuel", unitPrice: 1000, pricing: "once" }],
      },
      { pool },
    ),
    (err) => err.status === 409 && err.code === "RENTAL_OPTION_CHANGED",
  );

  // 정상 요청: 3일 + 배달(+2만원) + 작업자(+11만원/일) + 3종 옵션(1만원/일 + 3만원 + 0.5만원/일)
  const expected = calculateRentalQuote({
    dailyPrice: seeded.price,
    days: 3,
    operatorDailyPrice: seeded.rentalOperator.dailyPrice,
    delivery: seeded.delivery,
    deliveryMethod: "owner_delivery",
    selectedOptions: seeded.rentalOptions,
  });
  assert.equal(expected.totalPrice, (130000 + 110000) * 3 + 20000 + (10000 * 3 + 30000 + 5000 * 3));

  const reqId = randomUUID();
  const res = await createRentalRequest(
    { id: renterId },
    {
      id: reqId,
      listingId: DEMO_ID,
      start,
      end,
      note: "받는 방법: 배달 받기",
      deliveryMethod: "owner_delivery",
      deliveryFee: 20000,
      rentalOperator: seeded.rentalOperator,
      rentalOptions: seeded.rentalOptions,
    },
    { pool },
  );
  assert.equal(res.status, 201);
  assert.equal(res.request.deliveryMethod, "owner_delivery");
  assert.equal(res.request.deliveryFee, 20000);
  assert.equal(res.request.optionsTotal, 75000);
  assert.equal(res.request.totalPrice, 815000);
  assert.deepEqual(res.request.rentalOptions.map((o) => o.id), ["ridger", "fuel", "care"]);

  const listed = await listRequestsForUser(renterId, { pool });
  const persisted = listed.outgoing.find((r) => r.id === reqId);
  assert.ok(persisted);
  assert.equal(persisted.deliveryMethod, "owner_delivery");
  assert.equal(persisted.deliveryFee, 20000);
  assert.equal(persisted.optionsTotal, 75000);
  assert.equal(persisted.totalPrice, 815000);

  // 주문(결제) 경로에서도 배달 선택 시 +2만원이 서버에서 반영된다
  const orderRes = await createOrder(
    renterId,
    {
      items: [{ listingId: DEMO_ID, startDate: start, endDate: end }],
      paymentMethod: "card",
      buyerName: "대여테스터",
      buyerPhone: "010-1234-5678",
      deliveryMethod: "delivery",
      deliveryAddress: "강원 홍천군 서면 팔봉리 123",
    },
    { pool },
  );
  assert.equal(orderRes.order.totalAmount, 130000 * 3 + 20000);
  assert.equal(orderRes.order.items[0].deliveryFee, 20000);
});

test("브라우저 E2E: 상세 화면에서 받는 방법·5개 옵션 선택 → 대여 요청 폼 금액 일치 → DB 영속성 확인", async () => {
  const startDate = shiftDate(kstToday(), 20);
  const endDate = shiftDate(kstToday(), 22); // 3일
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await seedGuestFavorites(page, [DEMO_ID, OTHER_RENT_ID]);
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 1) 일반 매물(r1): 자기 운송 방식·기존 문구만 보이고 데모 추가 옵션·예시 전용 문구는 보이지 않는다
    await openFavoriteDetail(page, OTHER_RENT_ID);
    const host = page.locator("#detailDesignHost");
    const r1SelfBtn = host.locator("button[data-opt]", { hasText: "직접 가지러 가기" });
    await r1SelfBtn.waitFor({ state: "visible" });
    assert.doesNotMatch(await r1SelfBtn.textContent(), /트럭이나 운반차/);
    assert.equal(await host.locator("text=받는 곳 (소유주 창고)").count(), 0);
    assert.equal(await host.locator("text=받는 곳 (소유주)").count(), 1);
    assert.equal(await host.locator("button[data-opt]", { hasText: "배달 받기" }).count(), 0);
    assert.equal(await host.locator("button[data-opt]", { hasText: "두둑 성형기 같이 빌리기" }).count(), 0);
    assert.equal(await host.locator("button[data-opt]", { hasText: "연료 가득 채워 받기" }).count(), 0);
    assert.equal(await host.locator("button[data-opt]", { hasText: "고장 걱정 없는 안심 보장" }).count(), 0);
    const r1LessonBtn = host.locator("button[data-opt]", { hasText: "처음 쓰는 법 알려 주기" });
    assert.equal(await r1LessonBtn.count(), 1);
    assert.match(await r1LessonBtn.textContent(), /부탁해요/);
    assert.doesNotMatch(await r1LessonBtn.textContent(), /30분/);

    // 2) 예시 대여 매물(hc-vivaldi-1): 받는 방법 2종 + 옵션 5종, 초기 선택은 명시적(기본 직접 가지러 가기, 옵션 미선택)
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await openFavoriteDetail(page, DEMO_ID);
    const selfBtn = host.locator("button[data-opt]", { hasText: "직접 가지러 가기" });
    const deliverBtn = host.locator("button[data-opt]", { hasText: "배달 받기" });
    await selfBtn.waitFor({ state: "visible" });
    await deliverBtn.waitFor({ state: "visible" });
    assert.match(await selfBtn.textContent(), /트럭이나 운반차가 필요해요/);
    assert.equal(await host.locator("text=받는 곳 (소유주 창고)").count(), 1);
    assert.match(await host.locator("button[data-opt]", { hasText: "처음 쓰는 법 알려 주기" }).textContent(), /30분 동안/);
    assert.equal(await selfBtn.getAttribute("aria-pressed"), "true");
    assert.equal(await deliverBtn.getAttribute("aria-pressed"), "false");
    assert.match(await deliverBtn.textContent(), /\+2만원/);

    const optTitles = [
      "농작업 대행",
      "두둑 성형기 같이 빌리기",
      "처음 쓰는 법 알려 주기",
      "연료 가득 채워 받기",
      "고장 걱정 없는 안심 보장",
    ];
    for (const title of optTitles) {
      const btn = host.locator("button[data-opt]", { hasText: title });
      assert.equal(await btn.count(), 1, `옵션 카드 '${title}'가 있어야 함`);
      assert.equal(await btn.getAttribute("aria-pressed"), "false", `초기 선택은 명시적이어야 함: ${title}`);
    }

    // 배달 받기(+2만원) + 3종 유료 옵션 + 무료 안내 선택 (1일 기준: 13 + 2 + 1 + 3 + 0.5 = 19.5만원)
    await deliverBtn.click();
    await host.locator("button[data-opt]", { hasText: "두둑 성형기 같이 빌리기" }).click();
    await host.locator("button[data-opt]", { hasText: "처음 쓰는 법 알려 주기" }).click();
    await host.locator("button[data-opt]", { hasText: "연료 가득 채워 받기" }).click();
    await host.locator("button[data-opt]", { hasText: "고장 걱정 없는 안심 보장" }).click();

    await host.locator("#bookingCard").getByText("총 19.5만원", { exact: true }).waitFor({ state: "visible" });

    // 대여 요청 보내기 → 회원가입 → 대여 폼 자동 복원
    await host.locator("a[data-cta]", { hasText: "대여 요청 보내기" }).click();
    await signupOnLoginView(page, { username: "detail_opt_renter", name: "옵션테스터" });

    await page.locator("#rentalForm").waitFor({ state: "visible" });
    assert.equal(await page.locator('#rentalForm input[name="rentDeliveryMethod"][value="owner_delivery"]').isChecked(), true);
    assert.equal(await page.locator("#rentOpt_ridger").isChecked(), true);
    assert.equal(await page.locator("#rentOpt_fuel").isChecked(), true);
    assert.equal(await page.locator("#rentOpt_care").isChecked(), true);

    await page.locator("#rentStart").fill(startDate);
    await page.locator("#rentEnd").fill(endDate);
    // 3일 합계: 130000*3 (390000) + 배달 20000 + 두둑 30000 + 연료 30000 + 안심보장 15000 = 485,000원
    const submitLabel = (await page.locator("#rentalSubmitButton").textContent()).replace(/\s/g, "");
    assert.match(submitLabel, /3일·485,000원/, submitLabel);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/requests") && r.request().method() === "POST"),
      page.locator("#rentalSubmitButton").click(),
    ]);
    assert.equal(response.status(), 201);
    const body = await response.json();
    assert.equal(body.request.deliveryMethod, "owner_delivery");
    assert.equal(body.request.deliveryFee, 20000);
    assert.equal(body.request.optionsTotal, 75000);
    assert.equal(body.request.totalPrice, 485000);
    assert.deepEqual(body.request.rentalOptions.map((o) => o.id), ["ridger", "fuel", "care"]);

    // DB 영속성 확인
    const { rows } = await getPool().query(
      `SELECT delivery_method, delivery_fee, options_total, total_price, rental_options
         FROM rental_requests WHERE id = $1`,
      [body.request.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].delivery_method, "owner_delivery");
    assert.equal(Number(rows[0].delivery_fee), 20000);
    assert.equal(Number(rows[0].options_total), 75000);
    assert.equal(Number(rows[0].total_price), 485000);
    assert.deepEqual(rows[0].rental_options.map((o) => o.id), ["ridger", "fuel", "care"]);

    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
