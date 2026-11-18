// 홈(모아농 2.0): 예약창 말풍선(위치·날짜·시간·작업)과 실시간 추천 매물.
// 고른 값은 매물 찾기와 같은 state.filters / state.transaction 에 바로 저장되고,
// 추천 매물은 매물 찾기와 같은 필터 함수(filteredListings)로 고른다.

import { STAGES, OPERATIONS, OPERATION_BY_ID, MACHINE_BY_ID, distanceKm } from "../data/farm-machines.js";
import { $, escapeHtml, money, today } from "../core/utils.js";
import { state, persist } from "../core/store.js";
import { activeDistanceOrigin, refreshWeatherAndMapConfig } from "./map-weather.js";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const RADIUS_OPTIONS = [
  { value: "10", label: "10km" },
  { value: "20", label: "20km" },
  { value: "30", label: "30km" },
  { value: "all", label: "전체" },
];
const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const TIME_RE = /^\s*([01]?\d|2[0-3])\s*:?\s*([03]0)\s*$/;
const ROW = 44;

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
  ["[질문 1을 입력해 주세요]", "[답변을 입력해 주세요. 2~3줄로 짧게 쓰면 읽기 좋아요.]"],
  ["[질문 2를 입력해 주세요]", "[답변을 입력해 주세요.]"],
  ["[질문 3을 입력해 주세요]", "[답변을 입력해 주세요.]"],
  ["[질문 4를 입력해 주세요]", "[답변을 입력해 주세요.]"],
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
  const drafts = { start: null, end: null };

  const times = () => ({
    start: TIME_SLOTS.includes(state.filters.timeStart) ? state.filters.timeStart : "09:00",
    end: TIME_SLOTS.includes(state.filters.timeEnd) ? state.filters.timeEnd : "18:00",
  });

  function commit({ weather = false } = {}) {
    persist(deps.updateBadges);
    deps.renderAll();
    if (weather) refreshWeatherAndMapConfig({ onUpdate: () => deps.renderListings() });
  }

  // ---------- 말풍선 열고 닫기 ----------
  function setPop(name) {
    openPop = openPop === name ? "" : name;
    if (openPop === "date" && monthOffset === null) {
      const [y, m] = parts(state.filters.date || today());
      monthOffset = y * 12 + (m - 1);
    }
    renderPops();
  }

  function closePop() {
    if (!openPop) return;
    openPop = "";
    renderPops();
  }

  function renderPops() {
    const map = { loc: "homePopLoc", date: "homePopDate", time: "homePopTime", task: "homePopTask" };
    for (const [name, id] of Object.entries(map)) {
      const el = $(id);
      if (!el) continue;
      const open = openPop === name;
      el.hidden = !open;
      if (open) el.innerHTML = { loc: locHtml, date: dateHtml, time: timeHtml, task: taskHtml }[name]();
    }
    for (const btn of document.querySelectorAll("[data-home-pop]")) {
      const open = btn.dataset.homePop === openPop;
      btn.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
    }
    if (openPop === "time") syncWheels();
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
      commit({ weather: true });
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
      if (state.filters.date && !state.filters.dateEnd) {
        state.filters.dateEnd = state.filters.date;
        commit({ weather: true });
      }
      openPop = "";
      setPop("time");
    }
  }

  // ---------- 시간 ----------
  function wheelHtml(which, label, dayLabel) {
    const value = times()[which];
    const draft = drafts[which];
    const bad = draft != null && !TIME_RE.test(draft);
    const items = TIME_SLOTS.map((t) => `<li data-home-slot="${which}:${t}" class="${t === value ? "is-on" : ""}">${t}</li>`).join("");
    return `
      <div class="h2-time-col">
        <div class="h2-time-head"><b>${label}</b><small>${dayLabel}</small></div>
        <input class="h2-time-input${bad ? " is-bad" : ""}" data-home-time-input="${which}" inputmode="numeric" value="${escapeHtml(draft ?? value)}" aria-label="${label} 직접 입력 (예: 0930)" />
        <div class="h2-wheel">
          <span class="h2-wheel-band" aria-hidden="true"></span>
          <ul class="h2-wheel-list" data-home-wheel="${which}" tabindex="0" role="listbox" aria-label="${label}">${items}</ul>
        </div>
      </div>`;
  }

  function timeHtml() {
    const { date, dateEnd } = state.filters;
    const { start, end } = times();
    const sameDay = date && (dateEnd || date) === date;
    const bad = sameDay && end <= start;
    return `
      <div class="h2-time">
        ${wheelHtml("start", "받는 시간", date ? fullDate(date) : "빌리는 날")}
        <span class="h2-vline" aria-hidden="true"></span>
        ${wheelHtml("end", "반납 시간", dateEnd || date ? fullDate(dateEnd || date) : "반납하는 날")}
      </div>
      ${bad ? '<p class="h2-warn">하루만 빌릴 때는 반납 시간이 받는 시간보다 늦어야 해요</p>' : ""}
      <div class="h2-pop-foot h2-pop-foot-end"><button type="button" class="h2-apply" data-home-time="apply">적용</button></div>`;
  }

  function setTime(which, value, { rerender = true } = {}) {
    state.filters[which === "start" ? "timeStart" : "timeEnd"] = value;
    persist(deps.updateBadges);
    renderSummary();
    if (rerender) renderPops();
  }

  function syncWheels() {
    for (const list of document.querySelectorAll("[data-home-wheel]")) {
      const which = list.dataset.homeWheel;
      const index = TIME_SLOTS.indexOf(times()[which]);
      list.dataset.index = String(index);
      list.scrollTop = index * ROW;
      let timer = 0;
      list.addEventListener("scroll", () => {
        const i = Math.max(0, Math.min(TIME_SLOTS.length - 1, Math.round(list.scrollTop / ROW)));
        if (String(i) !== list.dataset.index) {
          list.dataset.index = String(i);
          for (const li of list.children) li.classList.toggle("is-on", li.dataset.homeSlot.endsWith(TIME_SLOTS[i]));
          const input = document.querySelector(`[data-home-time-input="${which}"]`);
          if (input) input.value = TIME_SLOTS[i];
          drafts[which] = null;
          clearTimeout(timer);
          timer = setTimeout(() => setTime(which, TIME_SLOTS[i], { rerender: false }), 120);
        }
      }, { passive: true });
      list.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const i = Math.max(0, Math.min(TIME_SLOTS.length - 1, Number(list.dataset.index) + (event.key === "ArrowDown" ? 1 : -1)));
        list.scrollTo({ top: i * ROW, behavior: "smooth" });
      });
    }
  }

  function onTimeClick(target) {
    const slot = target.closest("[data-home-slot]")?.dataset.homeSlot;
    if (slot) {
      const [which, value] = [slot.slice(0, slot.indexOf(":")), slot.slice(slot.indexOf(":") + 1)];
      drafts[which] = null;
      setTime(which, value);
      return;
    }
    if (target.closest('[data-home-time="apply"]')) {
      drafts.start = drafts.end = null;
      openPop = "";
      setPop("task");
    }
  }

  function onTimeInput(input) {
    const which = input.dataset.homeTimeInput;
    drafts[which] = input.value;
    const m = input.value.match(TIME_RE);
    input.classList.toggle("is-bad", !m);
    if (m) {
      const value = `${pad2(m[1])}:${m[2]}`;
      state.filters[which === "start" ? "timeStart" : "timeEnd"] = value;
      persist(deps.updateBadges);
      renderSummary();
      const list = document.querySelector(`[data-home-wheel="${which}"]`);
      if (list) {
        const i = TIME_SLOTS.indexOf(value);
        list.dataset.index = String(i);
        list.scrollTop = i * ROW;
        for (const li of list.children) li.classList.toggle("is-on", li.dataset.homeSlot.endsWith(value));
      }
    }
  }

  // ---------- 작업 ----------
  function taskHtml() {
    const selected = state.filters.operations.length === 1 ? state.filters.operations[0] : "";
    const groups = STAGES.map((stage) => {
      const ops = OPERATIONS.filter((op) => op.stage === stage.id);
      if (!ops.length) return "";
      return `<div class="h2-task-group"><span>${escapeHtml(stage.label)}</span><div class="h2-chips-row">${ops
        .map((op) => `<button type="button" class="h2-chip h2-chip-lg${op.id === selected ? " is-on" : ""}" data-home-op="${op.id}" aria-pressed="${op.id === selected}">${escapeHtml(op.label)}</button>`)
        .join("")}</div></div>`;
    }).join("");
    return `<b class="h2-pop-title">어떤 작업을 하시나요?</b>
      <div class="h2-task-groups">${groups}</div>
      <div class="h2-pop-foot"><button type="button" class="h2-text-btn" data-home-op="">전체 작업 보기</button><button type="button" class="h2-ask" data-home-ask>잘 모르겠다면 <u>농농이에게 물어보기</u></button></div>`;
  }

  function onTaskClick(target) {
    if (target.closest("[data-home-ask]")) {
      closePop();
      $("headerAiOpen")?.click();
      return;
    }
    const op = target.closest("[data-home-op]");
    if (op) {
      const id = op.dataset.homeOp;
      state.filters.operations = id ? [id] : [];
      openPop = "";
      renderPops();
      commit();
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
    const { start, end } = times();
    $("homeTimeText").textContent = `${start}–${end}`;
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
    const all = deps.filteredListings();
    const items = pickRecs(all);
    const bits = [state.region];
    if (state.transaction === "rent" && f.date) bits.push(f.dateEnd && f.dateEnd !== f.date ? `${shortDate(f.date)}–${shortDate(f.dateEnd)}` : shortDate(f.date));
    const op = f.operations.length === 1 ? OPERATION_BY_ID[f.operations[0]] : null;
    if (op) bits.push(op.label);
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

  // ---------- 이벤트 ----------
  function bind() {
    const card = $("homeBooking");
    if (!card) return;
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
      if (t.closest("#homePopTime")) return onTimeClick(t);
      if (t.closest("#homePopTask")) return onTaskClick(t);
      if (t.closest("[data-home-widen]")) {
        state.filters.radius = "all";
        commit();
        return;
      }
      const detail = t.closest("[data-detail]")?.dataset.detail;
      if (detail) deps.openDetail(detail);
    });
    card.addEventListener("input", (event) => {
      const input = event.target.closest("[data-home-time-input]");
      if (input) onTimeInput(input);
    });
    card.addEventListener("focusout", (event) => {
      const input = event.target.closest("[data-home-time-input]");
      if (input) {
        drafts[input.dataset.homeTimeInput] = null;
        input.classList.remove("is-bad");
        input.value = times()[input.dataset.homeTimeInput];
      }
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
    $("homeFindBtn")?.addEventListener("click", () => deps.setView("browse"));
    $("homeSeeAll")?.addEventListener("click", () => deps.setView("browse"));
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
    renderSummary();
    renderRecs();
    if (openPop && openPop !== "time") renderPops();
  }

  return { bind, render, closePop };
}

