// 모아농 디자인 화면 런타임
// Claude 디자인 캔버스(.dc.html)의 템플릿 문법을 그대로 실행한다.
//   {{ 이름 }}            값 넣기 (글자·속성)
//   <sc-if value="{{ }}"> 조건이 참일 때만 그리기
//   <sc-for list="{{ }}" as="x"> 목록 반복
//   onClick="{{ 함수 }}"  이벤트 연결,  ref="{{ 함수 }}"  그려진 요소 받기
// 화면은 Shadow DOM 안에 그려서 기존 앱 CSS와 서로 섞이지 않게 한다.
// 다시 그릴 때는 바뀐 부분만 고쳐서(스크롤·입력 포커스 유지) 부드럽게 움직이게 한다.

export class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this.$root = null;
  }
  setState(patch) {
    Object.assign(this.state, typeof patch === "function" ? patch(this.state) : patch);
    this.__schedule?.();
  }
}

const HOLE = /\{\{([^}]+)\}\}/g;
const WHOLE = /^\s*\{\{([^}]+)\}\}\s*$/;
const EVENT_MAP = { change: "input", doubleclick: "dblclick" };

function lookup(scope, expr) {
  expr = expr.trim();
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
  const parts = expr.split(".");
  for (let i = scope.length - 1; i >= 0; i--) {
    const frame = scope[i];
    if (frame && Object.prototype.hasOwnProperty.call(frame, parts[0])) {
      let value = frame[parts[0]];
      for (const key of parts.slice(1)) value = value == null ? value : value[key];
      return value;
    }
  }
  return undefined;
}

const fill = (scope, text) => text.replace(HOLE, (_, expr) => {
  const value = lookup(scope, expr);
  return value == null ? "" : String(value);
});

function dispatcher(event) {
  const fn = event.currentTarget.__dcHandlers?.[event.type];
  if (typeof fn === "function") fn(event);
}

function setHandler(el, type, fn) {
  el.__dcHandlers = el.__dcHandlers || {};
  el.__dcBound = el.__dcBound || new Set();
  el.__dcHandlers[type] = fn;
  if (!el.__dcBound.has(type)) {
    el.addEventListener(type, dispatcher);
    el.__dcBound.add(type);
  }
}

function build(node, scope, out, refs) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(document.createTextNode(fill(scope, child.nodeValue)));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.localName;
    if (tag === "sc-if") {
      const m = (child.getAttribute("value") || "").match(WHOLE);
      if (m && lookup(scope, m[1])) build(child, scope, out, refs);
      continue;
    }
    if (tag === "sc-for") {
      const m = (child.getAttribute("list") || "").match(WHOLE);
      const as = child.getAttribute("as") || "item";
      const list = (m && lookup(scope, m[1])) || [];
      for (const item of list) build(child, scope.concat([{ [as]: item }]), out, refs);
      continue;
    }
    const el = document.createElementNS(child.namespaceURI, tag);
    el.__dcEvents = {};
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name;
      const whole = attr.value.match(WHOLE);
      if (/^on[a-z]+$/.test(name)) {
        const fn = whole ? lookup(scope, whole[1]) : null;
        let type = name.slice(2);
        type = EVENT_MAP[type] || type;
        if (typeof fn === "function") el.__dcEvents[type] = fn;
        continue;
      }
      if (name === "ref") {
        const fn = whole ? lookup(scope, whole[1]) : null;
        if (typeof fn === "function") refs.push([fn, el]);
        continue;
      }
      if (name.startsWith("hint-")) continue;
      try { el.setAttribute(name, fill(scope, attr.value)); } catch { /* 잘못된 속성 이름은 건너뜀 */ }
    }
    for (const [type, fn] of Object.entries(el.__dcEvents)) setHandler(el, type, fn);
    build(child.content || child, scope, el, refs);
    out.appendChild(el);
  }
}

function syncAttributes(from, to) {
  for (const attr of Array.from(to.attributes)) {
    if (!from.hasAttribute(attr.name)) to.removeAttribute(attr.name);
  }
  for (const attr of Array.from(from.attributes)) {
    if (to.getAttribute(attr.name) !== attr.value) to.setAttribute(attr.name, attr.value);
  }
  if ((to.localName === "input" || to.localName === "textarea") && from.hasAttribute("value")) {
    const value = from.getAttribute("value");
    if (to.getRootNode()?.activeElement !== to && to.value !== value) to.value = value;
  }
}

function morph(oldParent, newParent, map) {
  const olds = Array.from(oldParent.childNodes);
  const news = Array.from(newParent.childNodes);
  news.forEach((next, i) => {
    const prev = olds[i];
    if (!prev) { oldParent.appendChild(next); return; }
    const sameKind = prev.nodeType === next.nodeType
      && (prev.nodeType !== Node.ELEMENT_NODE || (prev.localName === next.localName && prev.namespaceURI === next.namespaceURI));
    if (!sameKind) { oldParent.replaceChild(next, prev); return; }
    if (prev.nodeType === Node.TEXT_NODE) {
      if (prev.nodeValue !== next.nodeValue) prev.nodeValue = next.nodeValue;
      return;
    }
    syncAttributes(next, prev);
    const keep = new Set(Object.keys(next.__dcEvents || {}));
    for (const [type, fn] of Object.entries(next.__dcEvents || {})) setHandler(prev, type, fn);
    if (prev.__dcHandlers) for (const type of Object.keys(prev.__dcHandlers)) if (!keep.has(type)) prev.__dcHandlers[type] = null;
    map.set(next, prev);
    morph(prev, next, map);
  });
  for (let i = news.length; i < olds.length; i++) olds[i].remove();
}

const templateCache = new Map();

async function loadTemplate(url) {
  if (templateCache.has(url)) return templateCache.get(url);
  const promise = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`화면 파일을 불러오지 못했어요 (${res.status})`);
    return res.text();
  }).then((text) => {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const root = doc.querySelector("x-dc") || doc.body;
    const helmet = root.querySelector("helmet");
    let css = "";
    if (helmet) {
      css = Array.from(helmet.querySelectorAll("style")).map((s) => s.textContent).join("\n");
      helmet.remove();
    }
    // 캔버스의 body·html 규칙은 Shadow DOM에서는 :host 에 걸어야 한다
    css = css.replace(/(^|[\s,}])(?:html|body)(?=[\s,{:.\[>])/g, "$1:host");
    const tpl = document.createElement("template");
    tpl.innerHTML = root.innerHTML;
    return { css, tpl };
  });
  templateCache.set(url, promise);
  return promise;
}

export async function mountDesign(host, { url, Component, props = {} }) {
  const { css, tpl } = await loadTemplate(url);
  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  shadow.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = `:host{display:block}\n${css}`;
  const container = document.createElement("div");
  container.setAttribute("data-dc-root", "");
  shadow.append(style, container);

  const inst = new Component(props);
  inst.$root = shadow;
  let queued = false;
  const render = () => {
    queued = false;
    const refs = [];
    const fresh = document.createElement("div");
    build(tpl.content, [inst.renderVals()], fresh, refs);
    const map = new Map();
    morph(container, fresh, map);
    for (const [fn, el] of refs) {
      try { fn(map.get(el) || el); } catch (error) { console.warn("[design] ref", error); }
    }
  };
  inst.__schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(render);
  };
  render();
  inst.mounted?.();
  return { instance: inst, render, root: shadow };
}
