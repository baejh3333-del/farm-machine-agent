import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";

async function startStatic() {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw new Error("invalid path");
      const bytes = await readFile(new URL(`../${file}`, import.meta.url));
      const type = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".json")
          ? "application/json"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html";
      res.setHeader("content-type", type);
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

const BUYER_USER = { id: "u-buyer", username: "buyer1", name: "김구매", role: "member", region: "홍천 비발디파크" };
const OWNER_USER = { id: "u-owner", username: "owner1", name: "박소유", role: "member", region: "홍천 비발디파크" };

const BASE_RENT_LISTING = listListings().find((l) => l.type === "rent" && l.status === "open");
const SAMPLE_LISTINGS = [
  {
    ...BASE_RENT_LISTING,
    id: "lst-1",
    ownerId: OWNER_USER.id,
    ownerName: OWNER_USER.name,
    title: "대동 관리기 + 두둑성형기",
    price: 50000,
    owner: false,
    demo: false,
    booked: [],
  },
];

function createConversationFixture(overrides = {}) {
  return {
    id: "conv-1",
    listingId: "lst-1",
    listingTitle: "대동 관리기 + 두둑성형기",
    listingType: "rent",
    ownerId: OWNER_USER.id,
    ownerName: OWNER_USER.name,
    buyerId: BUYER_USER.id,
    buyerName: BUYER_USER.name,
    buyerAiMode: "off",
    ownerAiMode: "off",
    buyerAiPolicy: {},
    ownerAiPolicy: {},
    lastSeq: 1,
    lastMessage: { seq: 1, body: "토요일 오전 9시 인수 가능할까요?", senderId: BUYER_USER.id, senderKind: "human" },
    ...overrides,
  };
}

async function setupMockedPage(browser, port, { user, conversations, messagesByConv }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  const apiPosts = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path === "/api/account") {
      return route.fulfill({ json: { user, providers: { kakao: false, naver: false } } });
    }
    if (path === "/api/me") {
      return route.fulfill({ json: { user, favorites: [], ownedMachines: [], selectedOwnedMachineId: "" } });
    }
    if (path === "/api/listings") {
      return route.fulfill({ json: { listings: SAMPLE_LISTINGS } });
    }
    if (path === "/api/favorites") {
      return route.fulfill({ json: { favorites: [] } });
    }
    if (path === "/api/owned-machines") {
      return route.fulfill({ json: { ownedMachines: [] } });
    }
    if (path === "/api/requests") {
      return route.fulfill({ json: { incoming: [], outgoing: [], approvableCount: 0 } });
    }
    if (path === "/api/conversations") {
      if (req.method() === "GET") {
        const convId = url.searchParams.get("conversationId");
        const listingId = url.searchParams.get("listingId");
        if (convId || listingId) {
          const conv = conversations.find((c) => (convId ? c.id === convId : c.listingId === listingId)) || null;
          const afterSeq = Number(url.searchParams.get("after_seq") || 0);
          const allMsgs = conv ? (messagesByConv.get(conv.id) || []) : [];
          const messages = afterSeq ? allMsgs.filter((m) => m.seq > afterSeq) : allMsgs;
          return route.fulfill({ json: { conversation: conv, messages, hasMoreOlder: false } });
        }
        return route.fulfill({ json: { conversations } });
      }
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        apiPosts.push(body);
        const conv = conversations.find((c) => c.id === body.conversationId || c.listingId === body.listingId) || conversations[0];
        if (body.action === "send") {
          const list = messagesByConv.get(conv.id) || [];
          const nextSeq = (list[list.length - 1]?.seq || 0) + 1;
          const msg = {
            seq: nextSeq,
            id: body.id,
            senderId: user.id,
            senderName: user.name,
            senderKind: "human",
            senderRole: conv.buyerId === user.id ? "buyer" : "owner",
            body: body.body,
          };
          list.push(msg);
          messagesByConv.set(conv.id, list);
          conv.lastSeq = nextSeq;
          conv.lastMessage = msg;
          return route.fulfill({ json: { conversation: conv, message: msg } });
        }
        if (body.action === "update_ai_policy") {
          if (conv.buyerId === user.id) {
            conv.buyerAiMode = body.mode;
            conv.buyerAiPolicy = body.policy || {};
          } else {
            conv.ownerAiMode = body.mode;
            conv.ownerAiPolicy = body.policy || {};
          }
          return route.fulfill({ json: { conversation: conv } });
        }
        if (body.action === "mark_read") {
          return route.fulfill({ json: { conversation: { ...conv, myLastReadSeq: body.readSeq, unreadCount: 0 } } });
        }
        return route.fulfill({ json: { ok: true, conversation: conv } });
      }
    }
    return route.fulfill({ json: {} });
  });

  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  return { page, errors, apiPosts };
}

test("매물 상세 1:1 채팅은 직접 대화와 입력창이 먼저 보이고, 농농이 거래 전담 버튼으로 열어도 자동 활성화되지 않는다", async () => {
  const server = await startStatic();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const conv = createConversationFixture();
    const messagesByConv = new Map([
      [conv.id, [
        { seq: 1, senderId: OWNER_USER.id, senderName: OWNER_USER.name, senderKind: "human", senderRole: "owner", body: "안녕하세요, 문의 주셔서 감사합니다." },
      ]],
    ]);
    const { page, errors, apiPosts } = await setupMockedPage(browser, server.address().port, {
      user: BUYER_USER,
      conversations: [conv],
      messagesByConv,
    });

    // 매물 상세에서 1:1 채팅 열기
    await page.locator('header [data-view="browse"]').click();
    await page.locator('#listingGrid .listing-card [data-detail]').first().click();
    await page.locator("[data-detail-chat]").click();

    await page.locator("#chatLog").waitFor({ state: "visible" });
    await page.locator("#chatForm").waitFor({ state: "visible" });
    await page.locator('#chatLog:has-text("안녕하세요, 문의 주셔서 감사합니다.")').waitFor({ state: "visible" });

    // 위임 설정은 기본적으로 숨겨져 있고, 직접 대화+입력창이 위임 버튼보다 위에 배치된다
    assert.equal(await page.locator("#chatAiControlBar").isVisible(), false, "위임 설정 패널은 기본적으로 숨겨져야 함");
    const trigger = page.getByRole("button", { name: "농농이 거래 전담" });
    assert.equal(await trigger.isVisible(), true, "농농이 거래 전담 버튼이 보여야 함");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");

    const layout = await page.evaluate(() => {
      const log = document.querySelector("#chatLog").getBoundingClientRect();
      const form = document.querySelector("#chatForm").getBoundingClientRect();
      const btn = document.querySelector("#chatDelegationTrigger").getBoundingClientRect();
      return { logBottom: log.bottom, formTop: form.top, formBottom: form.bottom, btnTop: btn.top };
    });
    assert.ok(layout.logBottom <= layout.formTop + 40, "채팅 로그 아래에 입력창이 있어야 함");
    assert.ok(layout.formBottom <= layout.btnTop + 2, "직접 대화 입력창이 농농이 거래 전담 버튼보다 위에 있어야 함");

    // 농농이 거래 전담 버튼을 눌러 패널을 열어도 위임이 켜지거나 서버에 저장되지 않는다
    const policyCallsBefore = apiPosts.filter((p) => p.action === "update_ai_policy").length;
    await trigger.click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator("#chatAiControlBar").isVisible(), true);
    assert.equal(await page.locator("#chatFullDelegationToggle").isChecked(), false, "패널 열기만으로 거래 전담이 켜지면 안 됨");
    assert.equal(await page.locator('.chat-ai-mode-btn[data-ai-mode="off"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('.chat-ai-mode-btn[data-ai-mode="autonomous"]').getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#chatFullDelegationBadge").textContent(), "OFF");
    assert.equal(
      apiPosts.filter((p) => p.action === "update_ai_policy").length,
      policyCallsBefore,
      "패널 열기만으로 update_ai_policy를 호출하면 안 됨"
    );

    // 다시 누르면 닫힌다
    await trigger.click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#chatAiControlBar").isVisible(), false);

    // 직접 메시지 전송 동작 확인
    await page.locator("#chatMessage").fill("내일 오전 10시에 방문해도 될까요?");
    await page.locator("#chatSendButton").click();
    await page.locator('#chatLog:has-text("내일 오전 10시에 방문해도 될까요?")').waitFor({ state: "visible" });
    assert.equal(await page.locator("#chatMessage").inputValue(), "");
    assert.equal(await page.locator("#chatAiControlBar").isVisible(), false, "직접 메시지 전송 후에도 위임 패널은 닫혀 있어야 함");

    // 폴링으로 상대 답장과 추천 답장 초안이 도착해도 위임 설정은 닫힌 채 유지되고 초안 바가 정상 동작한다
    const currentMsgs = messagesByConv.get(conv.id);
    currentMsgs.push({
      seq: 3,
      senderId: OWNER_USER.id,
      senderName: OWNER_USER.name,
      senderKind: "human",
      senderRole: "owner",
      body: "네, 오전 10시에 창고에서 뵙겠습니다.",
    });
    conv.lastSeq = 3;
    conv.aiDraft = { targetUserId: BUYER_USER.id, body: "감사합니다! 내일 10시에 맞춰 방문하겠습니다." };
    await page.locator('#chatLog:has-text("네, 오전 10시에 창고에서 뵙겠습니다.")').waitFor({ state: "visible" });
    assert.equal(await page.locator("#chatAiControlBar").isVisible(), false, "폴링 갱신으로 위임 패널이 저절로 열리면 안 됨");
    await page.locator("#chatDraftBar").waitFor({ state: "visible" });
    await page.locator("#chatDraftEdit").click();
    assert.equal(await page.locator("#chatMessage").inputValue(), "감사합니다! 내일 10시에 맞춰 방문하겠습니다.");

    // 명시적으로 거래 전담을 켜면 정상 저장된다
    await trigger.click();
    await page.locator("#chatFullDelegationToggle").check();
    await page.waitForFunction(() => document.querySelector("#chatFullDelegationBadge")?.textContent === "ON");
    const policyCalls = apiPosts.filter((p) => p.action === "update_ai_policy");
    assert.equal(policyCalls.length, 1);
    assert.equal(policyCalls[0].mode, "autonomous");
    assert.equal(policyCalls[0].policy.fullDelegation, true);
    assert.equal(policyCalls[0].policy.autoExecuteTransaction, true);
    assert.equal(await page.locator("#chatDelegationTriggerStatus").textContent(), "전담 ON");

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("구매자·소유자 보조 대화 목록에서 제목과 최근 메시지 행을 누르면 1:1 채팅이 바로 열리고 역할별 위임 제어가 유지된다", async () => {
  const server = await startStatic();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    // 1. 구매자 화면 (#buyerConversations)
    const buyerConv = createConversationFixture();
    const buyerMsgs = new Map([
      [buyerConv.id, [
        { seq: 1, senderId: BUYER_USER.id, senderName: BUYER_USER.name, senderKind: "human", senderRole: "buyer", body: "토요일 오전 9시 인수 가능할까요?" },
      ]],
    ]);
    const buyerCtx = await setupMockedPage(browser, server.address().port, {
      user: BUYER_USER,
      conversations: [buyerConv],
      messagesByConv: buyerMsgs,
    });

    await buyerCtx.page.locator("#myPageButton").click();
    await buyerCtx.page.locator('#myPageMenu [data-view="requests"]').click();
    const buyerRow = buyerCtx.page.locator("#buyerConversations .conv-row-open");
    await buyerRow.waitFor({ state: "visible" });
    assert.match(await buyerRow.textContent(), /대동 관리기 \+ 두둑성형기/);
    assert.match(await buyerRow.textContent(), /토요일 오전 9시 인수 가능할까요\?/);

    await buyerRow.locator(".conv-row-preview").click();
    await buyerCtx.page.locator("#chatForm").waitFor({ state: "visible" });
    await buyerCtx.page.locator('#chatLog:has-text("토요일 오전 9시 인수 가능할까요?")').waitFor({ state: "visible" });
    assert.equal(await buyerCtx.page.locator("#chatAiControlBar").isVisible(), false);
    assert.deepEqual(buyerCtx.errors, []);

    // 2. 소유자 화면 (#ownerConversations) + 역할 게이트 확인
    const ownerConv = createConversationFixture();
    const ownerMsgs = new Map([
      [ownerConv.id, [
        { seq: 1, senderId: BUYER_USER.id, senderName: BUYER_USER.name, senderKind: "human", senderRole: "buyer", body: "토요일 오전 9시 인수 가능할까요?" },
      ]],
    ]);
    const ownerCtx = await setupMockedPage(browser, server.address().port, {
      user: OWNER_USER,
      conversations: [ownerConv],
      messagesByConv: ownerMsgs,
    });

    await ownerCtx.page.locator("#myPageButton").click();
    await ownerCtx.page.locator('#myPageMenu [data-view="owner"]').click();
    const ownerRow = ownerCtx.page.locator("#ownerConversations [data-open-chat]");
    assert.equal(await ownerRow.count(), 1, "소유자 대화 행당 data-open-chat 요소는 1개여야 함");
    assert.match(await ownerRow.textContent(), /대동 관리기 \+ 두둑성형기/);
    assert.match(await ownerRow.textContent(), /토요일 오전 9시 인수 가능할까요\?/);

    await ownerRow.locator(".conv-row-title").click();
    await ownerCtx.page.locator("#chatForm").waitFor({ state: "visible" });
    await ownerCtx.page.locator('#chatLog:has-text("토요일 오전 9시 인수 가능할까요?")').waitFor({ state: "visible" });
    assert.equal(await ownerCtx.page.locator("#chatAiControlBar").isVisible(), false);

    // 소유자가 농농이 거래 전담 패널을 열어도 비활성 유지 + 소유자 역할 라벨/권한 유지
    await ownerCtx.page.getByRole("button", { name: "농농이 거래 전담" }).click();
    assert.equal(await ownerCtx.page.locator("#chatAiControlBar").isVisible(), true);
    assert.equal(await ownerCtx.page.locator("#chatFullDelegationToggle").isChecked(), false);
    assert.equal(await ownerCtx.page.locator("#chatPolicyBudgetLabel").textContent(), "최소 수락 금액(원)");

    await ownerCtx.page.locator("#chatFullDelegationToggle").check();
    await ownerCtx.page.waitForFunction(() => document.querySelector("#chatFullDelegationBadge")?.textContent === "ON");
    const ownerPolicyCall = ownerCtx.apiPosts.find((p) => p.action === "update_ai_policy");
    assert.ok(ownerPolicyCall);
    assert.equal(ownerPolicyCall.policy.autoExecuteTransaction, false, "소유자는 자동 거래 신청 권한이 false여야 함");
    assert.deepEqual(ownerCtx.errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
