// 농농이 마이페이지 도우미(server/my-page-agent.js) 검증.
// 실제 PGlite DB와 기존 서비스로 끝까지 확인한다: 계정 분리, 승인 없이 쓰지 않음, 허용 목록, 실제 쓰기 결과.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import accountHandler from "../api/account.js";
import { resetAuthCache } from "../server/account-auth.js";
import { createPglitePool, kstToday, setPool } from "../server/db.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";
import {
  executeMyPageAction,
  getMyPageSnapshot,
  MY_PAGE_OPERATIONS,
  MY_PAGE_TOOLS,
  myPageRateKind,
  prepareMyPageAction,
} from "../server/my-page-agent.js";
import { createRentalRequest } from "../server/rentals.js";
import { addOwnedMachine, toggleFavorite } from "../server/user-data.js";

const ENV_KEYS = ["APP_ENV", "DATABASE_URL"];

function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function signup(baseUrl, username, name) {
  const res = await fetch(`${baseUrl}/api/account?action=signup`, {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "application/json" },
    body: JSON.stringify({ username, name, password: "Password123!" }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.user;
}

let pool;
let server;
let prevEnv;
let alice; // 빌리는 사람
let bob; // 매물 주인
let bobRent;
let bobSale;
let aliceMachineId;
let pendingRequestId;

before(async () => {
  prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.DATABASE_URL;
  process.env.APP_ENV = "test";
  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });
  server = createServer((req, res) => accountHandler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  alice = await signup(baseUrl, "mypage_alice", "앨리스");
  bob = await signup(baseUrl, "mypage_bob", "밥농부");

  const base = {
    machineType: "rootHarvester",
    cropIds: ["sweetPotato"],
    operations: ["potatoHarvest"],
    areaMin: 300,
    areaMax: 5000,
    condition: "good",
    brand: "두루기계통상",
    description: "고구마 수확용입니다.",
    region: "청기면",
  };
  bobRent = (await createListing(bob, { ...base, id: randomUUID(), title: "밥의 대여 수확기", type: "rent", price: 90_000 }, { pool })).listing;
  bobSale = (await createListing(bob, { ...base, id: randomUUID(), title: "밥의 판매 수확기", type: "sale", price: 3_000_000 }, { pool })).listing;

  await toggleFavorite(alice.id, bobSale.id, { favorite: true, pool });
  aliceMachineId = randomUUID();
  await addOwnedMachine(alice.id, { id: aliceMachineId, modelId: "kubota-b2320", name: "앨리스 트랙터" }, { pool });
  pendingRequestId = randomUUID();
  const today = kstToday();
  await createRentalRequest(alice, { id: pendingRequestId, listingId: bobRent.id, start: addDays(today, 5), end: addDays(today, 6), note: "비밀 메모 010-1234-5678" }, { pool });
  await pool.query(
    "INSERT INTO education_certificates (user_id, image, content_type, byte_length, uploaded_at) VALUES ($1, $2, 'image/webp', 3, now())",
    [alice.id, Buffer.from([1, 2, 3])]
  );
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await pool?.end();
  setPool(undefined);
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const rejects = (promise, code) => assert.rejects(promise, (error) => {
  assert.equal(error.code, code, `${error.code}: ${error.message}`);
  return true;
});

test("마이페이지 조회: 로그인 사용자 본인 것만, 민감 정보 없이 돌려준다", async () => {
  const snap = await getMyPageSnapshot(alice);
  assert.deepEqual(snap.profile, { name: "앨리스" });
  assert.equal(snap.favorites.count, 1);
  assert.equal(snap.favorites.items[0].listingId, bobSale.id);
  assert.equal(snap.ownedMachines.length, 1);
  assert.equal(snap.ownedMachines[0].id, aliceMachineId);
  assert.equal(snap.ownedMachines[0].isSelected, true);
  assert.equal(snap.rentalRequests.sent.length, 1);
  assert.equal(snap.rentalRequests.received.length, 0);
  assert.equal(snap.rentalRequests.sent[0].counterpartName, "밥농부");
  assert.deepEqual(snap.myListings, []);
  assert.equal(snap.educationCertificate.uploaded, true);

  const raw = JSON.stringify(snap);
  assert.doesNotMatch(raw, /@users\.moa-farm|email|password|imageDataUrl|010-1234-5678|비밀 메모/);
  assert.doesNotMatch(raw, new RegExp(bob.id));
  assert.doesNotMatch(raw, new RegExp(alice.id));

  const bobSnap = await getMyPageSnapshot(bob);
  assert.equal(bobSnap.favorites.count, 0);
  assert.equal(bobSnap.ownedMachines.length, 0);
  assert.equal(bobSnap.rentalRequests.received.length, 1);
  assert.equal(bobSnap.rentalRequests.received[0].canApprove, true);
  assert.equal(bobSnap.rentalRequests.received[0].counterpartName, "앨리스");
  assert.deepEqual(bobSnap.myListings.map((l) => l.listingId).sort(), [bobRent.id, bobSale.id].sort());
  assert.equal(bobSnap.educationCertificate.uploaded, false);
});

test("마이페이지 조회: 필요한 부분만 고를 수 있고, 로그인하지 않으면 거부한다", async () => {
  const snap = await getMyPageSnapshot(alice, { sections: ["profile", "nope"] });
  assert.deepEqual(Object.keys(snap), ["profile"]);
  await rejects(getMyPageSnapshot(null), "LOGIN_REQUIRED");
  await rejects(prepareMyPageAction(null, { operation: "update_nickname", args: { name: "x" } }), "LOGIN_REQUIRED");
  await rejects(executeMyPageAction(null, { type: "my_page_action", operation: "update_nickname", args: { name: "x" } }), "LOGIN_REQUIRED");
});

test("제안(prepare)은 아무것도 바꾸지 않고 확인 카드만 만든다", async () => {
  const before = await pool.query('SELECT name FROM "user" WHERE id = $1', [alice.id]);
  const pending = await prepareMyPageAction(alice, { operation: "update_nickname", args: { name: "새 이름", email: "evil@x.com", userId: bob.id } });
  assert.equal(pending.type, "my_page_action");
  assert.equal(pending.operation, "update_nickname");
  assert.deepEqual(pending.args, { name: "새 이름" }, "허용되지 않은 필드는 버린다");
  assert.match(pending.summary, /새 이름/);
  const afterRow = await pool.query('SELECT name FROM "user" WHERE id = $1', [alice.id]);
  assert.equal(afterRow.rows[0].name, before.rows[0].name);
});

test("허용 목록 밖 작업과 민감 필드는 제안·실행 모두 거부한다", async () => {
  for (const operation of ["update_password", "update_email", "toString", "__proto__", "constructor", "importGuest", "upload_education_certificate"]) {
    await rejects(prepareMyPageAction(alice, { operation, args: {} }), "UNSUPPORTED_OPERATION");
    await rejects(executeMyPageAction(alice, { type: "my_page_action", operation, args: {} }), "UNSUPPORTED_OPERATION");
  }
  await rejects(executeMyPageAction(alice, { type: "rental_request", operation: "update_nickname", args: { name: "x" } }), "INVALID_ACTION");
  const toolOps = MY_PAGE_TOOLS.find((t) => t.name === "propose_my_page_action").input_schema.properties.operation.enum;
  assert.deepEqual(toolOps, Object.keys(MY_PAGE_OPERATIONS));
  assert.ok(!toolOps.some((op) => /password|email|username|session|phone/i.test(op)));
});

test("다른 사용자 것은 제안 단계에서 막고, 위조한 승인도 서비스가 막는다", async () => {
  // 앨리스가 밥의 매물 상태를 바꾸거나 숨기려 함
  await rejects(prepareMyPageAction(alice, { operation: "set_listing_status", args: { listingId: bobSale.id, status: "done" } }), "LISTING_NOT_FOUND");
  const forgedStatus = await executeMyPageAction(alice, { type: "my_page_action", operation: "set_listing_status", args: { listingId: bobSale.id, status: "done" } }, { requestId: randomUUID() });
  assert.equal(forgedStatus.outcome, "failed");
  assert.equal(forgedStatus.code, "FORBIDDEN");
  const forgedHide = await executeMyPageAction(alice, { type: "my_page_action", operation: "hide_listing", args: { listingId: bobSale.id } });
  assert.equal(forgedHide.code, "FORBIDDEN");
  // 앨리스가 자기가 보낸 요청을 승인하려 함(주인만 가능)
  await rejects(prepareMyPageAction(alice, { operation: "approve_rental_request", args: { rentalRequestId: pendingRequestId } }), "INVALID_STATE_TRANSITION");
  const forgedApprove = await executeMyPageAction(alice, { type: "my_page_action", operation: "approve_rental_request", args: { rentalRequestId: pendingRequestId } });
  assert.equal(forgedApprove.code, "FORBIDDEN");
  // 밥이 앨리스의 보유 농기계를 지우거나 고르려 함
  await rejects(prepareMyPageAction(bob, { operation: "remove_owned_machine", args: { ownedMachineId: aliceMachineId } }), "OWNED_MACHINE_NOT_FOUND");
  const forgedRemove = await executeMyPageAction(bob, { type: "my_page_action", operation: "remove_owned_machine", args: { ownedMachineId: aliceMachineId } });
  assert.equal(forgedRemove.code, "FORBIDDEN");
  const forgedSelect = await executeMyPageAction(bob, { type: "my_page_action", operation: "select_owned_machine", args: { ownedMachineId: aliceMachineId } });
  assert.equal(forgedSelect.code, "FORBIDDEN");
  // 밥은 자기가 보내지 않은 대기 요청을 취소할 수 없다
  await rejects(prepareMyPageAction(bob, { operation: "cancel_rental_request", args: { rentalRequestId: pendingRequestId } }), "INVALID_STATE_TRANSITION");

  const listingRows = await pool.query("SELECT status FROM listings WHERE id = $1", [bobSale.id]);
  assert.equal(listingRows.rows[0].status, "open");
  const owned = await pool.query("SELECT user_id FROM owned_machines WHERE id = $1", [aliceMachineId]);
  assert.equal(owned.rows[0].user_id, alice.id);
  const req = await pool.query("SELECT status FROM rental_requests WHERE id = $1", [pendingRequestId]);
  assert.equal(req.rows[0].status, "pending");
});

test("서비스 검증을 그대로 따른다(잘못된 닉네임·모델·상태)", async () => {
  await rejects(prepareMyPageAction(alice, { operation: "update_nickname", args: { name: "가".repeat(41) } }), "INVALID_INPUT");
  await rejects(prepareMyPageAction(alice, { operation: "add_owned_machine", args: { modelId: "not-a-model" } }), "INVALID_MODEL");
  await rejects(prepareMyPageAction(bob, { operation: "set_listing_status", args: { listingId: bobSale.id, status: "removed" } }), "INVALID_STATUS");
  // 위조한 승인도 실행 전에 같은 검증을 다시 한다
  await rejects(executeMyPageAction(alice, { type: "my_page_action", operation: "update_nickname", args: { name: "" } }), "INVALID_INPUT");
  assert.equal((await pool.query('SELECT name FROM "user" WHERE id = $1', [alice.id])).rows[0].name, "앨리스");
});

test("승인된 작업은 실제 DB에 반영된다: 닉네임·찜·보유 농기계", async () => {
  const nick = await executeMyPageAction(alice, await prepareMyPageAction(alice, { operation: "update_nickname", args: { name: "앨리스농장" } }));
  assert.equal(nick.outcome, "completed");
  assert.equal((await pool.query('SELECT name FROM "user" WHERE id = $1', [alice.id])).rows[0].name, "앨리스농장");
  assert.equal((await pool.query('SELECT name FROM "user" WHERE id = $1', [bob.id])).rows[0].name, "밥농부");
  assert.doesNotMatch(JSON.stringify(nick), /email|@users/);

  await rejects(prepareMyPageAction(alice, { operation: "remove_favorite", args: { listingId: bobRent.id } }), "FAVORITE_NOT_FOUND");
  const unfav = await executeMyPageAction(alice, await prepareMyPageAction(alice, { operation: "remove_favorite", args: { listingId: bobSale.id } }));
  assert.equal(unfav.favoriteAction.favorite, false);
  const fav = await executeMyPageAction(alice, await prepareMyPageAction(alice, { operation: "add_favorite", args: { listingId: bobRent.id } }));
  assert.equal(fav.favoriteAction.favorite, true);
  const favRows = await pool.query("SELECT listing_id FROM favorites WHERE user_id = $1", [alice.id]);
  assert.deepEqual(favRows.rows.map((r) => r.listing_id), [bobRent.id]);

  const addPending = await prepareMyPageAction(alice, { operation: "add_owned_machine", args: { modelId: "tym-t25", name: "두번째" } });
  const requestId = randomUUID();
  const added = await executeMyPageAction(alice, addPending, { requestId });
  const again = await executeMyPageAction(alice, addPending, { requestId });
  assert.equal(added.outcome, "completed");
  assert.equal(again.outcome, "completed", "같은 승인을 두 번 보내도 한 대만 생긴다");
  const ownedRows = await pool.query("SELECT id, name, is_selected FROM owned_machines WHERE user_id = $1 ORDER BY created_at", [alice.id]);
  assert.equal(ownedRows.rows.length, 2);
  assert.equal(ownedRows.rows[1].id, requestId);

  await executeMyPageAction(alice, await prepareMyPageAction(alice, { operation: "select_owned_machine", args: { ownedMachineId: aliceMachineId } }));
  const sel = await pool.query("SELECT id FROM owned_machines WHERE user_id = $1 AND is_selected", [alice.id]);
  assert.deepEqual(sel.rows.map((r) => r.id), [aliceMachineId]);
  await executeMyPageAction(alice, await prepareMyPageAction(alice, { operation: "remove_owned_machine", args: { ownedMachineId: requestId } }));
  assert.equal((await pool.query("SELECT 1 FROM owned_machines WHERE id = $1", [requestId])).rows.length, 0);
});

test("승인된 작업은 실제 DB에 반영된다: 대여 승인·취소, 매물 상태·숨김, 교육이수증 삭제", async () => {
  const approve = await prepareMyPageAction(bob, { operation: "approve_rental_request", args: { rentalRequestId: pendingRequestId } });
  assert.match(approve.summary, /앨리스농장님의 대여 요청/);
  assert.equal(myPageRateKind(approve), "rental");
  const approved = await executeMyPageAction(bob, approve);
  assert.equal(approved.outcome, "completed");
  assert.equal((await pool.query("SELECT status FROM rental_requests WHERE id = $1", [pendingRequestId])).rows[0].status, "approved");

  // 진행 중 예약이 있는 매물은 서비스 규칙대로 숨길 수 없다
  const hideBlocked = await executeMyPageAction(bob, await prepareMyPageAction(bob, { operation: "hide_listing", args: { listingId: bobRent.id } }));
  assert.equal(hideBlocked.outcome, "failed");
  assert.equal(hideBlocked.code, "ACTIVE_BOOKING_EXISTS");

  const cancel = await executeMyPageAction(alice, await prepareMyPageAction(alice, { operation: "cancel_rental_request", args: { rentalRequestId: pendingRequestId } }));
  assert.equal(cancel.outcome, "completed");
  assert.equal(cancel.rentalRequest.state, "cancelled");
  assert.equal((await pool.query("SELECT status FROM rental_requests WHERE id = $1", [pendingRequestId])).rows[0].status, "cancelled");

  const status = await executeMyPageAction(bob, await prepareMyPageAction(bob, { operation: "set_listing_status", args: { listingId: bobSale.id, status: "dealing" } }));
  assert.equal(status.listing.status, "dealing");
  assert.equal((await pool.query("SELECT status FROM listings WHERE id = $1", [bobSale.id])).rows[0].status, "dealing");
  await executeMyPageAction(bob, await prepareMyPageAction(bob, { operation: "hide_listing", args: { listingId: bobSale.id } }));
  assert.equal((await pool.query("SELECT status FROM listings WHERE id = $1", [bobSale.id])).rows[0].status, "removed");
  await rejects(prepareMyPageAction(bob, { operation: "hide_listing", args: { listingId: bobSale.id } }), "LISTING_NOT_FOUND");

  await rejects(prepareMyPageAction(bob, { operation: "delete_education_certificate" }), "CERTIFICATE_NOT_FOUND");
  const del = await executeMyPageAction(alice, await prepareMyPageAction(alice, { operation: "delete_education_certificate" }));
  assert.equal(del.educationCertificate.uploaded, false);
  assert.equal((await pool.query("SELECT 1 FROM education_certificates WHERE user_id = $1", [alice.id])).rows.length, 0);
});

// ---------------------------------------------------------------------------
// 에이전트 턴 연결: 모델 응답은 스크립트로 흉내 내고, 마이페이지 도우미는 실제 DB로 동작시킨다.
// ---------------------------------------------------------------------------
import { buildMockListings } from "../server/listing-seed.js";
import { runAgentTurn, selectToolsForTurn } from "../server/nongnong-agent.js";

function withKey(t) {
  const previous = { AI_PROVIDER: process.env.AI_PROVIDER, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test";
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function scripted(responses, seen) {
  return async (args) => {
    seen.push(JSON.parse(JSON.stringify(args.messages)));
    return responses.shift() ?? null;
  };
}

const toolUse = (name, input, id = `tu_${name}`) => ({ content: [{ type: "tool_use", id, name, input }] });
const lastToolResult = (messages) => JSON.parse(messages.at(-1).content.find((p) => p.type === "tool_result").content);

test("도구 선택: 마이페이지 말에만 마이페이지 도구를 준다", () => {
  const names = (text) => selectToolsForTurn({ text }).map((tool) => tool.name);
  assert.ok(names("내 예약 현황 알려줘").includes("get_my_page"));
  assert.ok(names("닉네임 바꿔줘").includes("propose_my_page_action"));
  assert.ok(!names("고추 두둑 장비 빌릴래요").includes("get_my_page"));
  assert.ok(!selectToolsForTurn({ text: "네", history: [{ role: "assistant", content: "확인 후 승인해 주세요." }] }).some((t) => t.name === "get_my_page"));
});

test("에이전트 턴: get_my_page는 로그인 사용자 본인 것만 읽고 진행 문구를 한 번 보낸다", async (t) => {
  withKey(t);
  const seen = [];
  const progress = [];
  const result = await runAgentTurn("내 마이페이지 보여줘", { user: bob, farmProfile: null }, {
    listings: buildMockListings(),
    call: scripted([toolUse("get_my_page", { sections: ["profile", "myListings", "rentalRequests"] }), { content: [{ type: "text", text: "매물 2개가 있어요." }] }], seen),
    deps: { onToolProgress: (e) => progress.push(e.label) },
  });
  assert.equal(result.mode, "agent");
  const out = lastToolResult(seen[1]);
  assert.equal(out.ok, true);
  assert.equal(out.myPage.profile.name, "밥농부");
  assert.deepEqual(Object.keys(out.myPage).sort(), ["myListings", "profile", "rentalRequests"]);
  assert.ok(out.myPage.myListings.every((l) => [bobRent.id, bobSale.id].includes(l.listingId)));
  assert.doesNotMatch(JSON.stringify(out), /앨리스 트랙터|@users|email/);
  assert.deepEqual(progress, ["마이페이지 정보를 확인하고 있어요"]);
});

test("에이전트 턴: 비로그인은 마이페이지를 읽지 못하고 진행 문구도 없다", async (t) => {
  withKey(t);
  const seen = [];
  const progress = [];
  await runAgentTurn("내 찜 목록 알려줘", {}, {
    listings: buildMockListings(),
    call: scripted([toolUse("get_my_page", {}), { content: [{ type: "text", text: "로그인해 주세요." }] }], seen),
    deps: { onToolProgress: (e) => progress.push(e.label) },
  });
  assert.equal(lastToolResult(seen[1]).code, "LOGIN_REQUIRED");
  assert.deepEqual(progress, []);
});

test("에이전트 턴: propose_my_page_action은 확인 카드만 만들고 \"네\"라고 해도 모델 경로에서는 쓰지 않는다", async (t) => {
  withKey(t);
  const before = (await pool.query('SELECT name FROM "user" WHERE id = $1', [bob.id])).rows[0].name;
  for (const message of ["닉네임을 밥농장으로 바꿔줘", "네"]) {
    const seen = [];
    const result = await runAgentTurn(message, { user: bob, farmProfile: null }, {
      listings: buildMockListings(),
      call: scripted([toolUse("propose_my_page_action", { operation: "update_nickname", args: { name: "밥농장" } })], seen),
      deps: {},
    });
    assert.equal(result.pendingAction.type, "my_page_action");
    assert.equal(result.pendingAction.operation, "update_nickname");
    assert.deepEqual(result.pendingAction.args, { name: "밥농장" });
    assert.match(result.reply, /닉네임을 '밥농장'\(으\)로 바꿀까요\?/);
  }
  assert.equal((await pool.query('SELECT name FROM "user" WHERE id = $1', [bob.id])).rows[0].name, before);

  // 남의 것은 확인 카드도 만들지 않는다
  const seen = [];
  const denied = await runAgentTurn("앨리스 기계 지워줘", { user: bob, farmProfile: null }, {
    listings: buildMockListings(),
    call: scripted([toolUse("propose_my_page_action", { operation: "remove_owned_machine", args: { ownedMachineId: aliceMachineId } }), { content: [{ type: "text", text: "찾을 수 없어요." }] }], seen),
    deps: {},
  });
  assert.equal(denied.pendingAction, undefined);
  assert.equal(lastToolResult(seen[1]).code, "OWNED_MACHINE_NOT_FOUND");
});
