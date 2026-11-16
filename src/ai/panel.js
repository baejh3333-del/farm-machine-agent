import { $, areaLabel, escapeHtml, money, toast } from "../core/utils.js";
import { askAgent, executeAgentAction } from "./recommend-agent.js";

export function createAiPanel({
  state,
  runtime,
  listingById,
  openDetail,
  refreshAuthenticatedData,
  savePendingIntentAndRedirectLogin,
}) {
  let recommendationPending = false;
  // 농농이 AI 에이전트 대화 기록. 규칙 기반 폴백 없이 AI 호출 실패 시 오류를 표시한다.
  let agentHistory = [];
  const MAX_AGENT_HISTORY = 12;
  const aiDefaultPlaceholder = $("aiInput").placeholder;

  function scrollAiToEnd() {
    const scroll = $("aiScroll");
    scroll.scrollTop = scroll.scrollHeight;
  }

  function appendAiMessage(text, role, listingIds = []) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role}`;
    const textNode = document.createElement("div");
    textNode.textContent = text;
    bubble.append(textNode);

    if (listingIds.length) {
      const results = document.createElement("div");
      results.className = "ai-result";
      const titleEl = document.createElement("div");
      titleEl.className = "ai-result-title";
      titleEl.textContent = " 농농이가 찾은 맞춤 매물";
      results.append(titleEl);

      listingIds.forEach((id) => {
        const item = listingById(id);
        if (!item) return;
        const cardBtn = document.createElement("button");
        cardBtn.type = "button";
        cardBtn.className = "ai-rec-card-btn";
        cardBtn.innerHTML = `
          <span class="ai-rec-info">
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.region)} · ${money(item.price)}${item.type === "rent" ? "/일" : ""}</small>
            <small>${escapeHtml(areaLabel(item.areaMin, item.areaMax))} · ${escapeHtml(item.pickup || "인수 방법 문의")}</small>
          </span>
          <span class="ai-rec-cta">상세 보기 ›</span>
        `;
        cardBtn.addEventListener("click", () => openDetail(item.id));
        results.append(cardBtn);
      });
      bubble.append(results);
    }
    $("aiMessages").append(bubble);
    scrollAiToEnd();
    return bubble;
  }


  function rememberAgentTurn(...entries) {
    agentHistory = [...agentHistory, ...entries.filter((entry) => entry.content)].slice(-MAX_AGENT_HISTORY);
  }

  function appendChoices(bubble, choiceList) {
    const choices = document.createElement("div");
    choices.className = "prompt-suggestions ai-follow-up";
    for (const choice of choiceList) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice;
      button.addEventListener("click", () => {
        if (recommendationPending || !choices.isConnected) return;
        $("aiInput").value = choice;
        $("aiForm").requestSubmit();
      });
      choices.append(button);
    }
    bubble.append(choices);
    scrollAiToEnd();
  }

  // 흐름도의 "실행 내용을 보여주고 확인 → 사용자 승인 → 서비스 API 호출 → 실제 상태 확인 → 결과 안내" 단계
  function appendConfirmation(bubble, action) {
    const requestId = crypto.randomUUID();
    const card = document.createElement("div");
    card.className = "ai-confirm";
    const title = document.createElement("strong");
    title.className = "ai-confirm-title";
    title.textContent = "대여 요청 확인";
    card.append(title);
    const rows = [
      ["매물", action.title],
      ["지역", action.region],
      ["기간", `${action.start} ~ ${action.end} (${action.days}일)`],
      ["대여료", `${money(action.dailyPrice)}/일 × ${action.days}일 = ${money(action.totalPrice)}`],
      ["메모", action.note],
    ];
    for (const [label, value] of rows) {
      if (!value) continue;
      const row = document.createElement("div");
      row.className = "ai-rec-row";
      const labelNode = document.createElement("strong");
      labelNode.textContent = `${label}:`;
      row.append(labelNode, document.createTextNode(` ${value}`));
      card.append(row);
    }
    const notice = document.createElement("div");
    notice.className = "ai-rec-notice";
    notice.textContent = "승인하면 게시자에게 대여 요청이 전송돼요. 예약은 게시자가 승인해야 확정돼요.";
    const actions = document.createElement("div");
    actions.className = "ai-confirm-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "button button-primary";
    approve.textContent = "승인하고 요청 보내기";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "button button-secondary";
    cancel.textContent = "취소";
    actions.append(approve, cancel);
    card.append(notice, actions);
    bubble.append(card);
    scrollAiToEnd();

    const setBusy = (busy) => {
      approve.disabled = busy;
      cancel.disabled = busy;
    };
    const finish = (text, state) => {
      card.dataset.state = state;
      actions.remove();
      appendAiMessage(text, "assistant");
      rememberAgentTurn({ role: "assistant", content: text });
    };

    cancel.addEventListener("click", () => {
      rememberAgentTurn({ role: "user", content: "대여 요청은 보내지 않을게요." });
      finish("알겠어요. 대여 요청은 보내지 않았어요. 다른 날짜나 매물이 필요하면 말씀해 주세요.", "cancelled");
    });

    approve.addEventListener("click", async () => {
      setBusy(true);
      approve.textContent = "요청을 보내는 중…";
      rememberAgentTurn({ role: "user", content: "승인합니다. 대여 요청을 보내 주세요." });
      try {
        const result = await executeAgentAction(action, requestId);
        if (result?.outcome === "completed") finish(`✅ ${result.message}`, "completed");
        else if (result?.outcome === "partial") finish(`⚠️ ${result.message}`, "partial");
        else finish(`❌ 대여 요청을 보내지 못했어요. ${result?.message || ""}`.trim(), "failed");
        if (result?.outcome === "completed" || result?.outcome === "partial") {
          await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData?.()]).catch(() => {});
        }
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") {
          setBusy(false);
          approve.textContent = "승인하고 요청 보내기";
          return;
        }
        if (error?.status === 401) {
          finish("🔒 대여 요청은 로그인한 뒤 보낼 수 있어요. 로그인하면 신청서에서 이어서 보낼 수 있어요.", "login");
          savePendingIntentAndRedirectLogin?.(
            { type: "rental", listingId: action.listingId, draftValues: { start: action.start, end: action.end, note: action.note || "", requestId } },
            "로그인 후 대여 요청을 이어서 보낼 수 있어요.",
          );
          return;
        }
        // 결과를 받지 못하면 같은 요청 ID로 다시 시도할 수 있게 둔다(중복 요청은 서버가 막는다).
        setBusy(false);
        approve.textContent = "다시 시도";
        appendAiMessage("요청 결과를 확인하지 못했어요. ‘다시 시도’를 누르거나 거래 화면에서 요청이 보내졌는지 확인해 주세요.", "assistant");
      }
    });
  }

  function formatReservationDate(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return "";
    const d = new Date(`${ymd}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${"일월화수목금토"[d.getUTCDay()]})`;
  }

  function renderNongnongReply(result) {
    const listingIds = result.reservation || result.createdListing || result.updatedListing
      ? []
      : (result.listingIds || []).filter((id) => listingById(id));
    const bubble = appendAiMessage(result.reply, "assistant", listingIds);
    const done = result.reservation;
    if (done) {
      const box = document.createElement("div");
      box.className = "ai-rec-overview ai-reservation";
      const rows = [
        ["예약 번호", done.number],
        ["기계", done.title],
        ["지역", done.region],
        done.kind === "rental" ? ["기간", `${formatReservationDate(done.start)} ~ ${formatReservationDate(done.end)}`] : null,
        Number.isFinite(done.totalPrice) ? [done.kind === "rental" ? "내야 하는 돈" : "판매가", money(done.totalPrice)] : null,
        ["상태", done.kind === "rental" ? "소유 농가 승인 대기 · 결제 전" : "판매자 확인 대기"],
      ].filter((row) => row && row[1]);
      for (const [label, value] of rows) {
        const row = document.createElement("div");
        row.className = "ai-rec-row";
        const labelNode = document.createElement("strong");
        labelNode.textContent = `${label}:`;
        row.append(labelNode, document.createTextNode(` ${value}`));
        box.append(row);
      }
      const go = document.createElement("button");
      go.type = "button";
      go.className = "ai-rec-card-btn";
      go.textContent = "대여 요청 메뉴에서 확인하기 ›";
      go.addEventListener("click", () => setView("requests"));
      box.append(go);
      bubble.append(box);
      refreshAuthenticatedData?.({
        includeRequests: done.kind === "rental",
        includeConversations: done.kind === "purchase",
      }).catch(() => {});
    }
    const listed = result.createdListing || result.updatedListing;
    if (listed) {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "ai-rec-card-btn";
      go.textContent = `${listed.number ? `등록 번호 ${listed.number} · ` : ""}내 기계 관리에서 보기 ›`;
      go.addEventListener("click", () => setView("owner"));
      bubble.append(go);
      loadCatalog({ quiet: true }).catch(() => {});
    }
    scrollAiToEnd();
  }

  function renderAgentResult(message, result) {
    const reply = typeof result.reply === "string" && result.reply.trim() ? result.reply.trim() : "말씀하신 내용을 처리하지 못했어요.";
    rememberAgentTurn({ role: "user", content: message }, { role: "assistant", content: reply });
    const listingIds = (Array.isArray(result.listingIds) ? result.listingIds : []).filter((id) => listingById(id));
    const bubble = appendAiMessage(reply, "assistant", listingIds);
    if (Array.isArray(result.choices) && result.choices.length) appendChoices(bubble, result.choices.slice(0, 5));
    if (result.pendingAction?.type === "rental_request") appendConfirmation(bubble, result.pendingAction);
    $("aiModeLabel").textContent = "AI 상담 · 등록 매물 기반";
  }

  async function sendAiQuestion(event) {
    event.preventDefault();
    const message = $("aiInput").value.trim();
    if (!message || recommendationPending) return;
    if (message.length > 500) return toast("질문을 500자 이내로 입력해 주세요.");

    recommendationPending = true;
    const submit = $("aiForm").querySelector('[type="submit"]');
    submit.disabled = true;
    $("aiInput").value = "";
    $("aiInput").placeholder = aiDefaultPlaceholder;
    $("aiStarters").hidden = true;
    $("aiMessages").querySelectorAll(".ai-follow-up").forEach((choices) => choices.remove());
    appendAiMessage(message, "user");
    let pending;

    try {
      const resetRequested = /^(?:새 상담(?: 시작)?|처음부터 다시)/.test(message);
      if (resetRequested) agentHistory = [];
      pending = appendAiMessage("농농이가 생각하고 있어요…", "assistant");
      if (runtime.catalogState !== "ready") await Promise.resolve(runtime.catalogReady).catch(() => {});
      const agentResult = await askAgent(message, { history: agentHistory, region: state.region });
      pending.remove();
      pending = undefined;
      if (agentResult?.mode === "agent") {
        renderAgentResult(message, agentResult);
        return;
      }
      appendAiMessage("AI 상담을 호출할 수 없습니다. 잠시 후 다시 시도해 주세요.", "assistant");
      $("aiModeLabel").textContent = "AI 상담 · 연결 불가";
    } catch (error) {
      console.error("AI 상담 호출 실패", error);
      appendAiMessage(error?.message || "AI 상담을 호출할 수 없습니다. 잠시 후 다시 시도해 주세요.", "assistant");
      $("aiModeLabel").textContent = "AI 상담 · 연결 불가";
    } finally {
      pending?.remove();
      recommendationPending = false;
      submit.disabled = false;
    }
  }
  function syncAiViewport() {
    const panel = $("aiPanel");
    const viewport = window.visualViewport;
    if (panel.hidden || !viewport) return;
    panel.style.setProperty("--ai-visible-top", `${viewport.offsetTop}px`);
    panel.style.setProperty("--ai-visible-height", `${viewport.height}px`);
  }

  function openAiPanel() {
    $("aiPanel").hidden = false;
    document.body.classList.add("ai-open");
    $("aiLauncher").setAttribute("aria-expanded", "true");
    syncAiViewport();
    $("aiClose").focus({ preventScroll: true });
  }

  function toggleAiPanelSize() {
    const button = $("aiExpand");
    const expanded = $("aiPanel").classList.toggle("is-expanded");
    button.setAttribute("aria-pressed", String(expanded));
    button.title = expanded ? "채팅창 원래 크기로" : "채팅창 확대";
    button.firstElementChild.textContent = expanded ? "⤡" : "⤢";
  }

  function resetAiPanel() {
    if (recommendationPending) return;
    agentHistory = [];
    $("aiMessages").replaceChildren();
    $("aiStarters").hidden = false;
    $("aiInput").value = "";
    $("aiInput").placeholder = aiDefaultPlaceholder;
    appendAiMessage("어떤 작물에 어떤 작업을 하실 건가요? 아는 조건부터 말씀해 주세요.", "assistant");
    $("aiInput").focus();
  }

  function submitPrompt(prompt) {
    if (recommendationPending) return;
    $("aiInput").value = prompt;
    $("aiForm").requestSubmit();
  }

  return {
    appendAiMessage,
    sendAiQuestion,
    syncAiViewport,
    openAiPanel,
    toggleAiPanelSize,
    resetAiPanel,
    submitPrompt,
  };
}
