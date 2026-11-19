import { SPEC_BY_ID } from "../data/machine-specifications.js";
import { CROPS, STAGES, OPERATIONS, MACHINE_TYPES, CROP_OPERATIONS, CROP_BY_ID, OPERATION_BY_ID, MACHINE_BY_ID, distanceKm } from "../data/farm-machines.js";
import { available, compareListings } from "../data/recommendation.js";
import { $, escapeHtml, money, toPyeong, areaLabel, areaFullLabel, today, addDays, koreanDateParts, BEGINNER_TIPS, pictureIcon, favoriteIcon, toast, showDialog, hideDialog, machineImage } from "../core/utils.js";
import { state, runtime, blankFilters, persist, allListings, listingById, rentedNow, statusLabel, statusClass, activeFavorites, isLoggedIn } from "../core/store.js";
import { activeDistanceOrigin, renderWeatherBanner, renderListingMap, renderCatalogMiniMap, weatherDetailNote, refreshWeatherAndMapConfig } from "./map-weather.js";

const SORT_LABELS = {
  recommended: "추천순",
  distance: "거리순",
  price: "낮은 가격순",
  priceDesc: "높은 가격순",
  inspection: "최근 점검순",
};

const CATALOG_TIME_OPTIONS = [
  "06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
];

const MACHINE_FOLDER_DEFS = [
  { id: "power", label: "동력기·경운", ids: ["tractor", "cultivator", "ridingCultivator", "tiller"] },
  { id: "soil", label: "밭·논 준비 작업기", ids: ["rotavator", "plow", "ridgeMulcher", "ridger", "spreader"] },
  { id: "plant", label: "파종·이식기", ids: ["ricePlanter", "transplanter", "potatoPlanter", "garlicOnionPlanter", "seeder"] },
  { id: "care", label: "방제·제초·관리", ids: ["speedSprayer", "agriDrone", "sprayer", "mower", "shredder"] },
  { id: "harvest", label: "수확·탈곡·가공", ids: ["combine", "potatoHarvester", "rootHarvester", "forageHarvester", "thresher", "baler", "dryer", "sorter"] },
  { id: "transport", label: "운반·굴착·과수", ids: ["carrier", "excavator", "aerialLift", "loader"] },
];

function groupMachineTypes() {
  const assigned = new Set();
  const groups = MACHINE_FOLDER_DEFS.map((def) => {
    const items = def.ids
      .map((id) => MACHINE_BY_ID[id])
      .filter(Boolean);
    items.forEach((m) => assigned.add(m.id));
    return { id: def.id, label: def.label, items };
  }).filter((g) => g.items.length > 0);
  const rest = MACHINE_TYPES.filter((m) => !assigned.has(m.id));
  if (rest.length) groups.push({ id: "other", label: "기타 기종", items: rest });
  return groups;
}

function groupCropsByCategory() {
  const map = new Map();
  for (const crop of CROPS) {
    const cat = crop.category || "기타 작물";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(crop);
  }
  return [...map.entries()].map(([label, items], idx) => ({
    id: `crop-cat-${idx}`,
    label,
    items,
  }));
}

export function createCatalogViews(deps) {
let lastPreviewCount = null;
let previewCountRaf = 0;
let splitLayoutInitialized = false;
let selectedMiniMapId = "";
let mobileFiltersOpen = false;
const openMachineFolders = new Set();
const openCropFolders = new Set();
const openModalFolders = new Set();

function ensureSortOptions() {
  if (typeof document === "undefined") return;
  const sortSelect = $("listingSort");
  const sortMenu = $("listingSortMenu");
  if (!sortSelect || !sortMenu) return;

  const desired = [
    ["recommended", "추천순"],
    ["distance", "거리순"],
    ["price", "낮은 가격순"],
    ["priceDesc", "높은 가격순"],
    ["inspection", "최근 점검순"],
  ];

  // Rebuild options cleanly before main.js bindEvents() queries .listing-sort-option
  const existingValues = new Set([...sortSelect.options].map((o) => o.value));
  if (existingValues.has("recommended") && existingValues.has("priceDesc")) return;

  sortSelect.innerHTML = desired
    .map(([val, label]) => `<option value="${val}">${label}</option>`)
    .join("");
  sortMenu.innerHTML = desired
    .map(([val, label]) => `<button type="button" class="listing-sort-option" role="option" data-sort-value="${val}">${label}</button>`)
    .join("");
  if (state.sort && desired.some(([val]) => val === state.sort)) {
    sortSelect.value = state.sort;
  }
}

function renderMiniMapSelectedBanner(item) {
  const banner = $("catalogMiniMapSelected");
  if (!banner) return;
  if (!item) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  const dist = distanceKm(activeDistanceOrigin(), item.region, item.id);
  banner.hidden = false;
  banner.innerHTML = `
    <div class="catalog-minimap-sel-copy">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.region)} · ${dist}km · ${money(item.price)}${item.type === "rent" ? "/일" : ""}</span>
    </div>
    <div class="catalog-minimap-sel-actions">
      <button type="button" class="button button-primary button-sm" data-minimap-detail="${escapeHtml(item.id)}">상세</button>
      <button type="button" class="catalog-minimap-sel-clear" data-minimap-clear aria-label="선택 해제">×</button>
    </div>
  `;
}

function highlightListingCard(id, { scroll = true } = {}) {
  selectedMiniMapId = id || "";
  const grid = $("listingGrid");
  if (!grid) return;
  let targetCard = null;
  grid.querySelectorAll(".listing-card").forEach((cardEl) => {
    const match = Boolean(id && cardEl.dataset.listingId === id);
    cardEl.classList.toggle("is-map-selected", match);
    if (match) targetCard = cardEl;
  });
  if (scroll && targetCard) {
    targetCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function ensureSplitLayout() {
  if (splitLayoutInitialized || typeof document === "undefined") return;
  const market = $("market");
  const listingGrid = $("listingGrid");
  if (!market || !listingGrid) return;
  splitLayoutInitialized = true;

  ensureSortOptions();
  market.classList.add("catalog-split-active");

  const splitShell = document.createElement("div");
  splitShell.className = "catalog-split-shell";
  splitShell.id = "catalogSplitShell";

  const sidebar = document.createElement("aside");
  sidebar.className = "catalog-sidebar";
  sidebar.id = "catalogSidebar";
  sidebar.setAttribute("aria-label", "매물 지도 및 검색 필터");
  sidebar.innerHTML = `
    <div class="catalog-minimap-card">
      <div id="catalogMiniMapHost" class="catalog-minimap-host"></div>
      <div id="catalogMiniMapSelected" class="catalog-minimap-selected" hidden aria-live="polite"></div>
    </div>

    <button type="button" class="catalog-mobile-filter-toggle" id="catalogMobileFilterToggle" aria-expanded="false" aria-controls="catalogSidebarFilters">
      <span>상세 필터</span>
      <span class="catalog-mobile-filter-badge" id="catalogMobileFilterBadge" hidden>0</span>
      <span class="catalog-mobile-filter-caret" aria-hidden="true">▾</span>
    </button>

    <div class="catalog-sidebar-filters" id="catalogSidebarFilters">
      <div class="csf-head">
        <h3>검색 필터</h3>
        <button type="button" class="csf-reset-btn" id="sidebarResetFiltersBtn">초기화</button>
      </div>

      <div class="csf-section">
        <label class="csf-label" for="sidebarSearchInput">키워드 검색</label>
        <input type="search" id="sidebarSearchInput" class="csf-input" placeholder="기종, 작업, 브랜드, 지역 검색" autocomplete="off" />
      </div>

      <div class="csf-section">
        <span class="csf-label">거래 유형</span>
        <div class="csf-tx-group" role="group" aria-label="거래 유형 선택">
          <button type="button" class="csf-tx-btn" data-sidebar-tx="rent">일일 대여</button>
          <button type="button" class="csf-tx-btn" data-sidebar-tx="sale">중고 구매</button>
        </div>
      </div>

      <div class="csf-section">
        <div class="csf-label-row">
          <span class="csf-label" id="sidebarPriceLabel">가격 범위</span>
          <span class="csf-price-readout" id="sidebarPriceReadout">전체</span>
        </div>
        <input type="range" id="sidebarPriceSlider" class="csf-range" min="0" max="250000" step="10000" value="250000" aria-label="최대 가격 슬라이더" />
        <div class="csf-price-inputs">
          <input type="number" id="sidebarMinPrice" class="csf-input csf-num" min="0" step="10000" placeholder="최소 금액" aria-label="최소 금액" />
          <span class="csf-price-tilde" aria-hidden="true">~</span>
          <input type="number" id="sidebarMaxPrice" class="csf-input csf-num" min="0" step="10000" placeholder="최대 금액" aria-label="최대 금액" />
        </div>
        <div class="csf-price-presets" id="sidebarPricePresets"></div>
      </div>

      <div class="csf-section">
        <span class="csf-label">이동 거리</span>
        <div class="csf-radius-group" id="sidebarRadiusGroup" role="group" aria-label="이동 거리 선택">
          <button type="button" class="csf-pill-btn" data-sidebar-radius="all">전체</button>
          <button type="button" class="csf-pill-btn" data-sidebar-radius="10">10km</button>
          <button type="button" class="csf-pill-btn" data-sidebar-radius="20">20km</button>
          <button type="button" class="csf-pill-btn" data-sidebar-radius="30">30km</button>
        </div>
      </div>

      <div class="csf-section">
        <span class="csf-label">농기계 기종</span>
        <div class="csf-check-list" id="sidebarMachineList"></div>
      </div>

      <div class="csf-section">
        <span class="csf-label">추천 작물</span>
        <div class="csf-check-list csf-check-grid" id="sidebarCropList"></div>
      </div>

      <div class="csf-section">
        <span class="csf-label">기계 상태</span>
        <div class="csf-check-list" id="sidebarConditionList"></div>
      </div>

      <button type="button" class="button button-secondary csf-more-btn" id="sidebarOpenFullFilters">
        평수·세부 작업 필터 더보기
      </button>
    </div>
  `;

  const mainCol = document.createElement("div");
  mainCol.className = "catalog-main";
  mainCol.id = "catalogMain";

  // Move existing market result elements into the right main column, preserving IDs & listeners
  // Do NOT render the large inline map (#listingMapPanel) inside #market; only the left sidebar mini-map is used.
  const toolbar = market.querySelector(".toolbar");
  const weatherBanner = $("rentalWeatherBanner");
  const mapPanel = $("listingMapPanel");
  if (mapPanel) {
    mapPanel.hidden = true;
    mapPanel.innerHTML = "";
  }

  if (toolbar) mainCol.appendChild(toolbar);
  if (weatherBanner) mainCol.appendChild(weatherBanner);
  mainCol.appendChild(listingGrid);

  splitShell.append(sidebar, mainCol);
  market.appendChild(splitShell);

  // Inject Time Picker button right alongside dates only if index.html does not already provide #quickTimeBtn
  const quickDateBox = $("quickDateBox");
  if (quickDateBox && !$("quickTimeBtn") && !$("catalogTimeBox")) {
    const timeBox = document.createElement("div");
    timeBox.className = "qs-field qs-time-field";
    timeBox.id = "catalogTimeBox";
    const startT = state.filters.startTime || "09:00";
    const endT = state.filters.endTime || "18:00";
    timeBox.innerHTML = `
      <span class="qs-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg></span>
      <button type="button" class="qs-time-trigger" id="catalogTimeBtn" aria-haspopup="dialog" aria-expanded="false">
        <span class="qs-time-kicker">시간 선택</span>
        <strong id="catalogTimeLabel">${escapeHtml(startT)}–${escapeHtml(endT)}</strong>
      </button>
      <div class="qs-time-pop" id="catalogTimePop" role="dialog" aria-label="대여 시간 선택" hidden>
        <div class="qs-time-presets">
          <button type="button" class="qs-time-preset" data-cat-time-preset="08:00,12:00">오전 (08~12)</button>
          <button type="button" class="qs-time-preset" data-cat-time-preset="13:00,18:00">오후 (13~18)</button>
          <button type="button" class="qs-time-preset" data-cat-time-preset="09:00,18:00">종일 (09~18)</button>
        </div>
        <div class="qs-time-selects">
          <label><span>시작</span><select id="catalogStartTime">${CATALOG_TIME_OPTIONS.map((t) => `<option value="${t}"${startT === t ? " selected" : ""}>${t}</option>`).join("")}</select></label>
          <label><span>종료</span><select id="catalogEndTime">${CATALOG_TIME_OPTIONS.map((t) => `<option value="${t}"${endT === t ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        </div>
      </div>
    `;
    quickDateBox.insertAdjacentElement("afterend", timeBox);

    const syncCatalogTime = () => {
      const s = state.filters.startTime || "09:00";
      const en = state.filters.endTime || "18:00";
      if ($("catalogTimeLabel")) $("catalogTimeLabel").textContent = `${s}–${en}`;
      if ($("catalogStartTime")) $("catalogStartTime").value = s;
      if ($("catalogEndTime")) $("catalogEndTime").value = en;
      if ($("homeTimeText")) $("homeTimeText").textContent = `${s}–${en}`;
      if ($("headerMapTimeLabel")) $("headerMapTimeLabel").textContent = `${s}–${en}`;
    };

    $("catalogTimeBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const pop = $("catalogTimePop");
      if (!pop || $("catalogTimeBtn")?.disabled) return;
      const open = pop.hidden;
      pop.hidden = !open;
      $("catalogTimeBtn")?.setAttribute("aria-expanded", String(open));
    });

    $("catalogTimePop")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const preset = e.target.closest("[data-cat-time-preset]");
      if (!preset) return;
      const [s, en] = preset.dataset.catTimePreset.split(",");
      state.filters.startTime = s;
      state.filters.endTime = en;
      persist(deps.updateBadges);
      syncCatalogTime();
      $("catalogTimePop").hidden = true;
      $("catalogTimeBtn")?.setAttribute("aria-expanded", "false");
    });

    const onSelectChange = () => {
      const s = $("catalogStartTime")?.value || "09:00";
      let en = $("catalogEndTime")?.value || "18:00";
      if (en <= s) en = s;
      state.filters.startTime = s;
      state.filters.endTime = en;
      persist(deps.updateBadges);
      syncCatalogTime();
    };
    $("catalogStartTime")?.addEventListener("change", onSelectChange);
    $("catalogEndTime")?.addEventListener("change", onSelectChange);

    document.addEventListener("click", (e) => {
      const pop = $("catalogTimePop");
      if (pop && !pop.hidden && !timeBox.contains(e.target)) {
        pop.hidden = true;
        $("catalogTimeBtn")?.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Persist open/closed state of nested sidebar folders across re-renders
  sidebar.addEventListener("toggle", (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    const mFolder = details.dataset.machineFolder;
    if (mFolder) {
      if (details.open) openMachineFolders.add(mFolder);
      else openMachineFolders.delete(mFolder);
    }
    const cFolder = details.dataset.cropFolder;
    if (cFolder) {
      if (details.open) openCropFolders.add(cFolder);
      else openCropFolders.delete(cFolder);
    }
  }, true);

  // Wire sidebar events
  $("catalogMobileFilterToggle")?.addEventListener("click", () => {
    mobileFiltersOpen = !mobileFiltersOpen;
    const panel = $("catalogSidebarFilters");
    const toggle = $("catalogMobileFilterToggle");
    if (panel) panel.classList.toggle("is-mobile-open", mobileFiltersOpen);
    if (toggle) toggle.setAttribute("aria-expanded", String(mobileFiltersOpen));
  });

  $("sidebarResetFiltersBtn")?.addEventListener("click", () => resetAllFilters());
  $("sidebarOpenFullFilters")?.addEventListener("click", () => openFilters());

  $("catalogMiniMapSelected")?.addEventListener("click", (event) => {
    const detailBtn = event.target.closest("[data-minimap-detail]");
    if (detailBtn) {
      openDetail(detailBtn.dataset.minimapDetail);
      return;
    }
    if (event.target.closest("[data-minimap-clear]")) {
      highlightListingCard("", { scroll: false });
      renderMiniMapSelectedBanner(null);
    }
  });

  $("sidebarSearchInput")?.addEventListener("input", (event) => {
    const topSearch = $("searchInput");
    if (topSearch && topSearch.value !== event.target.value) {
      topSearch.value = event.target.value;
    }
    renderListings();
  });

  sidebar.addEventListener("click", (event) => {
    const txBtn = event.target.closest("[data-sidebar-tx]");
    if (txBtn) {
      setTransaction(txBtn.dataset.sidebarTx);
      return;
    }
    const radiusBtn = event.target.closest("[data-sidebar-radius]");
    if (radiusBtn) {
      state.filters.radius = radiusBtn.dataset.sidebarRadius;
      if ($("quickRadiusSelect")) $("quickRadiusSelect").value = state.filters.radius;
      persist(deps.updateBadges);
      deps.renderAll();
      return;
    }
    const presetBtn = event.target.closest("[data-sidebar-price-preset]");
    if (presetBtn) {
      state.filters.maxPrice = presetBtn.dataset.sidebarPricePreset;
      persist(deps.updateBadges);
      deps.renderAll();
    }
  });

  const applySidebarPriceInputs = () => {
    const minVal = $("sidebarMinPrice")?.value?.trim() || "";
    const maxVal = $("sidebarMaxPrice")?.value?.trim() || "";
    state.filters.minPrice = minVal;
    state.filters.maxPrice = maxVal;
    persist(deps.updateBadges);
    renderListings();
  };

  $("sidebarMinPrice")?.addEventListener("change", applySidebarPriceInputs);
  $("sidebarMaxPrice")?.addEventListener("change", applySidebarPriceInputs);

  $("sidebarPriceSlider")?.addEventListener("input", (event) => {
    const slider = event.target;
    const val = Number(slider.value);
    const maxLimit = Number(slider.max);
    state.filters.maxPrice = val >= maxLimit ? "" : String(val);
    if ($("sidebarMaxPrice")) $("sidebarMaxPrice").value = state.filters.maxPrice;
    if ($("sidebarPriceReadout")) {
      $("sidebarPriceReadout").textContent = state.filters.maxPrice ? `${money(state.filters.maxPrice)} 이하` : "전체";
    }
    renderListings();
  });

  $("sidebarPriceSlider")?.addEventListener("change", () => {
    persist(deps.updateBadges);
  });

  sidebar.addEventListener("change", (event) => {
    const cb = event.target.closest("input[data-sidebar-group]");
    if (!cb) return;
    const group = cb.dataset.sidebarGroup;
    const val = cb.value;
    const current = Array.isArray(state.filters[group]) ? state.filters[group] : [];
    state.filters[group] = cb.checked ? [...new Set([...current, val])] : current.filter((v) => v !== val);
    if (group === "cropIds") {
      state.selectedCrop = state.filters.cropIds[0] || "all";
    }
    persist(deps.updateBadges);
    deps.renderAll();
  });
}

function renderSidebarFilters() {
  if (!splitLayoutInitialized) return;
  const sidebarSearch = $("sidebarSearchInput");
  const topSearch = $("searchInput");
  if (sidebarSearch && topSearch && document.activeElement !== sidebarSearch) {
    sidebarSearch.value = topSearch.value;
  }

  document.querySelectorAll("[data-sidebar-tx]").forEach((btn) => {
    const active = btn.dataset.sidebarTx === state.transaction;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  const isRent = state.transaction === "rent";
  const sliderMax = isRent ? 250000 : 15000000;
  const sliderStep = isRent ? 10000 : 500000;
  const slider = $("sidebarPriceSlider");
  const priceLabel = $("sidebarPriceLabel");
  const priceReadout = $("sidebarPriceReadout");
  const minInput = $("sidebarMinPrice");
  const maxInput = $("sidebarMaxPrice");

  if (priceLabel) priceLabel.textContent = isRent ? "1일 대여료" : "중고 구매가";
  if (slider) {
    slider.max = String(sliderMax);
    slider.step = String(sliderStep);
    const curMax = Number(state.filters.maxPrice);
    slider.value = curMax > 0 && curMax < sliderMax ? String(curMax) : String(sliderMax);
  }
  if (minInput && document.activeElement !== minInput) minInput.value = state.filters.minPrice || "";
  if (maxInput && document.activeElement !== maxInput) maxInput.value = state.filters.maxPrice || "";
  if (priceReadout) {
    if (state.filters.minPrice && state.filters.maxPrice) {
      priceReadout.textContent = `${money(state.filters.minPrice)} ~ ${money(state.filters.maxPrice)}`;
    } else if (state.filters.maxPrice) {
      priceReadout.textContent = `${money(state.filters.maxPrice)} 이하`;
    } else if (state.filters.minPrice) {
      priceReadout.textContent = `${money(state.filters.minPrice)} 이상`;
    } else {
      priceReadout.textContent = "전체";
    }
  }

  const presetsEl = $("sidebarPricePresets");
  if (presetsEl) {
    const presets = isRent
      ? [
          { label: "전체", max: "" },
          { label: "5만↓", max: "50000" },
          { label: "7만↓", max: "70000" },
          { label: "10만↓", max: "100000" },
        ]
      : [
          { label: "전체", max: "" },
          { label: "300만↓", max: "3000000" },
          { label: "600만↓", max: "6000000" },
          { label: "1,000만↓", max: "10000000" },
        ];
    presetsEl.innerHTML = presets
      .map((p) => `<button type="button" class="csf-chip${String(state.filters.maxPrice || "") === p.max ? " is-active" : ""}" data-sidebar-price-preset="${p.max}">${p.label}</button>`)
      .join("");
  }

  document.querySelectorAll("[data-sidebar-radius]").forEach((btn) => {
    const active = (state.filters.radius || "all") === btn.dataset.sidebarRadius;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  const machineListEl = $("sidebarMachineList");
  if (machineListEl) {
    const baseWithoutMachine = filteredListings({ ...state.filters, machineTypes: [] });
    const countByType = new Map();
    for (const item of baseWithoutMachine) {
      countByType.set(item.machineType, (countByType.get(item.machineType) || 0) + 1);
    }
    const folders = groupMachineTypes();
    machineListEl.innerHTML = folders
      .map((folder) => {
        const selectedInFolder = folder.items.filter((m) => state.filters.machineTypes.includes(m.id)).length;
        const totalInFolder = folder.items.reduce((sum, m) => sum + (countByType.get(m.id) || 0), 0);
        const isOpen = openMachineFolders.has(folder.id) || selectedInFolder > 0;
        return `
          <details class="csf-folder" data-machine-folder="${escapeHtml(folder.id)}"${isOpen ? " open" : ""}>
            <summary class="csf-folder-summary">
              <span class="csf-folder-caret" aria-hidden="true">▸</span>
              <span class="csf-folder-title">${escapeHtml(folder.label)}</span>
              ${selectedInFolder ? `<span class="csf-folder-sel">${selectedInFolder}</span>` : ""}
              <span class="csf-folder-count">${totalInFolder}</span>
            </summary>
            <div class="csf-folder-body">
              ${folder.items
                .map((m) => {
                  const count = countByType.get(m.id) || 0;
                  const checked = state.filters.machineTypes.includes(m.id);
                  return `
                    <label class="csf-check-row${checked ? " is-checked" : ""}">
                      <input type="checkbox" data-sidebar-group="machineTypes" value="${escapeHtml(m.id)}" ${checked ? "checked" : ""} />
                      <span class="csf-check-text">${escapeHtml(m.label)}</span>
                      <span class="csf-check-count">${count}</span>
                    </label>
                  `;
                })
                .join("")}
            </div>
          </details>
        `;
      })
      .join("");
  }

  const cropListEl = $("sidebarCropList");
  if (cropListEl) {
    const cropFolders = groupCropsByCategory();
    cropListEl.classList.remove("csf-check-grid");
    cropListEl.innerHTML = cropFolders
      .map((folder) => {
        const selectedInFolder = folder.items.filter((c) => state.filters.cropIds.includes(c.id)).length;
        const isOpen = openCropFolders.has(folder.id) || selectedInFolder > 0;
        return `
          <details class="csf-folder" data-crop-folder="${escapeHtml(folder.id)}"${isOpen ? " open" : ""}>
            <summary class="csf-folder-summary">
              <span class="csf-folder-caret" aria-hidden="true">▸</span>
              <span class="csf-folder-title">${escapeHtml(folder.label)}</span>
              ${selectedInFolder ? `<span class="csf-folder-sel">${selectedInFolder}</span>` : ""}
              <span class="csf-folder-count">${folder.items.length}</span>
            </summary>
            <div class="csf-folder-body csf-folder-grid">
              ${folder.items
                .map((crop) => {
                  const checked = state.filters.cropIds.includes(crop.id);
                  return `
                    <label class="csf-check-row${checked ? " is-checked" : ""}">
                      <input type="checkbox" data-sidebar-group="cropIds" value="${escapeHtml(crop.id)}" ${checked ? "checked" : ""} />
                      <span class="csf-check-text">${escapeHtml(crop.name)}</span>
                    </label>
                  `;
                })
                .join("")}
            </div>
          </details>
        `;
      })
      .join("");
  }

  const condListEl = $("sidebarConditionList");
  if (condListEl) {
    const conditions = [
      { id: "good", label: "정상 작동" },
      { id: "used", label: "사용감 있음" },
      { id: "repair", label: "정비 필요" },
    ];
    condListEl.innerHTML = conditions
      .map((cond) => {
        const checked = state.filters.conditions.includes(cond.id);
        return `
          <label class="csf-check-row${checked ? " is-checked" : ""}">
            <input type="checkbox" data-sidebar-group="conditions" value="${cond.id}" ${checked ? "checked" : ""} />
            <span class="csf-check-text">${cond.label}</span>
          </label>
        `;
      })
      .join("");
  }

  const mobileBadge = $("catalogMobileFilterBadge");
  if (mobileBadge) {
    const chipCount = buildFilterChips().length;
    mobileBadge.hidden = chipCount === 0;
    mobileBadge.textContent = String(chipCount);
  }
}

ensureSplitLayout();

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
  const catalogTimeBox = $("catalogTimeBox");
  if (catalogTimeBox) {
    catalogTimeBox.classList.toggle("disabled-field", type === "sale");
    if ($("catalogTimeBtn")) $("catalogTimeBtn").disabled = type === "sale";
    if (type === "sale" && $("catalogTimePop")) $("catalogTimePop").hidden = true;
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
  if ($("catalogTimeLabel")) {
    const startT = state.filters.startTime || "09:00";
    const endT = state.filters.endTime || "18:00";
    $("catalogTimeLabel").textContent = `${startT}–${endT}`;
    if ($("catalogStartTime")) $("catalogStartTime").value = startT;
    if ($("catalogEndTime")) $("catalogEndTime").value = endT;
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
    ? `${crop.name} 농사${activeOpId ? ` · '${OPERATION_BY_ID[activeOpId]?.label}'` : ""} 팁`
    : `초보 농부를 위한 농기계 선택 팁`;

  const calloutIcon = $("cropCallout")?.querySelector(".callout-icon");
  if (calloutIcon) calloutIcon.hidden = true;
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

// 기종별 빠른 카테고리 탭바 (텍스트 전용)
function renderMachineCategoryBar() {
  const baseFiltersWithoutMachine = { ...state.filters, machineTypes: [] };
  const baseMatching = filteredListings(baseFiltersWithoutMachine);
  const isAll = state.filters.machineTypes.length === 0;

  const tabs = [
    `<button type="button" class="machine-tab ${isAll ? "active" : ""}" data-machine-tab="all" aria-pressed="${isAll}">
      <span class="mt-caption"><span class="mt-name">전체 기종</span><span class="mt-count">${baseMatching.length}</span></span>
    </button>`,
    ...MACHINE_TYPES.map((m) => {
      const count = baseMatching.filter((item) => item.machineType === m.id).length;
      const active = state.filters.machineTypes.includes(m.id);
      return `
        <button type="button" class="machine-tab ${active ? "active" : ""}" data-machine-tab="${m.id}" aria-pressed="${active}">
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

// 상세 필터 모달 내부 옵션 렌더링 (이모지·썸네일 제거, 깔끔한 텍스트 체크박스)
function selectOption(group, values, checked, recommendedIds = []) {
  return values
    .map((item) => {
      const isChecked = checked.includes(item.id);
      const isRec = recommendedIds.includes(item.id);
      return `
        <label class="option ${isChecked ? "is-checked" : ""} ${isRec ? "is-recommended" : ""}">
          <input type="checkbox" data-filter-group="${group}" value="${item.id}" ${isChecked ? "checked" : ""}>
          <span class="opt-text">${escapeHtml(item.label || item.name)}</span>
          ${isRec ? `<span class="opt-rec-badge">추천</span>` : ""}
        </label>
      `;
    })
    .join("");
}

function renderFolderizedOptions(group, folders, checked) {
  return folders
    .map((folder) => {
      const selCount = folder.items.filter((it) => checked.includes(it.id)).length;
      const folderKey = `${group}:${folder.id}`;
      const isOpen = openModalFolders.has(folderKey) || selCount > 0;
      return `
        <details class="filter-folder" data-modal-folder="${escapeHtml(folderKey)}"${isOpen ? " open" : ""}>
          <summary class="filter-folder-summary">
            <span class="filter-folder-caret" aria-hidden="true">▸</span>
            <span class="filter-folder-title">${escapeHtml(folder.label)}</span>
            ${selCount ? `<span class="filter-folder-sel">${selCount}개 선택</span>` : ""}
            <span class="filter-folder-count">${folder.items.length}</span>
          </summary>
          <div class="filter-folder-options">
            ${selectOption(group, folder.items, checked)}
          </div>
        </details>
      `;
    })
    .join("");
}

function renderFilterOptions() {
  const activeCropId = runtime.draft.cropIds[0] || (state.selectedCrop !== "all" ? state.selectedCrop : null);
  const recOps = activeCropId ? CROP_OPERATIONS[activeCropId] || [] : [];

  $("filterCrops").classList.add("is-folderized");
  $("filterCrops").innerHTML = renderFolderizedOptions("cropIds", groupCropsByCategory(), runtime.draft.cropIds);
  $("filterStages").innerHTML = selectOption("stageIds", STAGES, runtime.draft.stageIds);
  const visibleOperations = runtime.draft.stageIds.length
    ? OPERATIONS.filter((operation) => runtime.draft.stageIds.includes(operation.stage))
    : OPERATIONS;
  $("filterOperations").innerHTML = selectOption("operations", visibleOperations, runtime.draft.operations, recOps);
  $("filterMachines").classList.add("is-folderized");
  $("filterMachines").innerHTML = renderFolderizedOptions("machineTypes", groupMachineTypes(), runtime.draft.machineTypes);
  $("filterBackdrop")?.querySelectorAll("details[data-modal-folder]").forEach((det) => {
    det.addEventListener("toggle", () => {
      const key = det.dataset.modalFolder;
      if (!key) return;
      if (det.open) openModalFolders.add(key);
      else openModalFolders.delete(key);
    });
  });
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

function sortListings(items, origin, sort) {
  return [...items].sort((a, b) => {
    if (sort === "priceDesc" && a.price !== b.price) return b.price - a.price;
    if (sort === "recommended") {
      const aGood = a.condition === "good" ? 0 : 1;
      const bGood = b.condition === "good" ? 0 : 1;
      if (aGood !== bGood) return aGood - bGood;
      return compareListings(a, b, origin, "distance");
    }
    return compareListings(a, b, origin, sort);
  });
}

function filteredListings(filters = state.filters, { ignoreQuery = false } = {}) {
  const query = ignoreQuery ? "" : ($("searchInput")?.value || "").trim().toLowerCase();
  const origin = activeDistanceOrigin();
  const matched = allListings().filter(
    (item) =>
      matches(item, filters) &&
      (!query ||
        `${item.title} ${item.brand} ${item.region || ""} ${item.description} ${MACHINE_BY_ID[item.machineType]?.label || ""} ${item.operations
          .map((id) => OPERATION_BY_ID[id]?.label)
          .join(" ")}`
          .toLowerCase()
          .includes(query))
  );
  return sortListings(matched, origin, state.sort);
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
  f.cropIds.forEach((id) => chips.push({ group: "cropIds", value: id, label: CROP_BY_ID[id]?.name }));
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
  const isMapSelected = item.id === selectedMiniMapId;

  return `
    <article class="listing-card${isMapSelected ? " is-map-selected" : ""}" data-listing-id="${escapeHtml(item.id)}">
      <div class="card-media-wrap">
        <button type="button" class="card-media-btn" data-detail="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 상세 보기">
          <div class="machine-art">
            ${deps.machineVisual(item)}
            <div class="art-badges-top">
              <span class="card-status-pill ${sClass}">${statusLabel(item)}</span>
              <span class="art-distance-pill">${escapeHtml(item.region)} · ${distance}km</span>
            </div>
            <span class="art-caption">${deps.hasListingPhoto(item) ? "실제 등록 사진" : `${escapeHtml(machineLabel)} 예시 이미지`}</span>
          </div>
        </button>
        <button type="button" class="card-save" data-favorite="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 찜하기" aria-pressed="${isFav}">
          ${favoriteIcon()}
        </button>
      </div>

      <div class="card-body">
        <div class="card-spec-tags">
          <span class="spec-tag primary">${escapeHtml(machineLabel)}</span>
          ${cropsText ? `<span class="spec-tag">${escapeHtml(cropsText)}</span>` : ""}
          ${opsText ? `<span class="spec-tag">${escapeHtml(opsText)}</span>` : ""}
          <span class="spec-tag">${areaLabel(item.areaMin, item.areaMax)}</span>
        </div>

        <button type="button" class="card-title-btn" data-detail="${escapeHtml(item.id)}">
          <h3>${escapeHtml(item.title)}</h3>
        </button>

        <div class="card-meta">${escapeHtml(item.region)} (${distance}km) · 제조사 ${escapeHtml(item.brand)} · 최근 점검 ${escapeHtml(item.inspectedAt)}</div>

        <div class="card-summary">
          <div class="summary-badge">${state.aiSummaries[item.id] ? "✦ AI 농농이 핵심 요약" : "기종 안내"}</div>
          <p>${escapeHtml(summary)}</p>
        </div>
      </div>

      <div class="card-aside">
        <div class="card-price-box">
          <span class="price-type-label">${item.type === "rent" ? "1일 대여료" : "중고 판매가"}</span>
          <div class="card-price">${money(item.price)}<small>${item.type === "rent" ? " / 1일" : ""}</small></div>
        </div>

        <div class="card-actions-stack">
          ${item.owner ? `
            <button type="button" class="button button-primary button-sm card-primary-cta" data-detail="${escapeHtml(item.id)}">
              <span>내 매물 관리</span>
            </button>
          ` : `
            <div class="card-primary-row">
              <button type="button" class="button button-primary button-sm card-primary-cta" data-detail="${escapeHtml(item.id)}">
                <span>${item.type === "rent" ? "상세·대여" : "상세 보기"}</span>
              </button>
              <button type="button" class="button button-outline button-sm card-cart-btn" data-add-cart="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 장바구니 담기">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.5"></circle><circle cx="18" cy="20" r="1.5"></circle><path d="M2.5 4h2.8l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h8.8a1.5 1.5 0 0 0 1.45-1.15L21 7.5H6"></path></svg>
                <span>장바구니</span>
              </button>
            </div>
            <div class="trade-action-pair card-trade-pair">
              <button type="button" class="button button-secondary button-sm btn-direct-chat" data-direct-chat="${escapeHtml(item.id)}">1:1 대화</button>
              <button type="button" class="button button-sm btn-delegated-trade" data-delegated-trade="${escapeHtml(item.id)}">거래전담</button>
            </div>
          `}
        </div>
      </div>
    </article>
  `;
}

function renderListings() {
  ensureSplitLayout();
  const items = filteredListings();
  const sortLabel = SORT_LABELS[state.sort] || "거리순";
  $("resultCount").textContent = `총 ${items.length}대의 농기계 · ${sortLabel}`;

  const isMap = state.viewMode === "map";
  $("viewModeList")?.classList.toggle("active", !isMap);
  $("viewModeMap")?.classList.toggle("active", isMap);
  $("viewModeList")?.setAttribute("aria-pressed", String(!isMap));
  $("viewModeMap")?.setAttribute("aria-pressed", String(isMap));

  renderSidebarFilters();

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

  // Always show listing list immediately under count/sort bar; large inline map is removed
  $("listingGrid").hidden = false;
  const inlineMapPanel = $("listingMapPanel");
  if (inlineMapPanel) {
    inlineMapPanel.hidden = true;
    inlineMapPanel.innerHTML = "";
  }

  const selectedItem = selectedMiniMapId ? items.find((i) => i.id === selectedMiniMapId) : null;
  if (!selectedItem && selectedMiniMapId) {
    selectedMiniMapId = "";
    renderMiniMapSelectedBanner(null);
  } else if (selectedItem) {
    renderMiniMapSelectedBanner(selectedItem);
  }

  const miniMapHost = $("catalogMiniMapHost");
  if (miniMapHost) {
    renderCatalogMiniMap(miniMapHost, items, {
      selectedId: selectedMiniMapId,
      onSelectListing: (chosen) => {
        highlightListingCard(chosen.id, { scroll: true });
        renderMiniMapSelectedBanner(chosen);
      },
      onExpandMap: () => {
        deps.setView?.("map", selectedMiniMapId ? { focusListingId: selectedMiniMapId } : {});
      },
    });
  }

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

        ${item.type === "rent" && item.rentalOperator ? `<details class="detail-box rental-operator">
          <summary><strong>작업자 동반 가능</strong> · +${money(item.rentalOperator.dailyPrice)}/일</summary>
          <p class="rental-operator-experience"><strong>${escapeHtml(item.rentalOperator.name)}</strong><br>${escapeHtml(item.rentalOperator.experience)}</p>
        </details>` : ""}

        <div class="detail-actions">
          <button type="button" class="button button-secondary detail-fav-btn" data-detail-fav="${escapeHtml(item.id)}" aria-label="찜하기" aria-pressed="${isFav}">
            ${favoriteIcon()}
            <span class="favorite-label">${isFav ? "찜한 기계" : "찜하기"}</span>
          </button>
          ${item.owner ? `
            <button type="button" class="button button-primary button-large" data-detail-manage="${escapeHtml(item.id)}">내 매물 관리하기</button>
          ` : `
            <button type="button" class="button button-outline detail-cart-btn" data-detail-cart="${escapeHtml(item.id)}" ${unavailable ? "disabled" : ""}>장바구니</button>
            <div class="trade-action-pair detail-trade-pair">
              <button type="button" class="button button-secondary btn-direct-chat" data-detail-chat="${escapeHtml(item.id)}">1:1 대화</button>
              <button type="button" class="button btn-delegated-trade" data-delegated-trade="${escapeHtml(item.id)}">거래전담</button>
            </div>
            <button type="button" class="button button-primary button-large" data-detail-action="${escapeHtml(item.id)}" ${unavailable || booked ? "disabled" : ""}>
              ${unavailable ? "현재 거래 불가" : booked ? "선택 기간 대여 불가" : item.type === "rent" ? "이 농기계 대여 신청하기" : "판매자에게 구매 문의하기"}
            </button>
          `}
        </div>
      </div>
    </div>
  `;
  showDialog($("detailBackdrop"));
}

function renderFavoritesView() {
  const listEl = $("favoritesList");
  const countEl = $("favoritesCount");
  const guestNotice = $("favoritesGuestNotice");
  if (!listEl) return;

  const favIds = activeFavorites();
  const items = allListings().filter((item) => favIds.includes(item.id));
  if (countEl) countEl.textContent = `(${items.length}대)`;
  if (guestNotice) guestNotice.hidden = isLoggedIn();

  listEl.innerHTML = items.length
    ? items
        .map(
          (item) => `
      <div class="fav-modal-item" data-favorite-item="${escapeHtml(item.id)}">
        <button type="button" class="fav-thumb" data-favorite-detail="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 상세 보기">${deps.machineVisual(item)}</button>
        <div class="fav-item-info">
          <span class="spec-tag">${item.type === "rent" ? "일일 대여" : "중고 판매"} · ${escapeHtml(item.region)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="fav-item-price">${money(item.price)}${item.type === "rent" ? " / 1일" : ""}</span>
        </div>
        <div class="fav-item-actions">
          <button type="button" class="button button-secondary button-sm" data-fav-remove="${escapeHtml(item.id)}">찜 해제</button>
          <button type="button" class="button button-primary button-sm" data-favorite-detail="${escapeHtml(item.id)}">상세 보기 ›</button>
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty-panel favorites-empty">
        <p>아직 찜한 농기계가 없습니다. 마음에 드는 농기계 카드 우측 상단의 찜 버튼을 눌러보세요!</p>
        <button type="button" class="button button-primary button-sm" data-favorites-browse>매물 둘러보기</button>
      </div>`;
}

function openFavoritesModal() {
  deps.setView("favorites");
}

function resetAllFilters() {
  state.filters = blankFilters();
  state.selectedCrop = "all";
  selectedMiniMapId = "";
  renderMiniMapSelectedBanner(null);
  if ($("searchInput")) $("searchInput").value = "";
  if ($("sidebarSearchInput")) $("sidebarSearchInput").value = "";
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
    renderFavoritesView,
    openFavoritesModal,
    resetAllFilters,
  };
}
