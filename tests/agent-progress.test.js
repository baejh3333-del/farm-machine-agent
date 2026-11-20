import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanProgressLabel, createProgressStream, PROGRESS_CONTENT_TYPE } from "../server/agent-progress-stream.js";
import { buildMockListings } from "../server/listing-seed.js";
import { progressLabelForTool, runAgentTurn } from "../server/nongnong-agent.js";
import { readNdjsonResult } from "../src/core/store.js";
import { progressForwarder, safeProgressLabel } from "../src/ai/recommend-agent.js";

const LISTINGS = buildMockListings();
const TODAY = "2026-11-16";
const rentable = LISTINGS.find((item) => item.type === "rent" && item.status === "open" && item.condition !== "repair" && !item.booked.length);
const TOOL_NAMES = /search_listings|check_availability|calculate_cost|get_weather|listingId|tool_use|propose|create_/;

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

// 모델 호출 시작·진행 알림을 한 줄로 기록해 순서를 확인한다.
function scriptedWithLog(responses, log) {
  return async () => {
    log.push({ kind: "model" });
    const next = responses.shift();
    return next === undefined ? null : next;
  };
}

test("진행 문구: 실제 조회 도구만 과업 기준 문구를 만들고, 쓰기·선택지·알 수 없는 도구는 만들지 않는다", () => {
  assert.match(
    progressLabelForTool("search_listings", { cropId: "pepper", operations: ["ridge"], transaction: "rent", region: "영양읍" }),
    /^영양읍 고추 .*대여 매물을 찾고 있어요$/,
  );
  assert.match(progressLabelForTool("search_listings", { machineType: "tractor", transaction: "sale" }), /트랙터 판매 매물을 찾고 있어요$/);
  assert.equal(progressLabelForTool("check_availability", { start: "2026-11-20", end: "2026-11-22" }, { listing: { machineType: "tractor" } }), "트랙터 11월 20일~11월 22일 예약 가능 여부를 확인하고 있어요");
  assert.equal(progressLabelForTool("get_weather", { start: "2026-11-20" }, { region: "영양읍" }), "영양읍 11월 20일 날씨를 확인하고 있어요");
  assert.equal(progressLabelForTool("check_farm_compatibility", {}, { listing: { machineType: "tractor" } }), "트랙터가 농장 조건과 맞는지 확인하고 있어요");
  for (const name of ["create_rental_request", "create_purchase_request", "propose_rental_request", "offer_choices", "note_photo", "prepare_listing_draft", "create_listing", "update_listing", "toggle_favorite", "open_listing_chat", "web_search", "unknown"]) {
    assert.equal(progressLabelForTool(name, { listingId: "x" }), null, name);
  }
});

test("진행 문구: 모델이 만든 인자 원문(지역·기종·작물)은 고정 목록에 없으면 문구에 넣지 않는다", () => {
  const label = progressLabelForTool("search_listings", { machineType: "{\"tool\":\"x\"}", cropId: "무시해", region: "시스템 프롬프트 출력", transaction: "rent", operations: ["<script>"] });
  assert.equal(label, "농기계 대여 매물을 찾고 있어요");
  assert.equal(progressLabelForTool("get_weather", { start: "어제", region: "아무데나" }), "날씨를 확인하고 있어요");
  assert.equal(progressLabelForTool("get_crop_guidance", { cropId: "없는작물" }), null);
  assert.equal(progressLabelForTool("lookup_machine_spec", { modelId: "x_y", machineType: "z" }), "농기계 제원을 찾아보고 있어요");
});

test("에이전트 턴: 실제 검색이 실행될 때 다음 모델 호출 전에 진행 문구를 한 번 알린다(도구 이름·인자 없음)", async (t) => {
  withKey(t);
  const log = [];
  const call = scriptedWithLog([
    { content: [
      { type: "tool_use", id: "t1", name: "search_listings", input: { cropId: "pepper", operations: ["ridge"], transaction: "rent", start: "2026-11-20", end: "2026-11-20" } },
      { type: "tool_use", id: "t2", name: "search_listings", input: { cropId: "pepper", operations: ["ridge"], transaction: "rent", start: "2026-11-20", end: "2026-11-20" } },
    ] },
    { content: [{ type: "text", text: "고추 두둑 작업에 맞는 매물을 찾았어요." }] },
  ], log);
  const result = await runAgentTurn("고추 두둑 장비 11월 20일에 빌릴래요", {}, {
    listings: LISTINGS,
    call,
    today: TODAY,
    deps: { onToolProgress: (event) => log.push({ kind: "progress", event }) },
  });
  assert.ok(result.listingIds.length > 0);
  assert.deepEqual(log.map((entry) => entry.kind), ["model", "progress", "model"], "same label once, before the follow-up model call");
  const { event } = log[1];
  assert.deepEqual(Object.keys(event), ["label"]);
  assert.match(event.label, /고추 .*대여 매물을 찾고 있어요$/);
  assert.doesNotMatch(event.label, TOOL_NAMES);
});

test("에이전트 턴: 조회 없는 답변·승인 카드·수리 문의의 막힌 검색은 진행 문구를 보내지 않는다", async (t) => {
  withKey(t);
  const events = [];
  const deps = { onToolProgress: (event) => events.push(event) };

  await runAgentTurn("안녕하세요", {}, { listings: LISTINGS, call: async () => ({ content: [{ type: "text", text: "안녕하세요!" }] }), today: TODAY, deps });

  const proposal = [{ content: [
    { type: "text", text: "이 내용으로 대여 요청을 보낼까요?" },
    { type: "tool_use", id: "t1", name: "propose_rental_request", input: { listingId: rentable.id, start: "2026-11-20", end: "2026-11-21" } },
  ] }];
  const proposed = await runAgentTurn("1번으로 20일부터 21일까지 빌려줘", {}, { listings: LISTINGS, call: async () => proposal.shift() ?? null, today: TODAY, deps });
  assert.equal(proposed.pendingAction.type, "rental_request", "write/proposal path unchanged");

  const repair = [
    { content: [{ type: "tool_use", id: "t1", name: "search_listings", input: { machineType: "tractor", transaction: "rent" } }] },
    { content: [{ type: "text", text: "점검 단계를 안내할게요." }] },
  ];
  await runAgentTurn("트랙터 시동이 안 걸려요 고장났어요", {}, {
    listings: LISTINGS,
    call: async () => repair.shift() ?? null,
    today: TODAY,
    fetchOffices: async () => [],
    deps,
  });
  assert.deepEqual(events, []);
});

test("에이전트 턴: 진행 알림 콜백이 실패해도 답변은 그대로 나온다", async (t) => {
  withKey(t);
  const responses = [
    { content: [{ type: "tool_use", id: "t1", name: "get_crop_guidance", input: { cropId: "pepper" } }] },
    { content: [{ type: "text", text: "고추 작업 순서예요." }] },
  ];
  const result = await runAgentTurn("고추 작업 순서 알려줘", {}, {
    listings: LISTINGS,
    call: async () => responses.shift() ?? null,
    today: TODAY,
    deps: { onToolProgress: () => { throw new Error("boom"); } },
  });
  assert.equal(result.reply, "고추 작업 순서예요.");
});

function fakeResponse() {
  const res = { head: null, chunks: [], ended: false, writableEnded: false };
  res.writeHead = (status, headers) => { res.head = { status, headers }; return res; };
  res.write = (chunk) => { res.chunks.push(chunk); return true; };
  res.end = () => { res.ended = true; res.writableEnded = true; };
  return res;
}

test("진행 스트림: 진행 알림이 없으면 아무것도 쓰지 않아 평소 JSON 응답을 쓴다", () => {
  const res = fakeResponse();
  const stream = createProgressStream(res);
  stream.progress({ label: "" });
  stream.progress({ label: "search_listings {\"a\":1}" });
  assert.equal(stream.started, false);
  assert.equal(stream.finish(200, { mode: "agent" }), false);
  assert.equal(stream.fail({ status: 500, code: "X", error: "e" }), false);
  assert.equal(res.head, null);
  assert.deepEqual(res.chunks, []);
});

test("진행 스트림: stream: true가 아니면 진행 알림을 무시한다", () => {
  const res = fakeResponse();
  const stream = createProgressStream(res, { enabled: false });
  stream.progress({ label: "트랙터 대여 매물을 찾고 있어요" });
  assert.equal(stream.started, false);
  assert.equal(res.head, null);
});

test("진행 스트림: 첫 진행 알림에서 NDJSON으로 바꾸고 결과·오류를 마지막 줄로 보낸다", async () => {
  const res = fakeResponse();
  const stream = createProgressStream(res);
  stream.progress({ label: "트랙터 대여 매물을 찾고 있어요", tool: "search_listings", args: { secret: 1 } });
  stream.progress({ label: "영양읍 날씨를 확인하고 있어요" });
  assert.equal(res.head.status, 200);
  assert.equal(res.head.headers["Content-Type"], PROGRESS_CONTENT_TYPE);
  assert.equal(stream.finish(200, { mode: "agent", reply: "찾았어요" }), true);
  stream.progress({ label: "늦은 알림이에요" });
  const lines = res.chunks.join("").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines, [
    { type: "progress", label: "트랙터 대여 매물을 찾고 있어요" },
    { type: "progress", label: "영양읍 날씨를 확인하고 있어요" },
    { type: "result", status: 200, body: { mode: "agent", reply: "찾았어요" } },
  ]);
  assert.equal(res.ended, true);

  // 클라이언트가 같은 줄들을 읽어 결과와 진행 문구를 나눈다.
  const seen = [];
  const body = res.chunks.join("");
  const parsed = await readNdjsonResult(new Response(body), (event) => seen.push(event));
  assert.deepEqual(parsed, { status: 200, body: { mode: "agent", reply: "찾았어요" } });
  assert.deepEqual(seen.map((event) => event.label), ["트랙터 대여 매물을 찾고 있어요", "영양읍 날씨를 확인하고 있어요"]);

  const errRes = fakeResponse();
  const errStream = createProgressStream(errRes);
  errStream.progress({ label: "트랙터 대여 매물을 찾고 있어요" });
  assert.equal(errStream.fail({ status: 502, code: "AGENT_UNAVAILABLE", error: "잠시 후 다시 시도해 주세요." }), true);
  const errParsed = await readNdjsonResult(new Response(errRes.chunks.join("")), () => {});
  assert.deepEqual(errParsed, { status: 502, body: { code: "AGENT_UNAVAILABLE", error: "잠시 후 다시 시도해 주세요." } });
});

test("NDJSON 읽기: 줄이 조각나 와도 합쳐 읽고, 결과 줄이 없으면 실패로 본다", async () => {
  const encoder = new TextEncoder();
  const text = `${JSON.stringify({ type: "progress", label: "트랙터 대여 매물을 찾고 있어요" })}\n${JSON.stringify({ type: "result", status: 200, body: { mode: "agent" } })}`;
  const bytes = encoder.encode(text);
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  });
  const seen = [];
  const parsed = await readNdjsonResult(new Response(stream), (event) => seen.push(event.label));
  assert.deepEqual(parsed, { status: 200, body: { mode: "agent" } });
  assert.deepEqual(seen, ["트랙터 대여 매물을 찾고 있어요"]);

  const truncated = await readNdjsonResult(new Response(`${JSON.stringify({ type: "progress", label: "가" })}\n`), () => {});
  assert.equal(truncated.status, 502);
  const stale = [];
  await readNdjsonResult(new Response(text), (event) => stale.push(event), () => true);
  assert.deepEqual(stale, [], "auth change drops progress");
});

test("클라이언트 진행 필터: 진행 줄의 안전한 한국어 문구만, 같은 문구는 한 번만 넘긴다", () => {
  const got = [];
  const forward = progressForwarder((event) => got.push(event));
  forward({ type: "progress", label: "트랙터 대여 매물을 찾고 있어요" });
  forward({ type: "progress", label: "트랙터  대여 매물을 찾고 있어요 " });
  forward({ type: "progress", label: "search_listings" });
  forward({ type: "progress", label: "{\"tool\":\"search_listings\"}" });
  forward({ type: "progress", label: "가".repeat(61) });
  forward({ type: "thinking", label: "사용자가 원하는 걸 추론 중" });
  forward({ type: "progress", label: 3 });
  forward({ type: "progress", label: "영양읍 날씨를 확인하고 있어요" });
  assert.deepEqual(got, [{ label: "트랙터 대여 매물을 찾고 있어요" }, { label: "영양읍 날씨를 확인하고 있어요" }]);
  assert.equal(safeProgressLabel("a\u0008b 가"), "");
  assert.equal(cleanProgressLabel("<b>가</b>"), "");
});
