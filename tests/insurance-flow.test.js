import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInsuranceRecommendation,
  classifyInsuranceReply,
  cleanInsuranceOffer,
  createInsuranceConsult,
  handleInsuranceTurn,
  INSURANCE_ASK,
  insuranceOfferFor,
  LOCAL_NH_FALLBACK,
  pickOffice,
  repairInsuranceOffer,
} from "../server/insurance-flow.js";
import { attachInsuranceAsk } from "../api/agent.js";
import { createPglitePool } from "../server/db.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";
import { INSURANCE_OFFICES, MACHINERY_INSURANCE_ELIGIBILITY } from "../server/knowledge/insurance.js";
import { MACHINE_TYPES } from "../src/data/farm-machines.js";

const user = { id: "user-1", name: "한준규" };
const listings = [
  { id: "rent-1", type: "rent", machineType: "tractor", region: "입암면", included: "로터리", description: "" },
  { id: "rent-ins", type: "rent", machineType: "tractor", region: "영양읍", included: "로터리·농기계종합보험 가입", description: "" },
  { id: "sale-trac", type: "sale", machineType: "tractor", region: "영양읍", included: "", description: "" },
  { id: "sale-potato", type: "sale", machineType: "potatoHarvester", region: "석보면", included: "", description: "" },
  { id: "sale-drone", type: "sale", machineType: "agriDrone", region: "안동시", included: "", description: "" },
];

function deps() {
  const consults = [];
  return {
    consults,
    deps: {
      fetchListings: async () => listings,
      createConsult: async (u, payload) => {
        consults.push({ user: u.id, ...payload });
        return { id: "aaaaaaaa-1111-4111-8111-111111111111" };
      },
    },
  };
}

test("보험 답 판단: 긍정만 추천으로 넘어가고, 거절·애매·질문은 아니다", () => {
  for (const yes of ["네", "네, 추천해 주세요", "추천해 주세요", "좋아요", "ㅇㅇ", "네, 연결해 주세요"]) assert.equal(classifyInsuranceReply(yes), "yes", yes);
  for (const no of ["아니요", "괜찮아요", "됐어요", "넘어갈게요", "필요 없어요", "나중에요"]) assert.equal(classifyInsuranceReply(no), "no", no);
  for (const unclear of ["음…", "글쎄요", "보험료가 얼마예요?", "네?", "트랙터 하나 더 빌릴래요"]) assert.equal(classifyInsuranceReply(unclear), "unclear", unclear);
});

test("대여·구매 예약에만 묻고, 매물 등록에는 묻지 않는다", () => {
  assert.deepEqual(insuranceOfferFor({ kind: "rental", listingId: "rent-1" }, listings[0]), { stage: "ask", kind: "rental", listingId: "rent-1", machineType: "tractor" });
  assert.equal(insuranceOfferFor({ kind: "purchase", listingId: "sale-trac" }, listings[2]).kind, "purchase");
  assert.equal(insuranceOfferFor({ kind: "listing" }, null), null);
  assert.equal(insuranceOfferFor(null, null), null);
  assert.equal(cleanInsuranceOffer({ stage: "hack", kind: "rental" }), null);
  assert.equal(cleanInsuranceOffer({ stage: "ask", kind: "rental", productId: "made-up" }).productId, null);
  assert.equal(cleanInsuranceOffer({ stage: "offer_consult", kind: "purchase", officeId: LOCAL_NH_FALLBACK.id }).officeId, LOCAL_NH_FALLBACK.id);
});

test("31개 모든 기종에 농기계종합보험 대상 여부가 있고, 가입처는 영양군·전국 지역으로 고른다", () => {
  assert.equal(MACHINE_TYPES.length, 31);
  for (const { id } of MACHINE_TYPES) assert.ok(MACHINERY_INSURANCE_ELIGIBILITY[id], id);
  assert.equal(pickOffice("석보면").id, "nam-yeongyang-nh");
  assert.equal(pickOffice("청기면").id, "yeongyang-nh");
  assert.equal(pickOffice(undefined, "입암면").id, "nam-yeongyang-nh");
  assert.equal(pickOffice("안동시").id, "local-nh");
  assert.equal(pickOffice("안동시").name, "가까운 지역 농·축협");
  assert.equal(pickOffice(undefined, "전남 나주시").id, "local-nh");
  assert.equal(pickOffice().id, "yeongyang-nh");
  for (const office of INSURANCE_OFFICES) assert.ok(office.phone === null || /^\d{2,4}-\d{3,4}-\d{4}$/.test(office.phone));
});

test("빌릴 때: 매물에 보험 정보가 없으면 확인이 필요하다고 하고 농업인안전보험을 추천한다", () => {
  const r = buildInsuranceRecommendation({ kind: "rental", listing: listings[0], office: pickOffice("입암면") });
  assert.match(r.text, /보험 포함 여부는 빌려주는 분께 확인이 필요해요/);
  assert.match(r.text, /🛡️ 추천 보험: 농업인안전보험 \(정책보험\) \/ NH농협생명/);
  assert.match(r.text, /가입: 남영양농협/);
  assert.match(r.text, /가까운 농협 상담을 연결해 드릴까요\?$/);
  assert.doesNotMatch(r.text, /\d[\d,]*원/, "보험료 금액을 지어내지 않는다");
  const included = buildInsuranceRecommendation({ kind: "rental", listing: listings[1], office: pickOffice("영양읍") });
  assert.match(included.text, /빌려주는 곳에서 보험에 가입돼 있어요/);
});

test("살 때: 대상 기종은 농기계종합보험 먼저, 대상이 아니면 그렇게 말하고 농업인안전보험만", () => {
  const tractor = buildInsuranceRecommendation({ kind: "purchase", listing: listings[2], office: pickOffice("영양읍") });
  assert.equal(tractor.productId, "farm-machinery-comprehensive");
  assert.match(tractor.text, /추천 보험: 농기계종합보험 \(정책보험\) \/ NH농협손해보험/);
  assert.match(tractor.text, /다른 선택: 농업인안전보험/);
  const drone = buildInsuranceRecommendation({ kind: "purchase", listing: listings[4], office: pickOffice("안동시") });
  assert.equal(drone.productId, "farm-machinery-comprehensive");
  assert.match(drone.text, /가입: 가까운 지역 농·축협/);
  const potato = buildInsuranceRecommendation({ kind: "purchase", listing: listings[3], office: pickOffice("석보면") });
  assert.equal(potato.productId, "farmer-safety");
  assert.match(potato.text, /이 기종은 농기계종합보험 대상이 아니에요/);
});

test("흐름: 거절하면 '알겠어요.'로 끝내고 다시 묻지 않는다", async () => {
  const { deps: d, consults } = deps();
  const r = await handleInsuranceTurn("괜찮아요", { stage: "ask", kind: "rental", listingId: "rent-1" }, { user, deps: d });
  assert.equal(r.reply, "알겠어요.");
  assert.equal(r.insuranceOffer.stage, "done");
  assert.equal(consults.length, 0);
});

test("흐름: 애매하면 한 번만 다시 묻고, 그래도 애매하면 일반 상담으로 넘긴다", async () => {
  const { deps: d } = deps();
  const first = await handleInsuranceTurn("음…", { stage: "ask", kind: "rental", listingId: "rent-1" }, { user, deps: d });
  assert.equal(first.reply, "보험을 추천해 드릴까요, 아니면 넘어갈까요?");
  assert.equal(first.insuranceOffer.stage, "ask_again");
  assert.equal(await handleInsuranceTurn("글쎄요", first.insuranceOffer, { user, deps: d }), null);
});

test("흐름: 긍정 → 추천 → 다시 긍정해야만 상담 신청을 남긴다", async () => {
  const { deps: d, consults } = deps();
  const rec = await handleInsuranceTurn("네", { stage: "ask", kind: "purchase", listingId: "sale-trac", machineType: "tractor" }, { user, region: "청기면", deps: d });
  assert.equal(rec.insuranceOffer.stage, "offer_consult");
  assert.equal(rec.insuranceOffer.officeId, "yeongyang-nh");
  assert.ok(rec.sources.length > 0);
  assert.equal(consults.length, 0, "추천만으로는 상담을 신청하지 않는다");

  assert.equal(await handleInsuranceTurn("보험료는 얼마예요?", rec.insuranceOffer, { user, deps: d }), null);
  assert.equal(consults.length, 0);

  const loggedOut = await handleInsuranceTurn("네", rec.insuranceOffer, { user: null, deps: d });
  assert.match(loggedOut.reply, /로그인/);
  assert.equal(consults.length, 0);

  const done = await handleInsuranceTurn("네, 연결해 주세요", rec.insuranceOffer, { user, region: "청기면", deps: d });
  assert.equal(consults.length, 1);
  assert.equal(consults[0].productId, "farm-machinery-comprehensive");
  assert.match(done.reply, /^상담 신청했어요\. 신청 번호는 I-AAAAAAAA예요\./);
  assert.match(done.reply, /가입과 보험료 납부는 농협에서 직접 해 주세요/);
  assert.equal(done.insuranceOffer.stage, "done");
});

test("흐름: 전국 지역도 local-nh로 추천 및 상담 신청이 동작한다", async () => {
  const { deps: d, consults } = deps();
  const rec = await handleInsuranceTurn("네", { stage: "ask", kind: "purchase", listingId: "sale-drone", machineType: "agriDrone" }, { user, region: "안동시", deps: d });
  assert.equal(rec.insuranceOffer.officeId, "local-nh");
  const done = await handleInsuranceTurn("네", rec.insuranceOffer, { user, region: "안동시", deps: d });
  assert.equal(consults.length, 1);
  assert.equal(consults[0].officeId, "local-nh");
  assert.equal(consults[0].region, "안동시");
  assert.match(done.reply, /가까운 지역 농·축협/);
});

test("흐름: 상담 연결을 거절하면 가입처만 알려 주고 끝낸다", async () => {
  const { deps: d, consults } = deps();
  const r = await handleInsuranceTurn("아니요", { stage: "offer_consult", kind: "rental", productId: "farmer-safety", officeId: "nam-yeongyang-nh" }, { user, deps: d });
  assert.match(r.reply, /남영양농협/);
  assert.equal(consults.length, 0);
  assert.equal(await handleInsuranceTurn("네", null, { user, deps: d }), null);
});

test("추천할 때 보험사 상담 전화·사이트 카드를 함께 준다 (등록된 공식 정보만)", async () => {
  const { deps: d } = deps();
  const rec = await handleInsuranceTurn("네", { stage: "ask", kind: "purchase", listingId: "sale-trac", machineType: "tractor" }, { user, region: "영양읍", deps: d });
  const [machinery, safety, office] = rec.insuranceContacts;
  assert.equal(machinery.name, "NH농협손해보험 · 농기계종합보험");
  assert.equal(machinery.phone, "1644-9000");
  assert.equal(machinery.url, "https://www.nhfire.co.kr");
  assert.equal(safety.name, "NH농협생명 · 농업인안전보험");
  assert.equal(safety.phone, "1544-4000");
  assert.equal(safety.url, "https://www.nhlife.co.kr");
  assert.equal(office.name, "영양농협");
  assert.equal(office.phone, null, "확인 안 된 번호는 만들지 않는다");
  assert.ok(rec.sources.some((source) => /1644-9000/.test(source.title)));

  const rental = await handleInsuranceTurn("네", { stage: "ask", kind: "rental", listingId: "rent-1" }, { user, region: "입암면", deps: d });
  assert.deepEqual(rental.insuranceContacts.map((card) => card.phone), ["1544-4000", null]);
});

test("createInsuranceConsult: 동시 요청에도 접수 중 신청은 1건만 생성되고 나머지는 idempotent 응답을 받는다", async (t) => {
  const pool = createPglitePool("memory://");
  t.after(() => pool.end());
  await initEnvironment({ env: "test", pool });
  await runMigrations({ env: "test", pool });

  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, now(), now())`,
    [user.id, user.name, "user-1@example.com"],
  );
  await pool.query(
    `INSERT INTO listings (id, owner_id, type, brand, title, machine_type, crop_ids, operations, area_min, area_max, price, region, condition, inspected_at)
     VALUES ($1, $2, 'rent', '대동', '테스트 트랙터', 'tractor', ARRAY['rice'], ARRAY['tillage'], 100, 1000, 50000, '입암면', 'good', CURRENT_DATE)`,
    ["rent-1", user.id],
  );

  // 1) listingId가 있는 경우 동시 6건 요청
  const withListing = await Promise.all(
    Array.from({ length: 6 }, () =>
      createInsuranceConsult(
        user,
        { productId: "farmer-safety", officeId: "nam-yeongyang-nh", listingId: "rent-1", kind: "rental", region: "입암면" },
        { pool },
      ),
    ),
  );
  const createdWithListing = withListing.filter((r) => !r.idempotent);
  assert.equal(createdWithListing.length, 1);
  assert.equal(new Set(withListing.map((r) => r.id)).size, 1);

  // 2) listingId가 NULL인 경우 동시 6건 요청도 1건만 생성
  const withoutListing = await Promise.all(
    Array.from({ length: 6 }, () =>
      createInsuranceConsult(
        user,
        { productId: "farm-machinery-comprehensive", officeId: "yeongyang-nh", listingId: null, kind: "purchase", region: "영양읍" },
        { pool },
      ),
    ),
  );
  const createdWithoutListing = withoutListing.filter((r) => !r.idempotent);
  assert.equal(createdWithoutListing.length, 1);
  assert.equal(new Set(withoutListing.map((r) => r.id)).size, 1);

  const countRes = await pool.query(`SELECT count(*)::int AS cnt FROM insurance_consult_requests WHERE user_id = $1`, [user.id]);
  assert.equal(countRes.rows[0].cnt, 2);

  // 3) 기존 신청이 closed로 바뀌면 같은 조합으로 새 신청을 남길 수 있다
  await pool.query(`UPDATE insurance_consult_requests SET status = 'closed' WHERE id = $1`, [createdWithListing[0].id]);
  const reopened = await createInsuranceConsult(
    user,
    { productId: "farmer-safety", officeId: "nam-yeongyang-nh", listingId: "rent-1", kind: "rental", region: "입암면" },
    { pool },
  );
  assert.equal(reopened.idempotent, false);
});

test("수리 흐름에서도 '보험 추천해드릴까요?'를 제안하고 추천으로 이어진다", async () => {
  assert.equal(INSURANCE_ASK, "보험 추천해드릴까요?");
  const offer = repairInsuranceOffer({ machineType: "tractor" });
  assert.deepEqual(cleanInsuranceOffer(offer), {
    stage: "ask",
    kind: "repair",
    listingId: null,
    machineType: "tractor",
    productId: null,
    officeId: null,
  });

  const { deps: d } = deps();
  const rec = await handleInsuranceTurn("네", offer, { user, region: "영양읍", deps: d });
  assert.equal(rec.insuranceOffer.kind, "repair");
  assert.equal(rec.insuranceOffer.stage, "offer_consult");
  assert.match(rec.reply, /수리·점검 중인 기계도/);
  assert.match(rec.reply, /농기계종합보험/);

  const repairResult = await attachInsuranceAsk(
    { mode: "agent", reply: "수리센터를 안내해 드려요.", repairCenters: [{ id: "daedong-cs", name: "대동 고객만족센터", phone: "1588-2172", url: "https://ko.daedong.co.kr/customer" }] },
    { asked: false, loadListings: async () => listings },
  );
  assert.equal(repairResult.insuranceAsk, "보험 추천해드릴까요?");
  assert.equal(repairResult.insuranceOffer.kind, "repair");

  const noDuplicate = await attachInsuranceAsk(
    { mode: "agent", reply: "수리센터를 안내해 드려요. 보험 추천해드릴까요?", repairCenters: [{ id: "daedong-cs", name: "대동 고객만족센터", phone: "1588-2172", url: "https://ko.daedong.co.kr/customer" }] },
    { asked: false, loadListings: async () => listings },
  );
  assert.equal(noDuplicate.insuranceAsk, undefined);
  assert.equal(noDuplicate.insuranceOffer.kind, "repair");
});
