import { $, areaLabel, escapeHtml, money, toast } from "../core/utils.js";
import { askNongnong } from "./nongnong-client.js";
import { listingDraftToFormValues } from "./photo.js";
import { askAgent, executeAgentAction } from "./recommend-agent.js";

export function createAiPanel({
  state,
  runtime,
  listingById,
  loadCatalog = () => Promise.resolve(),
  openDetail,
  refreshAuthenticatedData,
  savePendingIntentAndRedirectLogin,
  setView = () => {},
  openNewListing,
}) {
  let recommendationPending = false;
  // 농농 대화형 에이전트(/api/nongnong): null=아직 모름, true=사용 중, false=미사용(/api/agent 폴백)
  let nongnongMode = null;
  let nongnongHistory = [];
  const NONGNONG_HISTORY_LIMIT = 16;
  const agentReset = /^(?:새 상담(?: 시작)?|처음부터 다시(?: 할래요?)?|대화 초기화)[.!?\s]*$/;
  // 사진: 등록할 때 함께 올라가도록 대화가 끝날 때까지 들고 있고, 처음 보낼 때만 AI가 다시 본다.
  let agentPhoto = null;
  let photoIsNew = false;
  let lastPhotoDataUrl = null;
  let savedDraft = null;
  const MACHINE_LABELS = { cultivator: "관리기", tractor: "트랙터", ridgeMulcher: "휴립·멀칭기", transplanter: "정식기", ricePlanter: "이앙기", sprayer: "방제기", potatoPlanter: "감자 파종기", combine: "콤바인", potatoHarvester: "감자 굴취기", carrier: "운반차" };
  const CONFIDENCE_LABELS = { high: "높음", medium: "보통", low: "낮음" };

  function showPhotoPreview() {
    const preview = $("aiPhotoPreview");
    if (!preview) return;
    preview.hidden = !agentPhoto || !photoIsNew;
    if (agentPhoto) $("aiPhotoThumb").src = agentPhoto;
  }

  function clearPhoto() {
    agentPhoto = null;
    photoIsNew = false;
    const input = $("aiPhotoInput");
    if (input) input.value = "";
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

  $("aiPhotoButton")?.addEventListener("click", () => {
    $("aiPhotoInput")?.click();
  });
  $("aiPhotoInput")?.addEventListener("change", async () => {
    const file = $("aiPhotoInput").files?.[0];
    if (!file) return;
    try {
      agentPhoto = await shrinkPhoto(file);
      photoIsNew = true;
      savedDraft = null;
      showPhotoPreview();
      $("aiInput").focus();
    } catch (error) {
      clearPhoto();
      toast(error.message);
    }
  });
  $("aiPhotoRemove")?.addEventListener("click", clearPhoto);

  // 농농이 AI 에이전트(/api/agent) 대화 기록.
  let agentHistory = [];
  const MAX_AGENT_HISTORY = 12;
  const aiDefaultPlaceholder = $("aiInput").placeholder;

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
    const sendingPhoto = photoIsNew && agentPhoto ? agentPhoto : null;
    const message = $("aiInput").value.trim() || (sendingPhoto ? "이 기계 사진이에요." : "");
    if (!message || recommendationPending) return;
    if (message.length > 500) return toast("질문을 500자 이내로 입력해 주세요.");
    if (sendingPhoto) lastPhotoDataUrl = sendingPhoto;

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
      const resetRequested = !sendingPhoto && agentReset.test(message);
      if (resetRequested) {
        nongnongHistory = [];
        agentHistory = [];
        savedDraft = null;
        lastPhotoDataUrl = null;
        clearPhoto();
        if (nongnongMode === true) {
          appendAiMessage("새로 시작할게요. 빌리기, 사기, 팔기 중 무엇을 도와드릴까요?", "assistant");
          return;
        }
      }
      if (nongnongMode !== false && !resetRequested) {
        pending = appendAiMessage("농농이가 확인하고 있어요…", "assistant");
        if (runtime.catalogState !== "ready") await Promise.resolve(runtime.catalogReady).catch(() => {});
        const outgoing = [...nongnongHistory, { role: "user", content: sendingPhoto ? `${message} [사진 첨부]` : message }].slice(-NONGNONG_HISTORY_LIMIT);
        const outcome = await askNongnong(outgoing, { photo: agentPhoto, photoIsNew: Boolean(sendingPhoto) }).catch((error) => ({ mode: "error", error }));
        pending.remove();
        pending = undefined;
        if (outcome.mode === "agent") {
          nongnongMode = true;
          nongnongHistory = [...outgoing, { role: "assistant", content: outcome.reply }].slice(-NONGNONG_HISTORY_LIMIT);
          if (sendingPhoto) {
            photoIsNew = false;
            showPhotoPreview();
          }
          if (outcome.createdListing) clearPhoto();
          renderNongnongReply(outcome);
          $("aiModeLabel").textContent = "농농 AI · 추천부터 예약까지";
          return;
        }
        if (outcome.mode === "unavailable" || (nongnongMode === null && outcome.error?.status === 404)) {
          nongnongMode = false;
        } else {
          appendAiMessage(outcome.error?.message || "농농이가 잠시 답할 수 없어요. 잠시 후 다시 말씀해 주세요.", "assistant");
          $("aiModeLabel").textContent = "AI 상담 · 연결 불가";
          return;
        }
      }
      pending = appendAiMessage(sendingPhoto ? "농농이가 사진을 보고 있어요…" : "농농이가 생각하고 있어요…", "assistant");
      if (runtime.catalogState !== "ready") await Promise.resolve(runtime.catalogReady).catch(() => {});
      const agentResult = await askAgent(message, {
        history: agentHistory,
        region: state.region,
        image: sendingPhoto || undefined,
        savedDraft,
      });
      pending.remove();
      pending = undefined;
      if (agentResult?.mode === "agent") {
        if (sendingPhoto) {
          photoIsNew = false;
          showPhotoPreview();
        }
        renderAgentResult(message, agentResult, { photo: Boolean(sendingPhoto) });
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
    nongnongHistory = [];
    agentHistory = [];
    savedDraft = null;
    lastPhotoDataUrl = null;
    clearPhoto();
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
