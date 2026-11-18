// 내 초기 설정(동네 · 면적 · 보유 농기계 메모).
// 농농이를 처음 쓸 때 한 번 입력받고, 그 뒤로는 마이페이지 > 내 계정에서 관리한다.
import { REGION_COORDS } from "../data/farm-machines.js";
import { $, toast } from "../core/utils.js";
import { state, persist } from "../core/store.js";

export const SETUP_CHANGED_EVENT = "moa:initial-setup-changed";
const DEFAULT_REGION = "영양읍";

export function isInitialSetupDone() {
  return Boolean(state.setupDone);
}

export function formatInitialSetupSummary(ownedFallback = "") {
  const region = state.region || DEFAULT_REGION;
  const area = Number(state.filters?.areaPyeong) > 0 ? `${Number(state.filters.areaPyeong)}평` : "면적 미정";
  const owned = state.ownedNote || ownedFallback || "보유 기계 없음";
  return `${region} · ${area} · ${owned}`;
}

// 입력 칸 묶음을 만들어 돌려준다. read()로 현재 입력값을 읽는다.
export function buildInitialSetupFields(idPrefix = "setup") {
  const fields = document.createElement("div");
  fields.className = "ai-setup-fields";

  const regionField = document.createElement("label");
  regionField.className = "ai-setup-field";
  regionField.append(document.createTextNode("동네"));
  const regionSelect = document.createElement("select");
  regionSelect.id = `${idPrefix}Region`;
  regionSelect.setAttribute("aria-label", "작업 동네");
  const regionNames = Object.keys(REGION_COORDS || { 영양읍: 1, 청기면: 1, 입암면: 1, 수비면: 1 });
  const current = state.region || DEFAULT_REGION;
  if (!regionNames.includes(current)) regionNames.unshift(current);
  for (const r of regionNames) {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    if (current === r) opt.selected = true;
    regionSelect.append(opt);
  }
  regionField.append(regionSelect);

  const areaField = document.createElement("label");
  areaField.className = "ai-setup-field";
  areaField.append(document.createTextNode("면적(평)"));
  const areaInput = document.createElement("input");
  areaInput.id = `${idPrefix}Area`;
  areaInput.type = "number";
  areaInput.min = "0";
  areaInput.step = "50";
  areaInput.placeholder = "예: 300";
  areaInput.value = state.filters?.areaPyeong ? String(state.filters.areaPyeong) : "";
  areaInput.setAttribute("aria-label", "작업 면적(평)");
  areaField.append(areaInput);

  const ownedField = document.createElement("label");
  ownedField.className = "ai-setup-field is-full";
  ownedField.append(document.createTextNode("보유 농기계 메모"));
  const ownedInput = document.createElement("input");
  ownedInput.id = `${idPrefix}Owned`;
  ownedInput.type = "text";
  ownedInput.maxLength = 60;
  ownedInput.placeholder = "예: 대동 관리기 보유";
  ownedInput.value = state.ownedNote || "";
  ownedInput.setAttribute("aria-label", "보유 농기계 메모");
  ownedField.append(ownedInput);

  fields.append(regionField, areaField, ownedField);

  return {
    fields,
    read: () => ({
      region: regionSelect.value,
      areaPyeong: areaInput.value,
      ownedNote: ownedInput.value,
    }),
  };
}

export function applyInitialSetup({ region, areaPyeong, ownedNote }) {
  state.region = region || DEFAULT_REGION;
  const parsedArea = Number(areaPyeong);
  state.filters.areaPyeong = Number.isFinite(parsedArea) && parsedArea > 0 ? String(Math.round(parsedArea)) : "";
  state.ownedNote = String(ownedNote || "").trim().slice(0, 60);
  state.setupDone = true;
  persist();
  window.dispatchEvent(new CustomEvent(SETUP_CHANGED_EVENT));
}

// 마이페이지 > 내 계정의 "내 초기 설정" 칸
export function renderAccountInitialSetup() {
  const root = $("accountSetupBody");
  if (!root) return;
  const summary = $("accountSetupSummary");
  if (summary) summary.textContent = formatInitialSetupSummary();

  const { fields, read } = buildInitialSetupFields("accountSetup");
  const actions = document.createElement("div");
  actions.className = "ai-setup-form-actions";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "button button-primary button-sm";
  saveBtn.textContent = "저장";
  saveBtn.addEventListener("click", () => {
    applyInitialSetup(read());
    toast("내 초기 설정을 저장했어요.");
  });
  actions.append(saveBtn);
  root.replaceChildren(fields, actions);
}

export function initAccountInitialSetup() {
  renderAccountInitialSetup();
  window.addEventListener(SETUP_CHANGED_EVENT, renderAccountInitialSetup);
}
