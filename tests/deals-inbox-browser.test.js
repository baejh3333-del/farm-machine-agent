import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startStaticServer } from "./helpers/live-voice-page.js";

const ME = { id: "u-buyer", name: "김농부", email: "buyer@example.com", phone: "010-1111-2222" };
const OWNER_A = { id: "u-owner-a", name: "박농부" };
const OWNER_B = { id: "u-owner-b", name: "이농부" };

function createMockBackend() {
  const conversations = {
    "c-old-alert": {
      id: "c-old-alert",
      listingId: "l-old",
      listingTitle: "구형 관리기 대여",
      listingType: "rent",
      ownerId: OWNER_A.id,
      ownerName: OWNER_A.name,
      buyerId: ME.id,
      buyerName: ME.name,
      myRole: "buyer",
      stage: "negotiating",
      lastSeq: 2,
      myLastReadSeq: 1,
      unreadCount: 1,
      updatedAt: "2026-11-18T01:00:00Z",
      lastMessage: {
        seq: 2,
        senderId: OWNER_A.id,
        senderName: OWNER_A.name,
        senderKind: "human",
        senderRole: "owner",
        body: "주말에 9만원이면 가능할 것 같아요",
        createdAt: "2026-11-18T01:00:00Z",
      },
      negotiation: {
        termsVersion: 2,
        currentOffer: {
          id: "offer-1",
          termsVersion: 2,
          fromRole: "owner",
          senderKind: "human",
          amount: 90000,
          amountUnit: "total",
          transportPayer: "none",
          transportFee: 0,
          totalAmount: 90000,
          termsComplete: true,
          status: "open",
          acceptedByOwner: true,
          acceptedByBuyer: false,
        },
        offers: [
          {
            id: "offer-1",
            termsVersion: 2,
            fromRole: "owner",
            senderKind: "human",
            amount: 90000,
            amountUnit: "total",
            transportPayer: "none",
            transportFee: 0,
            totalAmount: 90000,
            termsComplete: true,
            status: "open",
            acceptedByOwner: true,
            acceptedByBuyer: false,
          },
        ],
      },
      order: null,
    },
    "c-newest": {
      id: "c-newest",
      listingId: "l-new",
      listingTitle: "트랙터 MF-35",
      listingType: "rent",
      ownerId: OWNER_B.id,
      ownerName: OWNER_B.name,
      buyerId: ME.id,
      buyerName: ME.name,
      myRole: "buyer",
      stage: "inquiry",
      lastSeq: 1,
      myLastReadSeq: 0,
      unreadCount: 1,
      updatedAt: "2026-11-18T05:00:00Z",
      lastMessage: {
        seq: 1,
        senderId: OWNER_B.id,
        senderName: OWNER_B.name,
        senderKind: "human",
        senderRole: "owner",
        body: "안녕하세요, 토요일 오전 인수 가능합니다.",
        createdAt: "2026-11-18T05:00:00Z",
      },
      negotiation: { termsVersion: 0, currentOffer: null, offers: [] },
      order: null,
    },
  };

  const messages = {
    "c-old-alert": [
      {
        seq: 1,
        senderId: ME.id,
        senderName: ME.name,
        senderKind: "human",
        senderRole: "buyer",
        body: "이번 주말 대여 가능할까요?",
        createdAt: "2026-11-18T00:30:00Z",
      },
      conversations["c-old-alert"].lastMessage,
    ],
    "c-newest": [
      conversations["c-newest"].lastMessage,
    ],
  };

  const calls = [];

  async function install(page) {
    await page.route("**/api/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (path === "/api/account") return route.fulfill({ json: { user: ME, providers: { kakao: false, naver: false } } });
      if (path === "/api/me") return route.fulfill({ json: { user: ME, favorites: [], ownedMachines: [] } });
      if (path === "/api/listings") return route.fulfill({ json: { listings: [] } });
      if (path === "/api/requests") return route.fulfill({ json: { incoming: [], outgoing: [], approvableCount: 0 } });
      if (path === "/api/rentals") return route.fulfill({ json: { incoming: [], outgoing: [] } });
      if (path === "/api/favorites") return route.fulfill({ json: { ids: [] } });
      if (path === "/api/conversations") {
        if (req.method() === "GET") {
          const cid = url.searchParams.get("conversationId");
          if (!cid) {
            return route.fulfill({ json: { conversations: Object.values(conversations) } });
          }
          const afterSeq = Number(url.searchParams.get("after_seq") || 0);
          const conv = conversations[cid] || null;
          const list = (messages[cid] || []).filter((m) => m.seq > afterSeq);
          calls.push({ method: "GET", conversationId: cid, afterSeq });
          return route.fulfill({ json: { conversation: conv, messages: list } });
        }
        if (req.method() === "POST") {
          const body = req.postDataJSON();
          calls.push({ method: "POST", ...body });
          const conv = conversations[body.conversationId];
          if (!conv) return route.fulfill({ status: 404, json: { error: "not found" } });
          if (body.action === "mark_read") {
            conv.myLastReadSeq = Math.max(conv.myLastReadSeq || 0, Number(body.readSeq) || 0);
            conv.unreadCount = 0;
            return route.fulfill({ json: { conversation: conv } });
          }
          if (body.action === "send") {
            const nextSeq = (conv.lastSeq || 0) + 1;
            const now = new Date(Date.parse("2026-11-18T06:00:00Z") + nextSeq * 1000).toISOString();
            const msg = {
              seq: nextSeq,
              senderId: ME.id,
              senderName: ME.name,
              senderKind: "human",
              senderRole: "buyer",
              body: body.body,
              createdAt: now,
            };
            messages[conv.id].push(msg);
            conv.lastSeq = nextSeq;
            conv.lastMessage = msg;
            conv.updatedAt = now;
            return route.fulfill({ json: { message: msg, conversation: conv } });
          }
          if (body.action === "accept_offer") {
            const offer = conv.negotiation.currentOffer;
            offer.acceptedByBuyer = true;
            offer.status = "accepted";
            conv.negotiation.agreed = offer;
            conv.stage = "agreed";
            return route.fulfill({ json: { conversation: conv } });
          }
          return route.fulfill({ json: { conversation: conv } });
        }
      }
      return route.fulfill({ json: {} });
    });
  }

  function pushIncoming(cid, body) {
    const conv = conversations[cid];
    const nextSeq = (conv.lastSeq || 0) + 1;
    const now = new Date(Date.parse("2026-11-18T07:00:00Z") + nextSeq * 1000).toISOString();
    const msg = {
      seq: nextSeq,
      senderId: conv.ownerId,
      senderName: conv.ownerName,
      senderKind: "human",
      senderRole: "owner",
      body,
      createdAt: now,
    };
    messages[cid].push(msg);
    conv.lastSeq = nextSeq;
    conv.lastMessage = msg;
    conv.updatedAt = now;
    conv.unreadCount = (conv.unreadCount || 0) + 1;
    return msg;
  }

  return { conversations, messages, calls, install, pushIncoming };
}

test("거래 메시지함: 최근순 단순 행, 직접 채팅 컴포저 즉시 표시, 거래 전담 UI 없음, 방 간 초안/포커스/폴링 유지", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const backend = createMockBackend();
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await backend.install(page);

    await page.goto(`http://127.0.0.1:${server.address().port}/#/deals`);
    await page.locator("#dealsList .deal-inbox-row").first().waitFor({ state: "visible" });

    // 1) 최근순 정렬(오래된 확인 필요 방보다 최신 방이 먼저) + 그룹 헤더 없음 + 단순 매물명/마지막 채팅 미리보기
    assert.equal(await page.locator("#dealsList .deals-group-title").count(), 0, "확인 필요/진행 중 그룹 분할 없이 단일 최근순 목록이어야 한다");
    const rowIds = await page.locator("#dealsList .deal-inbox-row").evaluateAll((els) => els.map((e) => e.dataset.dealOpen));
    assert.deepEqual(rowIds, ["c-newest", "c-old-alert"]);

    const firstRow = page.locator('#dealsList .deal-inbox-row[data-deal-open="c-newest"]');
    assert.equal(await firstRow.locator(".deal-card-title").textContent(), "트랙터 MF-35");
    assert.equal(await firstRow.locator(".deal-card-last").textContent(), "안녕하세요, 토요일 오전 인수 가능합니다.");
    assert.equal(await firstRow.locator(".deal-mini-steps, .deal-role-chip, .deal-ai-badge, .deal-card-offer, .deal-card-next").count(), 0, "메시지함 행에는 불필요한 배지·스텝퍼·제안 줄이 없어야 한다");

    // 2) 행 선택 시 바로 직접 채팅 + 컴포저 표시, 거래 전담(위임) UI는 존재하지 않음
    await firstRow.click();
    await page.locator("#dealComposerInput").waitFor({ state: "visible" });
    assert.equal(await page.locator("#dealPolicyForm, #dealDelegationPanel, [data-deal-delegation-toggle], .btn-delegated-trade, [data-deal-takeover], [data-deal-resume]").count(), 0, "거래 전담·위임 UI가 남아 있으면 안 된다");
    assert.equal(await page.locator("[data-deals-filter=\"ai\"]").count(), 0, "농농이 진행 중 필터는 제거되어야 한다");
    assert.equal(await page.locator("[data-deal-open-chat]").isVisible(), true, "1:1 대화 창 버튼은 유지되어야 한다");

    // 읽음 처리 호출 확인
    await page.waitForFunction(() => document.querySelector('#dealsList .deal-inbox-row[data-deal-open="c-newest"] .deal-unread-dot') === null);
    assert.ok(backend.calls.some((c) => c.method === "POST" && c.action === "mark_read" && c.conversationId === "c-newest" && c.readSeq === 1));

    // 4) 방 간 초안 분리
    await page.locator("#dealComposerInput").fill("트랙터 초안입니다");
    const secondRow = page.locator('#dealsList .deal-inbox-row[data-deal-open="c-old-alert"]');
    await secondRow.click();
    await page.locator("#dealMsgLog", { hasText: "주말에 9만원이면 가능할 것 같아요" }).waitFor({ state: "visible" });

    assert.equal(await page.locator("#dealComposerInput").inputValue(), "", "다른 방으로 이동하면 이전 방 초안이 섞이지 않아야 한다");

    // 기존 거래 기능(진행·제안 수락) 보존 확인
    await page.locator('[data-deal-accept="offer-1"]').click();
    await page.waitForTimeout(100);
    assert.ok(backend.calls.some((c) => c.method === "POST" && c.action === "accept_offer" && c.conversationId === "c-old-alert"));

    // 5) 두 번째 방 초안 입력 후 첫 번째 방 복귀 -> 첫 번째 방 초안 복원
    await page.locator("#dealComposerInput").fill("관리기 초안입니다");
    await firstRow.click();
    await page.locator("#dealMsgLog", { hasText: "안녕하세요, 토요일 오전 인수 가능합니다." }).waitFor({ state: "visible" });
    assert.equal(await page.locator("#dealComposerInput").inputValue(), "트랙터 초안입니다", "첫 번째 방 초안이 그대로 복원되어야 한다");

    // 6) 컴포저 포커스/입력 중 폴링으로 상대 메시지 도착 시 포커스·커서·초안 유지 + 읽음 자동 호출 안 함
    const input = page.locator("#dealComposerInput");
    await input.focus();
    const markReadsBeforePoll = backend.calls.filter((c) => c.method === "POST" && c.action === "mark_read").length;
    backend.pushIncoming("c-newest", "토요일 10시 괜찮으세요?");

    // DETAIL_POLL_MS(4s) 대기 또는 visibilitychange 트리거로 폴링 실행
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.locator("[data-deal-show-new]").waitFor({ state: "visible" });
    assert.equal(await input.inputValue(), "트랙터 초안입니다", "폴링 중 작성 중인 초안이 지워지지 않아야 한다");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "dealComposerInput", "폴링 중 컴포저 포커스가 유지되어야 한다");
    assert.equal(
      backend.calls.filter((c) => c.method === "POST" && c.action === "mark_read").length,
      markReadsBeforePoll,
      "폴링으로 도착한 메시지는 새 메시지 보기를 누르기 전에 읽음 처리하지 않아야 한다",
    );

    // 새 메시지 보기 클릭 시 메시지 표시 + 읽음 처리
    await page.locator("[data-deal-show-new]").click();
    await page.locator("#dealMsgLog", { hasText: "토요일 10시 괜찮으세요?" }).waitFor({ state: "visible" });
    assert.ok(backend.calls.some((c) => c.method === "POST" && c.action === "mark_read" && c.conversationId === "c-newest" && c.readSeq === 2));

    // 7) Enter 키로 직접 메시지 전송 -> 메시지 표시, 컴포저 비움/유지, 목록 미리보기 갱신
    await input.focus();
    await input.press("Enter");
    await page.locator("#dealMsgLog", { hasText: "트랙터 초안입니다" }).waitFor({ state: "visible" });
    assert.equal(await input.inputValue(), "");
    assert.equal(await input.isVisible(), true, "전송 후에도 컴포저가 계속 보여야 한다");
    assert.equal(await firstRow.locator(".deal-card-last").textContent(), "트랙터 초안입니다");
    assert.equal(backend.calls.some((c) => c.method === "POST" && ["update_ai_policy", "takeover", "resume", "dismiss_ai_draft", "retry_ai_job"].includes(c.action)), false, "AI 대리 응대 액션을 호출하면 안 된다");

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("거래 메시지함 키보드·모바일: Enter로 방 진입, 모바일에서 컴포저·뒤로가기 초안 유지", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const backend = createMockBackend();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await backend.install(page);

    await page.goto(`http://127.0.0.1:${server.address().port}/#/deals`);
    const firstRow = page.locator('#dealsList .deal-inbox-row[data-deal-open="c-newest"]');
    await firstRow.waitFor({ state: "visible" });

    // 키보드 Enter로 방 열기
    await firstRow.focus();
    await page.keyboard.press("Enter");
    await page.locator("#dealComposerInput").waitFor({ state: "visible" });
    assert.equal(await page.locator(".deals-list-pane").isHidden(), true, "모바일에서 상세 진입 시 목록이 숨겨져야 한다");
    assert.equal(await page.locator("#dealPolicyForm, [data-deal-delegation-toggle]").count(), 0);

    // 초안 입력 후 목록으로 돌아갔다가 다시 열어도 초안 유지
    await page.locator("#dealComposerInput").fill("모바일 초안");
    await page.locator("[data-deal-back]").click();
    await firstRow.waitFor({ state: "visible" });
    await firstRow.click();
    await page.locator("#dealComposerInput").waitFor({ state: "visible" });
    assert.equal(await page.locator("#dealComposerInput").inputValue(), "모바일 초안");

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
