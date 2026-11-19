import { CROPS, OPERATIONS, MACHINE_TYPES, CROP_BY_ID, OPERATION_BY_ID, MACHINE_BY_ID, REGION_COORDS } from "../data/farm-machines.js";
import { MACHINE_SPECIFICATIONS, SPEC_BY_ID, getSpecificationDefaults } from "../data/machine-specifications.js";
import { available } from "../data/recommendation.js";
import { $, escapeHtml, money, areaLabel, today, addDays, koreanDateParts, pictureIcon, toast, showDialog, hideDialog, getListingPhotoSrc, hasListingPhoto } from "../core/utils.js";
import { state, runtime, isLoggedIn, apiFetch, allListings, listingById, statusLabel, statusClass, stopChatPolling, readGuestFavorites, clearGuestFavorites } from "../core/store.js";
import { openCameraCapture, shrinkPhoto } from "../ai/panel.js";
import { renderBookingWeatherPanel } from "./map-weather.js";
import {
  senderState, SENDER_LABEL, roleOf, readSeqFor,
  presetsForListingType, getDelegationPreset, buildQuickDelegationPolicy,
} from "../data/deals-model.js";
import { formatOrderChatMessage, parseOrderChatMessage } from "./cart-checkout.js";

export const DELEGATED_TRADE_EVENT = "moa:start-delegated-trade";

let _activeStartDelegatedTrade = null;
let _activeOpenChat = null;
let _delegatedEventListener = null;
let _openChatEventListener = null;
let _orderCompletedListener = null;
let _delegatedClickListener = null;
const _syncedOrderNumbers = new Set();

export function startDelegatedTradeForListing(listingId, options = {}) {
  if (typeof _activeStartDelegatedTrade === "function") {
    return _activeStartDelegatedTrade(listingId, options);
  }
  return false;
}

export function createTransactionViews(deps) {
function openForm(html) {
  stopChatPolling();
  $("formContent").innerHTML = html;
  showDialog($("formBackdrop"));
}

const REQUEST_STATE_LABEL = {
  approvable: "승인 대기",
  conflict: "일정 충돌 (승인 불가)",
  operator_conflict: "작업자 일정 겹침",
  expired: "기간 경과",
  upcoming: "예약 확정",
  active: "대여 중",
  completed: "대여 완료",
  rejected: "거절됨",
  cancelled: "취소됨",
};

function renderRequestBadge(req) {
  const label = REQUEST_STATE_LABEL[req.derivedState] || req.status;
  return `<span class="step-pill req-pill req-pill-${escapeHtml(req.derivedState || req.status)}">${escapeHtml(label)}</span>`;
}

function renderRentalOperator(req) {
  const operator = req.rentalOperator;
  if (!operator) return "";
  const assigned = ["upcoming", "active", "completed"].includes(req.derivedState);
  const label = assigned ? "배치된 작업자" : "요청한 작업자";
  return `<details class="rental-operator">
    <summary>${label} · ${escapeHtml(operator.name)} · ${money(operator.dailyPrice)}/일</summary>
    <small class="rental-operator-experience">${escapeHtml(operator.experience)}</small>
  </details>`;
}

function rentalForm(id, draftValues = null) {
  const item = listingById(id);
  if (!item) return;
  if (!isLoggedIn()) {
    deps.savePendingIntentAndRedirectLogin({
      type: "rental",
      listingId: id,
      draftValues,
    });
    return;
  }
  const minToday = today();
  const initialStart = draftValues?.start || (state.filters.date >= minToday ? state.filters.date : minToday);
  const initialEnd = draftValues?.end || (state.filters.dateEnd >= initialStart ? state.filters.dateEnd : initialStart);
  const initialNote = draftValues?.note || "";
  const operator = item.rentalOperator;
  const savedOperator = draftValues?.rentalOperator;
  const restoreOperator = Boolean(operator && savedOperator &&
    operator.name === savedOperator.name &&
    operator.experience === savedOperator.experience &&
    operator.dailyPrice === savedOperator.dailyPrice);
  const getRequestedOperator = () => $("rentWithOperator")?.checked ? operator : null;
  let draftRequestId = draftValues?.requestId || crypto.randomUUID();

  openForm(`
    <span class="step-pill">간편 대여 신청</span>
    <h2 id="formTitle">농기계 대여 요청하기</h2>
    <p><strong>${escapeHtml(item.title)}</strong> (${money(item.price)}/일) · 일정을 선택해 요청을 보내면 소유 농가에서 확인 후 승인해 드립니다.</p>
    <form class="stack-form" id="rentalForm">
      <div class="form-row-2">
        <label>대여 시작일<input type="date" id="rentStart" min="${minToday}" value="${escapeHtml(initialStart)}" required></label>
        <label>반납 예정일<input type="date" id="rentEnd" min="${escapeHtml(initialStart)}" value="${escapeHtml(initialEnd)}" required></label>
      </div>
      <div id="rentalBookingWeather" class="rental-booking-weather" hidden aria-live="polite"></div>
      ${operator ? `<div class="rental-operator rental-operator-option">
        <label class="rental-operator-toggle">
          <input type="checkbox" id="rentWithOperator" ${restoreOperator ? "checked" : ""}>
          <span>작업자 동반 <strong>+${money(operator.dailyPrice)}/일</strong></span>
        </label>
        <details>
          <summary>${escapeHtml(operator.name)} 작업자 이력 보기</summary>
          <p class="rental-operator-experience">${escapeHtml(operator.experience)}</p>
        </details>
        <small>소유 농가가 대여를 승인하면 작업자 배치도 확정돼요.</small>
      </div>` : ""}
      <p id="rentalEstimate" aria-live="polite"></p>
      <label>작업 내용 · 방문 메모 (선택)
        <textarea id="rentNote" maxlength="500" placeholder="예: 고추밭 300평 두둑 작업 예정입니다. 오전 9시에 직접 방문해 인수하겠습니다.">${escapeHtml(initialNote)}</textarea>
      </label>
      <div class="form-actions">
        <button class="button button-primary button-large" type="submit" id="rentalSubmitButton">대여 요청 보내기</button>
      </div>
    </form>
  `);

  let lastPayloadFingerprint = null;
  let lastBookingWeatherKey = "";
  let busy = false;

  const updateBookingWeather = (start, end, valid) => {
    const weatherHost = $("rentalBookingWeather");
    if (!weatherHost) return;
    if (!valid) {
      lastBookingWeatherKey = "";
      weatherHost.innerHTML = "";
      weatherHost.hidden = true;
      return;
    }
    const key = `${item.region}:${start}:${end}`;
    if (key === lastBookingWeatherKey) return;
    lastBookingWeatherKey = key;
    renderBookingWeatherPanel(weatherHost, { region: item.region, start, end });
  };

  const updateEstimate = () => {
    const start = $("rentStart").value;
    const end = $("rentEnd").value;
    $("rentEnd").min = start || minToday;
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    const valid = Number.isInteger(days) && days > 0 && start >= minToday;
    const button = $("rentalSubmitButton");
    if (valid) {
      const machineTotal = item.price * days;
      const operatorTotal = (getRequestedOperator()?.dailyPrice ?? 0) * days;
      const totalPrice = machineTotal + operatorTotal;
      const extras = "운송비와 보증금은 소유 농가에 확인해 주세요.";
      $("rentalEstimate").textContent = operatorTotal
        ? `농기계 ${money(machineTotal)} + 작업자 ${money(operatorTotal)} = ${money(totalPrice)}. ${extras}`
        : extras;
      button.textContent = `${days}일 · ${money(totalPrice)} 대여 신청하기`;
      if (!busy) button.disabled = false;
    } else {
      $("rentalEstimate").textContent = "시작일과 반납일을 확인해 주세요.";
      button.textContent = "대여 기간을 확인해 주세요";
      button.disabled = true;
    }
    updateBookingWeather(start, end, valid);
  };
  $("rentalForm").addEventListener("input", () => {
    const fp = `${$("rentStart").value}|${$("rentEnd").value}|${$("rentNote").value.trim()}|${Boolean(getRequestedOperator())}`;
    if (lastPayloadFingerprint && fp !== lastPayloadFingerprint) {
      draftRequestId = crypto.randomUUID();
      lastPayloadFingerprint = null;
    }
    updateEstimate();
  });
  updateEstimate();
  if (savedOperator && !restoreOperator) {
    draftRequestId = crypto.randomUUID();
    toast("작업자 옵션이 변경됐어요. 새 요금과 이력을 확인해 주세요.");
  }

  $("rentalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const start = $("rentStart").value;
    const end = $("rentEnd").value;
    const note = $("rentNote").value.trim();
    if (end < start || start < today()) return toast("대여 시작일과 반납일을 다시 확인하세요.");
    if (!available(listingById(id), start, end)) return toast("해당 기간에는 이미 확정된 예약이 있어 대여할 수 없습니다.");

    const rentalOperator = getRequestedOperator();
    lastPayloadFingerprint = `${start}|${end}|${note}|${Boolean(rentalOperator)}`;
    busy = true;
    const button = $("rentalSubmitButton");
    button.disabled = true;
    try {
      await apiFetch("/api/requests", {
        method: "POST",
        json: { action: "create", id: draftRequestId, listingId: id, start, end, note, rentalOperator },
      });
      hideDialog($("formBackdrop"));
      await Promise.all([deps.loadCatalog({ quiet: true }), deps.refreshAuthenticatedData()]);
      toast("대여 요청을 보냈습니다! 상대방이 승인하면 예약이 확정됩니다.");
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if (error?.status === 401) {
        deps.savePendingIntentAndRedirectLogin(
          { type: "rental", listingId: id, draftValues: { start, end, note, rentalOperator, requestId: draftRequestId } },
          "세션이 만료되었습니다. 로그인 후 이어서 신청할 수 있어요."
        );
        return;
      }
      if (error?.code === "OPERATOR_OPTION_CHANGED") {
        await deps.loadCatalog({ quiet: true });
        if ($("rentalSubmitButton") === button) rentalForm(id, { start, end, note, rentalOperator });
        return;
      }
      toast(error?.message || "대여 요청을 보내지 못했습니다.");
    } finally {
      busy = false;
      if ($("rentalSubmitButton") === button) updateEstimate();
    }
  });
}

const AI_POLICY_CHIPS = [
  { id: "pickupTime", label: "인수 시간 조율" },
  { id: "compatibility", label: "작업기·호환성 안내" },
  { id: "availability", label: "빈 날짜 확인" },
  { id: "noNegotiation", label: "가격 흥정 거절" },
];

const ESCALATION_REASON_LABEL = {
  price_negotiation: "가격 할인·흥정 요청",
  budget_exceeded: "예산 상한 초과",
  price_below_minimum: "최소 수락 금액 미달",
  schedule_conflict: "일정 중복·예약 불가",
  invalid_schedule: "일정 확인 필요",
  listing_unavailable: "매물 상태 변경",
  warranty: "보증·수리 책임 확인",
  warranty_claim: "보증·수리 책임 확인",
  personal_info: "연락처·상세 주소 요청",
  privacy_info: "연락처·상세 주소 요청",
  low_confidence: "확신 부족 / 추가 확인 필요",
  out_of_scope: "위임 범위 외 문의",
  policy_exceeded: "위임 정책 범위 초과",
  condition_check: "실물 상태 확인 필요",
  unknown_condition: "매물 정보에 없는 문의",
  full_delegation_disabled: "거래 전담 모드 비활성",
};

function formatPausedReason(reason) {
  if (!reason) return "";
  if (reason === "transaction_completed") {
    return "농농이가 합의 조건으로 신청을 접수했어요. 상대 승인 전이며 거래 완료가 아니에요.";
  }
  if (reason === "max_turns_reached") {
    return "연속 AI 응답 상한에 도달해 대리 응대를 잠시 멈췄어요. 직접 답장하시면 대화가 이어집니다.";
  }
  if (reason === "both_ai_handoff") {
    return "양측 농농이가 핵심 조건을 정리하고 바통을 넘겼어요. 확인 후 직접 답장하거나 대여를 진행해 주세요.";
  }
  if (reason.startsWith("escalated:")) {
    const code = reason.slice("escalated:".length).trim();
    const label = ESCALATION_REASON_LABEL[code] || code || "추가 확인 필요";
    return `농농이가 확인이 필요해 답변을 멈췄어요 (사유: ${label}). 직접 답장하시면 대화가 이어집니다.`;
  }
  if (reason === "takeover") {
    return "직접 진행 중이에요. '다시 맡기기'를 누르기 전까지 농농이는 자동으로 보내지 않아요.";
  }
  if (reason === "user_paused") {
    return "농농이 자동 응대를 일시정지했어요. '다시 맡기기'를 누르면 이어서 응대해요.";
  }
  if (reason.startsWith("failed:")) {
    return "농농이 답장 생성에 실패했어요. 거래 관리에서 재시도하거나 직접 답장해 주세요.";
  }
  return `농농이 대리 응대가 일시정지되었어요 (${reason}). '다시 맡기기'로 재개할 수 있어요.`;
}

function isWaitingForUserConv(conv) {
  if (!conv) return false;
  const draft = conv.aiDraft || conv.aiDraftJson;
  return Boolean(
    (typeof conv.aiPausedReason === "string" && conv.aiPausedReason.startsWith("escalated:")) ||
    conv.waitingForUser ||
    draft?.waitingForUser
  );
}

function renderConvAiBadges(conv, role) {
  if (!conv) return "";
  const mode = role === "buyer" ? conv.buyerAiMode : conv.ownerAiMode;
  const policy = role === "buyer" ? conv.buyerAiPolicy : conv.ownerAiPolicy;
  const badges = [];
  const myPause = conv.myAiState ? conv.myAiState.pause : conv.aiPausedReason;
  if (myPause === "transaction_completed") {
    badges.push(`<span class="conv-ai-badge conv-ai-badge-done">📨 신청 접수 · 승인 대기</span>`);
  } else if (myPause === "takeover") {
    badges.push(`<span class="conv-ai-badge conv-ai-badge-warn">✋ 직접 진행 중</span>`);
  } else if (isWaitingForUserConv(conv)) {
    badges.push(`<span class="conv-ai-badge conv-ai-badge-warn">⏸️ 직접 답변 대기</span>`);
  } else if (conv.aiPausedReason) {
    badges.push(`<span class="conv-ai-badge conv-ai-badge-warn">⚠️ 확인 필요</span>`);
  } else if (mode && mode !== "off") {
    const label = policy?.fullDelegation ? "🤖 거래 전담 중" : "🤖 대리 중";
    badges.push(`<span class="conv-ai-badge conv-ai-badge-active">${label}</span>`);
  }
  return badges.join("");
}

function renderChatOrderCard(parsed) {
  return `
    <div class="chat-order-card" data-order-number="${escapeHtml(parsed.orderNumber)}">
      <div class="chat-order-card-head">
        <span class="chat-order-card-badge">🛡️ 안전결제 완료</span>
        <span class="chat-order-card-num">${escapeHtml(parsed.orderNumber)}</span>
      </div>
      <strong class="chat-order-card-title">${escapeHtml(parsed.itemSummary)}</strong>
      <div class="chat-order-card-meta">
        <span>${escapeHtml(parsed.deliveryMethod)}</span>
        <span>·</span>
        <span>${escapeHtml(parsed.paymentMethod)}</span>
      </div>
      <div class="chat-order-card-foot">
        <strong class="chat-order-card-total">${escapeHtml(parsed.totalText)}</strong>
        <button type="button" class="chat-order-card-btn" data-chat-open-orders>🧾 결제 내역 보기</button>
      </div>
    </div>
  `;
}

function renderChatListingContextHtml(listing, conv = null) {
  const effective = listing || (conv?.listingId ? listingById(conv.listingId) : null);
  const title = effective?.title || conv?.listingTitle || "농기계 매물";
  const type = effective?.type || conv?.listingType || "rent";
  const priceText = effective?.price != null
    ? `${money(effective.price)}${type === "rent" ? "/일" : ""}`
    : (type === "sale" ? "중고 거래" : "일일 대여");
  const statusText = effective ? statusLabel(effective) : (type === "sale" ? "판매 중" : "예약 가능");
  const statusCls = effective ? statusClass(effective) : "open";
  const photoSrc = effective ? getListingPhotoSrc(effective) : "";
  const isOwner = Boolean(
    (effective?.ownerId && effective.ownerId === runtime.accountUser?.id) ||
    (conv?.ownerId && conv.ownerId === runtime.accountUser?.id)
  );
  const targetListingId = effective?.id || conv?.listingId || "";

  return `
    <div class="chat-context-main">
      ${photoSrc ? `<img class="chat-context-thumb" src="${escapeHtml(photoSrc)}" alt="${escapeHtml(title)}" />` : ""}
      <div class="chat-context-copy">
        <div class="chat-context-top">
          <span class="chat-context-status is-${escapeHtml(statusCls)}">${escapeHtml(statusText)}</span>
          <strong class="chat-context-price">${escapeHtml(priceText)}</strong>
        </div>
        <span class="chat-context-title">${escapeHtml(title)}${effective?.region ? ` · ${escapeHtml(effective.region)}` : ""}</span>
      </div>
    </div>
    <div class="chat-context-pills" role="group" aria-label="매물 빠른 실행">
      ${!isOwner && targetListingId ? `
        <button type="button" id="chatQuickAddCart" class="chat-context-pill" data-chat-cart-add="${escapeHtml(targetListingId)}">🛒 장바구니 담기</button>
        <button type="button" id="chatQuickCheckout" class="chat-context-pill is-primary" data-chat-checkout="${escapeHtml(targetListingId)}">🛡️ 바로 결제/예약</button>
      ` : ""}
      <button type="button" id="chatQuickDelegationPill" class="chat-context-pill is-ai" aria-controls="chatAiControlBar">🤖 거래전담</button>
    </div>
  `;
}

function chatForm(target) {
  const opts = typeof target === "string" ? { listingId: target } : (target || {});
  const listingId = opts.listingId || null;
  let conversationId = opts.conversationId || null;
  const draftBody = typeof opts.draftBody === "string" ? opts.draftBody : "";
  const pendingOrderReceipt = opts.orderReceipt || null;
  const autoSendReceipt = Boolean(opts.autoSendReceipt && pendingOrderReceipt);
  const item = listingId ? listingById(listingId) : null;
  const quickDelegation = Boolean(opts.quickDelegation);
  const listingType = item?.type === "sale" ? "sale" : "rent";
  const presets = presetsForListingType(listingType);
  let selectedPresetId = opts.preset || presets[0]?.id || "quick_rental";
  const incomingPolicy = opts.policy && typeof opts.policy === "object"
    ? opts.policy
    : (opts.aiPolicy && typeof opts.aiPolicy === "object" ? opts.aiPolicy : null);
  const requestedFullDelegation = Boolean(opts.fullDelegation ?? incomingPolicy?.fullDelegation);
  const requestedAiMode = opts.aiMode || (requestedFullDelegation ? "autonomous" : "off");
  const initialPolicyOverride = incomingPolicy || requestedFullDelegation
    ? {
        ...(incomingPolicy || {}),
        ...(requestedFullDelegation
          ? {
              fullDelegation: true,
              autoExecuteTransaction: incomingPolicy?.autoExecuteTransaction !== false,
            }
          : {}),
      }
    : (quickDelegation
      ? buildQuickDelegationPolicy({
          listing: item,
          role: item?.ownerId && item.ownerId === runtime.accountUser?.id ? "owner" : "buyer",
          presetId: selectedPresetId,
          filters: state.filters || {},
          overrides: { fullDelegation: false },
        })
      : null);

  if (!isLoggedIn()) {
    deps.savePendingIntentAndRedirectLogin({
      type: "chat",
      listingId,
      conversationId,
      draftBody,
      ...(quickDelegation ? { quickDelegation: true, preset: selectedPresetId } : {}),
      ...(requestedAiMode !== "off" ? { aiMode: requestedAiMode } : (quickDelegation ? { aiMode: "autonomous" } : {})),
      ...(requestedFullDelegation || quickDelegation ? { fullDelegation: true } : {}),
      ...(initialPolicyOverride ? { policy: initialPolicyOverride, aiPolicy: initialPolicyOverride } : {}),
    });
    return;
  }

  const minToday = today();
  const filterStart = state.filters?.date >= minToday ? state.filters.date : "";
  const filterEnd = state.filters?.dateEnd >= filterStart ? state.filters.dateEnd : filterStart;
  // 한도는 사용자가 직접 정한 값만 쓴다. 매물 정가로 몰래 채우지 않는다.
  const filterBudget = Number(state.filters?.maxPrice) > 0
    ? String(Math.trunc(Number(state.filters.maxPrice)))
    : "";
  const filterArea = Number(state.filters?.areaPyeong) > 0 ? String(Number(state.filters.areaPyeong)) : "";

  const initialDelegationOpen = Boolean(quickDelegation || requestedFullDelegation || (requestedAiMode && requestedAiMode !== "off"));
  const initialPolicyPanelOpen = Boolean(requestedFullDelegation || quickDelegation);
  const activePreset = getDelegationPreset(selectedPresetId, listingType);

  openForm(`
    <span class="step-pill">${quickDelegation ? "🤖 AI 농농이 거래전담 · 1:1 대화" : "1:1 농기계 채팅 문의"}</span>
    <h2 id="formTitle">${item ? escapeHtml(item.title) : "1:1 대화"}</h2>
    <p id="chatSubtitle">${quickDelegation ? "원하는 조건을 고르고 버튼 한 번으로 AI 농농이에게 자동 대화·협상을 맡기세요." : "대화 상대와 기계 상태·인수 일정을 안전하게 조율하세요."}</p>
    <div id="chatListingContext" class="chat-listing-context">${renderChatListingContextHtml(item, null)}</div>
    <div class="chat-load-older-wrap">
      <button type="button" id="chatLoadOlder" class="button button-secondary button-sm" hidden>이전 대화 더 보기</button>
    </div>
    <div id="chatLog" class="chat-log"><div class="chat-empty">대화 내역을 불러오는 중입니다…</div></div>
    <div id="chatPausedBanner" class="chat-paused-banner" role="status" hidden></div>
    <div id="chatDraftBar" class="chat-draft-bar" hidden></div>
    <form id="chatForm" class="chat-send">
      <input id="chatMessage" maxlength="500" placeholder="예: 이번 주 토요일 오전 인수 가능할까요?" aria-label="메시지 입력" required value="${escapeHtml(draftBody)}">
      <button type="submit" id="chatSendButton" class="button button-primary">보내기</button>
    </form>
    <div class="chat-secondary-actions">
      <button type="button" id="chatDelegationTrigger" class="button button-secondary button-sm chat-delegation-trigger${initialDelegationOpen ? " is-open" : ""}" aria-expanded="${initialDelegationOpen ? "true" : "false"}" aria-controls="chatAiControlBar">
        <span>농농이 거래 전담</span>
        <span id="chatDelegationTriggerStatus" class="chat-delegation-trigger-status" hidden></span>
      </button>
      <button type="button" id="chatOpenDeal" class="button button-secondary button-sm chat-open-deal" hidden>거래 관리에서 진행 보기 ↗</button>
    </div>
    <section id="chatAiControlBar" class="chat-ai-bar${quickDelegation ? " is-quick-start" : ""}" aria-label="농농이 거래 전담 설정" ${initialDelegationOpen ? "" : "hidden"}>
      <div id="chatQuickDelegationCard" class="delegated-quickstart-card">
        <div class="delegated-quickstart-head">
          <strong>⚡ 빠른 거래전담 프리셋</strong>
          <small>목적을 고르면 조건이 자동 채워져요</small>
        </div>
        <div class="delegated-preset-list" role="group" aria-label="거래전담 빠른 프리셋">
          ${presets.map((p) => `<button type="button" class="delegated-preset-btn${p.id === selectedPresetId ? " is-selected" : ""}" data-delegation-preset="${escapeHtml(p.id)}" aria-pressed="${p.id === selectedPresetId ? "true" : "false"}" title="${escapeHtml(p.desc)}">${escapeHtml(p.label)}</button>`).join("")}
        </div>
        <p id="chatQuickPresetDesc" class="delegated-quickstart-desc">${escapeHtml(activePreset?.desc || "")}</p>
        <div class="delegated-quickstart-cta">
          <label id="chatQuickSendFirstWrap" class="delegated-quickstart-check">
            <input type="checkbox" id="chatQuickSendFirst" checked>
            <span>첫 문의 메시지도 자동으로 보내기</span>
          </label>
          <button type="button" id="chatQuickStartAiBtn" class="button btn-delegated-trade button-sm">🤖 AI 거래전담 바로 시작</button>
        </div>
      </div>
      <div class="chat-ai-bar-head">
        <span class="chat-ai-title">🤖 농농이 대리 응대</span>
        <div class="chat-ai-modes" role="group" aria-label="대리 응대 모드">
          <button type="button" class="chat-ai-mode-btn active" data-ai-mode="off" aria-pressed="true">끄기</button>
          <button type="button" class="chat-ai-mode-btn" data-ai-mode="autonomous" aria-pressed="false">자동 응대</button>
        </div>
        <button type="button" id="chatAiPolicyToggle" class="button button-secondary button-sm chat-ai-policy-toggle" aria-expanded="${initialPolicyPanelOpen ? "true" : "false"}">${initialPolicyPanelOpen ? "위임 조건 ▴" : "위임 조건 ▾"}</button>
      </div>
      <div class="delegated-full-panel">
        <label class="chat-full-delegation-toggle" for="chatFullDelegationToggle">
          <input type="checkbox" id="chatFullDelegationToggle">
          <span>
            <strong>🤖 거래 전담 (부재중 자동 진행)</strong>
            <small>내가 없어도 조건에 맞으면 예약·거래까지 자동 진행해요</small>
          </span>
          <span id="chatFullDelegationBadge" class="delegated-full-badge">OFF</span>
        </label>
        <div id="chatDelegationSummary" class="chat-delegation-summary" hidden></div>
      </div>
      <div id="chatAiPolicyPanel" class="chat-ai-policy-panel${initialPolicyPanelOpen ? " is-open" : ""}" ${initialPolicyPanelOpen ? "" : "hidden"}>
        <div class="chat-ai-policy-inner">
          <div class="delegated-policy-grid">
            <label>희망 대여 시작일
              <input id="chatPolicyTargetStart" type="date" min="${minToday}" value="${escapeHtml(filterStart)}">
            </label>
            <label>희망 반납일
              <input id="chatPolicyTargetEnd" type="date" min="${escapeHtml(filterStart || minToday)}" value="${escapeHtml(filterEnd)}">
            </label>
            <label><span id="chatPolicyBudgetLabel">최대 예산 상한 (원)</span>
              <input id="chatPolicyBudgetInput" type="number" min="0" step="1000" placeholder="예: 150000" value="${escapeHtml(item?.ownerId && item.ownerId === runtime.accountUser?.id ? "" : filterBudget)}">
            </label>
            <label>내 작업 면적 (평)
              <input id="chatPolicyAreaPyeong" type="number" min="1" step="1" placeholder="예: 500" value="${escapeHtml(filterArea)}">
            </label>
            <label class="delegated-policy-wide">인수/배달 조건 메모
              <input id="chatPolicyPickupPreference" type="text" maxlength="120" placeholder="예: 직접 픽업 가능, 오전 9시 인수 희망">
            </label>
            <label class="chat-delegation-check delegated-policy-wide">
              <input id="chatPolicyAllowNegotiation" type="checkbox">
              <span>가격 협의 허용 (설정 예산/조건 범위 내에서 유연하게 조율)</span>
            </label>
          </div>
          <div class="chat-ai-chips" role="group" aria-label="위임 조건 빠른 설정">
            ${AI_POLICY_CHIPS.map((c) => `<button type="button" class="chat-ai-chip" data-policy-chip="${escapeHtml(c.id)}" aria-pressed="false">${escapeHtml(c.label)}</button>`).join("")}
          </div>
          <div class="chat-ai-instruction-row">
            <input id="chatAiInstructions" type="text" maxlength="300" placeholder="추가 요청·주의사항 (예: 비 오는 날 제외, 로터리 작업기 필수)" aria-label="대리 응대 상세 지침">
            <button type="button" id="chatAiSavePolicy" class="button button-primary button-sm">저장</button>
          </div>
        </div>
      </div>
    </section>
  `);

  const epoch = runtime.authEpoch;
  const bySeq = new Map();
  const renderedSeqs = new Set();
  let hasMoreOlder = false;
  let busy = false;
  let aiBusy = false;
  let draftMessageId = crypto.randomUUID();
  let lastSubmittedBody = null;
  let currentConv = null;
  let currentAiMode = requestedAiMode;
  let fullDelegationEnabled = requestedFullDelegation;
  let pendingInitialAi =
    (requestedAiMode && requestedAiMode !== "off") || requestedFullDelegation
      ? {
          mode: requestedAiMode === "off" ? "autonomous" : requestedAiMode,
          fullDelegation: requestedFullDelegation,
          policy: initialPolicyOverride,
        }
      : null;
  const activeChips = new Set(Array.isArray(initialPolicyOverride?.chips) ? initialPolicyOverride.chips : []);
  let instructionsDirty = false;

  const applyPolicyValuesToInputs = (policy) => {
    const p = policy && typeof policy === "object" ? policy : {};
    if (typeof p.fullDelegation === "boolean") {
      fullDelegationEnabled = p.fullDelegation;
    }
    if ($("chatPolicyTargetStart") && document.activeElement !== $("chatPolicyTargetStart")) {
      if (p.targetStart) $("chatPolicyTargetStart").value = p.targetStart;
      else if (!$("chatPolicyTargetStart").value && filterStart) $("chatPolicyTargetStart").value = filterStart;
    }
    if ($("chatPolicyTargetEnd") && document.activeElement !== $("chatPolicyTargetEnd")) {
      if (p.targetEnd) $("chatPolicyTargetEnd").value = p.targetEnd;
      else if (!$("chatPolicyTargetEnd").value && filterEnd) $("chatPolicyTargetEnd").value = filterEnd;
      if ($("chatPolicyTargetStart")?.value) $("chatPolicyTargetEnd").min = $("chatPolicyTargetStart").value;
    }
    const isBuyer = !currentConv || currentConv.buyerId === runtime.accountUser?.id;
    const budgetVal = isBuyer ? p.maxBudget : (p.minPrice ?? p.maxBudget);
    const fallbackBudget = isBuyer ? filterBudget : "";
    if ($("chatPolicyBudgetInput") && document.activeElement !== $("chatPolicyBudgetInput")) {
      if (budgetVal !== null && budgetVal !== undefined && budgetVal !== "") {
        $("chatPolicyBudgetInput").value = String(budgetVal);
      } else if (!$("chatPolicyBudgetInput").value && fallbackBudget) {
        $("chatPolicyBudgetInput").value = fallbackBudget;
      }
    }
    if ($("chatPolicyAreaPyeong") && document.activeElement !== $("chatPolicyAreaPyeong")) {
      if (p.areaPyeong !== null && p.areaPyeong !== undefined && p.areaPyeong !== "") {
        $("chatPolicyAreaPyeong").value = String(p.areaPyeong);
      } else if (!$("chatPolicyAreaPyeong").value && filterArea) {
        $("chatPolicyAreaPyeong").value = filterArea;
      }
    }
    if ($("chatPolicyPickupPreference") && document.activeElement !== $("chatPolicyPickupPreference") && typeof p.pickupPreference === "string") {
      $("chatPolicyPickupPreference").value = p.pickupPreference;
    }
    const textRule = p.customRules || p.instructions;
    if ($("chatAiInstructions") && typeof textRule === "string" && document.activeElement !== $("chatAiInstructions")) {
      $("chatAiInstructions").value = textRule;
    }
    if (p.allowNegotiation === false) activeChips.add("noNegotiation");
    else if (p.allowNegotiation === true) activeChips.delete("noNegotiation");
  };

  if (initialPolicyOverride) {
    if (Array.isArray(initialPolicyOverride.autoReplyOn)) {
      if (initialPolicyOverride.autoReplyOn.includes("schedule")) activeChips.add("pickupTime");
      if (initialPolicyOverride.autoReplyOn.includes("compatibility") || initialPolicyOverride.autoReplyOn.includes("spec")) activeChips.add("compatibility");
      if (initialPolicyOverride.autoReplyOn.includes("availability") || initialPolicyOverride.autoReplyOn.includes("weather")) activeChips.add("availability");
    }
    applyPolicyValuesToInputs(initialPolicyOverride);
  } else {
    applyPolicyValuesToInputs({});
  }

  const sortedMessages = () => [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const maxSeq = () => {
    const list = sortedMessages();
    return list.length ? list[list.length - 1].seq : 0;
  };
  const minSeq = () => {
    const list = sortedMessages();
    return list.length ? list[0].seq : null;
  };

  function updateDelegationSummary() {
    const el = $("chatDelegationSummary");
    if (!el) return;
    const isBuyer = !currentConv || currentConv.buyerId === runtime.accountUser?.id;
    if ($("chatPolicyBudgetLabel")) {
      $("chatPolicyBudgetLabel").textContent = isBuyer ? "예산 상한(원)" : "최소 수락 금액(원)";
    }
    const startVal = $("chatPolicyTargetStart")?.value || "";
    const endVal = $("chatPolicyTargetEnd")?.value || "";
    const budgetRaw = $("chatPolicyBudgetInput")?.value || "";
    const areaRaw = $("chatPolicyAreaPyeong")?.value || "";
    const pickupRaw = $("chatPolicyPickupPreference")?.value.trim() || "";
    const allowNeg = !activeChips.has("noNegotiation");

    const parts = [];
    if (startVal) parts.push(`일정 ${startVal}${endVal && endVal !== startVal ? `~${endVal}` : ""}`);
    if (budgetRaw && Number(budgetRaw) >= 0) parts.push(`${isBuyer ? "예산" : "최소가"} ${money(Number(budgetRaw))}`);
    if (areaRaw && Number(areaRaw) > 0) parts.push(`${areaRaw}평`);
    parts.push(allowNeg ? "흥정 가능" : "흥정 불가");
    if (pickupRaw) parts.push(pickupRaw);

    if (fullDelegationEnabled || parts.length > 1) {
      el.hidden = false;
      el.innerHTML = parts.map((p) => `<span class="chat-delegation-pill">${escapeHtml(p)}</span>`).join("");
    } else {
      el.hidden = true;
      el.innerHTML = "";
    }
  }

  function syncAiControlUi() {
    const bar = $("chatAiControlBar");
    if (!bar) return;
    bar.querySelectorAll(".chat-ai-mode-btn").forEach((btn) => {
      const isSelected = btn.dataset.aiMode === currentAiMode;
      btn.classList.toggle("active", isSelected);
      btn.setAttribute("aria-pressed", String(isSelected));
      btn.disabled = aiBusy;
    });
    bar.querySelectorAll(".chat-ai-chip").forEach((chip) => {
      const active = activeChips.has(chip.dataset.policyChip);
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
    if ($("chatFullDelegationToggle")) {
      $("chatFullDelegationToggle").checked = fullDelegationEnabled;
      $("chatFullDelegationToggle").disabled = aiBusy;
    }
    const isFullActive = fullDelegationEnabled && currentAiMode === "autonomous";
    const fullBadge = $("chatFullDelegationBadge");
    if (fullBadge) {
      fullBadge.textContent = isFullActive ? "ON" : "OFF";
      fullBadge.classList.toggle("is-active", isFullActive);
    }
    const triggerBtn = $("chatDelegationTrigger");
    const triggerStatus = $("chatDelegationTriggerStatus");
    const isAiActive = currentAiMode !== "off";
    if (triggerBtn) {
      triggerBtn.classList.toggle("is-active", isAiActive);
    }
    if (triggerStatus) {
      if (isFullActive) {
        triggerStatus.textContent = "전담 ON";
        triggerStatus.hidden = false;
      } else if (isAiActive) {
        triggerStatus.textContent = "대리 ON";
        triggerStatus.hidden = false;
      } else {
        triggerStatus.textContent = "";
        triggerStatus.hidden = true;
      }
    }
    bar.querySelector(".delegated-full-panel")?.classList.toggle("is-active", isFullActive);
    if ($("chatPolicyAllowNegotiation")) {
      $("chatPolicyAllowNegotiation").checked = !activeChips.has("noNegotiation");
    }
    if ($("chatAiSavePolicy")) $("chatAiSavePolicy").disabled = aiBusy;
    const quickStartBtn = $("chatQuickStartAiBtn");
    if (quickStartBtn) {
      quickStartBtn.disabled = aiBusy;
      quickStartBtn.classList.toggle("is-active", isFullActive);
      quickStartBtn.textContent = isFullActive
        ? "✓ AI 거래전담 진행 중 (조건 다시 저장)"
        : "🤖 AI 거래전담 바로 시작";
    }
    const quickSendWrap = $("chatQuickSendFirstWrap");
    if (quickSendWrap) {
      const hasMessages = bySeq.size > 0;
      quickSendWrap.hidden = hasMessages;
    }
    bar.querySelectorAll("[data-delegation-preset]").forEach((btn) => {
      const active = btn.dataset.delegationPreset === selectedPresetId;
      btn.classList.toggle("is-selected", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    updateDelegationSummary();
  }

  function hydratePolicyFromConv(conv) {
    if (!conv) return;
    const isBuyer = conv.buyerId === runtime.accountUser?.id;
    const mode = isBuyer ? conv.buyerAiMode : conv.ownerAiMode;
    const policy = isBuyer ? conv.buyerAiPolicy : conv.ownerAiPolicy;
    if (mode) currentAiMode = mode;
    if (policy && typeof policy === "object" && !instructionsDirty) {
      activeChips.clear();
      if (Array.isArray(policy.chips)) {
        for (const c of policy.chips) activeChips.add(c);
      } else {
        if (policy.allowNegotiation === false) activeChips.add("noNegotiation");
        if (Array.isArray(policy.autoReplyOn)) {
          if (policy.autoReplyOn.includes("schedule")) activeChips.add("pickupTime");
          if (policy.autoReplyOn.includes("compatibility") || policy.autoReplyOn.includes("spec")) activeChips.add("compatibility");
          if (policy.autoReplyOn.includes("availability") || policy.autoReplyOn.includes("weather")) activeChips.add("availability");
        }
      }
      fullDelegationEnabled = Boolean(policy.fullDelegation);
      applyPolicyValuesToInputs(policy);
    }
    syncAiControlUi();
  }

  function collectPolicy() {
    const autoReplyOn = [];
    if (activeChips.has("pickupTime")) autoReplyOn.push("schedule");
    if (activeChips.has("compatibility")) autoReplyOn.push("compatibility", "spec");
    if (activeChips.has("availability")) autoReplyOn.push("availability", "weather");
    const isBuyer = !currentConv || currentConv.buyerId === runtime.accountUser?.id;
    const startVal = $("chatPolicyTargetStart")?.value || null;
    const endRaw = $("chatPolicyTargetEnd")?.value || null;
    const endVal = startVal && endRaw && endRaw < startVal ? startVal : (endRaw || startVal);
    const budgetRaw = $("chatPolicyBudgetInput")?.value;
    const budgetNum = budgetRaw !== "" && budgetRaw != null && Number.isFinite(Number(budgetRaw)) && Number(budgetRaw) >= 0
      ? Math.trunc(Number(budgetRaw))
      : null;
    const areaRaw = $("chatPolicyAreaPyeong")?.value;
    const areaNum = areaRaw !== "" && areaRaw != null && Number.isFinite(Number(areaRaw)) && Number(areaRaw) > 0
      ? Number(areaRaw)
      : null;
    const pickupPreference = $("chatPolicyPickupPreference")?.value.trim().slice(0, 120) || "";
    const customText = $("chatAiInstructions")?.value.trim() || "";
    const fullDelegation = Boolean($("chatFullDelegationToggle")?.checked ?? fullDelegationEnabled);
    // 거래 관리에서 설정한 목표가·운송비·필수 질문·명시적 신청 권한 등은 채팅 화면에 입력칸이 없으므로 그대로 보존한다.
    const existingPolicy = currentConv
      ? ((isBuyer ? currentConv.buyerAiPolicy : currentConv.ownerAiPolicy) || {})
      : (initialPolicyOverride || {});

    return {
      ...existingPolicy,
      fullDelegation,
      autoExecuteTransaction: isBuyer
        ? (typeof existingPolicy.autoExecuteTransaction === "boolean" && !fullDelegation
          ? existingPolicy.autoExecuteTransaction
          : fullDelegation)
        : false,
      intent: currentConv?.listingType || item?.type || (state.transaction === "sale" ? "sale" : "rent"),
      targetStart: startVal,
      targetEnd: endVal,
      maxBudget: isBuyer ? budgetNum : null,
      minPrice: isBuyer ? null : budgetNum,
      allowNegotiation: !activeChips.has("noNegotiation"),
      areaPyeong: areaNum,
      cropIds: Array.isArray(state.filters?.cropIds) ? state.filters.cropIds : [],
      operations: Array.isArray(state.filters?.operations) ? state.filters.operations : [],
      ownedModelId: runtime.selectedOwnedMachineId || null,
      region: state.region || null,
      pickupPreference,
      customRules: customText.slice(0, 300),
      instructions: customText,
      autoReplyOn,
      chips: [...activeChips],
    };
  }

  function renderPausedBanner(conv) {
    const banner = $("chatPausedBanner");
    if (!banner) return;
    const reason = conv?.aiPausedReason || "";
    const draft = conv?.aiDraft || conv?.aiDraftJson || null;
    const waitingForUser = isWaitingForUserConv(conv);

    if (!reason && !waitingForUser) {
      banner.hidden = true;
      banner.className = "chat-paused-banner";
      banner.innerHTML = "";
      return;
    }

    banner.hidden = false;
    if (reason === "transaction_completed") {
      const ct = draft?.completedTransaction;
      const lastSys = [...sortedMessages()].reverse().find((m) => m.senderKind === "system");
      const detailText = ct?.kind === "rental" && ct.start
        ? `${ct.start} ~ ${ct.end} (${ct.days}일 · ${money(ct.totalPrice)}) 대여 요청이 접수되었어요.`
        : ct?.kind === "purchase" && Number.isFinite(Number(ct.price))
          ? `${money(ct.price)} 구매 신청이 접수되었어요.`
          : (conv?.escalationSummary || lastSys?.body || "조건과 예산에 맞춰 거래 요청이 자동으로 접수되었습니다.");
      banner.className = "delegated-complete-banner";
      banner.innerHTML = `
        <div class="delegated-banner-copy">
          <strong>📨 농농이가 합의 조건으로 신청을 접수했어요 (상대 승인 대기 · 거래 완료 아님)</strong>
          <small>${escapeHtml(detailText)}</small>
        </div>
        <div class="delegated-banner-actions">
          <button type="button" id="chatGoRequestsBtn" class="button button-primary button-sm">거래 관리에서 신청 상태 보기 ›</button>
        </div>
      `;
      $("chatGoRequestsBtn")?.addEventListener("click", () => {
        stopChatPolling();
        hideDialog($("formBackdrop"));
        deps.refreshAuthenticatedData?.();
        if (conversationId && deps.openDeal) deps.openDeal(conversationId);
        else deps.setView?.("deals");
      });
      return;
    }

    if (waitingForUser) {
      const code = reason.startsWith("escalated:")
        ? reason.slice("escalated:".length).trim()
        : (draft?.reasonCode || draft?.rationale || "");
      const label = code ? (ESCALATION_REASON_LABEL[code] || code) : "";
      const lastSys = [...sortedMessages()].reverse().find((m) => m.senderKind === "system");
      const summary = conv?.escalationSummary || draft?.summaryForUser || lastSys?.body || "";
      const subtitleParts = [
        label ? `사유: ${label}` : "",
        summary && summary !== label ? summary : "",
        "상대방에게는 대답하지 않고 조용히 대기 중이에요. 확인 후 직접 답장해 주세요.",
      ].filter(Boolean);
      const isMine = !draft?.targetUserId || draft.targetUserId === runtime.accountUser?.id;
      const suggestedDraft = isMine ? (draft?.body || draft?.suggestedReplyDraft || "") : "";

      banner.className = "delegated-wait-banner";
      banner.innerHTML = `
        <div class="delegated-banner-copy">
          <strong>⏸️ 적합한 정보가 없어 농농이가 대답하지 않고 기다리고 있어요</strong>
          <small>${escapeHtml(subtitleParts.join(" · "))}</small>
        </div>
        <div class="delegated-banner-actions">
          <button type="button" id="chatFillSuggestedReply" class="button button-primary button-sm">✍️ 내가 직접 답장하기</button>
          <button type="button" id="chatResumeAiBtn" class="button button-secondary button-sm">다시 맡기기</button>
        </div>
      `;
      $("chatFillSuggestedReply")?.addEventListener("click", () => {
        const input = $("chatMessage");
        if (!input) return;
        if (suggestedDraft && !input.value.trim()) {
          input.value = suggestedDraft;
        }
        input.focus();
      });
      $("chatResumeAiBtn")?.addEventListener("click", () => {
        saveAiPolicy("autonomous", collectPolicy(), { resume: true });
      });
      return;
    }

    banner.className = "chat-paused-banner";
    banner.innerHTML = `
      <span class="chat-paused-text">⚠️ ${escapeHtml(formatPausedReason(reason))}</span>
      <button type="button" id="chatResumeAiBtn" class="button button-secondary button-sm">다시 맡기기</button>
    `;
    $("chatResumeAiBtn")?.addEventListener("click", () => {
      saveAiPolicy("autonomous", collectPolicy(), { resume: true });
    });
  }

  function renderDraftBar(conv) {
    const bar = $("chatDraftBar");
    if (!bar) return;
    const draft = conv?.aiDraft || conv?.aiDraftJson;
    if (
      !draft ||
      !draft.body ||
      draft.targetUserId !== runtime.accountUser?.id ||
      isWaitingForUserConv(conv) ||
      conv?.aiPausedReason === "transaction_completed"
    ) {
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    bar.hidden = false;
    bar.innerHTML = `
      <div class="chat-draft-head">
        <strong>🤖 농농이 추천 답장 초안</strong>
        <div class="chat-draft-actions">
          <button type="button" id="chatDraftSend" class="button button-primary button-sm">이대로 보내기</button>
          <button type="button" id="chatDraftEdit" class="button button-secondary button-sm">입력창에 불러오기</button>
          <button type="button" id="chatDraftRegen" class="button button-secondary button-sm">초안 다시 생성</button>
          <button type="button" id="chatDraftDismiss" class="button button-secondary button-sm">무시</button>
        </div>
      </div>
      <p class="chat-draft-body">${escapeHtml(draft.body)}</p>
    `;
    $("chatDraftSend")?.addEventListener("click", () => sendMessageBody(draft.body));
    $("chatDraftEdit")?.addEventListener("click", () => {
      if ($("chatMessage")) {
        $("chatMessage").value = draft.body;
        $("chatMessage").focus();
      }
    });
    $("chatDraftRegen")?.addEventListener("click", async () => {
      if (!conversationId || aiBusy) return;
      aiBusy = true;
      if ($("chatDraftRegen")) $("chatDraftRegen").disabled = true;
      try {
        const res = await apiFetch("/api/conversations", {
          method: "POST",
          json: { action: "generate_ai_draft", conversationId },
        });
        if (epoch !== runtime.authEpoch || $("formBackdrop").hidden) return;
        if (res?.conversation) applyConvMetadata(res.conversation);
        toast("새 답장 초안을 생성했습니다.");
      } catch (error) {
        if (error?.name !== "AbortError" && error?.code !== "AUTH_CHANGED") {
          toast(error?.message || "초안을 다시 생성하지 못했습니다.");
        }
      } finally {
        aiBusy = false;
        if ($("chatDraftRegen")) $("chatDraftRegen").disabled = false;
      }
    });
    $("chatDraftDismiss")?.addEventListener("click", async () => {
      if (!conversationId || aiBusy) return;
      aiBusy = true;
      if ($("chatDraftDismiss")) $("chatDraftDismiss").disabled = true;
      try {
        const res = await apiFetch("/api/conversations", {
          method: "POST",
          json: { action: "dismiss_ai_draft", conversationId },
        });
        if (epoch !== runtime.authEpoch || $("formBackdrop").hidden) return;
        if (res?.conversation) {
          applyConvMetadata(res.conversation);
        } else if (currentConv) {
          currentConv = { ...currentConv, aiDraftJson: null };
          renderDraftBar(currentConv);
        }
      } catch (error) {
        if (error?.name !== "AbortError" && error?.code !== "AUTH_CHANGED") {
          toast(error?.message || "초안을 닫지 못했습니다.");
        }
      } finally {
        aiBusy = false;
        if ($("chatDraftDismiss")) $("chatDraftDismiss").disabled = false;
      }
    });
  }

  function renderChat({ keepScroll = false } = {}) {
    if (!$("chatLog")) return;
    const log = $("chatLog");
    const prevHeight = log.scrollHeight;
    const list = sortedMessages().filter((msg) => {
      if (msg.senderKind !== "system") return true;
      const sharedReason = !msg.escalationReason || msg.escalationReason === "rental_handoff" || msg.escalationReason === "both_ai_handoff" || msg.escalationReason === "transaction_completed";
      return sharedReason || msg.senderId === runtime.accountUser?.id;
    });
    let enterIndex = 0;
    log.innerHTML = list.length
      ? list.map((msg) => {
          const isNew = !keepScroll && !renderedSeqs.has(msg.seq);
          renderedSeqs.add(msg.seq);
          const staggerStyle = isNew ? ` style="--stagger-i:${Math.min(enterIndex++, 8)}"` : "";
          const enterClass = isNew ? " is-entering" : "";
          if (msg.senderKind === "system") {
            return `<div class="chat-line-system${enterClass}"${staggerStyle} role="note">
              <div>${escapeHtml(msg.body)}</div>
            </div>`;
          }
          const sstate = senderState(msg, { meId: runtime.accountUser?.id, myRole: roleOf(currentConv, runtime.accountUser?.id) });
          const mine = sstate === "me_human" || sstate === "me_ai";
          const isAiProxy = msg.senderKind === "ai_proxy";
          const aiBadge = isAiProxy ? `<span class="chat-ai-badge" data-sender-state="${sstate}">🤖 ${escapeHtml(SENDER_LABEL[sstate])}</span>` : "";
          const parsedOrder = parseOrderChatMessage(msg.body);
          const bodyHtml = parsedOrder
            ? renderChatOrderCard(parsedOrder)
            : `<div>${escapeHtml(msg.body)}</div>`;
          return `<div class="chat-line ${mine ? "mine" : ""}${isAiProxy ? " ai-proxy" : ""}${parsedOrder ? " has-order-card" : ""}${enterClass}"${staggerStyle}>
            <b>${escapeHtml(mine ? "나" : (msg.senderName || "상대 농가"))}${aiBadge}</b>
            ${bodyHtml}
          </div>`;
        }).join("")
      : `<div class="chat-empty">아직 나눈 대화가 없어요. 기계 상태와 인수 조건을 먼저 물어보세요!</div>`;
    $("chatLoadOlder").hidden = !hasMoreOlder;
    if ($("chatQuickSendFirstWrap")) {
      $("chatQuickSendFirstWrap").hidden = bySeq.size > 0;
    }
    if (keepScroll) {
      log.scrollTop += log.scrollHeight - prevHeight;
    } else {
      log.scrollTop = log.scrollHeight;
    }
  }

  function applyConvMetadata(conv) {
    if (!conv) return;
    const prevPausedReason = currentConv?.aiPausedReason;
    currentConv = conv;
    conversationId = conv.id;
    const isBuyer = conv.buyerId === runtime.accountUser?.id;
    const peerLabel = isBuyer ? `소유 농가 ${conv.ownerName}` : `문의 농가 ${conv.buyerName}`;
    if ($("formTitle")) $("formTitle").textContent = `${conv.listingTitle || item?.title || "농기계"} · 1:1 대화`;
    if ($("chatSubtitle")) $("chatSubtitle").textContent = `${peerLabel}님과의 대화`;
    if ($("chatListingContext")) {
      $("chatListingContext").innerHTML = renderChatListingContextHtml(item, conv);
    }
    const openDealBtn = $("chatOpenDeal");
    if (openDealBtn && deps.openDeal && openDealBtn.hidden) {
      openDealBtn.hidden = false;
      openDealBtn.addEventListener("click", () => {
        stopChatPolling();
        hideDialog($("formBackdrop"));
        deps.openDeal(conversationId);
      });
    }
    hydratePolicyFromConv(conv);
    renderPausedBanner(conv);
    renderDraftBar(conv);
    if (conv.aiPausedReason === "transaction_completed" && prevPausedReason && prevPausedReason !== "transaction_completed") {
      deps.loadCatalog?.({ quiet: true });
      deps.refreshAuthenticatedData?.();
    }
  }

  async function saveAiPolicy(mode, policy, { quiet = false, resume = false } = {}) {
    if (aiBusy) return;
    if (!conversationId && !listingId) return;
    aiBusy = true;
    const prevMode = currentAiMode;
    currentAiMode = mode;
    syncAiControlUi();
    try {
      const res = await apiFetch("/api/conversations", {
        method: "POST",
        json: {
          action: "update_ai_policy",
          ...(conversationId ? { conversationId } : {}),
          ...(listingId ? { listingId } : {}),
          mode,
          policy,
          ...(resume ? { resume: true } : {}),
        },
      });
      if (epoch !== runtime.authEpoch || $("formBackdrop").hidden) return;
      instructionsDirty = false;
      if (res?.conversation) {
        applyConvMetadata(res.conversation);
        startPolling();
      }
      deps.refreshAuthenticatedData({ includeRequests: false, includeConversations: true });
      if (!quiet) {
        const modeLabel = mode === "autonomous"
          ? (policy?.fullDelegation ? "거래 전담(자동 진행)" : "자동 응대")
          : "끄기";
        toast(`농농이 대리 응대를 '${modeLabel}'(으)로 저장했습니다.`);
      }
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      currentAiMode = prevMode;
      syncAiControlUi();
      toast(error?.message || "대리 응대 설정을 저장하지 못했습니다.");
    } finally {
      aiBusy = false;
      syncAiControlUi();
    }
  }

  async function sendMessageBody(text, { fromForm = false } = {}) {
    if (busy || !text) return;
    const msgId = fromForm ? draftMessageId : crypto.randomUUID();
    if (fromForm) lastSubmittedBody = text;
    busy = true;
    if ($("chatSendButton")) $("chatSendButton").disabled = true;
    try {
      const res = await apiFetch("/api/conversations", {
        method: "POST",
        json: {
          action: "send",
          id: msgId,
          conversationId,
          listingId: listingId || undefined,
          body: text,
        },
      });
      if (epoch !== runtime.authEpoch) return;
      if (res.conversation) applyConvMetadata(res.conversation);
      if (res.message) bySeq.set(res.message.seq, res.message);
      if (fromForm && $("chatMessage")) {
        $("chatMessage").value = "";
        draftMessageId = crypto.randomUUID();
        lastSubmittedBody = null;
      }
      renderChat();
      startPolling();
      if (res.aiReplyScheduled) {
        setTimeout(pollNewMessages, 1000);
      }
      deps.refreshAuthenticatedData({ includeRequests: false, includeConversations: true });
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if (error?.status === 401) {
        deps.savePendingIntentAndRedirectLogin(
          { type: "chat", listingId, conversationId, draftBody: text },
          "세션이 만료되었습니다. 로그인 후 메시지를 이어서 보낼 수 있어요."
        );
        return;
      }
      toast(error?.message || "메시지를 보내지 못했습니다.");
    } finally {
      busy = false;
      if ($("chatSendButton")) $("chatSendButton").disabled = false;
    }
  }

  async function loadInitialMessages() {
    try {
      const qs = conversationId
        ? `conversationId=${encodeURIComponent(conversationId)}&limit=50`
        : `listingId=${encodeURIComponent(listingId)}&limit=50`;
      const data = await apiFetch(`/api/conversations?${qs}`);
      if (epoch !== runtime.authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
      for (const m of data.messages || []) bySeq.set(m.seq, m);
      if (data.conversation) applyConvMetadata(data.conversation);
      hasMoreOlder = Boolean(data.hasMoreOlder);
      renderChat();
      // 사용자가 직접 연 채팅에서 메시지가 화면에 그려진 뒤에만 읽음 처리한다(폴링은 읽음 처리하지 않음).
      markVisibleMessagesRead();
      startPolling();
      if (autoSendReceipt && pendingOrderReceipt) {
        const orderNo = pendingOrderReceipt.orderNumber || pendingOrderReceipt.id || "";
        const alreadySent = orderNo && (
          _syncedOrderNumbers.has(orderNo) ||
          sortedMessages().some((m) => typeof m.body === "string" && m.body.includes(orderNo))
        );
        if (!alreadySent) {
          const receiptBody = formatOrderChatMessage(pendingOrderReceipt);
          if (receiptBody) {
            if (orderNo) _syncedOrderNumbers.add(orderNo);
            await sendMessageBody(receiptBody);
            toast("결제 완료 내역을 1:1 대화에 전달했습니다.");
          }
        }
      }
      if (pendingInitialAi) {
        const init = pendingInitialAi;
        pendingInitialAi = null;
        const isBuyer = currentConv ? currentConv.buyerId === runtime.accountUser?.id : true;
        const existingMode = currentConv ? (isBuyer ? currentConv.buyerAiMode : currentConv.ownerAiMode) : "off";
        const existingPolicy = currentConv ? (isBuyer ? currentConv.buyerAiPolicy : currentConv.ownerAiPolicy) : null;
        const needsDelegation = Boolean(init.fullDelegation && !existingPolicy?.fullDelegation);
        if (!existingMode || existingMode === "off" || needsDelegation) {
          const mergedPolicy = {
            ...collectPolicy(),
            ...(init.policy || {}),
            ...(init.fullDelegation ? { fullDelegation: true, autoExecuteTransaction: true } : {}),
          };
          applyPolicyValuesToInputs(mergedPolicy);
          syncAiControlUi();
          await saveAiPolicy(init.mode, mergedPolicy, { quiet: true });
        }
      }
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if ($("chatLog")) {
        $("chatLog").innerHTML = `<div class="chat-empty">${escapeHtml(error?.message || "대화를 불러오지 못했습니다.")}</div>`;
      }
    }
  }

  async function markVisibleMessagesRead() {
    if (!conversationId || document.visibilityState !== "visible" || !$("chatLog")) return;
    const meId = runtime.accountUser?.id;
    const ctx = { meId, myRole: roleOf(currentConv, meId) };
    const readSeq = readSeqFor(sortedMessages(), ctx, currentConv?.myLastReadSeq ?? 0);
    if (readSeq === null) return;
    try {
      const res = await apiFetch("/api/conversations", {
        method: "POST",
        json: { action: "mark_read", conversationId, readSeq },
      });
      if (res?.conversation && currentConv && res.conversation.id === currentConv.id) {
        currentConv = { ...currentConv, myLastReadSeq: res.conversation.myLastReadSeq, unreadCount: res.conversation.unreadCount };
      }
      deps.onConversationRead?.(conversationId, res?.conversation || null);
    } catch {
      // 읽음 처리 실패는 대화 이용을 막지 않는다(서버가 아직 mark_read를 지원하지 않는 경우 포함).
    }
  }

  async function pollNewMessages() {
    if (!conversationId || epoch !== runtime.authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
    try {
      const prevPaused = currentConv?.aiPausedReason;
      const data = await apiFetch(`/api/conversations?conversationId=${encodeURIComponent(conversationId)}&after_seq=${maxSeq()}&limit=50`);
      if (epoch !== runtime.authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
      const incoming = data.messages || [];
      if (incoming.length) {
        for (const m of incoming) bySeq.set(m.seq, m);
        renderChat();
      }
      if (data.conversation) {
        applyConvMetadata(data.conversation);
        if (data.conversation.aiPausedReason === "transaction_completed" && prevPaused !== "transaction_completed") {
          deps.loadCatalog?.({ quiet: true });
          deps.refreshAuthenticatedData?.();
        }
      }
    } catch {
      // Transient polling errors recover on next tick unless auth changed
    }
  }

  function startPolling() {
    stopChatPolling();
    if (!conversationId || epoch !== runtime.authEpoch || $("formBackdrop").hidden) return;
    runtime.chatPollTimer = setInterval(pollNewMessages, 2500);
  }

  syncAiControlUi();

  let delegationPanelOpen = initialDelegationOpen;
  const setDelegationPanelOpen = (open) => {
    const bar = $("chatAiControlBar");
    const trigger = $("chatDelegationTrigger");
    if (!bar) return;
    delegationPanelOpen = Boolean(open);
    bar.hidden = !delegationPanelOpen;
    if (trigger) {
      trigger.setAttribute("aria-expanded", String(delegationPanelOpen));
      trigger.classList.toggle("is-open", delegationPanelOpen);
    }
  };

  $("chatDelegationTrigger")?.addEventListener("click", () => {
    // 설정 패널을 여는 동작만으로 대리 응대나 거래 전담을 켜지 않는다.
    setDelegationPanelOpen(!delegationPanelOpen);
  });

  $("chatListingContext")?.addEventListener("click", (event) => {
    const cartBtn = event.target.closest("[data-chat-cart-add]");
    if (cartBtn) {
      const targetId = cartBtn.dataset.chatCartAdd || listingId || currentConv?.listingId;
      if (targetId) {
        if (typeof deps.addToCart === "function") {
          deps.addToCart(targetId);
        } else {
          window.dispatchEvent(new CustomEvent("moanong:cart-add", { detail: { listingId: targetId } }));
        }
      }
      return;
    }
    const checkoutBtn = event.target.closest("[data-chat-checkout]");
    if (checkoutBtn) {
      const targetId = checkoutBtn.dataset.chatCheckout || listingId || currentConv?.listingId;
      if (targetId) {
        stopChatPolling();
        hideDialog($("formBackdrop"));
        window.dispatchEvent(new CustomEvent("moanong:checkout-open", {
          detail: {
            listingId: targetId,
            options: { conversationId: conversationId || null, source: "chat" },
          },
        }));
      }
      return;
    }
    if (event.target.closest("#chatQuickDelegationPill")) {
      setDelegationPanelOpen(!delegationPanelOpen);
      if (delegationPanelOpen) {
        requestAnimationFrame(() => {
          $("chatAiControlBar")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
        });
      }
    }
  });

  $("chatLog")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-chat-open-orders]")) {
      stopChatPolling();
      hideDialog($("formBackdrop"));
      window.dispatchEvent(new CustomEvent("moanong:cart-open", { detail: { tab: "orders" } }));
    }
  });

  let policyPanelOpen = initialPolicyPanelOpen;
  let policyCollapseTimer = null;
  const setPolicyPanelOpen = (open) => {
    const panel = $("chatAiPolicyPanel");
    if (!panel) return;
    policyPanelOpen = Boolean(open);
    clearTimeout(policyCollapseTimer);
    $("chatAiPolicyToggle")?.setAttribute("aria-expanded", String(policyPanelOpen));
    if ($("chatAiPolicyToggle")) {
      $("chatAiPolicyToggle").textContent = policyPanelOpen ? "위임 조건 ▴" : "위임 조건 ▾";
    }
    if (policyPanelOpen) {
      panel.hidden = false;
      void panel.offsetWidth;
      panel.classList.add("is-open");
    } else {
      panel.classList.remove("is-open");
      policyCollapseTimer = setTimeout(() => {
        if (!policyPanelOpen && panel.isConnected) {
          panel.hidden = true;
        }
      }, 280);
    }
  };

  $("chatAiControlBar")?.querySelectorAll("[data-delegation-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.delegationPreset;
      const preset = getDelegationPreset(pid, listingType);
      if (!preset) return;
      selectedPresetId = preset.id;
      instructionsDirty = true;
      activeChips.clear();
      for (const c of preset.policy.chips || []) activeChips.add(c);
      if (preset.policy.allowNegotiation === false) activeChips.add("noNegotiation");
      else activeChips.delete("noNegotiation");
      if ($("chatQuickPresetDesc")) $("chatQuickPresetDesc").textContent = preset.desc || "";
      syncAiControlUi();
    });
  });

  $("chatQuickStartAiBtn")?.addEventListener("click", async () => {
    if (aiBusy) return;
    const preset = getDelegationPreset(selectedPresetId, listingType);
    const isBuyer = !currentConv || currentConv.buyerId === runtime.accountUser?.id;
    fullDelegationEnabled = true;
    instructionsDirty = true;
    if ($("chatFullDelegationToggle")) $("chatFullDelegationToggle").checked = true;
    const policy = {
      ...collectPolicy(),
      fullDelegation: true,
      autoExecuteTransaction: isBuyer ? Boolean(preset?.policy?.autoExecuteTransaction ?? true) : false,
    };
    await saveAiPolicy("autonomous", policy, { resume: true });
    const shouldSendStarter = Boolean($("chatQuickSendFirst")?.checked) && bySeq.size === 0;
    if (shouldSendStarter && preset?.starterTemplate && !busy) {
      const title = currentConv?.listingTitle || item?.title || "농기계";
      const starter = ($("chatMessage")?.value.trim()) || preset.starterTemplate(title);
      await sendMessageBody(starter, { fromForm: Boolean($("chatMessage")?.value.trim()) });
    }
  });

  $("chatAiPolicyToggle")?.addEventListener("click", () => {
    const panel = $("chatAiPolicyPanel");
    if (!panel) return;
    setPolicyPanelOpen(!policyPanelOpen);
  });

  $("chatFullDelegationToggle")?.addEventListener("change", () => {
    fullDelegationEnabled = Boolean($("chatFullDelegationToggle")?.checked);
    instructionsDirty = true;
    if (fullDelegationEnabled) {
      setPolicyPanelOpen(true);
      saveAiPolicy("autonomous", collectPolicy());
    } else {
      syncAiControlUi();
      saveAiPolicy(currentAiMode, collectPolicy());
    }
  });

  $("chatAiControlBar")?.querySelectorAll(".chat-ai-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.aiMode;
      if (!mode || mode === currentAiMode) return;
      if (mode === "off") fullDelegationEnabled = false;
      saveAiPolicy(mode, collectPolicy());
    });
  });

  $("chatAiControlBar")?.querySelectorAll(".chat-ai-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const id = chip.dataset.policyChip;
      if (!id) return;
      if (activeChips.has(id)) activeChips.delete(id);
      else activeChips.add(id);
      instructionsDirty = true;
      syncAiControlUi();
    });
  });

  $("chatPolicyAllowNegotiation")?.addEventListener("change", () => {
    if ($("chatPolicyAllowNegotiation")?.checked) activeChips.delete("noNegotiation");
    else activeChips.add("noNegotiation");
    instructionsDirty = true;
    syncAiControlUi();
  });

  ["chatPolicyTargetStart", "chatPolicyTargetEnd", "chatPolicyBudgetInput", "chatPolicyAreaPyeong", "chatPolicyPickupPreference", "chatAiInstructions"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      instructionsDirty = true;
      if (id === "chatPolicyTargetStart") {
        const startVal = $("chatPolicyTargetStart")?.value || "";
        const endEl = $("chatPolicyTargetEnd");
        if (endEl) {
          endEl.min = startVal || minToday;
          if (startVal && (!endEl.value || endEl.value < startVal)) {
            endEl.value = startVal;
          }
        }
      }
      updateDelegationSummary();
    });
  });

  $("chatAiSavePolicy")?.addEventListener("click", () => {
    const nextMode = fullDelegationEnabled && currentAiMode === "off" ? "autonomous" : currentAiMode;
    saveAiPolicy(nextMode, collectPolicy());
  });

  $("chatLoadOlder").addEventListener("click", async () => {
    const oldest = minSeq();
    if (!conversationId || !oldest || oldest <= 1) return;
    $("chatLoadOlder").disabled = true;
    try {
      const data = await apiFetch(`/api/conversations?conversationId=${encodeURIComponent(conversationId)}&before_seq=${oldest}&limit=50`);
      if (epoch !== runtime.authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
      if (data.conversation) applyConvMetadata(data.conversation);
      for (const m of data.messages || []) bySeq.set(m.seq, m);
      hasMoreOlder = Boolean(data.hasMoreOlder);
      renderChat({ keepScroll: true });
    } catch (error) {
      toast(error?.message || "이전 대화를 불러오지 못했습니다.");
    } finally {
      if ($("chatLoadOlder")) $("chatLoadOlder").disabled = false;
    }
  });

  $("chatMessage").addEventListener("input", () => {
    const val = $("chatMessage").value.trim();
    if (lastSubmittedBody !== null && val !== lastSubmittedBody) {
      draftMessageId = crypto.randomUUID();
      lastSubmittedBody = null;
    }
  });

  $("chatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("chatMessage").value.trim();
    if (!text) return;
    await sendMessageBody(text, { fromForm: true });
  });

  loadInitialMessages();
  if (quickDelegation) {
    requestAnimationFrame(() => {
      $("chatQuickDelegationCard")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    });
  }
}

function startDelegatedTrade(target, options = {}) {
  const opts = typeof target === "object" && target !== null
    ? { ...target, ...options }
    : { listingId: target || null, ...options };
  const listingId = opts.listingId || null;
  const conversationId = opts.conversationId || null;
  if (!listingId && !conversationId) return false;
  if ($("detailBackdrop") && !$("detailBackdrop").hidden) {
    hideDialog($("detailBackdrop"));
  }
  const item = listingId ? listingById(listingId) : null;
  const preset = opts.preset || (item?.type === "sale" ? "purchase_inquiry" : "quick_rental");
  const autoActivate = Boolean(opts.autoActivate);
  chatForm({
    listingId,
    conversationId,
    draftBody: typeof opts.draftBody === "string" ? opts.draftBody : "",
    quickDelegation: true,
    preset,
    autoActivate,
    ...(autoActivate ? { aiMode: "autonomous", fullDelegation: true } : {}),
    ...(opts.policy && typeof opts.policy === "object" ? { policy: opts.policy } : {}),
  });
  return true;
}

_activeStartDelegatedTrade = startDelegatedTrade;
_activeOpenChat = chatForm;
if (typeof window !== "undefined") {
  window.startDelegatedTradeForListing = startDelegatedTradeForListing;
  if (_delegatedEventListener) {
    window.removeEventListener(DELEGATED_TRADE_EVENT, _delegatedEventListener);
  }
  _delegatedEventListener = (event) => {
    const detail = event?.detail || {};
    startDelegatedTrade(detail.listingId || null, detail);
  };
  window.addEventListener(DELEGATED_TRADE_EVENT, _delegatedEventListener);

  if (_openChatEventListener) {
    window.removeEventListener("moanong:open-chat", _openChatEventListener);
  }
  _openChatEventListener = (event) => {
    const detail = event?.detail || {};
    if (typeof _activeOpenChat === "function") {
      _activeOpenChat(detail);
    }
  };
  window.addEventListener("moanong:open-chat", _openChatEventListener);

  if (_orderCompletedListener) {
    window.removeEventListener("moanong:order-completed", _orderCompletedListener);
  }
  _orderCompletedListener = async (event) => {
    const { order, conversationId: convId, source } = event?.detail || {};
    if (!order || source !== "chat" || !isLoggedIn()) return;
    const orderNo = order.orderNumber || order.id || "";
    const listingId = order.items?.[0]?.listingId || null;
    if (!convId && !listingId) return;
    if (orderNo && _syncedOrderNumbers.has(orderNo)) return;
    const body = formatOrderChatMessage(order);
    if (!body) return;
    if (orderNo) _syncedOrderNumbers.add(orderNo);
    try {
      await apiFetch("/api/conversations", {
        method: "POST",
        json: {
          action: "send",
          id: crypto.randomUUID(),
          ...(convId ? { conversationId: convId } : {}),
          ...(listingId ? { listingId } : {}),
          body,
        },
      });
      deps.refreshAuthenticatedData?.({ includeRequests: false, includeConversations: true });
    } catch {
      if (orderNo) _syncedOrderNumbers.delete(orderNo);
    }
  };
  window.addEventListener("moanong:order-completed", _orderCompletedListener);
}
if (typeof document !== "undefined") {
  if (_delegatedClickListener) {
    document.removeEventListener("click", _delegatedClickListener);
  }
  _delegatedClickListener = (event) => {
    if (event.defaultPrevented) return;
    const delegatedBtn = event.target?.closest?.("[data-delegated-trade]");
    if (delegatedBtn) {
      event.preventDefault();
      startDelegatedTrade(delegatedBtn.dataset.delegatedTrade || null, {
        conversationId: delegatedBtn.dataset.delegatedConv || null,
        preset: delegatedBtn.dataset.delegatedPreset || undefined,
        autoActivate: delegatedBtn.dataset.delegatedAuto === "true",
      });
      return;
    }
    const directChatBtn = event.target?.closest?.("[data-direct-chat]");
    if (directChatBtn) {
      event.preventDefault();
      if ($("detailBackdrop") && !$("detailBackdrop").hidden) {
        hideDialog($("detailBackdrop"));
      }
      chatForm({ listingId: directChatBtn.dataset.directChat || null });
    }
  };
  document.addEventListener("click", _delegatedClickListener);
}

async function handleRequestAction(action, requestId, button) {
  if (button) button.disabled = true;
  try {
    await apiFetch("/api/requests", {
      method: "POST",
      json: { action, id: requestId },
    });
    await Promise.all([deps.loadCatalog({ quiet: true }), deps.refreshAuthenticatedData()]);
    toast(
      action === "approve" ? "대여 요청을 승인했습니다. 해당 기간 예약이 확정되었습니다."
      : action === "reject" ? "대여 요청을 거절했습니다."
      : "대여 요청을 취소했습니다."
    );
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
    if (error?.status === 401) {
      deps.savePendingIntentAndRedirectLogin(null, "세션이 만료되었습니다. 다시 로그인해 주세요.");
      return;
    }
    toast(error?.message || "요청 상태를 변경하지 못했습니다.");
    if (button) button.disabled = false;
  }
}

function renderRequestActionsHtml(req) {
  const actions = [];
  if (req.canApprove) {
    actions.push(`<button type="button" class="button button-primary button-sm" data-req-approve="${escapeHtml(req.id)}">승인</button>`);
  }
  if (req.canReject) {
    actions.push(`<button type="button" class="button button-secondary button-sm" data-req-reject="${escapeHtml(req.id)}">거절</button>`);
  }
  if (req.canCancel) {
    actions.push(`<button type="button" class="button button-secondary button-sm" data-req-cancel="${escapeHtml(req.id)}">요청 취소</button>`);
  }
  return actions.join("");
}

function renderBuyerRequests() {
  const listEl = $("buyerRequestList");
  const convEl = $("buyerConversations");
  if (!listEl) return;

  if (!isLoggedIn()) {
    listEl.innerHTML = "";
    if (convEl) convEl.innerHTML = "";
    return;
  }

  listEl.innerHTML = runtime.outgoingRequests.length
    ? runtime.outgoingRequests.map((req) => `
      <div class="request-row">
        <div class="owner-row-info">
          <div class="owner-row-badges">
            ${renderRequestBadge(req)}
            <span class="spec-tag">${req.days}일 · ${money(req.totalPrice)}</span>
          </div>
          <strong>${escapeHtml(req.listingTitle || "농기계 매물")}</strong>
          <small>대여 기간: ${escapeHtml(req.start)} ~ ${escapeHtml(req.end)} · 소유자 ${escapeHtml(req.listingOwnerName || "-")}${req.note ? `<br>내 메모: ${escapeHtml(req.note)}` : ""}</small>
          ${renderRentalOperator(req)}
        </div>
        <div class="owner-row-actions">
          <div class="trade-action-pair">
            <button type="button" class="button button-secondary button-sm btn-direct-chat" data-open-chat-listing="${escapeHtml(req.listingId)}">1:1 대화</button>
            <button type="button" class="button button-sm btn-delegated-trade" data-delegated-trade="${escapeHtml(req.listingId)}">🤖 거래전담</button>
          </div>
          ${req.canCancel ? `<button type="button" class="button button-secondary button-sm" data-req-cancel="${escapeHtml(req.id)}">요청 취소</button>` : ""}
        </div>
      </div>`).join("")
    : `<div class="empty-panel">아직 보낸 대여 요청이 없어요. 매물 상세에서 대여를 신청하면 여기에서 상태를 볼 수 있어요.</div>`;

  if (convEl) {
    const buyerConvs = runtime.userConversations.filter((c) => c.buyerId === runtime.accountUser?.id);
    const dealsLink = `<div class="deals-crosslink"><span>농농이가 보낸 메시지·제안·확인할 일은 거래 관리에서 한눈에 볼 수 있어요.</span><button type="button" class="button button-primary button-sm" data-goto-deals="buyer">거래 관리 열기 ›</button></div>`;
    convEl.innerHTML = buyerConvs.length
      ? buyerConvs.map((c) => `
        <div class="request-row conv-list-row">
          <button type="button" class="owner-row-info conv-row-open" data-open-chat="${escapeHtml(c.id)}" data-chat-listing="${escapeHtml(c.listingId)}">
            <span class="owner-row-badges">
              <span class="step-pill">판매자: ${escapeHtml(c.ownerName)}</span>
              ${renderConvAiBadges(c, "buyer")}
            </span>
            <strong class="conv-row-title">${escapeHtml(c.listingTitle)}</strong>
            <small class="conv-row-preview">${c.lastMessage ? escapeHtml(c.lastMessage.body) : "대화 시작하기"}</small>
          </button>
          <div class="owner-row-actions">
            <button type="button" class="button button-sm btn-delegated-trade" data-delegated-trade="${escapeHtml(c.listingId)}" data-delegated-conv="${escapeHtml(c.id)}">🤖 거래전담</button>
            <button type="button" class="button button-secondary button-sm" data-open-deal="${escapeHtml(c.id)}">거래 관리</button>
          </div>
        </div>`).join("")
      : `<div class="empty-panel">아직 시작한 채팅 문의가 없습니다.</div>`;
    convEl.insertAdjacentHTML("afterbegin", dealsLink);
  }
}

function renderGuestImportBanner() {
  const banner = $("guestImportBanner");
  if (!banner) return;
  if (!isLoggedIn() || runtime.dismissGuestImport) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  const gFavs = readGuestFavorites();
  const gOwned = runtime.garage?.getGuestOwned() || [];
  if (!gFavs.length && !gOwned.length) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  banner.hidden = false;
  banner.innerHTML = `
    <div class="guest-import-copy">
      <strong>로그인 전에 담은 항목을 내 계정으로 가져올까요?</strong>
      <small>브라우저 임시 보관함: 찜한 매물 ${gFavs.length}건 · 보유 농기계 ${gOwned.length}대</small>
    </div>
    <div class="guest-import-actions">
      <button type="button" class="button button-primary button-sm" id="importGuestConfirm">내 계정에 가져오기</button>
      <button type="button" class="button button-secondary button-sm" id="importGuestDismiss">건너뛰기</button>
    </div>
  `;
}

function renderOwner() {
  if (!isLoggedIn()) return;
  if ($("ownerAccountLabel")) {
    $("ownerAccountLabel").textContent = `${runtime.accountUser.name} 님의 농기계 관리`;
  }
  renderGuestImportBanner();

  const owned = allListings().filter((item) => item.ownerId === runtime.accountUser.id && item.status !== "removed");

  $("ownerStats").innerHTML = `
    <div class="stat-box">
      <span class="stat-icon" aria-hidden="true">${pictureIcon("sprout")}</span>
      <div><small>내가 등록한 농기계</small><strong>${owned.length}대</strong></div>
    </div>
    <div class="stat-box">
      <span class="stat-icon" aria-hidden="true">${pictureIcon("envelope")}</span>
      <div><small>승인 가능한 대여 요청</small><strong>${runtime.approvableRequestCount}건</strong></div>
    </div>
    <div class="stat-box">
      <span class="stat-icon" aria-hidden="true">${pictureIcon("handshake")}</span>
      <div><small>거래 완료된 판매</small><strong>${owned.filter((item) => item.type === "sale" && item.status === "done").length}건</strong></div>
    </div>
  `;

  $("ownerListings").innerHTML = owned.length
    ? owned.map((item) => `
      <div class="owner-row">
        <div class="owner-row-info">
          <div class="owner-row-badges">
            <span class="card-status-pill ${statusClass(item)}">${statusLabel(item)}</span>
            <span class="spec-tag">${item.type === "rent" ? "일일 대여" : "중고 판매"}</span>
          </div>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${money(item.price)}${item.type === "rent" ? " / 1일" : ""} · ${escapeHtml(item.region)}</small>
          ${item.type === "rent" ? `<small>예약된 기간 · ${item.booked.length
            ? item.booked.slice().sort((a, b) => a.start.localeCompare(b.start))
              .map(({ start, end }) => escapeHtml(start + " ~ " + end)).join(" / ")
            : "없음"}</small>` : ""}
        </div>
        <div class="owner-row-actions">
          <select class="owner-status-select" data-owner-status="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 상태 변경">
            <option value="open" ${item.status === "open" ? "selected" : ""}>${item.type === "rent" ? "대여 가능" : "판매 가능"}</option>
            <option value="dealing" ${item.status === "dealing" ? "selected" : ""}>거래 중</option>
            <option value="done" ${item.status === "done" ? "selected" : ""}>거래 완료</option>
          </select>
          <button type="button" class="button button-secondary button-sm" data-owner-detail="${escapeHtml(item.id)}">상세</button>
          <button type="button" class="button button-secondary button-sm" data-owner-edit="${escapeHtml(item.id)}">수정</button>
          <button type="button" class="button button-secondary button-sm owner-inbound-btn" data-owner-inbound="${escapeHtml(item.id)}">🤖 문의 자동응대</button>
          <button type="button" class="button button-secondary button-sm" data-owner-remove="${escapeHtml(item.id)}">숨기기</button>
        </div>
      </div>`).join("")
    : `<div class="empty-panel">아직 등록한 농기계가 없습니다. 상단 '+ 새 농기계 등록' 버튼을 눌러 등록해 보세요.</div>`;

  $("ownerRequests").innerHTML = runtime.incomingRequests.length
    ? runtime.incomingRequests.map((req) => `
      <div class="request-row">
        <div class="owner-row-info">
          <div class="owner-row-badges">
            ${renderRequestBadge(req)}
            <span class="spec-tag">${req.days}일 · ${money(req.totalPrice)}</span>
          </div>
          <strong>${escapeHtml(req.listingTitle || "농기계")}</strong>
          <small>요청자: ${escapeHtml(req.requesterName)} · 희망 기간: ${escapeHtml(req.start)} ~ ${escapeHtml(req.end)}${req.note ? `<br>메모: ${escapeHtml(req.note)}` : ""}</small>
          ${renderRentalOperator(req)}
        </div>
        <div class="owner-row-actions">
          ${renderRequestActionsHtml(req)}
        </div>
      </div>`).join("")
    : `<div class="empty-panel">도착한 대여 요청이 없습니다.</div>`;

  const ownerConvsEl = $("ownerConversations");
  if (ownerConvsEl) {
    const ownerConvs = runtime.userConversations.filter((c) => c.ownerId === runtime.accountUser?.id);
    ownerConvsEl.innerHTML = ownerConvs.length
      ? `<div class="panel-header" style="margin-top:8px"><h3>도착한 1:1 채팅 문의</h3><small>${ownerConvs.length}개 대화</small></div><div class="deals-crosslink"><span>농농이 응대 내역·받은 제안은 거래 관리에서 확인하세요.</span><button type="button" class="button button-primary button-sm" data-goto-deals="owner">거래 관리 열기 ›</button></div>` + ownerConvs.map((c) => `
        <div class="request-row conv-list-row">
          <button type="button" class="owner-row-info conv-row-open" data-open-chat="${escapeHtml(c.id)}" data-chat-listing="${escapeHtml(c.listingId)}">
            <span class="owner-row-badges">
              <span class="step-pill">문의자: ${escapeHtml(c.buyerName)}</span>
              ${renderConvAiBadges(c, "owner")}
            </span>
            <strong class="conv-row-title">${escapeHtml(c.listingTitle)}</strong>
            <small class="conv-row-preview">${c.lastMessage ? escapeHtml(c.lastMessage.body) : "새 대화"}</small>
          </button>
          <div class="owner-row-actions">
            <button type="button" class="button button-sm btn-delegated-trade" data-delegated-trade="${escapeHtml(c.listingId)}" data-delegated-conv="${escapeHtml(c.id)}">🤖 거래전담</button>
            <button type="button" class="button button-secondary button-sm" data-open-deal="${escapeHtml(c.id)}">거래 관리</button>
          </div>
        </div>`).join("")
      : "";
  }
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("사진 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function listingFormModal({ mode = "create", item = null, draftValues = null } = {}) {
  const isEdit = mode === "edit" && Boolean(item);
  if (!isLoggedIn()) {
    deps.savePendingIntentAndRedirectLogin({ type: isEdit ? "editListing" : "newListing", listingId: item?.id, draftValues });
    return;
  }

  let draftListingId = isEdit ? item.id : (draftValues?.id || crypto.randomUUID());
  const val = (key, fallback) => (draftValues && draftValues[key] !== undefined ? draftValues[key] : (item ? item[key] : fallback));
  const initialType = val("type", "rent");
  const initialModelId = val("modelId", "");
  const initialMachineType = val("machineType", MACHINE_TYPES[0].id);
  const initialBrand = val("brand", "직접 등록");
  const initialTitle = val("title", "");
  const initialCrop = (Array.isArray(val("cropIds", null)) ? val("cropIds", null)[0] : null)
    || (state.selectedCrop && state.selectedCrop !== "all" ? state.selectedCrop : CROPS[0].id);
  const initialOp = (Array.isArray(val("operations", null)) ? val("operations", null)[0] : null) || OPERATIONS[0].id;
  const initialPrice = val("price", "");
  const initialOperator = val("rentalOperator", null);
  const initialAreaMin = val("areaMin", 300);
  const initialAreaMax = val("areaMax", 1500);
  const initialRegion = val("region", state.region || "영양읍");
  const initialCondition = val("condition", "good");
  const initialInspected = val("inspectedAt", today());
  const initialIncluded = val("included", "");
  const initialPickup = val("pickup", "");
  const initialDescription = val("description", "");
  const regionKeys = Object.keys(REGION_COORDS);
  const regionOptions = initialRegion && !regionKeys.includes(initialRegion)
    ? [initialRegion, ...regionKeys]
    : regionKeys;

  openForm(`
    <span class="step-pill">${isEdit ? "매물 수정" : "농기계 등록"}</span>
    <h2 id="formTitle">${isEdit ? "내 농기계 정보 수정" : "내 농기계 올리기"}</h2>
    <p>모든 회원이 직접 매물을 등록하고 관리할 수 있으며 서버 데이터베이스에 안전하게 저장됩니다.</p>
    <form class="stack-form" id="listingEditorForm">
      <div class="form-row-2">
        <label>거래 방식
          <select id="editType">
            <option value="rent" ${initialType === "rent" ? "selected" : ""}>빌려주기 (일일 대여)</option>
            <option value="sale" ${initialType === "sale" ? "selected" : ""}>중고로 판매하기</option>
          </select>
        </label>
        <label>등록 기종 (선택 시 사양 자동 연결)
          <select id="editModelId">
            <option value="">목록에 없는 기종 (직접 입력)</option>
            ${MACHINE_SPECIFICATIONS.map((m) => `<option value="${escapeHtml(m.id)}" ${initialModelId === m.id ? "selected" : ""}>${escapeHtml(m.brand)} ${escapeHtml(m.model)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div id="modelSpecSummary" class="model-spec-summary" hidden aria-live="polite"></div>
      <div id="manualSpecFields" class="manual-spec-fields">
        <div class="form-row-2">
          <label>농기계 종류
            <select id="editMachine">${MACHINE_TYPES.map((m) => `<option value="${escapeHtml(m.id)}" ${initialMachineType === m.id ? "selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}</select>
          </label>
          <label>제조사
            <input id="editBrand" maxlength="40" required value="${escapeHtml(initialBrand)}">
          </label>
        </div>
        <div class="form-row-2">
          <label>추천 작물<select id="editCrop">${CROPS.map((c) => `<option value="${escapeHtml(c.id)}" ${initialCrop === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
          <label>세부 작업<select id="editOperation">${OPERATIONS.map((o) => `<option value="${escapeHtml(o.id)}" ${initialOp === o.id ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}</select></label>
        </div>
        <div class="form-row-2">
          <label>최소 권장 면적(㎡)<input id="editAreaMin" type="number" min="1" required value="${escapeHtml(initialAreaMin)}" placeholder="예: 300"></label>
          <label>최대 권장 면적(㎡)<input id="editAreaMax" type="number" min="1" required value="${escapeHtml(initialAreaMax)}" placeholder="예: 1500"></label>
        </div>
      </div>
      <label>게시글 제목<input id="editTitle" maxlength="80" required value="${escapeHtml(initialTitle)}" placeholder="예: 초보자도 쉬운 관리기 + 두둑성형기 세트 대여"></label>
      <div class="form-row-2">
        <label>요금/가격(원)<input id="editPrice" type="number" min="0" step="1000" required value="${escapeHtml(initialPrice)}" placeholder="예: 50000"></label>
        <label>보관/거래 지역
          <select id="editRegion">
            ${regionOptions.map((r) => `<option value="${escapeHtml(r)}" ${initialRegion === r ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="form-row-2">
        <label>기계 상태
          <select id="editCondition">
            <option value="good" ${initialCondition === "good" ? "selected" : ""}>정상 작동</option>
            <option value="used" ${initialCondition === "used" ? "selected" : ""}>사용감 있음</option>
            <option value="repair" ${initialCondition === "repair" ? "selected" : ""}>정비 필요</option>
          </select>
        </label>
        <label>최근 점검일<input id="editInspection" type="date" max="${today()}" value="${escapeHtml(initialInspected)}" required></label>
      </div>
      ${!isEdit && (draftValues?.draftPhotoUrl || draftValues?.photoDataUrl) ? `<div class="draft-photo-preview"><img src="${escapeHtml(draftValues.draftPhotoUrl || draftValues.photoDataUrl)}" alt="농농이 상담에서 올린 사진" /><small>농농이 상담에서 올린 사진이 등록돼요. 바꾸려면 아래에서 새 사진을 고르세요.</small></div>` : ""}
      <div class="edit-photo-field">
        <label>기계 사진 업로드 (선택, JPG·PNG·WebP, 1MB 이하)<input id="editPhoto" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <div class="edit-camera-row">
          <input id="editCameraInput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden>
          <button type="button" class="button button-secondary button-sm" id="editCameraButton">📷 카메라로 찍기</button>
        </div>
        <div class="draft-photo-preview" id="editCapturedPhotoPreview" hidden>
          <img id="editCapturedPhotoImg" alt="촬영한 기계 사진 미리보기" />
          <small>카메라로 찍은 사진이 등록돼요.</small>
          <button type="button" class="button button-secondary button-sm" id="editCapturedPhotoClear">빼기</button>
        </div>
      </div>
      ${isEdit && hasListingPhoto(item) ? `<label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="editRemovePhoto" style="width:auto"> 등록된 기존 사진 삭제하기</label>` : ""}
      <div class="form-row-2">
        <label>포함 작업기·부속품<input id="editIncluded" maxlength="120" required value="${escapeHtml(initialIncluded)}" placeholder="예: 로터리, 두둑성형기 포함"></label>
        <label>인수·전달 방법<input id="editPickup" maxlength="120" required value="${escapeHtml(initialPickup)}" placeholder="예: 영양읍 창고 직접 방문 인수"></label>
      </div>
      <div id="editOperatorOption" class="rental-operator rental-operator-option">
        <label class="rental-operator-toggle">
          <input type="checkbox" id="editOperatorEnabled" ${initialOperator ? "checked" : ""}>
          작업자 동반 대여 제공
        </label>
        <fieldset id="editOperatorFields" class="rental-operator-fields">
          <legend>공개 작업자 프로필</legend>
          <div class="form-row-2">
            <label>이름<input id="editOperatorName" maxlength="40" value="${escapeHtml(initialOperator?.name ?? "")}" required></label>
            <label>일당(원)<input id="editOperatorPrice" type="number" min="1" max="500000000" value="${escapeHtml(initialOperator?.dailyPrice ?? "")}" required></label>
          </div>
          <label>작업 이력<textarea id="editOperatorExperience" maxlength="300" placeholder="예: 트랙터 경운·로터리 작업 7년, 농기계 안전교육 수료" required>${escapeHtml(initialOperator?.experience ?? "")}</textarea></label>
        </fieldset>
      </div>
      <label>상세 설명 및 초보자 안내<textarea id="editDescription" maxlength="1000" required placeholder="기계 작동 상태와 초보 농부님이 사용할 때 주의할 점을 적어주세요.">${escapeHtml(initialDescription)}</textarea></label>
      <button class="button button-primary button-large" type="submit" id="listingSubmitButton">${isEdit ? "수정 내용 저장하기" : "+ 매물 등록 완료하기"}</button>
    </form>
  `);

  const resolveAutoSpecValues = (spec) => {
    const defaults = getSpecificationDefaults(spec);
    if (isEdit && item && item.modelId === spec.id) {
      return {
        cropIds: Array.isArray(item.cropIds) && item.cropIds.length ? item.cropIds : defaults.cropIds,
        operations: Array.isArray(item.operations) && item.operations.length ? item.operations : defaults.operations,
        areaMin: Number.isFinite(Number(item.areaMin)) ? Number(item.areaMin) : defaults.areaMin,
        areaMax: Number.isFinite(Number(item.areaMax)) ? Number(item.areaMax) : defaults.areaMax,
      };
    }
    return defaults;
  };

  const syncModelLock = () => {
    const modelId = $("editModelId").value;
    const spec = modelId ? SPEC_BY_ID[modelId] : null;
    const manualSection = $("manualSpecFields");
    const summaryBox = $("modelSpecSummary");
    const manualInputs = manualSection.querySelectorAll("input, select");

    if (spec) {
      const auto = resolveAutoSpecValues(spec);
      const machineLabel = MACHINE_BY_ID[spec.machineType]?.label || spec.machineType;
      const cropNames = auto.cropIds.map((id) => CROP_BY_ID[id]?.name || id).join("·");
      const opLabels = auto.operations.map((id) => OPERATION_BY_ID[id]?.label || id).join("·");
      const factsHtml = (spec.facts || [])
        .map(([k, v]) => `<span><strong>${escapeHtml(k)}</strong> ${escapeHtml(v)}</span>`)
        .join("");

      summaryBox.innerHTML = `
        <div class="model-spec-head">
          <strong>${escapeHtml(spec.brand)} ${escapeHtml(spec.model)} · ${escapeHtml(machineLabel)}</strong>
          <span class="step-pill">사양 자동 등록</span>
        </div>
        <div class="model-spec-facts">${factsHtml}</div>
        <p class="model-spec-meta">추천 작물: ${escapeHtml(cropNames)} · 세부 작업: ${escapeHtml(opLabels)} · 권장 면적: ${escapeHtml(areaLabel(auto.areaMin, auto.areaMax))}</p>
      `;
      summaryBox.hidden = false;
      manualSection.hidden = true;
      manualInputs.forEach((el) => { el.disabled = true; });
    } else {
      summaryBox.innerHTML = "";
      summaryBox.hidden = true;
      manualSection.hidden = false;
      manualInputs.forEach((el) => { el.disabled = false; });
    }
  };
  syncModelLock();
  $("editModelId").addEventListener("change", syncModelLock);

  let busy = false;
  const syncOperatorFields = () => {
    const isRental = $("editType").value === "rent";
    const enabled = isRental && $("editOperatorEnabled").checked;
    $("editOperatorOption").hidden = !isRental;
    $("editOperatorFields").hidden = !enabled;
    $("editOperatorFields").disabled = !enabled;
  };
  syncOperatorFields();
  $("editType").addEventListener("change", syncOperatorFields);
  $("editOperatorEnabled").addEventListener("change", syncOperatorFields);
  let lastSubmitHash = null;
  let capturedPhotoDataUrl = null;

  const setCapturedPhoto = (dataUrl) => {
    capturedPhotoDataUrl = dataUrl || null;
    const preview = $("editCapturedPhotoPreview");
    const img = $("editCapturedPhotoImg");
    if (preview && img) {
      preview.hidden = !capturedPhotoDataUrl;
      if (capturedPhotoDataUrl) img.src = capturedPhotoDataUrl;
    }
    if (capturedPhotoDataUrl) {
      if ($("editPhoto")) $("editPhoto").value = "";
      if ($("editRemovePhoto")) $("editRemovePhoto").checked = false;
    } else if ($("editCameraInput")) {
      $("editCameraInput").value = "";
    }
  };

  $("editCameraButton")?.addEventListener("click", () => {
    openCameraCapture({
      fallbackInput: $("editCameraInput"),
      triggerButton: $("editCameraButton"),
      onCapture: (dataUrl) => setCapturedPhoto(dataUrl),
    });
  });

  $("editCameraInput")?.addEventListener("change", async () => {
    const file = $("editCameraInput")?.files?.[0];
    if (!file) return;
    try {
      setCapturedPhoto(await shrinkPhoto(file));
    } catch (error) {
      setCapturedPhoto(null);
      toast(error?.message || "사진을 읽지 못했습니다.");
    }
  });

  $("editCapturedPhotoClear")?.addEventListener("click", () => setCapturedPhoto(null));
  $("editPhoto")?.addEventListener("change", () => {
    if ($("editPhoto")?.files?.[0]) setCapturedPhoto(null);
  });

  $("listingEditorForm").addEventListener("input", () => {
    if (!isEdit && !draftValues?.draftPhotoKey && lastSubmitHash !== null) {
      draftListingId = crypto.randomUUID();
      lastSubmitHash = null;
    }
  });

  $("listingEditorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const modelId = $("editModelId").value || null;
    const spec = modelId ? SPEC_BY_ID[modelId] : null;
    const autoSpec = spec ? resolveAutoSpecValues(spec) : null;

    const areaMin = autoSpec ? autoSpec.areaMin : Number($("editAreaMin").value);
    const areaMax = autoSpec ? autoSpec.areaMax : Number($("editAreaMax").value);
    if (!Number.isFinite(areaMin) || !Number.isFinite(areaMax) || areaMin < 1 || areaMin > areaMax) {
      return toast("권장 면적 범위를 올바르게 입력해 주세요.");
    }

    const file = $("editPhoto").files[0];
    if (file && file.size > 1024 * 1024) {
      return toast("JPG·PNG·WebP 사진을 1MB 이하로 선택해 주세요.");
    }

    let photoDataUrl = capturedPhotoDataUrl || draftValues?.photoDataUrl || undefined;
    const draftPhotoKey = !isEdit && !file && !capturedPhotoDataUrl ? draftValues?.draftPhotoKey : undefined;
    if (file) {
      try {
        photoDataUrl = await readImageFileAsDataUrl(file);
      } catch (err) {
        return toast(err?.message || "사진을 읽지 못했습니다.");
      }
    }

    const payload = {
      action: isEdit ? "update" : "create",
      id: draftListingId,
      type: $("editType").value,
      rentalOperator: $("editOperatorFields").disabled ? null : {
        name: $("editOperatorName").value.trim(),
        dailyPrice: Number($("editOperatorPrice").value),
        experience: $("editOperatorExperience").value.trim(),
      },
      modelId,
      brand: spec ? spec.brand : $("editBrand").value.trim(),
      machineType: spec ? spec.machineType : $("editMachine").value,
      title: $("editTitle").value.trim(),
      region: $("editRegion").value,
      cropIds: autoSpec ? autoSpec.cropIds : [$("editCrop").value],
      operations: autoSpec ? autoSpec.operations : [$("editOperation").value],
      price: Number($("editPrice").value),
      areaMin,
      areaMax,
      condition: $("editCondition").value,
      inspectedAt: $("editInspection").value,
      included: $("editIncluded").value.trim(),
      pickup: $("editPickup").value.trim(),
      description: $("editDescription").value.trim(),
      ...(draftPhotoKey ? { draftPhotoKey } : {}),
      ...(photoDataUrl ? { photoDataUrl } : {}),
      ...(isEdit && $("editRemovePhoto")?.checked && !file && !capturedPhotoDataUrl ? { removePhoto: true } : {}),
    };

    lastSubmitHash = JSON.stringify(payload);
    busy = true;
    $("listingSubmitButton").disabled = true;

    try {
      await apiFetch("/api/listings", { method: "POST", json: payload, timeoutMs: 45000 });
      hideDialog($("formBackdrop"));
      await Promise.all([deps.loadCatalog({ quiet: true }), deps.refreshAuthenticatedData()]);
      renderOwner();
      toast(isEdit ? "매물 정보를 수정했습니다." : "새 농기계 매물을 등록했습니다!");
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if (error?.status === 401) {
        deps.savePendingIntentAndRedirectLogin(
          { type: isEdit ? "editListing" : "newListing", listingId: item?.id, draftValues: payload },
          "세션이 만료되었습니다. 로그인 후 이어서 등록할 수 있어요."
        );
        return;
      }
      toast(error?.message || "매물을 저장하지 못했습니다.");
    } finally {
      busy = false;
      if ($("listingSubmitButton")) $("listingSubmitButton").disabled = false;
    }
  });
}

function openNewListing(draftValues = null) {
  listingFormModal({ mode: "create", draftValues });
}

function openEditListing(item, draftValues = null) {
  listingFormModal({ mode: "edit", item, draftValues });
}


  return {
    openForm,
    renderRequestBadge,
    rentalForm,
    chatForm,
    startDelegatedTradeForListing: startDelegatedTrade,
    handleRequestAction,
    renderRequestActionsHtml,
    renderBuyerRequests,
    renderGuestImportBanner,
    renderOwner,
    openNewListing,
    openEditListing,
  };
}
