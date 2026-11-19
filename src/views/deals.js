// 거래 관리: 채팅 모달 밖에서 농농이 대리 거래의 발신 이력·제안·확인할 일·위임 조건을 다룬다.
// 실제 /api/conversations(worker1 계약 v2, worker2 협상 v3)만 호출한다. 목업 데이터 없음.
import { $, escapeHtml, toast, showDialog } from "../core/utils.js";
import { state, runtime, isLoggedIn, apiFetch, stopChatPolling } from "../core/store.js";
import {
  normalizeDeal, normalizeOffer, aiStatus, senderState, roleOf, roleLabel, counterpartLabel,
  SENDER_LABEL, SENDER_ICON, AI_STATUS_LABEL, STAGE_LABEL, stageSteps, describeOffer, formatWon,
  offerAcceptedBy, DEAL_FILTERS, matchesFilter, filterCounts, dealsBadge, filterMessages,
  readSeqFor, buildPolicyFromForm, validatePolicy, buildOfferBody, rentalDays, dealsHash,
} from "../data/deals-model.js";

const LIST_POLL_MS = 20000;
const DETAIL_POLL_MS = 4000;

export function sortInboxDeals(deals) {
  return [...deals].sort((a, b) => {
    const ta = Date.parse(a.updatedAt || "") || 0;
    const tb = Date.parse(b.updatedAt || "") || 0;
    if (tb !== ta) return tb - ta;
    const cmp = String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    if (cmp !== 0) return cmp;
    return (Number(b.lastSeq) || 0) - (Number(a.lastSeq) || 0);
  });
}

const UNAVAILABLE_CODES = new Set(["TRADE_NEGOTIATION_UNAVAILABLE", "UNKNOWN_ACTION", "NOT_IMPLEMENTED"]);

function errorText(error, fallback) {
  if (!error) return fallback;
  if (UNAVAILABLE_CODES.has(error.code) || error.status === 501) {
    return `서버에 아직 이 기능이 연결되지 않았어요 (${error.code || error.status}).`;
  }
  const map = {
    OFFER_VERSION_STALE: "그사이 조건이 바뀌었어요. 최신 제안을 확인한 뒤 다시 시도해 주세요.",
    TERMS_INCOMPLETE: "운송비 등 미확정 조건이 있어 신청할 수 없어요. 조건을 먼저 확정해 주세요.",
    OFFER_NOT_OPEN: "이미 처리된 제안이에요.",
    OFFER_NOT_AGREED: "양측이 같은 조건에 수락해야 신청할 수 있어요.",
    SELLER_CANNOT_APPLY: "판매자는 구매자 명의로 신청할 수 없어요.",
  };
  return map[error.code] || error.message || fallback;
}

function relTime(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(t).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function clock(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function createDealsView(deps) {
  const ui = {
    filter: "all",
    detailId: null,
    conv: null,
    messages: new Map(),
    pending: new Map(),
    drafts: new Map(),
    delegationOpen: false,
    tab: "conversation",
    msgTab: "all",
    offerFormOpen: false,
    composing: false,
    busy: false,
    listTimer: null,
    detailTimer: null,
    epoch: 0,
  };

  try {
    const saved = localStorage.getItem("moa-deals-filter");
    if (saved && DEAL_FILTERS.some((f) => f.key === saved)) ui.filter = saved;
  } catch { /* 저장소 접근 불가 시 기본값 */ }

  const meId = () => runtime.accountUser?.id || null;
  const isActive = () => state.view === "deals";

  function legacyOrderFor(conv) {
    // worker1 DTO가 order를 내려주지 않는 구버전 응답에서만 쓰는 임시 표시용 역조회(권한·중복 판단에는 쓰지 않음).
    if (!conv || Object.hasOwn(conv, "order")) return null;
    const id = meId();
    if (conv.buyerId === id) {
      const r = (runtime.outgoingRequests || []).find((q) => q.listingId === conv.listingId);
      return r ? { kind: "rental", id: r.id, status: r.status, derivedState: r.derivedState, totalPrice: r.totalPrice, canApprove: false, legacy: true } : null;
    }
    const r = (runtime.incomingRequests || []).find((q) => q.listingId === conv.listingId && q.requesterId === conv.buyerId);
    return r ? { kind: "rental", id: r.id, status: r.status, derivedState: r.derivedState, totalPrice: r.totalPrice, canApprove: r.canApprove, legacy: true } : null;
  }

  function allDeals() {
    if (!isLoggedIn()) return [];
    return (runtime.userConversations || []).map((c) => normalizeDeal(c, { meId: meId(), legacyOrder: legacyOrderFor(c) }));
  }

  function badgeCounts() {
    return dealsBadge(allDeals());
  }

  async function post(action, body) {
    return apiFetch("/api/conversations", { method: "POST", json: { action, ...body } });
  }

  // ---------- 목록 ----------
  function renderFilters(deals) {
    const el = $("dealsFilters");
    if (!el) return;
    const counts = filterCounts(deals);
    el.innerHTML = DEAL_FILTERS.map((f) => {
      const active = f.key === ui.filter;
      const unreadUnsupported = f.key === "unread" && deals.length && deals.every((d) => !d.unreadSupported);
      return `<button type="button" class="deals-filter-chip${active ? " is-active" : ""}${f.key === "attention" && counts.attention ? " is-alert" : ""}" data-deals-filter="${f.key}" aria-pressed="${active}"${unreadUnsupported ? ` title="서버가 읽음 정보를 아직 제공하지 않아요"` : ""}>
        ${escapeHtml(f.label)} <span class="deals-filter-count">${counts[f.key]}</span>
      </button>`;
    }).join("");
  }

  function lastMessagePreview(deal) {
    const body = String(deal.lastMessage?.body || "").replace(/\s+/g, " ").trim();
    if (body) return body;
    return "아직 주고받은 메시지가 없어요.";
  }

  function aiBadge(ai) {
    const tone = ["waiting", "failed", "turns", "takeover", "paused"].includes(ai.key) ? "warn"
      : ai.key === "submitted" || ai.key === "handoff" ? "done"
        : ai.key === "off" ? "off" : "active";
    return `<span class="deal-ai-badge tone-${tone}" data-ai-state="${ai.key}">${escapeHtml(AI_STATUS_LABEL[ai.key] || ai.key)}</span>`;
  }

  function roleChip(deal) {
    return `<span class="deal-role-chip role-${deal.myRole || "none"}">${escapeHtml(deal.roleLabel)}</span>`;
  }

  function renderInboxRow(deal) {
    const unread = (deal.unreadCount || 0) > 0;
    const selected = ui.detailId === deal.id;
    const preview = lastMessagePreview(deal);
    const time = relTime(deal.updatedAt);
    return `<article class="deal-card deal-inbox-row${unread ? " is-unread" : ""}${selected ? " is-selected" : ""}" data-deal-open="${escapeHtml(deal.id)}" role="button" tabindex="0" aria-current="${selected ? "true" : "false"}" aria-label="${escapeHtml(`${deal.listingTitle}, ${preview}`)}">
      <div class="deal-row-top">
        <h3 class="deal-card-title">${escapeHtml(deal.listingTitle)}</h3>
        <div class="deal-row-meta">
          ${unread ? `<span class="deal-unread-dot" aria-label="안 읽은 메시지 ${deal.unreadCount}개">${deal.unreadCount}</span>` : ""}
          ${time ? `<span class="deal-card-time">${escapeHtml(time)}</span>` : ""}
        </div>
      </div>
      <p class="deal-card-last">${escapeHtml(preview)}</p>
    </article>`;
  }

  function renderList() {
    const listEl = $("dealsList");
    if (!listEl) return;
    if (!isLoggedIn()) {
      listEl.innerHTML = "";
      if ($("dealsFilters")) $("dealsFilters").innerHTML = "";
      return;
    }
    const deals = allDeals();
    renderFilters(deals);
    const visible = sortInboxDeals(deals.filter((d) => matchesFilter(d, ui.filter)));
    if (!deals.length) {
      listEl.innerHTML = `<div class="empty-panel deals-empty">
        <p>아직 진행 중인 거래 대화가 없어요. 매물에서 문의하거나 AI 농농이에게 거래를 맡겨 보세요.</p>
        <div class="deals-empty-actions"><button type="button" class="button button-primary button-sm" data-deals-goto="browse">매물 찾기</button>
        <button type="button" class="button button-secondary button-sm" data-deals-goto="owner">내 매물 자동응대 설정</button></div>
      </div>`;
      return;
    }
    if (!visible.length) {
      const msg = ui.filter === "attention"
        ? `확인할 일이 없어요. 농농이가 ${deals.filter((d) => matchesFilter(d, "ai")).length}건을 맡아 진행 중이에요.`
        : ui.filter === "unread" && deals.every((d) => !d.unreadSupported)
          ? "서버가 아직 읽음 정보를 제공하지 않아 안 읽은 거래를 구분할 수 없어요."
          : "이 조건에 맞는 거래가 없어요.";
      listEl.innerHTML = `<div class="empty-panel">${escapeHtml(msg)}</div>`;
      return;
    }
    listEl.innerHTML = visible.map(renderInboxRow).join("");
  }

  // ---------- 상세 ----------
  function detailDeal() {
    if (!ui.conv) return null;
    return normalizeDeal(ui.conv, { meId: meId(), legacyOrder: legacyOrderFor(ui.conv) });
  }

  function sortedMessages() {
    return [...ui.messages.values()].sort((a, b) => a.seq - b.seq);
  }

  function msgCtx() {
    return { meId: meId(), myRole: roleOf(ui.conv, meId()) };
  }

  function renderMessage(msg) {
    const s = senderState(msg, msgCtx());
    if (s === "system") {
      return `<div class="deal-msg deal-msg-system" data-sender-state="system" role="note">
        <span class="deal-msg-label">${SENDER_ICON.system} ${msg.visibility === "self" ? "🔒 나에게만 보이는 안내" : SENDER_LABEL.system}</span>
        <p>${escapeHtml(msg.body)}</p>
      </div>`;
    }
    const mine = s === "me_human" || s === "me_ai";
    const who = s === "other_human" ? `${escapeHtml(msg.senderName || "상대")}`
      : s === "other_ai" ? `${escapeHtml(msg.senderName || "상대")} 님의 농농이`
        : s === "me_ai" ? "내 농농이" : "나";
    const conf = s === "me_ai" && msg.aiConfidence ? ` · 확신 ${msg.aiConfidence === "high" ? "높음" : msg.aiConfidence === "medium" ? "보통" : "낮음"}` : "";
    return `<div class="deal-msg ${mine ? "is-mine" : "is-theirs"} sender-${s}" data-sender-state="${s}">
      <span class="deal-msg-label">${SENDER_ICON[s]} ${who} <small>${escapeHtml(SENDER_LABEL[s])}${conf} · ${escapeHtml(clock(msg.createdAt))}</small></span>
      <p>${escapeHtml(msg.body)}</p>
    </div>`;
  }

  function renderDraft(deal) {
    const d = deal.ai.draft;
    if (!d) return "";
    return `<div class="deal-msg is-mine sender-draft" data-sender-state="draft">
      <span class="deal-msg-label">📝 ${SENDER_LABEL.draft} <small>상대에게 아직 보내지 않았어요${d.createdAt ? ` · ${escapeHtml(clock(d.createdAt))}` : ""}</small></span>
      <p>${escapeHtml(d.body)}</p>
      <div class="deal-msg-actions">
        <button type="button" class="button button-primary button-sm" data-deal-draft-send>이대로 보내기</button>
        <button type="button" class="button button-secondary button-sm" data-deal-draft-edit>고쳐서 보내기</button>
        <button type="button" class="button button-secondary button-sm" data-deal-draft-dismiss>무시</button>
      </div>
    </div>`;
  }

  function renderMessageBody(deal) {
    const all = sortedMessages();
    if (ui.msgTab === "drafts") {
      return deal.ai.draft ? renderDraft(deal) : `<div class="deal-empty-line">보내지 않은 초안이 없어요.</div>`;
    }
    const list = filterMessages(all, ui.msgTab, msgCtx());
    let body = list.length ? list.map(renderMessage).join("") : `<div class="deal-empty-line">표시할 메시지가 없어요.</div>`;
    if (ui.msgTab === "all") body += renderDraft(deal);
    return body;
  }

  function renderNewPill() {
    const pendingCount = ui.pending.size;
    return pendingCount ? `<button type="button" class="deal-new-pill" data-deal-show-new>새 메시지 ${pendingCount}개 보기</button>` : "";
  }

  function renderConversation(deal) {
    const tabs = [["all", "전체"], ["sent", "보낸 메시지"], ["received", "받은 메시지"], ["drafts", "초안"]];
    const takeoverNote = deal.ai.mode !== "off" && deal.ai.key !== "takeover"
      ? `<p class="deal-composer-note">직접 보내면 이 거래는 ‘직접 진행 중’으로 바뀌고, ‘다시 맡기기’를 누르기 전까지 농농이가 자동으로 보내지 않아요.</p>` : "";
    const draftValue = ui.drafts.get(ui.detailId) || "";
    return `<section class="deal-section deal-conversation" aria-labelledby="dealConvTitle">
      <div class="deal-section-head">
        <h3 id="dealConvTitle">주고받은 메시지</h3>
        <div class="deal-msg-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${ui.msgTab === k}" class="deal-msg-tab${ui.msgTab === k ? " is-active" : ""}" data-deal-msgtab="${k}">${l}</button>`).join("")}</div>
      </div>
      <div class="deal-msg-log" id="dealMsgLog" aria-live="polite">${renderMessageBody(deal)}</div>
      <div id="dealNewPillSlot">${renderNewPill()}</div>
      <form class="deal-composer is-open" id="dealComposer">
        ${takeoverNote}
        <div class="deal-composer-row">
          <textarea id="dealComposerInput" maxlength="500" rows="2" placeholder="메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)" aria-label="직접 보낼 메시지">${escapeHtml(draftValue)}</textarea>
          <button type="submit" class="button button-primary button-sm deal-composer-send">보내기</button>
        </div>
      </form>
    </section>`;
  }

  function renderException(deal) {
    const ai = deal.ai;
    if (!["waiting", "failed", "turns", "handoff"].includes(ai.key)) return "";
    const title = ai.key === "waiting" ? "농농이가 내 확인을 기다리고 있어요"
      : ai.key === "failed" ? "농농이 답장 생성에 실패했어요"
        : ai.key === "turns" ? "농농이 연속 응답 횟수 상한에 도달했어요"
          : "양측 농농이가 조건 정리를 마쳤어요";
    const lines = [
      ai.reasonLabel ? `사유: ${ai.reasonLabel}` : "",
      ai.summary || "",
      ai.key === "waiting" || ai.key === "failed" ? "상대에게는 아무것도 보내지 않았어요. 상대가 추가로 말해도 내가 다시 맡길 때까지 대기해요." : "",
    ].filter(Boolean);
    const retry = ai.key === "failed" ? `<button type="button" class="button button-primary button-sm" data-deal-retry>다시 시도</button>` : "";
    return `<section class="deal-exception" role="alert">
      <strong>⚠ ${escapeHtml(title)}</strong>
      ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}
      <div class="deal-exception-actions">
        ${ai.draft ? `<button type="button" class="button button-primary button-sm" data-deal-draft-send>초안 그대로 보내기</button>` : ""}
        <button type="button" class="button button-secondary button-sm" data-deal-composer-open>직접 답장</button>
        ${retry}
        <button type="button" class="button button-secondary button-sm" data-arm-key="resume" data-deal-resume>다시 맡기기</button>
      </div>
    </section>`;
  }

  function renderProgress(deal) {
    const steps = stageSteps(deal.stage, deal.listingType);
    const ended = deal.stage === "rejected" || deal.stage === "cancelled";
    const order = deal.order;
    let orderHtml = "";
    if (order) {
      const kindLabel = order.kind === "purchase" ? "구매 신청" : "대여 신청";
      const statusLabel = { pending: "상대 승인 대기", approved: "승인됨 · 예약 확정", rejected: "거절됨", cancelled: "취소됨", completed: "완료(기록됨)" }[order.status] || order.status;
      const approveBtns = deal.myRole === "owner" && order.kind !== "purchase" && deal.nextActions.some((a) => a.key === "approve")
        ? `<button type="button" class="button button-primary button-sm" data-req-approve="${escapeHtml(order.id)}">승인</button><button type="button" class="button button-secondary button-sm" data-req-reject="${escapeHtml(order.id)}">거절</button>` : "";
      orderHtml = `<div class="deal-order">
        <p><b>${kindLabel}</b> · ${escapeHtml(statusLabel)}${order.legacy ? " <small>(기존 신청 내역에서 추정한 연결)</small>" : ""}</p>
        ${order.totalPrice != null ? `<p>${order.kind === "purchase" ? "물품가" : "대여료"} ${escapeHtml(formatWon(order.totalPrice))}${order.transportFee != null && order.transportPayer && order.transportPayer !== "none"
          ? ` · 운송비 ${escapeHtml(formatWon(order.transportFee))}(${order.transportPayer === "buyer" ? (deal.listingType === "sale" ? "구매자" : "빌리는 분") : (deal.listingType === "sale" ? "판매자" : "빌려주는 분")} 부담)${order.transportPayer === "buyer" ? ` · 구매자 지불 합계 ${escapeHtml(formatWon(Number(order.totalPrice) + Number(order.transportFee)))}` : ""}`
          : order.transportPayer === "none" ? " · 운송 없음(직접 인수)" : ""}${order.start ? ` · ${escapeHtml(order.start)}~${escapeHtml(order.end || order.start)}` : ""}</p>` : ""}
        ${deal.myRole === "owner" && order.kind === "purchase" && order.status === "pending" ? `<p class="deal-hint">구매 신청 승인은 아직 이 화면에서 지원하지 않아요. 대화로 인수 일정을 확정해 주세요.</p>` : ""}
        <p class="deal-hint">신청은 거래 완료가 아니에요. 승인·인도/반납이 기록되어야 완료로 표시돼요.</p>
        ${approveBtns ? `<div class="deal-order-actions">${approveBtns}</div>` : ""}
      </div>`;
    }
    return `<section class="deal-section deal-progress" aria-labelledby="dealProgressTitle">
      <h3 id="dealProgressTitle">진행 단계</h3>
      ${ended ? `<p class="deal-ended">${escapeHtml(STAGE_LABEL[deal.stage])}</p>` : ""}
      <ol class="deal-steps">${steps.map((s) => `<li class="is-${s.state}"><span>${escapeHtml(s.label)}</span></li>`).join("")}</ol>
      ${orderHtml}
    </section>`;
  }

  function evaluationHint(deal) {
    const ev = deal.ai.evaluation;
    if (!ev || !ev.verdict) return "";
    const label = {
      accept_ok: "내 조건 범위 안의 제안이에요.",
      counter_in_range: "한도 안이지만 목표가와 차이가 있어요. 역제안을 추천해요.",
      outside_limit: "내 한도를 벗어난 제안이에요.",
      needs_user: "미확정 비용 등으로 직접 판단이 필요해요.",
    }[ev.verdict] || ev.verdict;
    return `<p class="deal-eval eval-${escapeHtml(ev.verdict)}">🔒 ${escapeHtml(label)}${ev.counterSuggestion?.amount ? ` 추천 역제안: ${escapeHtml(formatWon(ev.counterSuggestion.amount))}` : ""}</p>`;
  }

  function renderOfferRow(o, deal) {
    const fromMe = o.fromRole === deal.myRole;
    const who = `${fromMe ? "내" : "상대"} ${o.senderKind === "ai_proxy" ? "농농이" : "직접"}`;
    const status = { open: "응답 대기", accepted: "양측 합의", superseded: "새 제안으로 대체", rejected: "거절", withdrawn: "철회" }[o.status] || o.status;
    return `<li class="deal-offer-row status-${escapeHtml(o.status)}"><span class="deal-offer-who">v${o.termsVersion} · ${escapeHtml(who)}</span> ${escapeHtml(describeOffer(o))} <small>${escapeHtml(status)}${o.createdAt ? ` · ${escapeHtml(clock(o.createdAt))}` : ""}</small></li>`;
  }

  function renderOfferForm(deal) {
    const rent = deal.listingType === "rent";
    const ev = deal.ai.evaluation;
    const base = deal.currentOffer;
    const suggested = ev?.counterSuggestion?.amount ?? deal.ai.policy?.targetPrice ?? "";
    const unit = ev?.counterSuggestion?.amountUnit || (rent ? (deal.ai.policy?.budgetUnit === "daily" ? "daily" : "total") : "total");
    return `<form class="deal-offer-form" id="dealOfferForm">
      <div class="deal-form-grid">
        ${rent ? `<label>금액 기준<select id="dealOfferUnit"><option value="daily"${unit === "daily" ? " selected" : ""}>하루 대여료</option><option value="total"${unit === "total" ? " selected" : ""}>기간 총액</option></select></label>` : ""}
        <label>제안 금액(원)<input id="dealOfferAmount" type="number" min="1" step="any" inputmode="numeric" required value="${escapeHtml(suggested ?? "")}"></label>
        ${rent ? `<label>시작일<input id="dealOfferStart" type="date" value="${escapeHtml(base?.start || deal.ai.policy?.targetStart || "")}"></label>
        <label>반납일<input id="dealOfferEnd" type="date" value="${escapeHtml(base?.end || deal.ai.policy?.targetEnd || "")}"></label>` : ""}
        <label>운송<select id="dealOfferPayer">
          <option value="none"${base?.transportPayer === "none" ? " selected" : ""}>운송 없음(직접 인수)</option>
          <option value="buyer"${base?.transportPayer === "buyer" ? " selected" : ""}>${rent ? "빌리는 분" : "구매자"} 부담</option>
          <option value="owner"${base?.transportPayer === "owner" ? " selected" : ""}>${rent ? "빌려주는 분" : "판매자"} 부담</option>
          <option value=""${base && !base.transportPayer ? " selected" : ""}>아직 미정</option>
        </select></label>
        <label>운송비(원, 모르면 비움)<input id="dealOfferFee" type="number" min="0" step="any" inputmode="numeric" value="${base?.transportFee != null && base.transportPayer !== "none" ? escapeHtml(base.transportFee) : ""}"></label>
        <label class="deal-form-wide">메모<input id="dealOfferNote" type="text" maxlength="200" placeholder="예: 토요일 오전 인수 조건"></label>
      </div>
      <p class="deal-hint">운송비를 비워 두면 ‘미정’으로 보내요. 미정 조건은 합의해도 신청할 수 없어요.</p>
      <div class="deal-form-actions">
        <button type="button" class="button button-secondary button-sm" data-deal-offer-cancel>취소</button>
        <button type="submit" class="button button-primary button-sm">이 조건으로 제안 보내기</button>
      </div>
    </form>`;
  }

  function renderNegotiation(deal) {
    const o = deal.currentOffer;
    const myAccepted = o ? offerAcceptedBy(o, deal.myRole) : false;
    const theirRole = deal.myRole === "buyer" ? "owner" : "buyer";
    const theirAccepted = o ? offerAcceptedBy(o, theirRole) : false;
    let current = `<p class="deal-empty-line">아직 구조화된 가격 제안이 없어요. 제안을 보내면 양측이 같은 조건 버전에 수락해야 합의돼요.</p>`;
    if (o) {
      const canAccept = o.status === "open" && !myAccepted;
      const canReject = o.status === "open" && o.fromRole !== deal.myRole;
      const canApply = deal.myRole === "buyer" && deal.agreed && !deal.order;
      current = `<div class="deal-offer-current status-${escapeHtml(o.status)}">
        <p class="deal-offer-who">현재 조건 v${o.termsVersion} · ${o.fromRole === deal.myRole ? "내" : "상대"} ${o.senderKind === "ai_proxy" ? "농농이 제안" : "직접 제안"}</p>
        <p class="deal-offer-main">${escapeHtml(describeOffer(o))}</p>
        <p class="deal-offer-total">${deal.myRole === "buyer" ? "내가 낼 총액" : "상대가 낼 총액"} <b>${escapeHtml(formatWon(o.totalAmount))}</b>${o.ownerNet != null && deal.myRole === "owner" ? ` · 내 순수령 ${escapeHtml(formatWon(o.ownerNet))}` : ""}${o.termsComplete ? "" : ` <span class="deal-warn-chip">미확정 조건 있음</span>`}</p>
        <p class="deal-offer-accepts">수락: 나 ${myAccepted ? "✔" : "—"} · 상대 ${theirAccepted ? "✔" : "—"}${o.status === "accepted" ? " → <b>합의됨</b>" : ""}</p>
        ${evaluationHint(deal)}
        <div class="deal-offer-actions">
          ${canAccept ? `<button type="button" class="button button-primary button-sm" data-deal-accept="${escapeHtml(o.id)}" data-terms-version="${o.termsVersion}">이 조건 수락</button>` : ""}
          ${(o.status === "open" || o.status === "accepted") && !deal.order ? `<button type="button" class="button button-secondary button-sm" data-deal-offer-open>역제안·조건 변경</button>` : ""}
          ${canReject ? `<button type="button" class="button button-secondary button-sm" data-deal-reject="${escapeHtml(o.id)}">거절</button>` : ""}
          ${canApply ? `<button type="button" class="button button-primary button-sm" data-arm-key="apply:${escapeHtml(deal.agreed.id)}" data-deal-apply="${escapeHtml(deal.agreed.id)}"${deal.agreed.termsComplete ? "" : " disabled title=\"운송비 등 미확정 조건이 있어 신청할 수 없어요\""}>합의 조건으로 ${deal.listingType === "sale" ? "구매" : "대여"} 신청</button>` : ""}
        </div>
        ${deal.myRole === "owner" && deal.agreed && !deal.order ? `<p class="deal-hint">합의 후 신청은 ${deal.listingType === "sale" ? "구매자" : "빌리는 분"}만 할 수 있어요.</p>` : ""}
      </div>`;
    }
    const history = deal.offers.length > 1
      ? `<details class="deal-offer-history"><summary>협상 이력 ${deal.offers.length}건</summary><ol>${[...deal.offers].reverse().map((x) => renderOfferRow(x, deal)).join("")}</ol></details>` : "";
    return `<section class="deal-section deal-negotiation" aria-labelledby="dealNegTitle">
      <div class="deal-section-head"><h3 id="dealNegTitle">가격·조건 협상</h3>
        ${(!o || !ui.offerFormOpen) && !deal.order ? `<button type="button" class="button button-secondary button-sm" data-deal-offer-open>${o ? "새 제안" : "제안 보내기"}</button>` : ""}</div>
      ${deal.order ? `<p class="deal-hint">${deal.myRole === "buyer" ? "이미 이 합의로 신청했어요" : "이 합의로 신청이 접수됐어요"}. 같은 조건으로 다시 신청되지 않아요.</p>` : ""}
      ${current}
      ${ui.offerFormOpen ? renderOfferForm(deal) : ""}
      ${history}
    </section>`;
  }

  function renderPolicy(deal) {
    const p = deal.ai.policy || {};
    const buyer = deal.myRole === "buyer";
    const rent = deal.listingType === "rent";
    const limit = buyer ? p.maxBudget : p.minPrice;
    const transportKnown = p.transportFee !== null && p.transportFee !== undefined;
    const rq = Array.isArray(p.requiredQuestions) ? p.requiredQuestions.join("\n") : (p.requiredQuestions || "");
    return `<section class="deal-section deal-policy" aria-labelledby="dealPolicyTitle">
      <div class="deal-section-head">
        <h3 id="dealPolicyTitle">위임 조건 <small>🔒 나에게만 보여요 · 상대에게 공개되지 않아요</small></h3>
        <button type="button" class="button button-secondary button-sm" data-deal-delegation-close>닫기</button>
      </div>
      <form id="dealPolicyForm" class="deal-policy-form">
        <fieldset class="deal-mode-group"><legend>농농이 역할</legend>
          ${[["off", "끄기", "농농이가 아무것도 보내지 않아요"], ["copilot", "초안만", "답장 초안을 만들고 내가 보내요"], ["autonomous", "자동 응대·협상", "조건 안에서 대신 보내고 협상해요"]]
            .map(([v, l, d]) => `<label class="deal-mode-option"><input type="radio" name="dealPolicyMode" value="${v}"${deal.ai.mode === v ? " checked" : ""}><span><b>${l}</b><small>${d}</small></span></label>`).join("")}
        </fieldset>
        <div class="deal-form-grid">
          ${rent ? `<label>금액 기준<select id="dealPolicyUnit"><option value="total"${p.budgetUnit !== "daily" ? " selected" : ""}>기간 총액</option><option value="daily"${p.budgetUnit === "daily" ? " selected" : ""}>하루 대여료</option></select></label>` : ""}
          <label>${buyer ? "목표가" : "희망가"}(원)<input id="dealPolicyTarget" type="number" min="0" step="any" inputmode="numeric" value="${p.targetPrice ?? ""}" placeholder="${buyer ? "예: 900000" : "예: 1000000"}"></label>
          <label>${buyer ? "최대 예산(운송비 포함)" : "최저 허용가"}(원)<input id="dealPolicyLimit" type="number" min="0" step="any" inputmode="numeric" value="${limit ?? ""}" placeholder="비워 두면 한도 없음 → 금액 결정은 내게 확인"></label>
          <label>운송<select id="dealPolicyPayer">
            <option value=""${!p.transportPayer ? " selected" : ""}>미정</option>
            <option value="none"${p.transportPayer === "none" ? " selected" : ""}>운송 없음(직접 인수)</option>
            <option value="buyer"${p.transportPayer === "buyer" ? " selected" : ""}>${rent ? "빌리는 분" : "구매자"} 부담</option>
            <option value="owner"${p.transportPayer === "owner" ? " selected" : ""}>${rent ? "빌려주는 분" : "판매자"} 부담</option>
            <option value="split"${p.transportPayer === "split" ? " selected" : ""}>반반(협의)</option>
          </select></label>
          <label>운송비(원)<input id="dealPolicyFee" type="number" min="0" step="any" inputmode="numeric" value="${transportKnown && p.transportPayer !== "none" ? p.transportFee : ""}" placeholder="모르면 비움(미정)"></label>
          <label class="deal-form-wide">인수·배달 조건<input id="dealPolicyPickup" type="text" maxlength="120" value="${escapeHtml(p.pickupPreference || "")}" placeholder="예: 토요일 오전 직접 인수"></label>
          <label class="deal-form-wide">${buyer ? "꼭 물어볼 질문" : "문의자에게 확인할 질문"}(한 줄에 하나)<textarea id="dealPolicyQuestions" rows="3" maxlength="600" placeholder="${buyer ? "예: 누유 여부\n토요일 인수 가능 여부" : "예: 작업 면적\n인수 방법"}">${escapeHtml(rq)}</textarea></label>
        </div>
        <label class="deal-check"><input type="checkbox" id="dealPolicyNegotiate"${p.allowNegotiation !== false ? " checked" : ""}> 한도 안에서 가격 협상 허용</label>
        ${buyer ? `<label class="deal-check"><input type="checkbox" id="dealPolicyAutoApply"${p.autoExecuteTransaction ? " checked" : ""}> 양측이 같은 조건에 합의하면 내 명의로 ${rent ? "대여" : "구매"} 신청까지 맡기기</label>` : `<p class="deal-hint">판매자 쪽 농농이는 구매자 명의로 신청하지 않으며, 최종 승인은 직접 해요.</p>`}
        <label class="deal-check"><input type="checkbox" id="dealPolicyFull"${p.fullDelegation ? " checked" : ""}> 거래 전담(부재 중에도 위 범위 안에서 계속 진행)</label>
        <p class="deal-hint">한도를 비워 두면 매물 정가로 채우지 않고, 금액 결정이 필요할 때 내게 확인해요.</p>
        <div class="deal-form-actions"><button type="submit" class="button button-primary button-sm">조건 저장</button></div>
      </form>
    </section>`;
  }

  function renderControls(deal) {
    const ai = deal.ai;
    const activeDelegation = ai.mode !== "off";
    const btns = [
      `<button type="button" class="button ${ui.delegationOpen ? "button-primary" : "button-secondary"} button-sm deal-delegation-btn${ui.delegationOpen ? " is-open" : ""}${activeDelegation ? " is-delegating" : ""}" data-deal-delegation-toggle aria-expanded="${ui.delegationOpen}" aria-controls="dealDelegationPanel">농농이 거래 전담</button>`,
    ];
    if (ai.canTakeover) btns.push(`<button type="button" class="button button-secondary button-sm" data-deal-takeover>✋ 직접 이어받기</button>`);
    if (ai.canResume && ai.mode !== "off") btns.push(`<button type="button" class="button button-primary button-sm" data-arm-key="resume" data-deal-resume>▶ 다시 맡기기</button>`);
    btns.push(`<button type="button" class="button button-secondary button-sm" data-deal-open-chat>대화 전체 보기 ↗</button>`);
    return `<div class="deal-controls">${btns.join("")}</div>`;
  }

  function syncDraftFromDom() {
    if (!ui.detailId) return;
    const input = $("dealComposerInput");
    if (!input) return;
    const value = input.value;
    if (value) ui.drafts.set(ui.detailId, value);
    else ui.drafts.delete(ui.detailId);
  }

  function renderDetail() {
    const pane = $("dealsDetail");
    if (!pane) return;
    const view = $("dealsView");
    if (!ui.detailId) {
      pane.hidden = true;
      pane.innerHTML = "";
      delete pane.dataset.convId;
      view?.classList.remove("has-detail");
      return;
    }
    pane.hidden = false;
    view?.classList.add("has-detail");
    if (!ui.conv) {
      pane.innerHTML = `<div class="deal-loading">거래를 불러오는 중…</div>`;
      return;
    }
    const sameConv = pane.dataset.convId === String(ui.detailId);
    if (sameConv) syncDraftFromDom();
    const deal = detailDeal();
    const prevScroll = sameConv ? $("dealMsgLog")?.scrollTop : null;
    const activeEl = document.activeElement;
    const focusedId = sameConv && activeEl && pane.contains(activeEl) ? activeEl.id : null;
    const selStart = focusedId === "dealComposerInput" ? activeEl.selectionStart : null;
    const selEnd = focusedId === "dealComposerInput" ? activeEl.selectionEnd : null;
    pane.innerHTML = `
      <header class="deal-detail-head">
        <button type="button" class="deal-back" data-deal-back aria-label="거래 목록으로">← 거래 목록</button>
        <div class="deal-detail-title">
          <div class="deal-detail-chips">${roleChip(deal)}<span class="deal-type-chip">${deal.listingType === "sale" ? "중고 거래" : "대여"}</span>${aiBadge(deal.ai)}${deal.counterpartAiActive ? `<span class="deal-type-chip">상대도 농농이 사용 중</span>` : ""}</div>
          <h2>${escapeHtml(deal.listingTitle)}</h2>
          <p>${escapeHtml(deal.counterpartRoleLabel)} ${escapeHtml(deal.counterpartName)} 님 · ${escapeHtml(deal.stageLabel)}</p>
          <p class="deal-role-note">내 역할: ${escapeHtml(deal.roleLabel)} — 농농이도 ${escapeHtml(deal.roleLabel)} 입장에서만 대화해요.</p>
        </div>
        ${renderControls(deal)}
        <p id="dealConfirmNote" class="deal-confirm-note" role="status" hidden></p>
      </header>
      ${renderException(deal)}
      <div id="dealDelegationPanel" class="deal-delegation-panel"${ui.delegationOpen ? "" : " hidden"}>${ui.delegationOpen ? renderPolicy(deal) : ""}</div>
      <nav class="deal-tabs" role="tablist" aria-label="거래 상세 보기">
        ${[["conversation", "대화"], ["progress", "진행·제안"]].map(([k, l]) => `<button type="button" role="tab" aria-selected="${ui.tab === k}" class="deal-tab${ui.tab === k ? " is-active" : ""}" data-deal-tab="${k}">${l}</button>`).join("")}
      </nav>
      <div class="deal-detail-body" data-active-tab="${ui.tab}">
        <div class="deal-col deal-col-main" data-tab-panel="conversation">${renderConversation(deal)}</div>
        <div class="deal-col deal-col-side">
          <div data-tab-panel="progress">${renderProgress(deal)}${renderNegotiation(deal)}</div>
        </div>
      </div>`;
    pane.dataset.convId = String(ui.detailId);
    applyArmedState();
    const log = $("dealMsgLog");
    if (log) log.scrollTop = Number.isFinite(prevScroll) ? prevScroll : log.scrollHeight;
    if (focusedId && $(focusedId)) {
      const nextEl = $(focusedId);
      nextEl.focus({ preventScroll: true });
      if (focusedId === "dealComposerInput" && Number.isInteger(selStart) && Number.isInteger(selEnd)) {
        try { nextEl.setSelectionRange(selStart, selEnd); } catch { /* 선택 영역 복원 불가 시 무시 */ }
      }
    }
  }

  function patchConvFromResponse(conv) {
    if (!conv || String(conv.id) !== String(ui.detailId)) return;
    // 상세 응답에 offers가 없으면(목록형 응답) 기존 이력을 유지한다.
    const prevNeg = ui.conv?.negotiation;
    const nextNeg = conv.negotiation;
    if (prevNeg && nextNeg && !Array.isArray(nextNeg.offers) && Array.isArray(prevNeg.offers)) {
      conv = { ...conv, negotiation: { ...nextNeg, offers: prevNeg.offers } };
    }
    ui.conv = conv;
    const idx = (runtime.userConversations || []).findIndex((c) => String(c.id) === String(conv.id));
    if (idx >= 0) {
      const merged = { ...runtime.userConversations[idx], ...conv };
      runtime.userConversations.splice(idx, 1, merged);
    }
  }

  async function markRead() {
    if (!ui.detailId || document.visibilityState !== "visible" || !isActive()) return;
    const readSeq = readSeqFor(sortedMessages(), msgCtx(), ui.conv?.myLastReadSeq ?? 0);
    if (readSeq === null) return;
    try {
      const res = await post("mark_read", { conversationId: ui.detailId, readSeq });
      if (res?.conversation) patchConvFromResponse(res.conversation);
      else if (ui.conv) ui.conv = { ...ui.conv, myLastReadSeq: readSeq, unreadCount: 0 };
      onConversationRead(ui.detailId, res?.conversation || null);
    } catch (error) {
      if (error?.code === "AUTH_CHANGED") return;
      // 읽음 실패는 화면 이용을 막지 않는다.
    }
  }

  function onConversationRead(conversationId, conv) {
    const idx = (runtime.userConversations || []).findIndex((c) => String(c.id) === String(conversationId));
    if (idx >= 0) {
      const base = runtime.userConversations[idx];
      runtime.userConversations.splice(idx, 1, conv ? { ...base, ...conv } : { ...base, unreadCount: 0 });
    }
    deps.updateBadges?.();
    if (isActive()) renderList();
  }

  async function loadDetail(conversationId) {
    const epoch = ++ui.epoch;
    try {
      const data = await apiFetch(`/api/conversations?conversationId=${encodeURIComponent(conversationId)}&limit=60`);
      if (epoch !== ui.epoch || ui.detailId !== conversationId) return;
      ui.messages = new Map((data.messages || []).map((m) => [m.seq, m]));
      ui.pending = new Map();
      ui.conv = data.conversation || null;
      if (!ui.conv) {
        $("dealsDetail").innerHTML = `<div class="empty-panel">거래를 찾을 수 없어요. <button type="button" class="button button-secondary button-sm" data-deal-back>목록으로</button></div>`;
        return;
      }
      patchConvFromResponse(ui.conv);
      renderDetail();
      renderList();
      // 사용자가 직접 연 상세에서 메시지를 그린 뒤에만 읽음 처리(폴링 경로에서는 호출하지 않음).
      await markRead();
      startDetailPolling();
    } catch (error) {
      if (error?.code === "AUTH_CHANGED" || epoch !== ui.epoch) return;
      $("dealsDetail").innerHTML = `<div class="empty-panel">${escapeHtml(errorText(error, "거래를 불러오지 못했어요."))}</div>`;
    }
  }

  function patchMessagesInPlace() {
    const deal = detailDeal();
    const log = $("dealMsgLog");
    if (!deal || !log) return false;
    const wasNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const prevScroll = log.scrollTop;
    log.innerHTML = renderMessageBody(deal);
    const pillSlot = $("dealNewPillSlot");
    if (pillSlot) pillSlot.innerHTML = renderNewPill();
    log.scrollTop = wasNearBottom ? log.scrollHeight : prevScroll;
    return true;
  }

  function isFormEditing() {
    const el = document.activeElement;
    if (ui.offerFormOpen) return true;
    if (!el || !$("dealsDetail")?.contains(el)) return false;
    if (el.id === "dealComposerInput") return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  }

  function isComposerActive() {
    const el = document.activeElement;
    return ui.composing || Boolean(el && el.id === "dealComposerInput");
  }

  async function pollDetail() {
    if (!ui.detailId || !isActive() || document.visibilityState !== "visible" || ui.busy) return;
    const id = ui.detailId;
    const all = [...ui.messages.values(), ...ui.pending.values()];
    const maxSeq = all.reduce((m, x) => Math.max(m, Number(x.seq) || 0), 0);
    try {
      const data = await apiFetch(`/api/conversations?conversationId=${encodeURIComponent(id)}&after_seq=${maxSeq}&limit=50`);
      if (ui.detailId !== id) return;
      let changed = false;
      for (const m of data.messages || []) {
        if (ui.messages.has(m.seq) || ui.pending.has(m.seq)) continue;
        const s = senderState(m, msgCtx());
        // 내가 보낸/내 농농이가 보낸 메시지는 바로 표시, 상대·시스템 메시지는 '새 메시지 보기'를 눌러야 표시+읽음.
        if (s === "me_human" || s === "me_ai") ui.messages.set(m.seq, m);
        else ui.pending.set(m.seq, m);
        changed = true;
      }
      const before = JSON.stringify([ui.conv?.myAiState, ui.conv?.stage, ui.conv?.negotiation?.currentOffer, ui.conv?.order]);
      if (data.conversation) patchConvFromResponse(data.conversation);
      const after = JSON.stringify([ui.conv?.myAiState, ui.conv?.stage, ui.conv?.negotiation?.currentOffer, ui.conv?.order]);
      const metaChanged = before !== after;
      if (changed || metaChanged) {
        if (metaChanged && ui.conv?.negotiation?.currentOffer && !Array.isArray(data.conversation?.negotiation?.offers)) {
          // 제안이 바뀌었으면 이력까지 다시 받는다(읽음 처리 없음).
          refreshDetailMeta(id);
        }
        if (isFormEditing() || ui.composing || (isComposerActive() && !metaChanged)) {
          patchMessagesInPlace();
        } else {
          renderDetail();
        }
        renderList();
        deps.updateBadges?.();
      }
    } catch {
      // 일시 오류는 다음 폴링에서 회복
    }
  }

  async function refreshDetailMeta(id) {
    try {
      const data = await apiFetch(`/api/conversations?conversationId=${encodeURIComponent(id)}&limit=1`);
      if (ui.detailId !== id || !data.conversation) return;
      patchConvFromResponse(data.conversation);
      if (!isFormEditing() && !ui.composing) renderDetail();
    } catch { /* 무시 */ }
  }

  function startDetailPolling() {
    stopDetailPolling();
    ui.detailTimer = setInterval(pollDetail, DETAIL_POLL_MS);
  }

  function stopDetailPolling() {
    if (ui.detailTimer) clearInterval(ui.detailTimer);
    ui.detailTimer = null;
  }

  function startListPolling() {
    stopListPolling();
    ui.listTimer = setInterval(() => {
      if (!isActive() || document.visibilityState !== "visible" || !isLoggedIn()) return;
      deps.refreshAuthenticatedData?.({ includeRequests: true, includeConversations: true });
    }, LIST_POLL_MS);
  }

  function stopListPolling() {
    if (ui.listTimer) clearInterval(ui.listTimer);
    ui.listTimer = null;
  }

  // ---------- 진입 ----------
  function show({ conversationId = null, filter = null } = {}) {
    if (filter && DEAL_FILTERS.some((f) => f.key === filter)) ui.filter = filter;
    renderList();
    if (!isLoggedIn()) {
      // 로그인 후 main.js가 같은 해시로 다시 show()를 호출한다.
      ui.detailId = null;
      ui.conv = null;
      ui.delegationOpen = false;
      renderDetail();
      return;
    }
    startListPolling();
    if (conversationId) {
      const nextId = String(conversationId);
      if (String(ui.detailId || "") !== nextId) {
        syncDraftFromDom();
        ui.detailId = nextId;
        ui.conv = (runtime.userConversations || []).find((c) => String(c.id) === nextId) || null;
        ui.messages = new Map();
        ui.pending = new Map();
        ui.offerFormOpen = false;
        ui.delegationOpen = false;
        ui.composing = false;
        ui.armed = null;
        ui.msgTab = "all";
        ui.tab = "conversation";
        renderDetail();
        renderList();
        loadDetail(nextId);
      } else {
        renderDetail();
      }
    } else {
      closeDetail({ updateHash: false });
    }
  }

  function hide() {
    syncDraftFromDom();
    stopListPolling();
    stopDetailPolling();
  }

  function closeDetail({ updateHash = true } = {}) {
    syncDraftFromDom();
    stopDetailPolling();
    ui.detailId = null;
    ui.conv = null;
    ui.delegationOpen = false;
    ui.offerFormOpen = false;
    ui.composing = false;
    ui.messages = new Map();
    ui.pending = new Map();
    renderDetail();
    renderList();
    if (updateHash) setHash({ filter: ui.filter });
  }

  function setHash(target) {
    const next = dealsHash(target);
    if (location.hash !== next) history.pushState(null, "", next);
  }

  function openDeal(conversationId) {
    deps.setView("deals", { conversationId });
  }

  // ---------- 동작 ----------
  // 브라우저 모달(confirm) 대신 같은 버튼을 한 번 더 눌러 확정한다.
  // 확인 대기 상태는 DOM이 아니라 ui에 보관해 폴링으로 다시 그려도 유지된다.
  const ARM_MS = 12000;
  function armed(key, message) {
    const now = Date.now();
    if (ui.armed && ui.armed.key === key && now < ui.armed.until) {
      ui.armed = null;
      applyArmedState();
      return true;
    }
    ui.armed = { key, message, until: now + ARM_MS };
    applyArmedState();
    toast(message);
    setTimeout(() => {
      if (ui.armed && ui.armed.key === key && Date.now() >= ui.armed.until) {
        ui.armed = null;
        applyArmedState();
      }
    }, ARM_MS + 50);
    return false;
  }

  function applyArmedState() {
    const root = $("dealsDetail");
    if (!root) return;
    const active = ui.armed && Date.now() < ui.armed.until ? ui.armed : null;
    root.querySelectorAll("[data-arm-key]").forEach((btn) => {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      const on = Boolean(active && btn.dataset.armKey === active.key);
      btn.textContent = on ? "한 번 더 눌러 확인" : btn.dataset.label;
      btn.classList.toggle("is-armed", on);
    });
    const note = $("dealConfirmNote");
    if (note) {
      note.hidden = !active;
      note.textContent = active ? active.message : "";
    }
  }

  async function run(button, fn) {
    if (ui.busy) return;
    ui.busy = true;
    if (button) button.disabled = true;
    try {
      await fn();
    } finally {
      ui.busy = false;
      if (button && document.body.contains(button)) button.disabled = false;
    }
  }

  async function act(action, body, okMessage, button) {
    await run(button, async () => {
      try {
        const res = await post(action, { conversationId: ui.detailId, ...body });
        if (res?.conversation) patchConvFromResponse(res.conversation);
        await refreshDetailMeta(ui.detailId);
        renderDetail();
        renderList();
        deps.updateBadges?.();
        if (okMessage) toast(okMessage);
      } catch (error) {
        if (error?.code === "AUTH_CHANGED") return;
        toast(errorText(error, "요청을 처리하지 못했어요."));
        if (error?.code === "OFFER_VERSION_STALE") await refreshDetailMeta(ui.detailId);
      }
    });
  }

  async function sendHuman(text, button) {
    const body = String(text || "").trim();
    const targetId = ui.detailId;
    if (!body || !targetId) return;
    await run(button, async () => {
      try {
        const res = await post("send", { id: crypto.randomUUID(), conversationId: targetId, body });
        ui.drafts.delete(targetId);
        if (ui.detailId !== targetId) {
          if (res?.conversation) {
            const idx = (runtime.userConversations || []).findIndex((c) => String(c.id) === String(targetId));
            if (idx >= 0) runtime.userConversations.splice(idx, 1, { ...runtime.userConversations[idx], ...res.conversation });
          }
          renderList();
          return;
        }
        if (res?.message) ui.messages.set(res.message.seq, res.message);
        if (res?.conversation) patchConvFromResponse(res.conversation);
        else if (ui.conv && res?.message) {
          patchConvFromResponse({
            ...ui.conv,
            lastSeq: Math.max(Number(ui.conv.lastSeq) || 0, Number(res.message.seq) || 0),
            lastMessage: res.message,
            updatedAt: res.message.createdAt || new Date().toISOString(),
          });
        }
        const input = $("dealComposerInput");
        if (input) input.value = "";
        // 직접 답장했다는 것은 그 앞의 상대 메시지를 봤다는 뜻이므로 표시 중인 메시지까지 읽음 처리.
        for (const [seq, m] of ui.pending) ui.messages.set(seq, m);
        ui.pending = new Map();
        renderDetail();
        const log = $("dealMsgLog");
        if (log) log.scrollTop = log.scrollHeight;
        $("dealComposerInput")?.focus({ preventScroll: true });
        renderList();
        await markRead();
        toast(ui.conv && aiStatus(ui.conv, roleOf(ui.conv, meId())).key === "takeover"
          ? "직접 보냈어요. 다시 맡기기 전까지 농농이는 자동으로 보내지 않아요."
          : "메시지를 보냈어요.");
      } catch (error) {
        if (error?.code === "AUTH_CHANGED") return;
        toast(errorText(error, "메시지를 보내지 못했어요."));
      }
    });
  }

  function readPolicyForm() {
    const deal = detailDeal();
    const mode = document.querySelector('input[name="dealPolicyMode"]:checked')?.value || "off";
    const fee = $("dealPolicyFee")?.value ?? "";
    const policy = buildPolicyFromForm({
      targetPrice: $("dealPolicyTarget")?.value,
      limit: $("dealPolicyLimit")?.value,
      budgetUnit: $("dealPolicyUnit")?.value || "total",
      allowNegotiation: $("dealPolicyNegotiate")?.checked,
      autoExecuteTransaction: $("dealPolicyAutoApply")?.checked,
      fullDelegation: $("dealPolicyFull")?.checked,
      transportPayer: $("dealPolicyPayer")?.value || null,
      transportFee: fee,
      transportKnown: String(fee).trim() !== "",
      pickupPreference: $("dealPolicyPickup")?.value,
      requiredQuestions: $("dealPolicyQuestions")?.value,
    }, deal.myRole);
    return { mode, policy: { ...(deal.ai.policy || {}), ...policy } };
  }

  async function savePolicy(button) {
    const deal = detailDeal();
    const { mode, policy } = readPolicyForm();
    const errors = validatePolicy(policy, deal.myRole);
    if (errors.length) return toast(errors[0]);
    if (mode === "autonomous" && policy.fullDelegation && deal.myRole === "buyer" && policy.maxBudget == null) {
      toast("최대 예산이 없으면 금액이 필요한 순간마다 확인을 요청해요.");
    }
    await act("update_ai_policy", { mode, policy }, "위임 조건을 저장했어요.", button);
  }

  function readOfferForm() {
    const deal = detailDeal();
    const rent = deal.listingType === "rent";
    const start = rent ? $("dealOfferStart")?.value || null : null;
    const end = rent ? $("dealOfferEnd")?.value || start : null;
    if (rent && (!start || !end)) throw new Error("대여 시작일과 반납일을 입력해 주세요.");
    return buildOfferBody({
      conversationId: ui.detailId,
      amount: $("dealOfferAmount")?.value,
      amountUnit: rent ? $("dealOfferUnit")?.value : "total",
      start,
      end,
      days: rent ? rentalDays(start, end) : null,
      transportPayer: $("dealOfferPayer")?.value || null,
      transportFee: $("dealOfferFee")?.value,
      note: $("dealOfferNote")?.value,
      baseTermsVersion: deal.termsVersion,
    });
  }

  function bind() {
    const root = $("dealsView");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";

    root.addEventListener("click", (event) => {
      const t = event.target;
      const filterBtn = t.closest("[data-deals-filter]");
      if (filterBtn) {
        ui.filter = filterBtn.dataset.dealsFilter;
        try { localStorage.setItem("moa-deals-filter", ui.filter); } catch { /* 무시 */ }
        renderList();
        if (!ui.detailId) history.replaceState(null, "", dealsHash({ filter: ui.filter }));
        return;
      }
      const gotoBtn = t.closest("[data-deals-goto]");
      if (gotoBtn) return deps.setView(gotoBtn.dataset.dealsGoto);
      const approve = t.closest("[data-req-approve]");
      if (approve) return deps.handleRequestAction("approve", approve.dataset.reqApprove, approve).then(() => refreshDetailMeta(ui.detailId));
      const reject = t.closest("[data-req-reject]");
      if (reject) return deps.handleRequestAction("reject", reject.dataset.reqReject, reject).then(() => refreshDetailMeta(ui.detailId));
      const card = t.closest("[data-deal-open]");
      if (card) return openDeal(card.dataset.dealOpen);
      if (t.closest("[data-deal-back]")) return closeDetail();
      const tab = t.closest("[data-deal-tab]");
      if (tab) { ui.tab = tab.dataset.dealTab; return renderDetail(); }
      if (t.closest("[data-deal-delegation-toggle]")) {
        ui.delegationOpen = !ui.delegationOpen;
        renderDetail();
        if (ui.delegationOpen) {
          $("dealDelegationPanel")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
        }
        return;
      }
      if (t.closest("[data-deal-delegation-close]")) {
        ui.delegationOpen = false;
        renderDetail();
        return;
      }
      const msgTab = t.closest("[data-deal-msgtab]");
      if (msgTab) { ui.msgTab = msgTab.dataset.dealMsgtab; return renderDetail(); }
      if (t.closest("[data-deal-show-new]")) {
        for (const [seq, m] of ui.pending) ui.messages.set(seq, m);
        ui.pending = new Map();
        renderDetail();
        const log = $("dealMsgLog");
        if (log) log.scrollTop = log.scrollHeight;
        return markRead();
      }
      if (t.closest("[data-deal-composer-open]")) {
        ui.tab = "conversation";
        renderDetail();
        return $("dealComposerInput")?.focus();
      }
      const draftSend = t.closest("[data-deal-draft-send]");
      if (draftSend) {
        const deal = detailDeal();
        if (deal?.ai.draft) return sendHuman(deal.ai.draft.body, draftSend);
        return;
      }
      if (t.closest("[data-deal-draft-edit]")) {
        const deal = detailDeal();
        ui.tab = "conversation";
        if (ui.detailId && deal?.ai.draft) ui.drafts.set(ui.detailId, deal.ai.draft.body);
        renderDetail();
        return $("dealComposerInput")?.focus();
      }
      const dismiss = t.closest("[data-deal-draft-dismiss]");
      if (dismiss) return act("dismiss_ai_draft", {}, "초안을 닫았어요.", dismiss);
      const takeover = t.closest("[data-deal-takeover]");
      if (takeover) return act("takeover", {}, "직접 진행으로 바꿨어요. 다시 맡기기 전까지 농농이는 자동으로 보내지 않아요.", takeover);
      const resume = t.closest("[data-deal-resume]");
      if (resume) {
        const deal = detailDeal();
        const p = deal.ai.policy || {};
        const limit = deal.myRole === "buyer" ? p.maxBudget : p.minPrice;
        const summary = [
          p.targetPrice != null ? `${deal.myRole === "buyer" ? "목표" : "희망"} ${formatWon(p.targetPrice)}` : "목표가 없음",
          limit != null ? `${deal.myRole === "buyer" ? "상한" : "하한"} ${formatWon(limit)}` : "한도 없음(금액은 확인 요청)",
          p.autoExecuteTransaction && deal.myRole === "buyer" ? "합의 시 신청까지" : "신청은 직접",
        ].join(" · ");
        if (!armed("resume", `농농이가 다시 대신 답해요: ${summary}`)) return;
        return act("resume", {}, "농농이에게 다시 맡겼어요.", resume);
      }
      const retry = t.closest("[data-deal-retry]");
      if (retry) return act("retry_ai_job", { triggerSeq: ui.conv?.lastSeq }, "다시 시도를 요청했어요.", retry);
      if (t.closest("[data-deal-open-chat]")) {
        return deps.chatForm({ conversationId: ui.detailId, listingId: ui.conv?.listingId || null });
      }
      if (t.closest("[data-deal-offer-open]")) { ui.offerFormOpen = true; ui.tab = "progress"; renderDetail(); return $("dealOfferAmount")?.focus(); }
      if (t.closest("[data-deal-offer-cancel]")) { ui.offerFormOpen = false; return renderDetail(); }
      const accept = t.closest("[data-deal-accept]");
      if (accept) {
        const version = Number(accept.dataset.termsVersion) || 0;
        return act("accept_offer", { offerId: accept.dataset.dealAccept, version, termsVersion: version }, "이 조건에 수락했어요. 상대도 수락하면 합의돼요.", accept);
      }
      const rej = t.closest("[data-deal-reject]");
      if (rej) return act("reject_offer", { offerId: rej.dataset.dealReject }, "제안을 거절했어요.", rej);
      const apply = t.closest("[data-deal-apply]");
      if (apply) {
        if (!armed(`apply:${apply.dataset.dealApply}`, "합의된 조건 그대로 신청해요. 신청은 상대 승인 전이며 거래 완료가 아니에요.")) return;
        return act("apply_offer", { offerId: apply.dataset.dealApply }, "합의 조건으로 신청했어요. 상대 승인을 기다려요.", apply);
      }
    });

    root.addEventListener("input", (event) => {
      if (event.target?.id === "dealComposerInput" && ui.detailId) {
        const value = event.target.value;
        if (value) ui.drafts.set(ui.detailId, value);
        else ui.drafts.delete(ui.detailId);
      }
    });

    root.addEventListener("compositionstart", (event) => {
      if (event.target?.id === "dealComposerInput") ui.composing = true;
    });

    root.addEventListener("compositionend", (event) => {
      if (event.target?.id === "dealComposerInput") {
        ui.composing = false;
        syncDraftFromDom();
      }
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && ui.delegationOpen && $("dealsDetail")?.contains(event.target)) {
        event.preventDefault();
        ui.delegationOpen = false;
        renderDetail();
        root.querySelector("[data-deal-delegation-toggle]")?.focus();
        return;
      }
      if (event.target?.id === "dealComposerInput") {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !ui.composing) {
          event.preventDefault();
          const submitter = $("dealComposer")?.querySelector('[type="submit"]');
          sendHuman(event.target.value, submitter);
        }
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest?.("[data-deal-open]");
      if (card && event.target === card) {
        event.preventDefault();
        openDeal(card.dataset.dealOpen);
      }
    });

    root.addEventListener("submit", (event) => {
      const form = event.target;
      event.preventDefault();
      const submitter = event.submitter || form.querySelector('[type="submit"]');
      if (form.id === "dealComposer") return sendHuman($("dealComposerInput")?.value, submitter);
      if (form.id === "dealPolicyForm") return savePolicy(submitter);
      if (form.id === "dealOfferForm") {
        let body;
        try { body = readOfferForm(); } catch (error) { return toast(error.message); }
        return run(submitter, async () => {
          try {
            const res = await post("submit_offer", body);
            if (res?.conversation) patchConvFromResponse(res.conversation);
            ui.offerFormOpen = false;
            await refreshDetailMeta(ui.detailId);
            renderDetail();
            renderList();
            toast("제안을 보냈어요. 상대가 같은 조건에 수락하면 합의돼요.");
          } catch (error) {
            if (error?.code === "AUTH_CHANGED") return;
            toast(errorText(error, "제안을 보내지 못했어요."));
          }
        });
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && isActive() && ui.detailId) pollDetail();
    });
  }

  // ---------- 판매자 매물 단위 수신 위임 ----------
  async function openInboundPolicy(listing) {
    if (!listing) return;
    if (!isLoggedIn()) return deps.savePendingIntentAndRedirectLogin({ type: "inbound", listingId: listing.id });
    stopChatPolling();
    const rent = listing.type === "rent";
    $("formContent").innerHTML = `
      <span class="step-pill">내 매물 · 들어오는 문의 맡기기</span>
      <h2 id="formTitle">${escapeHtml(listing.title)}</h2>
      <p>새로 들어오는 문의부터 농농이가 ${rent ? "빌려주는 분" : "판매자"} 입장에서 아래 조건 안에서 답해요. 이미 진행 중인 대화는 각 거래의 ‘조건’에서 바꿀 수 있어요.</p>
      <div id="inboundPolicyBody" class="deal-loading">설정을 불러오는 중…</div>`;
    showDialog($("formBackdrop"));
    let current = null;
    try {
      const data = await apiFetch(`/api/conversations?mode=inbound_policy&listingId=${encodeURIComponent(listing.id)}`);
      current = data?.inboundPolicy || null;
    } catch (error) {
      if (error?.code === "AUTH_CHANGED") return;
      $("inboundPolicyBody").innerHTML = `<div class="empty-panel">${escapeHtml(errorText(error, "설정을 불러오지 못했어요."))}</div>`;
      return;
    }
    const p = current?.policy || {};
    const mode = current?.mode || "off";
    $("inboundPolicyBody").className = "";
    $("inboundPolicyBody").innerHTML = `<form id="inboundPolicyForm" class="deal-policy-form">
      <fieldset class="deal-mode-group"><legend>새 문의 응대</legend>
        ${[["off", "끄기", "내가 직접 답해요"], ["copilot", "초안만", "답장 초안만 만들어 둬요"], ["autonomous", "자동 응대·협상", "아래 조건 안에서 대신 답해요"]]
          .map(([v, l, d]) => `<label class="deal-mode-option"><input type="radio" name="inboundMode" value="${v}"${mode === v ? " checked" : ""}><span><b>${l}</b><small>${d}</small></span></label>`).join("")}
      </fieldset>
      <div class="deal-form-grid">
        ${rent ? `<label>금액 기준<select id="inboundUnit"><option value="daily"${p.budgetUnit !== "total" ? " selected" : ""}>하루 대여료</option><option value="total"${p.budgetUnit === "total" ? " selected" : ""}>기간 총액</option></select></label>` : ""}
        <label>희망가(원)<input id="inboundTarget" type="number" min="0" step="any" inputmode="numeric" value="${p.targetPrice ?? ""}" placeholder="현재 등록가 ${escapeHtml(formatWon(listing.price))}"></label>
        <label>최저 허용가(원)<input id="inboundLimit" type="number" min="0" step="any" inputmode="numeric" value="${p.minPrice ?? ""}" placeholder="비우면 할인 요청은 내게 확인"></label>
        <label>운송<select id="inboundPayer">
          <option value=""${!p.transportPayer ? " selected" : ""}>미정(문의 시 내게 확인)</option>
          <option value="none"${p.transportPayer === "none" ? " selected" : ""}>운송 없음(직접 인수)</option>
          <option value="owner"${p.transportPayer === "owner" ? " selected" : ""}>내가 부담</option>
          <option value="buyer"${p.transportPayer === "buyer" ? " selected" : ""}>${rent ? "빌리는 분" : "구매자"} 부담</option>
        </select></label>
        <label>운송비(원)<input id="inboundFee" type="number" min="0" step="any" inputmode="numeric" value="${p.transportFee != null && p.transportPayer !== "none" ? p.transportFee : ""}" placeholder="모르면 비움"></label>
        <label class="deal-form-wide">인수 조건<input id="inboundPickup" type="text" maxlength="120" value="${escapeHtml(p.pickupPreference || "")}" placeholder="예: 평일 오후 6시 이후 직접 인수"></label>
        <label class="deal-form-wide">문의자에게 확인할 질문(한 줄에 하나)<textarea id="inboundQuestions" rows="3" maxlength="600">${escapeHtml(Array.isArray(p.requiredQuestions) ? p.requiredQuestions.join("\n") : "")}</textarea></label>
        <label class="deal-form-wide">알려진 상태·주의사항(농농이가 이 내용 밖의 사실은 지어내지 않고 내게 확인해요)<textarea id="inboundNotes" rows="3" maxlength="300">${escapeHtml(p.instructions || "")}</textarea></label>
      </div>
      <label class="deal-check"><input type="checkbox" id="inboundNegotiate"${p.allowNegotiation ? " checked" : ""}> 최저 허용가 안에서 가격 협상 허용</label>
      <p class="deal-hint">판매자 쪽 농농이는 구매자 명의로 신청하지 않고, 신청 승인은 항상 직접 해요. 최저 허용가는 상대에게 공개되지 않아요.</p>
      ${current?.updatedAt ? `<p class="deal-hint">마지막 저장: ${escapeHtml(clock(current.updatedAt))} · 버전 ${escapeHtml(current.policyVersion ?? "")}</p>` : ""}
      <div class="deal-form-actions"><button type="submit" class="button button-primary">저장</button></div>
    </form>`;
    $("inboundPolicyForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = event.submitter;
      const modeVal = document.querySelector('input[name="inboundMode"]:checked')?.value || "off";
      const fee = $("inboundFee").value;
      const policy = {
        ...p,
        ...buildPolicyFromForm({
          targetPrice: $("inboundTarget").value,
          limit: $("inboundLimit").value,
          budgetUnit: $("inboundUnit")?.value || "total",
          allowNegotiation: $("inboundNegotiate").checked,
          transportPayer: $("inboundPayer").value || null,
          transportFee: fee,
          transportKnown: String(fee).trim() !== "",
          pickupPreference: $("inboundPickup").value,
          requiredQuestions: $("inboundQuestions").value,
          fullDelegation: false,
        }, "owner"),
        instructions: $("inboundNotes").value.trim().slice(0, 300),
      };
      const errors = validatePolicy(policy, "owner");
      if (errors.length) return toast(errors[0]);
      if (btn) btn.disabled = true;
      try {
        await apiFetch("/api/conversations", { method: "POST", json: { action: "set_inbound_policy", listingId: listing.id, mode: modeVal, policy } });
        toast(modeVal === "off" ? "새 문의 자동응대를 껐어요." : "저장했어요. 새로 들어오는 문의부터 적용돼요.");
        deps.closeForm?.();
      } catch (error) {
        if (error?.code === "AUTH_CHANGED") return;
        toast(errorText(error, "저장하지 못했어요."));
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  return {
    bind,
    show,
    hide,
    renderList,
    openDeal,
    badgeCounts,
    onConversationRead,
    openInboundPolicy,
    isDetailOpen: () => Boolean(ui.detailId),
    _ui: ui,
  };
}

export { roleLabel, counterpartLabel, normalizeOffer };
