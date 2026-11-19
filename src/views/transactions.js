import { CROPS, OPERATIONS, MACHINE_TYPES, CROP_BY_ID, OPERATION_BY_ID, MACHINE_BY_ID, REGION_COORDS } from "../data/farm-machines.js";
import { MACHINE_SPECIFICATIONS, SPEC_BY_ID, getSpecificationDefaults } from "../data/machine-specifications.js";
import { available } from "../data/recommendation.js";
import { $, escapeHtml, money, areaLabel, today, addDays, koreanDateParts, pictureIcon, toast, showDialog, hideDialog, getListingPhotoSrc, hasListingPhoto } from "../core/utils.js";
import { state, runtime, isLoggedIn, apiFetch, allListings, listingById, statusLabel, statusClass, stopChatPolling, readGuestFavorites, clearGuestFavorites } from "../core/store.js";
import { openCameraCapture, shrinkPhoto } from "../ai/panel.js";
import { renderBookingWeatherPanel } from "./map-weather.js";
import { deliveryOf, pickupLabel } from "../data/delivery.js";
import {
  senderState, SENDER_LABEL, roleOf, readSeqFor,
} from "../data/deals-model.js";
import { formatOrderChatMessage, parseOrderChatMessage } from "./cart-checkout.js";

let _activeOpenChat = null;
let _openChatEventListener = null;
let _orderCompletedListener = null;
let _directChatClickListener = null;
const _syncedOrderNumbers = new Set();

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
    ${!isOwner && targetListingId ? `
    <div class="chat-context-pills" role="group" aria-label="매물 빠른 실행">
      <button type="button" id="chatQuickAddCart" class="chat-context-pill" data-chat-cart-add="${escapeHtml(targetListingId)}">🛒 장바구니 담기</button>
      <button type="button" id="chatQuickCheckout" class="chat-context-pill is-primary" data-chat-checkout="${escapeHtml(targetListingId)}">🛡️ 바로 결제/예약</button>
    </div>` : ""}
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

  if (!isLoggedIn()) {
    deps.savePendingIntentAndRedirectLogin({
      type: "chat",
      listingId,
      conversationId,
      draftBody,
    });
    return;
  }

  openForm(`
    <span class="step-pill">1:1 농기계 채팅 문의</span>
    <h2 id="formTitle">${item ? escapeHtml(item.title) : "1:1 대화"}</h2>
    <p id="chatSubtitle">대화 상대와 기계 상태·인수 일정을 안전하게 조율하세요.</p>
    <div id="chatListingContext" class="chat-listing-context">${renderChatListingContextHtml(item, null)}</div>
    <div class="chat-load-older-wrap">
      <button type="button" id="chatLoadOlder" class="button button-secondary button-sm" hidden>이전 대화 더 보기</button>
    </div>
    <div id="chatLog" class="chat-log"><div class="chat-empty">대화 내역을 불러오는 중입니다…</div></div>
    <form id="chatForm" class="chat-send">
      <input id="chatMessage" maxlength="500" placeholder="예: 이번 주 토요일 오전 인수 가능할까요?" aria-label="메시지 입력" required value="${escapeHtml(draftBody)}">
      <button type="submit" id="chatSendButton" class="button button-primary">보내기</button>
    </form>
    <div class="chat-secondary-actions">
      <button type="button" id="chatOpenDeal" class="button button-secondary button-sm chat-open-deal" hidden>거래 관리에서 진행 보기 ↗</button>
    </div>
  `);

  const epoch = runtime.authEpoch;
  const bySeq = new Map();
  const renderedSeqs = new Set();
  let hasMoreOlder = false;
  let busy = false;
  let draftMessageId = crypto.randomUUID();
  let lastSubmittedBody = null;
  let currentConv = null;

  const sortedMessages = () => [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const maxSeq = () => {
    const list = sortedMessages();
    return list.length ? list[list.length - 1].seq : 0;
  };
  const minSeq = () => {
    const list = sortedMessages();
    return list.length ? list[0].seq : null;
  };

  function renderChat({ keepScroll = false } = {}) {
    if (!$("chatLog")) return;
    const log = $("chatLog");
    const prevHeight = log.scrollHeight;
    const list = sortedMessages().filter((msg) => {
      if (msg.senderKind !== "system") return true;
      // 나에게만 보이는 안내는 내 화면에만 표시한다(서버도 상대에게는 내려주지 않는다).
      return msg.visibility !== "self" || msg.senderId === runtime.accountUser?.id;
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
          const mine = senderState(msg, { meId: runtime.accountUser?.id, myRole: roleOf(currentConv, runtime.accountUser?.id) }) === "me_human";
          const parsedOrder = parseOrderChatMessage(msg.body);
          const bodyHtml = parsedOrder
            ? renderChatOrderCard(parsedOrder)
            : `<div>${escapeHtml(msg.body)}</div>`;
          return `<div class="chat-line ${mine ? "mine" : ""}${parsedOrder ? " has-order-card" : ""}${enterClass}"${staggerStyle}>
            <b>${escapeHtml(mine ? "나" : (msg.senderName || "상대 농가"))}</b>
            ${bodyHtml}
          </div>`;
        }).join("")
      : `<div class="chat-empty">아직 나눈 대화가 없어요. 기계 상태와 인수 조건을 먼저 물어보세요!</div>`;
    $("chatLoadOlder").hidden = !hasMoreOlder;
    if (keepScroll) {
      log.scrollTop += log.scrollHeight - prevHeight;
    } else {
      log.scrollTop = log.scrollHeight;
    }
  }

  function applyConvMetadata(conv) {
    if (!conv) return;
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
      const data = await apiFetch(`/api/conversations?conversationId=${encodeURIComponent(conversationId)}&after_seq=${maxSeq()}&limit=50`);
      if (epoch !== runtime.authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
      const incoming = data.messages || [];
      if (incoming.length) {
        for (const m of incoming) bySeq.set(m.seq, m);
        renderChat();
      }
      if (data.conversation) applyConvMetadata(data.conversation);
    } catch {
      // Transient polling errors recover on next tick unless auth changed
    }
  }

  function startPolling() {
    stopChatPolling();
    if (!conversationId || epoch !== runtime.authEpoch || $("formBackdrop").hidden) return;
    runtime.chatPollTimer = setInterval(pollNewMessages, 2500);
  }

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
    }
  });

  $("chatLog")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-chat-open-orders]")) {
      stopChatPolling();
      hideDialog($("formBackdrop"));
      window.dispatchEvent(new CustomEvent("moanong:cart-open", { detail: { tab: "orders" } }));
    }
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
}

_activeOpenChat = chatForm;
if (typeof window !== "undefined") {
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
  if (_directChatClickListener) {
    document.removeEventListener("click", _directChatClickListener);
  }
  _directChatClickListener = (event) => {
    if (event.defaultPrevented) return;
    const directChatBtn = event.target?.closest?.("[data-direct-chat]");
    if (directChatBtn) {
      event.preventDefault();
      if ($("detailBackdrop") && !$("detailBackdrop").hidden) {
        hideDialog($("detailBackdrop"));
      }
      chatForm({ listingId: directChatBtn.dataset.directChat || null });
    }
  };
  document.addEventListener("click", _directChatClickListener);
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
          <button type="button" class="button button-secondary button-sm btn-direct-chat" data-open-chat-listing="${escapeHtml(req.listingId)}">1:1 대화</button>
          ${req.canCancel ? `<button type="button" class="button button-secondary button-sm" data-req-cancel="${escapeHtml(req.id)}">요청 취소</button>` : ""}
        </div>
      </div>`).join("")
    : `<div class="empty-panel">아직 보낸 대여 요청이 없어요. 매물 상세에서 대여를 신청하면 여기에서 상태를 볼 수 있어요.</div>`;

  if (convEl) {
    const buyerConvs = runtime.userConversations.filter((c) => c.buyerId === runtime.accountUser?.id);
    const dealsLink = `<div class="deals-crosslink"><span>주고받은 메시지·제안·확인할 일은 거래 관리에서 한눈에 볼 수 있어요.</span><button type="button" class="button button-primary button-sm" data-goto-deals="buyer">거래 관리 열기 ›</button></div>`;
    convEl.innerHTML = buyerConvs.length
      ? buyerConvs.map((c) => `
        <div class="request-row conv-list-row">
          <button type="button" class="owner-row-info conv-row-open" data-open-chat="${escapeHtml(c.id)}" data-chat-listing="${escapeHtml(c.listingId)}">
            <span class="owner-row-badges">
              <span class="step-pill">판매자: ${escapeHtml(c.ownerName)}</span>
            </span>
            <strong class="conv-row-title">${escapeHtml(c.listingTitle)}</strong>
            <small class="conv-row-preview">${c.lastMessage ? escapeHtml(c.lastMessage.body) : "대화 시작하기"}</small>
          </button>
          <div class="owner-row-actions">
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
      ? `<div class="panel-header" style="margin-top:8px"><h3>도착한 1:1 채팅 문의</h3><small>${ownerConvs.length}개 대화</small></div><div class="deals-crosslink"><span>주고받은 메시지·받은 제안은 거래 관리에서 확인하세요.</span><button type="button" class="button button-primary button-sm" data-goto-deals="owner">거래 관리 열기 ›</button></div>` + ownerConvs.map((c) => `
        <div class="request-row conv-list-row">
          <button type="button" class="owner-row-info conv-row-open" data-open-chat="${escapeHtml(c.id)}" data-chat-listing="${escapeHtml(c.listingId)}">
            <span class="owner-row-badges">
              <span class="step-pill">문의자: ${escapeHtml(c.buyerName)}</span>
            </span>
            <strong class="conv-row-title">${escapeHtml(c.listingTitle)}</strong>
            <small class="conv-row-preview">${c.lastMessage ? escapeHtml(c.lastMessage.body) : "새 대화"}</small>
          </button>
          <div class="owner-row-actions">
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
  // 운송 방식: 초안·수정 값이 있으면 그대로, 없으면(예전 매물) 인수·전달 방법 글로 추정한다. 새 매물은 아무것도 체크하지 않는다.
  const initialDelivery = (() => {
    const draftDelivery = draftValues && draftValues.delivery !== undefined ? draftValues.delivery : null;
    if (draftDelivery) return { methods: Array.isArray(draftDelivery.methods) ? draftDelivery.methods : [], fee: draftDelivery.fee ?? null, area: draftDelivery.area || "", pickupPlace: draftDelivery.pickupPlace ?? initialPickup };
    if (item) return deliveryOf(item);
    return { methods: [], fee: null, area: "", pickupPlace: initialPickup };
  })();
  const hasMethod = (method) => initialDelivery.methods.includes(method);
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
      </div>
      <fieldset class="delivery-option" id="editDeliveryFieldset" aria-describedby="editDeliveryError">
        <legend>운송 방식 <span class="delivery-option-hint">(하나 이상, 둘 다 가능)</span></legend>
        <label class="delivery-option-toggle">
          <input type="checkbox" id="editDeliveryOwner" ${hasMethod("owner_delivery") ? "checked" : ""} aria-controls="editDeliveryOwnerFields" aria-expanded="${hasMethod("owner_delivery") ? "true" : "false"}">
          직접 운송 (내가 가져다드려요)
        </label>
        <div class="delivery-option-fields form-row-2" id="editDeliveryOwnerFields" ${hasMethod("owner_delivery") ? "" : "hidden"}>
          <label>운송비(원, 비우면 협의)<input id="editDeliveryFee" type="number" min="0" max="10000000" step="1000" value="${escapeHtml(initialDelivery.fee ?? "")}" placeholder="예: 30000"></label>
          <label>운송 가능 범위<input id="editDeliveryArea" maxlength="80" value="${escapeHtml(initialDelivery.area || "")}" placeholder="예: 영양군 안"></label>
        </div>
        <label class="delivery-option-toggle">
          <input type="checkbox" id="editDeliveryPickup" ${hasMethod("self_pickup") ? "checked" : ""} aria-controls="editDeliveryPickupFields" aria-expanded="${hasMethod("self_pickup") ? "true" : "false"}">
          <span id="editDeliveryPickupLabel">${escapeHtml(pickupLabel(initialType))}</span>
        </label>
        <div class="delivery-option-fields" id="editDeliveryPickupFields" ${hasMethod("self_pickup") ? "" : "hidden"}>
          <label>픽업 장소 (동네까지만)<input id="editPickup" maxlength="120" value="${escapeHtml(initialDelivery.pickupPlace || "")}" placeholder="예: 영양읍 창고"></label>
        </div>
        <p class="delivery-option-error" id="editDeliveryError" role="alert" hidden>운송 방식을 하나 이상 골라 주세요.</p>
      </fieldset>
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
  const syncDeliveryFields = () => {
    const owner = $("editDeliveryOwner").checked;
    const pickup = $("editDeliveryPickup").checked;
    $("editDeliveryOwnerFields").hidden = !owner;
    $("editDeliveryPickupFields").hidden = !pickup;
    $("editDeliveryOwner").setAttribute("aria-expanded", String(owner));
    $("editDeliveryPickup").setAttribute("aria-expanded", String(pickup));
    $("editDeliveryPickupLabel").textContent = pickupLabel($("editType").value);
    if (owner || pickup) $("editDeliveryError").hidden = true;
  };
  syncDeliveryFields();
  $("editType").addEventListener("change", syncDeliveryFields);
  $("editDeliveryOwner").addEventListener("change", syncDeliveryFields);
  $("editDeliveryPickup").addEventListener("change", syncDeliveryFields);
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

    const deliveryMethods = [
      ...($("editDeliveryOwner").checked ? ["owner_delivery"] : []),
      ...($("editDeliveryPickup").checked ? ["self_pickup"] : []),
    ];
    if (!deliveryMethods.length) {
      $("editDeliveryError").hidden = false;
      $("editDeliveryOwner").focus();
      return toast("운송 방식을 하나 이상 골라 주세요.");
    }
    const feeRaw = $("editDeliveryFee").value.trim();
    const delivery = {
      methods: deliveryMethods,
      fee: deliveryMethods.includes("owner_delivery") && feeRaw !== "" ? Number(feeRaw) : null,
      area: deliveryMethods.includes("owner_delivery") ? $("editDeliveryArea").value.trim() : "",
      pickupPlace: deliveryMethods.includes("self_pickup") ? $("editPickup").value.trim() : "",
    };

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
      pickup: delivery.pickupPlace,
      delivery,
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
    handleRequestAction,
    renderRequestActionsHtml,
    renderBuyerRequests,
    renderGuestImportBanner,
    renderOwner,
    openNewListing,
    openEditListing,
  };
}
