import { $ } from "./utils.js";

const activeNumberRafs = new WeakMap();
const trackedNumbers = new WeakMap();
const suppressNumberObserver = new WeakSet();
const observedStaggerNodes = new WeakSet();
const observedViewNodes = new WeakSet();
const observedCountNodes = new WeakSet();

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function parseCountParts(text) {
  const match = String(text ?? "").trim().match(/^([^\d-]*)(-?\d+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  return { prefix: match[1], value, suffix: match[3] };
}

/**
 * Smoothly interpolates a numeric counter element using easeOutExpo.
 */
export function animateNumber(el, targetValue, { duration = 380, suffix = "", prefix = "" } = {}) {
  if (!el) return;
  const target = Number(targetValue);
  if (!Number.isFinite(target)) return;

  const prevRaf = activeNumberRafs.get(el);
  if (prevRaf) {
    cancelAnimationFrame(prevRaf);
    activeNumberRafs.delete(el);
  }

  let start = trackedNumbers.get(el);
  if (!Number.isFinite(start)) {
    const parsed = parseCountParts(el.textContent);
    start = parsed ? parsed.value : 0;
  }

  const isInt = Number.isInteger(target) && Number.isInteger(start);
  const formatValue = (val) => (isInt ? String(Math.round(val)) : val.toFixed(1));
  const writeText = (next) => {
    suppressNumberObserver.add(el);
    el.textContent = next;
    queueMicrotask(() => suppressNumberObserver.delete(el));
  };

  if (prefersReducedMotion() || duration <= 0 || start === target) {
    trackedNumbers.set(el, target);
    const finalText = `${prefix}${formatValue(target)}${suffix}`;
    if (el.textContent !== finalText) writeText(finalText);
    return;
  }

  const startTime = performance.now();
  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

  const step = (now) => {
    const t = Math.min(1, (now - startTime) / duration);
    const current = start + (target - start) * easeOutExpo(t);
    trackedNumbers.set(el, current);
    writeText(`${prefix}${formatValue(current)}${suffix}`);
    if (t < 1) {
      activeNumberRafs.set(el, requestAnimationFrame(step));
    } else {
      trackedNumbers.set(el, target);
      activeNumberRafs.delete(el);
    }
  };

  trackedNumbers.set(el, start);
  writeText(`${prefix}${formatValue(start)}${suffix}`);
  activeNumberRafs.set(el, requestAnimationFrame(step));
}

/**
 * Assigns --stagger-i and .stagger-enter to child items for cascading entrance.
 */
export function staggerElements(container, selector = ":scope > *", { stepMs = 35, maxIndex = 12 } = {}) {
  if (!container) return [];
  let items;
  try {
    items = [...container.querySelectorAll(selector)];
  } catch {
    items = [...container.children];
  }
  const reduceMotion = prefersReducedMotion();
  items.forEach((el, index) => {
    if (!(el instanceof Element)) return;
    if (reduceMotion) {
      el.classList.remove("stagger-enter");
      el.style.removeProperty("--stagger-i");
      el.style.removeProperty("--stagger-step");
      return;
    }
    el.style.setProperty("--stagger-i", String(Math.min(index, maxIndex)));
    el.style.setProperty("--stagger-step", `${stepMs}ms`);
    if (el.classList.contains("stagger-enter")) {
      el.classList.remove("stagger-enter");
      requestAnimationFrame(() => el.classList.add("stagger-enter"));
    } else {
      el.classList.add("stagger-enter");
    }
  });
  return items;
}

/**
 * Plays shared-axis entrance animation when a view container becomes visible.
 */
export function choreographViewSwitch(viewEl) {
  if (!viewEl) return;
  if (prefersReducedMotion()) {
    viewEl.classList.remove("view-transition-enter");
    return;
  }
  viewEl.classList.remove("view-transition-enter");
  void viewEl.offsetWidth;
  viewEl.classList.add("view-transition-enter");
  viewEl.addEventListener(
    "animationend",
    (event) => {
      if (event.target === viewEl) {
        viewEl.classList.remove("view-transition-enter");
      }
    },
    { once: true }
  );
}

export function initAutoChoreography() {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;

  const staggerTargets = document.querySelectorAll(
    "#listingGrid, #marketGrid, #guideContent, #quickOperationList, #garageView"
  );
  for (const container of staggerTargets) {
    if (observedStaggerNodes.has(container)) continue;
    observedStaggerNodes.add(container);
    if (container.children.length > 0 && !container.hidden) {
      staggerElements(container, ":scope > *", { stepMs: 35, maxIndex: 12 });
    }
    const observer = new MutationObserver((mutations) => {
      const hasAddedElement = mutations.some((m) =>
        [...m.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE)
      );
      if (hasAddedElement) {
        staggerElements(container, ":scope > *", { stepMs: 35, maxIndex: 12 });
      }
    });
    observer.observe(container, { childList: true });
  }

  const viewTargets = document.querySelectorAll(
    "[data-view], #homeView, #browseView, #guideView, #garageView, #requestsView, #ownerView, #ownerLoginRequiredView, #loginView"
  );
  for (const viewEl of viewTargets) {
    if (viewEl.tagName === "BUTTON" || viewEl.tagName === "A") continue;
    if (observedViewNodes.has(viewEl)) continue;
    observedViewNodes.add(viewEl);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "hidden") {
          if (m.oldValue !== null && !viewEl.hidden) {
            choreographViewSwitch(viewEl);
          }
        }
      }
    });
    observer.observe(viewEl, { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });
  }

  const previewCount = document.getElementById("filterPreviewCount");
  if (previewCount && !observedCountNodes.has(previewCount)) {
    observedCountNodes.add(previewCount);
    const initial = parseCountParts(previewCount.textContent);
    if (initial) trackedNumbers.set(previewCount, initial.value);
    const observer = new MutationObserver(() => {
      if (suppressNumberObserver.has(previewCount)) return;
      const parsed = parseCountParts(previewCount.textContent);
      if (!parsed) return;
      if (trackedNumbers.get(previewCount) === parsed.value) return;
      animateNumber(previewCount, parsed.value, {
        duration: 380,
        prefix: parsed.prefix,
        suffix: parsed.suffix,
      });
    });
    observer.observe(previewCount, { childList: true, characterData: true, subtree: true });
  }
}

// 메인 배너: 4초마다 자동으로 다음 장, 멈춤/재생·이전/다음·점 선택
export function initBannerCarousel(onBannerView) {
  const track = $("bannerTrack");
  if (!track) return;
  const slides = [...track.children];
  const dots = [...document.querySelectorAll(".banner-dot")];
  const pauseButton = $("bannerPause");
  let index = 0;
  let paused = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  let timer = null;

  const show = (next) => {
    index = (next + slides.length) % slides.length;
    track.style.transform = `translateX(-${index * 100}%)`;
    slides.forEach((slide, i) => {
      const current = i === index;
      slide.setAttribute("aria-hidden", String(!current));
      slide.classList.toggle("is-active", current);
      for (const el of slide.querySelectorAll("a, button")) el.tabIndex = current ? 0 : -1;
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
      if (i === index) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    $("bannerCounter").textContent = String(index + 1).padStart(2, "0");
  };
  const restart = () => {
    clearInterval(timer);
    if (!paused) timer = setInterval(() => show(index + 1), 4000);
  };
  const setPaused = (value) => {
    paused = value;
    pauseButton.classList.toggle("is-paused", paused);
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.setAttribute("aria-label", paused ? "자동 넘김 다시 시작" : "자동 넘김 멈추기");
    restart();
  };

  $("bannerPrev").addEventListener("click", () => { show(index - 1); restart(); });
  $("bannerNext").addEventListener("click", () => { show(index + 1); restart(); });
  pauseButton.addEventListener("click", () => setPaused(!paused));
  dots.forEach((dot, i) => dot.addEventListener("click", () => { show(i); restart(); }));
  for (const button of track.querySelectorAll("[data-banner-view]")) {
    button.addEventListener("click", () => onBannerView?.(button.dataset.bannerView));
  }
  show(0);
  setPaused(paused);
}

// 상단바 높이를 CSS 변수로 알려 농농 상담창이 상단바 아래까지만 커지게 한다
export function trackHeaderHeight() {
  const header = document.querySelector(".sidebar");
  if (!header) return;
  const apply = () => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
  apply();
  if ("ResizeObserver" in window) new ResizeObserver(apply).observe(header);
  else window.addEventListener("resize", apply);
}
