import { chatApi } from "./api.js";
import { $, escapeHtml, hideDialog, money, openForm, pictureIcon, toast } from "./ui.js";

// 대여 신청, 내 대여 요청, 소유자 관리(승인·거절), 채팅 화면.
// 데이터는 모두 서버에 있고 store(user-store.js)를 통해 읽고 쓴다.
const STATUS_LABELS = {
  pending: "승인 대기",
  approved: "승인됨 · 인수 및 반납 방법을 확인하세요",
  rejected: "거절됨 · 다른 기간이나 매물을 찾아보세요",
  cancelled: "취소함",
};
const DEMO_OWNER_NOTE = "시연용 매물이라 소유 농가가 승인하거나 답장하지 않아요.";

export function createTrade({ store, listingById, ownedListings, getFilters, today, available, statusLabel, statusClass, requireLogin, onBookingsChanged }) {
  const cancellable = (request) => request.status === "pending" || (request.status === "approved" && request.start > today());

  function openRentalForm(id) {
    const item = listingById(id);
    if (!item) return;
    if (!store.user) return requireLogin("대여 신청은 로그인한 뒤 할 수 있어요.");
    const filters = getFilters();
    const date = filters.date >= today() ? filters.date : today();
    const endDate = filters.dateEnd >= date ? filters.dateEnd : date;
    openForm(`
      <span class="step-pill">간편 대여 신청</span>
      <h2 id="formTitle">농기계 대여 요청하기</h2>
      <p><strong>${escapeHtml(item.title)}</strong> (${money(item.price)}/일) · ${item.demoOwner ? DEMO_OWNER_NOTE : "요청을 보내면 소유 농가가 확인한 뒤 승인하거나 거절해요."}</p>
      <form class="stack-form" id="rentalForm">
        <div class="form-row-2">
          <label>대여 시작일<input type="date" id="rentStart" min="${today()}" value="${date}" required></label>
          <label>반납 예정일<input type="date" id="rentEnd" min="${date}" value="${endDate}" required></label>
        </div>
        <p id="rentalEstimate" aria-live="polite"></p>
        <label>작업 내용 · 방문 메모 (선택)
          <textarea id="rentNote" maxlength="500" placeholder="예: 고추밭 300평 두둑 작업 예정입니다. 오전 9시에 직접 방문해 인수하겠습니다."></textarea>
        </label>
        <div class="form-actions">
          <button class="button button-primary button-large" type="submit" id="rentalSubmitButton">대여 요청 보내기</button>
        </div>
      </form>
    `);
    const button = $("rentalSubmitButton");
    const updateEstimate = () => {
      const start = $("rentStart").value;
      const end = $("rentEnd").value;
      $("rentEnd").min = start || today();
      const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
      const valid = Number.isInteger(days) && days > 0;
      $("rentalEstimate").textContent = valid ? "운송비와 보증금은 소유 농가에 확인해 주세요." : "시작일과 반납일을 확인해 주세요.";
      button.textContent = valid ? `${days}일 · ${money(item.price * days)} 대여 신청하기` : "대여 기간을 확인해 주세요";
      button.disabled = !valid;
    };
    $("rentalForm").addEventListener("input", updateEstimate);
    updateEstimate();
    $("rentalForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const start = $("rentStart").value;
      const end = $("rentEnd").value;
      if (end < start) return toast("반납일을 시작일 이후로 선택하세요.");
      if (!available(listingById(id), start, end)) return toast("해당 기간에는 이미 예약이 있어 대여할 수 없습니다.");
      button.disabled = true;
      try {
        await store.createRequest({ listingId: id, start, end, note: $("rentNote").value.trim() });
        hideDialog($("formBackdrop"));
        toast("대여 요청을 보냈습니다. '내 대여 요청'에서 진행 상태를 확인할 수 있어요.");
      } catch (error) {
        $("rentalEstimate").textContent = error.message;
        toast(error.message);
        button.disabled = false;
      }
    });
  }

  function renderBuyerRequests() {
    const list = $("buyerRequestList");
    if (!store.user) {
      list.innerHTML = `<div class="empty-panel">로그인하면 보낸 대여 요청과 진행 상태를 확인할 수 있어요.</div>`;
      return;
    }
    if (!store.requests.length) {
      list.textContent = "아직 보낸 대여 요청이 없어요. 매물 상세에서 대여를 신청하면 여기에서 상태를 볼 수 있어요.";
      return;
    }
    list.innerHTML = store.requests.map((request) => `
      <div class="request-row">
        <div class="owner-row-info">
          <strong>${escapeHtml(request.listingTitle)}</strong>
          <small>${escapeHtml(`${request.start} ~ ${request.end} · ${STATUS_LABELS[request.status] ?? request.status}`)}${request.demoOwner && request.status === "pending" ? `<br>${DEMO_OWNER_NOTE}` : ""}</small>
        </div>
        <div class="owner-row-actions">
          ${cancellable(request) ? `<button type="button" class="button button-secondary button-sm" data-cancel-request="${escapeHtml(request.id)}">신청 취소</button>` : ""}
        </div>
      </div>`).join("");
  }

  function renderOwner() {
    if (!store.user) return;
    const owned = ownedListings();
    const pending = store.ownerRequests.filter((request) => request.status === "pending");
    const decided = store.ownerRequests.filter((request) => request.status !== "pending").slice(0, 5);
    const inquiries = store.conversations.filter((conversation) => conversation.role === "owner");
    $("ownerStats").innerHTML = `
      <div class="stat-box">
        <span class="stat-icon" aria-hidden="true">${pictureIcon("sprout")}</span>
        <div><small>내가 등록한 농기계</small><strong>${owned.length}대</strong></div>
      </div>
      <div class="stat-box">
        <span class="stat-icon" aria-hidden="true">${pictureIcon("envelope")}</span>
        <div><small>대기 중인 대여 요청</small><strong>${pending.length}건</strong></div>
      </div>
      <div class="stat-box">
        <span class="stat-icon" aria-hidden="true">${pictureIcon("handshake")}</span>
        <div><small>거래 완료된 판매</small><strong>${owned.filter((item) => item.type === "sale" && item.status === "done").length}건</strong></div>
      </div>
    `;
    $("ownerListings").innerHTML = owned.map((item) => `
      <div class="owner-row">
        <div class="owner-row-info">
          <div class="owner-row-badges">
            <span class="card-status-pill ${statusClass(item)}">${statusLabel(item)}</span>
            <span class="spec-tag">${item.type === "rent" ? "일일 대여" : "중고 판매"}</span>
          </div>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${money(item.price)}${item.type === "rent" ? " / 1일" : ""} · ${escapeHtml(item.region)}</small>
          ${item.type === "rent" ? `<small>예약된 기간 · ${item.booked.length
            ? item.booked.map(({ start, end }) => escapeHtml(`${start} ~ ${end}`)).join(" / ")
            : "없음"}</small>` : ""}
        </div>
        <div class="owner-row-actions">
          <button type="button" class="button button-secondary button-sm" data-owner-detail="${escapeHtml(item.id)}">상세 보기</button>
        </div>
      </div>`).join("") || `<div class="empty-panel">이 계정에 연결된 농기계가 없습니다.</div>`;
    const requestRow = (request) => `
      <div class="request-row">
        <div class="owner-row-info">
          <span class="step-pill">${request.status === "pending" ? "대여 승인 대기" : escapeHtml(STATUS_LABELS[request.status].split(" · ")[0])}</span>
          <strong>${escapeHtml(request.listingTitle)}</strong>
          <small>${escapeHtml(`신청자: ${request.requesterName} · 희망 기간: ${request.start} ~ ${request.end}`)}${request.note ? `<br>메모: ${escapeHtml(request.note)}` : ""}</small>
        </div>
        <div class="owner-row-actions">
          ${request.status === "pending" ? `
            <button type="button" class="button button-primary button-sm" data-request-action="approve" data-request-id="${escapeHtml(request.id)}">승인</button>
            <button type="button" class="button button-secondary button-sm" data-request-action="reject" data-request-id="${escapeHtml(request.id)}">거절</button>` : ""}
        </div>
      </div>`;
    const inquiryRow = (conversation) => `
      <div class="request-row">
        <div class="owner-row-info">
          <span class="step-pill">채팅 문의</span>
          <strong>${escapeHtml(conversation.listingTitle)}</strong>
          <small>${escapeHtml(conversation.lastMessage
            ? `${conversation.lastMessage.fromOwner ? "내 답장" : conversation.counterpartName}: ${conversation.lastMessage.body}`
            : `${conversation.counterpartName}님이 대화를 시작했어요.`)}</small>
        </div>
        <div class="owner-row-actions">
          <button type="button" class="button button-secondary button-sm" data-open-conversation="${escapeHtml(conversation.id)}">답장하기</button>
        </div>
      </div>`;
    $("ownerRequests").innerHTML = [...pending.map(requestRow), ...inquiries.map(inquiryRow), ...decided.map(requestRow)].join("")
      || `<div class="empty-panel">아직 도착한 대여 요청이나 문의가 없습니다.</div>`;
  }

  async function openChat({ listingId, conversationId }) {
    if (!store.user) return requireLogin("채팅 문의는 로그인한 뒤 할 수 있어요.");
    let data;
    try {
      data = conversationId ? await chatApi.get(conversationId) : await chatApi.open(listingId);
    } catch (error) {
      return toast(error.message);
    }
    const { conversation } = data;
    openForm(`
      <span class="step-pill">1:1 농기계 채팅 문의</span>
      <h2 id="formTitle">${escapeHtml(conversation.counterpartName)}님과 대화하기</h2>
      <p><strong>${escapeHtml(conversation.listingTitle)}</strong> · ${conversation.role === "buyer" && conversation.demoOwner ? DEMO_OWNER_NOTE : "궁금한 기계 상태나 인수 시간을 편하게 물어보세요."}</p>
      <div id="chatLog" class="chat-log"></div>
      <form id="chatForm" class="chat-send">
        <input id="chatMessage" maxlength="500" placeholder="예: 초보자도 작동하기 쉬운가요? 이번 주 토요일에 보러 가도 될까요?" aria-label="메시지 입력" required>
        <button type="submit" class="button button-primary">보내기</button>
      </form>
    `);
    const renderMessages = (messages) => {
      // .chat-line은 줄바꿈을 그대로 보여 주므로(pre-wrap) 태그 사이에 공백을 넣지 않는다.
      $("chatLog").innerHTML = messages.map((message) =>
        `<div class="chat-line ${message.mine ? "mine" : ""}"><b>${message.fromOwner ? "기계 소유자" : "문의 농가"}</b><div>${escapeHtml(message.body)}</div></div>`).join("") || `<div class="chat-empty">아직 나눈 대화가 없어요. 기계 상태와 인수 조건을 먼저 물어보세요!</div>`;
      $("chatLog").scrollTop = $("chatLog").scrollHeight;
    };
    renderMessages(data.messages);
    $("chatForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("chatMessage");
      const body = input.value.trim();
      if (!body) return;
      input.disabled = true;
      try {
        const result = await chatApi.send(conversation.id, body);
        input.value = "";
        renderMessages(result.messages);
        store.refresh();
      } catch (error) {
        toast(error.message);
      } finally {
        input.disabled = false;
        input.focus();
      }
    });
  }

  async function act(button, action, id, done) {
    button.disabled = true;
    try {
      await store.act(action, id);
      toast(done);
      onBookingsChanged();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  }

  $("buyerRequestList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cancel-request]");
    if (button) act(button, "cancel", button.dataset.cancelRequest, "신청을 취소했어요.");
  });
  $("ownerRequests").addEventListener("click", (event) => {
    const button = event.target.closest("[data-request-action]");
    if (button) {
      const approve = button.dataset.requestAction === "approve";
      return act(button, button.dataset.requestAction, button.dataset.requestId, approve ? "대여 요청을 승인했어요. 예약 기간에 반영됐어요." : "대여 요청을 거절했어요.");
    }
    const chat = event.target.closest("[data-open-conversation]");
    if (chat) openChat({ conversationId: chat.dataset.openConversation });
  });

  return {
    openRentalForm,
    openChat,
    renderBuyerRequests,
    renderOwner,
    pendingForOwner: () => store.ownerRequests.filter((request) => request.status === "pending").length,
  };
}
