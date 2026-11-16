import { CROPS, OPERATIONS, MACHINE_TYPES, CROP_BY_ID, OPERATION_BY_ID, MACHINE_BY_ID } from "../data/farm-machines.js";
import { MACHINE_SPECIFICATIONS, SPEC_BY_ID, getSpecificationDefaults } from "../data/machine-specifications.js";
import { available } from "../data/recommendation.js";
import { $, escapeHtml, money, areaLabel, today, addDays, koreanDateParts, pictureIcon, toast, showDialog, hideDialog, getListingPhotoSrc, hasListingPhoto } from "../core/utils.js";
import { state, runtime, isLoggedIn, apiFetch, allListings, listingById, statusLabel, statusClass, stopChatPolling, readGuestFavorites, clearGuestFavorites } from "../core/store.js";
import { openCameraCapture, shrinkPhoto } from "../ai/panel.js";
import { renderBookingWeatherPanel } from "./map-weather.js";

export function createTransactionViews(deps) {
function openForm(html) {
  stopChatPolling();
  $("formContent").innerHTML = html;
  showDialog($("formBackdrop"));
}

const REQUEST_STATE_LABEL = {
  approvable: "승인 대기",
  conflict: "일정 충돌 (승인 불가)",
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
      const totalPrice = item.price * days;
      $("rentalEstimate").textContent = "운송비와 보증금은 소유 농가에 확인해 주세요.";
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
    const fp = `${$("rentStart").value}|${$("rentEnd").value}|${$("rentNote").value.trim()}`;
    if (lastPayloadFingerprint && fp !== lastPayloadFingerprint) {
      draftRequestId = crypto.randomUUID();
      lastPayloadFingerprint = null;
    }
    updateEstimate();
  });
  updateEstimate();

  $("rentalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const start = $("rentStart").value;
    const end = $("rentEnd").value;
    const note = $("rentNote").value.trim();
    if (end < start || start < today()) return toast("대여 시작일과 반납일을 다시 확인하세요.");
    if (!available(listingById(id), start, end)) return toast("해당 기간에는 이미 확정된 예약이 있어 대여할 수 없습니다.");

    lastPayloadFingerprint = `${start}|${end}|${note}`;
    busy = true;
    const button = $("rentalSubmitButton");
    button.disabled = true;
    try {
      await apiFetch("/api/requests", {
        method: "POST",
        json: { action: "create", id: draftRequestId, listingId: id, start, end, note },
      });
      hideDialog($("formBackdrop"));
      await Promise.all([deps.loadCatalog({ quiet: true }), deps.refreshAuthenticatedData()]);
      toast("대여 요청을 보냈습니다! 상대방이 승인하면 예약이 확정됩니다.");
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if (error?.status === 401) {
        deps.savePendingIntentAndRedirectLogin(
          { type: "rental", listingId: id, draftValues: { start, end, note, requestId: draftRequestId } },
          "세션이 만료되었습니다. 로그인 후 이어서 신청할 수 있어요."
        );
        return;
      }
      toast(error?.message || "대여 요청을 보내지 못했습니다.");
    } finally {
      busy = false;
      if ($("rentalSubmitButton")) updateEstimate();
    }
  });
}

function chatForm(target) {
  const opts = typeof target === "string" ? { listingId: target } : (target || {});
  const listingId = opts.listingId || null;
  let conversationId = opts.conversationId || null;
  const draftBody = typeof opts.draftBody === "string" ? opts.draftBody : "";
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
    <div style="margin-bottom:8px">
      <button type="button" id="chatLoadOlder" class="button button-secondary button-sm" hidden>이전 대화 더 보기</button>
    </div>
    <div id="chatLog" class="chat-log"><div class="chat-empty">대화 내역을 불러오는 중입니다…</div></div>
    <form id="chatForm" class="chat-send">
      <input id="chatMessage" maxlength="500" placeholder="예: 이번 주 토요일 오전 인수 가능할까요?" aria-label="메시지 입력" required value="${escapeHtml(draftBody)}">
      <button type="submit" id="chatSendButton" class="button button-primary">보내기</button>
    </form>
  `);

  const epoch = runtime.authEpoch;
  const bySeq = new Map();
  let hasMoreOlder = false;
  let busy = false;
  let draftMessageId = crypto.randomUUID();
  let lastSubmittedBody = null;

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
    const list = sortedMessages();
    log.innerHTML = list.length
      ? list.map((msg) => {
          const mine = msg.senderId === runtime.accountUser?.id;
          return `<div class="chat-line ${mine ? "mine" : ""}">
            <b>${escapeHtml(mine ? "나" : (msg.senderName || "상대 농가"))}</b>
            <div>${escapeHtml(msg.body)}</div>
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
    conversationId = conv.id;
    const isBuyer = conv.buyerId === runtime.accountUser?.id;
    const peerLabel = isBuyer ? `소유 농가 ${conv.ownerName}` : `문의 농가 ${conv.buyerName}`;
    if ($("formTitle")) $("formTitle").textContent = `${conv.listingTitle || item?.title || "농기계"} · 1:1 대화`;
    if ($("chatSubtitle")) $("chatSubtitle").textContent = `${peerLabel}님과의 대화`;
  }

  async function loadInitialMessages() {
    try {
      const qs = conversationId
        ? `conversationId=${encodeURIComponent(conversationId)}&limit=50`
        : `listingId=${encodeURIComponent(listingId)}&limit=50`;
      const data = await apiFetch(`/api/conversations?${qs}`);
      if (epoch !== runtime.authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
      if (data.conversation) applyConvMetadata(data.conversation);
      for (const m of data.messages || []) bySeq.set(m.seq, m);
      hasMoreOlder = Boolean(data.hasMoreOlder);
      renderChat();
      startPolling();
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return;
      if ($("chatLog")) {
        $("chatLog").innerHTML = `<div class="chat-empty">${escapeHtml(error?.message || "대화를 불러오지 못했습니다.")}</div>`;
      }
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
    } catch {
      // Transient polling errors recover on next tick unless auth changed
    }
  }

  function startPolling() {
    stopChatPolling();
    if (!conversationId || epoch !== runtime.authEpoch || $("formBackdrop").hidden) return;
    runtime.chatPollTimer = setInterval(pollNewMessages, 2500);
  }

  $("chatLoadOlder").addEventListener("click", async () => {
    const oldest = minSeq();
    if (!conversationId || !oldest || oldest <= 1) return;
    $("chatLoadOlder").disabled = true;
    try {
      const data = await apiFetch(`/api/conversations?conversationId=${encodeURIComponent(conversationId)}&before_seq=${oldest}&limit=50`);
      if (epoch !== runtime.authEpoch || $("formBackdrop").hidden || !$("chatLog")) return;
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
    if (busy) return;
    const text = $("chatMessage").value.trim();
    if (!text) return;
    lastSubmittedBody = text;
    busy = true;
    $("chatSendButton").disabled = true;
    try {
      const res = await apiFetch("/api/conversations", {
        method: "POST",
        json: {
          action: "send",
          id: draftMessageId,
          conversationId,
          listingId: listingId || undefined,
          body: text,
        },
      });
      if (epoch !== runtime.authEpoch) return;
      if (res.conversation) applyConvMetadata(res.conversation);
      if (res.message) bySeq.set(res.message.seq, res.message);
      $("chatMessage").value = "";
      draftMessageId = crypto.randomUUID();
      lastSubmittedBody = null;
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
  });

  loadInitialMessages();
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
    listEl.innerHTML = `<div class="empty-panel">로그인하면 내가 보낸 대여 요청과 확정된 예약을 확인할 수 있어요.</div>`;
    if (convEl) convEl.innerHTML = `<div class="empty-panel">로그인하면 내 1:1 채팅 문의 내역을 확인할 수 있어요.</div>`;
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
        </div>
        <div class="owner-row-actions">
          <button type="button" class="button button-secondary button-sm" data-open-chat-listing="${escapeHtml(req.listingId)}">1:1 채팅</button>
          ${req.canCancel ? `<button type="button" class="button button-secondary button-sm" data-req-cancel="${escapeHtml(req.id)}">요청 취소</button>` : ""}
        </div>
      </div>`).join("")
    : `<div class="empty-panel">아직 보낸 대여 요청이 없어요. 매물 상세에서 대여를 신청하면 여기에서 상태를 볼 수 있어요.</div>`;

  if (convEl) {
    const buyerConvs = runtime.userConversations.filter((c) => c.buyerId === runtime.accountUser?.id);
    convEl.innerHTML = buyerConvs.length
      ? buyerConvs.map((c) => `
        <div class="request-row">
          <div class="owner-row-info">
            <span class="step-pill">판매자: ${escapeHtml(c.ownerName)}</span>
            <strong>${escapeHtml(c.listingTitle)}</strong>
            <small>${c.lastMessage ? escapeHtml(c.lastMessage.body) : "대화 시작하기"}</small>
          </div>
          <div class="owner-row-actions">
            <button type="button" class="button button-primary button-sm" data-open-chat="${escapeHtml(c.id)}" data-chat-listing="${escapeHtml(c.listingId)}">대화 보기</button>
          </div>
        </div>`).join("")
      : `<div class="empty-panel">아직 시작한 채팅 문의가 없습니다.</div>`;
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
      ? `<div class="panel-header" style="margin-top:8px"><h3>도착한 1:1 채팅 문의</h3><small>${ownerConvs.length}개 대화</small></div>` + ownerConvs.map((c) => `
        <div class="request-row">
          <div class="owner-row-info">
            <span class="step-pill">문의자: ${escapeHtml(c.buyerName)}</span>
            <strong>${escapeHtml(c.listingTitle)}</strong>
            <small>${c.lastMessage ? `"${escapeHtml(c.lastMessage.body)}"` : "새 대화"}</small>
          </div>
          <div class="owner-row-actions">
            <button type="button" class="button button-secondary button-sm" data-open-chat="${escapeHtml(c.id)}" data-chat-listing="${escapeHtml(c.listingId)}">대화하기</button>
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
  const initialAreaMin = val("areaMin", 300);
  const initialAreaMax = val("areaMax", 1500);
  const initialRegion = val("region", state.region || "영양읍");
  const initialCondition = val("condition", "good");
  const initialInspected = val("inspectedAt", today());
  const initialIncluded = val("included", "");
  const initialPickup = val("pickup", "");
  const initialDescription = val("description", "");

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
            ${["영양읍", "청기면", "입암면", "수비면"].map((r) => `<option value="${escapeHtml(r)}" ${initialRegion === r ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}
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
    if (!isEdit && lastSubmitHash !== null) {
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
      ...(draftPhotoKey ? { draftPhotoKey } : (photoDataUrl ? { photoDataUrl } : {})),
      ...(isEdit && $("editRemovePhoto")?.checked && !file && !capturedPhotoDataUrl ? { removePhoto: true } : {}),
    };

    lastSubmitHash = JSON.stringify(payload);
    busy = true;
    $("listingSubmitButton").disabled = true;

    try {
      await apiFetch("/api/listings", { method: "POST", json: payload });
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
