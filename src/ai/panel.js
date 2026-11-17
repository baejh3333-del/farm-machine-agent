import { CROP_BY_ID, OPERATION_BY_ID, REGION_COORDS } from "../data/farm-machines.js";
import { activeFavorites } from "../core/store.js";
import { $, addDays, areaLabel, getListingPhotoSrc, machineImage, money, today, toast } from "../core/utils.js";
import { listingDraftToFormValues } from "./photo.js";
import { askAgent, executeAgentAction, fetchWeatherForecast } from "./recommend-agent.js";
import { isUnclearUtterance, joinSpokenText, tidySpokenText } from "./spoken-text.js";

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
const MACHINE_FALLBACK_IMAGE = {
  cultivator: "./src/images/machines/cultivator.jpg",
  tiller: "./src/images/machines/cultivator.jpg",
  ridingCultivator: "./src/images/machines/cultivator.jpg",
  mower: "./src/images/machines/cultivator.jpg",
  shredder: "./src/images/machines/cultivator.jpg",
  tractor: "./src/images/machines/tractor.jpg",
  rotavator: "./src/images/machines/tractor.jpg",
  plow: "./src/images/machines/tractor.jpg",
  spreader: "./src/images/machines/tractor.jpg",
  loader: "./src/images/machines/tractor.jpg",
  baler: "./src/images/machines/tractor.jpg",
  excavator: "./src/images/machines/tractor.jpg",
  ridgeMulcher: "./src/images/machines/ridgeMulcher.jpg",
  ridger: "./src/images/machines/ridgeMulcher.jpg",
  transplanter: "./src/images/machines/transplanter.jpg",
  ricePlanter: "./src/images/machines/ricePlanter.jpg",
  sprayer: "./src/images/machines/sprayer.jpg",
  speedSprayer: "./src/images/machines/sprayer.jpg",
  agriDrone: "./src/images/machines/sprayer.jpg",
  potatoPlanter: "./src/images/machines/potatoPlanter.jpg",
  garlicOnionPlanter: "./src/images/machines/potatoPlanter.jpg",
  seeder: "./src/images/machines/potatoPlanter.jpg",
  combine: "./src/images/machines/combine.jpg",
  thresher: "./src/images/machines/combine.jpg",
  dryer: "./src/images/machines/combine.jpg",
  sorter: "./src/images/machines/combine.jpg",
  forageHarvester: "./src/images/machines/combine.jpg",
  potatoHarvester: "./src/images/machines/potatoHarvester.jpg",
  rootHarvester: "./src/images/machines/potatoHarvester.jpg",
  carrier: "./src/images/machines/carrier.jpg",
  aerialLift: "./src/images/machines/carrier.jpg",
};

function resolveListingImage(item) {
  return (
    item?.photoUrl
    || item?.imageUrl
    || item?.image
    || getListingPhotoSrc(item)
    || MACHINE_FALLBACK_IMAGE[item?.machineType]
    || (item?.machineType ? machineImage(item.machineType) : "")
    || "./src/nongnong.png"
  );
}

function formatCompatibilitySummary(item) {
  if (!item) return "";
  if (item.included) return `포함 작업기: ${item.included}`;
  const spec = item.specification;
  if (spec?.implementMount) return `부착 호환: ${spec.implementMount}`;
  if (Number.isFinite(Number(spec?.ptoHp))) return `PTO 출력 ${spec.ptoHp}마력`;
  return item.summary || "";
}
const CONFIDENCE_LABELS = { high: "높음", medium: "보통", low: "낮음" };
const MAX_AGENT_HISTORY = 24;
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
    window.removeEventListener("pagehide", onPageHide);
    backdrop.remove();
    if (activeCameraCleanup === closeModal) activeCameraCleanup = null;
    if (restoreFocus && triggerButton?.isConnected) triggerButton.focus();
  };

  const onPageHide = () => closeModal({ restoreFocus: false });

  activeCameraCleanup = closeModal;
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

const INLINE_MD_RE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+?\*|`[^`\n]+?`|\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g;
const MACHINE_LIST_HEADING_RE = /^(?:#{1,6}\s*|\*\*[^*\n]*)(?:추천\s*매물|매물\s*목록|추천\s*농기계|추천\s*기계|검색\s*결과|추천\s*리스트)/;
const LIST_ITEM_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;

export function stripDuplicateMachineList(text, listingCount = 0) {
  const raw = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!raw || !listingCount) return raw;
  const lines = raw.split("\n");
  let cutIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (LIST_ITEM_RE.test(line)) {
      cutIndex = i;
      break;
    }
    if (MACHINE_LIST_HEADING_RE.test(line)) {
      const restHasList = lines.slice(i + 1).some((next) => LIST_ITEM_RE.test(next.trim()));
      if (restHasList) {
        cutIndex = i;
        break;
      }
    }
  }
  if (cutIndex === -1) return raw;
  const intro = lines.slice(0, cutIndex).join("\n").trim();
  return intro || `조건에 맞는 매물 ${listingCount}건을 찾았어요. 아래 카드에서 비교해 보세요.`;
}

function appendInlineMarkdown(parent, text) {
  const source = String(text || "");
  let lastIndex = 0;
  INLINE_MD_RE.lastIndex = 0;
  let match;
  while ((match = INLINE_MD_RE.exec(source)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(source.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      const em = document.createElement("em");
      em.textContent = token.slice(1, -1);
      parent.append(em);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      const code = document.createElement("code");
      code.className = "ai-md-code";
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith("[")) {
      const splitIdx = token.indexOf("](");
      const label = token.slice(1, splitIdx);
      const href = token.slice(splitIdx + 2, -1);
      const link = document.createElement("a");
      link.className = "ai-md-link";
      link.href = href;
      link.textContent = label;
      if (href.startsWith("http")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      parent.append(link);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < source.length) {
    parent.append(document.createTextNode(source.slice(lastIndex)));
  }
}

function renderMarkdownElement(text) {
  const container = document.createElement("div");
  container.className = "ai-md";
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  let paragraphLines = [];
  let listEl = null;
  let listType = null;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const p = document.createElement("p");
    p.className = "ai-md-p";
    paragraphLines.forEach((line, idx) => {
      if (idx > 0) p.append(document.createElement("br"));
      appendInlineMarkdown(p, line);
    });
    container.append(p);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listEl) return;
    container.append(listEl);
    listEl = null;
    listType = null;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s*(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const heading = document.createElement(level <= 2 ? "h3" : "h4");
      heading.className = `ai-md-heading is-h${Math.min(level, 4)}`;
      appendInlineMarkdown(heading, headingMatch[2].trim());
      container.append(heading);
      continue;
    }

    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      flushParagraph();
      flushList();
      const hr = document.createElement("hr");
      hr.className = "ai-md-hr";
      container.append(hr);
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      const quote = document.createElement("blockquote");
      quote.className = "ai-md-quote";
      appendInlineMarkdown(quote, quoteMatch[1]);
      container.append(quote);
      continue;
    }

    const ulMatch = rawLine.match(/^\s*[-*•]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (listType !== "ul") {
        flushList();
        listEl = document.createElement("ul");
        listEl.className = "ai-md-list";
        listType = "ul";
      }
      const li = document.createElement("li");
      appendInlineMarkdown(li, ulMatch[1].trim());
      listEl.append(li);
      continue;
    }

    const olMatch = rawLine.match(/^\s*\d+[.)]\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (listType !== "ol") {
        flushList();
        listEl = document.createElement("ol");
        listEl.className = "ai-md-list is-ordered";
        listType = "ol";
      }
      const li = document.createElement("li");
      appendInlineMarkdown(li, olMatch[1].trim());
      listEl.append(li);
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  return container;
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
  let agentSessionId = null;
  let selectedLiveVoice = "noeul";
  let agentPhoto = null;
  let photoIsNew = false;
  let photoLabel = "첨부한 기계 사진";
  let lastPhotoDataUrl = null;
  let savedDraft = null;
  let quickOwnedNote = "";
  let setupExpanded = false;
  let plusMenuOpen = false;
  let fullDelegationEnabled = false;
  let aiLayoutMode = "fullscreen";
  let enterAnimTimer = null;
  let reflowAnimTimer = null;
  let dragDepth = 0;
  let sessionGeneration = 0;
  let liveVoiceGeneration = 0;
  let liveVoiceStarting = false;
  let fallbackVoiceGeneration = 0;
  let fallbackVoiceStarting = false;
  let liveController = null;
  let liveModulePromise = null;
  let voiceModulePromise = null;
  let voiceCapability = null;
  let fallbackVoiceInput = null;
  let fallbackVoiceUsed = false;
  let pendingInputMode = "text";
  let liveUserBubble = null;
  let liveAssistantBubble = null;
  const renderedDelegationIds = new Set();
  const aiDefaultPlaceholder = $("aiInput").placeholder;

  function setPlusMenuOpen(nextOpen) {
    plusMenuOpen = Boolean(nextOpen);
    const menu = $("aiPlusMenu");
    const btn = $("aiPlusButton");
    if (menu) menu.hidden = !plusMenuOpen;
    if (btn) {
      btn.setAttribute("aria-expanded", String(plusMenuOpen));
      btn.classList.toggle("is-open", plusMenuOpen);
    }
  }

  $("aiPlusButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPlusMenuOpen(!plusMenuOpen);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!plusMenuOpen) return;
    const target = event.target;
    if (target instanceof Element && target.closest("#aiPlusWrap")) return;
    setPlusMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    if (plusMenuOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setPlusMenuOpen(false);
      $("aiPlusButton")?.focus();
      return;
    }
    if (activeCameraCleanup) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeCameraCleanup();
    }
  }, true);

  function applyWelcomeStagger() {
    document.querySelectorAll("#aiWelcomeHero .ai-capability-card").forEach((card, index) => {
      card.style.setProperty("--stagger-i", String(index));
    });
  }

  function triggerCardReflow(container = $("aiMessages")) {
    if (!container) return;
    const rails = [...container.querySelectorAll(".ai-result-cards")];
    if (!rails.length) return;
    clearTimeout(reflowAnimTimer);
    for (const rail of rails) {
      rail.querySelectorAll(".ai-rec-card").forEach((card, idx) => {
        card.style.setProperty("--stagger-i", String(Math.min(idx, 10)));
      });
      rail.classList.remove("is-reflowing");
      void rail.offsetWidth;
      rail.classList.add("is-reflowing");
    }
    reflowAnimTimer = setTimeout(() => {
      for (const rail of rails) rail.classList.remove("is-reflowing");
    }, 760);
  }

  applyWelcomeStagger();

  function setFullDelegation(nextEnabled) {
    fullDelegationEnabled = Boolean(nextEnabled);
    const toggle = $("aiFullDelegationToggle");
    const stateLabel = $("aiDelegationState");
    const banner = $("aiDelegationBanner");
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(fullDelegationEnabled));
      toggle.classList.toggle("is-active", fullDelegationEnabled);
    }
    if (stateLabel) stateLabel.textContent = fullDelegationEnabled ? "ON" : "OFF";
    if (banner) banner.hidden = !fullDelegationEnabled;
  }

  $("aiFullDelegationToggle")?.addEventListener("click", () => {
    setFullDelegation(!fullDelegationEnabled);
  });

  function setAiLayoutMode(mode, { animate = false, reflow = false } = {}) {
    const nextMode = mode === "docked" ? "docked" : "fullscreen";
    const modeChanged = aiLayoutMode !== nextMode;
    aiLayoutMode = nextMode;
    const isFullscreen = nextMode === "fullscreen";
    const panel = $("aiPanel");
    if (!panel) return;
    panel.dataset.layoutMode = nextMode;
    panel.classList.toggle("is-fullscreen", isFullscreen);
    panel.classList.toggle("is-expanded", isFullscreen);
    document.body.classList.toggle("ai-fullscreen", isFullscreen && !panel.hidden);
    const backdrop = $("aiBackdrop");
    if (backdrop) backdrop.hidden = panel.hidden || !isFullscreen;

    const expandBtn = $("aiExpand");
    if (expandBtn) {
      expandBtn.setAttribute("aria-pressed", String(isFullscreen));
      expandBtn.title = isFullscreen ? "우측 화면으로 보기" : "전체화면으로 보기";
      expandBtn.setAttribute("aria-label", expandBtn.title);
      if (expandBtn.firstElementChild) expandBtn.firstElementChild.textContent = isFullscreen ? "⤡" : "⤢";
    }

    document.querySelectorAll("[data-ai-layout]").forEach((btn) => {
      const active = btn.dataset.aiLayout === nextMode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    if (animate) {
      clearTimeout(enterAnimTimer);
      panel.classList.remove("is-entering");
      void panel.offsetWidth;
      panel.classList.add("is-entering");
      const finishEnter = (event) => {
        if (event && event.target !== panel) return;
        panel.removeEventListener("animationend", finishEnter);
        clearTimeout(enterAnimTimer);
        enterAnimTimer = setTimeout(() => {
          panel.classList.remove("is-entering");
        }, 320);
      };
      panel.addEventListener("animationend", finishEnter);
      enterAnimTimer = setTimeout(() => {
        panel.removeEventListener("animationend", finishEnter);
        panel.classList.remove("is-entering");
      }, 740);
    }

    if (modeChanged || reflow) {
      triggerCardReflow();
    }
    syncAiViewport();
  }

  document.querySelectorAll("[data-ai-layout]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setAiLayoutMode(btn.dataset.aiLayout, { reflow: true });
    });
  });

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

  function renderStarterBar() {
    const root = $("aiStarters");
    if (!root) return;
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
    guide.append(guideText);

    card.append(setupBar, form, guide);
    root.append(card);
  }

  renderStarterBar();

  function showPhotoPreview() {
    const preview = $("aiPhotoPreview");
    if (!preview) return;
    preview.hidden = !agentPhoto || !photoIsNew;
    if (agentPhoto) $("aiPhotoThumb").src = agentPhoto;
    const labelEl = $("aiPhotoLabel");
    if (labelEl) labelEl.textContent = photoLabel || "첨부한 기계 사진";
  }

  function clearPhoto() {
    agentPhoto = null;
    photoIsNew = false;
    photoLabel = "첨부한 기계 사진";
    const input = $("aiPhotoInput");
    if (input) input.value = "";
    const cameraInput = $("aiCameraInput");
    if (cameraInput) cameraInput.value = "";
    showPhotoPreview();
  }

  function applySelectedPhotoDataUrl(dataUrl, label = "첨부한 기계 사진") {
    muteLiveVoiceForPhoto();
    agentPhoto = dataUrl;
    photoIsNew = true;
    photoLabel = label;
    savedDraft = null;
    showPhotoPreview();
    $("aiInput")?.focus();
  }

  async function handlePhotoFile(file, labelOverride) {
    if (!file) return;
    muteLiveVoiceForPhoto();
    try {
      applySelectedPhotoDataUrl(await shrinkPhoto(file), labelOverride || file.name || "첨부한 기계 사진");
    } catch (error) {
      clearPhoto();
      toast(error.message);
    }
  }

  async function handlePhotoFileInput(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return;
    await handlePhotoFile(file);
  }

  $("aiPhotoButton")?.addEventListener("click", () => {
    setPlusMenuOpen(false);
    $("aiPhotoInput")?.click();
  });
  $("aiPhotoInput")?.addEventListener("change", () => handlePhotoFileInput($("aiPhotoInput")));
  $("aiCameraButton")?.addEventListener("click", () => {
    setPlusMenuOpen(false);
    muteLiveVoiceForPhoto();
    openCameraCapture({
      fallbackInput: $("aiCameraInput"),
      triggerButton: $("aiCameraButton"),
      onCapture: (dataUrl) => applySelectedPhotoDataUrl(dataUrl, "카메라로 찍은 사진"),
    });
  });
  $("aiCameraInput")?.addEventListener("change", () => handlePhotoFileInput($("aiCameraInput")));
  $("aiPhotoRemove")?.addEventListener("click", clearPhoto);

  // 클립보드 이미지 붙여넣기 지원
  $("aiInput")?.addEventListener("paste", async (event) => {
    const items = [...(event.clipboardData?.items || [])];
    const imageItem = items.find((it) => it.kind === "file" && it.type?.startsWith("image/"));
    const file = imageItem?.getAsFile() || [...(event.clipboardData?.files || [])].find((f) => f.type?.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    await handlePhotoFile(file, "붙여넣은 기계 사진");
  });

  // 패널 전체 이미지 드래그 앤 드롭 지원
  const aiPanelEl = $("aiPanel");
  const setDropOverlayVisible = (visible) => {
    const overlay = $("aiDropOverlay");
    if (overlay) overlay.hidden = !visible;
    aiPanelEl?.classList.toggle("is-drag-over", visible);
  };
  aiPanelEl?.addEventListener("dragenter", (event) => {
    if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
    event.preventDefault();
    dragDepth += 1;
    setDropOverlayVisible(true);
  });
  aiPanelEl?.addEventListener("dragover", (event) => {
    if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  aiPanelEl?.addEventListener("dragleave", (event) => {
    if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDropOverlayVisible(false);
  });
  aiPanelEl?.addEventListener("drop", async (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    dragDepth = 0;
    setDropOverlayVisible(false);
    const imageFile = files.find((f) => f.type?.startsWith("image/"));
    if (!imageFile) return;
    event.preventDefault();
    await handlePhotoFile(imageFile);
  });

  function scrollAiToEnd() {
    const scroll = $("aiScroll");
    scroll.scrollTop = scroll.scrollHeight;
  }

  // 예약 뒤 보험 추천: 대화마다 한 번만 묻는다. 진행 상태는 서버가 돌려준 값을 그대로 다음 요청에 보낸다.
  let insuranceOffer = null;
  let insuranceAsked = false;

  function trackInsurance(result) {
    if (!result || !Object.hasOwn(result, "insuranceOffer")) {
      insuranceOffer = null;
      return;
    }
    insuranceAsked = true;
    insuranceOffer = result.insuranceOffer && result.insuranceOffer.stage !== "done" ? result.insuranceOffer : null;
  }

  function appendInsuranceAsk(result) {
    if (!result?.insuranceAsk) return;
    trackInsurance(result);
    const bubble = appendAiMessage(result.insuranceAsk, "assistant");
    rememberAgentTurn({ role: "assistant", content: result.insuranceAsk });
    appendChoices(bubble, ["네, 추천해 주세요", "괜찮아요"]);
  }

  function rememberAgentTurn(...entries) {
    const next = [...agentHistory];
    for (const entry of entries) {
      if (!entry || typeof entry.content !== "string") continue;
      const content = entry.content.trim();
      if (!content) continue;
      const prev = next.at(-1);
      if (prev && prev.role === entry.role && prev.content === content) continue;
      next.push({ role: entry.role, content });
    }
    agentHistory = next.slice(-MAX_AGENT_HISTORY);
  }

  // 바로 앞 답변에서 확인을 물은 작업. 다음 말이 "네/해줘"면 서버가 모델 없이 바로 실행한다(한 턴만 유효).
  let lastPendingAction = null;

  function rememberPendingAction(result) {
    const pending = result?.pendingAction;
    if (pending && ["rental_request", "purchase_request"].includes(pending.type)) {
      lastPendingAction = { ...pending, requestId: pending.requestId || crypto.randomUUID() };
    } else if (result?.listingDraft && Number.isFinite(result.listingDraft.price) && result.listingDraft.price > 0) {
      const draft = result.listingDraft;
      lastPendingAction = {
        ...draft,
        listingType: draft.type === "sale" ? "sale" : "rent",
        type: "create_listing",
        requestId: crypto.randomUUID(),
        ...(!draft.photoKey && lastPhotoDataUrl ? { photoDataUrl: lastPhotoDataUrl } : {}),
      };
    } else {
      lastPendingAction = null;
    }
  }

  function takePendingAction() {
    const pending = lastPendingAction;
    lastPendingAction = null;
    return pending;
  }

  // 직전에 카드로 보여 준 매물(순서 유지). 서버가 같은 카드를 또 띄우지 않고 "첫 번째" 같은 말을 알아듣는 데 쓴다.
  let lastShownListingIds = [];

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
      ...(lastShownListingIds.length ? { shownListingIds: lastShownListingIds.slice(0, 6) } : {}),
      ...(quickOwnedNote ? { ownedMachineNote: quickOwnedNote } : {}),
      ...(fullDelegationEnabled ? { fullDelegation: true } : {}),
    };
  }

  function renderDelegatedTransactionBox(bubble, delegated) {
    if (!delegated) return;
    const box = document.createElement("div");
    box.className = "ai-rec-overview ai-delegation-card";
    const rows = [
      ["전담 매물", delegated.title],
      ["지역", delegated.region],
      delegated.start
        ? ["희망 일정", `${formatReservationDate(delegated.start)}${delegated.end && delegated.end !== delegated.start ? ` ~ ${formatReservationDate(delegated.end)}` : ""}`]
        : null,
      Number.isFinite(Number(delegated.maxBudget)) ? ["희망 예산", money(Number(delegated.maxBudget))] : null,
      ["전담 상태", delegated.statusLabel || "부재중 자동 협상·응대 활성화"],
    ].filter((row) => row && row[1]);
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "ai-rec-row";
      const labelNode = document.createElement("strong");
      labelNode.textContent = `${label}:`;
      row.append(labelNode, document.createTextNode(` ${value}`));
      box.append(row);
    }
    const policy = delegated.aiPolicy || delegated.policy;
    const go = document.createElement("button");
    go.type = "button";
    go.className = "ai-rec-card-btn ai-delegation-open-btn";
    go.textContent = "거래 채팅방에서 전담 진행 보기 ›";
    go.addEventListener("click", () => {
      handleOpenChat({
        listingId: delegated.listingId || null,
        conversationId: delegated.conversationId || null,
        aiMode: delegated.mode || "autonomous",
        ...(policy ? { aiPolicy: policy } : {}),
      });
    });
    box.append(go);
    bubble.append(box);
    refreshAuthenticatedData?.({ includeRequests: true, includeConversations: true }).catch(() => {});
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
    const gen = sessionGeneration;
    lastPendingAction = null; // 화면 버튼으로 처리하면 말로 다시 실행하지 않는다.
    onBusy?.();
    if (triggerButton) triggerButton.disabled = true;
    try {
      const result = await executeAgentAction(pendingAction, requestId, { insuranceAsked });
      if (gen !== sessionGeneration) return;
      if (result?.outcome === "completed") {
        const bubble = appendAiMessage(`✅ ${result.message}`, "assistant");
        if (result.reservation) renderReservationBox(bubble, result.reservation);
        if (result.delegatedTransaction) renderDelegatedTransactionBox(bubble, result.delegatedTransaction);
        appendInsuranceAsk(result);
        if (result.createdListing) {
          savedDraft = null;
          clearPhoto();
          renderCreatedListingButton(bubble, result.createdListing);
        }
        rememberAgentTurn({ role: "assistant", content: result.message });
        await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData?.()]).catch(() => {});
        if (gen !== sessionGeneration) return;
        if (isLiveVoiceActive()) {
          liveController.notifyUiEvent(
            `사용자가 화면의 승인 버튼을 눌러 작업을 완료했습니다: ${result.message || "요청 완료"}. 따뜻하게 축하하고 다음 안내를 해 주세요.`,
          );
        }
        onDone?.("completed", result);
      } else if (result?.outcome === "partial") {
        appendAiMessage(`⚠️ ${result.message}`, "assistant");
        rememberAgentTurn({ role: "assistant", content: result.message });
        await Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData?.()]).catch(() => {});
        if (gen !== sessionGeneration) return;
        if (isLiveVoiceActive()) {
          liveController.notifyUiEvent(`화면 작업 처리 결과 일부 확인이 필요합니다: ${result.message || ""}`);
        }
        onDone?.("partial", result);
      } else {
        const msg = `❌ 처리하지 못했어요. ${result?.message || ""}`.trim();
        appendAiMessage(msg, "assistant");
        if (isLiveVoiceActive()) {
          liveController.notifyUiEvent(`화면 작업 처리에 실패했습니다: ${result?.message || ""}`);
        }
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
          : pendingAction.type === "delegate_transaction"
            ? "🔒 거래 전담은 로그인한 뒤 맡길 수 있어요. 로그인하면 바로 이어서 진행해요."
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
        } else if (pendingAction.type === "delegate_transaction") {
          savePendingIntentAndRedirectLogin?.(
            { type: "chat", listingId: pendingAction.listingId, draftBody: "조건 확인 후 부재중 거래 전담을 시작합니다.", aiMode: "autonomous" },
            "로그인 후 거래 전담을 이어서 시작할 수 있어요.",
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

  function startFullDelegationAction(item, activeDates = null, triggerButton = null) {
    const start = activeDates?.start || state.filters?.date || null;
    const end = activeDates?.end || state.filters?.dateEnd || start || null;
    rememberAgentTurn({ role: "user", content: `'${item.title}' 거래 전담 맡기기` });
    return executeOneTapAction({
      pendingAction: {
        type: "delegate_transaction",
        listingId: item.id,
        title: item.title,
        region: item.region,
        start,
        end,
        maxBudget: state.filters?.maxPrice || item.price,
        areaPyeong: state.filters?.areaPyeong || null,
        cropIds: state.filters?.cropIds || [],
        operations: state.filters?.operations || [],
        ownedModelId: getGarageInfo().selectedOwnedModelId || null,
        fullDelegation: true,
      },
      triggerButton,
      onBusy: () => {
        if (triggerButton) triggerButton.textContent = "전담 설정 중…";
      },
      onDone: (outcome) => {
        if (!triggerButton) return;
        if (outcome === "completed") {
          triggerButton.textContent = "🤖 전담 진행중";
        } else {
          triggerButton.disabled = false;
          triggerButton.textContent = "🤖 거래 전담";
        }
      },
      onError: (kind) => {
        if (triggerButton) {
          triggerButton.disabled = false;
          triggerButton.textContent = "🤖 거래 전담";
        }
        if (kind !== "aborted") {
          appendAiMessage("거래 전담을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.", "assistant");
        }
      },
    });
  }

  function appendAiMessage(text, role, listingIds = [], photo = null, { searchDates = null } = {}) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role}`;
    if (role === "assistant") {
      const displayText = listingIds.length ? stripDuplicateMachineList(text, listingIds.length) : text;
      bubble.append(renderMarkdownElement(displayText));
    } else {
      const textNode = document.createElement("div");
      textNode.textContent = text;
      bubble.append(textNode);
    }
    if (photo) {
      const img = document.createElement("img");
      img.className = "ai-chat-photo";
      img.alt = "보낸 기계 사진";
      img.src = photo;
      bubble.append(img);
    }

    if (listingIds.length) {
      if (role === "assistant") lastShownListingIds = listingIds.filter((id) => listingById(id)).slice(0, 6);
      bubble.classList.add("has-results");
      const results = document.createElement("div");
      results.className = "ai-result";
      const titleRow = document.createElement("div");
      titleRow.className = "ai-result-title";
      const titleLabel = document.createElement("span");
      titleLabel.textContent = `농농이가 찾은 맞춤 매물 (${listingIds.length}건)`;
      const railHint = document.createElement("span");
      railHint.className = "ai-result-rail-hint";
      railHint.textContent = "좌우로 넘겨 비교 ›";
      titleRow.append(titleLabel, railHint);
      results.append(titleRow);

      const cardsRail = document.createElement("div");
      cardsRail.className = "ai-result-cards is-reflowing";

      const effectiveStart = searchDates?.start || state.filters?.date || "";
      const effectiveEnd = searchDates?.end || state.filters?.dateEnd || effectiveStart;
      const activeDates = effectiveStart ? { start: effectiveStart, end: effectiveEnd } : null;

      let cardIndex = 0;
      listingIds.forEach((id) => {
        const item = listingById(id);
        if (!item) return;
        const card = document.createElement("div");
        card.className = "ai-rec-card";
        card.style.setProperty("--stagger-i", String(Math.min(cardIndex, 10)));
        cardIndex += 1;

        const media = document.createElement("div");
        media.className = "ai-rec-card-media";
        const img = document.createElement("img");
        img.className = "ai-rec-card-img";
        img.loading = "lazy";
        img.alt = item.title || "농기계 이미지";
        img.src = resolveListingImage(item);
        img.addEventListener("error", () => {
          if (img.dataset.fallbackApplied) return;
          img.dataset.fallbackApplied = "1";
          img.src = "./src/nongnong.png";
        });
        const badges = document.createElement("div");
        badges.className = "ai-rec-card-badges";
        const txBadge = document.createElement("span");
        txBadge.className = `ai-rec-badge-tx is-${item.type === "sale" ? "sale" : "rent"}`;
        txBadge.textContent = item.type === "sale" ? "판매" : "대여";
        badges.append(txBadge);
        if (item.region) {
          const regionBadge = document.createElement("span");
          regionBadge.className = "ai-rec-badge-region";
          regionBadge.textContent = item.region;
          badges.append(regionBadge);
        }
        media.append(img, badges);

        const info = document.createElement("div");
        info.className = "ai-rec-info";
        const infoTitle = document.createElement("strong");
        infoTitle.textContent = item.title || "";
        const infoMeta = document.createElement("small");
        infoMeta.textContent = `${item.region || ""} · ${money(item.price)}${item.type === "rent" ? "/일" : ""}`;
        const infoSub = document.createElement("small");
        infoSub.textContent = `${areaLabel(item.areaMin, item.areaMax)} · ${item.pickup || "인수 방법 문의"}`;
        info.append(infoTitle, infoMeta, infoSub);
        const compatSummary = formatCompatibilitySummary(item);
        if (compatSummary) {
          const infoCompat = document.createElement("small");
          infoCompat.className = "ai-rec-compat";
          infoCompat.textContent = compatSummary;
          info.append(infoCompat);
        }

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

          const delegateBtn = document.createElement("button");
          delegateBtn.type = "button";
          delegateBtn.className = "button button-secondary ai-rec-delegate-btn";
          delegateBtn.dataset.aiDelegate = item.id;
          delegateBtn.textContent = "🤖 거래 전담";
          delegateBtn.addEventListener("click", () => startFullDelegationAction(item, activeDates, delegateBtn));
          actions.append(delegateBtn);
        }

        card.append(media, info, actions);
        cardsRail.append(card);
      });
      results.append(cardsRail);
      bubble.append(results);
      setTimeout(() => cardsRail.classList.remove("is-reflowing"), 760);
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
    const isDelegation = action.type === "delegate_transaction";
    const card = document.createElement("div");
    card.className = "ai-confirm";
    const title = document.createElement("strong");
    title.className = "ai-confirm-title";
    title.textContent = isDelegation
      ? "🤖 부재중 거래 전담 확인"
      : isPurchase
        ? "구매 신청 확인"
        : "대여 요청 확인";
    card.append(title);
    const rows = isDelegation
      ? [
          ["매물", action.title],
          ["지역", action.region],
          action.start ? ["희망 일정", `${action.start}${action.end && action.end !== action.start ? ` ~ ${action.end}` : ""}`] : null,
          Number.isFinite(Number(action.maxBudget)) ? ["희망 예산", money(Number(action.maxBudget))] : null,
        ].filter(Boolean)
      : isPurchase
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
    notice.textContent = isDelegation
      ? "승인하면 1:1 거래 채팅방에서 농농이 자동 협상·응대 모드가 시작돼요."
      : isPurchase
        ? "승인하면 판매자에게 구매 신청 채팅이 전송돼요."
        : "승인하면 게시자에게 대여 요청이 전송돼요. 예약은 게시자가 승인해야 확정돼요.";
    const actions = document.createElement("div");
    actions.className = "ai-confirm-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "button button-primary";
    approve.textContent = isDelegation ? "승인하고 전담 시작" : "승인하고 요청 보내기";
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

  function appendContactCards(bubble, heading, items) {
    const list = Array.isArray(items) ? items.slice(0, 5) : [];
    if (!list.length) return;
    const wrap = document.createElement("div");
    wrap.className = "ai-centers";
    const title = document.createElement("strong");
    title.className = "ai-confirm-title";
    title.textContent = heading;
    wrap.append(title);
    for (const item of list) {
      const card = document.createElement("div");
      card.className = "ai-center-card";
      const name = document.createElement("strong");
      name.textContent = item.name || "";
      const services = document.createElement("small");
      services.textContent = item.services || "";
      const actions = document.createElement("div");
      actions.className = "ai-confirm-actions";
      if (item.phone) actions.append(linkButton(`📞 ${item.phone}`, `tel:${String(item.phone).replace(/[^0-9]/g, "")}`));
      if (item.url) actions.append(linkButton("🌐 사이트", item.url, true));
      const checked = document.createElement("small");
      checked.className = "ai-center-checked";
      checked.textContent = `확인일 ${item.checkedAt || "-"}`;
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
    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "ai-chat-cta-btn ai-chat-auto-btn";
    autoBtn.textContent = "🤖 대리 채팅 맡기기";
    autoBtn.addEventListener("click", () => {
      handleOpenChat({ listingId: chatTarget.listingId, draftBody: chatTarget.prefill || "", aiMode: "autonomous" });
    });
    wrap.append(btn, autoBtn);
    bubble.append(wrap);
  }

  function renderAgentEffects(bubble, result, { reply = "", includeFollowUp = true } = {}) {
    if (!bubble || !result) return;
    rememberPendingAction(result);
    if (result.reservation || result.createdListing) {
      // 말로 바로 실행한 작업도 화면 목록(대여 요청·내 매물)을 새로 고친다.
      Promise.all([loadCatalog({ quiet: true }), refreshAuthenticatedData?.()]).catch(() => {});
    }
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
    if (result.weatherInfo) renderWeatherInfoBar(bubble, result.weatherInfo);
    if (result.chatTarget) renderChatTargetCta(bubble, result.chatTarget);
    if (result.reservation) renderReservationBox(bubble, result.reservation);
    if (result.delegatedTransaction) renderDelegatedTransactionBox(bubble, result.delegatedTransaction);
    const listed = result.createdListing || result.updatedListing;
    if (listed) renderCreatedListingButton(bubble, listed);
    if (Array.isArray(result.repairCenters) && result.repairCenters.length) {
      appendContactCards(bubble, "🔧 수리·상담 연락처", result.repairCenters);
    }
    if (Array.isArray(result.insuranceContacts) && result.insuranceContacts.length) {
      appendContactCards(bubble, "🛡️ 보험 상담 연락처", result.insuranceContacts);
    }
    if (result.listingDraft) appendListingDraft(bubble, result.listingDraft);
    if (Array.isArray(result.sources) && result.sources.length) appendSources(bubble, result.sources);

    if (includeFollowUp) {
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
    }
    if (
      result.pendingAction?.type === "rental_request"
      || result.pendingAction?.type === "purchase_request"
      || result.pendingAction?.type === "delegate_transaction"
    ) {
      appendConfirmation(bubble, result.pendingAction);
    }
    appendInsuranceAsk(result);
  }

  function renderAgentResult(message, result, { photo = false } = {}) {
    const reply = typeof result.reply === "string" && result.reply.trim() ? result.reply.trim() : "말씀하신 내용을 처리하지 못했어요.";
    const summary = photoSummaryText(result.photoSummary);
    rememberAgentTurn(
      { role: "user", content: photo ? `[사진 첨부] ${message}`.trim() : message },
      { role: "assistant", content: [reply, summary].filter(Boolean).join("\n") },
    );
    const listingIds = result.reservation || result.createdListing || result.updatedListing
      ? []
      : (Array.isArray(result.listingIds) ? result.listingIds : []).filter((id) => listingById(id));
    const bubble = appendAiMessage(reply, "assistant", listingIds, null, { searchDates: result.searchDates || null });
    renderAgentEffects(bubble, result, { reply, includeFollowUp: true });
    if ($("aiModeLabel")) $("aiModeLabel").textContent = "농농 AI · 추천부터 예약까지";
    scrollAiToEnd();
    if (fallbackVoiceUsed) {
      fallbackVoiceUsed = false;
      const ttsGen = sessionGeneration;
      const fbGen = fallbackVoiceGeneration;
      loadVoiceModule()
        .then(async (mod) => {
          if (ttsGen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
          if (!mod?.speak) return;
          await mod.prepareSpeech?.();
          if (ttsGen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
          const settings = mod.loadVoiceSettings?.() || {};
          if (settings.autoplay !== "off") mod.speak(reply, { rate: settings.rate });
        })
        .catch(() => {});
    }
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

  const initialWelcomeHtml = $("aiWelcomeHero")?.outerHTML || "";

  $("aiMessages")?.addEventListener("click", (event) => {
    const capCard = event.target.closest(".ai-capability-card");
    if (!capCard) return;
    if (capCard.dataset.aiPhotoTrigger === "true") {
      if ($("aiWelcomeHero")) $("aiWelcomeHero").hidden = true;
      const bubble = appendAiMessage(
        "농기계 사진을 올려주시면 기종·고장 의심 부위·적정 시세까지 바로 분석해 드려요! 카메라로 찍거나 이미지를 첨부해 보세요.",
        "assistant",
      );
      const ctaWrap = document.createElement("div");
      ctaWrap.className = "ai-chat-cta-wrap";
      const camBtn = document.createElement("button");
      camBtn.type = "button";
      camBtn.className = "ai-chat-cta-btn";
      camBtn.textContent = "📷 카메라로 촬영하기";
      camBtn.addEventListener("click", () => $("aiCameraButton")?.click());
      const fileBtn = document.createElement("button");
      fileBtn.type = "button";
      fileBtn.className = "ai-chat-cta-btn";
      fileBtn.textContent = "🖼️ 사진 파일 첨부하기";
      fileBtn.addEventListener("click", () => $("aiPhotoButton")?.click());
      ctaWrap.append(camBtn, fileBtn);
      bubble.append(ctaWrap);
      scrollAiToEnd();
      return;
    }
    if (capCard.dataset.aiEnableDelegation === "true") {
      setFullDelegation(true);
    }
    if (capCard.dataset.prompt) {
      submitPrompt(capCard.dataset.prompt);
    }
  });

  let voiceAudioEl = null;

  function ensureVoiceAudioElement() {
    if (voiceAudioEl) return voiceAudioEl;
    const el = document.createElement("audio");
    el.autoplay = true;
    el.hidden = true;
    $("aiPanel")?.append(el);
    voiceAudioEl = el;
    return el;
  }

  function loadLiveModule() {
    if (!liveModulePromise) liveModulePromise = import("./gpt-live.js").catch(() => null);
    return liveModulePromise;
  }

  function loadVoiceModule() {
    if (!voiceModulePromise) voiceModulePromise = import("./voice.js").catch(() => null);
    return voiceModulePromise;
  }

  function isLiveVoiceActive() {
    return Boolean(liveController && liveController.state !== "idle" && liveController.state !== "closed");
  }

  async function ensureVoiceCapability() {
    if (voiceCapability) return voiceCapability;
    const voiceMod = await loadVoiceModule();
    const support = voiceMod?.voiceSupport?.() || { record: false, recognize: false, speak: false };
    const webrtcSupported = Boolean(globalThis.RTCPeerConnection && globalThis.navigator?.mediaDevices?.getUserMedia);
    let serverCap = { liveAvailable: false, serverStt: false };
    try {
      const res = await fetch("/api/voice", { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const json = await res.json();
        if (json && typeof json === "object") serverCap = { ...serverCap, ...json };
      }
    } catch {
      // ignore capability probe errors and fall back cleanly
    }
    const cap = {
      ...support,
      ...serverCap,
      liveAvailable: Boolean(serverCap.liveAvailable && webrtcSupported),
    };
    voiceCapability = cap;
    const voiceIds = Array.isArray(cap.liveVoices) ? cap.liveVoices.map((v) => v.id).filter(Boolean) : [];
    const defaultVoice = cap.liveVoice || voiceMod?.DEFAULT_LIVE_VOICE || "noeul";
    selectedLiveVoice = voiceMod?.loadLiveVoicePreference
      ? voiceMod.loadLiveVoicePreference(voiceIds.length ? voiceIds : null)
      : defaultVoice;
    ensureLiveVoiceSelect(cap.liveVoices || voiceMod?.LIVE_VOICE_OPTIONS);
    syncVoiceButtons(cap);
    return cap;
  }

  function ensureLiveVoiceSelect(options = null) {
    const actions = $("aiVoiceLiveBar")?.querySelector(".ai-voice-live-actions");
    if (!actions) return null;
    let select = $("aiVoiceSelect");
    if (!select) {
      select = document.createElement("select");
      select.id = "aiVoiceSelect";
      select.className = "ai-voice-select";
      select.setAttribute("aria-label", "실시간 음성 목소리 선택");
      select.title = "실시간 음성 목소리 선택";
      select.addEventListener("change", async () => {
        const nextVoice = select.value;
        if (!nextVoice || nextVoice === selectedLiveVoice) return;
        selectedLiveVoice = nextVoice;
        loadVoiceModule().then((mod) => mod?.saveLiveVoicePreference?.(nextVoice)).catch(() => {});
        if (isLiveVoiceActive() && !liveVoiceStarting) {
          toast("목소리를 바꿔서 대화를 이어갈게요.");
          await stopLiveVoice({ silent: true });
          await startLiveVoice();
        }
      });
      actions.prepend(select);
    }
    const list = Array.isArray(options) && options.length
      ? options
      : [
          { id: "noeul", label: "노을 (한국어 · 여성)" },
          { id: "marin", label: "마린 (차분함 · 기본)" },
          { id: "willow", label: "윌로우 (따뜻함 · 여성)" },
          { id: "quartz", label: "쿼츠 (밝음 · 여성)" },
          { id: "ripple", label: "리플 (부드러움 · 남성)" },
          { id: "vesper", label: "베스퍼 (중저음 · 남성)" },
        ];
    const currentSignature = Array.from(select.options).map((o) => `${o.value}:${o.textContent}`).join("|");
    const nextSignature = list.map((item) => `${item.id}:${item.label || item.id}`).join("|");
    if (currentSignature !== nextSignature) {
      select.innerHTML = "";
      for (const item of list) {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = item.label || item.id;
        select.append(opt);
      }
    }
    if (list.some((item) => item.id === selectedLiveVoice)) select.value = selectedLiveVoice;
    return select;
  }

  function syncVoiceButtons(cap) {
    const liveBtn = $("aiLiveVoiceButton");
    const micBtn = $("aiMicButton");
    if (!liveBtn || !micBtn) return;
    const liveHadFocus = document.activeElement === liveBtn;
    liveBtn.hidden = !cap?.liveAvailable;
    micBtn.hidden = Boolean(cap?.liveAvailable);
    if (liveHadFocus && liveBtn.hidden) micBtn.focus?.();
  }

  // 실시간 음성이 서버·WebRTC 문제로 열리지 않으면 이 화면에서는 일반 음성 입력(마이크 버튼)으로 바꾼다.
  // 그대로 두면 실패하는 실시간 버튼만 남아 음성 입력을 아예 쓸 수 없게 된다.
  function downgradeLiveVoice() {
    voiceCapability = { ...(voiceCapability || {}), liveAvailable: false };
    syncVoiceButtons(voiceCapability);
    const cap = voiceCapability;
    return Boolean(cap.recognize || (cap.serverStt && cap.record));
  }

  function liveStartFailureMessage(error, describe) {
    const failure = typeof describe === "function"
      ? describe(error)
      : { fallback: true, message: "지금은 실시간 음성 대화를 쓸 수 없어요." };
    if (!failure.fallback) return failure.message || "실시간 음성 대화를 시작하지 못했어요.";
    const canFallbackVoice = downgradeLiveVoice();
    return canFallbackVoice
      ? `${failure.message} 일반 음성 입력으로 바꿨어요. 마이크 버튼을 눌러 말씀해 주세요.`
      : `${failure.message} 질문을 글로 적어 주세요.`;
  }

  function finalizeLiveTranscriptBubbles() {
    liveUserBubble?.classList.remove("is-live-transcript");
    liveAssistantBubble?.classList.remove("is-live-transcript");
    liveUserBubble = null;
    liveAssistantBubble = null;
  }

  function syncLiveMuteButton(muted) {
    const muteBtn = $("aiVoiceMuteBtn");
    if (!muteBtn) return;
    const isMuted = Boolean(muted);
    muteBtn.setAttribute("aria-pressed", String(isMuted));
    muteBtn.classList.toggle("is-muted", isMuted);
    muteBtn.textContent = isMuted ? "🎙️ 마이크 켜기" : "🔇 마이크 끄기";
  }

  const LIVE_STATUS_TEXT = {
    connecting: "농농이와 실시간 음성 대화를 연결하는 중…",
    listening: "농농이와 실시간 음성 대화 중 (듣는 중…)",
    thinking: "농농이가 매물·날씨를 확인하는 중…",
    speaking: "농농이가 말하는 중…",
    muted: "마이크가 꺼져 있어요 (눌러서 다시 켜기)",
    idle: "농농이와 실시간 음성 대화 중 (듣는 중…)",
    closed: "농농이와 실시간 음성 대화 중 (듣는 중…)",
  };

  function syncLiveVoiceBar(voiceState = "idle") {
    const bar = $("aiVoiceLiveBar");
    const statusEl = $("aiVoiceLiveStatus");
    const liveBtn = $("aiLiveVoiceButton");
    const active = voiceState !== "idle" && voiceState !== "closed";
    if (bar) {
      bar.hidden = !active;
      bar.dataset.voiceState = voiceState;
    }
    if (statusEl) {
      statusEl.textContent = LIVE_STATUS_TEXT[voiceState] || LIVE_STATUS_TEXT.listening;
    }
    if (liveBtn) {
      liveBtn.setAttribute("aria-pressed", String(active));
      liveBtn.classList.toggle("is-active", active);
    }
  }

  function appendOrUpdateTranscriptBubble(role, delta, meta = {}) {
    if ($("aiWelcomeHero")) $("aiWelcomeHero").hidden = true;
    const starters = $("aiStarters");
    if (starters) starters.hidden = true;
    const isUser = role === "user";
    let bubble = isUser ? liveUserBubble : liveAssistantBubble;
    const textChunk = typeof delta === "string" ? delta : "";
    if (!bubble && textChunk && joinSpokenText("", textChunk)) {
      bubble = appendAiMessage(joinSpokenText("", textChunk), isUser ? "user" : "assistant");
      bubble.classList.add("is-live-transcript");
      if (isUser) liveUserBubble = bubble;
      else liveAssistantBubble = bubble;
    } else if (bubble && textChunk) {
      let textNode = bubble.querySelector(".ai-live-transcript-text");
      if (!textNode) {
        textNode = document.createElement("span");
        textNode.className = "ai-live-transcript-text";
        textNode.textContent = bubble.textContent || "";
        bubble.textContent = "";
        bubble.append(textNode);
      }
      textNode.textContent = joinSpokenText(textNode.textContent, textChunk);
      scrollAiToEnd();
    }
    if (meta?.done || meta?.final) {
      if (bubble) {
        bubble.classList.remove("is-live-transcript");
        if (!isUser) {
          const finalText = tidySpokenText(bubble.textContent || "");
          if (finalText.trim()) {
            bubble.replaceChildren(renderMarkdownElement(finalText));
          }
        }
      }
      if (isUser) liveUserBubble = null;
      else liveAssistantBubble = null;
    }
  }

  function buildDelegationThinkingContext(result, listingIds) {
    if (!result || typeof result !== "object") return "";
    const parts = [];
    if (result.searchDates?.start) {
      parts.push(`조회기간: ${result.searchDates.start}${result.searchDates.end ? `~${result.searchDates.end}` : ""}`);
    }
    if (result.weatherInfo && typeof result.weatherInfo === "object") {
      const w = result.weatherInfo;
      const wBits = [w.summary, w.badWeatherWarning, w.recommendation].filter(Boolean);
      if (Array.isArray(w.goodAlternatives) && w.goodAlternatives.length) {
        wBits.push(`맑은 추천일: ${w.goodAlternatives.map((d) => (typeof d === "string" ? d : d?.date || d?.label)).filter(Boolean).slice(0, 4).join(", ")}`);
      }
      if (wBits.length) parts.push(`날씨: ${wBits.join(" / ")}`);
    }
    if (Array.isArray(listingIds) && listingIds.length) {
      const items = listingIds.slice(0, 4).map((id) => listingById(id)).filter(Boolean)
        .map((item) => `${item.title}(${item.region}, ${item.type === "sale" ? `${item.price}원` : `일 ${item.dailyPrice}원`})`);
      if (items.length) parts.push(`후보매물: ${items.join("; ")}`);
    }
    if (result.learnedSlots && typeof result.learnedSlots === "object") {
      const s = result.learnedSlots;
      const slotBits = [
        s.region ? `지역=${s.region}` : "",
        s.areaPyeong ? `면적=${s.areaPyeong}평` : "",
        s.date ? `날짜=${s.date}${s.dateEnd ? `~${s.dateEnd}` : ""}` : "",
        s.budgetWon ? `예산=${s.budgetWon}원` : "",
      ].filter(Boolean);
      if (slotBits.length) parts.push(`기억된조건: ${slotBits.join(", ")}`);
    }
    if (result.pendingAction?.title) {
      parts.push(`승인대기: ${result.pendingAction.title}`);
    }
    return parts.join(" | ").slice(0, 780);
  }

  async function handleClientDelegation(payload, gen, liveGen) {
    if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return null;
    const delegationId = payload?.delegationId || payload?.id || "";
    const userText = String(payload?.userText || payload?.transcript || payload?.message || "").trim();
    if (!userText) return { spokenSummary: "무슨 작업이나 농기계를 찾으시는지 다시 말씀해 주세요." };
    // 인식이 실패했거나 알아들을 수 없는 조각이면 대충 넘기지 않고 짧게 다시 묻는다(모델 호출도 아낀다).
    if (isUnclearUtterance(userText)) return { spokenSummary: "죄송해요, 잘 못 들었어요. 한 번만 다시 말씀해 주시겠어요?" };
    if (delegationId && renderedDelegationIds.has(delegationId)) {
      return null;
    }
    if (runtime.catalogState !== "ready") await Promise.resolve(runtime.catalogReady).catch(() => {});
    if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return null;

    const uiContext = collectUiContext();
    // 위임 전에 맞장구가 먼저 나오면 같은 발화가 이미 기억에 있다: 에이전트에는 그 앞까지만 history로 보낸다.
    let committedAt = -1;
    if (payload?.userTurnCommitted) {
      for (let i = agentHistory.length - 1; i >= 0; i -= 1) {
        if (agentHistory[i].role === "user" && agentHistory[i].content === userText) { committedAt = i; break; }
      }
    }
    let result;
    try {
      result = await askAgent(userText, {
      history: committedAt >= 0 ? agentHistory.slice(0, committedAt) : agentHistory,
      region: uiContext.region,
      uiContext,
      inputMode: "voice",
      delegationId: delegationId || undefined,
      sessionId: agentSessionId,
      savedDraft,
      insuranceOffer,
      insuranceAsked,
      fullDelegation: fullDelegationEnabled,
      pendingAction: takePendingAction(),
    });
    } catch (error) {
      if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return null;
      // 무한 대기로 두지 않고, 이유와 다음 방법을 한 문장으로 말한다.
      const reason = typeof error?.message === "string" && /[가-힣]/.test(error.message) ? error.message.trim() : "";
      const spoken = error?.status === 401
        ? "구매나 예약은 로그인한 뒤에 할 수 있어요. 화면에서 로그인하시면 바로 이어서 해 드릴게요."
        : error?.status === 429
          ? "요청이 잠깐 몰렸어요. 조금 뒤에 같은 말씀을 한 번 더 해 주세요."
          : `죄송해요, ${reason || "처리 중에 연결 문제가 생겼어요."} 같은 말씀을 한 번 더 해 주시면 바로 다시 할게요.`;
      if (reason) toast(reason);
      rememberAgentTurn(...(committedAt >= 0 ? [] : [{ role: "user", content: userText }]), { role: "assistant", content: spoken });
      appendAiMessage(spoken, "assistant");
      return { spokenSummary: spoken };
    }
    if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return null;
    if (result?.sessionId) agentSessionId = result.sessionId;
    if (delegationId) renderedDelegationIds.add(delegationId);

    const reply = typeof result?.reply === "string" && result.reply.trim()
      ? result.reply.trim()
      : "말씀하신 내용을 확인했어요.";
    if (!result?.insuranceAsk) trackInsurance(result);
    rememberAgentTurn(
      ...(committedAt >= 0 ? [] : [{ role: "user", content: userText }]),
      { role: "assistant", content: reply },
    );

    const listingIds = result?.reservation || result?.createdListing || result?.updatedListing
      ? []
      : (Array.isArray(result?.listingIds) ? result.listingIds : []).filter((id) => listingById(id));
    const bubble = appendAiMessage(reply, "assistant", listingIds, null, { searchDates: result?.searchDates || null });
    renderAgentEffects(bubble, result, { reply, includeFollowUp: false });
    scrollAiToEnd();

    // 답변을 그대로 읽게 한다. 실행은 말로 요청하면 서버가 바로 처리하므로 버튼을 누르라고 덧붙이지 않는다.
    const spokenSummary = tidySpokenText(reply);
    const thinkingContext = buildDelegationThinkingContext(result, listingIds);
    return { spokenSummary, ...(thinkingContext ? { thinkingContext } : {}), result };
  }

  function muteLiveVoiceForPhoto() {
    if (isLiveVoiceActive() && !liveController.muted) {
      liveController.setMuted(true);
      syncLiveMuteButton(true);
      syncLiveVoiceBar(liveController.state);
    }
  }

  async function stopLiveVoice({ silent = false } = {}) {
    // 세대를 올리면 onTurnCommitted가 막히므로, 말하던 중인 턴(목소리 변경·종료 직전)을 먼저 기억에 남긴다.
    try { liveController?.commitPendingTurns?.(); } catch { /* ignore */ }
    liveVoiceGeneration += 1;
    liveVoiceStarting = false;
    const controller = liveController;
    liveController = null;
    finalizeLiveTranscriptBubbles();
    syncLiveMuteButton(false);
    syncLiveVoiceBar("idle");
    if (controller) {
      try {
        await controller.stop();
      } catch (error) {
        if (!silent) toast(error?.message || "음성 대화를 종료했어요.");
      }
    }
  }

  async function startLiveVoice() {
    if (isLiveVoiceActive() || liveVoiceStarting) {
      await stopLiveVoice();
      return;
    }
    stopFallbackVoice();
    liveVoiceStarting = true;
    const gen = sessionGeneration;
    const liveGen = liveVoiceGeneration;
    try {
      const cap = await ensureVoiceCapability();
      if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return;
      if (!cap.liveAvailable) {
        liveVoiceStarting = false;
        await toggleFallbackVoice();
        return;
      }
      const liveMod = await loadLiveModule();
      if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return;
      if (typeof liveMod?.createGptLiveController !== "function") {
        liveVoiceStarting = false;
        downgradeLiveVoice();
        await toggleFallbackVoice();
        return;
      }
      let connected = false;
      const uiContext = collectUiContext();
      syncLiveMuteButton(false);
      syncLiveVoiceBar("connecting");
      const controller = liveMod.createGptLiveController({
        region: uiContext.region,
        voice: selectedLiveVoice,
        uiContext,
        history: agentHistory,
        audioElement: ensureVoiceAudioElement(),
        onState: (nextState) => {
          if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return;
          const resolvedState = nextState === "listening" && controller.muted ? "muted" : (nextState || "listening");
          syncLiveVoiceBar(resolvedState);
          syncLiveMuteButton(controller.muted);
          if (nextState === "listening" || nextState === "muted") finalizeLiveTranscriptBubbles();
          if (nextState === "closed" || nextState === "idle") {
            // 서버가 먼저 세션을 닫아도 다음 대화가 이전 말풍선에 이어 붙지 않게 정리한다.
            finalizeLiveTranscriptBubbles();
            syncLiveMuteButton(false);
            if (liveController === controller) liveController = null;
          }
        },
        onUserTranscriptDelta: (payload) => {
          if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return;
          appendOrUpdateTranscriptBubble("user", payload?.delta || "");
        },
        onAssistantTranscriptDelta: (payload) => {
          if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return;
          appendOrUpdateTranscriptBubble("assistant", payload?.delta || "");
        },
        onTurnCommitted: (turn) => {
          if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return;
          if (turn?.delegated) return; // 위임 답변은 handleClientDelegation이 이미 기록했다.
          if (turn?.text && (turn.role === "user" || turn.role === "assistant")) {
            rememberAgentTurn({ role: turn.role, content: turn.text });
          }
        },
        onClientDelegation: (payload) => handleClientDelegation(payload, gen, liveGen),
        onError: (error, info = {}) => {
          if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) return;
          if (info.fatal === false) {
            // 대화는 계속된다: 위임 실패는 음성으로도 사과하고, 서버 error 이벤트는 기록만 한다.
            if (info.source === "event") console.warn("gpt_live_event_error", error?.message);
            else toast(error?.message || "실시간 음성 대화 중 문제가 생겼어요.");
            return;
          }
          toast(connected
            ? (error?.message || "실시간 음성 연결이 끊어졌어요.")
            : liveStartFailureMessage(error, liveMod.describeLiveStartError));
          stopLiveVoice({ silent: true });
        },
      });
      liveController = controller;
      await controller.start();
      connected = true;
      if (gen !== sessionGeneration || liveGen !== liveVoiceGeneration) {
        await controller.stop().catch(() => {});
      }
    } catch (error) {
      if (gen === sessionGeneration && liveGen === liveVoiceGeneration) {
        liveController = null;
        syncLiveVoiceBar("idle");
        toast(error?.message || "실시간 음성 대화를 시작하지 못했어요.");
      }
    } finally {
      if (liveGen === liveVoiceGeneration) liveVoiceStarting = false;
    }
  }

  function stopFallbackVoice() {
    fallbackVoiceGeneration += 1;
    fallbackVoiceStarting = false;
    fallbackVoiceUsed = false;
    pendingInputMode = "text";
    const active = fallbackVoiceInput;
    fallbackVoiceInput = null;
    const micBtn = $("aiMicButton");
    if (micBtn) {
      micBtn.setAttribute("aria-pressed", "false");
      micBtn.classList.remove("is-active");
    }
    if ($("aiInput") && $("aiInput").placeholder !== aiDefaultPlaceholder) {
      $("aiInput").placeholder = aiDefaultPlaceholder;
    }
    if (active) {
      try { active.cancel?.(); } catch { /* ignore */ }
    }
    loadVoiceModule().then((mod) => mod?.stopSpeaking?.()).catch(() => {});
  }

  async function toggleFallbackVoice() {
    const micBtn = $("aiMicButton");
    const resetMicUi = () => {
      if (micBtn) {
        micBtn.setAttribute("aria-pressed", "false");
        micBtn.classList.remove("is-active");
      }
      if ($("aiInput")) $("aiInput").placeholder = aiDefaultPlaceholder;
    };
    if (fallbackVoiceInput) {
      const gen = sessionGeneration;
      const fbGen = fallbackVoiceGeneration;
      const current = fallbackVoiceInput;
      fallbackVoiceInput = null;
      resetMicUi();
      try {
        const result = await current.stop?.();
        if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
        let recognizedText = "";
        if (typeof result === "string") {
          recognizedText = result;
        } else if (result?.base64) {
          if ($("aiInput")) $("aiInput").placeholder = "말씀하신 내용을 옮겨 적고 있어요…";
          const res = await fetch("/api/voice", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ audio: result.base64 }),
          });
          if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
          const data = await res.json().catch(() => ({}));
          if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
          if (!res.ok) throw new Error(data?.message || "음성 인식에 실패했어요.");
          recognizedText = data?.text || "";
        }
        if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
        if ($("aiInput")) $("aiInput").placeholder = aiDefaultPlaceholder;
        const trimmed = String(recognizedText || "").trim();
        if (trimmed && !isUnclearUtterance(trimmed)) {
          fallbackVoiceUsed = true;
          pendingInputMode = "voice";
          submitPrompt(trimmed);
        } else {
          toast("잘 못 들었어요. 마이크 버튼을 누르고 한 번만 다시 말씀해 주세요.");
        }
      } catch (error) {
        if (gen === sessionGeneration && fbGen === fallbackVoiceGeneration) {
          resetMicUi();
          toast(error?.message || "음성 인식에 실패했어요.");
        }
      }
      return;
    }
    if (fallbackVoiceStarting) {
      stopFallbackVoice();
      return;
    }
    fallbackVoiceStarting = true;
    const gen = sessionGeneration;
    const fbGen = fallbackVoiceGeneration;
    try {
      const voiceMod = await loadVoiceModule();
      const cap = await ensureVoiceCapability();
      if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
      const canServerStt = Boolean(cap.serverStt && typeof voiceMod?.startRecording === "function" && cap.record);
      const canBrowserStt = Boolean(typeof voiceMod?.startBrowserRecognition === "function" && cap.recognize);
      if (!canServerStt && !canBrowserStt) {
        toast("이 브라우저에서는 음성 입력을 사용할 수 없어요.");
        return;
      }
      voiceMod.primeSpeech?.();
      if (micBtn) {
        micBtn.setAttribute("aria-pressed", "true");
        micBtn.classList.add("is-active");
      }
      if (canServerStt) {
        if ($("aiInput")) $("aiInput").placeholder = "듣고 있어요… 다시 누르면 전송돼요";
        const recorder = await voiceMod.startRecording({
          onTick: (left) => {
            if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
            if ($("aiInput")) $("aiInput").placeholder = `듣고 있어요 (${left}초) · 다시 누르면 전송`;
          },
          onLimit: () => {
            if (gen === sessionGeneration && fbGen === fallbackVoiceGeneration && fallbackVoiceInput) toggleFallbackVoice();
          },
        });
        if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) {
          try { recorder?.cancel?.(); } catch { /* ignore */ }
          return;
        }
        fallbackVoiceInput = recorder;
      } else {
        if ($("aiInput")) $("aiInput").placeholder = "듣고 있어요… 다시 누르면 전송돼요";
        const recognition = voiceMod.startBrowserRecognition({
          onInterim: (text) => {
            if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
            if (text && $("aiInput")) $("aiInput").placeholder = text;
          },
          onLimit: () => {
            if (gen === sessionGeneration && fbGen === fallbackVoiceGeneration && fallbackVoiceInput) toggleFallbackVoice();
          },
          onFailure: (error) => {
            if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) return;
            fallbackVoiceInput = null;
            resetMicUi();
            toast(error?.message || "음성 인식에 실패했어요.");
          },
        });
        if (gen !== sessionGeneration || fbGen !== fallbackVoiceGeneration) {
          try { recognition?.cancel?.(); } catch { /* ignore */ }
          return;
        }
        fallbackVoiceInput = recognition;
      }
    } catch (error) {
      if (gen === sessionGeneration && fbGen === fallbackVoiceGeneration) {
        fallbackVoiceInput = null;
        resetMicUi();
        toast(error?.message || "음성 입력을 시작하지 못했어요.");
      }
    } finally {
      if (fbGen === fallbackVoiceGeneration) fallbackVoiceStarting = false;
    }
  }

  $("aiLiveVoiceButton")?.addEventListener("click", () => {
    startLiveVoice();
  });
  $("aiMicButton")?.addEventListener("click", () => {
    toggleFallbackVoice();
  });
  $("aiVoiceMuteBtn")?.addEventListener("click", () => {
    if (!isLiveVoiceActive()) return;
    const nextMuted = !liveController.muted;
    liveController.setMuted(nextMuted);
    syncLiveMuteButton(nextMuted);
    syncLiveVoiceBar(liveController.state);
  });
  $("aiVoiceStopBtn")?.addEventListener("click", () => {
    stopLiveVoice();
  });

  if (aiPanelEl && typeof MutationObserver === "function") {
    let wasPanelHidden = aiPanelEl.hidden;
    const panelObserver = new MutationObserver(() => {
      const isNowHidden = aiPanelEl.hidden;
      if (!wasPanelHidden && isNowHidden) {
        try { liveController?.commitPendingTurns?.(); } catch { /* ignore */ }
        sessionGeneration += 1;
        setPlusMenuOpen(false);
        stopLiveVoice({ silent: true });
        stopFallbackVoice();
      }
      wasPanelHidden = isNowHidden;
    });
    panelObserver.observe(aiPanelEl, { attributes: true, attributeFilter: ["hidden"] });
  }

  async function sendAiQuestion(event) {
    event.preventDefault();
    const sendingPhoto = photoIsNew && agentPhoto ? agentPhoto : null;
    const message = $("aiInput").value.trim() || (sendingPhoto ? "이 기계 사진이에요." : "");
    if (!message || recommendationPending) return;
    if (message.length > 500) return toast("질문을 500자 이내로 입력해 주세요.");
    if (sendingPhoto) lastPhotoDataUrl = sendingPhoto;

    const gen = sessionGeneration;
    const inputMode = pendingInputMode;
    pendingInputMode = "text";
    recommendationPending = true;
    const submit = $("aiForm").querySelector('[type="submit"]');
    submit.disabled = true;
    $("aiInput").value = "";
    $("aiInput").placeholder = aiDefaultPlaceholder;
    if ($("aiWelcomeHero")) $("aiWelcomeHero").hidden = true;
    $("aiStarters").hidden = true;
    setPlusMenuOpen(false);
    $("aiMessages").querySelectorAll(".ai-follow-up, .ai-date-picker, .ai-plan-card").forEach((el) => el.remove());
    appendAiMessage(message, "user", [], sendingPhoto);
    let pending;

    try {
      if (!sendingPhoto && AGENT_RESET_RE.test(message)) {
        performReset();
        return;
      }
      pending = appendAiMessage(sendingPhoto ? "농농이가 사진을 보고 있어요…" : "농농이가 생각하고 있어요…", "assistant");
      pending.classList.add("is-thinking");
      const wave = document.createElement("span");
      wave.className = "ai-thinking-wave";
      wave.setAttribute("aria-hidden", "true");
      wave.innerHTML = "<span></span><span></span><span></span><span></span>";
      pending.prepend(wave);
      if (runtime.catalogState !== "ready") await Promise.resolve(runtime.catalogReady).catch(() => {});
      if (gen !== sessionGeneration) return;
      const uiContext = collectUiContext();
      const agentResult = await askAgent(message, {
        history: agentHistory,
        region: uiContext.region,
        inputMode,
        sessionId: agentSessionId,
        uiContext,
        image: sendingPhoto || undefined,
        savedDraft,
        insuranceOffer,
        insuranceAsked,
        fullDelegation: fullDelegationEnabled,
        pendingAction: sendingPhoto ? null : takePendingAction(),
      });
      if (gen !== sessionGeneration) return;
      if (agentResult?.sessionId) agentSessionId = agentResult.sessionId;
      pending.remove();
      pending = undefined;
      if (agentResult?.mode === "agent") {
        if (!agentResult.insuranceAsk) trackInsurance(agentResult);
        if (sendingPhoto) {
          photoIsNew = false;
          showPhotoPreview();
        }
        if (agentResult.createdListing) clearPhoto();
        renderAgentResult(message, agentResult, { photo: Boolean(sendingPhoto) });
        return;
      }
      appendAiMessage("AI 상담을 호출할 수 없습니다. 잠시 후 다시 시도해 주세요.", "assistant");
      if ($("aiModeLabel")) $("aiModeLabel").textContent = "AI 상담 · 연결 불가";
    } catch (error) {
      if (gen !== sessionGeneration) return;
      console.error("AI 상담 호출 실패", error);
      appendAiMessage(error?.message || "AI 상담을 호출할 수 없습니다. 잠시 후 다시 시도해 주세요.", "assistant");
      if ($("aiModeLabel")) $("aiModeLabel").textContent = "AI 상담 · 연결 불가";
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
    const panel = $("aiPanel");
    const wasHidden = panel.hidden;
    panel.hidden = false;
    document.body.classList.add("ai-open");
    $("aiLauncher").setAttribute("aria-expanded", "true");
    applyWelcomeStagger();
    if (wasHidden) {
      setAiLayoutMode("fullscreen", { animate: true });
    } else {
      setAiLayoutMode(aiLayoutMode, { animate: false });
    }
    if (!$("aiStarters")?.hidden) renderStarterBar();
    refreshContextBar();
    syncAiViewport();
    ensureVoiceCapability().catch(() => {});
    $("aiClose").focus({ preventScroll: true });
  }

  function toggleAiPanelSize() {
    setAiLayoutMode(aiLayoutMode === "fullscreen" ? "docked" : "fullscreen", { reflow: true });
  }

  function performReset() {
    sessionGeneration += 1;
    renderedDelegationIds.clear();
    liveUserBubble = null;
    liveAssistantBubble = null;
    fallbackVoiceUsed = false;
    pendingInputMode = "text";
    stopLiveVoice({ silent: true });
    stopFallbackVoice();
    agentHistory = [];
    lastShownListingIds = [];
    lastPendingAction = null;
    agentSessionId = null;
    insuranceOffer = null;
    insuranceAsked = false;
    savedDraft = null;
    lastPhotoDataUrl = null;
    setupExpanded = false;
    setFullDelegation(false);
    setPlusMenuOpen(false);
    renderStarterBar();
    clearPhoto();
    if (initialWelcomeHtml) {
      $("aiMessages").innerHTML = initialWelcomeHtml;
      applyWelcomeStagger();
    } else {
      $("aiMessages").replaceChildren();
      appendAiMessage("어떤 작물에 어떤 작업을 하실 건가요? 한 줄로 말씀하시면 필요한 조건만 차례로 여쭤볼게요.", "assistant");
    }
    $("aiStarters").hidden = false;
    $("aiInput").value = "";
    $("aiInput").placeholder = aiDefaultPlaceholder;
    refreshContextBar();
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
    setAiLayoutMode,
    resetAiPanel,
    submitPrompt,
    refreshContextBar,
  };
}
