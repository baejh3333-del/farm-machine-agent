// 이 파일은 main.js에서 나눈 모듈이다. 다른 화면 함수는 app(app.js)을 통해 부른다.
// 농농이 AI 상담창. 조건은 conversation.js가 대화로 모으고, 추천 후보는 서버(/api/recommend)가 고른다.
import { app } from "../app.js";
import { allListings, catalogReady, catalogStatus, listingById, loadCatalog, persist, state } from "../app-state.js";
import { CROP_BY_ID, OPERATION_BY_ID } from "../data/farm-machines.js";
import { recommendationGuide, selectMatchingListings } from "../data/recommendation.js";
import { areaLabel } from "../format.js";
import { $, escapeHtml, money, toast } from "../ui.js";
import { conversationTurn, unrelatedTurn } from "./conversation.js";
import { askRecommendation } from "./recommend-agent.js";

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
      cardBtn.addEventListener("click", () => app.openDetail(item.id));
      results.append(cardBtn);
    });
    bubble.append(results);
  }
  $("aiMessages").append(bubble);
  scrollAiToEnd();
  return bubble;
}
function scrollAiToEnd() {
  const scroll = $("aiScroll");
  scroll.scrollTop = scroll.scrollHeight;
}
let conversation;
let recommendationPending = false;
const aiDefaultPlaceholder = $("aiInput").placeholder;
const aiInputExamples = {
  crop: "예: 감자",
  operation: "예: 밭에 비닐을 씌우려고 해요",
  transaction: "예: 기계를 빌리고 싶어요",
  area: "예: 300평",
  date: "시작일과 반납일을 입력해 주세요",
  budget: "예: 7만 원 이하",
};
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
    const directAnswer = previous?.question?.choices.includes(message)
      || (previous?.field && /^\d[\d,.\s~년월일평㎡만원/-]*$/.test(message));
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
    const { context } = conversation;
    // 추천 후보는 서버가 DB 매물에서 고른다. 서버에 닿지 못했을 때만(요청 제한 포함)
    // 받아 둔 매물 목록에 같은 규칙을 돌려 AI 요약 없이 보여 준다.
    let result;
    try {
      result = await askRecommendation("조건에 맞는 매물", context);
    } catch {
      if (catalogStatus() === "error") await loadCatalog();
      else await catalogReady();
      if (catalogStatus() !== "ready") {
        appendAiMessage("매물 목록에 연결하지 못했어요. 입력한 조건은 기억하고 있어요. ‘바로 추천’을 입력해 다시 확인해 주세요.", "assistant");
        return;
      }
      const selection = selectMatchingListings("", context, allListings());
      result = { ...recommendationGuide(selection), selection };
    }
    await catalogReady();
    const { cropId, operations = [], combined, transaction, maxPrice, areaPyeong, date, dateEnd } = result.selection ?? {};
    // Summarize only verified search conditions and the actual recommended listings.
    // Use textContent throughout so listing metadata cannot inject markup.
    const matched = result.listingIds.map((id) => allListings().find((item) => item.id === id)).filter(Boolean);
    const showDate = (value) => value ? value.slice(5).replace("-", "/") : "";
    const dateText = date ? showDate(date) + " ~ " + showDate(dateEnd || date) : "";
    const formatBudget = maxPrice && Number.isFinite(maxPrice / 10000) && maxPrice % 10000 === 0
      ? (maxPrice / 10000).toLocaleString("ko-KR") + "만 원"
      : maxPrice ? money(maxPrice) : "";
    const bubble = appendAiMessage(
      matched.length ? `🚜 조건에 맞는 농기계 ${matched.length}개를 찾았어요!` : result.reply,
      "assistant", result.listingIds,
    );
    if (matched.length) {
      // Keep two related facts on each row, matching the concise recommendation format.
      // Construct DOM text nodes instead of interpreting listing data as HTML.
      const overview = document.createElement("div");
      overview.className = "ai-rec-overview";
      const cropName = CROP_BY_ID[cropId]?.name;
      const workName = operations.map((id) => OPERATION_BY_ID[id].label).join(combined ? " + " : " · ");
      const rows = [
        [["🥬 작물", cropName], ["작업", workName]],
        [["📏 면적", areaPyeong ? Math.round(areaPyeong).toLocaleString("ko-KR") + "평" : ""],
         ["예산", formatBudget ? (transaction === "rent" ? "하루 " : "") + formatBudget + " 이하" : ""]],
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
          labelNode.textContent = label + ":";
          row.append(labelNode, document.createTextNode(" " + value));
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
        name.textContent = "• " + (item.title || "농기계 매물") + ":";
        line.append(name);
        // Favor short, factual equipment and pickup details over an AI paragraph.
        const features = [shorten(item.included), shorten(item.pickup)].filter(Boolean);
        if (!features.length && result.summaries?.[item.id]) features.push(shorten(result.summaries[item.id]));
        line.append(document.createTextNode(features.length ? " " + features.join(" · ") : " 상세 보기에서 확인"));
        const price = document.createElement("span");
        price.className = "ai-rec-price";
        price.textContent = money(item.price) + (item.type === "rent" ? "/일" : "");
        line.append(price);
        comparison.append(line);
      }
      const info = document.createElement("div");
      info.className = "ai-rec-notice";
      info.textContent = maxPrice
        ? "✅ 모두 작업 조건과 예산에 맞아요!"
        : "✅ 모두 작업 조건에 맞아요!";
      const caution = document.createElement("div");
      caution.className = "ai-rec-notice";
      caution.textContent = transaction === "rent"
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
      app.renderListings();
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

export function initAiPanel() {
  $("aiLauncher").addEventListener("click", openAiPanel);
  $("aiExpand").addEventListener("click", toggleAiPanelSize);
  window.visualViewport?.addEventListener("resize", syncAiViewport);
  window.visualViewport?.addEventListener("scroll", syncAiViewport);
  const closeAiPanel = ({ returnFocus = true } = {}) => {
    if ($("aiPanel").hidden) return;
    $("aiPanel").hidden = true;
    document.body.classList.remove("ai-open");
    $("aiLauncher").setAttribute("aria-expanded", "false");
    if (returnFocus) $("aiLauncher").focus({ preventScroll: true });
  };
  $("aiClose").addEventListener("click", () => closeAiPanel());
  // 농농 상담창 밖의 화면을 누르면 상담창을 자동으로 닫는다
  // (상담창에서 연 매물 상세·필터 창 안을 누를 때는 닫지 않는다)
  document.addEventListener("pointerdown", (event) => {
    if ($("aiPanel").hidden) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#aiPanel, #aiLauncher, .dialog-backdrop, #toast")) return;
    closeAiPanel({ returnFocus: false });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing && !$("aiPanel").hidden && !document.querySelector(".dialog-backdrop:not([hidden])")) closeAiPanel();
  }, true);
  const aiInput = $("aiInput");
  $("aiForm").addEventListener("submit", sendAiQuestion);
  $("aiReset").addEventListener("click", () => {
    if (recommendationPending) return;
    conversation = undefined;
    $("aiMessages").replaceChildren();
    $("aiStarters").hidden = false;
    aiInput.value = "";
    aiInput.placeholder = aiDefaultPlaceholder;
    appendAiMessage("어떤 작물에 어떤 작업을 하실 건가요? 아는 조건부터 말씀해 주세요.", "assistant");
    $("aiInput").focus();
  });

  document.querySelectorAll("[data-prompt]").forEach((button) =>
    button.addEventListener("click", () => {
      if (recommendationPending) return;
      aiInput.value = button.dataset.prompt;
      $("aiForm").requestSubmit();
    })
  );
}
