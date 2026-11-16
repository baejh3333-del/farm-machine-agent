import { CROP_BY_ID, OPERATION_BY_ID } from "../data/farm-machines.js";
import { $, addDays, areaLabel, escapeHtml, money, today, toast } from "../core/utils.js";
import { listingDraftToFormValues } from "./photo.js";
import { askAgent, executeAgentAction } from "./recommend-agent.js";

const MACHINE_LABELS = {
  cultivator: "관리기",
  tractor: "트랙터",
  ridgeMulcher: "휴립·멀칭기",
  transplanter: "정식기",
  ricePlanter: "이앙기",
  sprayer: "방제기",
  potatoPlanter: "감자 파종기",
  combine: "콤바인",
  potatoHarvester: "감자 굴취기",
  carrier: "운반차",
};
const CONFIDENCE_LABELS = { high: "높음", medium: "보통", low: "낮음" };
const MAX_AGENT_HISTORY = 12;
const AGENT_RESET_RE = /^(?:새 상담(?: 시작)?|처음부터 다시(?: 할래요?)?|대화 초기화)[.!?\s]*$/;

function formatShortDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function formatReservationDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${"일월화수목금토"[d.getUTCDay()]})`;
}

function weekendWindow(baseYmd) {
  const d = new Date(`${baseYmd}T12:00:00+09:00`);
  const day = d.getUTCDay();
  const daysToSat = (6 - day + 7) % 7 || 7;
  const start = addDays(baseYmd, daysToSat);
  return { start, end: addDays(start, 1) };
}

function inferFollowUpChoices(reply, result) {
  if (Array.isArray(result.choices) && result.choices.length) return result.choices.slice(0, 5);
  if (result.pendingAction || result.reservation || result.createdListing || result.updatedListing || result.listingDraft) return [];
  const text = String(reply || "");
  if (/(?:예약|신청|진행|등록|올릴|보낼|살|빌릴).*?까요[?？]?/.test(text)) {
    return ["네, 바로 진행해 주세요", "조건을 바꿀래요"];
  }
  if (/어떤\s*작물/.test(text)) return ["고추", "벼", "배추", "감자"];
  if (/빌리.*?(?:사|구|팔)/.test(text) || /대여.*?(?:구매|판매)/.test(text)) {
    return ["빌리고 싶어요", "사고 싶어요", "팔고 싶어요"];
  }
  return [];
}

function wantsDatePicker(reply, result) {
  if (result.pendingAction || result.reservation || result.createdListing || result.updatedListing) return false;
  return /(?:언제|날짜|기간|며칠|시작일|반납일).*?(?:빌리|대여|필요|원하|알려|골라|말씀|정해|[?？])/.test(String(reply || ""));
}

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
  let agentHistory = [];
  let agentPhoto = null;
  let photoIsNew = false;
  let lastPhotoDataUrl = null;
  let savedDraft = null;
  const aiDefaultPlaceholder = $("aiInput").placeholder;

  const qbState = { mode: "rent", cropId: "", machineType: "", datePreset: "none" };
  const QB_SUBMIT_LABELS = {
    rent: "⚡ 선택한 조건으로 바로 찾기",
    sale: "🛒 구매 매물 바로 찾기",
    sell: "🏷️ 내 기계 등록 상담하기",
    repair: "🔧 고장·점검 방법 물어보기",
  };

  function syncQuickBuilderUi() {
    const root = $("aiStarters");
    if (!root) return;
    root.querySelectorAll("[data-qb-mode]").forEach((btn) => {
      const active = btn.dataset.qbMode === qbState.mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    root.querySelectorAll("[data-qb-crop]").forEach((btn) => {
      const selected = btn.dataset.qbCrop === qbState.cropId;
      btn.classList.toggle("is-selected", selected);
      btn.setAttribute("aria-pressed", String(selected));
    });
    root.querySelectorAll("[data-qb-machine]").forEach((btn) => {
      const selected = btn.dataset.qbMachine === qbState.machineType;
      btn.classList.toggle("is-selected", selected);
      btn.setAttribute("aria-pressed", String(selected));
    });
    root.querySelectorAll("[data-qb-date]").forEach((btn) => {
      const selected = btn.dataset.qbDate === qbState.datePreset;
      btn.classList.toggle("is-selected", selected);
      btn.setAttribute("aria-pressed", String(selected));
    });
    const dateRow = $("aiQbDateRow");
    if (dateRow) dateRow.hidden = qbState.mode !== "rent";
    const submitBtn = $("aiQbSubmit");
    if (submitBtn) submitBtn.textContent = QB_SUBMIT_LABELS[qbState.mode] || QB_SUBMIT_LABELS.rent;
  }

  function resolveQbDates() {
    const baseToday = today();
    if (qbState.datePreset === "tomorrow") {
      const d = addDays(baseToday, 1);
      return { start: d, end: d };
    }
    if (qbState.datePreset === "twoDays") {
      return { start: addDays(baseToday, 2), end: addDays(baseToday, 3) };
    }
    if (qbState.datePreset === "weekend") {
      return weekendWindow(baseToday);
    }
    return null;
  }

  function buildQuickPrompt() {
    const cropName = qbState.cropId ? `${CROP_BY_ID[qbState.cropId]?.name || ""}밭` : "";
    const machineName = qbState.machineType ? MACHINE_LABELS[qbState.machineType] : "";
    const target = [cropName, machineName].filter(Boolean).join("에 쓸 ") || "농기계";
    const region = state.region || "영양읍";
    if (qbState.mode === "sale") {
      return `${region} 근처에서 ${target}를 구매하고 싶어요. 맞는 매물을 바로 보여주세요.`;
    }
    if (qbState.mode === "sell") {
      return `제 ${machineName || "농기계"}를 팔거나 빌려주고 싶어요. 시세 확인과 등록 초안을 도와주세요.`;
    }
    if (qbState.mode === "repair") {
      return `${machineName || "농기계"} 시동·작동 점검 및 수리 방법을 알려주세요.`;
    }
    const dates = resolveQbDates();
    const periodText = dates ? `${dates.start}부터 ${dates.end}까지 ` : "";
    return `${region} 근처에서 ${target}를 ${periodText}빌리고 싶어요. 맞는 매물을 바로 보여주세요.`;
  }

  $("aiStarters")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const modeBtn = target.closest("[data-qb-mode]");
    if (modeBtn) {
      qbState.mode = modeBtn.dataset.qbMode || "rent";
      syncQuickBuilderUi();
      return;
    }
    const cropBtn = target.closest("[data-qb-crop]");
    if (cropBtn) {
      qbState.cropId = qbState.cropId === cropBtn.dataset.qbCrop ? "" : cropBtn.dataset.qbCrop;
      syncQuickBuilderUi();
      return;
    }
    const machineBtn = target.closest("[data-qb-machine]");
    if (machineBtn) {
      qbState.machineType = qbState.machineType === machineBtn.dataset.qbMachine ? "" : machineBtn.dataset.qbMachine;
      syncQuickBuilderUi();
      return;
    }
    const dateBtn = target.closest("[data-qb-date]");
    if (dateBtn) {
      qbState.datePreset = dateBtn.dataset.qbDate || "none";
      syncQuickBuilderUi();
      return;
    }
    if (target.closest("#aiQbSubmit")) {
      if (qbState.mode === "rent" || qbState.mode === "sale") {
        const dates = qbState.mode === "rent" ? resolveQbDates() : null;
        if (qbState.cropId && !state.filters.cropIds?.length) state.filters.cropIds = [qbState.cropId];
        if (dates && !state.filters.date) {
          state.filters.date = dates.start;
          state.filters.dateEnd = dates.end;
        }
        refreshContextBar();
      }
      submitPrompt(buildQuickPrompt());
    }
  });

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

  $("aiPhotoButton")?.addEventListener("click", () => $("aiPhotoInput")?.click());
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

  function scrollAiToEnd() {
    const scroll = $("aiScroll");
    scroll.scrollTop = scroll.scrollHeight;
  }

  // 예약 뒤 보험 추천: 대화마다 한 번만 묻는다. 진행 상태는 서버가 돌려준 값을 그대로 다음 요청에 보낸다.
  let insuranceOffer = null;
  let insuranceAsked = false;

  function trackInsurance(result) {
    if (!result || !Object.hasOwn(result, "insuranceOffer")) {
      insuranceOffer = null;
      return;
    }
    insuranceAsked = true;
    insuranceOffer = result.insuranceOffer && result.insuranceOffer.stage !== "done" ? result.insuranceOffer : null;
  }

  function appendInsuranceAsk(result) {
    if (!result?.insuranceAsk) return;
    trackInsurance(result);
    const bubble = appendAiMessage(result.insuranceAsk, "assistant");
    rememberAgentTurn({ role: "assistant", content: result.insuranceAsk });
    appendChoices(bubble, ["네, 추천해 주세요", "괜찮아요"]);
  }

  function rememberAgentTurn(...entries) {
    agentHistory = [...agentHistory, ...entries.filter((entry) => entry.content)].slice(-MAX_AGENT_HISTORY);
  }

  function collectUiContext() {
    const filters = state.filters || {};
    const detailBackdrop = $("detailBackdrop");
    const detailListingId = detailBackdrop && !detailBackdrop.hidden
      ? document.querySelector("#detailContent [data-detail-fav]")?.dataset.detailFav
        || document.querySelector("#detailContent [data-detail-manage]")?.dataset.detailManage
        || ""
      : "";
    const viewingListingId = detailListingId || runtime.selectedMapListingId || "";
    return {
      region: state.region || "영양읍",
      transaction: state.transaction === "sale" ? "sale" : "rent",
      cropIds: Array.isArray(filters.cropIds) ? filters.cropIds.slice(0, 4) : [],
      operations: Array.isArray(filters.operations) ? filters.operations.slice(0, 6) : [],
      ...(filters.date ? { date: filters.date, dateEnd: filters.dateEnd || filters.date } : {}),
      ...(Number(filters.areaPyeong) > 0 ? { areaPyeong: Number(filters.areaPyeong) } : {}),
      ...(Number.isSafeInteger(Number(filters.maxPrice)) && Number(filters.maxPrice) > 0 ? { maxPrice: Number(filters.maxPrice) } : {}),
      ...(viewingListingId ? { viewingListingId } : {}),
    };
  }

  function renderReservationBox(bubble, done) {
    if (!done) return;
    const box = document.createElement("div");
    box.className = "ai-rec-overview ai-reservation";
    const rows = [
      ["번호", done.number],
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
    go.textContent = done.kind === "rental" ? "대여 요청 메뉴에서 확인하기 ›" : "거래 채팅에서 확인하기 ›";
    go.addEventListener("click", () => setView("requests"));
    box.append(go);
    bubble.append(box);
    refreshAuthenticatedData?.({
      includeRequests: done.kind === "rental",
      includeConversations: done.kind === "purchase",
    }).catch(() => {});
  }

  function renderCreatedListingButton(bubble, listed) {
    if (!listed) return;
    const go = document.createElement("button");
    go.type = "button";
    go.className = "ai-rec-card-btn";
    go.textContent = `${listed.number ? `등록 번호 ${listed.number} · ` : ""}내 기계 관리에서 보기 ›`;
    go.addEventListener("click", () => setView("owner"));
    bubble.append(go);
    loadCatalog({ quiet: true }).catch(() => {});
  }

  async function executeOneTapAction({ pendingAction, requestId = crypto.randomUUID(), triggerButton, onBusy, onDone, onError }) {
    onBusy?.();
    if (triggerButton) triggerButton.disabled = true;
    try {
      const result = await executeAgentAction(pendingAction, requestId, { insuranceAsked });
      if (result?.outcome === "completed") {
        const bubble = appendAiMessage(`✅ ${result.message}`, "assistant");
        if (result.reservation) renderReservationBox(bubble, result.reservation);
        appendInsuranceAsk(result);
        if (result.createdListing) {
          savedDraft = null;
          clearPhoto();
          renderCreatedListingButton(bubble, result.createdListing);
        }
        rememberAgentTurn({ role: "assistant", content: result.message });
        await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData?.()]).catch(() => {});
        onDone?.("completed", result);
      } else if (result?.outcome === "partial") {
        appendAiMessage(`⚠️ ${result.message}`, "assistant");
        rememberAgentTurn({ role: "assistant", content: result.message });
        await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData?.()]).catch(() => {});
        onDone?.("partial", result);
      } else {
        const msg = `❌ 처리하지 못했어요. ${result?.message || ""}`.trim();
        appendAiMessage(msg, "assistant");
        onDone?.("failed", result);
      }
      scrollAiToEnd();
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") {
        if (triggerButton) triggerButton.disabled = false;
        onError?.("aborted", error);
        return;
      }
      if (error?.status === 401) {
        const loginMsg = pendingAction.type === "create_listing"
          ? "🔒 매물 등록은 로그인한 뒤 할 수 있어요. 로그인하면 입력한 초안으로 이어서 등록해요."
          : "🔒 예약·신청은 로그인한 뒤 보낼 수 있어요. 로그인하면 바로 이어서 진행해요.";
        appendAiMessage(loginMsg, "assistant");
        onDone?.("login", null);
        if (pendingAction.type === "rental_request") {
          savePendingIntentAndRedirectLogin?.(
            { type: "rental", listingId: pendingAction.listingId, draftValues: { start: pendingAction.start, end: pendingAction.end, note: pendingAction.note || "", requestId } },
            "로그인 후 대여 요청을 이어서 보낼 수 있어요.",
          );
        } else if (pendingAction.type === "purchase_request") {
          savePendingIntentAndRedirectLogin?.(
            { type: "chat", listingId: pendingAction.listingId, draftBody: "구매 신청을 희망합니다." },
            "로그인 후 구매 신청을 이어서 보낼 수 있어요.",
          );
        } else if (pendingAction.type === "create_listing") {
          const formDraft = { ...pendingAction, type: pendingAction.listingType || "rent" };
          savePendingIntentAndRedirectLogin?.(
            { type: "newListing", draftValues: listingDraftToFormValues(formDraft, lastPhotoDataUrl) },
            "로그인 후 매물 등록을 이어서 완료할 수 있어요.",
          );
        }
        return;
      }
      if (triggerButton) triggerButton.disabled = false;
      if (onError) onError("failed", error, requestId);
      else appendAiMessage(error?.message || "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.", "assistant");
    }
  }

  function appendDateQuickPicker(bubble, { defaultStart = "", defaultEnd = "", buttonLabel = "이 기간 적용", onApply }) {
    const baseToday = today();
    const startVal = defaultStart && defaultStart >= baseToday ? defaultStart : addDays(baseToday, 1);
    const endVal = defaultEnd && defaultEnd >= startVal ? defaultEnd : startVal;
    const wknd = weekendWindow(baseToday);

    const wrap = document.createElement("div");
    wrap.className = "ai-date-picker";

    const presets = document.createElement("div");
    presets.className = "ai-date-presets";
    for (const [label, s, e] of [
      ["내일 하루", addDays(baseToday, 1), addDays(baseToday, 1)],
      ["모레부터 2일", addDays(baseToday, 2), addDays(baseToday, 3)],
      ["이번 주말(토~일)", wknd.start, wknd.end],
    ]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-date-preset-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        wrap.remove();
        onApply(s, e);
      });
      presets.append(btn);
    }

    const row = document.createElement("div");
    row.className = "ai-date-inputs";
    const startInput = document.createElement("input");
    startInput.type = "date";
    startInput.min = baseToday;
    startInput.value = startVal;
    startInput.setAttribute("aria-label", "대여 시작일");
    const sep = document.createElement("span");
    sep.textContent = "~";
    const endInput = document.createElement("input");
    endInput.type = "date";
    endInput.min = startVal;
    endInput.value = endVal;
    endInput.setAttribute("aria-label", "반납일");
    startInput.addEventListener("change", () => {
      endInput.min = startInput.value || baseToday;
      if (!endInput.value || endInput.value < startInput.value) endInput.value = startInput.value;
    });

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "button button-primary";
    applyBtn.textContent = buttonLabel;
    applyBtn.addEventListener("click", () => {
      const s = startInput.value;
      const e = endInput.value || s;
      if (!s || e < s) return toast("올바른 시작일과 반납일을 골라 주세요.");
      wrap.remove();
      onApply(s, e);
    });

    row.append(startInput, sep, endInput, applyBtn);
    wrap.append(presets, row);
    bubble.append(wrap);
    scrollAiToEnd();
  }

  function startOneTapListingAction(item, activeDates = null, targetBubble = null, triggerButton = null) {
    if (item.type === "sale") {
      rememberAgentTurn({ role: "user", content: `'${item.title}' 바로 구매 신청` });
      return executeOneTapAction({
        pendingAction: { type: "purchase_request", listingId: item.id, title: item.title, region: item.region, price: item.price },
        triggerButton,
        onDone: (outcome) => { if (triggerButton && outcome !== "completed") triggerButton.disabled = false; },
      });
    }
    const start = activeDates?.start || state.filters?.date || "";
    const end = activeDates?.end || state.filters?.dateEnd || start;
    if (start) {
      rememberAgentTurn({ role: "user", content: `'${item.title}' ${start}~${end} 바로 예약` });
      return executeOneTapAction({
        pendingAction: { type: "rental_request", listingId: item.id, title: item.title, region: item.region, start, end, note: "농농 채팅 원탭 예약" },
        triggerButton,
        onDone: (outcome) => { if (triggerButton && outcome !== "completed") triggerButton.disabled = false; },
      });
    }
    const promptBubble = targetBubble || appendAiMessage(`'${item.title}'을(를) 언제 빌리실까요? 날짜를 고르시면 바로 예약해 드려요.`, "assistant");
    appendDateQuickPicker(promptBubble, {
      buttonLabel: "이 날짜로 바로 예약",
      onApply: (pickedStart, pickedEnd) => {
        rememberAgentTurn({ role: "user", content: `'${item.title}' ${pickedStart}~${pickedEnd} 바로 예약` });
        executeOneTapAction({
          pendingAction: { type: "rental_request", listingId: item.id, title: item.title, region: item.region, start: pickedStart, end: pickedEnd, note: "농농 채팅 원탭 예약" },
        });
      },
    });
  }

  function appendAiMessage(text, role, listingIds = [], photo = null, { searchDates = null } = {}) {
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
      titleEl.textContent = "농농이가 찾은 맞춤 매물";
      results.append(titleEl);

      const effectiveStart = searchDates?.start || state.filters?.date || "";
      const effectiveEnd = searchDates?.end || state.filters?.dateEnd || effectiveStart;
      const activeDates = effectiveStart ? { start: effectiveStart, end: effectiveEnd } : null;

      listingIds.forEach((id) => {
        const item = listingById(id);
        if (!item) return;
        const card = document.createElement("div");
        card.className = "ai-rec-card";

        const info = document.createElement("div");
        info.className = "ai-rec-info";
        info.innerHTML = `
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.region)} · ${money(item.price)}${item.type === "rent" ? "/일" : ""}</small>
          <small>${escapeHtml(areaLabel(item.areaMin, item.areaMax))} · ${escapeHtml(item.pickup || "인수 방법 문의")}</small>
        `;

        const actions = document.createElement("div");
        actions.className = "ai-rec-card-actions";
        const detailBtn = document.createElement("button");
        detailBtn.type = "button";
        detailBtn.className = "button button-secondary";
        detailBtn.textContent = "상세 보기";
        detailBtn.addEventListener("click", () => openDetail(item.id));
        actions.append(detailBtn);

        if (!item.owner && item.status === "open" && item.condition !== "repair") {
          const quickBtn = document.createElement("button");
          quickBtn.type = "button";
          quickBtn.className = "button button-primary";
          if (item.type === "rent") {
            quickBtn.textContent = activeDates
              ? `⚡ 바로 예약 (${formatShortDate(activeDates.start)}~${formatShortDate(activeDates.end)})`
              : "📅 날짜 골라 바로 예약";
          } else {
            quickBtn.textContent = "⚡ 바로 구매 신청";
          }
          quickBtn.addEventListener("click", () => startOneTapListingAction(item, activeDates, null, quickBtn));
          actions.append(quickBtn);
        }

        card.append(info, actions);
        results.append(card);
      });
      bubble.append(results);
    }
    $("aiMessages").append(bubble);
    scrollAiToEnd();
    return bubble;
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

  function appendConfirmation(bubble, action) {
    const requestId = crypto.randomUUID();
    const isPurchase = action.type === "purchase_request";
    const card = document.createElement("div");
    card.className = "ai-confirm";
    const title = document.createElement("strong");
    title.className = "ai-confirm-title";
    title.textContent = isPurchase ? "구매 신청 확인" : "대여 요청 확인";
    card.append(title);
    const rows = isPurchase
      ? [
          ["매물", action.title],
          ["지역", action.region],
          ["판매가", money(action.price)],
          ["메모", action.note],
        ]
      : [
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
    notice.textContent = isPurchase
      ? "승인하면 판매자에게 구매 신청 채팅이 전송돼요."
      : "승인하면 게시자에게 대여 요청이 전송돼요. 예약은 게시자가 승인해야 확정돼요.";
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

    cancel.addEventListener("click", () => {
      card.dataset.state = "cancelled";
      actions.remove();
      rememberAgentTurn({ role: "user", content: "요청은 보내지 않을게요." });
      const msg = "알겠어요. 요청은 보내지 않았어요. 다른 날짜나 매물이 필요하면 말씀해 주세요.";
      appendAiMessage(msg, "assistant");
      rememberAgentTurn({ role: "assistant", content: msg });
    });

    approve.addEventListener("click", () => {
      rememberAgentTurn({ role: "user", content: "승인합니다. 요청을 보내 주세요." });
      executeOneTapAction({
        pendingAction: action,
        requestId,
        triggerButton: approve,
        onBusy: () => {
          setBusy(true);
          approve.textContent = "요청을 보내는 중…";
        },
        onDone: (outcome) => {
          card.dataset.state = outcome;
          actions.remove();
        },
        onError: (kind) => {
          if (kind === "aborted") {
            setBusy(false);
            approve.textContent = "승인하고 요청 보내기";
            return;
          }
          setBusy(false);
          approve.textContent = "다시 시도";
          appendAiMessage("요청 결과를 확인하지 못했어요. ‘다시 시도’를 누르거나 거래 화면에서 요청이 보내졌는지 확인해 주세요.", "assistant");
        },
      });
    });
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
    const requestId = crypto.randomUUID();
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
    notice.textContent = "💡 플랫폼 등록 매물 기준 참고가예요. [확인 필요] 부분은 등록 화면에서 고칠 수 있어요.";
    const actions = document.createElement("div");
    actions.className = "ai-confirm-actions";

    const quickRegister = document.createElement("button");
    quickRegister.type = "button";
    quickRegister.className = "button button-primary";
    quickRegister.textContent = "⚡ 채팅에서 바로 등록";
    quickRegister.addEventListener("click", () => {
      if (!(Number.isFinite(draft.price) && draft.price > 0)) {
        toast("가격이 정해지지 않았어요. 상세 화면에서 가격을 입력해 주세요.");
        if (savedDraft?.listingId === draft.listingId) savedDraft = null;
        openNewListing?.(listingDraftToFormValues(draft, lastPhotoDataUrl));
        return;
      }
      rememberAgentTurn({ role: "user", content: "초안 내용대로 매물을 바로 등록해 주세요." });
      executeOneTapAction({
        pendingAction: {
          ...draft,
          listingType: draft.type === "sale" ? "sale" : "rent",
          type: "create_listing",
          ...(!draft.photoKey && lastPhotoDataUrl ? { photoDataUrl: lastPhotoDataUrl } : {}),
        },
        requestId,
        triggerButton: quickRegister,
        onBusy: () => { quickRegister.textContent = "등록하는 중…"; },
        onDone: (outcome) => {
          card.dataset.state = outcome;
          if (outcome === "completed") quickRegister.remove();
          else {
            quickRegister.disabled = false;
            quickRegister.textContent = "⚡ 채팅에서 바로 등록";
          }
        },
        onError: () => {
          quickRegister.disabled = false;
          quickRegister.textContent = "다시 시도";
          toast("매물을 등록하지 못했어요. 다시 시도해 주세요.");
        },
      });
    });

    const register = document.createElement("button");
    register.type = "button";
    register.className = "button button-secondary";
    register.textContent = "📝 상세 수정 후 등록";
    register.addEventListener("click", () => {
      if (savedDraft?.listingId === draft.listingId) savedDraft = null;
      openNewListing?.(listingDraftToFormValues(draft, lastPhotoDataUrl));
    });

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "button button-secondary";
    copy.textContent = "📋 복사";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(`${draft.title}\n\n${draft.description}`);
        toast("소개글을 복사했어요.");
      } catch {
        toast("복사하지 못했어요. 글을 길게 눌러 복사해 주세요.");
      }
    });

    actions.append(quickRegister, register, copy);
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
    const listingIds = result.reservation || result.createdListing || result.updatedListing
      ? []
      : (Array.isArray(result.listingIds) ? result.listingIds : []).filter((id) => listingById(id));
    const bubble = appendAiMessage(reply, "assistant", listingIds, null, { searchDates: result.searchDates || null });
    if (result.reservation) renderReservationBox(bubble, result.reservation);
    const listed = result.createdListing || result.updatedListing;
    if (listed) renderCreatedListingButton(bubble, listed);
    if (Array.isArray(result.repairCenters) && result.repairCenters.length) appendRepairCenters(bubble, result.repairCenters);
    if (result.listingDraft) appendListingDraft(bubble, result.listingDraft);
    if (Array.isArray(result.sources) && result.sources.length) appendSources(bubble, result.sources);

    const choices = inferFollowUpChoices(reply, result);
    if (choices.length) appendChoices(bubble, choices);
    if (wantsDatePicker(reply, result)) {
      appendDateQuickPicker(bubble, {
        defaultStart: state.filters?.date || "",
        defaultEnd: state.filters?.dateEnd || "",
        onApply: (pickedStart, pickedEnd) => {
          $("aiInput").value = `${pickedStart}부터 ${pickedEnd}까지로 해주세요.`;
          $("aiForm").requestSubmit();
        },
      });
    }
    if (result.pendingAction?.type === "rental_request" || result.pendingAction?.type === "purchase_request") {
      appendConfirmation(bubble, result.pendingAction);
    }
    appendInsuranceAsk(result);
    $("aiModeLabel").textContent = "농농 AI · 추천부터 예약까지";
    scrollAiToEnd();
  }

  function refreshContextBar() {
    const bar = $("aiContextBar");
    if (!bar) return;
    const ui = collectUiContext();
    const badges = [];
    if (ui.region) badges.push(`📍 ${ui.region}`);
    if (ui.cropIds.length) badges.push(`🌱 ${ui.cropIds.map((id) => CROP_BY_ID[id]?.name).filter(Boolean).join(", ")}`);
    if (ui.operations.length) badges.push(`⚙️ ${ui.operations.map((id) => OPERATION_BY_ID[id]?.label).filter(Boolean).slice(0, 2).join(", ")}`);
    if (ui.date) badges.push(`📅 ${formatShortDate(ui.date)}~${formatShortDate(ui.dateEnd || ui.date)}`);
    const viewingItem = ui.viewingListingId ? listingById(ui.viewingListingId) : null;

    bar.replaceChildren();
    if (!badges.length && !viewingItem) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    for (const text of badges) {
      const span = document.createElement("span");
      span.className = "ai-context-badge";
      span.textContent = text;
      bar.append(span);
    }
    if (viewingItem && !viewingItem.owner && viewingItem.status === "open" && viewingItem.condition !== "repair") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-context-action";
      btn.textContent = viewingItem.type === "rent"
        ? `⚡ ${viewingItem.title.slice(0, 12)}… 바로 예약`
        : `⚡ ${viewingItem.title.slice(0, 12)}… 바로 구매`;
      btn.addEventListener("click", () => startOneTapListingAction(viewingItem, null, null, btn));
      bar.append(btn);
    }
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
    $("aiMessages").querySelectorAll(".ai-follow-up, .ai-date-picker").forEach((el) => el.remove());
    appendAiMessage(message, "user", [], sendingPhoto);
    let pending;

    try {
      if (!sendingPhoto && AGENT_RESET_RE.test(message)) {
        performReset();
        return;
      }
      pending = appendAiMessage(sendingPhoto ? "농농이가 사진을 보고 있어요…" : "농농이가 생각하고 있어요…", "assistant");
      if (runtime.catalogState !== "ready") await Promise.resolve(runtime.catalogReady).catch(() => {});
      const uiContext = collectUiContext();
      const agentResult = await askAgent(message, {
        history: agentHistory,
        region: uiContext.region,
        uiContext,
        image: sendingPhoto || undefined,
        savedDraft,
        insuranceOffer,
        insuranceAsked,
      });
      pending.remove();
      pending = undefined;
      if (agentResult?.mode === "agent") {
        if (!agentResult.insuranceAsk) trackInsurance(agentResult);
        if (sendingPhoto) {
          photoIsNew = false;
          showPhotoPreview();
        }
        if (agentResult.createdListing) clearPhoto();
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
    refreshContextBar();
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

  function performReset() {
    agentHistory = [];
    insuranceOffer = null;
    insuranceAsked = false;
    savedDraft = null;
    lastPhotoDataUrl = null;
    qbState.mode = "rent";
    qbState.cropId = "";
    qbState.machineType = "";
    qbState.datePreset = "none";
    syncQuickBuilderUi();
    clearPhoto();
    $("aiMessages").replaceChildren();
    $("aiStarters").hidden = false;
    $("aiInput").value = "";
    $("aiInput").placeholder = aiDefaultPlaceholder;
    refreshContextBar();
    appendAiMessage("어떤 작물에 어떤 작업을 하실 건가요? 위 조건이나 예시 버튼을 눌러 바로 시작해 보세요.", "assistant");
    $("aiInput").focus();
  }

  function resetAiPanel() {
    if (recommendationPending) return;
    performReset();
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
    refreshContextBar,
  };
}
