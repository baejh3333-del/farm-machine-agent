import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { openLivePage, startStaticServer, waitFor } from "./helpers/live-voice-page.js";

// 실제 패널 모듈에서 마이페이지 변경 확인 카드: 카드 표시, 승인 버튼·글 "네"로 실행, 취소하면 실행 안 함, 성공 뒤 화면 데이터 새로 고침.
const REQUEST_ID = "6f1c2a4e-8b3d-4c5e-9f00-112233445566";
const proposal = (name) => ({
  mode: "agent",
  reply: `닉네임을 '${name}'(으)로 바꿀까요? 맞으면 "네"라고 답하거나 승인해 주세요.`,
  listingIds: [],
  pendingAction: { type: "my_page_action", operation: "update_nickname", args: { name }, title: `닉네임을 '${name}'(으)로 바꿀까요?`, summary: `닉네임을 '${name}'(으)로 바꿀까요?`, requestId: REQUEST_ID },
});

async function send(page, text) {
  await page.locator("#aiInput").fill(text);
  await page.locator("#aiForm [type=submit]").click();
}

test("마이페이지 확인 카드: 버튼·글 '네'로 실행하고, 취소하면 실행하지 않는다", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { page, errors } = await openLivePage(browser, server.address().port, {
      agent: async () => ({ mode: "agent", reply: "알겠어요.", listingIds: [] }),
    });
    const calls = [];
    let listingsLoads = 0;
    await page.route("**/api/listings", (route) => { listingsLoads += 1; return route.fulfill({ json: { listings: [] } }); });
    await page.route("**/api/agent", async (route) => {
      const body = route.request().postDataJSON();
      calls.push(body);
      if (body.action === "execute") {
        return route.fulfill({ json: { outcome: "completed", message: `닉네임을 '${body.pendingAction.args.name}'(으)로 바꿨어요.`, myPageAction: { operation: "update_nickname", ...body.pendingAction.args } } });
      }
      if (/바꿔/.test(body.message)) return route.fulfill({ json: proposal(body.message.includes("둘") ? "둘째" : "첫째") });
      return route.fulfill({ json: { mode: "agent", reply: "네, 말씀하세요.", listingIds: [] } });
    });

    // 1) 카드가 뜨고 승인 버튼을 누르면 서버가 준 requestId로 한 번만 실행된다.
    await send(page, "닉네임 첫째로 바꿔줘");
    const card = page.locator(".ai-confirm").last();
    await card.waitFor();
    assert.equal(await card.locator(".ai-confirm-title").textContent(), "마이페이지 변경 확인");
    assert.match(await card.textContent(), /닉네임을 '첫째'\(으\)로 바꿀까요\?/);
    const loadsBefore = listingsLoads;
    await card.getByRole("button", { name: "승인하고 변경하기" }).click();
    await page.locator(".chat-bubble.assistant", { hasText: "✅ 닉네임을 '첫째'(으)로 바꿨어요." }).waitFor();
    const executes = calls.filter((c) => c.action === "execute");
    assert.equal(executes.length, 1);
    assert.equal(executes[0].requestId, REQUEST_ID);
    assert.equal(executes[0].pendingAction.type, "my_page_action");
    await waitFor(() => listingsLoads > loadsBefore);
    assert.ok(listingsLoads > loadsBefore, "성공 뒤 화면 데이터를 다시 읽는다");
    await card.locator(".ai-confirm-actions").waitFor({ state: "detached" });
    assert.equal(await card.locator(".ai-confirm-actions").count(), 0, "실행 뒤 버튼이 사라져 두 번 누를 수 없다");

    // 2) 카드가 떠 있을 때 글로 "네"라고 하면 카드 승인과 똑같이 실행한다(모델에 다시 묻지 않는다).
    await send(page, "닉네임 둘째로 바꿔줘");
    await page.locator(".ai-confirm", { hasText: "둘째" }).waitFor();
    const chatsBefore = calls.filter((c) => c.action !== "execute").length;
    await send(page, "네");
    await page.locator(".chat-bubble.assistant", { hasText: "✅ 닉네임을 '둘째'(으)로 바꿨어요." }).waitFor();
    assert.equal(calls.filter((c) => c.action === "execute").length, 2);
    assert.equal(calls.filter((c) => c.action !== "execute").length, chatsBefore, "'네'는 채팅 요청으로 보내지 않는다");

    // 3) 취소하면 실행하지 않고, 다음 "네"에도 확인 대기 작업을 싣지 않는다.
    await send(page, "닉네임 첫째로 다시 바꿔줘");
    const third = page.locator(".ai-confirm").last();
    await third.locator(".ai-confirm-actions").waitFor();
    await third.getByRole("button", { name: "취소" }).click();
    await page.locator(".chat-bubble.assistant", { hasText: "마이페이지는 바꾸지 않았어요" }).waitFor();
    await send(page, "네");
    await page.locator(".chat-bubble.assistant", { hasText: "네, 말씀하세요." }).last().waitFor();
    const last = calls.at(-1);
    assert.notEqual(last.action, "execute");
    assert.equal(last.pendingAction ?? null, null, "취소한 변경은 서버로 다시 보내지 않는다");
    assert.equal(calls.filter((c) => c.action === "execute").length, 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
