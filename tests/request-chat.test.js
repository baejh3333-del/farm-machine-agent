// 신청 후 채팅으로 이어주기: 대여·구매 신청이 성공하면 소유자/판매자와의 1:1 채팅 버튼을 붙인다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPrefill, requestChatTarget, requestDoneMessage, runAgentTurn } from "../server/nongnong-agent.js";
import { buildMockListings } from "../server/listing-seed.js";

const LISTINGS = buildMockListings();
const TODAY = "2026-11-16";
const rentable = LISTINGS.find((item) => item.type === "rent" && item.status === "open" && item.condition !== "repair" && !item.booked.length);
const saleItem = LISTINGS.find((item) => item.type === "sale" && item.status === "open");
const otherRent = LISTINGS.filter((item) => item.type === "rent" && item.status === "open" && item.id !== rentable.id).slice(0, 2);

const AI_ENV = ["AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"];
function withKey(t) {
  const previous = Object.fromEntries(AI_ENV.map((name) => [name, process.env[name]]));
  for (const name of AI_ENV) delete process.env[name];
  process.env.ANTHROPIC_API_KEY = "test";
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}
function scripted(responses) {
  const calls = [];
  const call = async (request) => {
    calls.push(structuredClone(request));
    const next = responses.shift();
    return next === undefined ? null : next;
  };
  return { call, calls };
}
const toolResultOf = (calls, i) => JSON.parse(calls[i].messages.at(-1).content.at(-1).content);

test("대여 신청 후 채팅 버튼: 신청 결과의 매물명·날짜로만 인사말을 채운다", () => {
  const target = requestChatTarget({ kind: "rental", listingId: "L1", title: "대동 트랙터 · 영양읍", start: "2026-11-20", end: "2026-11-21" });
  assert.equal(target.listingId, "L1");
  assert.equal(target.afterRequest, true);
  assert.equal(target.kind, "rental");
  assert.equal(target.prefill, "안녕하세요. 대동 트랙터 · 영양읍을 11월 20일(금)~11월 21일(토)에 대여 신청했어요. 수령 방법과 시간 여쭤보고 싶어요.");
  const oneDay = requestChatTarget({ kind: "rental", listingId: "L2", title: "국제 관리기", start: "2026-11-20", end: "2026-11-20" });
  assert.match(oneDay.prefill, /국제 관리기를 11월 20일\(금\)에 대여 신청했어요/);
});

test("구매 신청 후 채팅 버튼: 이미 보낸 구매 희망 메시지를 반복하지 않는 짧은 질문만 채운다", () => {
  const target = requestChatTarget({ kind: "purchase", listingId: "S1", title: "얀마 트랙터", totalPrice: 12000000 });
  assert.equal(target.kind, "purchase");
  assert.equal(target.prefill, "직접 보러 가도 되는지, 거래 장소는 어디가 편하신지 여쭤보고 싶어요.");
  assert.doesNotMatch(target.prefill, /구매를 희망/);
});

test("완료 답변: 번호를 알면 'n번 매물', 모르면 매물 이름으로 말한다", () => {
  assert.equal(
    requestDoneMessage({ kind: "rental", title: "대동 트랙터" }, { shownNo: 2 }),
    "2번 매물 대여 신청이 완료되었어요!\n소유 농가가 승인하면 예약이 확정돼요.\n궁금한 점은 아래 버튼을 눌러 소유 농가와 바로 이야기해 보세요.",
  );
  assert.equal(
    requestDoneMessage({ kind: "purchase", title: "얀마 트랙터" }),
    "'얀마 트랙터' 구매 신청이 완료되었어요!\n판매자가 확인하면 거래가 진행돼요. 결제는 거래할 때 직접 해 주세요.\n아래 버튼을 눌러 판매자와 바로 이야기해 보세요.",
  );
});

test("미리 채우는 문장에 전화번호·주소·결제 정보가 섞이면 비운다", () => {
  for (const bad of ["제 번호 010-1234-5678로 연락 주세요", "주소는 영양읍 서부리 123번지예요", "계좌로 보낼게요", "101동 1203호로 와 주세요", "카드 번호 1234-5678-9012-3456"]) {
    assert.equal(cleanPrefill(bad), "", bad);
  }
  assert.equal(cleanPrefill("수령 시간 여쭤보고 싶어요"), "수령 시간 여쭤보고 싶어요");
});

test("채팅으로 대여 신청이 성공하면 같은 답변에 신청 후 채팅 버튼과 'n번 매물' 완료 답변이 붙는다", async (t) => {
  withKey(t);
  const { call } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "create_rental_request", input: { listingId: rentable.id, start: "2026-11-20", end: "2026-11-21" } }] },
    { content: [{ type: "text", text: "" }] },
  ]);
  const created = [];
  const result = await runAgentTurn("네", {
    user: { id: "buyer-1" },
    uiContext: { lastShownListings: [otherRent[0].id, rentable.id].map((id) => ({ id })) },
  }, {
    listings: LISTINGS, call, today: TODAY,
    deps: { createRentalRequest: async (u, req) => { created.push(req); return { request: { id: req.id, days: 2, totalPrice: rentable.price * 2 } }; } },
  });
  assert.equal(created.length, 1);
  assert.equal(result.chatTarget.listingId, rentable.id);
  assert.equal(result.chatTarget.afterRequest, true);
  assert.match(result.chatTarget.prefill, /11월 20일\(금\)~11월 21일\(토\)에 대여 신청했어요/);
  assert.match(result.reply, /^2번 매물 대여 신청이 완료되었어요!/);
  assert.match(result.reply, /아래 버튼을 눌러 소유 농가와/);
});

test("모델이 신청 직후 open_listing_chat에 개인정보를 넣어도 서버가 만든 인사말을 그대로 쓴다", async (t) => {
  withKey(t);
  const { call, calls } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "create_rental_request", input: { listingId: rentable.id, start: "2026-11-20", end: "2026-11-20" } }] },
    { content: [{ type: "tool_use", id: "t2", name: "open_listing_chat", input: { listingId: rentable.id, prefillMessage: "제 번호는 010-1234-5678이에요" } }] },
    { content: [{ type: "text", text: "대여 신청이 완료되었어요! 아래 버튼을 눌러 소유 농가와 이야기해 보세요." }] },
  ]);
  const result = await runAgentTurn("예약해줘", { user: { id: "buyer-1" } }, {
    listings: LISTINGS, call, today: TODAY,
    deps: { createRentalRequest: async (u, req) => ({ request: { id: req.id, days: 1, totalPrice: rentable.price } }) },
  });
  assert.doesNotMatch(result.chatTarget.prefill, /010/);
  assert.equal(result.chatTarget.afterRequest, true);
  assert.equal(toolResultOf(calls, 2).ok, true);
});

test("구매 신청이 성공하면 판매자 채팅 버튼이 붙는다(구매 희망 메시지는 이미 한 번만 보냄)", async (t) => {
  withKey(t);
  const { call } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "create_purchase_request", input: { listingId: saleItem.id } }] },
    { content: [{ type: "text", text: "" }] },
  ]);
  const sent = [];
  const result = await runAgentTurn("네 구매할게요", { user: { id: "buyer-1" } }, {
    listings: LISTINGS, call, today: TODAY,
    deps: { sendPurchaseMessage: async (u, payload) => { sent.push(payload); return { conversation: { id: "c1" } }; } },
  });
  assert.equal(sent.length, 1);
  assert.equal(result.chatTarget.kind, "purchase");
  assert.equal(result.chatTarget.listingId, saleItem.id);
  assert.match(result.reply, /구매 신청이 완료되었어요!/);
  assert.match(result.reply, /결제는 거래할 때 직접 해 주세요/);
});

test("신청이 실패하면 채팅 버튼을 띄우지 않는다", async (t) => {
  withKey(t);
  const { call, calls } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "create_rental_request", input: { listingId: "no-such-listing", start: "2026-11-20", end: "2026-11-20" } }] },
    { content: [{ type: "tool_use", id: "t2", name: "open_listing_chat", input: { listingId: rentable.id } }] },
    { content: [{ type: "text", text: "매물을 찾지 못해 신청하지 못했어요. 다른 매물을 찾아 드릴까요?" }] },
  ]);
  const result = await runAgentTurn("예약해줘", { user: { id: "buyer-1" } }, {
    listings: LISTINGS, call, today: TODAY,
    deps: { createRentalRequest: async () => { throw new Error("should not be called"); } },
  });
  assert.equal(result.chatTarget, undefined);
  assert.equal(toolResultOf(calls, 2).ok, false);
});

test("신청 전 '주인한테 먼저 물어볼래요'는 신청 없이 채팅 버튼만(대리 채팅 포함 기존 버튼) 보여 준다", async (t) => {
  withKey(t);
  const { call } = scripted([
    { content: [{ type: "tool_use", id: "t1", name: "open_listing_chat", input: { listingId: rentable.id, prefillMessage: "작업기 포함인가요?" } }] },
    { content: [{ type: "text", text: "아래 버튼으로 소유자에게 먼저 물어보세요." }] },
  ]);
  const created = [];
  const result = await runAgentTurn("주인한테 먼저 물어볼래요", { user: { id: "buyer-1" } }, {
    listings: LISTINGS, call, today: TODAY,
    deps: { createRentalRequest: async (u, req) => { created.push(req); return { request: {} }; } },
  });
  assert.equal(created.length, 0);
  assert.equal(result.chatTarget.listingId, rentable.id);
  assert.equal(result.chatTarget.prefill, "작업기 포함인가요?");
  assert.equal(result.chatTarget.afterRequest, undefined);
});

test("말로 '네'라고 해서 서버가 확인 대기 대여를 바로 실행해도 채팅 버튼과 'n번 매물' 답변이 붙는다", async () => {
  const { runConfirmedAction } = await import("../api/agent.js");
  const pending = { type: "rental_request", listingId: rentable.id, title: rentable.title, start: "2026-11-20", end: "2026-11-21" };
  const run = async () => ({
    outcome: "completed",
    reservation: { kind: "rental", number: "R-ABCDEF12", listingId: rentable.id, title: rentable.title, start: "2026-11-20", end: "2026-11-21" },
  });
  const result = await runConfirmedAction({ message: "승인할게", pending, user: { id: "buyer-1" }, requestId: "r1", run, shownNo: 3 });
  assert.match(result.reply, /^3번 매물 대여 신청이 완료되었어요!/);
  assert.match(result.reply, /신청 번호는 R-ABCDEF12예요/);
  assert.equal(result.chatTarget.listingId, rentable.id);
  assert.equal(result.chatTarget.afterRequest, true);
  const failed = await runConfirmedAction({ message: "네", pending, user: { id: "buyer-1" }, requestId: "r2", run: async () => ({ outcome: "failed", message: "이미 예약된 기간입니다." }) });
  assert.equal(failed.chatTarget, undefined);
});
