import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

delete process.env.DATABASE_URL;
delete process.env.VERCEL;
delete process.env.OPENAI_API_KEY;
const { createDevServer } = await import("../dev-server.js");
const { kstToday } = await import("../server/rentals.js");

const server = createDevServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const day = (offset) => new Date(Date.parse(`${kstToday()}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

function client() {
  const jar = new Map();
  async function call(path, { method = "GET", body, origin = base } = {}) {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    if (body !== undefined) Object.assign(headers, { "content-type": "application/json", origin });
    const response = await fetch(base + path, { method: body === undefined ? method : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  return {
    call,
    async signup(username) {
      const result = await call("/api/account?action=signup", { body: { username, password: "password123", name: username } });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body.user;
    },
  };
}

const owner = client();
const buyer = client();
const other = client();
const guest = client();
await owner.signup("10jo");
await buyer.signup("buyer1");
await other.signup("buyer2");

test("매물의 owner는 로그인한 사용자 기준으로 정해지고 시연 계정은 시드 매물 두 개를 갖는다", async () => {
  const mine = await owner.call("/api/listings?owner=me");
  assert.deepEqual(mine.body.listings.map(({ id }) => id).sort(), ["r1", "s1"]);
  const asBuyer = await buyer.call("/api/listings");
  assert.equal(asBuyer.body.listings.length, 100);
  assert.ok(asBuyer.body.listings.every((item) => item.owner === false));
  assert.equal(asBuyer.body.listings.find(({ id }) => id === "r2").demoOwner, true);
  assert.equal((await guest.call("/api/listings?owner=me")).status, 401);
});

test("신청 → 소유자 승인 → 겹치는 신청 거부 → 신청자 취소 흐름", async () => {
  const period = { listingId: "r1", start: day(10), end: day(12), note: "오전에 가지러 갈게요" };
  const first = await buyer.call("/api/requests", { body: period });
  assert.equal(first.status, 201);
  assert.equal(first.body.request.status, "pending");
  const repeat = await buyer.call("/api/requests", { body: period });
  assert.equal(repeat.status, 200, "같은 신청을 다시 보내면 기존 신청을 돌려준다");
  assert.equal(repeat.body.request.id, first.body.request.id);

  const overlapping = await other.call("/api/requests", { body: { listingId: "r1", start: day(12), end: day(13) } });
  assert.equal(overlapping.status, 201, "승인 전에는 겹치는 대기 신청이 함께 있을 수 있다");

  const inbox = await owner.call("/api/requests?role=owner");
  assert.deepEqual(inbox.body.requests.map((r) => r.requesterName).sort(), ["buyer1", "buyer2"]);
  assert.equal((await buyer.call("/api/requests?role=owner")).body.requests.length, 0);

  assert.equal((await buyer.call("/api/requests?action=approve", { body: { id: first.body.request.id } })).status, 404, "소유자가 아니면 승인할 수 없다");
  const approved = await owner.call("/api/requests?action=approve", { body: { id: first.body.request.id } });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.request.status, "approved");
  assert.equal((await owner.call("/api/requests?action=approve", { body: { id: first.body.request.id } })).status, 200, "반복 승인은 같은 결과");
  const conflict = await owner.call("/api/requests?action=approve", { body: { id: overlapping.body.request.id } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "PERIOD_BOOKED");

  const listing = (await guest.call("/api/listings")).body.listings.find(({ id }) => id === "r1");
  assert.ok(listing.booked.some((range) => range.start === day(10) && range.end === day(12)));
  const late = await other.call("/api/requests", { body: { listingId: "r1", start: day(11), end: day(11) } });
  assert.equal(late.status, 409, "승인된 기간과 겹치는 새 신청은 바로 거부된다");

  const cancelled = await buyer.call("/api/requests?action=cancel", { body: { id: first.body.request.id } });
  assert.equal(cancelled.body.request.status, "cancelled");
  const freed = (await guest.call("/api/listings")).body.listings.find(({ id }) => id === "r1");
  assert.ok(!freed.booked.some((range) => range.start === day(10)), "취소하면 예약도 지워진다");

  const rejected = await owner.call("/api/requests?action=reject", { body: { id: overlapping.body.request.id } });
  assert.equal(rejected.body.request.status, "rejected");
  const mine = await buyer.call("/api/requests");
  assert.deepEqual(mine.body.requests.map((r) => r.status), ["cancelled"]);
});

test("신청 입력과 권한을 서버에서 검사한다", async () => {
  assert.equal((await guest.call("/api/requests", { body: { listingId: "r1", start: day(3), end: day(3) } })).status, 401);
  assert.equal((await buyer.call("/api/requests", { body: { listingId: "r1", start: day(3), end: day(3) }, origin: "https://evil.example" })).status, 403);
  assert.equal((await buyer.call("/api/requests", { body: { listingId: "r1", start: day(-1), end: day(1) } })).body.code, "PAST_DATE");
  assert.equal((await buyer.call("/api/requests", { body: { listingId: "r1", start: day(5), end: day(4) } })).body.code, "INVALID_PERIOD");
  assert.equal((await owner.call("/api/requests", { body: { listingId: "r1", start: day(3), end: day(3) } })).body.code, "OWN_LISTING");
  assert.equal((await buyer.call("/api/requests", { body: { listingId: "s1", start: day(3), end: day(3) } })).body.code, "NOT_AVAILABLE", "판매 매물은 대여 신청 불가");
  assert.equal((await buyer.call("/api/requests?action=approve", { body: { id: "not-a-uuid" } })).status, 404);
});

test("채팅은 구매자와 매물 소유자만 볼 수 있다", async () => {
  const opened = await buyer.call("/api/conversations?action=open", { body: { listingId: "s1" } });
  assert.equal(opened.status, 200);
  const id = opened.body.conversation.id;
  assert.equal((await buyer.call("/api/conversations?action=send", { body: { id, body: "직접 보러 가도 될까요?" } })).status, 200);
  const inbox = await owner.call("/api/conversations");
  const thread = inbox.body.conversations.find((item) => item.id === id);
  assert.equal(thread.role, "owner");
  assert.equal(thread.counterpartName, "buyer1");
  assert.equal(thread.lastMessage.body, "직접 보러 가도 될까요?");
  const reply = await owner.call("/api/conversations?action=send", { body: { id, body: "토요일 오전 괜찮아요" } });
  assert.deepEqual(reply.body.messages.map((m) => [m.fromOwner, m.mine]), [[false, false], [true, true]]);
  assert.equal((await other.call(`/api/conversations?id=${id}`)).status, 404, "다른 사람은 대화를 볼 수 없다");
  assert.equal((await owner.call("/api/conversations?action=open", { body: { listingId: "s1" } })).body.code, "OWN_LISTING");
  const again = await buyer.call("/api/conversations?action=open", { body: { listingId: "s1" } });
  assert.equal(again.body.conversation.id, id, "같은 매물 문의는 같은 대화를 이어 간다");
});

test("찜과 보유 농기계는 계정에 저장되고 로그인 전 데이터를 합칠 수 있다", async () => {
  assert.deepEqual((await buyer.call("/api/me?action=favorite", { body: { listingId: "r2", on: true } })).body.favorites, ["r2"]);
  const machine = { id: randomUUID(), modelId: "daedong-dk450", name: "" };
  const saved = await buyer.call("/api/me?action=machines", { body: { ownedMachines: [machine] } });
  assert.equal(saved.body.ownedMachines[0].name, "DK450HSRQ5", "별명이 없으면 모델명을 쓴다");
  assert.equal((await buyer.call("/api/me?action=machines", { body: { ownedMachines: [{ id: randomUUID(), modelId: "asia-fm120n" }] } })).status, 400, "작업기는 보유 본체로 등록할 수 없다");
  const merged = await buyer.call("/api/me?action=merge", {
    body: { favorites: ["r3", "r2", "no-such-listing"], ownedMachines: [{ id: randomUUID(), modelId: "asia-amc900", name: "우리 관리기" }] },
  });
  assert.deepEqual(merged.body.favorites, ["r2", "r3"]);
  assert.deepEqual(merged.body.ownedMachines.map((m) => m.modelId), ["daedong-dk450", "asia-amc900"]);
  assert.deepEqual((await other.call("/api/me")).body, { favorites: [], ownedMachines: [] }, "다른 계정에는 보이지 않는다");
  assert.equal((await guest.call("/api/me")).status, 401);
});
