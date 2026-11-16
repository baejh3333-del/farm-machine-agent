import { CROP_BY_ID, OPERATION_BY_ID } from "../data/farm-machines.js";
import { recommendationGuide, selectMatchingListings } from "../data/recommendation.js";
import { $, areaLabel, escapeHtml, money, toast } from "../core/utils.js";
import { conversationTurn, unrelatedTurn } from "./conversation.js";
import { askNongnong } from "./nongnong-client.js";
import { askRecommendation } from "./recommend-agent.js";

export function createAiPanel({
  state,
  runtime,
  persist,
  allListings,
  listingById,
  loadCatalog,
  openDetail,
  renderListings,
  setView = () => {},
}) {
  let conversation;
  let recommendationPending = false;
  // 농농 대화형 에이전트: null=아직 모름, true=사용 중, false=AI 키 없음(기존 조건 검색 상담 사용)
  let agentMode = null;
  let agentHistory = [];
  const AGENT_HISTORY_LIMIT = 16;
  const agentReset = /^(?:새 상담(?: 시작)?|처음부터 다시(?: 할래요?)?|대화 초기화)[.!?\s]*$/;
  // 사진: 등록할 때 함께 올라가도록 대화가 끝날 때까지 들고 있고, 처음 보낼 때만 AI가 다시 본다.
  let agentPhoto = null;
  let photoIsNew = false;

  function showPhotoPreview() {
    $("aiPhotoPreview").hidden = !agentPhoto || !photoIsNew;
    if (agentPhoto) $("aiPhotoThumb").src = agentPhoto;
  }

  function clearPhoto() {
    agentPhoto = null;
    photoIsNew = false;
    $("aiPhotoInput").value = "";
    showPhotoPreview();
  }

  async function shrinkPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("사진을 열 수 없어요."));
        el.src = url;
      });
      for (const [side, quality] of [[1280, 0.82], [1024, 0.75], [800, 0.7]]) {
        const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= 1_200_000) return dataUrl;
      }
      throw new Error("사진이 너무 커요. 다른 사진으로 올려 주세요.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  $("aiPhotoButton").addEventListener("click", () => {
    if (agentMode === false) return toast("사진 분석은 AI가 연결된 상태에서만 쓸 수 있어요.");
    $("aiPhotoInput").click();
  });
  $("aiPhotoInput").addEventListener("change", async () => {
    const file = $("aiPhotoInput").files?.[0];
    if (!file) return;
    try {
      agentPhoto = await shrinkPhoto(file);
      photoIsNew = true;
      showPhotoPreview();
      $("aiInput").focus();
    } catch (error) {
      clearPhoto();
      toast(error.message);
    }
  });
  $("aiPhotoRemove").addEventListener("click", clearPhoto);
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

  function appendAiMessage(text, role, listingIds = [], photo = null) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role}`;
    const textNode = document.createElement("div");
    textNode.textContent = text;
    bubble.append(textNode);
    if (photo) {
      const img = document.createElement("img");
      img.className = "ai-chat-photo";
      img.alt = "보낸 기계 사진";
      img.src = photo;
      bubble.append(img);
    }

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

  function formatReservationDate(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return "";
    const d = new Date(`${ymd}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${"일월화수목금토"[d.getUTCDay()]})`;
  }

  function renderAgentReply(result) {
    const listingIds = result.reservation || result.createdListing || result.updatedListing ? [] : (result.listingIds || []).filter((id) => listingById(id));
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

  async function sendAiQuestion(event) {
    event.preventDefault();
    const sendingPhoto = agentMode !== false && photoIsNew && agentPhoto ? agentPhoto : null;
    const message = $("aiInput").value.trim() || (sendingPhoto ? "이 기계 사진이에요." : "");
    if (!message || recommendationPending) return;
    if (message.length > 500) return toast("질문을 500자 이내로 입력해 주세요.");

    recommendationPending = true;
    const submit = $("aiForm").querySelector('[type="submit"]');
    submit.disabled = true;
    $("aiInput").value = "";
    $("aiInput").placeholder = aiDefaultPlaceholder;
    $("aiStarters").hidden = true;
    $("aiMessages").querySelectorAll(".ai-follow-up").forEach((choices) => choices.remove());
    appendAiMessage(message, "user", [], sendingPhoto);
    let pending;

    try {
      if (agentMode !== false) {
        if (agentReset.test(message)) {
          agentHistory = [];
          conversation = undefined;
          clearPhoto();
          appendAiMessage("새로 시작할게요. 빌리기, 사기, 팔기 중 무엇을 도와드릴까요?", "assistant");
          return;
        }
        pending = appendAiMessage("농농이가 확인하고 있어요…", "assistant");
        const outgoing = [...agentHistory, { role: "user", content: sendingPhoto ? `${message} [사진 첨부]` : message }].slice(-AGENT_HISTORY_LIMIT);
        const outcome = await askNongnong(outgoing, { photo: agentPhoto, photoIsNew: Boolean(sendingPhoto) }).catch((error) => ({ mode: "error", error }));
        pending.remove();
        pending = undefined;
        if (outcome.mode === "agent") {
          agentMode = true;
          agentHistory = [...outgoing, { role: "assistant", content: outcome.reply }].slice(-AGENT_HISTORY_LIMIT);
          if (sendingPhoto) {
            photoIsNew = false;
            showPhotoPreview();
          }
          if (outcome.createdListing) clearPhoto();
          renderAgentReply(outcome);
          $("aiModeLabel").textContent = "농농 AI · 추천부터 예약까지";
          return;
        }
        if (outcome.mode === "unavailable" || (agentMode === null && outcome.error?.status === 404)) {
          agentMode = false;
        } else {
          appendAiMessage(outcome.error?.message || "농농이가 잠시 답할 수 없어요. 잠시 후 다시 말씀해 주세요.", "assistant");
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

  return {
    appendAiMessage,
    sendAiQuestion,
    syncAiViewport,
    openAiPanel,
    toggleAiPanelSize,
  };
}
