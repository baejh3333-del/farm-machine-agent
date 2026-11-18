// 홈(모아농 2.0): 예약창 말풍선(위치·날짜·작업)과 실시간 추천 매물.
// 고른 값은 매물 찾기와 같은 state.filters / state.transaction 에 바로 저장되고,
// 추천 매물은 매물 찾기와 같은 필터 함수(filteredListings)로 고르되, 홈에 보이는 조건만 쓴다.

import { STAGES, OPERATIONS, OPERATION_BY_ID, MACHINE_BY_ID, distanceKm } from "../data/farm-machines.js";
import { $, addDays, escapeHtml, money, today } from "../core/utils.js";
import { state, persist, blankFilters } from "../core/store.js";
import { activeDistanceOrigin, refreshWeatherAndMapConfig } from "./map-weather.js";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const RADIUS_OPTIONS = [
  { value: "10", label: "10km" },
  { value: "20", label: "20km" },
  { value: "30", label: "30km" },
  { value: "all", label: "전체" },
];

const STEPS = {
  borrow: [
    ["조건 고르기", "위치·날짜·작업만 고르면\n맞는 기계가 보여요", "filter"],
    ["기계 확인하기", "사진과 대여료를 보고\n궁금하면 농농이에게", "eye"],
    ["대여 요청하기", "버튼 한 번으로\n소유자에게 요청", "send"],
    ["승인 후 사용하기", "승인되면 확정,\n쓰고 돌려주면 끝", "check"],
  ],
  lend: [
    ["기계 등록하기", "사진과 대여료,\n빌려줄 날짜를 올려요", "plus"],
    ["요청 확인하기", "이웃의 대여 요청을\n알림으로 받아요", "bell"],
    ["승인하기", "괜찮은 요청만\n직접 골라 승인해요", "send"],
    ["돌려받기", "사용이 끝나면\n기계를 돌려받아요", "check"],
  ],
};
const STEP_ICONS = {
  filter: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/>',
  plus: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
};
const FAQS = [
  ["대여는 언제 확정되나요?", "대여 요청을 보내면 기계 소유자에게 알림이 가요. 소유자가 승인하면 그때 대여가 확정되고, 승인 전에는 요청을 취소할 수 있어요."],
  ["기계 이름을 몰라도 찾을 수 있나요?", "네. 예약창에서 '밭 갈기'처럼 하려는 작업을 고르면 그 작업에 맞는 기계를 보여드려요. 그래도 어렵다면 농농이에게 말로 물어보세요."],
  ["가까운 공공 임대사업소도 볼 수 있나요?", "지도에서 전국 공공 농기계 임대사업소 위치를 함께 볼 수 있어요. 이웃 매물과 함께 비교해 보세요."],
  ["제 농기계를 빌려주거나 팔려면 어떻게 하나요?", "로그인한 뒤 내 기계를 등록하고 사진과 대여료·판매가를 올리면 돼요. 들어온 요청은 내 페이지에서 확인하고 직접 승인해요."],
];

const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const parts = (iso) => iso.split("-").map(Number);
const shortDate = (iso) => {
  const [, m, d] = parts(iso);
  return `${m}/${d}`;
};
const fullDate = (iso) => {
  const [y, m, d] = parts(iso);
  return `${m}월 ${d}일 (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
};
const daysBetween = (a, b) => {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
};

export function createHomeView(deps) {
  let openPop = "";
  let monthOffset = null; // 달력 첫 달 (yyyy*12+mm)
  let howTab = "borrow";
  let faqOpen = 0;
  let homeTimes = { start: "09:00", end: "18:00" };
  function commit({ weather = false } = {}) {
    persist(deps.updateBadges);
    deps.renderAll();
    if (weather) refreshWeatherAndMapConfig({ onUpdate: () => deps.renderListings() });
  }

  // 홈 예약창에 보이는 조건(위치 범위·날짜·작업)만 남긴 필터. 매물 찾기에서 고른 다른 조건은 홈 추천에 숨어 들지 않는다.
  function visibleFilters() {
    const f = state.filters;
    return { ...blankFilters(), radius: f.radius || "all", date: f.date, dateEnd: f.dateEnd, operations: [...f.operations] };
  }

  // 시작일만 고르고 닫으면 매물 찾기 날짜 입력과 같이 다음 날을 반납일로 잡는다.
  function finishDate() {
    const f = state.filters;
    if (f.date && !f.dateEnd) f.dateEnd = addDays(f.date, 1);
    commit({ weather: true });
  }

  // ---------- 말풍선 열고 닫기 ----------
  function setPop(name) {
    const wasDate = openPop === "date";
    openPop = openPop === name ? "" : name;
    if (openPop === "date" && monthOffset === null) {
      const [y, m] = parts(state.filters.date || today());
      monthOffset = y * 12 + (m - 1);
    }
    if (openPop === "time") {
      const form = $("homeTimeForm");
      form.elements.start.value = homeTimes.start;
      form.elements.end.value = homeTimes.end;
    }
    renderPops();
    if (wasDate) finishDate();
  }

  function closePop() {
    if (!openPop) return;
    const wasDate = openPop === "date";
    openPop = "";
    renderPops();
    if (wasDate) finishDate();
  }

  function renderPops() {
    const map = { loc: "homePopLoc", date: "homePopDate", time: "homePopTime", task: "homePopTask" };
    for (const [name, id] of Object.entries(map)) {
      const el = $(id);
      if (!el) continue;
      const open = openPop === name;
      el.hidden = !open;
      if (open && name !== "time") el.innerHTML = { loc: locHtml, date: dateHtml, task: taskHtml }[name]();
    }
    for (const btn of document.querySelectorAll("[data-home-pop]")) {
      const open = btn.dataset.homePop === openPop;
      btn.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
    }
  }

  // ---------- 위치 ----------
  function regionOptions() {
    const select = $("regionSelect");
    return select ? [...select.options].map((o) => o.value).filter(Boolean) : [];
  }

  function locHtml() {
    const radius = state.filters.radius || "all";
    const hasGps = state.userCoords?.source === "gps";
    const rows = [
      `<button type="button" class="h2-loc-row" data-home-loc="gps"><span class="h2-loc-ico is-green"><svg width="18" height="18" viewBox="0 0 24 24" fill="#1E9B4B" aria-hidden="true"><path d="M21 3L3 10.5l7.5 2.9L13.5 21z"/></svg></span><span><strong class="is-green">현재 위치</strong><small>${hasGps ? "GPS로 설정됨" : "지금 계신 곳에서 가까운 순으로 보여드려요"}</small></span></button>`,
      ...regionOptions().map((name) => {
        const on = name === state.region;
        return `<button type="button" class="h2-loc-row${on ? " is-on" : ""}" data-home-loc="${escapeHtml(name)}" aria-pressed="${on}"><span class="h2-loc-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg></span><span><strong>${escapeHtml(name)}</strong>${on ? "<small>지금 보고 있는 동네</small>" : ""}</span></button>`;
      }),
      `<button type="button" class="h2-loc-row" data-home-loc="more"><span class="h2-loc-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg></span><span><strong>다른 지역 고르기</strong><small>시·도와 시·군에서 직접 찾아요</small></span></button>`,
    ];
    const chips = RADIUS_OPTIONS.map((o) => `<button type="button" class="h2-chip${radius === o.value ? " is-on" : ""}" data-home-radius="${o.value}" aria-pressed="${radius === o.value}">${o.label}</button>`).join("");
    return `<div class="h2-loc-list">${rows.join("")}</div><div class="h2-pop-foot"><b>찾는 범위</b><span class="h2-chips-row">${chips}</span></div>`;
  }

  function onLocClick(target) {
    const loc = target.closest("[data-home-loc]")?.dataset.homeLoc;
    if (loc === "gps") {
      closePop();
      $("regionGpsBtn")?.click();
      return;
    }
    if (loc === "more") {
      closePop();
      $("regionPickerBtn")?.click();
      return;
    }
    if (loc) {
      const select = $("regionSelect");
      if (select && loc !== state.region) {
        select.value = loc;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const next = state.transaction === "rent" ? "date" : "task";
      openPop = "";
      if (next === "date") monthOffset = null;
      setPop(next);
      return;
    }
    const radius = target.closest("[data-home-radius]")?.dataset.homeRadius;
    if (radius) {
      state.filters.radius = radius;
      commit();
      renderPops();
    }
  }

  // ---------- 날짜 ----------
  function monthHtml(ym) {
    const y = Math.floor(ym / 12);
    const m = ym % 12;
    const first = new Date(y, m, 1).getDay();
    const count = new Date(y, m + 1, 0).getDate();
    const min = today();
    const { date: start, dateEnd: end } = state.filters;
    const cells = [];
    for (let i = 0; i < first; i += 1) cells.push('<span class="h2-day is-blank"></span>');
    for (let d = 1; d <= count; d += 1) {
      const iso = isoOf(y, m, d);
      const past = iso < min;
      const sel = iso === start || iso === end;
      const inRange = start && end && iso > start && iso < end;
      const cls = ["h2-day", past && "is-past", sel && "is-sel", inRange && "is-range"].filter(Boolean).join(" ");
      cells.push(`<button type="button" class="${cls}" data-home-day="${iso}"${past ? " disabled" : ""} aria-pressed="${sel}" aria-label="${fullDate(iso)}">${d}</button>`);
    }
    return `<div class="h2-month"><b>${y}년 ${m + 1}월</b><div class="h2-week">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div><div class="h2-days">${cells.join("")}</div></div>`;
  }

  function dateHtml() {
    const [ty, tm] = parts(today());
    const minYm = ty * 12 + (tm - 1);
    return `
      <div class="h2-cal">
        <button type="button" class="h2-nav" data-home-month="-1" aria-label="이전 달"${monthOffset <= minYm ? " disabled" : ""}>‹</button>
        ${monthHtml(monthOffset)}${monthHtml(monthOffset + 1)}
        <button type="button" class="h2-nav" data-home-month="1" aria-label="다음 달">›</button>
      </div>
      <div class="h2-pop-foot h2-pop-foot-end"><button type="button" class="h2-text-btn" data-home-date="reset">초기화</button><button type="button" class="h2-apply" data-home-date="apply">적용</button></div>`;
  }

  function onDateClick(target) {
    const day = target.closest("[data-home-day]")?.dataset.homeDay;
    if (day) {
      const f = state.filters;
      if (!f.date || f.dateEnd || day < f.date) {
        f.date = day;
        f.dateEnd = "";
      } else {
        f.dateEnd = day;
      }
      commit();
      renderPops();
      return;
    }
    const step = Number(target.closest("[data-home-month]")?.dataset.homeMonth || 0);
    if (step) {
      monthOffset += step;
      renderPops();
      return;
    }
    const action = target.closest("[data-home-date]")?.dataset.homeDate;
    if (action === "reset") {
      state.filters.date = "";
      state.filters.dateEnd = "";
      commit({ weather: true });
      renderPops();
    }
    if (action === "apply") {
      openPop = "";
      finishDate();
      setPop("task");
    }
  }

  // ---------- 작업 ----------
  function taskHtml() {
    const selected = new Set(state.filters.operations);
    const groups = STAGES.map((stage) => {
      const ops = OPERATIONS.filter((op) => op.stage === stage.id);
      if (!ops.length) return "";
      return `<div class="h2-task-group"><span>${escapeHtml(stage.label)}</span><div class="h2-chips-row">${ops
        .map((op) => `<button type="button" class="h2-chip h2-chip-lg${selected.has(op.id) ? " is-on" : ""}" data-home-op="${op.id}" aria-pressed="${selected.has(op.id)}">${escapeHtml(op.label)}</button>`)
        .join("")}</div></div>`;
    }).join("");
    return `<b class="h2-pop-title">어떤 작업을 하시나요? <small>여러 개 골라도 돼요</small></b>
      <div class="h2-task-groups">${groups}</div>
      <div class="h2-pop-foot"><button type="button" class="h2-text-btn" data-home-op="">전체 작업 보기</button><button type="button" class="h2-ask" data-home-ask>잘 모르겠다면 <u>농농이에게 물어보기</u></button><button type="button" class="h2-apply" data-home-task="apply">적용</button></div>`;
  }

  function onTaskClick(target) {
    if (target.closest("[data-home-ask]")) {
      closePop();
      $("headerAiOpen")?.click();
      return;
    }
    if (target.closest('[data-home-task="apply"]')) {
      closePop();
      return;
    }
    const op = target.closest("[data-home-op]");
    if (op) {
      const id = op.dataset.homeOp;
      const ops = state.filters.operations;
      // 작업은 매물 찾기처럼 여러 개를 고를 수 있다. '전체 작업 보기'는 모두 지운다.
      state.filters.operations = !id ? [] : ops.includes(id) ? ops.filter((x) => x !== id) : [...ops, id];
      if (!id) openPop = "";
      commit();
      renderPops();
    }
  }

  // ---------- 요약 · 추천 ----------
  function renderSummary() {
    const f = state.filters;
    const rent = state.transaction === "rent";
    const radius = f.radius && f.radius !== "all" ? `${f.radius}km 이내` : "전체 거리";
    $("homeLocText").textContent = `${state.region} · ${radius}`;
    let dateText = "날짜 선택";
    if (f.date && !f.dateEnd) dateText = `${shortDate(f.date)} – 반납일`;
    if (f.date && f.dateEnd) dateText = f.date === f.dateEnd ? `${shortDate(f.date)} · 하루` : `${shortDate(f.date)} – ${shortDate(f.dateEnd)} · ${daysBetween(f.date, f.dateEnd)}일`;
    $("homeDateText").textContent = dateText;
    $("homeDateText").classList.toggle("is-placeholder", !f.date);
    const op = f.operations.length === 1 ? OPERATION_BY_ID[f.operations[0]] : null;
    $("homeTaskText").textContent = op ? op.label : f.operations.length > 1 ? `작업 ${f.operations.length}개` : "작업 선택";
    $("homeTaskText").classList.toggle("is-placeholder", !f.operations.length);
    $("homeDateGroup").hidden = !rent;
    for (const btn of document.querySelectorAll("[data-home-tx]")) {
      const on = btn.dataset.homeTx === state.transaction;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-selected", String(on));
    }
    document.querySelector(".h2-switch")?.classList.toggle("is-sale", !rent);
  }

  function pickRecs(items, limit = 3) {
    const picked = [];
    const seen = new Set();
    for (const item of items) {
      if (picked.length >= limit) break;
      if (seen.has(item.machineType)) continue;
      seen.add(item.machineType);
      picked.push(item);
    }
    for (const item of items) {
      if (picked.length >= limit) break;
      if (!picked.includes(item)) picked.push(item);
    }
    return picked;
  }

  function recCard(item) {
    const label = MACHINE_BY_ID[item.machineType]?.label || "농기계";
    const distance = distanceKm(activeDistanceOrigin(), item.region, item.id);
    const rent = item.type === "rent";
    return `
      <button type="button" class="h2-rec" data-detail="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 상세 보기">
        <span class="h2-rec-media">${deps.machineVisual(item)}</span>
        <span class="h2-rec-name">${escapeHtml(item.title || label)}</span>
        <span class="h2-rec-place">${escapeHtml(item.region)} · ${distance}km</span>
        <span class="h2-rec-foot"><b>${rent ? "1일 " : ""}${money(item.price)}</b><span class="h2-rec-badge"><i></i>${rent ? "대여 가능" : "중고 매물"}</span></span>
      </button>`;
  }

  function renderRecs() {
    const f = state.filters;
    const all = deps.filteredListings(visibleFilters(), { ignoreQuery: true });
    const items = pickRecs(all);
    const bits = [state.region];
    if (state.transaction === "rent" && f.date) bits.push(f.dateEnd && f.dateEnd !== f.date ? `${shortDate(f.date)}–${shortDate(f.dateEnd)}` : shortDate(f.date));
    const op = f.operations.length === 1 ? OPERATION_BY_ID[f.operations[0]] : null;
    if (op) bits.push(op.label);
    else if (f.operations.length > 1) bits.push(`작업 ${f.operations.length}개`);
    $("homeRecTitle").textContent = bits.join(" · ");
    $("homeRecCount").textContent = `조건에 맞는 ${state.transaction === "rent" ? "농기계" : "중고 매물"} ${all.length}대`;
    $("homeRecNote").textContent = state.transaction === "rent" ? "대여는 요청 후 소유자가 승인하면 확정돼요." : "구매는 판매자와 대화로 조건을 맞춰요.";
    $("homeRecGrid").innerHTML = items.length
      ? items.map(recCard).join("")
      : `<div class="h2-rec-empty"><strong>조건에 맞는 농기계가 아직 없어요</strong><p>거리를 넓히거나 날짜·작업을 바꿔 보세요.</p><button type="button" class="h2-text-btn" data-home-widen>거리 전체로 넓히기</button></div>`;
  }

  // ---------- 사용 방법 · FAQ ----------
  function renderSteps() {
    $("homeSteps").innerHTML = STEPS[howTab]
      .map(([title, desc, icon], i, arr) => `
        <li class="h2-step-col${i === arr.length - 1 ? " is-last" : ""}">
          <span class="h2-step-line"><i${i === 0 ? ' class="is-hidden"' : ""}></i><span class="h2-step-circle"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STEP_ICONS[icon]}</svg></span><i${i === arr.length - 1 ? ' class="is-hidden"' : ""}></i></span>
          <span class="h2-step-no">STEP 0${i + 1}</span>
          <strong>${title}</strong>
          <p>${desc.replace("\n", "<br />")}</p>
        </li>`)
      .join("");
    for (const btn of document.querySelectorAll("[data-home-how]")) {
      const on = btn.dataset.homeHow === howTab;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-selected", String(on));
    }
  }

  function renderFaq() {
    $("homeFaq").innerHTML = FAQS.map(([q, a], i) => {
      const open = faqOpen === i;
      return `<div class="h2-faq-item"><button type="button" data-home-faq="${i}" aria-expanded="${open}">${escapeHtml(q)}<span aria-hidden="true">${open ? "−" : "+"}</span></button>${open ? `<p>${escapeHtml(a)}</p>` : ""}</div>`;
    }).join("");
  }

  // '농기계 찾기': 홈에 보이는 조건 그대로 매물 찾기로 넘어간다(매물 찾기에 남아 있던 다른 조건·검색어는 비운다).
  function goBrowse() {
    closePop();
    state.filters = visibleFilters();
    const search = $("searchInput");
    if (search) search.value = "";
    commit();
    deps.setView("browse");
  }

  // ---------- 이벤트 ----------
  function bind() {
    const card = $("homeBooking");
    if (!card) return;
    $("homeTimeForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const { start, end } = event.currentTarget.elements;
      homeTimes = { start: start.value, end: end.value };
      $("homeTimeText").textContent = `${homeTimes.start}–${homeTimes.end}`;
      closePop();
      card.querySelector('[data-home-pop="time"]').focus();
    });
    card.addEventListener("click", (event) => {
      const t = event.target;
      const popBtn = t.closest("[data-home-pop]");
      if (popBtn) {
        setPop(popBtn.dataset.homePop);
        return;
      }
      const tx = t.closest("[data-home-tx]")?.dataset.homeTx;
      if (tx && tx !== state.transaction) {
        openPop = "";
        renderPops();
        deps.setTransaction(tx);
        return;
      }
      if (t.closest("#homePopLoc")) return onLocClick(t);
      if (t.closest("#homePopDate")) return onDateClick(t);
      if (t.closest("#homePopTask")) return onTaskClick(t);
      if (t.closest("[data-home-widen]")) {
        state.filters.radius = "all";
        commit();
        return;
      }
      const detail = t.closest("[data-detail]")?.dataset.detail;
      if (detail) deps.openDetail(detail);
    });
    document.addEventListener("click", (event) => {
      if (!openPop || !event.target.isConnected) return;
      if (!event.target.closest(".h2-group") && !event.target.closest(".dialog-backdrop")) closePop();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && openPop) {
        const btn = document.querySelector(`[data-home-pop="${openPop}"]`);
        closePop();
        btn?.focus();
      }
    });
    $("homeFindBtn")?.addEventListener("click", goBrowse);
    $("homeSeeAll")?.addEventListener("click", goBrowse);
    $("homeAskAi")?.addEventListener("click", () => $("headerAiOpen")?.click());
    document.querySelector(".h2-tabs")?.addEventListener("click", (event) => {
      const how = event.target.closest("[data-home-how]")?.dataset.homeHow;
      if (how) {
        howTab = how;
        renderSteps();
      }
    });
    $("homeFaq")?.addEventListener("click", (event) => {
      const i = event.target.closest("[data-home-faq]")?.dataset.homeFaq;
      if (i != null) {
        faqOpen = faqOpen === Number(i) ? -1 : Number(i);
        renderFaq();
      }
    });
    renderSteps();
    renderFaq();
  }

  function render() {
    if (!$("homeBooking")) return;
    // 저장해 둔 날짜가 이미 지났으면 지운다(달력에서도 고를 수 없는 날).
    const f = state.filters;
    if (f.date && f.date < today()) {
      f.date = "";
      f.dateEnd = "";
      persist(deps.updateBadges);
    }
    renderSummary();
    renderRecs();
    if (openPop) renderPops();
  }

  return { bind, render, closePop };
}
