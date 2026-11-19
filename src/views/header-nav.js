import { $ } from "../core/utils.js";

const CLOSE_DELAY_MS = 140;

export function createHeaderNav(deps) {
  let openGroup = null;
  let closeTimer = 0;
  let lastPointerType = "mouse";
  let suppressFocusOpenTarget = null;

  function getGroups() {
    return [...document.querySelectorAll(".sidebar-nav .nav-group")];
  }

  function clearCloseTimer() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = 0;
    }
  }

  function closeGroup(group) {
    if (!group) return;
    const trigger = group.querySelector(":scope > .nav-item");
    const menu = group.querySelector(":scope > .nav-submenu");
    group.classList.remove("is-open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
    if (openGroup === group) openGroup = null;
  }

  function closeAll() {
    clearCloseTimer();
    for (const group of getGroups()) {
      closeGroup(group);
    }
    openGroup = null;
  }

  function openNavGroup(group) {
    if (!group) return;
    clearCloseTimer();
    if (openGroup && openGroup !== group) {
      closeGroup(openGroup);
    }
    const trigger = group.querySelector(":scope > .nav-item");
    const menu = group.querySelector(":scope > .nav-submenu");
    if (!menu) return;
    group.classList.add("is-open");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    openGroup = group;
  }

  function scheduleClose(group) {
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      closeTimer = 0;
      if (openGroup === group) closeGroup(group);
    }, CLOSE_DELAY_MS);
  }

  function scrollHomeSection(sectionId) {
    deps.setView("home");
    requestAnimationFrame(() => {
      $(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function runDestination(dest) {
    closeAll();
    switch (dest) {
      case "home-booking":
        return scrollHomeSection("homeBooking");
      case "home-about":
        return scrollHomeSection("homeAbout");
      case "home-faq":
        return scrollHomeSection("homeFaq");
      case "browse-rent":
        deps.setTransaction("rent");
        deps.setView("browse");
        return;
      case "browse-sale":
        deps.setTransaction("sale");
        deps.setView("browse");
        return;
      case "browse-filters":
        deps.setView("browse");
        deps.openFilters();
        return;
      case "favorites":
        deps.setView("favorites");
        return;
      case "map":
        deps.setView("map");
        return;
      case "browse-map":
        deps.setView("browse");
        $("viewModeMap")?.click();
        return;
      case "region-picker":
        $("regionPickerBtn")?.click();
        return;
      case "guide":
        deps.setView("guide");
        return;
      case "garage":
        deps.setView("garage");
        return;
      case "ai-open":
        deps.openAiPanel();
        return;
      case "ai-recommend":
        deps.submitAiPrompt("밭에 두둑을 만들려면 어떤 농기계가 좋을까요?");
        return;
      case "ai-nearby":
        deps.submitAiPrompt("우리 동네에서 관리기를 빌릴 수 있을까요?");
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
    if (!nav) return;

    nav.addEventListener("pointerdown", (event) => {
      lastPointerType = event.pointerType || "mouse";
    }, true);

    for (const group of getGroups()) {
      const trigger = group.querySelector(":scope > .nav-item");
      const menu = group.querySelector(":scope > .nav-submenu");
      if (!trigger || !menu) continue;

      group.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        openNavGroup(group);
      });

      group.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "touch") return;
        scheduleClose(group);
      });

      group.addEventListener("focusin", (event) => {
        if (event.target === suppressFocusOpenTarget) {
          suppressFocusOpenTarget = null;
          return;
        }
        if (event.target === trigger && !trigger.matches(":focus-visible")) return;
        openNavGroup(group);
      });

      group.addEventListener("focusout", (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && group.contains(next)) return;
        closeGroup(group);
      });

      // Capture phase so first touch tap opens submenu before primary click handler runs
      trigger.addEventListener("click", (event) => {
        if (lastPointerType === "touch") {
          lastPointerType = "mouse";
          if (!group.classList.contains("is-open")) {
            event.preventDefault();
            event.stopImmediatePropagation();
            openNavGroup(group);
            return;
          }
        }
        closeAll();
      }, true);

      trigger.addEventListener("keydown", (event) => {
        const items = [...menu.querySelectorAll(".nav-submenu-item")];
        if (!items.length) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          openNavGroup(group);
          items[0].focus();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          openNavGroup(group);
          items[items.length - 1].focus();
        } else if (event.key === "Escape" && group.classList.contains("is-open")) {
          event.preventDefault();
          event.stopPropagation();
          closeGroup(group);
        }
      });

      menu.addEventListener("keydown", (event) => {
        const items = [...menu.querySelectorAll(".nav-submenu-item")];
        if (!items.length) return;
        const idx = items.indexOf(document.activeElement);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          items[(idx + 1 + items.length) % items.length].focus();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          items[(idx - 1 + items.length) % items.length].focus();
        } else if (event.key === "Home") {
          event.preventDefault();
          items[0].focus();
        } else if (event.key === "End") {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeGroup(group);
          suppressFocusOpenTarget = trigger;
          trigger.focus();
        }
      });

      menu.addEventListener("click", (event) => {
        const item = event.target.closest(".nav-submenu-item[data-nav-dest]");
        if (!item) return;
        runDestination(item.dataset.navDest);
      });
    }

    document.addEventListener("pointerdown", (event) => {
      if (!openGroup) return;
      const target = event.target;
      if (target instanceof Node && openGroup.contains(target)) return;
      closeAll();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && openGroup) {
        const trigger = openGroup.querySelector(":scope > .nav-item");
        const hadFocusInside = openGroup.contains(document.activeElement);
        closeAll();
        if (hadFocusInside && trigger) {
          suppressFocusOpenTarget = trigger;
          trigger.focus();
        }
      }
    });
  }

  return {
    bind,
    closeAll,
  };
}
