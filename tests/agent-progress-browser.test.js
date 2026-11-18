import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { openLivePage, say, settle, startStaticServer, waitCommentary, waitFor } from "./helpers/live-voice-page.js";

// 실제 패널 모듈에서 /api/agent가 NDJSON 진행 알림을 보낼 때 채팅에 보이는 진행 단계를 확인한다.
const ndjson = (lines) => lines.map((line) => JSON.stringify(line)).join("\n");

async function watchProgress(page) {
  await page.evaluate(() => {
    window.progressSeen = { steps: [], status: [], bubbles: 0 };
    const counted = new WeakSet();
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches(".chat-bubble.is-thinking")) window.progressSeen.bubbles += 1;
          const items = node.matches(".ai-progress-steps li") ? [node] : [...node.querySelectorAll(".ai-progress-steps li")];
          for (const li of items) {
            if (counted.has(li)) continue;
            counted.add(li);
            window.progressSeen.steps.push(li.textContent);
          }
        }
      }
      const status = document.getElementById("aiVoiceLiveStatus")?.textContent || "";
      if (window.progressSeen.status.at(-1) !== status) window.progressSeen.status.push(status);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

test("progress: 음성 위임·글 질문 모두 서버가 알린 실제 조회 단계만 보여 주고, 결과가 오면 진행 표시를 지운다", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { page, errors, agentRequests } = await openLivePage(browser, server.address().port, {
      agent: async () => ({ mode: "agent", reply: "알겠어요.", listingIds: [] }),
    });
    // 나중에 등록한 route가 먼저 처리된다: /api/agent만 NDJSON으로 돌려준다.
    let index = 0;
    await page.route("**/api/agent", async (route) => {
      const body = route.request().postDataJSON();
      agentRequests.push(body);
      const turn = index++;
      if (turn === 1) {
        // 조회 없이 끝난 답변은 평소 JSON: 진행 표시가 없어야 한다.
        return route.fulfill({ json: { mode: "agent", reply: "네, 말씀하세요.", listingIds: [] } });
      }
      const label = turn === 0 ? "트랙터 대여 매물을 찾고 있어요" : "영양읍 11월 20일 날씨를 확인하고 있어요";
      return route.fulfill({
        status: 200,
        contentType: "application/x-ndjson; charset=utf-8",
        body: ndjson([
          { type: "progress", label },
          { type: "progress", label },
          { type: "progress", label: "search_listings {\"machineType\":\"tractor\"}" },
          { type: "thinking", label: "사용자 의도를 추론하는 중" },
          { type: "result", status: 200, body: { mode: "agent", reply: turn === 0 ? "트랙터 매물을 확인했어요." : "20일은 맑아요.", listingIds: [] } },
        ]),
      });
    });
    await watchProgress(page);

    await say(page, "트랙터 빌리고 싶어", "d-progress");
    await waitCommentary(page, "d-progress");
    await settle(page);
    assert.equal(agentRequests.at(-1).stream, true, "voice delegation asks for progress");
    let seen = await page.evaluate(() => window.progressSeen);
    assert.deepEqual(seen.steps, ["트랙터 대여 매물을 찾고 있어요"], "only the verified, deduplicated label");
    assert.equal(await page.locator(".ai-progress-bubble").count(), 0, "progress bubble removed once the result renders");
    assert.equal(await page.locator(".chat-bubble.assistant", { hasText: "트랙터 매물을 확인했어요." }).count(), 1);

    await say(page, "그냥 물어볼게", "d-plain");
    await waitCommentary(page, "d-plain");
    await settle(page);
    seen = await page.evaluate(() => window.progressSeen);
    assert.deepEqual(seen.steps, ["트랙터 대여 매물을 찾고 있어요"], "no progress for a reply without retrieval");

    await page.locator("#aiInput").fill("20일 날씨 어때?");
    await page.locator("#aiForm [type=submit]").click();
    await page.locator(".chat-bubble.assistant", { hasText: "20일은 맑아요." }).waitFor();
    seen = await page.evaluate(() => window.progressSeen);
    assert.deepEqual(seen.steps, ["트랙터 대여 매물을 찾고 있어요", "영양읍 11월 20일 날씨를 확인하고 있어요"]);
    assert.equal(agentRequests.at(-1).stream, true, "typed question asks for progress");
    assert.equal(await page.locator(".chat-bubble.is-thinking").count(), 0, "pending bubble removed");
    const transcript = await page.locator("#aiMessages").textContent();
    assert.equal(/search_listings|machineType|추론/.test(transcript), false, "no raw tool metadata or reasoning shown");
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
