import { CROP_BY_ID, OPERATION_BY_ID } from "../data/farm-machines.js";
import { recommendationGuide, selectMatchingListings } from "../data/recommendation.js";
import { $, areaLabel, escapeHtml, money, toast } from "../core/utils.js";
import { conversationTurn, unrelatedTurn } from "./conversation.js";
import { askAgent, askRecommendation, executeAgentAction } from "./recommend-agent.js";

export function createAiPanel({
  state,
  runtime,
  persist,
  allListings,
  listingById,
  loadCatalog,
  openDetail,
  renderListings,
  refreshAuthenticatedData,
  savePendingIntentAndRedirectLogin,
}) {
  let conversation;
  let recommendationPending = false;
  // 농농이 AI 에이전트 대화 기록. 서버에 AI 키가 없으면 agentAvailable=false로 바꾸고 규칙 기반 상담을 쓴다.
  let agentHistory = [];
  let agentAvailable = null;
  const MAX_AGENT_HISTORY = 12;
  const aiDefaultPlaceholder = $("aiInput").placeholder;
  const aiInputExamples = {
    crop: "예: 감자",
    operation: "예: 밭에 비닐을 씌우려고 해요",
    transaction: "예: 기계를 빌리고 싶어요",
    area: "예: 300평",
    date: "시작일과 반납일을 입력해 주세요",
    budget: "예: 7만 원 이하",
  };

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

  function askFollowUp(question, reply = question.reply) {
    $("aiInput").placeholder = aiInputExamples[question.field] || aiDefaultPlaceholder;
    const bubble = appendAiMessage(reply, "assistant");
    const choices = document.createElement("div");
    choices.className = "prompt-suggestions ai-follow-up";
    for (const choice of question.choices) {
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
      if (agentAvailable !== false && !resetRequested) {
        pending = appendAiMessage("농농이가 생각하고 있어요…", "assistant");
        if (runtime.catalogState !== "ready") await Promise.resolve(runtime.catalogReady).catch(() => {});
        const agentResult = await askAgent(message, { history: agentHistory, region: state.region }).catch((error) => {
          console.warn("농농이 에이전트 응답 실패, 규칙 기반 상담으로 전환", error?.status || error?.name);
          return null;
        });
        pending.remove();
        pending = undefined;
        if (agentResult?.mode === "unavailable") {
          agentAvailable = false;
        } else if (agentResult?.mode === "agent") {
          agentAvailable = true;
          renderAgentResult(message, agentResult);
          return;
        }
      }
      const filters = {
        transaction: state.transaction,
        region: state.region,
        sort: state.sort,
        radius: state.filters.radius,
        date: state.filters.date,
        dateEnd: state.filters.dateEnd,
      };
      const previous = conversation;
      let turn = conversationTurn(message, filters, previous);
      let interpreted = false;
      const directAnswer =
        previous?.question?.choices.includes(message) ||
        (previous?.field && /^\d[\d,.\s~년월일평㎡만원/-]*$/.test(message));
      if (!turn.reply && !directAnswer) {
        pending = appendAiMessage("말씀하신 조건을 확인하고 있어요…", "assistant");
        const result = await askRecommendation(message, {
          action: "interpret",
          cropId: previous?.context?.cropIds?.[0],
          field: previous?.field,
        }).catch(() => null);
        if (result?.intent === "search" && result.query) {
          turn = conversationTurn(result.query, filters, previous);
          interpreted = true;
        } else if (result?.intent === "help" || result?.intent === "rental_help") {
          const question = result.intent === "help" ? "뭐해" : "대여 신청 방법";
          turn = conversationTurn(question, filters, previous);
          interpreted = true;
        } else if (result?.intent === "unrelated") {
          turn = unrelatedTurn(previous);
        }
        pending.remove();
      }
      conversation = turn;
      if (conversation.reply || conversation.question) {
        if (conversation.question) {
          const reply = [conversation.reply, conversation.question.reply].filter(Boolean).join("\n\n");
          askFollowUp(conversation.question, reply);
        } else {
          appendAiMessage(conversation.reply, "assistant");
        }
        if (turn.reset) {
          conversation = undefined;
          $("aiStarters").hidden = false;
        }
        $("aiModeLabel").textContent = interpreted ? "AI 조건 해석 · 상담 안내" : "농기계 상담";
        return;
      }

      pending = appendAiMessage("조건에 맞는 매물을 확인하고 있어요…", "assistant");
      if (runtime.catalogState === "error") await loadCatalog();
      else await runtime.catalogReady;

      const { context } = conversation;
      const selection = selectMatchingListings("", context, allListings());
      const candidateIds = selection.candidates.map(({ id }) => id);
      const guide = recommendationGuide(selection);
      let result = guide;
      if (runtime.catalogState !== "ready" && !guide.listingIds.length) {
        appendAiMessage("매물 목록에 연결하지 못했어요. 입력한 조건은 기억하고 있어요. ‘바로 추천’을 입력해 다시 확인해 주세요.", "assistant");
        return;
      }

      if (guide.listingIds.length && candidateIds.every((id) => runtime.catalog.some((item) => item.id === id))) {
        try {
          result = await askRecommendation("조건에 맞는 매물", { ...context, candidateIds });
        } catch {
          result = guide;
        }
      }

      const current = selectMatchingListings("", context, allListings());
      if (current.candidates.map(({ id }) => id).join() !== candidateIds.join()) result = recommendationGuide(current);
      const { cropId, operations, combined, transaction, maxPrice, areaPyeong, date, dateEnd } = current;
      const matched = result.listingIds.map((id) => allListings().find((item) => item.id === id)).filter(Boolean);
      const showDate = (value) => (value ? value.slice(5).replace("-", "/") : "");
      const dateText = date ? `${showDate(date)} ~ ${showDate(dateEnd || date)}` : "";
      const formatBudget =
        maxPrice && Number.isFinite(maxPrice / 10000) && maxPrice % 10000 === 0
          ? `${(maxPrice / 10000).toLocaleString("ko-KR")}만 원`
          : maxPrice
            ? money(maxPrice)
            : "";
      const bubble = appendAiMessage(
        matched.length ? `🚜 조건에 맞는 농기계 ${matched.length}개를 찾았어요!` : result.reply,
        "assistant",
        result.listingIds,
      );
      if (matched.length) {
        const overview = document.createElement("div");
        overview.className = "ai-rec-overview";
        const cropName = CROP_BY_ID[cropId]?.name;
        const workName = operations.map((id) => OPERATION_BY_ID[id].label).join(combined ? " + " : " · ");
        const rows = [
          [["🥬 작물", cropName], ["작업", workName]],
          [
            ["📏 면적", areaPyeong ? `${Math.round(areaPyeong).toLocaleString("ko-KR")}평` : ""],
            ["예산", formatBudget ? `${transaction === "rent" ? "하루 " : ""}${formatBudget} 이하` : ""],
          ],
          [["📅 대여 기간", transaction === "rent" ? dateText : ""]],
        ];
        if (transaction === "sale") rows.push([["거래 방식", "구매"]]);
        for (const rowFields of rows) {
          const present = rowFields.filter(([, value]) => value);
          if (!present.length) continue;
          const row = document.createElement("div");
          row.className = "ai-rec-row";
          for (const [index, [label, value]] of present.entries()) {
            if (index) {
              const separator = document.createElement("span");
              separator.className = "ai-rec-separator";
              separator.textContent = " | ";
              row.append(separator);
            }
            const labelNode = document.createElement("strong");
            labelNode.textContent = `${label}:`;
            row.append(labelNode, document.createTextNode(` ${value}`));
          }
          overview.append(row);
        }

        const comparison = document.createElement("div");
        comparison.className = "ai-rec-comparison";
        const title = document.createElement("strong");
        title.textContent = "추천 매물 비교";
        comparison.append(title);
        const shorten = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 38);
        for (const item of matched) {
          const line = document.createElement("div");
          line.className = "ai-rec-comparison-item";
          const name = document.createElement("strong");
          name.textContent = `• ${item.title || "농기계 매물"}:`;
          line.append(name);
          const features = [shorten(item.included), shorten(item.pickup)].filter(Boolean);
          if (!features.length && result.summaries?.[item.id]) features.push(shorten(result.summaries[item.id]));
          line.append(document.createTextNode(features.length ? ` ${features.join(" · ")}` : " 상세 보기에서 확인"));
          const price = document.createElement("span");
          price.className = "ai-rec-price";
          price.textContent = money(item.price) + (item.type === "rent" ? "/일" : "");
          line.append(price);
          comparison.append(line);
        }
        const info = document.createElement("div");
        info.className = "ai-rec-notice";
        info.textContent = maxPrice ? "✅ 모두 작업 조건과 예산에 맞아요!" : "✅ 모두 작업 조건에 맞아요!";
        const caution = document.createElement("div");
        caution.className = "ai-rec-notice";
        caution.textContent =
          transaction === "rent"
            ? "💡 예약 가능 여부와 총 대여료는 확인해 주세요."
            : "💡 거래 가능 여부와 최종 가격은 확인해 주세요.";
        const cards = bubble.querySelector(".ai-result");
        for (const section of [overview, comparison, info, caution]) {
          if (cards) bubble.insertBefore(section, cards);
          else bubble.append(section);
        }
      }
      $("aiModeLabel").textContent = result.mode === "ai" ? "AI 요약 · 등록 매물 기반" : "등록 매물 조건 검색";
      if (result.mode === "ai" && result.summaries && typeof result.summaries === "object") {
        Object.assign(state.aiSummaries, result.summaries);
        persist();
        renderListings();
      }
    } catch (error) {
      console.error("추천을 표시하지 못했습니다.", error);
      appendAiMessage("추천을 표시하지 못했어요. 같은 조건으로 다시 보려면 ‘바로 추천’을 입력해 주세요.", "assistant");
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
    conversation = undefined;
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
