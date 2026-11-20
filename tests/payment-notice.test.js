// 대여 신청 후 결제 기한 안내: 음성 대화에서만 답변 끝에 한 번 읽어 주고(화면에는 안내 칸이 따로 뜸), 글 대화·구매에는 붙이지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runAgentTurn, VOICE_RENTAL_PAYMENT_NOTICE, withVoicePaymentNotice } from "../server/nongnong-agent.js";
import { runConfirmedAction } from "../api/agent.js";
import { buildMockListings } from "../server/listing-seed.js";

const LISTINGS = buildMockListings();
const TODAY = "2026-11-16";
const rentable = LISTINGS.find((item) => item.type === "rent" && item.status === "open" && item.condition !== "repair" && !item.booked.length);
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
  const call = async () => responses.shift() ?? null;
  return { call };
}
const rentalTurn = () => scripted([
  { content: [{ type: "tool_use", id: "t1", name: "create_rental_request", input: { listingId: rentable.id, start: "2026-11-20", end: "2026-11-21" } }] },
  { content: [{ type: "text", text: "1번 매물 대여 신청이 완료되었어요!" }] },
]);
const deps = { createRentalRequest: async (u, req) => ({ request: { id: req.id, days: 2, totalPrice: rentable.price * 2 } }) };

test("결제 기한 음성 안내는 음성 대여에만, 한 번만 붙는다", () => {
  const rental = { kind: "rental" };
  assert.equal(withVoicePaymentNotice("신청 완료", { reservation: rental, inputMode: "voice" }), `신청 완료\n${VOICE_RENTAL_PAYMENT_NOTICE}`);
  assert.equal(withVoicePaymentNotice("신청 완료", { reservation: rental, inputMode: "text" }), "신청 완료");
  assert.equal(withVoicePaymentNotice("신청 완료", { reservation: { kind: "purchase" }, inputMode: "voice" }), "신청 완료");
  assert.equal(withVoicePaymentNotice("결제는 3일 이내에 해 주세요.", { reservation: rental, inputMode: "voice" }), "결제는 3일 이내에 해 주세요.");
  assert.equal(withVoicePaymentNotice("검색 결과예요", { reservation: null, inputMode: "voice" }), "검색 결과예요");
});

test("음성 대화로 대여 신청이 끝나면 답변 끝에 결제 기한을 읽어 주고, 글 대화에는 붙이지 않는다", async (t) => {
  withKey(t);
  const voice = await runAgentTurn("네 빌릴게요", { user: { id: "b1" }, inputMode: "voice" }, { listings: LISTINGS, call: rentalTurn().call, today: TODAY, deps });
  assert.equal(voice.reservation.kind, "rental");
  assert.ok(voice.reply.endsWith(VOICE_RENTAL_PAYMENT_NOTICE));
  const text = await runAgentTurn("네 빌릴게요", { user: { id: "b1" } }, { listings: LISTINGS, call: rentalTurn().call, today: TODAY, deps });
  assert.doesNotMatch(text.reply, /3일 이내/);
});

test("말로 '승인할게'로 서버가 바로 실행한 대여도 음성이면 결제 기한을 읽어 준다", async () => {
  const pending = { type: "rental_request", listingId: rentable.id, title: rentable.title, start: "2026-11-20", end: "2026-11-21" };
  const run = async () => ({ outcome: "completed", reservation: { kind: "rental", number: "R-1", listingId: rentable.id, title: rentable.title, start: "2026-11-20", end: "2026-11-21" } });
  const voice = await runConfirmedAction({ message: "승인할게", pending, user: { id: "b1" }, requestId: "r1", run, inputMode: "voice" });
  assert.ok(voice.reply.endsWith(VOICE_RENTAL_PAYMENT_NOTICE));
  const text = await runConfirmedAction({ message: "승인할게", pending, user: { id: "b1" }, requestId: "r2", run });
  assert.doesNotMatch(text.reply, /3일 이내/);
  const failed = await runConfirmedAction({ message: "네", pending, user: { id: "b1" }, requestId: "r3", run: async () => ({ outcome: "failed", message: "이미 예약된 기간입니다." }), inputMode: "voice" });
  assert.doesNotMatch(failed.reply, /3일 이내/);
});
