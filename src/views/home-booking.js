// 홈 예약창: 작업·지역·날짜를 고를 때마다 아래 추천 농기계 3대가 바로 바뀐다.
// '농기계 찾기'를 누르면 고른 조건을 그대로 가지고 매물 목록으로 이동한다.

import { STAGES, OPERATIONS, OPERATION_BY_ID, MACHINE_BY_ID } from "../data/farm-machines.js";
import { compareListings } from "../data/recommendation.js";
import { pickHomeRecommendations, blankHomeCriteria } from "../data/home-recommend.js";
import { $, escapeHtml, money, today, addDays, getListingPhotoSrc, machineImage } from "../core/utils.js";
import { state, runtime, allListings, persist } from "../core/store.js";
import { activeDistanceOrigin } from "./map-weather.js";

const COUNTY = "영양군";
const ownImageTypes = new Set(["carrier", "combine", "cultivator", "potatoHarvester", "potatoPlanter", "ricePlanter", "ridgeMulcher", "sprayer", "tractor", "transplanter"]);

function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00+09:00`);
  const fmt = (opts) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...opts }).format(d);
  return `${fmt({ month: "long", day: "numeric" })} (${fmt({ weekday: "short" })})`;
}

export function createHomeBooking(deps) {
  // 예약창의 선택값. 매물 목록 필터(state.filters)와는 '농기계 찾기'를 눌러야 합쳐진다
  const criteria = blankHomeCriteria();
  let lastKey = "";

  function initFromState() {
    criteria.transaction = state.transaction === "sale" ? "sale" : "rent";
    criteria.operation = state.filters.operations?.length === 1 ? state.filters.operations[0] : "";
    criteria.town = state.filters.town || "";
    criteria.date = state.filters.date || "";
    criteria.dateEnd = state.filters.dateEnd || "";
  }

  function fillOperationOptions() {
    const select = $("hbOperation");
    if (!select || select.dataset.ready) return;
    for (const stage of STAGES) {
      const group = document.createElement("optgroup");
      group.label = stage.label;
      for (const op of OPERATIONS.filter((item) => item.stage === stage.id)) {
        group.append(new Option(op.label, op.id));
      }
      if (group.children.length) select.append(group);
    }
    select.dataset.ready = "1";
  }

  function fillTownOptions() {
    const select = $("hbTown");
    if (!select) return;
    const towns = [...new Set(allListings().map((item) => item.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    const existing = [...select.options].map((o) => o.value).filter(Boolean);
    if (towns.length && towns.join() !== existing.join()) {
      select.length = 1;
      for (const town of towns) select.add(new Option(`${COUNTY} ${town}`, town));
    }
    if (criteria.town && !towns.includes(criteria.town) && towns.length) criteria.town = "";
  }

  function syncControls() {
    const isRent = criteria.transaction === "rent";
    for (const tab of document.querySelectorAll("[data-hb-tx]")) {
      const active = tab.dataset.hbTx === criteria.transaction;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    $("hbOperation").value = criteria.operation;
    $("hbTown").value = criteria.town;
    $("hbDateField").hidden = !isRent;
    $("hbDateStart").min = today();
    $("hbDateStart").value = criteria.date;
    $("hbDateEnd").min = criteria.date || today();
    $("hbDateEnd").value = criteria.dateEnd;
    $("hbDateStartText").textContent = criteria.date ? shortDate(criteria.date) : "대여일";
    $("hbDateEndText").textContent = criteria.dateEnd ? shortDate(criteria.dateEnd) : "반납일";
    $("hbDateStartText").classList.toggle("is-placeholder", !criteria.date);
    $("hbDateEndText").classList.toggle("is-placeholder", !criteria.dateEnd);
    $("hbDateClear").hidden = !criteria.date;
  }

  function noteText(total) {
    const op = OPERATION_BY_ID[criteria.operation]?.label;
    const parts = [];
    if (op) parts.push(op);
    if (criteria.town) parts.push(criteria.town);
    if (criteria.transaction === "rent" && criteria.date) {
      parts.push(criteria.dateEnd && criteria.dateEnd !== criteria.date ? `${shortDate(criteria.date)}~${shortDate(criteria.dateEnd)}` : shortDate(criteria.date));
    }
    const what = criteria.transaction === "rent" ? "빌릴 수 있는" : "살 수 있는";
    if (!parts.length) return `지금 ${COUNTY}에서 ${what} 농기계 ${total}대`;
    return `${parts.join(" · ")} 조건에 맞는 농기계 ${total}대`;
  }

  function cardHtml(item) {
    const type = MACHINE_BY_ID[item.machineType];
    const name = type?.label || "농기계";
    const model = [item.brand, item.model].filter(Boolean).join(" ");
    const priceLabel = item.type === "rent" ? "1일" : "판매가";
    return `
      <button type="button" class="hb-card" data-hb-detail="${escapeHtml(item.id)}" aria-label="${escapeHtml(name)} ${escapeHtml(model)}, ${escapeHtml(item.region)}, ${priceLabel} ${money(item.price)} 상세 보기">
        <span class="hb-card-media">${deps.machineVisual(item)}</span>
        <span class="hb-card-body">
          <span class="hb-card-name">${escapeHtml(name)}</span>
          <span class="hb-card-model">${escapeHtml(model)}</span>
          <span class="hb-card-region"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>${COUNTY} ${escapeHtml(item.region)}</span>
          <span class="hb-card-price"><small>${priceLabel}</small> ${money(item.price)}</span>
        </span>
      </button>`;
  }

  function skeletonHtml() {
    return Array.from({ length: 3 }, () => `<div class="hb-card hb-card-skeleton" aria-hidden="true"><span class="hb-card-media"></span><span class="hb-card-body"><span></span><span></span><span></span></span></div>`).join("");
  }

  function emptyHtml() {
    const actions = [];
    if (criteria.date) actions.push(`<button type="button" class="hb-empty-action" data-hb-clear="date">날짜 지우기</button>`);
    if (criteria.town) actions.push(`<button type="button" class="hb-empty-action" data-hb-clear="town">${COUNTY} 전체에서 보기</button>`);
    if (criteria.operation) actions.push(`<button type="button" class="hb-empty-action" data-hb-clear="operation">작업 선택 지우기</button>`);
    return `
      <div class="hb-empty">
        <strong>조건에 맞는 농기계가 없어요</strong>
        <p>조건을 하나 풀면 더 많은 농기계를 볼 수 있어요.</p>
        <div class="hb-empty-actions">${actions.join("")}</div>
      </div>`;
  }

  function render() {
    const box = $("hbCards");
    if (!box) return;
    fillTownOptions();
    syncControls();

    if (runtime.catalogState === "loading" && !allListings().length) {
      box.innerHTML = skeletonHtml();
      box.setAttribute("aria-busy", "true");
      $("hbResultsNote").textContent = "농기계를 불러오는 중이에요";
      return;
    }
    box.setAttribute("aria-busy", "false");
    if (runtime.catalogState === "error" && !allListings().length) {
      box.innerHTML = `<div class="hb-empty"><strong>농기계 목록을 불러오지 못했어요</strong><p>잠시 후 다시 시도해 주세요.</p></div>`;
      $("hbResultsNote").textContent = "";
      return;
    }

    const origin = activeDistanceOrigin();
    const { items, total } = pickHomeRecommendations(allListings(), criteria, {
      limit: 3,
      operationById: OPERATION_BY_ID,
      today: today(),
      tieBreak: (a, b) => compareListings(a, b, origin, "distance"),
      // 전용 예시 사진이 있는 기종을 조금 앞으로 (작업 적합도 순서는 그대로)
      displayPenalty: (item) => (getListingPhotoSrc(item) || ownImageTypes.has(item.machineType) ? 0 : 5),
      visualKey: (item) => getListingPhotoSrc(item) || machineImage(MACHINE_BY_ID[item.machineType]),
    });
    const key = `${criteria.transaction}|${items.map((item) => item.id).join(",")}`;
    $("hbResultsNote").textContent = noteText(total);
    $("hbSeeAll").hidden = total === 0;
    if (key === lastKey && box.children.length) return;
    lastKey = key;

    const html = items.length ? items.map(cardHtml).join("") : emptyHtml();
    // 조건이 바뀌면 카드만 살짝 사라졌다 나타난다
    box.classList.remove("is-swapping");
    void box.offsetWidth;
    box.innerHTML = html;
    box.classList.add("is-swapping");
  }

  // 예약창 조건을 매물 목록 필터로 옮기고 목록으로 이동
  function goToResults() {
    if (state.transaction !== criteria.transaction) deps.setTransaction(criteria.transaction);
    state.filters.operations = criteria.operation ? [criteria.operation] : [];
    state.filters.stageIds = [];
    state.filters.town = criteria.town;
    if (criteria.transaction === "rent") {
      state.filters.date = criteria.date;
      state.filters.dateEnd = criteria.date ? criteria.dateEnd || criteria.date : "";
    }
    persist(deps.updateBadges);
    deps.renderAll();
    deps.setView("browse");
  }

  function setDate(start, end) {
    criteria.date = start || "";
    if (!criteria.date) criteria.dateEnd = "";
    else if (end !== undefined) criteria.dateEnd = end && end >= criteria.date ? end : criteria.date;
    else if (!criteria.dateEnd || criteria.dateEnd < criteria.date) criteria.dateEnd = addDays(criteria.date, 1);
    render();
  }

  function bind() {
    fillOperationOptions();
    for (const tab of document.querySelectorAll("[data-hb-tx]")) {
      tab.addEventListener("click", () => {
        if (criteria.transaction === tab.dataset.hbTx) return;
        criteria.transaction = tab.dataset.hbTx;
        // 아래 매물 목록의 대여/구매도 함께 바꾼다
        deps.setTransaction(criteria.transaction);
      });
    }
    $("hbOperation").addEventListener("change", (event) => { criteria.operation = event.target.value; render(); });
    $("hbTown").addEventListener("change", (event) => { criteria.town = event.target.value; render(); });
    $("hbDateStart").addEventListener("change", (event) => setDate(event.target.value));
    $("hbDateEnd").addEventListener("change", (event) => {
      if (!criteria.date) criteria.date = today();
      setDate(criteria.date, event.target.value);
    });
    $("hbDateClear").addEventListener("click", () => setDate(""));
    // 날짜 칸 어디를 눌러도 달력이 열리게
    for (const id of ["hbDateStart", "hbDateEnd"]) {
      $(id).closest(".hb-date").addEventListener("click", (event) => {
        const input = $(id);
        if (event.target !== input) event.preventDefault();
        try { input.showPicker?.(); } catch { input.focus(); }
      });
    }
    $("hbForm").addEventListener("submit", (event) => { event.preventDefault(); goToResults(); });
    $("hbSeeAll").addEventListener("click", goToResults);
    $("hbCards").addEventListener("click", (event) => {
      const clear = event.target.closest("[data-hb-clear]");
      if (clear) {
        const what = clear.dataset.hbClear;
        if (what === "date") setDate("");
        else { criteria[what] = ""; render(); }
        return;
      }
      const card = event.target.closest("[data-hb-detail]");
      if (card) deps.openDetail(card.dataset.hbDetail);
    });
    $("heroBookCta")?.addEventListener("click", (event) => {
      event.preventDefault();
      $("homeBooking").scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => $("hbOperation").focus({ preventScroll: true }), 450);
    });
  }

  // 다른 곳(매물 목록 탭 등)에서 대여/구매가 바뀌면 예약창도 따라간다
  function syncTransaction() {
    const tx = state.transaction === "sale" ? "sale" : "rent";
    if (criteria.transaction !== tx) criteria.transaction = tx;
    render();
  }

  initFromState();
  bind();

  return { render, syncTransaction, criteria };
}
