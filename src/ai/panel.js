import { CROPS, CROP_BY_ID, MACHINE_TYPES, OPERATION_BY_ID, REGION_COORDS } from "../data/farm-machines.js";
import { activeFavorites } from "../core/store.js";
import { $, addDays, areaLabel, money, today, toast } from "../core/utils.js";
import { listingDraftToFormValues } from "./photo.js";
import { askAgent, executeAgentAction, fetchWeatherForecast } from "./recommend-agent.js";

const MACHINE_LABELS = {
  cultivator: "관리기",
  tractor: "트랙터",
  ridgeMulcher: "휴립·멀칭기",
  transplanter: "정식기",
  ricePlanter: "이앙기",
  sprayer: "방제기",
  potatoPlanter: "감자 파종기",
  combine: "콤바인",
  potatoHarvester: "감자 굴취기",
  carrier: "운반차",
};
const CONFIDENCE_LABELS = { high: "높음", medium: "보통", low: "낮음" };
const MAX_AGENT_HISTORY = 12;
const AGENT_RESET_RE = /^(?:새 상담(?: 시작)?|처음부터 다시(?: 할래요?)?|대화 초기화)[.!?\s]*$/;

function formatShortDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function formatReservationDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${"일월화수목금토"[d.getUTCDay()]})`;
}

function weekendWindow(baseYmd) {
  const d = new Date(`${baseYmd}T12:00:00+09:00`);
  const day = d.getUTCDay();
  const daysToSat = (6 - day + 7) % 7 || 7;
  const start = addDays(baseYmd, daysToSat);
  return { start, end: addDays(start, 1) };
}

function inferFollowUpChoices(reply, result) {
  if (Array.isArray(result.choices) && result.choices.length) return result.choices.slice(0, 5);
  if (result.pendingAction || result.reservation || result.createdListing || result.updatedListing || result.listingDraft) return [];
  const text = String(reply || "");
  if (/(?:예약|신청|진행|등록|올릴|보낼|살|빌릴).*?까요[?？]?/.test(text)) {
    return ["네, 바로 진행해 주세요", "조건을 바꿀래요"];
  }
  if (/어떤\s*작물/.test(text)) return ["고추", "벼", "배추", "감자"];
  if (/빌리.*?(?:사|구|팔)/.test(text) || /대여.*?(?:구매|판매)/.test(text)) {
    return ["빌리고 싶어요", "사고 싶어요", "팔고 싶어요"];
  }
  return [];
}

function wantsDatePicker(reply, result) {
  if (result.pendingAction || result.reservation || result.createdListing || result.updatedListing) return false;
  return /(?:언제|날짜|기간|며칠|시작일|반납일).*?(?:빌리|대여|필요|원하|알려|골라|말씀|정해|[?？])/.test(String(reply || ""));
}

const PLAN_FIELD_LABELS = {
  region: "작업 지역",
  crop: "작물",
  cropId: "작물",
  machineType: "필요 기종",
  operation: "작업 종류",
  date: "작업 일정",
  areaPyeong: "작업 면적",
  transaction: "거래 유형",
};

const MAX_PHOTO_DATA_URL_LENGTH = 1_200_000;
let activeCameraCleanup = null;

function compressSourceToDataUrl(source, naturalWidth, naturalHeight) {
  if (!naturalWidth || !naturalHeight) {
    throw new Error("사진 크기를 확인할 수 없어요.");
  }
  for (const [side, quality] of [[1280, 0.82], [1024, 0.75], [800, 0.7]]) {
    const scale = Math.min(1, side / Math.max(naturalWidth, naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_PHOTO_DATA_URL_LENGTH) return dataUrl;
  }
  throw new Error("사진이 너무 커요. 다른 사진으로 올려 주세요.");
}

export async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("사진을 열 수 없어요."));
      el.src = url;
    });
    return compressSourceToDataUrl(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function openCameraCapture({ fallbackInput = null, triggerButton = null, onCapture } = {}) {
  const isTouchMobile = Boolean(
    window.matchMedia?.("(pointer: coarse)")?.matches
    && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "")
  );
  if (isTouchMobile || !navigator.mediaDevices?.getUserMedia) {
    fallbackInput?.click();
    return;
  }

  activeCameraCleanup?.({ restoreFocus: false });

  const backdrop = document.createElement("div");
  backdrop.className = "camera-modal-backdrop";
  backdrop.innerHTML = `
    <section class="camera-modal" role="dialog" aria-modal="true" aria-labelledby="cameraModalTitle">
      <div class="camera-modal-head">
        <div>
          <h2 id="cameraModalTitle">카메라로 사진 찍기</h2>
          <p class="camera-modal-hint">농기계 전체나 모델명이 잘 보이도록 맞춰주세요.</p>
        </div>
        <button type="button" class="icon-button" data-camera-close aria-label="카메라 닫기">✕</button>
      </div>
      <div class="camera-viewport">
        <video autoplay playsinline muted></video>
        <div class="camera-status" data-camera-status>카메라를 켜는 중...</div>
      </div>
      <div class="camera-modal-actions">
        <button type="button" class="button button-primary" data-camera-snap disabled>📸 촬영하기</button>
        <button type="button" class="button button-secondary" data-camera-switch>🔄 카메라 전환</button>
        <button type="button" class="button button-secondary" data-camera-fallback>기기 카메라/파일 앱 열기</button>
        <button type="button" class="button button-secondary" data-camera-close>취소</button>
      </div>
    </section>
  `;
  document.body.append(backdrop);

  const video = backdrop.querySelector("video");
  const statusEl = backdrop.querySelector("[data-camera-status]");
  const snapBtn = backdrop.querySelector("[data-camera-snap]");
  const switchBtn = backdrop.querySelector("[data-camera-switch]");
  const fallbackBtn = backdrop.querySelector("[data-camera-fallback]");
  const closeBtns = backdrop.querySelectorAll("[data-camera-close]");

  let stream = null;
  let facingMode = "environment";
  let closed = false;

  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (video) video.srcObject = null;
  };

  const closeModal = ({ restoreFocus = true } = {}) => {
    if (closed) return;
    closed = true;
    stopStream();
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pagehide", onPageHide);
    backdrop.remove();
    if (activeCameraCleanup === closeModal) activeCameraCleanup = null;
    if (restoreFocus && triggerButton?.isConnected) triggerButton.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
  };
  const onPageHide = () => closeModal({ restoreFocus: false });

  activeCameraCleanup = closeModal;
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("pagehide", onPageHide);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModal();
  });
  closeBtns.forEach((btn) => btn.addEventListener("click", () => closeModal()));

  fallbackBtn.addEventListener("click", () => {
    closeModal({ restoreFocus: false });
    fallbackInput?.click();
  });

  const startStream = async (mode) => {
    stopStream();
    snapBtn.disabled = true;
    if (statusEl) {
      statusEl.textContent = "카메라를 켜는 중...";
      statusEl.hidden = false;
    }
    const nextStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: mode } },
      audio: false,
    });
    if (closed) {
      nextStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = nextStream;
    video.srcObject = nextStream;
    await new Promise((resolve) => {
      if (video.readyState >= 1 && video.videoWidth > 0) return resolve();
      const onReady = () => {
        video.removeEventListener("loadedmetadata", onReady);
        resolve();
      };
      video.addEventListener("loadedmetadata", onReady);
    });
    await video.play().catch(() => {});
    if (closed) return;
    if (statusEl) statusEl.hidden = true;
    snapBtn.disabled = false;
    snapBtn.focus();
  };

  switchBtn.addEventListener("click", async () => {
    const prevMode = facingMode;
    const nextMode = prevMode === "environment" ? "user" : "environment";
    switchBtn.disabled = true;
    try {
      await startStream(nextMode);
      facingMode = nextMode;
    } catch {
      toast("전환할 수 있는 다른 카메라가 없어요.");
      try {
        await startStream(prevMode);
      } catch {
        closeModal({ restoreFocus: false });
        fallbackInput?.click();
      }
    } finally {
      if (!closed) switchBtn.disabled = false;
    }
  });

  snapBtn.addEventListener("click", () => {
    if (!video.videoWidth || !video.videoHeight) {
      toast("카메라 화면이 아직 준비되지 않았어요.");
      return;
    }
    try {
      const dataUrl = compressSourceToDataUrl(video, video.videoWidth, video.videoHeight);
      closeModal({ restoreFocus: false });
      onCapture?.(dataUrl);
    } catch (error) {
      toast(error?.message || "사진 촬영에 실패했어요.");
    }
  });

  try {
    await startStream(facingMode);
  } catch (error) {
    closeModal({ restoreFocus: false });
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
      toast("카메라 권한이 거부되었어요. 기기 카메라/파일 앱에서 사진을 선택해 주세요.");
    } else {
      toast("사용 가능한 카메라를 찾지 못했어요. 기기 카메라/파일 앱을 열어드릴게요.");
    }
    fallbackInput?.click();
  }
}

export function createAiPanel({
  state,
  runtime,
  persist = () => {},
  allListings = () => [],
  listingById,
  loadCatalog = () => Promise.resolve(),
  openDetail,
  renderListings = () => {},
  refreshAuthenticatedData,
  savePendingIntentAndRedirectLogin,
  setView = () => {},
  openNewListing,
  toggleFavorite,
  isFavorite,
  openChat,
  getOwnedMachines = () => ({ owned: [], selectedId: "" }),
}) {
  let recommendationPending = false;
  let agentHistory = [];
  let agentPhoto = null;
  let photoIsNew = false;
  let lastPhotoDataUrl = null;
  let savedDraft = null;
  let quickOwnedNote = "";
  let setupExpanded = false;
  let pickerOpen = false;
  const aiDefaultPlaceholder = $("aiInput").placeholder;

  function checkIsFavorite(id) {
    if (typeof isFavorite === "function") return Boolean(isFavorite(id));
    return activeFavorites().includes(id);
  }

  function syncAiFavoriteButtons(id, favState) {
    if (!id) return;
    document.querySelectorAll("[data-ai-favorite]").forEach((btn) => {
      if (btn.dataset.aiFavorite !== id) return;
      btn.setAttribute("aria-pressed", String(favState));
      btn.classList.toggle("is-favorited", favState);
      btn.textContent = favState ? "❤️ 찜됨" : "🤍 찜";
    });
  }

  async function handleToggleFavorite(id) {
    if (typeof toggleFavorite !== "function") {
      toast("찜하기 기능을 사용할 수 없어요.");
      return;
    }
    await toggleFavorite(id);
    syncAiFavoriteButtons(id, checkIsFavorite(id));
  }

  function handleOpenChat(target) {
    if (typeof openChat === "function") {
      openChat(target);
      return;
    }
    setView("requests");
  }

  function getGarageInfo() {
    const garage = typeof getOwnedMachines === "function" ? getOwnedMachines() : null;
    const owned = Array.isArray(garage?.owned) ? garage.owned : [];
    const selectedId = garage?.selectedId || "";
    const selectedOwned = owned.find((m) => m.id === selectedId);
    const selectedOwnedModelId = selectedOwned?.modelId || selectedId || "";
    return { owned, selectedId, selectedOwnedModelId };
  }

  function formatSetupSummary() {
    const region = state.region || "영양읍";
    const area = Number(state.filters?.areaPyeong) > 0 ? `${Number(state.filters.areaPyeong)}평` : "면적 미정";
    const { owned } = getGarageInfo();
    const ownedLabel = quickOwnedNote
      ? quickOwnedNote
      : owned.length
        ? `${owned[0].name || "보유 기계"}${owned.length > 1 ? ` 외 ${owned.length - 1}대` : ""}`
        : "보유 기계 없음";
    return `내 초기 설정: ${region} · ${area} · ${ownedLabel}`;
  }

  function appendInputToken(text) {
    const input = $("aiInput");
    if (!input) return;
    const current = input.value.trim();
    input.value = current ? `${current} ${text}` : text;
    input.focus();
  }

  function setPickerOpen(nextOpen) {
    pickerOpen = Boolean(nextOpen);
    const drawer = $("aiPickerDrawer");
    if (drawer) drawer.hidden = !pickerOpen;
    document.querySelectorAll("[data-ai-picker-toggle]").forEach((btn) => {
      btn.setAttribute("aria-expanded", String(pickerOpen));
    });
  }

  function ensurePickerDrawer() {
    if ($("aiPickerDrawer")) return $("aiPickerDrawer");
    const panel = $("aiPanel");
    const anchor = $("aiPhotoPreview") || $("aiForm");
    if (!panel || !anchor) return null;

    const drawer = document.createElement("div");
    drawer.id = "aiPickerDrawer";
    drawer.className = "ai-picker-drawer";
    drawer.hidden = true;

    const header = document.createElement("div");
    header.className = "ai-picker-header";
    const title = document.createElement("span");
    title.textContent = "작물·기종 선택 (누르면 입력창에 들어가요)";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ai-picker-close";
    closeBtn.textContent = "닫기 ✕";
    closeBtn.addEventListener("click", () => setPickerOpen(false));
    header.append(title, closeBtn);
    drawer.append(header);

    const cropSec = document.createElement("div");
    cropSec.className = "ai-picker-section";
    const cropLabel = document.createElement("div");
    cropLabel.className = "ai-picker-label";
    cropLabel.textContent = "작물";
    const cropChips = document.createElement("div");
    cropChips.className = "ai-picker-chips";
    for (const crop of CROPS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-picker-chip";
      btn.textContent = crop.name;
      btn.addEventListener("click", () => {
        appendInputToken($("aiInput").value.trim() ? crop.name : `${crop.name}밭에 쓸 기계 찾고 있어요`);
        setPickerOpen(false);
      });
      cropChips.append(btn);
    }
    cropSec.append(cropLabel, cropChips);

    const machineSec = document.createElement("div");
    machineSec.className = "ai-picker-section";
    const machineLabel = document.createElement("div");
    machineLabel.className = "ai-picker-label";
    machineLabel.textContent = "농기계 기종";
    const machineChips = document.createElement("div");
    machineChips.className = "ai-picker-chips";
    for (const machine of MACHINE_TYPES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-picker-chip";
      btn.textContent = machine.label;
      btn.addEventListener("click", () => {
        appendInputToken($("aiInput").value.trim() ? machine.label : `${machine.label} 찾고 있어요`);
        setPickerOpen(false);
      });
      machineChips.append(btn);
    }
    machineSec.append(machineLabel, machineChips);

    drawer.append(cropSec, machineSec);
    panel.insertBefore(drawer, anchor);

    const form = $("aiForm");
    if (form && !form.querySelector("[data-ai-picker-toggle]")) {
      const inlineBtn = document.createElement("button");
      inlineBtn.type = "button";
      inlineBtn.className = "ai-picker-inline-btn";
      inlineBtn.dataset.aiPickerToggle = "inline";
      inlineBtn.setAttribute("aria-expanded", "false");
      inlineBtn.setAttribute("aria-controls", "aiPickerDrawer");
      inlineBtn.textContent = "작물·기종";
      inlineBtn.addEventListener("click", () => setPickerOpen(!pickerOpen));
      const input = $("aiInput");
      if (input) form.insertBefore(inlineBtn, input);
      else form.append(inlineBtn);
    }

    return drawer;
  }

  function renderStarterBar() {
    const root = $("aiStarters");
    if (!root) return;
    ensurePickerDrawer();
    root.replaceChildren();

    const card = document.createElement("div");
    card.className = "ai-starter-card";

    const setupBar = document.createElement("div");
    setupBar.className = "ai-setup-bar";
    const summary = document.createElement("span");
    summary.className = "ai-setup-summary";
    summary.textContent = formatSetupSummary();
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "ai-setup-toggle";
    toggleBtn.setAttribute("aria-expanded", String(setupExpanded));
    toggleBtn.textContent = setupExpanded ? "접기" : "설정 변경";
    setupBar.append(summary, toggleBtn);

    const form = document.createElement("div");
    form.className = "ai-setup-form";
    form.hidden = !setupExpanded;

    const fields = document.createElement("div");
    fields.className = "ai-setup-fields";

    const regionField = document.createElement("label");
    regionField.className = "ai-setup-field";
    regionField.append(document.createTextNode("동네"));
    const regionSelect = document.createElement("select");
    regionSelect.setAttribute("aria-label", "작업 동네");
    const regionNames = Object.keys(REGION_COORDS || { 영양읍: 1, 청기면: 1, 입암면: 1, 수비면: 1 });
    for (const r of regionNames) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      if ((state.region || "영양읍") === r) opt.selected = true;
      regionSelect.append(opt);
    }
    regionField.append(regionSelect);

    const areaField = document.createElement("label");
    areaField.className = "ai-setup-field";
    areaField.append(document.createTextNode("면적(평)"));
    const areaInput = document.createElement("input");
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
    ownedInput.type = "text";
    ownedInput.maxLength = 60;
    ownedInput.placeholder = "예: 대동 관리기 보유";
    ownedInput.value = quickOwnedNote;
    ownedInput.setAttribute("aria-label", "보유 농기계 메모");
    ownedField.append(ownedInput);

    fields.append(regionField, areaField, ownedField);

    const formActions = document.createElement("div");
    formActions.className = "ai-setup-form-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "button button-primary";
    saveBtn.textContent = "적용";
    saveBtn.addEventListener("click", () => {
      state.region = regionSelect.value || "영양읍";
      const parsedArea = Number(areaInput.value);
      state.filters.areaPyeong = Number.isFinite(parsedArea) && parsedArea > 0 ? String(Math.round(parsedArea)) : "";
      quickOwnedNote = ownedInput.value.trim();
      setupExpanded = false;
      form.hidden = true;
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.textContent = "설정 변경";
      summary.textContent = formatSetupSummary();
      persist();
      renderListings();
      refreshContextBar();
      toast("초기 조건을 반영했어요.");
    });
    formActions.append(saveBtn);
    form.append(fields, formActions);

    toggleBtn.addEventListener("click", () => {
      setupExpanded = !setupExpanded;
      form.hidden = !setupExpanded;
      toggleBtn.setAttribute("aria-expanded", String(setupExpanded));
      toggleBtn.textContent = setupExpanded ? "접기" : "설정 변경";
    });

    const guide = document.createElement("div");
    guide.className = "ai-starter-guide";
    const guideText = document.createElement("p");
    guideText.className = "ai-starter-guide-text";
    guideText.textContent = "농사일이나 기종을 한 줄로 말하면 필요한 조건만 차례로 여쭤볼게요.";
    const pickerBtn = document.createElement("button");
    pickerBtn.type = "button";
    pickerBtn.className = "ai-picker-trigger";
    pickerBtn.dataset.aiPickerToggle = "starter";
    pickerBtn.setAttribute("aria-expanded", String(pickerOpen));
    pickerBtn.setAttribute("aria-controls", "aiPickerDrawer");
    pickerBtn.textContent = "작물·기종 보기";
    pickerBtn.addEventListener("click", () => setPickerOpen(!pickerOpen));
    guide.append(guideText, pickerBtn);

    card.append(setupBar, form, guide);
    root.append(card);
  }

  renderStarterBar();

  function showPhotoPreview() {
    const preview = $("aiPhotoPreview");
    if (!preview) return;
    preview.hidden = !agentPhoto || !photoIsNew;
    if (agentPhoto) $("aiPhotoThumb").src = agentPhoto;
  }

  function clearPhoto() {
    agentPhoto = null;
    photoIsNew = false;
    const input = $("aiPhotoInput");
    if (input) input.value = "";
    const cameraInput = $("aiCameraInput");
    if (cameraInput) cameraInput.value = "";
    showPhotoPreview();
  }

  function applySelectedPhotoDataUrl(dataUrl) {
    agentPhoto = dataUrl;
    photoIsNew = true;
    savedDraft = null;
    showPhotoPreview();
    $("aiInput")?.focus();
  }

  async function handlePhotoFileInput(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return;
    try {
      applySelectedPhotoDataUrl(await shrinkPhoto(file));
    } catch (error) {
      clearPhoto();
      toast(error.message);
    }
  }

  $("aiPhotoButton")?.addEventListener("click", () => $("aiPhotoInput")?.click());
  $("aiPhotoInput")?.addEventListener("change", () => handlePhotoFileInput($("aiPhotoInput")));
  $("aiCameraButton")?.addEventListener("click", () => {
    openCameraCapture({
      fallbackInput: $("aiCameraInput"),
      triggerButton: $("aiCameraButton"),
      onCapture: applySelectedPhotoDataUrl,
    });
  });
  $("aiCameraInput")?.addEventListener("change", () => handlePhotoFileInput($("aiCameraInput")));
  $("aiPhotoRemove")?.addEventListener("click", clearPhoto);

  function scrollAiToEnd() {
    const scroll = $("aiScroll");
    scroll.scrollTop = scroll.scrollHeight;
  }

  function rememberAgentTurn(...entries) {
    agentHistory = [...agentHistory, ...entries.filter((entry) => entry.content)].slice(-MAX_AGENT_HISTORY);
  }

  function collectUiContext() {
    const filters = state.filters || {};
    const detailBackdrop = $("detailBackdrop");
    const detailListingId = detailBackdrop && !detailBackdrop.hidden
      ? document.querySelector("#detailContent [data-detail-fav]")?.dataset.detailFav
        || document.querySelector("#detailContent [data-detail-manage]")?.dataset.detailManage
        || ""
      : "";
    const viewingListingId = detailListingId || runtime.selectedMapListingId || "";
    const { owned, selectedOwnedModelId } = getGarageInfo();
    const favIds = activeFavorites();
    return {
      region: state.region || "영양읍",
      transaction: state.transaction === "sale" ? "sale" : "rent",
      cropIds: Array.isArray(filters.cropIds) ? filters.cropIds.slice(0, 4) : [],
      operations: Array.isArray(filters.operations) ? filters.operations.slice(0, 6) : [],
      ...(filters.date ? { date: filters.date, dateEnd: filters.dateEnd || filters.date } : {}),
      ...(Number(filters.areaPyeong) > 0 ? { areaPyeong: Number(filters.areaPyeong) } : {}),
      ...(Number.isSafeInteger(Number(filters.maxPrice)) && Number(filters.maxPrice) > 0 ? { maxPrice: Number(filters.maxPrice) } : {}),
      ...(viewingListingId ? { viewingListingId } : {}),
      ...(owned.length ? { ownedMachines: owned.slice(0, 10) } : {}),
      ...(selectedOwnedModelId ? { selectedOwnedModelId } : {}),
      ...(favIds.length ? { favoriteIds: favIds.slice(0, 30) } : {}),
      ...(quickOwnedNote ? { ownedMachineNote: quickOwnedNote } : {}),
    };
  }

  function renderReservationBox(bubble, done) {
    if (!done) return;
    const box = document.createElement("div");
    box.className = "ai-rec-overview ai-reservation";
    const rows = [
      ["번호", done.number],
      ["기계", done.title],
      ["지역", done.region],
      done.kind === "rental" ? ["기간", `${formatReservationDate(done.start)} ~ ${formatReservationDate(done.end)}`] : null,
      Number.isFinite(done.totalPrice) ? [done.kind === "rental" ? "내야 하는 돈" : "판매가", money(done.totalPrice)] : null,
      ["상태", done.kind === "rental" ? "소유 농가 승인 대기 · 결제 전" : "판매자 확인 대기"],
    ].filter((row) => row && row[1]);
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "ai-rec-row";
      const labelNode = document.createElement("strong");
      labelNode.textContent = `${label}:`;
      row.append(labelNode, document.createTextNode(` ${value}`));
      box.append(row);
    }
    const go = document.createElement("button");
    go.type = "button";
    go.className = "ai-rec-card-btn";
    go.textContent = done.kind === "rental" ? "대여 요청 메뉴에서 확인하기 ›" : "거래 채팅에서 확인하기 ›";
    go.addEventListener("click", () => setView("requests"));
    box.append(go);
    bubble.append(box);
    refreshAuthenticatedData?.({
      includeRequests: done.kind === "rental",
      includeConversations: done.kind === "purchase",
    }).catch(() => {});
  }

  function renderCreatedListingButton(bubble, listed) {
    if (!listed) return;
    const go = document.createElement("button");
    go.type = "button";
    go.className = "ai-rec-card-btn";
    go.textContent = `${listed.number ? `등록 번호 ${listed.number} · ` : ""}내 기계 관리에서 보기 ›`;
    go.addEventListener("click", () => setView("owner"));
    bubble.append(go);
    loadCatalog({ quiet: true }).catch(() => {});
  }

  async function executeOneTapAction({ pendingAction, requestId = crypto.randomUUID(), triggerButton, onBusy, onDone, onError }) {
    onBusy?.();
    if (triggerButton) triggerButton.disabled = true;
    try {
      const result = await executeAgentAction(pendingAction, requestId);
      if (result?.outcome === "completed") {
        const bubble = appendAiMessage(`✅ ${result.message}`, "assistant");
        if (result.reservation) renderReservationBox(bubble, result.reservation);
        if (result.createdListing) {
          savedDraft = null;
          clearPhoto();
          renderCreatedListingButton(bubble, result.createdListing);
        }
        rememberAgentTurn({ role: "assistant", content: result.message });
        await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData?.()]).catch(() => {});
        onDone?.("completed", result);
      } else if (result?.outcome === "partial") {
        appendAiMessage(`⚠️ ${result.message}`, "assistant");
        rememberAgentTurn({ role: "assistant", content: result.message });
        await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData?.()]).catch(() => {});
        onDone?.("partial", result);
      } else {
        const msg = `❌ 처리하지 못했어요. ${result?.message || ""}`.trim();
        appendAiMessage(msg, "assistant");
        onDone?.("failed", result);
      }
      scrollAiToEnd();
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "AUTH_CHANGED") {
        if (triggerButton) triggerButton.disabled = false;
        onError?.("aborted", error);
        return;
      }
      if (error?.status === 401) {
        const loginMsg = pendingAction.type === "create_listing"
          ? "🔒 매물 등록은 로그인한 뒤 할 수 있어요. 로그인하면 입력한 초안으로 이어서 등록해요."
          : "🔒 예약·신청은 로그인한 뒤 보낼 수 있어요. 로그인하면 바로 이어서 진행해요.";
        appendAiMessage(loginMsg, "assistant");
        onDone?.("login", null);
        if (pendingAction.type === "rental_request") {
          savePendingIntentAndRedirectLogin?.(
            { type: "rental", listingId: pendingAction.listingId, draftValues: { start: pendingAction.start, end: pendingAction.end, note: pendingAction.note || "", requestId } },
            "로그인 후 대여 요청을 이어서 보낼 수 있어요.",
          );
        } else if (pendingAction.type === "purchase_request") {
          savePendingIntentAndRedirectLogin?.(
            { type: "chat", listingId: pendingAction.listingId, draftBody: "구매 신청을 희망합니다." },
            "로그인 후 구매 신청을 이어서 보낼 수 있어요.",
          );
        } else if (pendingAction.type === "create_listing") {
          const formDraft = { ...pendingAction, type: pendingAction.listingType || "rent" };
          savePendingIntentAndRedirectLogin?.(
            { type: "newListing", draftValues: listingDraftToFormValues(formDraft, lastPhotoDataUrl) },
            "로그인 후 매물 등록을 이어서 완료할 수 있어요.",
          );
        }
        return;
      }
      if (triggerButton) triggerButton.disabled = false;
      if (onError) onError("failed", error, requestId);
      else appendAiMessage(error?.message || "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.", "assistant");
    }
  }

  function appendDateQuickPicker(bubble, { defaultStart = "", defaultEnd = "", buttonLabel = "이 기간 적용", onApply }) {
    const baseToday = today();
    const startVal = defaultStart && defaultStart >= baseToday ? defaultStart : addDays(baseToday, 1);
    const endVal = defaultEnd && defaultEnd >= startVal ? defaultEnd : startVal;
    const wknd = weekendWindow(baseToday);

    const wrap = document.createElement("div");
    wrap.className = "ai-date-picker";

    const presets = document.createElement("div");
    presets.className = "ai-date-presets";
    for (const [label, s, e] of [
      ["내일 하루", addDays(baseToday, 1), addDays(baseToday, 1)],
      ["모레부터 2일", addDays(baseToday, 2), addDays(baseToday, 3)],
      ["이번 주말(토~일)", wknd.start, wknd.end],
    ]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-date-preset-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        wrap.remove();
        onApply(s, e);
      });
      presets.append(btn);
    }

    const row = document.createElement("div");
    row.className = "ai-date-inputs";
    const startInput = document.createElement("input");
    startInput.type = "date";
    startInput.min = baseToday;
    startInput.value = startVal;
    startInput.setAttribute("aria-label", "대여 시작일");
    const sep = document.createElement("span");
    sep.textContent = "~";
    const endInput = document.createElement("input");
    endInput.type = "date";
    endInput.min = startVal;
    endInput.value = endVal;
    endInput.setAttribute("aria-label", "반납일");
    startInput.addEventListener("change", () => {
      endInput.min = startInput.value || baseToday;
      if (!endInput.value || endInput.value < startInput.value) endInput.value = startInput.value;
    });

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "button button-primary";
    applyBtn.textContent = buttonLabel;
    applyBtn.addEventListener("click", async () => {
      const s = startInput.value;
      const e = endInput.value || s;
      if (!s || e < s) return toast("올바른 시작일과 반납일을 골라 주세요.");

      applyBtn.disabled = true;
      applyBtn.textContent = "날씨 확인 중…";
      const weatherData = await fetchWeatherForecast({
        region: state.region || "영양읍",
        date: s,
        endDate: e,
        days: 7,
      });
      if (!wrap.isConnected) return;
      applyBtn.disabled = false;
      applyBtn.textContent = buttonLabel;

      const forecastDays = Array.isArray(weatherData?.forecastDays) ? weatherData.forecastDays : [];
      const badDays = forecastDays.filter((d) => d.date >= s && d.date <= e && d.suitability && d.suitability !== "good");
      if (!badDays.length && s === baseToday && weatherData?.weather?.suitability && weatherData.weather.suitability !== "good") {
        badDays.push({ date: baseToday, suitability: weatherData.weather.suitability, summary: weatherData.weather.summary });
      }

      if (!badDays.length) {
        wrap.remove();
        onApply(s, e);
        return;
      }

      wrap.querySelector(".ai-weather-caution")?.remove();
      const caution = document.createElement("div");
      caution.className = "ai-weather-caution";
      const msg = document.createElement("div");
      const badSummary = badDays
        .map((d) => `${formatShortDate(d.date)}(${d.summary || (d.suitability === "wind" ? "강풍" : "기상 주의")})`)
        .join(", ");
      msg.textContent = `⚠️ 선택한 날짜에 기상 주의 예보가 있어요: ${badSummary}`;
      caution.append(msg);

      const cautionActions = document.createElement("div");
      cautionActions.className = "ai-weather-caution-actions";
      const proceedBtn = document.createElement("button");
      proceedBtn.type = "button";
      proceedBtn.className = "ai-weather-proceed-btn";
      proceedBtn.textContent = "그냥 이 날짜로 진행";
      proceedBtn.addEventListener("click", () => {
        wrap.remove();
        onApply(s, e);
      });
      cautionActions.append(proceedBtn);

      const goodDays = forecastDays.filter((d) => d.suitability === "good" && d.date >= baseToday).slice(0, 3);
      for (const gd of goodDays) {
        const altBtn = document.createElement("button");
        altBtn.type = "button";
        altBtn.className = "ai-weather-alt-btn";
        altBtn.textContent = `☀️ ${formatShortDate(gd.date)} 선택`;
        altBtn.addEventListener("click", () => {
          wrap.remove();
          onApply(gd.date, gd.date);
        });
        cautionActions.append(altBtn);
      }

      caution.append(cautionActions);
      wrap.append(caution);
      scrollAiToEnd();
    });

    row.append(startInput, sep, endInput, applyBtn);
    wrap.append(presets, row);
    bubble.append(wrap);
    scrollAiToEnd();
  }

  function startOneTapListingAction(item, activeDates = null, targetBubble = null, triggerButton = null) {
    if (item.type === "sale") {
      rememberAgentTurn({ role: "user", content: `'${item.title}' 바로 구매 신청` });
      return executeOneTapAction({
        pendingAction: { type: "purchase_request", listingId: item.id, title: item.title, region: item.region, price: item.price },
        triggerButton,
        onDone: (outcome) => { if (triggerButton && outcome !== "completed") triggerButton.disabled = false; },
      });
    }
    const start = activeDates?.start || state.filters?.date || "";
    const end = activeDates?.end || state.filters?.dateEnd || start;
    if (start) {
      rememberAgentTurn({ role: "user", content: `'${item.title}' ${start}~${end} 바로 예약` });
      return executeOneTapAction({
        pendingAction: { type: "rental_request", listingId: item.id, title: item.title, region: item.region, start, end, note: "농농 채팅 원탭 예약" },
        triggerButton,
        onDone: (outcome) => { if (triggerButton && outcome !== "completed") triggerButton.disabled = false; },
      });
    }
    const promptBubble = targetBubble || appendAiMessage(`'${item.title}'을(를) 언제 빌리실까요? 날짜를 고르시면 바로 예약해 드려요.`, "assistant");
    appendDateQuickPicker(promptBubble, {
      buttonLabel: "이 날짜로 바로 예약",
      onApply: (pickedStart, pickedEnd) => {
        rememberAgentTurn({ role: "user", content: `'${item.title}' ${pickedStart}~${pickedEnd} 바로 예약` });
        executeOneTapAction({
          pendingAction: { type: "rental_request", listingId: item.id, title: item.title, region: item.region, start: pickedStart, end: pickedEnd, note: "농농 채팅 원탭 예약" },
        });
      },
    });
  }

  function appendAiMessage(text, role, listingIds = [], photo = null, { searchDates = null } = {}) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role}`;
    const textNode = document.createElement("div");
    textNode.textContent = text;
    bubble.append(textNode);
    if (photo) {
      const img = document.createElement("img");
      img.className = "ai-chat-photo";
      img.alt = "보낸 기계 사진";
      img.src = photo;
      bubble.append(img);
    }

    if (listingIds.length) {
      const results = document.createElement("div");
      results.className = "ai-result";
      const titleEl = document.createElement("div");
      titleEl.className = "ai-result-title";
      titleEl.textContent = "농농이가 찾은 맞춤 매물";
      results.append(titleEl);

      const effectiveStart = searchDates?.start || state.filters?.date || "";
      const effectiveEnd = searchDates?.end || state.filters?.dateEnd || effectiveStart;
      const activeDates = effectiveStart ? { start: effectiveStart, end: effectiveEnd } : null;

      listingIds.forEach((id) => {
        const item = listingById(id);
        if (!item) return;
        const card = document.createElement("div");
        card.className = "ai-rec-card";

        const info = document.createElement("div");
        info.className = "ai-rec-info";
        const infoTitle = document.createElement("strong");
        infoTitle.textContent = item.title || "";
        const infoMeta = document.createElement("small");
        infoMeta.textContent = `${item.region || ""} · ${money(item.price)}${item.type === "rent" ? "/일" : ""}`;
        const infoSub = document.createElement("small");
        infoSub.textContent = `${areaLabel(item.areaMin, item.areaMax)} · ${item.pickup || "인수 방법 문의"}`;
        info.append(infoTitle, infoMeta, infoSub);

        const actions = document.createElement("div");
        actions.className = "ai-rec-card-actions";
        const detailBtn = document.createElement("button");
        detailBtn.type = "button";
        detailBtn.className = "button button-secondary";
        detailBtn.textContent = "상세 보기";
        detailBtn.addEventListener("click", () => openDetail(item.id));
        actions.append(detailBtn);

        if (!item.owner) {
          const chatBtn = document.createElement("button");
          chatBtn.type = "button";
          chatBtn.className = "button button-secondary";
          chatBtn.textContent = "💬 채팅";
          chatBtn.addEventListener("click", () => handleOpenChat({ listingId: item.id }));
          actions.append(chatBtn);
        }

        const fav = checkIsFavorite(item.id);
        const favBtn = document.createElement("button");
        favBtn.type = "button";
        favBtn.className = `button button-secondary ai-rec-fav-btn${fav ? " is-favorited" : ""}`;
        favBtn.dataset.aiFavorite = item.id;
        favBtn.setAttribute("aria-pressed", String(fav));
        favBtn.textContent = fav ? "❤️ 찜됨" : "🤍 찜";
        favBtn.addEventListener("click", () => handleToggleFavorite(item.id));
        actions.append(favBtn);

        if (!item.owner && item.status === "open" && item.condition !== "repair") {
          const quickBtn = document.createElement("button");
          quickBtn.type = "button";
          quickBtn.className = "button button-primary";
          if (item.type === "rent") {
            quickBtn.textContent = activeDates
              ? `⚡ 바로 예약 (${formatShortDate(activeDates.start)}~${formatShortDate(activeDates.end)})`
              : "📅 날짜 골라 바로 예약";
          } else {
            quickBtn.textContent = "⚡ 바로 구매 신청";
          }
          quickBtn.addEventListener("click", () => startOneTapListingAction(item, activeDates, null, quickBtn));
          actions.append(quickBtn);
        }

        card.append(info, actions);
        results.append(card);
      });
      bubble.append(results);
    }
    $("aiMessages").append(bubble);
    scrollAiToEnd();
    return bubble;
  }

  function appendChoices(bubble, choiceList) {
    const choices = document.createElement("div");
    choices.className = "prompt-suggestions ai-follow-up";
    for (const choice of choiceList) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice;
      button.addEventListener("click", () => {
        if (recommendationPending || !choices.isConnected) return;
        $("aiInput").value = choice;
        $("aiForm").requestSubmit();
      });
      choices.append(button);
    }
    bubble.append(choices);
    scrollAiToEnd();
  }

  function appendConfirmation(bubble, action) {
    const requestId = crypto.randomUUID();
    const isPurchase = action.type === "purchase_request";
    const card = document.createElement("div");
    card.className = "ai-confirm";
    const title = document.createElement("strong");
    title.className = "ai-confirm-title";
    title.textContent = isPurchase ? "구매 신청 확인" : "대여 요청 확인";
    card.append(title);
    const rows = isPurchase
      ? [
          ["매물", action.title],
          ["지역", action.region],
          ["판매가", money(action.price)],
          ["메모", action.note],
        ]
      : [
          ["매물", action.title],
          ["지역", action.region],
          ["기간", `${action.start} ~ ${action.end} (${action.days}일)`],
          ["대여료", `${money(action.dailyPrice)}/일 × ${action.days}일 = ${money(action.totalPrice)}`],
          ["메모", action.note],
        ];
    for (const [label, value] of rows) {
      if (!value) continue;
      const row = document.createElement("div");
      row.className = "ai-rec-row";
      const labelNode = document.createElement("strong");
      labelNode.textContent = `${label}:`;
      row.append(labelNode, document.createTextNode(` ${value}`));
      card.append(row);
    }
    const notice = document.createElement("div");
    notice.className = "ai-rec-notice";
    notice.textContent = isPurchase
      ? "승인하면 판매자에게 구매 신청 채팅이 전송돼요."
      : "승인하면 게시자에게 대여 요청이 전송돼요. 예약은 게시자가 승인해야 확정돼요.";
    const actions = document.createElement("div");
    actions.className = "ai-confirm-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "button button-primary";
    approve.textContent = "승인하고 요청 보내기";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "button button-secondary";
    cancel.textContent = "취소";
    actions.append(approve, cancel);
    card.append(notice, actions);
    bubble.append(card);
    scrollAiToEnd();

    const setBusy = (busy) => {
      approve.disabled = busy;
      cancel.disabled = busy;
    };

    cancel.addEventListener("click", () => {
      card.dataset.state = "cancelled";
      actions.remove();
      rememberAgentTurn({ role: "user", content: "요청은 보내지 않을게요." });
      const msg = "알겠어요. 요청은 보내지 않았어요. 다른 날짜나 매물이 필요하면 말씀해 주세요.";
      appendAiMessage(msg, "assistant");
      rememberAgentTurn({ role: "assistant", content: msg });
    });

    approve.addEventListener("click", () => {
      rememberAgentTurn({ role: "user", content: "승인합니다. 요청을 보내 주세요." });
      executeOneTapAction({
        pendingAction: action,
        requestId,
        triggerButton: approve,
        onBusy: () => {
          setBusy(true);
          approve.textContent = "요청을 보내는 중…";
        },
        onDone: (outcome) => {
          card.dataset.state = outcome;
          actions.remove();
        },
        onError: (kind) => {
          if (kind === "aborted") {
            setBusy(false);
            approve.textContent = "승인하고 요청 보내기";
            return;
          }
          setBusy(false);
          approve.textContent = "다시 시도";
          appendAiMessage("요청 결과를 확인하지 못했어요. ‘다시 시도’를 누르거나 거래 화면에서 요청이 보내졌는지 확인해 주세요.", "assistant");
        },
      });
    });
  }

  function photoSummaryText(summary) {
    if (!summary) return "";
    const parts = [
      summary.machineType ? `기종 ${MACHINE_LABELS[summary.machineType] || summary.machineType}` : "기종 확인 안 됨",
      `확신 ${CONFIDENCE_LABELS[summary.confidence] || "낮음"}`,
      ...summary.observations,
    ];
    return `(사진 인식: ${parts.join(", ")})`;
  }

  function linkButton(label, href, external = false) {
    const link = document.createElement("a");
    link.className = "button button-secondary ai-card-action";
    link.href = href;
    link.textContent = label;
    if (external) {
      link.target = "_blank";
      link.rel = "noopener";
    }
    return link;
  }

  function appendRepairCenters(bubble, centers) {
    const wrap = document.createElement("div");
    wrap.className = "ai-centers";
    const title = document.createElement("strong");
    title.className = "ai-confirm-title";
    title.textContent = "🔧 수리·상담 연락처";
    wrap.append(title);
    for (const center of centers.slice(0, 5)) {
      const card = document.createElement("div");
      card.className = "ai-center-card";
      const name = document.createElement("strong");
      name.textContent = center.name;
      const services = document.createElement("small");
      services.textContent = center.services || "";
      const actions = document.createElement("div");
      actions.className = "ai-confirm-actions";
      if (center.phone) actions.append(linkButton(`📞 ${center.phone}`, `tel:${center.phone.replace(/[^0-9]/g, "")}`));
      if (center.url) actions.append(linkButton("🌐 사이트", center.url, true));
      const checked = document.createElement("small");
      checked.className = "ai-center-checked";
      checked.textContent = `확인일 ${center.checkedAt || "-"}`;
      card.append(name, services, actions, checked);
      wrap.append(card);
    }
    bubble.append(wrap);
  }

  function priceText(draft) {
    const basis = draft.priceBasis || {};
    if (!draft.price) return "비슷한 매물이 없어 가격은 직접 정해 주세요.";
    const unit = basis.unit === "day" ? "/일" : "";
    const range = basis.min && basis.max && basis.min !== basis.max ? ` (${money(basis.min)}~${money(basis.max)}${unit})` : "";
    return `참고가 ${money(draft.price)}${unit}${range} · 비슷한 매물 ${basis.count || 0}건${basis.lowConfidence ? " · 근거가 적어요" : ""}`;
  }

  function appendListingDraft(bubble, draft) {
    const requestId = crypto.randomUUID();
    const card = document.createElement("div");
    card.className = "ai-confirm ai-draft";
    const title = document.createElement("strong");
    title.className = "ai-confirm-title";
    title.textContent = draft.type === "sale" ? "🏷️ 판매 글 초안" : "🤝 대여 글 초안";
    card.append(title);
    const photoSrc = draft.photoUrl || lastPhotoDataUrl;
    if (photoSrc) {
      const img = document.createElement("img");
      img.className = "ai-draft-photo";
      img.src = photoSrc;
      img.alt = "매물 사진";
      card.append(img);
    }
    const name = document.createElement("div");
    name.className = "ai-draft-title";
    name.textContent = draft.title;
    const price = document.createElement("div");
    price.className = "ai-rec-row";
    price.textContent = priceText(draft);
    const desc = document.createElement("p");
    desc.className = "ai-draft-desc";
    desc.textContent = draft.description;
    const notice = document.createElement("div");
    notice.className = "ai-rec-notice";
    notice.textContent = "💡 플랫폼 등록 매물 기준 참고가예요. [확인 필요] 부분은 등록 화면에서 고칠 수 있어요.";
    const actions = document.createElement("div");
    actions.className = "ai-confirm-actions";

    const quickRegister = document.createElement("button");
    quickRegister.type = "button";
    quickRegister.className = "button button-primary";
    quickRegister.textContent = "⚡ 채팅에서 바로 등록";
    quickRegister.addEventListener("click", () => {
      if (!(Number.isFinite(draft.price) && draft.price > 0)) {
        toast("가격이 정해지지 않았어요. 상세 화면에서 가격을 입력해 주세요.");
        if (savedDraft?.listingId === draft.listingId) savedDraft = null;
        openNewListing?.(listingDraftToFormValues(draft, lastPhotoDataUrl));
        return;
      }
      rememberAgentTurn({ role: "user", content: "초안 내용대로 매물을 바로 등록해 주세요." });
      executeOneTapAction({
        pendingAction: {
          ...draft,
          listingType: draft.type === "sale" ? "sale" : "rent",
          type: "create_listing",
          ...(!draft.photoKey && lastPhotoDataUrl ? { photoDataUrl: lastPhotoDataUrl } : {}),
        },
        requestId,
        triggerButton: quickRegister,
        onBusy: () => { quickRegister.textContent = "등록하는 중…"; },
        onDone: (outcome) => {
          card.dataset.state = outcome;
          if (outcome === "completed") quickRegister.remove();
          else {
            quickRegister.disabled = false;
            quickRegister.textContent = "⚡ 채팅에서 바로 등록";
          }
        },
        onError: () => {
          quickRegister.disabled = false;
          quickRegister.textContent = "다시 시도";
          toast("매물을 등록하지 못했어요. 다시 시도해 주세요.");
        },
      });
    });

    const register = document.createElement("button");
    register.type = "button";
    register.className = "button button-secondary";
    register.textContent = "📝 상세 수정 후 등록";
    register.addEventListener("click", () => {
      if (savedDraft?.listingId === draft.listingId) savedDraft = null;
      openNewListing?.(listingDraftToFormValues(draft, lastPhotoDataUrl));
    });

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "button button-secondary";
    copy.textContent = "📋 복사";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(`${draft.title}\n\n${draft.description}`);
        toast("소개글을 복사했어요.");
      } catch {
        toast("복사하지 못했어요. 글을 길게 눌러 복사해 주세요.");
      }
    });

    actions.append(quickRegister, register, copy);
    card.append(name, price, desc, notice, actions);
    bubble.append(card);
  }

  function appendSources(bubble, sources) {
    const line = document.createElement("div");
    line.className = "ai-sources";
    line.append(document.createTextNode("근거: "));
    sources.slice(0, 4).forEach((source, index) => {
      if (index) line.append(document.createTextNode(" · "));
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = source.title;
      line.append(link);
    });
    bubble.append(line);
  }

  function renderPlanQuestionCard(bubble, planQuestion) {
    if (!planQuestion || !planQuestion.question) return;
    const card = document.createElement("div");
    card.className = "ai-plan-card";

    const step = document.createElement("div");
    step.className = "ai-plan-step";
    const fieldLabel = PLAN_FIELD_LABELS[planQuestion.missingField] || "맞춤 조건 확인";
    step.textContent = `추가 확인 · ${fieldLabel}`;
    card.append(step);

    const questionEl = document.createElement("div");
    questionEl.className = "ai-plan-question";
    questionEl.textContent = planQuestion.question;
    card.append(questionEl);

    const options = Array.isArray(planQuestion.options) ? planQuestion.options.slice(0, 6) : [];
    if (options.length) {
      const optsWrap = document.createElement("div");
      optsWrap.className = "ai-plan-options";
      for (const opt of options) {
        const label = typeof opt === "string" ? opt : opt?.label || opt?.value || "";
        const value = typeof opt === "string" ? opt : opt?.value || opt?.label || "";
        if (!label) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-plan-option-btn";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          if (recommendationPending || !card.isConnected) return;
          submitPrompt(value);
        });
        optsWrap.append(btn);
      }
      card.append(optsWrap);
    }

    const allowCustom = planQuestion.allowCustom !== false;
    const skippable = Boolean(planQuestion.skippable);
    if (allowCustom || skippable) {
      const footer = document.createElement("div");
      footer.className = "ai-plan-footer";
      if (allowCustom) {
        const customBtn = document.createElement("button");
        customBtn.type = "button";
        customBtn.className = "ai-plan-sub-btn";
        customBtn.textContent = "직접 입력";
        customBtn.addEventListener("click", () => {
          const input = $("aiInput");
          if (!input) return;
          input.placeholder = `${fieldLabel}을(를) 직접 입력해 주세요`;
          input.focus();
        });
        footer.append(customBtn);
      }
      if (skippable) {
        const skipBtn = document.createElement("button");
        skipBtn.type = "button";
        skipBtn.className = "ai-plan-sub-btn";
        skipBtn.textContent = "건너뛰기";
        skipBtn.addEventListener("click", () => {
          if (recommendationPending || !card.isConnected) return;
          submitPrompt("이 조건은 건너뛰고 진행해 주세요.");
        });
        footer.append(skipBtn);
      }
      card.append(footer);
    }

    bubble.append(card);
    scrollAiToEnd();
  }

  function renderWeatherInfoBar(bubble, weatherInfo) {
    if (!weatherInfo) return;
    const bar = document.createElement("div");
    bar.className = `ai-weather-bar${weatherInfo.hasBadWeather ? " is-warning" : ""}`;

    const head = document.createElement("div");
    head.className = "ai-weather-head";
    const badge = document.createElement("span");
    badge.className = "ai-weather-badge";
    badge.textContent = weatherInfo.hasBadWeather ? "🌧️ 기상 주의" : "☀️ 작업 적합";
    const title = document.createElement("span");
    title.textContent = [weatherInfo.region, weatherInfo.checkedRange].filter(Boolean).join(" · ") || "예보 확인";
    head.append(badge, title);
    bar.append(head);

    if (weatherInfo.warning) {
      const msg = document.createElement("p");
      msg.className = "ai-weather-msg";
      msg.textContent = weatherInfo.warning;
      bar.append(msg);
    }

    const alts = Array.isArray(weatherInfo.goodAlternatives) ? weatherInfo.goodAlternatives.slice(0, 4) : [];
    if (alts.length) {
      const altsWrap = document.createElement("div");
      altsWrap.className = "ai-weather-alts";
      for (const alt of alts) {
        if (!alt?.start) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-weather-alt-btn";
        const dateText = alt.end && alt.end !== alt.start
          ? `${formatShortDate(alt.start)}~${formatShortDate(alt.end)}`
          : formatShortDate(alt.start);
        btn.textContent = alt.label || `☀️ ${dateText} (${alt.summary || "맑음"}) 선택`;
        btn.addEventListener("click", () => {
          if (recommendationPending) return;
          state.filters.date = alt.start;
          state.filters.dateEnd = alt.end || alt.start;
          persist();
          refreshContextBar();
          const period = alt.end && alt.end !== alt.start ? `${alt.start}부터 ${alt.end}까지` : alt.start;
          submitPrompt(`${period} 날짜로 진행해 주세요.`);
        });
        altsWrap.append(btn);
      }
      bar.append(altsWrap);
    }

    bubble.append(bar);
  }

  function renderChatTargetCta(bubble, chatTarget) {
    if (!chatTarget?.listingId) return;
    const wrap = document.createElement("div");
    wrap.className = "ai-chat-cta-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ai-chat-cta-btn";
    btn.textContent = `💬 ${chatTarget.title || "매물"} 소유자와 1:1 채팅 열기`;
    btn.addEventListener("click", () => {
      handleOpenChat({ listingId: chatTarget.listingId, draftBody: chatTarget.prefill || "" });
    });
    wrap.append(btn);
    bubble.append(wrap);
  }

  function renderAgentResult(message, result, { photo = false } = {}) {
    const reply = typeof result.reply === "string" && result.reply.trim() ? result.reply.trim() : "말씀하신 내용을 처리하지 못했어요.";
    const summary = photoSummaryText(result.photoSummary);
    rememberAgentTurn(
      { role: "user", content: photo ? `[사진 첨부] ${message}`.trim() : message },
      { role: "assistant", content: [reply, summary].filter(Boolean).join("\n") },
    );
    if (result.listingDraft?.listingId && result.listingDraft?.photoKey) {
      savedDraft = { listingId: result.listingDraft.listingId, photoKey: result.listingDraft.photoKey, photoUrl: result.listingDraft.photoUrl };
    }
    if (result.favoriteAction?.listingId) {
      const nextFav = Boolean(result.favoriteAction.favorite);
      if (result.favoriteAction.synced === false && typeof toggleFavorite === "function") {
        toggleFavorite(result.favoriteAction.listingId, { favorite: nextFav }).catch(() => {});
      } else {
        syncAiFavoriteButtons(result.favoriteAction.listingId, nextFav);
        refreshAuthenticatedData?.({ includeRequests: false, includeConversations: false }).catch(() => {});
      }
    }
    const listingIds = result.reservation || result.createdListing || result.updatedListing
      ? []
      : (Array.isArray(result.listingIds) ? result.listingIds : []).filter((id) => listingById(id));
    const bubble = appendAiMessage(reply, "assistant", listingIds, null, { searchDates: result.searchDates || null });
    if (result.weatherInfo) renderWeatherInfoBar(bubble, result.weatherInfo);
    if (result.chatTarget) renderChatTargetCta(bubble, result.chatTarget);
    if (result.reservation) renderReservationBox(bubble, result.reservation);
    const listed = result.createdListing || result.updatedListing;
    if (listed) renderCreatedListingButton(bubble, listed);
    if (Array.isArray(result.repairCenters) && result.repairCenters.length) appendRepairCenters(bubble, result.repairCenters);
    if (result.listingDraft) appendListingDraft(bubble, result.listingDraft);
    if (Array.isArray(result.sources) && result.sources.length) appendSources(bubble, result.sources);

    if (result.planQuestion) {
      renderPlanQuestionCard(bubble, result.planQuestion);
    } else {
      const choices = inferFollowUpChoices(reply, result);
      if (choices.length) appendChoices(bubble, choices);
    }
    if (wantsDatePicker(reply, result)) {
      appendDateQuickPicker(bubble, {
        defaultStart: state.filters?.date || "",
        defaultEnd: state.filters?.dateEnd || "",
        onApply: (pickedStart, pickedEnd) => {
          $("aiInput").value = `${pickedStart}부터 ${pickedEnd}까지로 해주세요.`;
          $("aiForm").requestSubmit();
        },
      });
    }
    if (result.pendingAction?.type === "rental_request" || result.pendingAction?.type === "purchase_request") {
      appendConfirmation(bubble, result.pendingAction);
    }
    $("aiModeLabel").textContent = "농농 AI · 추천부터 예약까지";
    scrollAiToEnd();
  }

  function refreshContextBar() {
    const bar = $("aiContextBar");
    if (!bar) return;
    const ui = collectUiContext();
    const badges = [];
    if (ui.region) badges.push(`📍 ${ui.region}`);
    if (ui.cropIds.length) badges.push(`🌱 ${ui.cropIds.map((id) => CROP_BY_ID[id]?.name).filter(Boolean).join(", ")}`);
    if (ui.operations.length) badges.push(`⚙️ ${ui.operations.map((id) => OPERATION_BY_ID[id]?.label).filter(Boolean).slice(0, 2).join(", ")}`);
    if (ui.date) badges.push(`📅 ${formatShortDate(ui.date)}~${formatShortDate(ui.dateEnd || ui.date)}`);
    const viewingItem = ui.viewingListingId ? listingById(ui.viewingListingId) : null;

    bar.replaceChildren();
    if (!badges.length && !viewingItem) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    for (const text of badges) {
      const span = document.createElement("span");
      span.className = "ai-context-badge";
      span.textContent = text;
      bar.append(span);
    }
    if (viewingItem && !viewingItem.owner && viewingItem.status === "open" && viewingItem.condition !== "repair") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-context-action";
      btn.textContent = viewingItem.type === "rent"
        ? `⚡ ${viewingItem.title.slice(0, 12)}… 바로 예약`
        : `⚡ ${viewingItem.title.slice(0, 12)}… 바로 구매`;
      btn.addEventListener("click", () => startOneTapListingAction(viewingItem, null, null, btn));
      bar.append(btn);
    }
  }

  async function sendAiQuestion(event) {
    event.preventDefault();
    const sendingPhoto = photoIsNew && agentPhoto ? agentPhoto : null;
    const message = $("aiInput").value.trim() || (sendingPhoto ? "이 기계 사진이에요." : "");
    if (!message || recommendationPending) return;
    if (message.length > 500) return toast("질문을 500자 이내로 입력해 주세요.");
    if (sendingPhoto) lastPhotoDataUrl = sendingPhoto;

    recommendationPending = true;
    const submit = $("aiForm").querySelector('[type="submit"]');
    submit.disabled = true;
    $("aiInput").value = "";
    $("aiInput").placeholder = aiDefaultPlaceholder;
    $("aiStarters").hidden = true;
    setPickerOpen(false);
    $("aiMessages").querySelectorAll(".ai-follow-up, .ai-date-picker, .ai-plan-card").forEach((el) => el.remove());
    appendAiMessage(message, "user", [], sendingPhoto);
    let pending;

    try {
      if (!sendingPhoto && AGENT_RESET_RE.test(message)) {
        performReset();
        return;
      }
      pending = appendAiMessage(sendingPhoto ? "농농이가 사진을 보고 있어요…" : "농농이가 생각하고 있어요…", "assistant");
      if (runtime.catalogState !== "ready") await Promise.resolve(runtime.catalogReady).catch(() => {});
      const uiContext = collectUiContext();
      const agentResult = await askAgent(message, {
        history: agentHistory,
        region: uiContext.region,
        uiContext,
        image: sendingPhoto || undefined,
        savedDraft,
      });
      pending.remove();
      pending = undefined;
      if (agentResult?.mode === "agent") {
        if (sendingPhoto) {
          photoIsNew = false;
          showPhotoPreview();
        }
        if (agentResult.createdListing) clearPhoto();
        renderAgentResult(message, agentResult, { photo: Boolean(sendingPhoto) });
        return;
      }
      appendAiMessage("AI 상담을 호출할 수 없습니다. 잠시 후 다시 시도해 주세요.", "assistant");
      $("aiModeLabel").textContent = "AI 상담 · 연결 불가";
    } catch (error) {
      console.error("AI 상담 호출 실패", error);
      appendAiMessage(error?.message || "AI 상담을 호출할 수 없습니다. 잠시 후 다시 시도해 주세요.", "assistant");
      $("aiModeLabel").textContent = "AI 상담 · 연결 불가";
    } finally {
      pending?.remove();
      recommendationPending = false;
      submit.disabled = false;
    }
  }

  function syncAiViewport() {
    const panel = $("aiPanel");
    const viewport = window.visualViewport;
    if (panel.hidden || !viewport) return;
    panel.style.setProperty("--ai-visible-top", `${viewport.offsetTop}px`);
    panel.style.setProperty("--ai-visible-height", `${viewport.height}px`);
  }

  function openAiPanel() {
    $("aiPanel").hidden = false;
    document.body.classList.add("ai-open");
    $("aiLauncher").setAttribute("aria-expanded", "true");
    if (!$("aiStarters")?.hidden) renderStarterBar();
    refreshContextBar();
    syncAiViewport();
    $("aiClose").focus({ preventScroll: true });
  }

  function toggleAiPanelSize() {
    const button = $("aiExpand");
    const expanded = $("aiPanel").classList.toggle("is-expanded");
    button.setAttribute("aria-pressed", String(expanded));
    button.title = expanded ? "채팅창 원래 크기로" : "채팅창 확대";
    button.firstElementChild.textContent = expanded ? "⤡" : "⤢";
  }

  function performReset() {
    agentHistory = [];
    savedDraft = null;
    lastPhotoDataUrl = null;
    setupExpanded = false;
    setPickerOpen(false);
    renderStarterBar();
    clearPhoto();
    $("aiMessages").replaceChildren();
    $("aiStarters").hidden = false;
    $("aiInput").value = "";
    $("aiInput").placeholder = aiDefaultPlaceholder;
    refreshContextBar();
    appendAiMessage("어떤 작물에 어떤 작업을 하실 건가요? 한 줄로 말씀하시면 필요한 조건만 차례로 여쭤볼게요.", "assistant");
    $("aiInput").focus();
  }

  function resetAiPanel() {
    if (recommendationPending) return;
    performReset();
  }

  function submitPrompt(prompt) {
    if (recommendationPending) return;
    $("aiInput").value = prompt;
    $("aiForm").requestSubmit();
  }

  return {
    appendAiMessage,
    sendAiQuestion,
    syncAiViewport,
    openAiPanel,
    toggleAiPanelSize,
    resetAiPanel,
    submitPrompt,
    refreshContextBar,
  };
}
