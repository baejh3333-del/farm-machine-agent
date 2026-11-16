import { CROP_BY_ID, OPERATION_BY_ID } from "../data/farm-machines.js";
import { recommendationGuide, selectMatchingListings } from "../data/recommendation.js";
import { $, areaLabel, escapeHtml, money, toast } from "../core/utils.js";
import { conversationTurn, unrelatedTurn } from "./conversation.js";
import { downscaleImage, listingDraftToFormValues } from "./photo.js";
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
  openNewListing,
}) {
  let conversation;
  let recommendationPending = false;
  // 농농이 AI 에이전트 대화 기록. 서버에 AI 키가 없으면 agentAvailable=false로 바꾸고 규칙 기반 상담을 쓴다.
  let agentHistory = [];
  let agentAvailable = null;
  const MAX_AGENT_HISTORY = 12;
  // 사진 상담 상태: 보낼 사진, 마지막으로 보낸 사진(등록 화면용), 저장된 판매·대여 초안
  let pendingPhoto = null;
  let lastPhotoDataUrl = null;
  let savedDraft = null;
  const MACHINE_LABELS = { cultivator: "관리기", tractor: "트랙터", ridgeMulcher: "휴립·멀칭기", transplanter: "정식기", ricePlanter: "이앙기", sprayer: "방제기", potatoPlanter: "감자 파종기", combine: "콤바인", potatoHarvester: "감자 굴취기", carrier: "운반차" };
  const CONFIDENCE_LABELS = { high: "높음", medium: "보통", low: "낮음" };
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


  function setPendingPhoto(dataUrl) {
    pendingPhoto = dataUrl;
    $("aiPhotoPreview").hidden = !dataUrl;
    if (dataUrl) $("aiPhotoPreviewImg").src = dataUrl;
    else $("aiPhotoPreviewImg").removeAttribute("src");
  }

  async function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setPendingPhoto(await downscaleImage(file));
      $("aiInput").placeholder = "예: 시동이 안 걸려요 / 이거 팔고 싶어요";
      $("aiInput").focus({ preventScroll: true });
    } catch (error) {
      toast(error?.message || "JPG·PNG 사진만 올릴 수 있어요.");
    }
  }

  function bindPhotoControls() {
    $("aiPhotoButton").addEventListener("click", () => $("aiPhotoInput").click());
    $("aiPhotoInput").addEventListener("change", choosePhoto);
    $("aiPhotoRemove").addEventListener("click", () => setPendingPhoto(null));
  }

  function appendUserPhoto(bubble, dataUrl) {
    const img = document.createElement("img");
    img.className = "ai-user-photo";
    img.src = dataUrl;
    img.alt = "보낸 농기계 사진";
    bubble.prepend(img);
  }

  function photoSummaryText(summary) {
    if (!summary) return "";
    const parts = [
      summary.machineType ? `기종 ${MACHINE_LABELS[summary.machineType] || summary.machineType}` : "기종 확인 안 됨",
      `확신 ${CONFIDENCE_LABELS[summary.confidence] || "낮음"}`,
      ...summary.observations,
    ];
    return `(사진 인식: ${parts.join(", ")})`;
  }

  function linkButton(label, href, external = false) {
    const link = document.createElement("a");
    link.className = "button button-secondary ai-card-action";
    link.href = href;
    link.textContent = label;
    if (external) {
      link.target = "_blank";
      link.rel = "noopener";
    }
    return link;
  }

  function appendRepairCenters(bubble, centers) {
    const wrap = document.createElement("div");
    wrap.className = "ai-centers";
    const title = document.createElement("strong");
    title.className = "ai-confirm-title";
    title.textContent = "🔧 수리·상담 연락처";
    wrap.append(title);
    for (const center of centers.slice(0, 5)) {
      const card = document.createElement("div");
      card.className = "ai-center-card";
      const name = document.createElement("strong");
      name.textContent = center.name;
      const services = document.createElement("small");
      services.textContent = center.services || "";
      const actions = document.createElement("div");
      actions.className = "ai-confirm-actions";
      if (center.phone) actions.append(linkButton(`📞 ${center.phone}`, `tel:${center.phone.replace(/[^0-9]/g, "")}`));
      if (center.url) actions.append(linkButton("🌐 사이트", center.url, true));
      const checked = document.createElement("small");
      checked.className = "ai-center-checked";
      checked.textContent = `확인일 ${center.checkedAt || "-"}`;
      card.append(name, services, actions, checked);
      wrap.append(card);
    }
    bubble.append(wrap);
  }

  function priceText(draft) {
    const basis = draft.priceBasis || {};
    if (!draft.price) return "비슷한 매물이 없어 가격은 직접 정해 주세요.";
    const unit = basis.unit === "day" ? "/일" : "";
    const range = basis.min && basis.max && basis.min !== basis.max ? ` (${money(basis.min)}~${money(basis.max)}${unit})` : "";
    return `참고가 ${money(draft.price)}${unit}${range} · 비슷한 매물 ${basis.count || 0}건${basis.lowConfidence ? " · 근거가 적어요" : ""}`;
  }

  function appendListingDraft(bubble, draft) {
    const card = document.createElement("div");
    card.className = "ai-confirm ai-draft";
    const title = document.createElement("strong");
    title.className = "ai-confirm-title";
    title.textContent = draft.type === "sale" ? "🏷️ 판매 글 초안" : "🤝 대여 글 초안";
    card.append(title);
    const photoSrc = draft.photoUrl || lastPhotoDataUrl;
    if (photoSrc) {
      const img = document.createElement("img");
      img.className = "ai-draft-photo";
      img.src = photoSrc;
      img.alt = "매물 사진";
      card.append(img);
    }
    const name = document.createElement("div");
    name.className = "ai-draft-title";
    name.textContent = draft.title;
    const price = document.createElement("div");
    price.className = "ai-rec-row";
    price.textContent = priceText(draft);
    const desc = document.createElement("p");
    desc.className = "ai-draft-desc";
    desc.textContent = draft.description;
    const notice = document.createElement("div");
    notice.className = "ai-rec-notice";
    notice.textContent = "💡 플랫폼 등록 매물 기준 참고가예요. [확인 필요] 부분은 직접 채워 주세요.";
    const actions = document.createElement("div");
    actions.className = "ai-confirm-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "button button-secondary";
    copy.textContent = "📋 소개글 복사";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(`${draft.title}\n\n${draft.description}`);
        toast("소개글을 복사했어요.");
      } catch {
        toast("복사하지 못했어요. 글을 길게 눌러 복사해 주세요.");
      }
    });
    const register = document.createElement("button");
    register.type = "button";
    register.className = "button button-primary";
    register.textContent = "📝 이 내용으로 매물 등록하기";
    register.addEventListener("click", () => {
      // 등록 화면으로 넘긴 초안은 다시 쓰지 않는다(같은 매물 ID로 두 번 등록하면 409).
      if (savedDraft?.listingId === draft.listingId) savedDraft = null;
      openNewListing?.(listingDraftToFormValues(draft, lastPhotoDataUrl));
    });
    actions.append(copy, register);
    card.append(name, price, desc, notice, actions);
    bubble.append(card);
  }

  function appendSources(bubble, sources) {
    const line = document.createElement("div");
    line.className = "ai-sources";
    line.append(document.createTextNode("근거: "));
    sources.slice(0, 4).forEach((source, index) => {
      if (index) line.append(document.createTextNode(" · "));
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = source.title;
      line.append(link);
    });
    bubble.append(line);
  }

  function renderAgentResult(message, result, { photo = false } = {}) {
    const reply = typeof result.reply === "string" && result.reply.trim() ? result.reply.trim() : "말씀하신 내용을 처리하지 못했어요.";
    const summary = photoSummaryText(result.photoSummary);
    rememberAgentTurn(
      { role: "user", content: photo ? `[사진 첨부] ${message}`.trim() : message },
      { role: "assistant", content: [reply, summary].filter(Boolean).join("\n") },
    );
    if (result.listingDraft?.listingId && result.listingDraft?.photoKey) {
      savedDraft = { listingId: result.listingDraft.listingId, photoKey: result.listingDraft.photoKey, photoUrl: result.listingDraft.photoUrl };
    }
    const listingIds = (Array.isArray(result.listingIds) ? result.listingIds : []).filter((id) => listingById(id));
    const bubble = appendAiMessage(reply, "assistant", listingIds);
    if (Array.isArray(result.repairCenters) && result.repairCenters.length) appendRepairCenters(bubble, result.repairCenters);
    if (result.listingDraft) appendListingDraft(bubble, result.listingDraft);
    if (Array.isArray(result.sources) && result.sources.length) appendSources(bubble, result.sources);
    scrollAiToEnd();
    if (Array.isArray(result.choices) && result.choices.length) appendChoices(bubble, result.choices.slice(0, 5));
    if (result.pendingAction?.type === "rental_request") appendConfirmation(bubble, result.pendingAction);
    $("aiModeLabel").textContent = "AI 상담 · 등록 매물 기반";
  }

  async function sendAiQuestion(event) {
    event.preventDefault();
    const message = $("aiInput").value.trim();
    const photo = pendingPhoto;
    if ((!message && !photo) || recommendationPending) return;
    if (message.length > 500) return toast("질문을 500자 이내로 입력해 주세요.");

    recommendationPending = true;
    const submit = $("aiForm").querySelector('[type="submit"]');
    submit.disabled = true;
    $("aiInput").value = "";
    $("aiInput").placeholder = aiDefaultPlaceholder;
    $("aiStarters").hidden = true;
    $("aiMessages").querySelectorAll(".ai-follow-up").forEach((choices) => choices.remove());
    const userBubble = appendAiMessage(message || "사진을 봐 주세요", "user");
    if (photo) {
      appendUserPhoto(userBubble, photo);
      lastPhotoDataUrl = photo;
      setPendingPhoto(null);
    }
    let pending;

    try {
      const resetRequested = !photo && /^(?:새 상담(?: 시작)?|처음부터 다시)/.test(message);
      if (resetRequested) {
        agentHistory = [];
        savedDraft = null;
        lastPhotoDataUrl = null;
      }
      if (photo && agentAvailable === false) {
        appendAiMessage("사진 상담은 지금 쓸 수 없어요. 궁금한 점을 글로 적어 주시면 도와드릴게요.", "assistant");
        return;
      }
      if (agentAvailable !== false && !resetRequested) {
        pending = appendAiMessage(photo ? "농농이가 사진을 보고 있어요…" : "농농이가 생각하고 있어요…", "assistant");
        if (runtime.catalogState !== "ready") await Promise.resolve(runtime.catalogReady).catch(() => {});
        let agentError = null;
        const agentResult = await askAgent(message, { history: agentHistory, region: state.region, image: photo || undefined, savedDraft }).catch((error) => {
          agentError = error;
          console.warn("농농이 에이전트 응답 실패", error?.status || error?.name);
          return null;
        });
        pending.remove();
        pending = undefined;
        if (agentResult?.mode === "unavailable") {
          agentAvailable = false;
          if (photo) {
            appendAiMessage("사진 상담은 지금 쓸 수 없어요. 궁금한 점을 글로 적어 주시면 도와드릴게요.", "assistant");
            return;
          }
        } else if (agentResult?.mode === "agent") {
          agentAvailable = true;
          renderAgentResult(message, agentResult, { photo: Boolean(photo) });
          return;
        } else if (photo) {
          // 사진은 규칙 기반 상담이 볼 수 없으니 넘기지 않고 이유를 알려 준다.
          const known = ["INVALID_PHOTO", "PHOTO_UNAVAILABLE"].includes(agentError?.code);
          appendAiMessage(known ? agentError.message : "사진을 지금 확인하지 못했어요. 잠시 후 다시 올려 주세요.", "assistant");
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

  bindPhotoControls();

  return {
    appendAiMessage,
    sendAiQuestion,
    syncAiViewport,
    openAiPanel,
    toggleAiPanelSize,
  };
}
