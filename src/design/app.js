// 디자인 화면 세 개(홈·매물 찾기·매물 상세)를 앱에 붙이고, 머리말·꼬리말 링크를 앱 기능에 연결한다
import { mountDesign } from "./dc-runtime.js";
import { HomeDesign } from "./home.js?v=20261120-7";
import { BrowseDesign, pushRecent } from "./browse.js?v=20261120-6";
import { DetailDesign } from "./detail.js?v=20261120-6";
import { shared } from "./data.js";
import { MENU_DEST } from "./menu.js?v=20261120-6";

const V = "20261120-7";

// 링크 글자 → 할 일. 화면 모양은 그대로 두고 눌렀을 때 동작만 붙인다.
function navAction(text, deps, screen) {
  switch (text) {
    case "매물 찾기": return () => deps.setView("browse");
    case "지도": return () => deps.setView("map");
    case "마이페이지": return () => deps.openMyPage();
    case "로그인": return () => deps.openLogin();
    case "농기계 등록하기":
    case "농기계 등록하기 →": return () => deps.openNewListing();
    case "개인정보처리방침": return () => deps.setView("guide");
    case "농기계 찾기 →": return screen === "home" ? () => deps.scrollHome("search") : null;
    case "농농이에게 물어보기": return () => deps.askAi("");
    default: return null;
  }
}

export function createDesignApp(deps) {
  const screens = {};

  function wireLinks(root, screen) {
    root.addEventListener("click", (event) => {
      const el = event.target.closest?.("a, button");
      if (!el || !root.contains(el)) return;
      const hasOwn = Boolean(el.__dcHandlers?.click);
      const href = el.getAttribute("href");
      // 로고: 머리말의 첫 링크
      if (el.tagName === "A" && href === "#" && el.closest("header") && !el.textContent.trim()) {
        event.preventDefault();
        deps.setView("home");
        return;
      }
      if (hasOwn) {
        if (href === "#") event.preventDefault();
        return;
      }
      const run = navAction(el.textContent.replace(/\s+/g, " ").trim(), deps, screen);
      if (run) {
        event.preventDefault();
        run();
        return;
      }
      if (href === "#") event.preventDefault();
      if (href && href.startsWith("#") && href.length > 1) {
        const target = root.getElementById(href.slice(1));
        if (target) {
          event.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  }

  async function mount(name, hostId, Component, extra = {}) {
    const host = document.getElementById(hostId);
    if (!host) return null;
    const mounted = await mountDesign(host, {
      url: `/src/design/${name}.html?v=${V}`,
      Component,
      props: { deps: { ...deps, navigate: (label) => deps.runDestination?.(MENU_DEST[label]), ...extra } },
    });
    wireLinks(mounted.root, name);
    screens[name] = mounted;
    return mounted;
  }

  const ready = Promise.all([
    mount("home", "homeDesignHost", HomeDesign),
    mount("browse", "browseDesignHost", BrowseDesign),
    mount("detail", "detailDesignHost", DetailDesign),
  ]).catch((error) => {
    console.error("[design] 화면을 붙이지 못했어요", error);
  });

  return {
    ready,
    shared,
    refresh() {
      for (const s of Object.values(screens)) s.instance.setState({});
    },
    showBrowse() {
      screens.browse?.instance.syncShared();
    },
    showDetail(id) {
      if (!id) return;
      pushRecent(id);
      screens.detail?.instance.show(id);
    },
    browseType(type) {
      shared.type = type || "all";
      shared.tab = shared.tab === "buy" ? "buy" : "all";
    },
    closePop() {
      for (const s of Object.values(screens)) if (s.instance.state.pop) s.instance.setState({ pop: null, hdrPop: false });
    },
    scrollHome(section) {
      const root = screens.home?.root;
      if (!root) return;
      let target = null;
      if (section === "faq") target = [...root.querySelectorAll("h2")].find((h) => h.textContent.includes("자주 묻는 질문"))?.closest("section");
      else target = root.getElementById(section);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  };
}
