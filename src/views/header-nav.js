import { $ } from "../core/utils.js";

const CLOSE_DELAY_MS = 140;

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
    let activeTrigger;
    let touch = false;
    let restoringFocus = false;
    let timer;
    function show(trigger) {
      clearTimeout(timer);
      panel.hidden = false;
      activeTrigger = trigger;
      triggers.forEach(button => button.setAttribute("aria-expanded", "true"));
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
        panel.querySelector('[data-column="' + trigger.dataset.view + '"] button').focus();
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
