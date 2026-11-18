import { SPEC_BY_ID } from "../data/machine-specifications.js";
import { CROPS, STAGES, OPERATIONS, MACHINE_TYPES, CROP_OPERATIONS, CROP_BY_ID, OPERATION_BY_ID, MACHINE_BY_ID, distanceKm } from "../data/farm-machines.js";
import { available, compareListings } from "../data/recommendation.js";
import { $, escapeHtml, money, toPyeong, areaLabel, areaFullLabel, today, addDays, koreanDateParts, BEGINNER_TIPS, pictureIcon, favoriteIcon, toast, showDialog, hideDialog, machineImage } from "../core/utils.js";
import { state, runtime, blankFilters, persist, allListings, listingById, rentedNow, statusLabel, statusClass, activeFavorites } from "../core/store.js";
import { activeDistanceOrigin, renderWeatherBanner, renderDetailListingMap, weatherDetailNote, refreshWeatherAndMapConfig } from "./map-weather.js";

export function createCatalogViews(deps) {
let lastPreviewCount = null;
let previewCountRaf = 0;

function setTransaction(type) {
  state.transaction = type;
  $("rentTab").classList.toggle("active", type === "rent");
  $("saleTab").classList.toggle("active", type === "sale");
  $("rentTab").setAttribute("aria-pressed", String(type === "rent"));
  $("saleTab").setAttribute("aria-pressed", String(type === "sale"));
  const quickDateBox = $("quickDateBox");
  if (quickDateBox) {
    quickDateBox.classList.toggle("disabled-field", type === "sale");
    $("quickDateInput").disabled = type === "sale";
    $("quickDateEndInput").disabled = type === "sale";
  }
  persist(deps.updateBadges);
  deps.renderAll();
}

function syncQuickSearchInputs() {
  if ($("quickDateInput")) {
    // 날짜를 고르기 전에는 웹서버 기준 오늘(대여)과 내일(반납)을 보여준다
    const start = state.filters.date || today();
    const end = state.filters.dateEnd && state.filters.dateEnd >= start ? state.filters.dateEnd : state.filters.date ? start : addDays(start, 1);
    $("quickDateInput").min = today();
    $("quickDateInput").value = start;
    $("quickDateEndInput").min = start;
    $("quickDateEndInput").value = end;
    const s = koreanDateParts(start);
    const e = koreanDateParts(end);
    $("quickDateLabel").textContent = s.date;
    $("quickDateDay").textContent = s.weekday;
    $("quickDateEndLabel").textContent = e.date;
    $("quickDateEndDay").textContent = e.weekday;
    $("clearQuickDate").hidden = !state.filters.date;
  }
  if ($("quickRadiusSelect")) {
    $("quickRadiusSelect").value = state.filters.radius || "all";
  }
}

// 1단계: 작물 선택 렌더링
function renderCrops() {
  $("cropSelect").value = Object.hasOwn(CROP_BY_ID, state.selectedCrop) ? state.selectedCrop : "all";
  $("cropDescription").textContent = CROP_BY_ID[$("cropSelect").value]?.description || "작물을 고르면 해당 작물에 맞는 작업을 볼 수 있어요.";
}

// 2단계: 작업 단계 및 세부 작업 버튼 렌더링 (초보 농부 맞춤 위저드)
function renderQuickWizard() {
  const crop = CROP_BY_ID[state.selectedCrop];
  const recommendedOps = crop ? CROP_OPERATIONS[crop.id] || [] : [];

  // 단계 탭
  const allStageActive = state.filters.stageIds.length === 0;
  const stageHtml = [
    `<button type="button" class="stage-tab ${allStageActive ? "active" : ""}" data-quick-stage="all" aria-pressed="${allStageActive}">
      <span class="stage-step-num">전체</span>
      <strong>모든 작업 단계</strong>
    </button>`,
    ...STAGES.map((stage, idx) => {
      const active = state.filters.stageIds.includes(stage.id);
      return `
        <button type="button" class="stage-tab ${active ? "active" : ""}" data-quick-stage="${stage.id}" aria-pressed="${active}">
          <span class="stage-step-num">${idx + 1}단계</span>
          <strong>${escapeHtml(stage.label)}</strong>
        </button>
      `;
    }),
  ].join("");
  $("quickStageList").innerHTML = stageHtml;
  $("quickStageList")
    .querySelectorAll(".stage-tab")
    .forEach((el, index) => el.style.setProperty("--stagger-i", String(Math.min(index, 12))));

  // 세부 작업 버튼들 (선택된 단계가 있으면 해당 단계만, 없으면 전체 표시)
  const visibleOps = OPERATIONS.filter((op) =>
    (!crop || recommendedOps.includes(op.id)) && (!state.filters.stageIds.length || state.filters.stageIds.includes(op.stage))
  );

  $("quickOperationList").innerHTML = visibleOps
    .map((op) => {
      const active = state.filters.operations.includes(op.id);
      const isRec = recommendedOps.includes(op.id);
      return `
        <button type="button" class="op-chip ${active ? "active" : ""} ${isRec ? "recommended" : ""}" data-quick-op="${op.id}" aria-pressed="${active}">
          <span class="op-chip-label">${escapeHtml(op.label)}</span>
          ${isRec ? `<span class="op-rec-tag">초보 추천</span>` : ""}
          ${active ? `<span class="op-check" aria-hidden="true">✓</span>` : ""}
        </button>
      `;
    })
    .join("");
  $("quickOperationList")
    .querySelectorAll(".op-chip")
    .forEach((el, index) => el.style.setProperty("--stagger-i", String(Math.min(index, 12))));

  // 초보 농부 맞춤 콜아웃 업데이트
  const activeOpId = state.filters.operations[0];
  const cropKey = crop ? crop.id : "all";
  const tipGroup = BEGINNER_TIPS[cropKey] || BEGINNER_TIPS.all;
  const tipText = (activeOpId && tipGroup[activeOpId]) || tipGroup.default || BEGINNER_TIPS.all.default;

  const calloutTitle = crop
    ? `${crop.emoji} ${crop.name} 농사${activeOpId ? ` · '${OPERATION_BY_ID[activeOpId]?.label}'` : ""} 꿀팁!`
    : ` 초보 농부를 위한 농기계 선택 팁`;

  $("cropCallout").querySelector(".callout-icon").innerHTML = pictureIcon(crop?.id || "bulb");
  $("cropCallout").querySelector("strong").textContent = calloutTitle;
  $("cropCallout").querySelector("p").textContent = tipText;

  // 이벤트 바인딩
  $("quickStageList")
    .querySelectorAll("[data-quick-stage]")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        const stageId = btn.dataset.quickStage;
        if (stageId === "all") {
          state.filters.stageIds = [];
        } else {
          state.filters.stageIds = state.filters.stageIds.includes(stageId)
            ? []
            : [stageId];
        }
        state.filters.operations = state.filters.operations.filter((id) =>
          !state.filters.stageIds.length || state.filters.stageIds.includes(OPERATION_BY_ID[id]?.stage)
        );
        persist(deps.updateBadges);
        deps.renderAll();
      })
    );

  $("quickOperationList")
    .querySelectorAll("[data-quick-op]")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        const opId = btn.dataset.quickOp;
        state.filters.operations = state.filters.operations.includes(opId)
          ? state.filters.operations.filter((id) => id !== opId)
          : [...state.filters.operations, opId];
        persist(deps.updateBadges);
        deps.renderAll();
      })
    );
}

// 기종별 빠른 카테고리 탭바 (쏘카 스타일)
function renderMachineCategoryBar() {
  const baseFiltersWithoutMachine = { ...state.filters, machineTypes: [] };
  const baseMatching = filteredListings(baseFiltersWithoutMachine);
  const isAll = state.filters.machineTypes.length === 0;

  const tabs = [
    `<button type="button" class="machine-tab ${isAll ? "active" : ""}" data-machine-tab="all" aria-pressed="${isAll}">
      <span class="mt-emoji" aria-hidden="true"><img class="mt-photo" src="${machineImage()}" alt="" /></span>
      <span class="mt-caption"><span class="mt-name">전체 기종</span><span class="mt-count">${baseMatching.length}</span></span>
    </button>`,
    ...MACHINE_TYPES.map((m) => {
      const matchingItems = baseMatching.filter((item) => item.machineType === m.id);
      const count = matchingItems.length;
      const photo = allListings().find((item) => item.machineType === m.id
        && deps.hasListingPhoto(item))?.photo;
      const active = state.filters.machineTypes.includes(m.id);
      return `
        <button type="button" class="machine-tab ${active ? "active" : ""}" data-machine-tab="${m.id}" aria-pressed="${active}">
          <span class="mt-emoji" aria-hidden="true"><img class="mt-photo" src="${photo ? escapeHtml(photo) : machineImage(m)}" alt="" /></span>
          <span class="mt-caption"><span class="mt-name">${escapeHtml(m.label)}</span><span class="mt-count">${count}</span></span>
        </button>
      `;
    }),
  ];

  $("machineCategoryBar").innerHTML = tabs.join("");
  $("machineCategoryBar")
    .querySelectorAll("[data-machine-tab]")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        const mId = btn.dataset.machineTab;
        if (mId === "all") {
          state.filters.machineTypes = [];
        } else {
          state.filters.machineTypes = state.filters.machineTypes.includes(mId)
            ? state.filters.machineTypes.filter((id) => id !== mId)
            : [mId];
        }
        persist(deps.updateBadges);
        deps.renderAll();
      })
    );
}

// 상세 필터 모달 내부 옵션 렌더링 (다나와 + 토스 스타일)
function selectOption(group, values, checked, recommendedIds = []) {
  return values
    .map((item) => {
      const isChecked = checked.includes(item.id);
      const isRec = recommendedIds.includes(item.id);
      return `
        <label class="option ${isChecked ? "is-checked" : ""} ${isRec ? "is-recommended" : ""}">
          <input type="checkbox" data-filter-group="${group}" value="${item.id}" ${isChecked ? "checked" : ""}>
          ${group === "cropIds" ? pictureIcon(item.id) : group === "machineTypes" ? `<img class="picture-icon" src="${machineImage(item)}" alt="" width="32" height="32">` : group === "conditions" && ["good", "repair"].includes(item.id) ? pictureIcon(item.id) : ""}
          <span class="opt-text">${escapeHtml(item.label || item.name)}</span>
          ${isRec ? `<span class="opt-rec-badge">추천</span>` : ""}
        </label>
      `;
    })
    .join("");
}

function renderFilterOptions() {
  const activeCropId = runtime.draft.cropIds[0] || (state.selectedCrop !== "all" ? state.selectedCrop : null);
  const recOps = activeCropId ? CROP_OPERATIONS[activeCropId] || [] : [];

  $("filterCrops").innerHTML = selectOption("cropIds", CROPS, runtime.draft.cropIds);
  $("filterStages").innerHTML = selectOption("stageIds", STAGES, runtime.draft.stageIds);
  const visibleOperations = runtime.draft.stageIds.length
    ? OPERATIONS.filter((operation) => runtime.draft.stageIds.includes(operation.stage))
    : OPERATIONS;
  $("filterOperations").innerHTML = selectOption("operations", visibleOperations, runtime.draft.operations, recOps);
  $("filterMachines").innerHTML = selectOption("machineTypes", MACHINE_TYPES, runtime.draft.machineTypes);
  $("filterBrands").innerHTML = selectOption(
    "brands",
    [...new Set(allListings().map((item) => item.brand))].sort().map((brand) => ({ id: brand, label: brand })),
    runtime.draft.brands
  );
  $("filterConditions").innerHTML = selectOption(
    "conditions",
    [
      { id: "good", label: "정상 작동 (즉시 사용)", emoji: "" },
      { id: "used", label: "사용감 있음", emoji: "" },
      { id: "repair", label: "정비 필요", emoji: "" },
    ],
    runtime.draft.conditions,
    ["good"]
  );

  $("budgetUnit").textContent = state.transaction === "rent" ? "1일 대여료 기준" : "중고 구매가 기준";
  $("dateFilterLabel").hidden = state.transaction === "sale";
  $("dateEndFilterLabel").hidden = state.transaction === "sale";

  // 예산 프리셋 버튼 렌더링
  const pricePresetList =
    state.transaction === "rent"
      ? [
          { label: "전체 금액", max: "" },
          { label: "5만원 이하 / 일", max: "50000" },
          { label: "7만원 이하 / 일", max: "70000" },
          { label: "10만원 이하 / 일", max: "100000" },
        ]
      : [
          { label: "전체 금액", max: "" },
          { label: "300만원 이하", max: "3000000" },
          { label: "600만원 이하", max: "6000000" },
          { label: "1,000만원 이하", max: "10000000" },
        ];

  $("pricePresets").innerHTML = pricePresetList
    .map(
      (p) =>
        `<button type="button" class="preset-chip ${String(runtime.draft.maxPrice || "") === p.max ? "active" : ""}" data-price-preset="${p.max}">${p.label}</button>`
    )
    .join("");

  // 면적 프리셋 활성화 표시
  $("areaPresets")
    .querySelectorAll("[data-area-preset]")
    .forEach((btn) => {
      btn.classList.toggle("active", String(runtime.draft.areaPyeong || "") === btn.dataset.areaPreset);
    });

  for (const [id, key] of [
    ["minPrice", "minPrice"],
    ["maxPrice", "maxPrice"],
    ["areaInput", "areaPyeong"],
    ["radiusInput", "radius"],
    ["dateInput", "date"],
    ["dateEndInput", "dateEnd"],
  ]) {
    $(id).value = runtime.draft[key];
  }
  $("dateInput").min = today();
  renderFilterPreview();
}

function openFilters() {
  runtime.draft = structuredClone(state.filters);
  lastPreviewCount = null;
  renderFilterOptions();
  showDialog($("filterBackdrop"));
}

function readDraftFields() {
  for (const [id, key] of [
    ["minPrice", "minPrice"],
    ["maxPrice", "maxPrice"],
    ["areaInput", "areaPyeong"],
    ["radiusInput", "radius"],
    ["dateInput", "date"],
    ["dateEndInput", "dateEnd"],
  ]) {
    runtime.draft[key] = $(id).value;
  }
  $("dateEndInput").min = runtime.draft.date || today();
}

function matches(item, filters) {
  if (item.type !== state.transaction || item.status !== "open") return false;
  if (item.condition === "repair" && !filters.conditions.includes("repair")) return false;
  if (filters.cropIds.length && !filters.cropIds.some((id) => item.cropIds.includes(id))) return false;
  if (filters.stageIds.length && !item.operations.some((id) => filters.stageIds.includes(OPERATION_BY_ID[id]?.stage))) return false;
  if (filters.operations.length && !filters.operations.some((id) => item.operations.includes(id))) return false;
  if (filters.machineTypes.length && !filters.machineTypes.includes(item.machineType)) return false;
  if (filters.brands.length && !filters.brands.includes(item.brand)) return false;
  if (filters.conditions.length && !filters.conditions.includes(item.condition)) return false;
  if (filters.minPrice && item.price < Number(filters.minPrice)) return false;
  if (filters.maxPrice && item.price > Number(filters.maxPrice)) return false;
  if (filters.areaPyeong && (Number(filters.areaPyeong) * 3.305785 < item.areaMin || Number(filters.areaPyeong) * 3.305785 > item.areaMax)) return false;
  if (filters.radius !== "all" && distanceKm(activeDistanceOrigin(), item.region, item.id) > Number(filters.radius)) return false;
  if (state.transaction === "rent" && filters.date && !available(item, filters.date, filters.dateEnd || filters.date)) return false;
  return true;
}

function filteredListings(filters = state.filters) {
  const query = $("searchInput").value.trim().toLowerCase();
  return allListings()
    .filter(
      (item) =>
        matches(item, filters) &&
        (!query ||
          `${item.title} ${item.brand} ${item.description} ${MACHINE_BY_ID[item.machineType]?.label || ""} ${item.operations
            .map((id) => OPERATION_BY_ID[id]?.label)
            .join(" ")}`
            .toLowerCase()
            .includes(query))
    )
    .sort((a, b) => compareListings(a, b, activeDistanceOrigin(), state.sort));
}

function renderFilterPreview() {
  readDraftFields();
  const target = filteredListings(runtime.draft).length;
  const el = $("filterPreviewCount");
  if (!el) return;

  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (previewCountRaf) cancelAnimationFrame(previewCountRaf);

  if (reduceMotion || lastPreviewCount === null || lastPreviewCount === target || typeof requestAnimationFrame !== "function") {
    lastPreviewCount = target;
    el.textContent = `${target}개`;
    return;
  }

  const start = lastPreviewCount;
  const diff = target - start;
  const duration = 220;
  const startedAt = performance.now();
  el.classList.remove("is-updating");
  void el.offsetWidth;
  el.classList.add("is-updating");

  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = `${Math.round(start + diff * eased)}개`;
    if (progress < 1) {
      previewCountRaf = requestAnimationFrame(step);
    } else {
      previewCountRaf = 0;
      lastPreviewCount = target;
      el.textContent = `${target}개`;
    }
  };
  previewCountRaf = requestAnimationFrame(step);
}

function applyFilters() {
  readDraftFields();
  if (runtime.draft.minPrice && runtime.draft.maxPrice && Number(runtime.draft.minPrice) > Number(runtime.draft.maxPrice)) {
    toast("최소 금액이 최대 금액보다 큽니다.");
    return;
  }
  if (state.transaction === "rent" && runtime.draft.dateEnd && (!runtime.draft.date || runtime.draft.dateEnd < runtime.draft.date)) {
    toast("대여 시작일과 반납일을 확인해 주세요.");
    return;
  }
  state.filters = structuredClone(runtime.draft);
  state.selectedCrop = state.filters.cropIds[0] || "all";
  persist(deps.updateBadges);
  hideDialog($("filterBackdrop"));
  deps.renderAll();
}

// 개별 삭제가 가능한 활성 필터 칩 생성
function buildFilterChips() {
  const f = state.filters;
  const chips = [];
  f.cropIds.forEach((id) => chips.push({ group: "cropIds", value: id, label: `${CROP_BY_ID[id]?.emoji || ""} ${CROP_BY_ID[id]?.name}` }));
  f.stageIds.forEach((id) => chips.push({ group: "stageIds", value: id, label: STAGES.find((s) => s.id === id)?.label }));
  f.operations.forEach((id) => chips.push({ group: "operations", value: id, label: OPERATION_BY_ID[id]?.label }));
  f.machineTypes.forEach((id) => chips.push({ group: "machineTypes", value: id, label: MACHINE_BY_ID[id]?.label }));
  f.brands.forEach((id) => chips.push({ group: "brands", value: id, label: id }));
  f.conditions.forEach((id) =>
    chips.push({ group: "conditions", value: id, label: id === "good" ? "정상 작동" : id === "used" ? "사용감 있음" : "정비 필요" })
  );
  if (f.minPrice) chips.push({ group: "minPrice", value: "", label: `${money(f.minPrice)} 이상` });
  if (f.maxPrice) chips.push({ group: "maxPrice", value: "", label: `${money(f.maxPrice)} 이하` });
  if (f.areaPyeong) chips.push({ group: "areaPyeong", value: "", label: `밭 ${f.areaPyeong}평 기준` });
  if (f.radius !== "all") chips.push({ group: "radius", value: "all", label: `${f.radius}km 이내` });
  if (f.date && state.transaction === "rent") chips.push({ group: "date", value: "", label: f.dateEnd ? ` ${f.date} ~ ${f.dateEnd}` : ` ${f.date}` });
  return chips.filter((c) => c.label);
}

function renderActiveFilters() {
  const chips = buildFilterChips();
  $("activeFilters").innerHTML = chips
    .map(
      (chip) =>
        `<button type="button" class="filter-chip" data-remove-group="${chip.group}" data-remove-val="${escapeHtml(chip.value)}" title="클릭하여 조건 해제">
          <span>${escapeHtml(chip.label)}</span>
          <span class="chip-close" aria-hidden="true">✕</span>
        </button>`
    )
    .join("");

  const count = chips.length;
  $("filterCount").hidden = count === 0;
  $("filterCount").textContent = String(count);
  if ($("inlineResetFilters")) {
    $("inlineResetFilters").hidden = count === 0 && !$("searchInput").value.trim();
  }
}

function card(item) {
  const summary = deps.listingSummary(item);
  const distance = distanceKm(activeDistanceOrigin(), item.region, item.id);
  const machineLabel = MACHINE_BY_ID[item.machineType]?.label || "농기계";
  const cropsText = item.cropIds.map((id) => CROP_BY_ID[id]?.name).filter(Boolean).join("·");
  const opsText = item.operations.map((id) => OPERATION_BY_ID[id]?.label).filter(Boolean).slice(0, 2).join(" · ");
  const isFav = activeFavorites().includes(item.id);
  const sClass = statusClass(item);

  return `
    <article class="listing-card">
      <div class="card-media-wrap">
        <button type="button" class="card-media-btn" data-detail="${item.id}" aria-label="${escapeHtml(item.title)} 상세 보기">
          <div class="machine-art">
            ${deps.machineVisual(item)}
            <div class="art-badges-top">
              <span class="card-status-pill ${sClass}">${statusLabel(item)}</span>
              <span class="art-distance-pill"> ${escapeHtml(item.region)} · ${distance}km</span>
            </div>
            <span class="art-caption">${deps.hasListingPhoto(item) ? "실제 등록 사진" : `${escapeHtml(machineLabel)} AI 예시 이미지`}</span>
          </div>
        </button>
        <button type="button" class="card-save" data-favorite="${item.id}" aria-label="${escapeHtml(item.title)} 찜하기" aria-pressed="${isFav}">
          ${favoriteIcon()}
        </button>
      </div>

      <div class="card-body">
        <div class="card-spec-tags">
          <span class="spec-tag primary">${escapeHtml(machineLabel)}</span>
          <span class="spec-tag">${escapeHtml(cropsText)}</span>
          <span class="spec-tag">${escapeHtml(opsText)}</span>
          <span class="spec-tag">${areaLabel(item.areaMin, item.areaMax)}</span>
        </div>

        <button type="button" class="card-title-btn" data-detail="${item.id}">
          <h3>${escapeHtml(item.title)}</h3>
        </button>

        <div class="card-meta">제조사: ${escapeHtml(item.brand)} · 최근 점검: ${escapeHtml(item.inspectedAt)}</div>

        <div class="card-summary">
          <div class="summary-badge">${state.aiSummaries[item.id] ? "✦ AI 농농이 핵심 요약" : " AI 한줄 설명"}</div>
          <p>${escapeHtml(summary)}</p>
        </div>

        <div class="card-footer">
          <div class="card-price-box">
            <span class="price-type-label">${item.type === "rent" ? "1일 대여료" : "판매 가격"}</span>
            <div class="card-price">${money(item.price)}<small>${item.type === "rent" ? " / 1일" : ""}</small></div>
          </div>
          <button type="button" class="button button-card-cta" data-detail="${item.id}">
            <span>${item.type === "rent" ? "상세·대여 신청" : "상세·구매 문의"}</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderListings() {
  const items = filteredListings();
  $("resultCount").textContent = `총 ${items.length}대의 농기계 · ${{ distance: "거리순", price: "낮은 가격순", inspection: "최근 점검순" }[state.sort]}`;

  renderWeatherBanner({
    onSelectDate: (chosenDate) => {
      state.filters.date = chosenDate;
      state.filters.dateEnd = chosenDate;
      if ($("quickDateInput")) $("quickDateInput").value = chosenDate;
      if ($("quickDateEndInput")) $("quickDateEndInput").value = chosenDate;
      persist(deps.updateBadges);
      renderListings();
      refreshWeatherAndMapConfig({ onUpdate: () => renderListings() });
    },
  });
  $("listingGrid").hidden = false;

  $("listingGrid").innerHTML = items.length
    ? items.map(card).join("")
    : `<div class="empty-state">
        <div class="empty-icon" aria-hidden="true"><img class="picture-icon" src="${machineImage()}" alt="" width="32" height="32"></div>
        <strong>선택하신 조건에 맞는 농기계가 아직 없어요</strong>
        <p>작업 종류나 예산, 거리 조건을 조금 넓혀서 다시 찾아볼까요?</p>
        <div class="empty-actions">
          <button type="button" class="button button-secondary" data-reset-all>전체 조건 초기화</button>
        </div>
      </div>`;

  $("listingGrid")
    .querySelectorAll(".listing-card")
    .forEach((cardEl, index) => {
      cardEl.style.setProperty("--stagger-i", String(Math.min(index, 12)));
    });

  if (runtime.catalogState !== "ready") {
    const message = runtime.catalogState === "loading" ? "우리 동네 농기계 매물을 불러오는 중입니다…" : "데모 매물을 불러오지 못했습니다. 페이지를 새로고침해 주세요.";
    $("resultCount").textContent = message;
    if (!items.length) $("listingGrid").innerHTML = `<div class="empty-state"><strong>${message}</strong></div>`;
  }
  renderActiveFilters();
}

function openDetail(id) {
  const item = listingById(id);
  if (!item) return;
  const date = state.filters.date;
  const dateEnd = state.filters.dateEnd || date;
  const booked = item.type === "rent" && date && !available(item, date, dateEnd);
  const unavailable = item.status !== "open" || item.condition === "repair";
  const isFav = activeFavorites().includes(item.id);

  $("detailContent").innerHTML = `
    <div class="detail-layout">
      <div class="detail-art-col">
        <div class="detail-art">${deps.machineVisual(item)}${deps.hasListingPhoto(item) ? "" : '<span class="machine-example-label">AI 예시 이미지</span>'}</div>
        <div class="detail-checklist">
          <strong> 초보 농부 인수 전 필수 체크리스트</strong>
          <ul>
            <li>시동이 한 번에 잘 걸리고 이상 소음이 없는지 확인하세요.</li>
            <li>내 트랙터·관리기와 작업기 연결 규격이 맞는지 확인하세요.</li>
            <li>비상 정지 스위치와 안전 덮개 등 안전장치를 꼭 점검하세요.</li>
          </ul>
        </div>
        <div class="detail-location-card">
          <div class="detail-location-head">
            <strong>매물 위치</strong>
            <span class="detail-location-dist">내 동네에서 약 ${distanceKm(activeDistanceOrigin(), item, item.id)}km</span>
          </div>
          <div id="detailListingMapCanvas" class="detail-listing-map-canvas" aria-label="${escapeHtml(item.title)} 위치 지도"></div>
        </div>
      </div>
      <div class="detail-copy">
        <div class="detail-badges">
          <span class="card-status-pill ${statusClass(item)}">${statusLabel(item)}</span>
          <span class="spec-tag"> ${escapeHtml(item.region)} (${distanceKm(activeDistanceOrigin(), item.region, item.id)}km)</span>
          <span class="spec-tag">${escapeHtml(MACHINE_BY_ID[item.machineType]?.label)}</span>
        </div>
        <h2 id="detailTitle">${escapeHtml(item.title)}</h2>
        ${item.type === "rent" ? weatherDetailNote() : ""}
        ${runtime.garage?.detail(item) || ""}
        ${item.specification ? `
          <section class="model-specification" aria-label="실제 모델 사양">
            <h3>실제 모델 사양</h3>
            <p>실제 제품 사양을 참조한 가상 매물 · 가격·예약·점검일·권장 면적은 시연용</p>
            <dl class="model-spec-list">
              ${item.specification.facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
              <div><dt>연결 방식</dt><dd>${escapeHtml(item.specification.connection.label)}</dd></div>
            </dl>
            <p><strong>추가 확인:</strong> ${item.specification.unknowns.map(escapeHtml).join(" · ")}</p>
            <div>${item.specification.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)} ↗</a><p>${escapeHtml(source.note)} · 확인 ${escapeHtml(source.checkedAt)}</p>`).join("")}</div>
          </section>` : ""}
        <div class="detail-price-box">
          <span class="detail-price-label">${item.type === "rent" ? "1일 대여 요금" : "중고 판매 가격"}</span>
          <div class="detail-price">${money(item.price)} <small>${item.type === "rent" ? "/ 1일 기준" : ""}</small></div>
        </div>

        ${item.type === "rent" ? `<div class="detail-box"><b>대여 일정과 비용</b><p>${date ? `${date} ~ ${dateEnd} · ${booked || unavailable ? "대여 불가" : "대여 가능"}` : "시작일과 반납일을 선택해 대여 가능 여부를 확인하세요."}<br>운송비와 보증금은 소유 농가에 확인해 주세요.</p></div>` : ""}
        <div class="detail-box highlight">
          <b>${state.aiSummaries[item.id] ? "AI 한줄 요약" : "기종 사용 안내"}</b>
          <p>${escapeHtml(deps.listingSummary(item))}</p>
        </div>

        <div class="detail-spec-grid">
          <div class="spec-cell">
            <small>추천 작물</small>
            <strong>${escapeHtml(item.cropIds.map((cropId) => CROP_BY_ID[cropId]?.name).filter(Boolean).join(", "))}</strong>
          </div>
          <div class="spec-cell">
            <small>주요 작업</small>
            <strong>${escapeHtml(item.operations.map((opId) => OPERATION_BY_ID[opId]?.label).filter(Boolean).join(", "))}</strong>
          </div>
          <div class="spec-cell">
            <small>권장 밭 크기</small>
            <strong>${areaFullLabel(item.areaMin, item.areaMax)}</strong>
          </div>
          <div class="spec-cell">
            <small>기계 상태 · 점검일</small>
            <strong>${escapeHtml(item.condition === "good" ? "정상 작동" : item.condition === "used" ? "사용감 있음" : "정비 필요")} (${escapeHtml(item.inspectedAt)})</strong>
          </div>
        </div>

        <div class="detail-box">
          <b> 포함 구성품 및 인수 방법</b>
          <p>포함 작업기/부속: <strong>${escapeHtml(item.included)}</strong><br>인수 방식: <strong>${escapeHtml(item.pickup)}</strong></p>
        </div>

        <div class="detail-box">
          <b> 등록 농가 상세 설명</b>
          <p>${escapeHtml(item.description)}</p>
        </div>

        <div class="detail-actions">
          <button type="button" class="button button-secondary detail-fav-btn" data-detail-fav="${item.id}" aria-label="찜하기" aria-pressed="${isFav}">
            ${favoriteIcon()}
            <span class="favorite-label">${isFav ? "찜한 기계" : "찜하기"}</span>
          </button>
          ${item.owner ? `
            <button type="button" class="button button-primary button-large" data-detail-manage="${item.id}">내 매물 관리하기</button>
          ` : `
            ${item.type === "rent" ? `<button type="button" class="button button-secondary" data-detail-chat="${item.id}">1:1 문의</button>` : ""}
            <button type="button" class="button button-primary button-large" data-detail-action="${item.id}" ${unavailable || booked ? "disabled" : ""}>
              ${unavailable ? "현재 거래 불가" : booked ? "선택 기간 대여 불가" : item.type === "rent" ? " 이 농기계 대여 신청하기" : " 판매자에게 채팅 문의하기"}
            </button>
          `}
        </div>
      </div>
    </div>
  `;
  showDialog($("detailBackdrop"));
  renderDetailListingMap($("detailListingMapCanvas"), item);
}

function openFavoritesModal() {
  const favIds = activeFavorites();
  const items = allListings().filter((item) => favIds.includes(item.id));
  deps.openForm(`
    <span class="step-pill">관심 농기계 보관함</span>
    <h2 id="formTitle"> 내가 찜한 농기계 (${items.length}대)</h2>
    <p>비교해 보고 싶은 농기계를 모아두었어요. 버튼을 눌러 상세 조건을 확인하세요.</p>
    <div class="fav-modal-list">
      ${
        items.length
          ? items
              .map(
                (item) => `
          <div class="fav-modal-item">
            <button type="button" class="fav-thumb" data-favorite-detail="${item.id}" aria-label="${escapeHtml(item.title)} 상세 보기">${deps.machineVisual(item)}</button>
            <div class="fav-item-info">
              <span class="spec-tag">${item.type === "rent" ? "일일 대여" : "중고 판매"} · ${escapeHtml(item.region)}</span>
              <strong>${escapeHtml(item.title)}</strong>
              <span class="fav-item-price">${money(item.price)}${item.type === "rent" ? " / 1일" : ""}</span>
            </div>
            <div class="fav-item-actions">
              <button type="button" class="button button-secondary button-sm" data-fav-remove="${item.id}">찜 해제</button>
              <button type="button" class="button button-primary button-sm" data-favorite-detail="${item.id}">상세 보기 ›</button>
            </div>
          </div>`
              )
              .join("")
          : `<div class="empty-panel">아직 찜한 농기계가 없습니다. 마음에 드는 농기계 카드 우측 상단의 찜 버튼을 눌러보세요!</div>`
      }
    </div>
  `);
  $("formContent")
    .querySelectorAll("[data-favorite-detail]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        hideDialog($("formBackdrop"));
        openDetail(button.dataset.favoriteDetail);
      })
    );
  $("formContent")
    .querySelectorAll("[data-fav-remove]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        deps.toggleFavorite(button.dataset.favRemove, { favorite: false, fromModal: true });
      })
    );
}

function resetAllFilters() {
  state.filters = blankFilters();
  state.selectedCrop = "all";
  $("searchInput").value = "";
  persist(deps.updateBadges);
  deps.renderAll();
  toast("모든 검색 조건을 초기화했습니다.");
}


  return {
    setTransaction,
    syncQuickSearchInputs,
    renderCrops,
    renderQuickWizard,
    renderMachineCategoryBar,
    selectOption,
    renderFilterOptions,
    openFilters,
    readDraftFields,
    matches,
    filteredListings,
    renderFilterPreview,
    applyFilters,
    buildFilterChips,
    renderActiveFilters,
    card,
    renderListings,
    openDetail,
    openFavoritesModal,
    resetAllFilters,
  };
}
