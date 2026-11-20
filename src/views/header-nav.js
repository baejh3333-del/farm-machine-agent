import { $ } from "../core/utils.js";

// 홈 디자인 머리말(src/design/menu.js leaveMenu)과 같은 닫힘 지연
const CLOSE_DELAY_MS = 180;

export function createHeaderNav(deps) {
  let closePanel = () => {};
  function closeAll() { closePanel(); }

  // 홈은 모아농 2.1 디자인 화면이라 그 안의 구역으로 이동한다
  const HOME_SECTION = { homeBooking: "search", homeAbout: "about", homeFaq: "faq" };
  function scrollHomeSection(sectionId) {
    deps.setView("home");
    requestAnimationFrame(() => {
      if (deps.scrollHome) deps.scrollHome(HOME_SECTION[sectionId] || sectionId);
      else $(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function runDestination(dest) {
    closeAll();
    switch (dest) {
      case "browse":
        deps.setView("browse");
        return;
      case "home-booking":
        return scrollHomeSection("homeBooking");
      case "home-about":
        return scrollHomeSection("homeAbout");
      case "home-faq":
        return scrollHomeSection("homeFaq");
      case "favorites":
        deps.setView("favorites");
        return;
      case "map":
        deps.setView("map");
        return;
      case "guide":
        deps.setView("guide");
        return;
      case "garage":
        deps.setView("garage");
        return;
      case "deals":
        deps.setView("deals");
        return;
      case "requests":
        deps.setView("requests");
        return;
      case "owner":
        deps.setView("owner");
        return;
      default:
        return;
    }
  }

  function bind() {
    const nav = document.querySelector(".sidebar-nav");
    const panel = $("headerFeatures");
    if (!nav || !panel) return;
    const triggers = [...nav.querySelectorAll(".nav-item")];
    const header = nav.closest("header");
    let activeTrigger;
    let touch = false;
    let restoringFocus = false;
    let timer;
    function show(trigger) {
      clearTimeout(timer);
      panel.hidden = false;
      activeTrigger = trigger;
      // 올린 메뉴의 세부 항목만 그 메뉴 바로 아래에 보여 준다(모아농 2.3 디자인)
      panel.dataset.column = trigger.dataset.view || "";
      const r = trigger.getBoundingClientRect();
      panel.style.setProperty("--nav-col-left", Math.max(16, Math.round(r.left) - 24) + "px");
      // 세부 메뉴는 머리말 바로 아래에서 펼친다(홈 menu.js openMenu와 같은 계산)
      if (header) panel.style.setProperty("--nav-top", Math.round(header.getBoundingClientRect().bottom) + "px");
      triggers.forEach(button => button.setAttribute("aria-expanded", button === trigger ? "true" : "false"));
    }
    closePanel = () => {
      clearTimeout(timer);
      panel.hidden = true;
      triggers.forEach(button => button.setAttribute("aria-expanded", "false"));
    };
    nav.addEventListener("pointerenter", () => clearTimeout(timer));
    nav.addEventListener("pointerleave", event => {
      if (event.pointerType !== "touch") timer = setTimeout(closeAll, CLOSE_DELAY_MS);
    });
    nav.addEventListener("focusout", event => {
      if (!nav.contains(event.relatedTarget)) closeAll();
    });
    for (const trigger of triggers) {
      trigger.addEventListener("pointerenter", event => {
        if (event.pointerType !== "touch") show(trigger);
      });
      trigger.addEventListener("pointerdown", event => { touch = event.pointerType === "touch"; });
      trigger.addEventListener("focus", () => {
        if (!touch && !restoringFocus && trigger.matches(":focus-visible")) show(trigger);
      });
      trigger.addEventListener("click", event => {
        if (touch && (panel.hidden || activeTrigger !== trigger)) {
          event.stopImmediatePropagation();
          event.preventDefault();
          show(trigger);
        } else closeAll();
        touch = false;
      }, true);
      trigger.addEventListener("keydown", event => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        show(trigger);
        // 판(panel) 자체에도 data-column이 붙으므로 칸(.nav-column)으로 좁혀야 숨은 다른 칸의 버튼을 잡지 않는다
        panel.querySelector('.nav-column[data-column="' + trigger.dataset.view + '"] button')?.focus();
      });
    }
    panel.addEventListener("click", event => {
      const item = event.target.closest("[data-nav-dest]");
      if (item) runDestination(item.dataset.navDest);
    });
    panel.addEventListener("keydown", event => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const column = event.target.closest(".nav-column");
      if (!column) return;
      const items = [...column.querySelectorAll("button")];
      const step = event.key === "ArrowDown" ? 1 : -1;
      event.preventDefault();
      items[(items.indexOf(event.target) + step + items.length) % items.length].focus();
    });
    // 내려 읽으면 머리말 바탕을 홈의 스크롤 머리말처럼 반투명으로 바꾸고, 열린 세부 메뉴는 닫는다
    let scrolled = false;
    window.addEventListener("scroll", () => {
      const next = window.scrollY > 0;
      if (next !== scrolled) {
        scrolled = next;
        header?.classList.toggle("is-scrolled", next);
      }
      if (!panel.hidden) closeAll();
    }, { passive: true });
    document.addEventListener("pointerdown", event => {
      if (!nav.contains(event.target)) closeAll();
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || panel.hidden) return;
      closeAll();
      if (nav.contains(document.activeElement)) {
        restoringFocus = true;
        activeTrigger?.focus();
        restoringFocus = false;
      }
    });
  }

  return { bind, closeAll, runDestination };
}
