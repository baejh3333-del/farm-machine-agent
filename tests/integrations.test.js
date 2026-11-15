import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountAuthOptions, buildSocialProvidersConfig, getEnabledSocialProviders } from "../server/account-auth.js";
import {
  buildAlimtalkMessage,
  buildSolapiAuthHeader,
  normalizeKoreanPhone,
  sendAlimtalk,
} from "../server/integrations/alimtalk.js";
import { getIntegrationStatus } from "../server/integrations/index.js";
import {
  fetchCropGuidance,
  parseNongsaroXmlItems,
  resetNongsaroCache,
} from "../server/integrations/nongsaro.js";
import {
  fetchRentalOffices,
  normalizeRentalOffice,
  resetRentalOfficeCache,
} from "../server/integrations/rental-offices.js";

test("알림톡: 한국 휴대폰 번호 정규화 및 잘못된 번호 거부", () => {
  assert.equal(normalizeKoreanPhone("010-1234-5678"), "01012345678");
  assert.equal(normalizeKoreanPhone("+82 10-9876-5432"), "01098765432");
  assert.equal(normalizeKoreanPhone("02-123-4567"), "");
  assert.equal(normalizeKoreanPhone("invalid"), "");
});

test("알림톡: 템플릿 메시지 생성 및 Solapi HMAC 헤더 형식 검증", () => {
  const msg = buildAlimtalkMessage("rental_requested", {
    requesterName: "홍길동",
    listingTitle: "대동 트랙터 55마력",
    start: "2026-11-20",
    end: "2026-11-22",
  });
  assert.match(msg.text, /홍길동/);
  assert.match(msg.text, /대동 트랙터 55마력/);
  assert.equal(msg.variables["#{start}"], "2026-11-20");

  const header = buildSolapiAuthHeader("key123", "secret456", {
    date: "2026-11-15T00:00:00.000Z",
    salt: "salt789",
  });
  assert.match(header, /^HMAC-SHA256 apiKey=key123, date=2026-11-15T00:00:00\.000Z, salt=salt789, signature=[a-f0-9]{64}$/);
});

test("알림톡: 미설정 시 NOT_CONFIGURED 반환 및 설정 시 전송 요청 수행", async () => {
  const unconfigured = await sendAlimtalk({
    to: "010-1111-2222",
    templateKey: "rental_approved",
    variables: { listingTitle: "관리기", start: "2026-11-20", end: "2026-11-21" },
    env: {},
  });
  assert.equal(unconfigured.sent, false);
  assert.equal(unconfigured.reason, "NOT_CONFIGURED");
  assert.match(unconfigured.preview, /승인/);

  let capturedRequest = null;
  const sent = await sendAlimtalk({
    to: "010-1111-2222",
    templateKey: "chat_message",
    variables: { senderName: "김농부", listingTitle: "이앙기", preview: "내일 오전 9시 가능할까요?" },
    env: {
      KAKAO_ALIMTALK_API_KEY: "api-key",
      KAKAO_ALIMTALK_API_SECRET: "api-secret",
      KAKAO_ALIMTALK_PF_ID: "pf-id",
      KAKAO_ALIMTALK_SENDER_PHONE: "010-0000-0000",
      KAKAO_ALIMTALK_TPL_CHAT_MESSAGE: "TPL_CHAT_01",
    },
    fetchImpl: async (url, init) => {
      capturedRequest = { url, init: { ...init, body: JSON.parse(init.body) } };
      return new Response(JSON.stringify({ messageId: "msg-123" }), { status: 200 });
    },
  });
  assert.equal(sent.sent, true);
  assert.equal(sent.messageId, "msg-123");
  assert.equal(capturedRequest.init.body.message.to, "01011112222");
  assert.equal(capturedRequest.init.body.message.kakaoOptions.templateId, "TPL_CHAT_01");
});

test("공공데이터포털 임대사업소 API: 미설정 폴백, 응답 정규화 및 캐시 동작", async () => {
  resetRentalOfficeCache();
  const empty = await fetchRentalOffices({ region: "영양", env: {} });
  assert.equal(empty.configured, false);
  assert.deepEqual(empty.items, []);

  const normalized = normalizeRentalOffice({
    officeNm: "영양군 농업기술센터 임대사업소",
    ctprvnNm: "경상북도",
    signguNm: "영양군",
    rdnmadr: "경북 영양군 영양읍 군민회관길 1",
    phoneNumber: "054-680-5200",
    holdMachn: "트랙터, 관리기, 감자수확기",
    rentFee: "1일 20,000원",
  });
  assert.equal(normalized.region, "경상북도 영양군");
  assert.deepEqual(normalized.machines, ["트랙터", "관리기", "감자수확기"]);
  assert.equal(normalized.source, "data.go.kr");

  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        response: {
          body: {
            totalCount: 2,
            items: {
              item: [
                { officeNm: "영양군 본소", ctprvnNm: "경상북도", signguNm: "영양군", holdMachn: "트랙터, 콤바인" },
                { officeNm: "안동시 북부분소", ctprvnNm: "경상북도", signguNm: "안동시", holdMachn: "관리기" },
              ],
            },
          },
        },
      }),
      { status: 200 },
    );
  };

  const env = { DATA_GO_KR_SERVICE_KEY: "test-key" };
  const first = await fetchRentalOffices({ region: "영양", machineType: "트랙터", env, fetchImpl: mockFetch, now: 1000 });
  const second = await fetchRentalOffices({ region: "영양", machineType: "트랙터", env, fetchImpl: mockFetch, now: 2000 });
  assert.equal(first.configured, true);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].officeName, "영양군 본소");
  assert.equal(second.items.length, 1);
  assert.equal(fetchCalls, 1);
});

test("농촌진흥청 농사로 Open API: XML 파싱 및 미설정 폴백", async () => {
  resetNongsaroCache();
  const empty = await fetchCropGuidance({ cropName: "고추", env: {} });
  assert.equal(empty.configured, false);
  assert.deepEqual(empty.items, []);

  const xml = `
    <response>
      <body>
        <items>
          <item>
            <cntntsNo>1001</cntntsNo>
            <subject><![CDATA[고추 정식 및 멀칭 작업 안내]]></subject>
            <sCropNm>고추</sCropNm>
            <regDt>2026-04-10</regDt>
          </item>
        </items>
      </body>
    </response>
  `;
  const parsed = parseNongsaroXmlItems(xml);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].subject, "고추 정식 및 멀칭 작업 안내");

  const result = await fetchCropGuidance({
    cropName: "고추",
    env: { NONGSARO_API_KEY: "nongsaro-key" },
    fetchImpl: async () => new Response(xml, { status: 200 }),
  });
  assert.equal(result.configured, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].cropName, "고추");
  assert.equal(result.items[0].source, "nongsaro");
});

test("소셜 로그인 및 통합 상태: 카카오/네이버 설정 여부 반영 및 비밀값 비노출", () => {
  assert.deepEqual(getEnabledSocialProviders({}), { kakao: false, naver: false });
  assert.deepEqual(buildSocialProvidersConfig({}), {});

  const env = {
    KAKAO_CLIENT_ID: "kakao-id",
    KAKAO_CLIENT_SECRET: "kakao-secret",
    NAVER_CLIENT_ID: "naver-id",
    NAVER_CLIENT_SECRET: "naver-secret",
  };
  assert.deepEqual(getEnabledSocialProviders(env), { kakao: true, naver: true });
  const options = buildAccountAuthOptions({ database: {}, secret: "s".repeat(32), baseURL: "http://localhost:3000", env });
  assert.equal(options.socialProviders.kakao.clientId, "kakao-id");
  assert.equal(options.socialProviders.naver.clientId, "naver-id");

  const kakaoFallback = options.socialProviders.kakao.mapProfileToUser({ id: 99999 });
  assert.equal(kakaoFallback.name, "카카오회원_99999");
  assert.equal(kakaoFallback.email, "kakao_99999@users.moa-farm.example.com");

  const naverFallback = options.socialProviders.naver.mapProfileToUser({ response: { id: "abc" } });
  assert.equal(naverFallback.name, "네이버회원_abc");
  assert.equal(naverFallback.email, "naver_abc@users.moa-farm.example.com");

  const status = getIntegrationStatus(env);
  assert.deepEqual(status, {
    alimtalk: false,
    rentalOffices: false,
    nongsaro: false,
    socialAuth: { kakao: true, naver: true },
  });
});
