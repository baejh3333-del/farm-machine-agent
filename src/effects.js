// 이 파일은 main.js에서 나눈 모듈이다. 다른 화면 함수는 app(app.js)을 통해 부른다.
// 화면 연출: 메인 배너, 스크롤 등장 효과, 상단바 높이, 스크롤 모션.
import { app } from "./app.js";
import { $ } from "./ui.js";

// 메인 배너: 4초마다 자동으로 다음 장, 멈춤/재생·이전/다음·점 선택
export function initBannerCarousel() {
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
    button.addEventListener("click", () => app.setView(button.dataset.bannerView));
  }
  show(0);
  setPaused(paused);
}
// 브랜드 소개(모아농?) 화면: 스크롤로 보일 때마다 구역이 아래에서 떠오르며 나타난다
export function initRevealOnScroll() {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) {
    for (const el of items) el.classList.add("is-visible");
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  for (const el of items) observer.observe(el);
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
// 토스 스타일 스크롤 모션: 글자가 스크롤에 맞춰 차례로 진해지고, 이미지는 커지며 천천히 움직인다
export function initScrollMotion() {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const wordBlocks = [...document.querySelectorAll("[data-scroll-words]")];
  // 글자를 단어 단위로 나눈다 (<br>, <strong> 같은 태그는 그대로 둔다)
  const splitWords = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = child.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) frag.append(part);
          else {
            const span = document.createElement("span");
            span.className = "scroll-word";
            span.textContent = part;
            frag.append(span);
          }
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        splitWords(child);
      }
    }
  };
  for (const block of wordBlocks) splitWords(block);
  if (reduceMotion) {
    for (const w of document.querySelectorAll(".scroll-word")) w.classList.add("is-lit");
    return;
  }
  const growers = [...document.querySelectorAll("[data-scroll-grow]")];
  const parallax = [...document.querySelectorAll("[data-parallax]")];
  const clamp = (v) => Math.min(1, Math.max(0, v));
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight;
    const scrollY = window.scrollY;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    for (const block of wordBlocks) {
      if (block.offsetParent === null) continue;
      const r = block.getBoundingClientRect();
      // 블록 윗부분이 화면 아래 85% 지점에 닿을 때 시작해 화면 45% 지점을 지날 때 끝난다
      // 페이지 끝이라 그만큼 스크롤할 수 없으면, 맨 아래에 닿는 순간 끝나도록 맞춘다
      const absTop = r.top + scrollY;
      const start = absTop - vh * 0.85;
      const end = Math.min(absTop + r.height - vh * 0.45, maxScroll);
      const progress = end <= start ? (scrollY >= end ? 1 : 0) : clamp((scrollY - start) / (end - start));
      const words = block.querySelectorAll(".scroll-word");
      const lit = Math.round(progress * words.length);
      words.forEach((w, i) => w.classList.toggle("is-lit", i < lit));
    }
    for (const el of growers) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      const progress = clamp((vh - r.top) / (vh * 0.7));
      el.style.setProperty("--grow", (0.86 + 0.14 * progress).toFixed(4));
      el.style.setProperty("--grow-radius", `${Math.round(48 - 16 * progress)}px`);
    }
    for (const el of parallax) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      const center = (r.top + r.height / 2 - vh / 2) / vh;
      el.style.setProperty("--parallax", `${(center * -40).toFixed(1)}px`);
    }
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  // 다른 화면에서 돌아왔을 때도 바로 맞춘다
  for (const button of document.querySelectorAll("[data-view], #brandHome")) button.addEventListener("click", () => setTimeout(update, 60));
  update();
}
