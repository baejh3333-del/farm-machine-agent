import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { resetAuthCache } from "../server/account-auth.js";
import { createPglitePool, kstToday, setPool } from "../server/db.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";
import { executeRentalRequest, rentalTermsMessage, rentalTermsOf } from "../server/nongnong-agent.js";

function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let pool;
let owner;
let renter;
let rentListing;

before(async () => {
  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });

  owner = { id: "user_terms_owner", name: "김소유", role: "user" };
  renter = { id: "user_terms_renter", name: "이대여", role: "user" };
  for (const u of [owner, renter]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified")
       VALUES ($1, $2, $3, true)`,
      [u.id, u.name, `${u.id}@example.com`],
    );
  }

  rentListing = (await createListing(owner, {
    id: randomUUID(),
    title: "관리기 A",
    type: "rent",
    price: 50_000,
    region: "영양읍",
    machineType: "rootHarvester",
    cropIds: ["sweetPotato"],
    operations: ["potatoHarvest"],
    areaMin: 300,
    areaMax: 2000,
    condition: "good",
    brand: "아세아텍",
    description: "관리기 대여합니다.",
  }, { pool })).listing;
});

after(async () => {
  await pool?.end();
  setPool(undefined);
});

test("rentalTermsOf: 조건이 없으면 null, 유효한 희망가·대리운용 여부를 정리한다", () => {
  assert.equal(rentalTermsOf({}), null);
  assert.equal(rentalTermsOf({ negotiatedDailyPrice: 0 }), null);
  assert.equal(rentalTermsOf({ negotiatedDailyPrice: -1000 }), null);
  assert.equal(rentalTermsOf({ negotiatedDailyPrice: 12.5 }), null);
  assert.deepEqual(
    rentalTermsOf({ negotiatedDailyPrice: 40_000, operatorWanted: true }),
    { negotiatedDailyPrice: 40_000, operatorWanted: true },
  );
  assert.deepEqual(
    rentalTermsOf({ negotiatedDailyPrice: null, operatorWanted: false }),
    { negotiatedDailyPrice: null, operatorWanted: false },
  );
});

test("rentalTermsMessage: 희망 네고 가격과 대리운용 여부를 게시자 채팅 형식으로 만든다", () => {
  const msg = rentalTermsMessage(
    { title: "관리기 A", start: "2026-11-24", end: "2026-11-28", days: 5 },
    { negotiatedDailyPrice: 40_000, operatorWanted: true },
    50_000,
  );
  assert.match(msg, /\[농농 대여 요청\] '관리기 A' 2026-11-24 ~ 2026-11-28 \(5일\) 대여를 요청했어요\./);
  assert.match(msg, /희망 네고 가격: 1일 40,000원 \(등록가 1일 50,000원\)/);
  assert.match(msg, /대행운영서비스: 사용 \(작업자 동반\)/);
});

test("executeRentalRequest: 희망 네고 가격·대리운용을 메모에 남기고 게시자에게 채팅으로 한 번만 보낸다", async () => {
  const requestId = randomUUID();
  const start = addDays(kstToday(), 3);
  const end = addDays(start, 2);
  const action = {
    listingId: rentListing.id,
    title: rentListing.title,
    dailyPrice: rentListing.price,
    start,
    end,
    note: "오전 9시 인수 희망",
    negotiatedDailyPrice: 40_000,
    operatorWanted: true,
  };

  const first = await executeRentalRequest(renter, action, { requestId, pool });
  assert.equal(first.outcome, "completed");
  assert.ok(first.conversation?.id);
  assert.match(first.message, /게시자 채팅으로 전달했어요/);
  assert.match(first.request.note, /오전 9시 인수 희망/);
  assert.match(first.request.note, /희망 네고 가격: 1일 40,000원/);
  assert.match(first.request.note, /대행운영서비스: 사용/);

  // 같은 requestId로 재시도해도 채팅·요청 모두 1건만 유지된다(멱등성).
  const retry = await executeRentalRequest(renter, action, { requestId, pool });
  assert.equal(retry.outcome, "completed");
  assert.equal(retry.idempotent, true);

  const msgRows = await pool.query("SELECT body FROM messages WHERE id = $1", [requestId]);
  assert.equal(msgRows.rows.length, 1);
  assert.match(msgRows.rows[0].body, /희망 네고 가격: 1일 40,000원/);
  assert.match(msgRows.rows[0].body, /대행운영서비스: 사용/);
});

test("executeRentalRequest: 채팅 전송이 실패해도 대여 요청은 유지되고 partial을 반환한다", async () => {
  const requestId = randomUUID();
  const start = addDays(kstToday(), 10);
  const end = addDays(start, 1);
  const res = await executeRentalRequest(
    renter,
    {
      listingId: rentListing.id,
      title: rentListing.title,
      dailyPrice: rentListing.price,
      start,
      end,
      negotiatedDailyPrice: null,
      operatorWanted: false,
    },
    {
      requestId,
      pool,
      sendTermsMessage: async () => {
        throw new Error("chat unavailable");
      },
    },
  );
  assert.equal(res.outcome, "partial");
  assert.equal(res.request.id, requestId);
  assert.match(res.message, /채팅으로 전하지 못했어요/);
});

test("executeRentalRequest: 대행운영서비스를 쓰면 작업자를 함께 요청하고 금액은 기계+작업자 합계다", async () => {
  const operator = { name: "김영수", experience: "관리기 15년", dailyPrice: 30_000 };
  const opListing = (await createListing(owner, {
    id: randomUUID(),
    title: "관리기 대행운영",
    type: "rent",
    price: 50_000,
    region: "영양읍",
    machineType: "rootHarvester",
    cropIds: ["sweetPotato"],
    operations: ["potatoHarvest"],
    areaMin: 300,
    areaMax: 2000,
    condition: "good",
    brand: "아세아텍",
    description: "대행운영 됩니다.",
    rentalOperator: operator,
  }, { pool })).listing;
  const start = addDays(kstToday(), 5);
  const end = addDays(start, 1);
  const result = await executeRentalRequest(renter, {
    listingId: opListing.id, title: opListing.title, dailyPrice: 50_000, start, end, rentalOperator: operator,
  }, { requestId: randomUUID(), pool });
  assert.equal(result.outcome, "completed");
  assert.deepEqual(result.request.rentalOperator, operator);
  assert.equal(result.request.totalPrice, (50_000 + 30_000) * 2);
});
