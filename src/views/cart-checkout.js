import {
  $, escapeHtml, money, today, addDays, toast, showDialog, hideDialog,
  getListingPhotoSrc, machineImage,
} from "../core/utils.js";
import { state, runtime, apiFetch, listingById, isLoggedIn } from "../core/store.js";
import { MACHINE_BY_ID } from "../data/farm-machines.js";

const LOCAL_CART_KEY = "moa-cart-v1";
const LOCAL_ORDERS_KEY = "moa-orders-v1";

const PAYMENT_METHODS = [
  { id: "card", label: "카드결제", desc: "신용·체크카드 즉시 결제" },
  { id: "bank_transfer", label: "계좌이체", desc: "실시간 계좌이체·무통장" },
  { id: "easy_pay", label: "간편결제", desc: "카카오·네이버·토스페이" },
];

const PAYMENT_LABEL = {
  card: "카드결제",
  bank_transfer: "계좌이체",
  easy_pay: "간편결제",
};

const DELIVERY_LABEL = {
  pickup: "직접 방문 수령",
  delivery: "배달 요청",
};

function diffDaysInclusive(startIso, endIso) {
  if (!startIso) return 1;
  const s = new Date(`${startIso}T12:00:00+09:00`);
  const e = new Date(`${(endIso && endIso >= startIso ? endIso : startIso)}T12:00:00+09:00`);
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return Number.isFinite(diff) && diff >= 1 ? Math.min(diff, 365) : 1;
}

function readLocalJson(key, fallback) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

function resolveListing(listingOrId) {
  if (!listingOrId) return null;
  if (typeof listingOrId === "string") return listingById(listingOrId) || null;
  if (typeof listingOrId === "object" && listingOrId.id) {
    return listingById(listingOrId.id) || listingOrId;
  }
  return null;
}

function normalizeCartItem(raw, fallbackListing = null) {
  const listing = fallbackListing || listingById(raw?.listingId || raw?.id) || null;
  const type = raw?.type || listing?.type || "rent";
  const unitPrice = Number(raw?.unitPrice ?? listing?.price ?? 0) || 0;
  const startDate = type === "rent" ? (raw?.startDate || state.filters.date || today()) : "";
  const endDate = type === "rent"
    ? (raw?.endDate && raw.endDate >= startDate ? raw.endDate : addDays(startDate, Math.max(0, (Number(raw?.days) || 1) - 1)))
    : "";
  const days = type === "rent" ? (Number(raw?.days) || diffDaysInclusive(startDate, endDate)) : 1;
  const quantity = type === "rent" ? 1 : Math.max(1, Number(raw?.quantity) || 1);
  const subtotal = Number(raw?.subtotal) || (type === "rent" ? unitPrice * days : unitPrice * quantity);
  const photoUrl = raw?.photoUrl || (listing ? getListingPhotoSrc(listing) : "") || "";
  const machineType = raw?.machineType || listing?.machineType || "tractor";

  return {
    id: String(raw?.id || `local-${raw?.listingId || listing?.id || Date.now()}-${type}`),
    listingId: String(raw?.listingId || listing?.id || ""),
    type,
    title: raw?.title || listing?.title || "농기계 매물",
    brand: raw?.brand || listing?.brand || "",
    region: raw?.region || listing?.region || "",
    machineType,
    photoUrl,
    unitPrice,
    quantity,
    startDate,
    endDate,
    days,
    subtotal,
  };
}

function itemThumbnailHtml(item) {
  if (item.photoUrl) {
    return `<img src="${escapeHtml(item.photoUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" />`;
  }
  const typeObj = MACHINE_BY_ID[item.machineType];
  return `<img src="${escapeHtml(machineImage(typeObj || item.machineType))}" alt="${escapeHtml(item.title)}" loading="lazy" />`;
}

let activeController = null;

export function createCartCheckout(deps = {}) {
  let cartItems = [];
  let selectedIds = new Set();
  let drawerTab = "cart"; // "cart" | "orders"
  let recentOrders = [];
  let checkoutContext = null; // { items, fromCart }
  let isSubmittingOrder = false;

  function computeBadgeCount() {
    return cartItems.reduce((sum, item) => sum + (item.type === "sale" ? (item.quantity || 1) : 1), 0);
  }

  function updateCartBadge() {
    const badge = $("headerCartBadge");
    if (!badge) return;
    const count = computeBadgeCount();
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
    $("headerCartButton")?.setAttribute(
      "aria-label",
      count > 0 ? `장바구니 (${count}개 담김)` : "장바구니"
    );
  }

  function syncSelectionWithItems(selectNew = false) {
    const validIds = new Set(cartItems.map((item) => item.id));
    for (const id of [...selectedIds]) {
      if (!validIds.has(id)) selectedIds.delete(id);
    }
    if (selectNew || selectedIds.size === 0) {
      cartItems.forEach((item) => selectedIds.add(item.id));
    }
  }

  function saveLocalCart() {
    writeLocalJson(LOCAL_CART_KEY, cartItems);
  }

  async function loadCart({ quiet = true } = {}) {
    if (!isLoggedIn()) {
      const local = readLocalJson(LOCAL_CART_KEY, []);
      cartItems = local.map((item) => normalizeCartItem(item));
      syncSelectionWithItems(true);
      updateCartBadge();
      if (!$("cartBackdrop")?.hidden) renderCartDrawer();
      return cartItems;
    }

    try {
      const res = await apiFetch("/api/cart", { timeoutMs: 8000 });
      cartItems = Array.isArray(res?.items) ? res.items.map((item) => normalizeCartItem(item)) : [];
      syncSelectionWithItems(true);
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return cartItems;
      if (!quiet) console.error("loadCart failed", error);
      const local = readLocalJson(LOCAL_CART_KEY, []);
      cartItems = local.map((item) => normalizeCartItem(item));
      syncSelectionWithItems(true);
    }
    updateCartBadge();
    if (!$("cartBackdrop")?.hidden) renderCartDrawer();
    return cartItems;
  }

  async function syncGuestCartOnLogin() {
    if (!isLoggedIn()) return loadCart();
    const localItems = readLocalJson(LOCAL_CART_KEY, []);
    if (!localItems.length) return loadCart();

    try {
      const payloadItems = localItems
        .filter((item) => item?.listingId)
        .map((item) => ({
          listingId: item.listingId,
          ...(item.startDate ? { startDate: item.startDate } : {}),
          ...(item.endDate ? { endDate: item.endDate } : {}),
          ...(item.days ? { days: item.days } : {}),
          ...(item.quantity ? { quantity: item.quantity } : {}),
        }));
      if (payloadItems.length) {
        const res = await apiFetch("/api/cart", {
          method: "POST",
          json: { action: "sync", items: payloadItems },
        });
        writeLocalJson(LOCAL_CART_KEY, []);
        cartItems = Array.isArray(res?.items) ? res.items.map((item) => normalizeCartItem(item)) : [];
        syncSelectionWithItems(true);
        updateCartBadge();
        if (!$("cartBackdrop")?.hidden) renderCartDrawer();
        return cartItems;
      }
    } catch (error) {
      if (error?.name !== "AbortError" && error?.code !== "AUTH_CHANGED") {
        console.error("syncGuestCartOnLogin failed", error);
      }
    }
    return loadCart();
  }

  async function addToCart(listingOrId, options = {}) {
    const listing = resolveListing(listingOrId);
    if (!listing) {
      toast("매물 정보를 찾을 수 없습니다.");
      return null;
    }

    const type = listing.type === "sale" ? "sale" : "rent";
    const startDate = type === "rent" ? (options.startDate || state.filters.date || today()) : "";
    const endDate = type === "rent"
      ? (options.endDate || (state.filters.dateEnd && state.filters.dateEnd >= startDate ? state.filters.dateEnd : addDays(startDate, 1)))
      : "";
    const days = type === "rent" ? diffDaysInclusive(startDate, endDate) : 1;
    const quantity = type === "rent" ? 1 : Math.max(1, Number(options.quantity) || 1);

    let addedItem = null;

    if (isLoggedIn()) {
      try {
        const res = await apiFetch("/api/cart", {
          method: "POST",
          json: {
            action: "add",
            listingId: listing.id,
            ...(type === "rent" ? { startDate, endDate, days } : { quantity }),
          },
        });
        if (Array.isArray(res?.items)) {
          cartItems = res.items.map((item) => normalizeCartItem(item));
          addedItem = res.item ? normalizeCartItem(res.item, listing) : cartItems.find((i) => i.listingId === listing.id);
          if (addedItem) selectedIds.add(addedItem.id);
        }
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") return null;
        // Fallback to local cart if server fails
        addedItem = upsertLocalCartItem(listing, { type, startDate, endDate, days, quantity });
      }
    } else {
      addedItem = upsertLocalCartItem(listing, { type, startDate, endDate, days, quantity });
    }

    updateCartBadge();
    if (!$("cartBackdrop")?.hidden) renderCartDrawer();
    if (!options.silent) {
      toast(`'${listing.title}'을(를) 장바구니에 담았습니다.`);
    }
    if (options.openCart) {
      openCart();
    }
    return addedItem;
  }

  function upsertLocalCartItem(listing, { type, startDate, endDate, days, quantity }) {
    const existingIdx = cartItems.findIndex((item) => item.listingId === listing.id);
    const nextQty = type === "sale" && existingIdx >= 0
      ? (cartItems[existingIdx].quantity || 1) + quantity
      : quantity;
    const normalized = normalizeCartItem({
      id: existingIdx >= 0 ? cartItems[existingIdx].id : `local-${listing.id}`,
      listingId: listing.id,
      type,
      title: listing.title,
      brand: listing.brand,
      region: listing.region,
      machineType: listing.machineType,
      photoUrl: getListingPhotoSrc(listing),
      unitPrice: Number(listing.price) || 0,
      startDate,
      endDate,
      days,
      quantity: nextQty,
      subtotal: (Number(listing.price) || 0) * (type === "rent" ? days : nextQty),
    }, listing);

    if (existingIdx >= 0) {
      cartItems[existingIdx] = normalized;
    } else {
      cartItems.unshift(normalized);
    }
    selectedIds.add(normalized.id);
    saveLocalCart();
    return normalized;
  }

  async function updateCartItem(itemId, patch) {
    const idx = cartItems.findIndex((item) => item.id === itemId);
    if (idx < 0) return;
    const current = cartItems[idx];
    const nextStart = patch.startDate !== undefined ? patch.startDate : current.startDate;
    let nextEnd = patch.endDate !== undefined ? patch.endDate : current.endDate;
    if (current.type === "rent" && nextStart && (!nextEnd || nextEnd < nextStart)) {
      nextEnd = nextStart;
    }
    const nextDays = current.type === "rent" ? diffDaysInclusive(nextStart, nextEnd) : 1;
    const nextQty = current.type === "sale"
      ? Math.max(1, Math.min(99, Number(patch.quantity ?? current.quantity) || 1))
      : 1;

    const updated = normalizeCartItem({
      ...current,
      startDate: nextStart,
      endDate: nextEnd,
      days: nextDays,
      quantity: nextQty,
      subtotal: current.unitPrice * (current.type === "rent" ? nextDays : nextQty),
    });
    cartItems[idx] = updated;

    if (isLoggedIn()) {
      try {
        const res = await apiFetch("/api/cart", {
          method: "POST",
          json: {
            action: "add",
            listingId: current.listingId,
            ...(current.type === "rent" ? { startDate: nextStart, endDate: nextEnd, days: nextDays } : { quantity: nextQty }),
          },
        });
        if (Array.isArray(res?.items)) {
          cartItems = res.items.map((item) => normalizeCartItem(item));
        }
      } catch {
        saveLocalCart();
      }
    } else {
      saveLocalCart();
    }

    updateCartBadge();
    renderCartDrawer();
  }

  async function removeCartItem(itemId) {
    const target = cartItems.find((item) => item.id === itemId);
    if (!target) return;
    cartItems = cartItems.filter((item) => item.id !== itemId);
    selectedIds.delete(itemId);

    if (isLoggedIn()) {
      try {
        const res = await apiFetch("/api/cart", {
          method: "POST",
          json: { action: "remove", id: target.id, listingId: target.listingId },
        });
        if (Array.isArray(res?.items)) {
          cartItems = res.items.map((item) => normalizeCartItem(item));
        }
      } catch {
        saveLocalCart();
      }
    } else {
      saveLocalCart();
    }

    updateCartBadge();
    renderCartDrawer();
    toast("장바구니에서 삭제했습니다.");
  }

  async function clearCart() {
    cartItems = [];
    selectedIds.clear();
    if (isLoggedIn()) {
      try {
        await apiFetch("/api/cart", { method: "POST", json: { action: "clear" } });
      } catch {
        // ignore
      }
    }
    saveLocalCart();
    updateCartBadge();
    renderCartDrawer();
    toast("장바구니를 비웠습니다.");
  }

  async function loadRecentOrders() {
    const localOrders = readLocalJson(LOCAL_ORDERS_KEY, []);
    if (!isLoggedIn()) {
      recentOrders = localOrders;
      return recentOrders;
    }
    try {
      const res = await apiFetch("/api/orders", { timeoutMs: 8000 });
      const serverOrders = Array.isArray(res?.orders) ? res.orders : [];
      recentOrders = serverOrders;
    } catch {
      recentOrders = localOrders;
    }
    return recentOrders;
  }

  function renderCartDrawer() {
    const body = $("cartDrawerBody");
    const footer = $("cartDrawerFooter");
    const sub = $("cartDrawerSub");
    if (!body || !footer) return;

    const totalCount = computeBadgeCount();
    if (sub) {
      sub.textContent = drawerTab === "orders"
        ? "최근 완료된 농기계 결제 내역이에요."
        : totalCount > 0
          ? `총 ${totalCount}개 매물이 담겨 있어요.`
          : "담은 농기계를 확인하고 한 번에 결제하세요.";
    }

    const tabHtml = `
      <div class="cart-tabs" role="tablist" aria-label="장바구니 탭">
        <button type="button" role="tab" class="cart-tab${drawerTab === "cart" ? " is-active" : ""}" data-cart-tab="cart" aria-selected="${drawerTab === "cart"}">
          장바구니 (${totalCount})
        </button>
        <button type="button" role="tab" class="cart-tab${drawerTab === "orders" ? " is-active" : ""}" data-cart-tab="orders" aria-selected="${drawerTab === "orders"}">
          결제 내역
        </button>
      </div>
    `;

    if (drawerTab === "orders") {
      if (!recentOrders.length) {
        body.innerHTML = `${tabHtml}
          <div class="cart-empty">
            <div class="cart-empty-icon" aria-hidden="true">🧾</div>
            <strong>아직 결제 내역이 없어요</strong>
            <p>장바구니에 농기계를 담고 결제를 완료하면 여기에 영수증이 보관돼요.</p>
            <button type="button" class="button button-primary button-sm" data-cart-tab="cart">장바구니로 돌아가기</button>
          </div>
        `;
      } else {
        body.innerHTML = `${tabHtml}
          <div class="cart-orders-list">
            ${recentOrders.map((order) => {
              const items = Array.isArray(order.items) ? order.items : [];
              const firstTitle = items[0]?.title || "농기계 주문";
              const summaryTitle = items.length > 1 ? `${firstTitle} 외 ${items.length - 1}건` : firstTitle;
              const dateText = order.paidAt || order.createdAt
                ? new Date(order.paidAt || order.createdAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                : "";
              return `
                <article class="cart-order-card">
                  <div class="cart-order-top">
                    <span class="cart-order-num">${escapeHtml(order.orderNumber || order.id || "")}</span>
                    <span class="cart-order-status is-${escapeHtml(order.status || "paid")}">${order.status === "cancelled" ? "취소됨" : "결제 완료"}</span>
                  </div>
                  <strong class="cart-order-title">${escapeHtml(summaryTitle)}</strong>
                  <div class="cart-order-meta">
                    <span>${escapeHtml(PAYMENT_LABEL[order.paymentMethod] || "카드결제")}</span>
                    <span>·</span>
                    <span>${escapeHtml(DELIVERY_LABEL[order.deliveryMethod] || "직접 방문 수령")}</span>
                    ${dateText ? `<span>·</span><span>${escapeHtml(dateText)}</span>` : ""}
                  </div>
                  <div class="cart-order-bottom">
                    <strong>${money(order.totalAmount || 0)}</strong>
                    ${order.localOnly ? `<span class="cart-order-local-tag">임시 보관</span>` : ""}
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        `;
      }
      footer.innerHTML = `
        <button type="button" class="button button-secondary cart-full-btn" data-cart-tab="cart">장바구니 보기</button>
      `;
      return;
    }

    if (!cartItems.length) {
      body.innerHTML = `${tabHtml}
        <div class="cart-empty">
          <div class="cart-empty-icon" aria-hidden="true">🛒</div>
          <strong>장바구니가 비어 있어요</strong>
          <p>필요한 농기계를 장바구니에 담고 한 번에 대여·구매 결제를 진행해 보세요.</p>
          <button type="button" class="button button-primary button-sm" id="cartGoBrowseBtn">매물 찾으러 가기</button>
        </div>
      `;
      footer.innerHTML = "";
      return;
    }

    const allSelected = cartItems.length > 0 && cartItems.every((item) => selectedIds.has(item.id));
    const selectedItems = cartItems.filter((item) => selectedIds.has(item.id));
    const selectedTotal = selectedItems.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);

    body.innerHTML = `${tabHtml}
      <div class="cart-select-bar">
        <label class="cart-check-label">
          <input type="checkbox" id="cartSelectAll" ${allSelected ? "checked" : ""} />
          <span>전체 선택 (${selectedItems.length}/${cartItems.length})</span>
        </label>
        <button type="button" class="cart-text-btn" id="cartClearBtn">전체 비우기</button>
      </div>
      <ul class="cart-item-list">
        ${cartItems.map((item) => {
          const checked = selectedIds.has(item.id);
          const isRent = item.type === "rent";
          return `
            <li class="cart-item${checked ? " is-selected" : ""}" data-cart-item-id="${escapeHtml(item.id)}">
              <label class="cart-item-check" aria-label="${escapeHtml(item.title)} 선택">
                <input type="checkbox" data-cart-select="${escapeHtml(item.id)}" ${checked ? "checked" : ""} />
              </label>
              <div class="cart-item-thumb">${itemThumbnailHtml(item)}</div>
              <div class="cart-item-info">
                <div class="cart-item-head">
                  <span class="cart-type-badge is-${isRent ? "rent" : "sale"}">${isRent ? "일일 대여" : "중고 구매"}</span>
                  <button type="button" class="cart-remove-btn" data-cart-remove="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 삭제">삭제</button>
                </div>
                <strong class="cart-item-title">${escapeHtml(item.title)}</strong>
                <div class="cart-item-meta">${escapeHtml([item.brand, item.region].filter(Boolean).join(" · "))}</div>
                ${isRent ? `
                  <div class="cart-date-row">
                    <label>
                      <span>대여일</span>
                      <input type="date" value="${escapeHtml(item.startDate)}" min="${escapeHtml(today())}" data-cart-start="${escapeHtml(item.id)}" />
                    </label>
                    <span class="cart-date-sep">~</span>
                    <label>
                      <span>반납일</span>
                      <input type="date" value="${escapeHtml(item.endDate)}" min="${escapeHtml(item.startDate || today())}" data-cart-end="${escapeHtml(item.id)}" />
                    </label>
                  </div>
                  <div class="cart-item-price-row">
                    <span class="cart-unit-calc">${money(item.unitPrice)} × ${item.days}일</span>
                    <strong class="cart-item-subtotal">${money(item.subtotal)}</strong>
                  </div>
                ` : `
                  <div class="cart-item-price-row">
                    <div class="cart-qty-control" role="group" aria-label="수량 조절">
                      <button type="button" data-cart-qty-delta="-1" data-cart-id="${escapeHtml(item.id)}" aria-label="수량 감소">−</button>
                      <span>${item.quantity}</span>
                      <button type="button" data-cart-qty-delta="1" data-cart-id="${escapeHtml(item.id)}" aria-label="수량 증가">+</button>
                    </div>
                    <strong class="cart-item-subtotal">${money(item.subtotal)}</strong>
                  </div>
                `}
              </div>
            </li>
          `;
        }).join("")}
      </ul>
    `;

    footer.innerHTML = `
      <div class="cart-summary-row">
        <span>선택 상품 (${selectedItems.length}건)</span>
        <strong class="cart-total-amount">${money(selectedTotal)}</strong>
      </div>
      <button type="button" class="button button-primary cart-checkout-btn" id="cartCheckoutBtn" ${selectedItems.length === 0 ? "disabled" : ""}>
        ${selectedItems.length > 0 ? `${money(selectedTotal)} 결제하기` : "결제할 상품을 선택하세요"}
      </button>
    `;
  }

  function openCart({ tab = "cart" } = {}) {
    drawerTab = tab;
    const backdrop = $("cartBackdrop");
    if (!backdrop) return;
    if (tab === "orders") {
      loadRecentOrders().then(() => renderCartDrawer());
    } else {
      renderCartDrawer();
    }
    showDialog(backdrop);
  }

  function closeCart() {
    const backdrop = $("cartBackdrop");
    if (backdrop && !backdrop.hidden) hideDialog(backdrop);
  }

  function openCheckout(target = null, options = {}) {
    let items = [];
    let fromCart = false;

    if (!target) {
      items = cartItems.filter((item) => selectedIds.has(item.id));
      fromCart = true;
    } else if (Array.isArray(target)) {
      items = target.map((item) => normalizeCartItem(item));
      fromCart = Boolean(options.fromCart);
    } else {
      const listing = resolveListing(target);
      if (!listing) {
        toast("결제할 매물 정보를 찾을 수 없습니다.");
        return;
      }
      const type = listing.type === "sale" ? "sale" : "rent";
      const startDate = type === "rent" ? (options.startDate || state.filters.date || today()) : "";
      const endDate = type === "rent"
        ? (options.endDate || (state.filters.dateEnd && state.filters.dateEnd >= startDate ? state.filters.dateEnd : addDays(startDate, 1)))
        : "";
      const days = type === "rent" ? diffDaysInclusive(startDate, endDate) : 1;
      const quantity = type === "rent" ? 1 : Math.max(1, Number(options.quantity) || 1);
      items = [normalizeCartItem({
        id: `direct-${listing.id}`,
        listingId: listing.id,
        type,
        startDate,
        endDate,
        days,
        quantity,
      }, listing)];
      fromCart = false;
    }

    if (!items.length) {
      toast("결제할 매물을 먼저 선택해 주세요.");
      return;
    }

    closeCart();
    checkoutContext = { items, fromCart };
    renderCheckoutForm();
    const backdrop = $("checkoutBackdrop");
    if (backdrop) showDialog(backdrop);
  }

  function closeCheckout() {
    const backdrop = $("checkoutBackdrop");
    if (backdrop && !backdrop.hidden) hideDialog(backdrop);
  }

  function renderCheckoutForm() {
    const body = $("checkoutBody");
    if (!body || !checkoutContext) return;
    const { items } = checkoutContext;
    const totalAmount = items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
    const defaultName = runtime.accountUser?.name || "";
    const defaultAddress = state.region || "";

    body.innerHTML = `
      <form id="checkoutForm" class="checkout-form" novalidate>
        ${!isLoggedIn() ? `
          <div class="checkout-guest-notice">
            <span>비로그인 상태에서도 결제를 체험할 수 있어요. 로그인하면 결제 내역이 계정에 안전하게 저장돼요.</span>
          </div>
        ` : ""}

        <section class="checkout-section">
          <h3>주문 농기계 (${items.length}건)</h3>
          <ul class="checkout-item-list">
            ${items.map((item) => `
              <li class="checkout-item">
                <div class="checkout-item-thumb">${itemThumbnailHtml(item)}</div>
                <div class="checkout-item-info">
                  <div class="checkout-item-top">
                    <span class="cart-type-badge is-${item.type === "rent" ? "rent" : "sale"}">${item.type === "rent" ? "일일 대여" : "중고 구매"}</span>
                    <strong>${escapeHtml(item.title)}</strong>
                  </div>
                  <p class="checkout-item-sub">
                    ${item.type === "rent"
                      ? `대여 기간: ${escapeHtml(item.startDate)} ~ ${escapeHtml(item.endDate)} (${item.days}일)`
                      : `수량: ${item.quantity}대`}
                    ${item.region ? ` · ${escapeHtml(item.region)}` : ""}
                  </p>
                </div>
                <strong class="checkout-item-price">${money(item.subtotal)}</strong>
              </li>
            `).join("")}
          </ul>
        </section>

        <section class="checkout-section">
          <h3>주문자 및 수령 정보</h3>
          <div class="checkout-grid-2">
            <label class="checkout-field">
              <span>주문자 이름 <em>*</em></span>
              <input type="text" id="checkoutBuyerName" name="buyerName" required maxlength="40" placeholder="예: 홍길동" value="${escapeHtml(defaultName)}" />
            </label>
            <label class="checkout-field">
              <span>연락처 <em>*</em></span>
              <input type="tel" id="checkoutBuyerPhone" name="buyerPhone" required maxlength="20" placeholder="예: 010-1234-5678" />
            </label>
          </div>

          <div class="checkout-field">
            <span>수령 방식</span>
            <div class="checkout-radio-row" role="radiogroup" aria-label="수령 방식">
              <label class="checkout-radio-pill">
                <input type="radio" name="deliveryMethod" value="pickup" checked />
                <span>직접 방문 수령</span>
              </label>
              <label class="checkout-radio-pill">
                <input type="radio" name="deliveryMethod" value="delivery" />
                <span>배달 요청 (농가·밭)</span>
              </label>
            </div>
          </div>

          <label class="checkout-field" id="checkoutAddressField" hidden>
            <span>배달 주소 <em>*</em></span>
            <input type="text" id="checkoutAddress" name="deliveryAddress" maxlength="160" placeholder="예: 강원특별자치도 홍천군 서면 팔봉리 123" value="${escapeHtml(defaultAddress)}" />
          </label>

          <label class="checkout-field">
            <span>요청 사항 (선택)</span>
            <input type="text" id="checkoutNote" name="note" maxlength="200" placeholder="예: 오전 9시쯤 방문 예정입니다 / 부착 작업기 확인 부탁드려요" />
          </label>
        </section>

        <section class="checkout-section">
          <h3>결제 수단</h3>
          <div class="checkout-payment-grid" role="radiogroup" aria-label="결제 수단">
            ${PAYMENT_METHODS.map((m, idx) => `
              <label class="checkout-pay-card">
                <input type="radio" name="paymentMethod" value="${m.id}" ${idx === 0 ? "checked" : ""} />
                <span class="checkout-pay-card-body">
                  <strong>${m.label}</strong>
                  <small>${m.desc}</small>
                </span>
              </label>
            `).join("")}
          </div>
        </section>

        <section class="checkout-summary-box">
          <div class="checkout-summary-line">
            <span>상품 금액</span>
            <span>${money(totalAmount)}</span>
          </div>
          <div class="checkout-summary-line">
            <span>수수료</span>
            <span>0원 (무료)</span>
          </div>
          <div class="checkout-summary-total">
            <strong>총 결제 금액</strong>
            <strong>${money(totalAmount)}</strong>
          </div>
        </section>

        <label class="checkout-agree">
          <input type="checkbox" id="checkoutAgree" required />
          <span>주문 상품 정보, 대여·구매 조건 및 결제 진행에 동의합니다. (필수)</span>
        </label>

        <p id="checkoutError" class="checkout-error" role="alert" hidden></p>

        <div class="checkout-actions">
          <button type="button" class="button button-secondary" id="checkoutCancelBtn">취소</button>
          <button type="submit" class="button button-primary button-large" id="checkoutSubmitBtn">
            ${money(totalAmount)} 결제하기
          </button>
        </div>
      </form>
    `;

    const form = $("checkoutForm");
    const addressField = $("checkoutAddressField");
    form?.querySelectorAll('input[name="deliveryMethod"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const isDelivery = form.querySelector('input[name="deliveryMethod"]:checked')?.value === "delivery";
        if (addressField) addressField.hidden = !isDelivery;
      });
    });

    $("checkoutCancelBtn")?.addEventListener("click", closeCheckout);
    form?.addEventListener("submit", handleCheckoutSubmit);
  }

  async function handleCheckoutSubmit(event) {
    event.preventDefault();
    if (isSubmittingOrder || !checkoutContext) return;

    const errEl = $("checkoutError");
    const showErr = (msg) => {
      if (!errEl) return;
      errEl.textContent = msg;
      errEl.hidden = !msg;
    };
    showErr("");

    const buyerName = $("checkoutBuyerName")?.value.trim() || "";
    const buyerPhone = $("checkoutBuyerPhone")?.value.trim() || "";
    const deliveryMethod = document.querySelector('#checkoutForm input[name="deliveryMethod"]:checked')?.value || "pickup";
    const deliveryAddress = $("checkoutAddress")?.value.trim() || "";
    const note = $("checkoutNote")?.value.trim() || "";
    const paymentMethod = document.querySelector('#checkoutForm input[name="paymentMethod"]:checked')?.value || "card";
    const agreed = Boolean($("checkoutAgree")?.checked);

    if (!buyerName) {
      showErr("주문자 이름을 입력해 주세요.");
      $("checkoutBuyerName")?.focus();
      return;
    }
    if (!buyerPhone || buyerPhone.replace(/\D/g, "").length < 8) {
      showErr("연락 가능한 전화번호를 정확히 입력해 주세요.");
      $("checkoutBuyerPhone")?.focus();
      return;
    }
    if (deliveryMethod === "delivery" && !deliveryAddress) {
      showErr("배달 받으실 주소를 입력해 주세요.");
      $("checkoutAddress")?.focus();
      return;
    }
    if (!agreed) {
      showErr("결제 진행 동의에 체크해 주세요.");
      $("checkoutAgree")?.focus();
      return;
    }

    const submitBtn = $("checkoutSubmitBtn");
    isSubmittingOrder = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "결제 처리 중...";
    }

    const { items, fromCart } = checkoutContext;
    const payload = {
      items: items.map((item) => ({
        listingId: item.listingId,
        ...(item.type === "rent" ? { startDate: item.startDate, endDate: item.endDate, days: item.days } : { quantity: item.quantity }),
      })),
      fromCart,
      clearCart: fromCart,
      paymentMethod,
      buyerName,
      buyerPhone,
      deliveryMethod,
      deliveryAddress: deliveryMethod === "delivery" ? deliveryAddress : "",
      note,
    };

    let completedOrder = null;

    if (isLoggedIn()) {
      try {
        const res = await apiFetch("/api/orders", {
          method: "POST",
          json: payload,
        });
        completedOrder = res?.order || null;
        if (res?.cart && Array.isArray(res.cart.items)) {
          cartItems = res.cart.items.map((item) => normalizeCartItem(item));
          syncSelectionWithItems(false);
        } else if (fromCart) {
          removePurchasedItemsLocally(items);
        }
      } catch (error) {
        if (error?.status === 400) {
          showErr(error.message || "주문 정보를 확인해 주세요.");
          isSubmittingOrder = false;
          if (submitBtn) {
            const total = items.reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
            submitBtn.disabled = false;
            submitBtn.textContent = `${money(total)} 결제하기`;
          }
          return;
        }
        // Offline / unauthenticated fallback
        completedOrder = createLocalOrder(items, payload);
        if (fromCart) removePurchasedItemsLocally(items);
      }
    } else {
      completedOrder = createLocalOrder(items, payload);
      if (fromCart) removePurchasedItemsLocally(items);
    }

    isSubmittingOrder = false;
    updateCartBadge();
    if (!$("cartBackdrop")?.hidden) renderCartDrawer();
    renderCheckoutReceipt(completedOrder);
    toast("결제가 완료되었습니다!");
  }

  function removePurchasedItemsLocally(purchasedItems) {
    const purchasedIds = new Set(purchasedItems.map((i) => i.id));
    const purchasedListingIds = new Set(purchasedItems.map((i) => i.listingId));
    cartItems = cartItems.filter((item) => !purchasedIds.has(item.id) && !purchasedListingIds.has(item.listingId));
    purchasedIds.forEach((id) => selectedIds.delete(id));
    saveLocalCart();
  }

  function createLocalOrder(items, payload) {
    const totalAmount = items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
    const nowIso = new Date().toISOString();
    const order = {
      id: `local-ord-${Date.now()}`,
      orderNumber: `MOA-${today().replace(/-/g, "")}-${String(Math.floor(1000 + Math.random() * 9000))}`,
      status: "paid",
      paymentMethod: payload.paymentMethod,
      totalAmount,
      buyerName: payload.buyerName,
      buyerPhone: payload.buyerPhone,
      deliveryMethod: payload.deliveryMethod,
      deliveryAddress: payload.deliveryAddress || "",
      note: payload.note || "",
      items: items.map((item) => ({ ...item })),
      createdAt: nowIso,
      paidAt: nowIso,
      localOnly: true,
    };
    const existing = readLocalJson(LOCAL_ORDERS_KEY, []);
    writeLocalJson(LOCAL_ORDERS_KEY, [order, ...existing].slice(0, 30));
    recentOrders = [order, ...recentOrders];
    return order;
  }

  function renderCheckoutReceipt(order) {
    const body = $("checkoutBody");
    if (!body || !order) return;
    const items = Array.isArray(order.items) ? order.items : [];
    const paidDate = order.paidAt || order.createdAt
      ? new Date(order.paidAt || order.createdAt).toLocaleString("ko-KR")
      : "";

    body.innerHTML = `
      <div class="checkout-receipt">
        <div class="checkout-receipt-badge" aria-hidden="true">✓</div>
        <h3>결제가 완료되었습니다</h3>
        <p class="checkout-receipt-sub">
          주문번호 <strong>${escapeHtml(order.orderNumber || order.id)}</strong>
          ${order.localOnly ? `<span class="cart-order-local-tag">로컬 임시 저장</span>` : ""}
        </p>

        <dl class="checkout-receipt-dl">
          <div><dt>결제 일시</dt><dd>${escapeHtml(paidDate)}</dd></div>
          <div><dt>결제 수단</dt><dd>${escapeHtml(PAYMENT_LABEL[order.paymentMethod] || "카드결제")}</dd></div>
          <div><dt>주문자</dt><dd>${escapeHtml(order.buyerName)} (${escapeHtml(order.buyerPhone)})</dd></div>
          <div><dt>수령 방식</dt><dd>${escapeHtml(DELIVERY_LABEL[order.deliveryMethod] || "직접 방문 수령")}${order.deliveryAddress ? ` · ${escapeHtml(order.deliveryAddress)}` : ""}</dd></div>
          ${order.note ? `<div><dt>요청 사항</dt><dd>${escapeHtml(order.note)}</dd></div>` : ""}
        </dl>

        <div class="checkout-receipt-items">
          <h4>결제 상품 (${items.length}건)</h4>
          <ul>
            ${items.map((item) => `
              <li>
                <span>
                  <strong>${escapeHtml(item.title)}</strong>
                  <small>${item.type === "rent" ? `${escapeHtml(item.startDate || "")} ~ ${escapeHtml(item.endDate || "")} (${item.days || 1}일)` : `${item.quantity || 1}대`}</small>
                </span>
                <strong>${money(item.subtotal || item.unitPrice || 0)}</strong>
              </li>
            `).join("")}
          </ul>
          <div class="checkout-receipt-total">
            <span>최종 결제 금액</span>
            <strong>${money(order.totalAmount || 0)}</strong>
          </div>
        </div>

        <div class="checkout-actions">
          <button type="button" class="button button-secondary" id="receiptOrdersBtn">결제 내역 보기</button>
          <button type="button" class="button button-primary" id="receiptDoneBtn">확인</button>
        </div>
      </div>
    `;

    $("receiptDoneBtn")?.addEventListener("click", closeCheckout);
    $("receiptOrdersBtn")?.addEventListener("click", () => {
      closeCheckout();
      openCart({ tab: "orders" });
    });
  }

  function bind() {
    $("headerCartButton")?.addEventListener("click", () => openCart({ tab: "cart" }));
    $("closeCartDrawer")?.addEventListener("click", closeCart);
    $("cartBackdrop")?.addEventListener("click", (event) => {
      if (event.target === $("cartBackdrop")) closeCart();
    });

    $("closeCheckoutDialog")?.addEventListener("click", closeCheckout);
    $("checkoutBackdrop")?.addEventListener("click", (event) => {
      if (event.target === $("checkoutBackdrop")) closeCheckout();
    });

    // Cart drawer delegation
    $("cartDrawerBody")?.addEventListener("click", (event) => {
      const tabBtn = event.target.closest("[data-cart-tab]");
      if (tabBtn) {
        drawerTab = tabBtn.dataset.cartTab;
        if (drawerTab === "orders") {
          loadRecentOrders().then(() => renderCartDrawer());
        } else {
          renderCartDrawer();
        }
        return;
      }
      if (event.target.closest("#cartGoBrowseBtn")) {
        closeCart();
        deps.setView?.("browse");
        return;
      }
      if (event.target.closest("#cartClearBtn")) {
        clearCart();
        return;
      }
      const removeBtn = event.target.closest("[data-cart-remove]");
      if (removeBtn) {
        removeCartItem(removeBtn.dataset.cartRemove);
        return;
      }
      const qtyBtn = event.target.closest("[data-cart-qty-delta]");
      if (qtyBtn) {
        const id = qtyBtn.dataset.cartId;
        const delta = Number(qtyBtn.dataset.cartQtyDelta) || 0;
        const item = cartItems.find((i) => i.id === id);
        if (item) updateCartItem(id, { quantity: (item.quantity || 1) + delta });
      }
    });

    $("cartDrawerBody")?.addEventListener("change", (event) => {
      if (event.target.id === "cartSelectAll") {
        if (event.target.checked) {
          cartItems.forEach((item) => selectedIds.add(item.id));
        } else {
          selectedIds.clear();
        }
        renderCartDrawer();
        return;
      }
      const selectBox = event.target.closest("[data-cart-select]");
      if (selectBox) {
        const id = selectBox.dataset.cartSelect;
        if (selectBox.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        renderCartDrawer();
        return;
      }
      const startInput = event.target.closest("[data-cart-start]");
      if (startInput) {
        updateCartItem(startInput.dataset.cartStart, { startDate: startInput.value });
        return;
      }
      const endInput = event.target.closest("[data-cart-end]");
      if (endInput) {
        updateCartItem(endInput.dataset.cartEnd, { endDate: endInput.value });
      }
    });

    $("cartDrawerFooter")?.addEventListener("click", (event) => {
      const tabBtn = event.target.closest("[data-cart-tab]");
      if (tabBtn) {
        drawerTab = tabBtn.dataset.cartTab;
        renderCartDrawer();
        return;
      }
      if (event.target.closest("#cartCheckoutBtn")) {
        openCheckout(null);
      }
    });

    // Global custom events so catalog.js or any module can trigger cart/checkout without tight coupling
    window.addEventListener("moanong:cart-add", (event) => {
      const detail = event.detail || {};
      addToCart(detail.listing || detail.listingId, detail.options || detail);
    });
    window.addEventListener("moanong:checkout-open", (event) => {
      const detail = event.detail || {};
      openCheckout(detail.items || detail.listing || detail.listingId || null, detail.options || detail);
    });

    // Expose global API
    window.moanongCart = {
      addToCart,
      openCart,
      openCheckout,
      loadCart,
      getCartItems: () => [...cartItems],
    };

    loadCart();
  }

  const controller = {
    bind,
    loadCart,
    syncGuestCartOnLogin,
    addToCart,
    openCart,
    closeCart,
    openCheckout,
    closeCheckout,
    updateCartBadge,
    getCartItems: () => [...cartItems],
  };

  activeController = controller;
  return controller;
}

export function addToCart(listingOrId, options = {}) {
  return activeController ? activeController.addToCart(listingOrId, options) : Promise.resolve(null);
}

export function openCart(options = {}) {
  return activeController?.openCart(options);
}

export function openCheckout(target = null, options = {}) {
  return activeController?.openCheckout(target, options);
}

export function getCartItems() {
  return activeController ? activeController.getCartItems() : [];
}
