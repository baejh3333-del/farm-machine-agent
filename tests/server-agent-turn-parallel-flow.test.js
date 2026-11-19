import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMockListings } from "../server/listing-seed.js";
import { runAgentTurn } from "../server/nongnong-agent.js";

const LISTINGS = buildMockListings();
const TODAY = "2026-11-16";
const rentable = LISTINGS.find((item) => item.type === "rent" && item.status === "open" && item.condition !== "repair");

function withKey(t) {
  const previous = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeWeatherResponse(start) {
  return {
    region: "영양읍",
    weather: { date: start, sky: "맑음", rainProb: 10, windMs: 2, tempMin: 5, tempMax: 15, source: "kma" },
    rangeForecast: [
      { date: start, sky: "맑음", rainProb: 10, windMs: 2, tempMin: 5, tempMax: 15, source: "kma" },
    ],
    weeklyForecast: [
      { date: start, sky: "맑음", rainProb: 10, windMs: 2, tempMin: 5, tempMax: 15, source: "kma" },
      { date: "2026-11-21", sky: "맑음", rainProb: 10, windMs: 2, tempMin: 5, tempMax: 15, source: "kma" },
    ],
  };
}

test("병렬 읽기 도구: 같은 라운드의 읽기 도구들이 동시에 시작되고 loadCatalog는 한 번만 호출되며 결과 순서를 유지한다", async (t) => {
  withKey(t);
  const catalogGate = deferred();
  const weatherGate = deferred();
  const myPageGate = deferred();

  let fetchCount = 0;
  const started = [];
  const followUpMessages = [];
  let recordedCalls = null;

  const maybeReleaseAll = () => {
    if (started.includes("catalog") && started.includes("weather") && started.includes("myPage")) {
      catalogGate.resolve(LISTINGS);
      weatherGate.resolve(makeWeatherResponse("2026-11-20"));
      myPageGate.resolve({ profile: { name: "김농부" } });
    }
  };

  const responses = [
    {
      content: [
        { type: "tool_use", id: "t_avail", name: "check_availability", input: { listingId: rentable.id, start: "2026-11-20", end: "2026-11-20" } },
        { type: "tool_use", id: "t_weather", name: "get_weather", input: { region: "영양읍", start: "2026-11-20", listingId: rentable.id } },
        { type: "tool_use", id: "t_cost", name: "calculate_cost", input: { listingId: rentable.id, start: "2026-11-20", end: "2026-11-20" } },
        { type: "tool_use", id: "t_mypage", name: "get_my_page", input: { sections: ["profile"] } },
      ],
    },
    { content: [{ type: "text", text: "예약 가능 여부와 날씨, 대여료를 모두 확인했어요." }] },
  ];

  const result = await runAgentTurn(
    "내 정보랑 11월 20일 예약·날씨·비용 같이 확인해 줘",
    { user: { id: "u-parallel-1", name: "김농부" }, farmProfile: null },
    {
      today: TODAY,
      timeoutMs: 2000,
      call: async ({ messages }) => {
        if (responses.length === 1) followUpMessages.push(messages.at(-1));
        return responses.shift() ?? null;
      },
      deps: {
        fetchListings: async () => {
          fetchCount += 1;
          started.push("catalog");
          maybeReleaseAll();
          return catalogGate.promise;
        },
        getWeather: async () => {
          started.push("weather");
          maybeReleaseAll();
          return weatherGate.promise;
        },
        getMyPageSnapshot: async () => {
          started.push("myPage");
          maybeReleaseAll();
          return myPageGate.promise;
        },
        onTurnComplete: ({ toolCalls }) => {
          recordedCalls = toolCalls;
        },
      },
    },
  );

  assert.equal(result.mode, "agent");
  assert.equal(fetchCount, 1, "동시 실행되는 check_availability·get_weather·calculate_cost가 카탈로그를 한 번만 조회해야 한다");
  assert.deepEqual(
    recordedCalls.map((c) => c.tool),
    ["check_availability", "get_weather", "calculate_cost", "get_my_page"],
    "toolCalls 기록은 원래 tool_use 순서를 유지해야 한다",
  );
  assert.deepEqual(
    followUpMessages[0].content.map((b) => b.tool_use_id),
    ["t_avail", "t_weather", "t_cost", "t_mypage"],
    "모델로 돌려주는 tool_result 블록도 원래 순서를 유지해야 한다",
  );
  assert.ok(result.weatherInfo, "병렬 실행 뒤에도 weatherInfo 상태가 반영되어야 한다");
});

test("단일 get_weather(listingId 포함): 매물 목록 조회와 날씨 API 호출이 서로 기다리지 않고 동시에 시작된다", async (t) => {
  withKey(t);
  const catalogGate = deferred();
  const weatherGate = deferred();
  const started = [];

  const maybeRelease = () => {
    if (started.includes("catalog") && started.includes("weather")) {
      catalogGate.resolve(LISTINGS);
      weatherGate.resolve(makeWeatherResponse("2026-11-20"));
    }
  };

  const responses = [
    { content: [{ type: "tool_use", id: "t1", name: "get_weather", input: { region: "영양읍", start: "2026-11-20", listingId: rentable.id } }] },
    { content: [{ type: "text", text: "11월 20일 영양읍은 맑아요." }] },
  ];

  const result = await runAgentTurn(
    "11월 20일 날씨 확인해 줘",
    { farmProfile: null },
    {
      today: TODAY,
      timeoutMs: 2000,
      call: async () => responses.shift() ?? null,
      deps: {
        fetchListings: async () => {
          started.push("catalog");
          maybeRelease();
          return catalogGate.promise;
        },
        getWeather: async () => {
          started.push("weather");
          maybeRelease();
          return weatherGate.promise;
        },
      },
    },
  );

  assert.equal(result.mode, "agent");
  assert.ok(started.includes("catalog") && started.includes("weather"));
  assert.equal(result.weatherInfo?.region, "영양읍");
});

test("초기 조회 병렬화: farmProfile과 viewingListingId 카탈로그 조회가 첫 모델 호출 전에 동시에 시작된다", async (t) => {
  withKey(t);
  const profileGate = deferred();
  const catalogGate = deferred();
  const started = [];

  const maybeRelease = () => {
    if (started.includes("profile") && started.includes("catalog")) {
      profileGate.resolve({ region: "영양읍", cropIds: ["pepper"], areaPyeong: 500 });
      catalogGate.resolve(LISTINGS);
    }
  };

  const result = await runAgentTurn(
    "이 매물 우리 밭에 맞나요?",
    { user: { id: "u-startup-1", name: "이농부" }, uiContext: { viewingListingId: rentable.id } },
    {
      today: TODAY,
      timeoutMs: 2000,
      call: async () => ({ content: [{ type: "text", text: "네, 500평 밭에 적합해요." }] }),
      deps: {
        loadFarmProfile: async () => {
          started.push("profile");
          maybeRelease();
          return profileGate.promise;
        },
        fetchListings: async () => {
          started.push("catalog");
          maybeRelease();
          return catalogGate.promise;
        },
      },
    },
  );

  assert.equal(result.mode, "agent");
  assert.ok(started.includes("profile") && started.includes("catalog"));
});

test("순차 보장: note_photo 뒤 prepare_listing_draft는 순서를 지키고, 쓰기 도구는 한 턴에 한 번만 실행된다", async (t) => {
  withKey(t);
  let rentalWrites = 0;
  const responses = [
    {
      content: [
        { type: "tool_use", id: "t1", name: "create_rental_request", input: { listingId: rentable.id, start: "2026-11-20", end: "2026-11-20" } },
        { type: "tool_use", id: "t2", name: "create_rental_request", input: { listingId: rentable.id, start: "2026-11-22", end: "2026-11-22" } },
      ],
    },
    { content: [{ type: "text", text: "첫 번째 예약만 접수했어요." }] },
  ];

  const result = await runAgentTurn(
    "네 예약해 주세요",
    { user: { id: "u-write-1", name: "박농부" }, farmProfile: null },
    {
      listings: LISTINGS,
      today: TODAY,
      call: async () => responses.shift() ?? null,
      deps: {
        createRentalRequest: async (_user, payload) => {
          rentalWrites += 1;
          return { request: { id: payload.id, days: 1, totalPrice: rentable.price } };
        },
      },
    },
  );

  assert.equal(rentalWrites, 1, "같은 라운드에 create_rental_request가 두 번 와도 실제 쓰기는 한 번만 실행되어야 한다");
  assert.equal(result.reservation?.listingId, rentable.id);
});

test("수리 문의: find_repair_centers가 이미 시도됐으면 finish에서 수리센터를 중복 조회하지 않는다", async (t) => {
  withKey(t);
  let officeCalls = 0;
  const responses = [
    {
      content: [
        { type: "tool_use", id: "t1", name: "get_repair_guide", input: { machineType: "tractor", symptom: "noStart" } },
        { type: "tool_use", id: "t2", name: "find_repair_centers", input: { region: "영양읍" } },
      ],
    },
    { content: [{ type: "text", text: "시동 점검 후 가까운 수리센터에 연락해 보세요." }] },
  ];

  const result = await runAgentTurn(
    "트랙터 시동이 안 걸려요 고장났어요",
    { region: "영양읍", farmProfile: null },
    {
      listings: LISTINGS,
      today: TODAY,
      call: async () => responses.shift() ?? null,
      fetchOffices: async () => {
        officeCalls += 1;
        return { configured: true, items: [] };
      },
    },
  );

  assert.equal(result.mode, "agent");
  assert.equal(officeCalls, 1, "수리센터 조회는 한 턴에 한 번만 호출되어야 한다");
  assert.ok(Array.isArray(result.repairCenters) && result.repairCenters.length > 0);
});
