// 이 파일은 main.js에서 나눈 모듈이다. 다른 화면 함수는 app(app.js)을 통해 부른다.
// 매물 찾기: 작물·작업 빠른 선택, 상세 필터, 정렬, 매물 카드 목록.
import { app } from "./app.js";
import { allListings, blankFilters, catalogStatus, persist, state } from "./app-state.js";
import { BEGINNER_TIPS } from "./data/beginner-tips.js";
import { CROPS, STAGES, OPERATIONS, MACHINE_TYPES, CROP_OPERATIONS, CROP_BY_ID, OPERATION_BY_ID, MACHINE_BY_ID, distanceKm } from "./data/farm-machines.js";
import { available, compareListings } from "./data/recommendation.js";
import { areaLabel } from "./format.js";
import { favoriteIcon, hasListingPhoto, listingSummary, machineImage, machineVisual, statusClass, statusLabel } from "./listing-view.js";
import { addDays, koreanDateParts, today } from "./time.js";
import { $, escapeHtml, hideDialog, money, pictureIcon, showDialog, toast } from "./ui.js";

let draft = structuredClone(state.filters);
export function setTransaction(type) {
  state.transaction = type;
  $("rentTab").classList.toggle("active", type === "rent");
  $("saleTab").classList.toggle("active", type === "sale");
  $("rentTab").setAttribute("aria-pressed", String(type === "rent"));
  $("saleTab").setAttribute("aria-pressed", String(type === "sale"));
  $("marketSubtitle").textContent =
    type === "rent"
      ? "필요한 날만 합리적으로 빌려 쓰세요. 날짜와 평수를 고르면 더 정확해져요."
      : "오래 쓸 내 농기계를 찾아보세요. 점검 상태와 예산을 비교할 수 있어요.";
  const quickDateBox = $("quickDateBox");
  if (quickDateBox) {
    quickDateBox.classList.toggle("disabled-field", type === "sale");
    $("quickDateInput").disabled = type === "sale";
    $("quickDateEndInput").disabled = type === "sale";
  }
  persist();
  app.renderAll();
}
export function syncQuickSearchInputs() {
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
export function renderCrops() {
  $("cropSelect").value = Object.hasOwn(CROP_BY_ID, state.selectedCrop) ? state.selectedCrop : "all";
  $("cropDescription").textContent = CROP_BY_ID[$("cropSelect").value]?.description || "작물을 고르면 해당 작물에 맞는 작업을 볼 수 있어요.";
}
// 2단계: 작업 단계 및 세부 작업 버튼 렌더링 (초보 농부 맞춤 위저드)
export function renderQuickWizard() {
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
            ? state.filters.stageIds.filter((id) => id !== stageId)
            : [...state.filters.stageIds, stageId];
        }
        state.filters.operations = state.filters.operations.filter((id) =>
          !state.filters.stageIds.length || state.filters.stageIds.includes(OPERATION_BY_ID[id]?.stage)
        );
        persist();
        app.renderAll();
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
        persist();
        app.renderAll();
      })
    );
}
// 기종별 빠른 카테고리 탭바 (쏘카 스타일)
export function renderMachineCategoryBar() {
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
        && hasListingPhoto(item))?.photo;
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
        persist();
        app.renderAll();
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
  const activeCropId = draft.cropIds[0] || (state.selectedCrop !== "all" ? state.selectedCrop : null);
  const recOps = activeCropId ? CROP_OPERATIONS[activeCropId] || [] : [];

  $("filterCrops").innerHTML = selectOption("cropIds", CROPS, draft.cropIds);
  $("filterStages").innerHTML = selectOption("stageIds", STAGES, draft.stageIds);
  const visibleOperations = draft.stageIds.length
    ? OPERATIONS.filter((operation) => draft.stageIds.includes(operation.stage))
    : OPERATIONS;
  $("filterOperations").innerHTML = selectOption("operations", visibleOperations, draft.operations, recOps);
  $("filterMachines").innerHTML = selectOption("machineTypes", MACHINE_TYPES, draft.machineTypes);
  $("filterBrands").innerHTML = selectOption(
    "brands",
    [...new Set(allListings().map((item) => item.brand))].sort().map((brand) => ({ id: brand, label: brand })),
    draft.brands
  );
  $("filterConditions").innerHTML = selectOption(
    "conditions",
    [
      { id: "good", label: "정상 작동 (즉시 사용)", emoji: "" },
      { id: "used", label: "사용감 있음", emoji: "" },
      { id: "repair", label: "정비 필요", emoji: "" },
    ],
    draft.conditions,
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
        `<button type="button" class="preset-chip ${String(draft.maxPrice || "") === p.max ? "active" : ""}" data-price-preset="${p.max}">${p.label}</button>`
    )
    .join("");

  // 면적 프리셋 활성화 표시
  $("areaPresets")
    .querySelectorAll("[data-area-preset]")
    .forEach((btn) => {
      btn.classList.toggle("active", String(draft.areaPyeong || "") === btn.dataset.areaPreset);
    });

  for (const [id, key] of [
    ["minPrice", "minPrice"],
    ["maxPrice", "maxPrice"],
    ["areaInput", "areaPyeong"],
    ["radiusInput", "radius"],
    ["dateInput", "date"],
    ["dateEndInput", "dateEnd"],
  ]) {
    $(id).value = draft[key];
  }
  $("dateInput").min = today();
  renderFilterPreview();
}
function openFilters() {
  draft = structuredClone(state.filters);
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
    draft[key] = $(id).value;
  }
  $("dateEndInput").min = draft.date || today();
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
  if (filters.radius !== "all" && distanceKm(state.region, item.region, item.id) > Number(filters.radius)) return false;
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
    .sort((a, b) => compareListings(a, b, state.region, state.sort));
}
function renderFilterPreview() {
  readDraftFields();
  $("filterPreviewCount").textContent = `${filteredListings(draft).length}개`;
}
function applyFilters() {
  readDraftFields();
  if (draft.minPrice && draft.maxPrice && Number(draft.minPrice) > Number(draft.maxPrice)) {
    toast("최소 금액이 최대 금액보다 큽니다.");
    return;
  }
  if (state.transaction === "rent" && draft.dateEnd && (!draft.date || draft.dateEnd < draft.date)) {
    toast("대여 시작일과 반납일을 확인해 주세요.");
    return;
  }
  state.filters = structuredClone(draft);
  state.selectedCrop = state.filters.cropIds[0] || "all";
  persist();
  hideDialog($("filterBackdrop"));
  app.renderAll();
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
  const summary = listingSummary(item);
  const distance = distanceKm(state.region, item.region, item.id);
  const machineLabel = MACHINE_BY_ID[item.machineType]?.label || "농기계";
  const cropsText = item.cropIds.map((id) => CROP_BY_ID[id]?.name).filter(Boolean).join("·");
  const opsText = item.operations.map((id) => OPERATION_BY_ID[id]?.label).filter(Boolean).slice(0, 2).join(" · ");
  const isFav = app.isFavorite(item.id);
  const sClass = statusClass(item);

  return `
    <article class="listing-card">
      <div class="card-media-wrap">
        <button type="button" class="card-media-btn" data-detail="${item.id}" aria-label="${escapeHtml(item.title)} 상세 보기">
          <div class="machine-art">
            ${machineVisual(item)}
            <div class="art-badges-top">
              <span class="card-status-pill ${sClass}">${statusLabel(item)}</span>
              <span class="art-distance-pill"> ${escapeHtml(item.region)} · ${distance}km</span>
            </div>
            <span class="art-caption">${hasListingPhoto(item) ? "실제 등록 사진" : `${escapeHtml(machineLabel)} AI 예시 이미지`}</span>
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
          <div class="summary-badge">${state.aiSummaries[item.id] ? "✦ AI 농농이 핵심 요약" : " 초보 농부 한줄 안내"}</div>
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
export function renderListings() {
  const items = filteredListings();
  $("resultCount").textContent = `총 ${items.length}대의 농기계 · ${{ distance: "거리순", price: "낮은 가격순", inspection: "최근 점검순" }[state.sort]}`;
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

  if (catalogStatus() !== "ready") {
    const message = catalogStatus() === "loading" ? "우리 동네 농기계 매물을 불러오는 중입니다…" : "데모 매물을 불러오지 못했습니다. 페이지를 새로고침해 주세요.";
    $("resultCount").textContent = message;
    if (!items.length) $("listingGrid").innerHTML = `<div class="empty-state"><strong>${message}</strong></div>`;
  }
  renderActiveFilters();
}
export function resetAllFilters() {
  state.filters = blankFilters();
  state.selectedCrop = "all";
  $("searchInput").value = "";
  persist();
  app.renderAll();
  toast("모든 검색 조건을 초기화했습니다.");
}

// 저장된 화면 상태를 입력칸에 맞춘다.
export function initBrowse() {
  // 초기 상태 동기화
  if (state.selectedCrop && state.selectedCrop !== "all" && !state.filters.cropIds.length) {
    state.filters.cropIds = [state.selectedCrop];
  }
  $("regionSelect").value = state.region;
}

export function bindBrowseEvents() {
  const cropSelect = $("cropSelect");
  cropSelect.add(new Option("전체 작물", "all"));
  for (const { id, name, emoji } of CROPS) cropSelect.add(new Option(emoji + " " + name, id));
  cropSelect.addEventListener("change", () => {
    const chosen = cropSelect.value;
    state.selectedCrop = chosen;
    state.filters.cropIds = chosen === "all" ? [] : [chosen];
    if (chosen !== "all") {
      const operations = CROP_OPERATIONS[chosen] || [];
      state.filters.operations = state.filters.operations.filter((id) => operations.includes(id));
      state.filters.stageIds = state.filters.stageIds.filter((stage) =>
        operations.some((id) => OPERATION_BY_ID[id]?.stage === stage)
      );
    }
    persist();
    app.renderAll();
  });
  $("rentTab").addEventListener("click", () => setTransaction("rent"));
  $("saleTab").addEventListener("click", () => setTransaction("sale"));

  $("regionSelect").addEventListener("change", (event) => {
    state.region = event.target.value;
    persist();
    app.renderAll();
    toast(`내 동네가 '${state.region}'(으)로 설정되었습니다.`);
  });

  // 상단 빠른 검색바 연동
  $("searchInput").addEventListener("input", () => renderListings());
  $("listingSort").value = state.sort;
  $("listingSort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    persist();
    renderListings();
  });

  // Custom-styled sort menu keeps the original select/change behavior intact.
  const sortSelect = $("listingSort");
  const sortTrigger = $("listingSortTrigger");
  const sortMenu = $("listingSortMenu");
  const sortCurrent = $("listingSortCurrent");
  const sortOptions = [...document.querySelectorAll(".listing-sort-option")];
  const closeSortMenu = () => {
    sortMenu.hidden = true;
    sortTrigger.setAttribute("aria-expanded", "false");
  };
  const syncSortMenu = () => {
    const selected = sortSelect.selectedOptions[0];
    sortCurrent.textContent = selected?.textContent || "최근 점검순";
    sortOptions.forEach((option) => {
      const active = option.dataset.sortValue === sortSelect.value;
      option.setAttribute("aria-selected", String(active));
    });
  };
  syncSortMenu();
  sortTrigger.addEventListener("click", () => {
    const willOpen = sortMenu.hidden;
    sortMenu.hidden = !willOpen;
    sortTrigger.setAttribute("aria-expanded", String(willOpen));
  });
  sortOptions.forEach((option) => {
    option.addEventListener("click", () => {
      sortSelect.value = option.dataset.sortValue;
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
      syncSortMenu();
      closeSortMenu();
      sortTrigger.focus();
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".listing-sort-picker")) closeSortMenu();
  });
  sortTrigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSortMenu();
  });
  sortSelect.addEventListener("change", syncSortMenu);
  $("quickSearchBtn")?.addEventListener("click", () => {
    renderListings();
    app.setView("browse");
  });
  $("quickDateInput")?.addEventListener("change", (event) => {
    state.filters.date = event.target.value;
    if (!state.filters.date || state.filters.dateEnd < state.filters.date) state.filters.dateEnd = state.filters.date ? addDays(state.filters.date, 1) : "";
    persist();
    app.renderAll();
  });
  $("quickDateEndInput")?.addEventListener("change", (event) => {
    const end = event.target.value;
    if (!state.filters.date) state.filters.date = today();
    state.filters.dateEnd = end && end >= state.filters.date ? end : state.filters.date;
    persist();
    app.renderAll();
  });
  // 날짜 칸 어디를 눌러도 달력이 열리게
  for (const id of ["quickDateInput", "quickDateEndInput"]) {
    $(id)?.closest(".qs-date")?.addEventListener("click", (event) => {
      const input = $(id);
      if (input.disabled) return;
      if (event.target !== input) event.preventDefault();
      try { input.showPicker?.(); } catch { input.focus(); }
    });
  }
  $("clearQuickDate")?.addEventListener("click", () => {
    state.filters.date = "";
    state.filters.dateEnd = "";
    persist();
    app.renderAll();
  });
  $("quickRadiusSelect")?.addEventListener("change", (event) => {
    state.filters.radius = event.target.value;
    persist();
    app.renderAll();
  });

  $("guideResults").addEventListener("click", () => {
    app.setView("browse");
    $("marketTitle").focus();
  });
  $("openFilters").addEventListener("click", () => openFilters());
  $("inlineResetFilters")?.addEventListener("click", resetAllFilters);

  // 활성 필터 칩 개별 제거
  $("activeFilters").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-remove-group]");
    if (!chip) return;
    const group = chip.dataset.removeGroup;
    const val = chip.dataset.removeVal;
    if (Array.isArray(state.filters[group])) {
      state.filters[group] = state.filters[group].filter((item) => item !== val);
      if (group === "cropIds") state.selectedCrop = state.filters.cropIds[0] || "all";
    } else {
      state.filters[group] = val;
      if (group === "date") state.filters.dateEnd = "";
    }
    persist();
    app.renderAll();
  });

  // 상세 필터 모달 이벤트
  $("closeFilters").addEventListener("click", () => hideDialog($("filterBackdrop")));
  $("applyFilters").addEventListener("click", applyFilters);
  $("resetFilters").addEventListener("click", () => {
    draft = blankFilters();
    renderFilterOptions();
  });

  $("filterBackdrop").addEventListener("change", (event) => {
    const input = event.target.closest("[data-filter-group]");
    if (input) {
      const list = draft[input.dataset.filterGroup];
      draft[input.dataset.filterGroup] = input.checked ? [...new Set([...list, input.value])] : list.filter((value) => value !== input.value);
      if (input.dataset.filterGroup === "stageIds") {
        draft.operations = draft.operations.filter((id) => !draft.stageIds.length || draft.stageIds.includes(OPERATION_BY_ID[id]?.stage));
      }
      renderFilterOptions();
      return;
    }
    renderFilterPreview();
  });

  $("filterBackdrop").addEventListener("click", (event) => {
    const areaPreset = event.target.closest("[data-area-preset]");
    if (areaPreset) {
      draft.areaPyeong = areaPreset.dataset.areaPreset;
      $("areaInput").value = draft.areaPyeong;
      renderFilterOptions();
      return;
    }
    const pricePreset = event.target.closest("[data-price-preset]");
    if (pricePreset) {
      draft.maxPrice = pricePreset.dataset.pricePreset;
      $("maxPrice").value = draft.maxPrice;
      renderFilterOptions();
      return;
    }
    if (event.target === $("filterBackdrop")) hideDialog($("filterBackdrop"));
  });

  $("filterBackdrop").addEventListener("input", renderFilterPreview);
  $("listingGrid").addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-detail]");
    if (detailButton) return app.openDetail(detailButton.dataset.detail);
    const favoriteButton = event.target.closest("[data-favorite]");
    if (favoriteButton) return app.toggleFavorite(favoriteButton.dataset.favorite);
    if (event.target.closest("[data-reset-all]")) resetAllFilters();
  });
}
