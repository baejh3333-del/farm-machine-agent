import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { listListings } from "../server/listings-db.js";
import { goToMenu } from "./helpers/nav.js";

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

const BUYER_USER = { id: "u-buyer", username: "buyer1", name: "김구매", role: "member", region: "강원특별자치도 홍천군" };
const OWNER_USER = { id: "u-owner", username: "owner1", name: "박소유", role: "member", region: "강원특별자치도 홍천군" };

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

const AI_UI_SELECTOR = [
  "#chatAiControlBar",
  "#chatDelegationTrigger",
  "#chatQuickDelegationPill",
  "#chatQuickStartAiBtn",
  "#chatFullDelegationToggle",
  "#chatPausedBanner",
  "#chatDraftBar",
  ".btn-delegated-trade",
  ".chat-ai-badge",
  ".conv-ai-badge",
  "[data-delegated-trade]",
].join(", ");

const REMOVED_AI_ACTIONS = ["update_ai_policy", "takeover", "resume", "dismiss_ai_draft", "generate_ai_draft", "retry_ai_job", "set_inbound_policy"];

test("매물 상세 1:1 채팅은 직접 대화와 입력창만 보이고 거래 전담(AI 대리 응대) UI는 없다", async () => {
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

    // 매물 찾기(2.2 디자인) 카드·상세 모두 거래전담 버튼은 없고, 상세의 '소유주에게 묻기'로 1:1 대화를 연다
    await goToMenu(page, "매물 찾기");
    const firstCard = page.locator("#browseDesignHost article[data-card]").first();
    await firstCard.waitFor({ state: "visible" });
    assert.equal(await page.locator("#browseDesignHost [data-delegated-trade], #browseDesignHost .btn-delegated-trade").count(), 0, "매물 카드에 거래전담 버튼이 없어야 함");
    await firstCard.click();
    await page.locator("#detailDesignHost h1").waitFor({ state: "visible" });
    assert.equal(await page.locator("#detailDesignHost [data-delegated-trade]").count(), 0, "상세 화면에 거래전담 버튼이 없어야 함");
    await page.locator('#detailDesignHost button:has-text("소유주에게 묻기")').click();

    await page.locator("#chatLog").waitFor({ state: "visible" });
    await page.locator("#chatForm").waitFor({ state: "visible" });
    await page.locator('#chatLog:has-text("안녕하세요, 문의 주셔서 감사합니다.")').waitFor({ state: "visible" });

    assert.equal(await page.locator(AI_UI_SELECTOR).count(), 0, "채팅 모달에 거래 전담·AI 대리 응대 UI가 없어야 함");
    assert.equal(await page.getByRole("button", { name: /거래 ?전담/ }).count(), 0);

    const layout = await page.evaluate(() => {
      const log = document.querySelector("#chatLog").getBoundingClientRect();
      const form = document.querySelector("#chatForm").getBoundingClientRect();
      return { logBottom: log.bottom, formTop: form.top };
    });
    assert.ok(layout.logBottom <= layout.formTop + 40, "채팅 로그 아래에 입력창이 있어야 함");

    // 직접 메시지 전송 동작 확인
    await page.locator("#chatMessage").fill("내일 오전 10시에 방문해도 될까요?");
    await page.locator("#chatSendButton").click();
    await page.locator('#chatLog:has-text("내일 오전 10시에 방문해도 될까요?")').waitFor({ state: "visible" });
    assert.equal(await page.locator("#chatMessage").inputValue(), "");

    // 폴링으로 상대 답장이 도착하면 표시된다. 서버가 레거시 AI 초안 필드를 내려도 초안 UI는 나타나지 않는다.
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
    conv.aiPausedReason = "escalated:budget_exceeded";
    await page.locator('#chatLog:has-text("네, 오전 10시에 창고에서 뵙겠습니다.")').waitFor({ state: "visible" });
    assert.equal(await page.locator(AI_UI_SELECTOR).count(), 0, "레거시 AI 필드가 있어도 AI UI가 그려지면 안 됨");

    assert.equal(apiPosts.some((p) => REMOVED_AI_ACTIONS.includes(p.action)), false, "제거된 AI 대리 응대 액션을 호출하면 안 됨");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("구매자·소유자 보조 대화 목록에서 제목과 최근 메시지 행을 누르면 1:1 채팅이 바로 열리고 거래전담 버튼은 없다", async () => {
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

    await buyerCtx.page.locator('#homeDesignHost header[style*="position: relative"] a:has-text("마이페이지")').click();
    await buyerCtx.page.locator('#myPageMenu [data-view="requests"]').click();
    const buyerRow = buyerCtx.page.locator("#buyerConversations .conv-row-open");
    await buyerRow.waitFor({ state: "visible" });
    assert.match(await buyerRow.textContent(), /대동 관리기 \+ 두둑성형기/);
    assert.match(await buyerRow.textContent(), /토요일 오전 9시 인수 가능할까요\?/);
    assert.equal(await buyerCtx.page.locator("#buyerConversations [data-delegated-trade], #buyerConversations .conv-ai-badge").count(), 0);
    assert.equal(await buyerCtx.page.locator("#buyerConversations [data-open-deal]").count(), 1, "거래 관리 바로가기는 유지되어야 함");

    await buyerRow.locator(".conv-row-preview").click();
    await buyerCtx.page.locator("#chatForm").waitFor({ state: "visible" });
    await buyerCtx.page.locator('#chatLog:has-text("토요일 오전 9시 인수 가능할까요?")').waitFor({ state: "visible" });
    assert.equal(await buyerCtx.page.locator(AI_UI_SELECTOR).count(), 0);
    assert.deepEqual(buyerCtx.errors, []);

    // 2. 소유자 화면 (#ownerConversations)
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

    await ownerCtx.page.locator('#homeDesignHost header[style*="position: relative"] a:has-text("마이페이지")').click();
    await ownerCtx.page.locator('#myPageMenu [data-view="owner"]').click();
    const ownerRow = ownerCtx.page.locator("#ownerConversations [data-open-chat]");
    assert.equal(await ownerRow.count(), 1, "소유자 대화 행당 data-open-chat 요소는 1개여야 함");
    assert.match(await ownerRow.textContent(), /대동 관리기 \+ 두둑성형기/);
    assert.match(await ownerRow.textContent(), /토요일 오전 9시 인수 가능할까요\?/);
    assert.equal(await ownerCtx.page.locator("#ownerConversations [data-delegated-trade], [data-owner-inbound]").count(), 0, "소유자 화면에 거래전담·문의 자동응대 버튼이 없어야 함");

    await ownerRow.locator(".conv-row-title").click();
    await ownerCtx.page.locator("#chatForm").waitFor({ state: "visible" });
    await ownerCtx.page.locator('#chatLog:has-text("토요일 오전 9시 인수 가능할까요?")').waitFor({ state: "visible" });
    assert.equal(await ownerCtx.page.locator(AI_UI_SELECTOR).count(), 0);

    await ownerCtx.page.locator("#chatMessage").fill("네 가능합니다.");
    await ownerCtx.page.locator("#chatSendButton").click();
    await ownerCtx.page.locator('#chatLog:has-text("네 가능합니다.")').waitFor({ state: "visible" });
    assert.equal(ownerCtx.apiPosts.some((p) => REMOVED_AI_ACTIONS.includes(p.action)), false);
    assert.deepEqual(ownerCtx.errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
