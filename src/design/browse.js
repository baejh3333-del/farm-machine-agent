// 모아농 2.2 매물 찾기 · Desktop — 캔버스 디자인 로직을 실제 매물 데이터에 연결
import { DCLogic } from "./dc-runtime.js";
import { menuVals } from "./menu.js?v=20261121-1";
import {
  WD, K, P, won, bigWon, todayKey, todayYm, keyToIso, photoOf, nameOf, placeOf, areaKey, ratingOf,
  TYPE_GROUPS, groupOf, openListings, available, isFav, shared, locationChoices, typeLabel,
  machineFilterLabel, matchesMachineFilter, buildTypeChoices,
} from "./data.js?v=20261120-8";

let TODAY = todayKey();
let TODAY_YM = todayYm();
const EASY = ["cultivator", "tiller", "carrier", "sprayer", "ridger"];
const OPS = {
  field: ["till", "ridge", "ridgeBuild", "deepTill", "hill", "mulch"],
  harvest: ["potatoHarvest", "rootHarvest", "riceHarvest", "thresh", "forageBale"],
  spray: ["spray", "droneSpray", "orchardSpray"],
};
const hasOp = (it, key) => (it.operations || []).some((op) => OPS[key].includes(op));
const ICON_OF = (it) => {
  const g = groupOf(it.machineType);
  return g === "sprayer" ? "spray" : g === "harvester" || g === "combine" ? "harvest" : "machine";
};
// 실제 매물 → 캔버스 카드 모양
function toCard(it) {
  const r = ratingOf(it);
  return {
    id: it.id, type: groupOf(it.machineType) || it.machineType, name: nameOf(it),
    brand: it.brand || it.specification?.brand || "", rating: r ? r.avg : null, reviews: r ? r.count : 0,
    inspected: it.inspectedAt || "", place: placeOf(it), price: it.price, sale: it.type === "sale" ? it.price : null,
    img: photoOf(it), pos: "center", raw: it,
  };
}
const RECENT_KEY = "moa-recent-views-v1";
export function readRecent() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function pushRecent(id) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 12))); } catch { /* 저장 못 해도 괜찮아요 */ }
}


const MDW = k => { const [y, m, d] = P(k); return m + '/' + d + ' (' + WD[new Date(y, m - 1, d).getDay()] + ')'; };
const DAYS = (a, b) => { const [y1, m1, d1] = P(a), [y2, m2, d2] = P(b); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1; };

const ICON = {
  machine: 'M4 5h7v7H4zM11 9h5l3 5v2M7.5 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17.5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM10.5 17h5',
  spray: 'M9 3h4v4H9zM8 7h6v13H8zM14 10l4-2M14 12h5M14 14l4 2',
  harvest: 'M3 14h12l3-5h3v8H3zM6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 14V9h6v5',
  near: 'M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  all: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  today: 'M13 3L5 14h6l-1 7 8-11h-6z',
  week: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  month: 'M4 6h16v14H4zM4 10h16M8 14h3M13 14h3M8 17h3',
  buy: 'M4 7h16l-1.5 11h-13zM9 7V5a3 3 0 0 1 6 0v2',
  service: 'M7 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 15c0-3.2 1.8-5.5 4-5.5 1.6 0 2.8 1 3.4 2.5M12 11h5l3 4v3h-8zM14.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 21h6'
};
const TIMES = [6, 8, 9, 10, 13, 18];
const sel = on => on ? { bg: '#111111', color: '#FFFFFF', border: '#111111' } : { bg: '#FFFFFF', color: '#111111', border: '#E2E2E2' };

export class BrowseDesign extends DCLogic {
  constructor(props) {
    super(props);
    TODAY = todayKey(); TODAY_YM = todayYm();
    this.deps = props.deps || {};
    this.state = { pop: null, loc: shared.loc, start: shared.start, end: shared.end, time: null, type: shared.type || 'all', typeQuery: shared.typeQuery || '', tab: shared.tab || null, mini: false, ym: TODAY_YM };
    this.rails = {};
  }

  pickDay(k) {
    const s = this.state;
    if (!s.start || s.end || k < s.start) this.setState({ start: k, end: null });
    else this.setState({ end: k });
  }

  month(ym) {
    const s = this.state;
    const y = Math.floor(ym / 12), m = ym % 12;
    const first = new Date(y, m, 1).getDay();
    const n = new Date(y, m + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < first; i++) days.push({ label: '', pick: () => {}, style: 'height: 40px; border: none; background: transparent' });
    for (let d = 1; d <= n; d++) {
      const k = K(y, m, d);
      const past = k < TODAY;
      const on = k === s.start || k === s.end;
      const inR = s.start && s.end && k > s.start && k < s.end;
      let look = 'color: #111111; background: transparent; border-radius: 999px; cursor: pointer';
      if (past) look = 'color: #C8C8C8; background: transparent; border-radius: 999px; cursor: default';
      else if (on) look = 'color: #FFFFFF; background: #1E9B4B; border-radius: 999px; font-weight: 700; cursor: pointer';
      else if (inR) look = 'color: #111111; background: #EDF6F0; border-radius: 0; cursor: pointer';
      days.push({ label: String(d), pick: past ? () => {} : () => this.pickDay(k), style: 'height: 40px; border: none; font-family: inherit; font-size: 15px; ' + look });
    }
    return { title: y + '년 ' + (m + 1) + '월', days };
  }

  setState(patch) {
    super.setState(patch);
    const s = this.state;
    Object.assign(shared, { loc: s.loc, start: s.start, end: s.end, type: s.type, typeQuery: s.typeQuery, tab: s.tab });
  }

  syncShared() {
    TODAY = todayKey(); TODAY_YM = todayYm();
    this.setState({ loc: shared.loc, start: shared.start, end: shared.end, type: shared.type || 'all', typeQuery: shared.typeQuery || '', tab: shared.tab || this.state.tab, pop: null });
  }

  openFromTop(w) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => this.setState({ pop: w }), w ? 420 : 0);
  }

  scroll(key, dir) {
    const el = this.rails[key];
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' });
  }

  menuAct(label) { this.deps.navigate?.(label); }

  renderVals() {
    const s = this.state;
    const toggle = w => () => this.setState({ pop: s.pop === w ? null : w });
    const fieldBg = on => on ? '#F2F2F2' : 'transparent';
    const days = (s.tab === 'month') ? 30 : (s.tab === 'today') ? 1 : (s.start && s.end ? DAYS(s.start, s.end) : 3);
    const tm = s.time != null ? ' ' + String(s.time).padStart(2, '0') + ':00' : '';
    const typeOk = mc => matchesMachineFilter(mc.raw, s.type, s.typeQuery);
    const tab = s.tab || 'all';
    const startIso = tab === 'today' ? keyToIso(TODAY) : keyToIso(s.start);
    const endIso = tab === 'today' ? keyToIso(TODAY) : keyToIso(s.end || s.start);
    const locOk = it => !s.loc || s.loc === '현재 위치' || areaKey(it, s.loc.split(' ').length) === s.loc;
    const rentAll = openListings('rent').filter(it => locOk(it) && (!startIso || available(it, startIso, endIso || startIso)));
    const saleAll = openListings('sale').filter(locOk);
    const M = rentAll.map(toCard).sort((a, b) => a.price - b.price);
    const SALE = saleAll.map(toCard).sort((a, b) => a.price - b.price);
    // 같은 모델이 줄줄이 나오지 않게 모델마다 하나씩 먼저 보여 준다
    const take = list => {
      const seen = new Set(), first = [], rest = [];
      for (const m of list) { const key = m.raw.model || m.name; (seen.has(key) ? rest : first).push(m); seen.add(key); }
      return [...first, ...rest].slice(0, 12);
    };
    const favList = this.deps.favorites ? this.deps.favorites() : [];

    const card = mc => {
      const fav = favList.includes(mc.id);
      const sale = mc.sale != null;
      return {
        name: mc.name, year: mc.brand, rating: mc.rating != null ? mc.rating.toFixed(1) : '새 매물', reviews: mc.rating != null ? '후기 ' + mc.reviews : '점검 ' + (mc.inspected ? mc.inspected.slice(5).replace('-', '/') : '전'), place: mc.place,
        img: mc.img, hasImg: !!mc.img, noImg: !mc.img, icon: ICON[ICON_OF(mc.raw)], pos: mc.pos || 'center',
        open: () => this.deps.openDetail?.(mc.id),
        price: sale ? bigWon(mc.sale) : '1일 ' + won(mc.price), total: sale ? '판매가' : '총 ' + won(mc.price * days),
        favFill: fav ? '#1E9B4B' : 'rgba(17,17,17,0.25)', favStroke: fav ? '#1E9B4B' : '#FFFFFF', favSel: fav ? 'true' : 'false',
        fav: e => { e?.stopPropagation?.(); e?.preventDefault?.(); Promise.resolve(this.deps.toggleFavorite?.(mc.id)).finally(() => this.setState({})); }
      };
    };
    const rail = (key, title, sub, list) => ({
      title, sub, items: list.filter(typeOk).map(card),
      ref: el => { if (el) this.rails[key] = el; },
      prev: () => this.scroll(key, -1), next: () => this.scroll(key, 1)
    });
    const avg = days + '일 대여 기준 가격이에요';
    const where = s.loc && s.loc !== '현재 위치' ? s.loc.split(' ').pop() : '우리 동네';
    const RENT_ROWS = [
      rail('cheap', where + '에서 저렴한 농기계', avg, take(M)),
      rail('field', '밭 갈기 딱 좋은 트랙터·관리기', '지금 가장 많이 찾는 작업이에요', take(M.filter(m => hasOp(m.raw, 'field')))),
      rail('harvest', '감자·고구마 캐는 수확기', '수확철엔 일찍 예약해 주세요', take(M.filter(m => hasOp(m.raw, 'harvest')))),
      rail('spray', '방제 시즌, 약 뿌리는 기계', '혼자 쓰기 쉬운 것부터 보여드려요', take(M.filter(m => hasOp(m.raw, 'spray')))),
      rail('easy', '처음이라면, 다루기 쉬운 기계', '혼자서도 다루기 쉬운 작은 기계예요', take(M.filter(m => EASY.includes(m.raw.machineType))))
    ];
    const SALE_ROWS = [
      rail('sale', '중고로 사기 좋은 매물', '소유주가 직접 점검한 매물이에요', take(SALE)),
      rail('saleField', '중고 트랙터·관리기', '밭 갈기 기계를 사서 오래 쓰고 싶다면', take(SALE.filter(m => hasOp(m.raw, 'field')))),
      rail('saleHarvest', '중고 수확기·콤바인', '수확철 전에 미리 살펴보세요', take(SALE.filter(m => hasOp(m.raw, 'harvest'))))
    ];
    const SERVICE_ROWS = [
      rail('service', '기계와 함께 작업까지 해 드려요', '소유주가 직접 와서 농작업을 대신해 줘요', take(M.filter(m => m.raw.rentalOperator)))
    ];
    const rows = (tab === 'buy' ? SALE_ROWS : tab === 'service' ? SERVICE_ROWS : tab === 'all' ? [...RENT_ROWS, SALE_ROWS[0]] : RENT_ROWS).filter(r => r.items.length);

    let rangeHint = '빌리는 날을 눌러 주세요';
    if (s.start && !s.end) rangeHint = '돌려주는 날을 눌러 주세요';
    if (s.start && s.end) rangeHint = days + '일 동안 빌려요';
    const pickedLabel = machineFilterLabel(s.type, s.typeQuery);

    return {
      ...menuVals(this, 'find', label => this.menuAct(label)),
      anyOpen: !!s.pop, closePop: () => this.setState({ pop: null }),
      openLoc: toggle('loc'), openStart: toggle('date'), openEnd: toggle('date'), openType: toggle('type'),
      locOpen: s.pop === 'loc', dateOpen: s.pop === 'date', startOpen: s.pop === 'date', endOpen: s.pop === 'date', typeOpen: s.pop === 'type',
      locBg: fieldBg(s.pop === 'loc'), startBg: fieldBg(s.pop === 'date'), endBg: fieldBg(s.pop === 'date'), typeBg: fieldBg(s.pop === 'type'),
      locText: s.loc ? s.loc : '동네, 주소', locColor: s.loc ? '#111111' : '#9A9A9A',
      startText: s.start ? MDW(s.start) + tm : '날짜 · 시간', startColor: s.start ? '#111111' : '#9A9A9A',
      endText: s.end ? MDW(s.end) + tm : '날짜 · 시간', endColor: s.end ? '#111111' : '#9A9A9A',
      typeText: pickedLabel || '전체 기계', typeColor: pickedLabel ? '#111111' : '#9A9A9A',
      typeQuery: s.typeQuery || '',
      onTypeInput: e => this.setState({ typeQuery: e.target.value, type: 'all' }),
      resetType: () => this.setState({ type: 'all', typeQuery: '' }),
      applyType: () => this.setState({ pop: null }),
      locs: [{ name: '현재 위치', sub: '전체 지역에서 보여드려요', value: '현재 위치', nav: true }, ...locationChoices(4).map(c => ({ name: c.key, sub: '매물 ' + c.n + '대', value: c.key }))].map(l => ({ name: l.name, sub: l.sub, color: l.nav ? '#1E9B4B' : '#111111', bg: s.loc === l.value ? '#F4F4F4' : 'transparent', pick: () => this.setState({ loc: l.value, pop: 'date' }) })),
      m1: this.month(s.ym), m2: this.month(s.ym + 1), rangeHint,
      prevMonth: () => this.setState({ ym: Math.max(TODAY_YM, s.ym - 1) }), nextMonth: () => this.setState({ ym: s.ym + 1 }),
      prevColor: s.ym <= TODAY_YM ? '#C8C8C8' : '#111111',
      times: TIMES.map(h => ({ label: String(h).padStart(2, '0') + ':00', ...sel(s.time === h), pick: () => this.setState({ time: h }) })),
      resetDate: () => this.setState({ start: null, end: null, time: null }), applyDate: () => this.setState({ pop: 'type' }),
      types: buildTypeChoices(s.type, s.typeQuery, id => this.setState({ type: id, typeQuery: '', pop: null })),
      tabs: [['all', '전체 보기', ICON.all], ['today', '당일 대여', ICON.today], ['month', '한 달 대여', ICON.month], ['buy', '중고 구매', ICON.buy], ['service', '농작업 대행', ICON.service]].map(([id, label, icon]) => {
        const on = (s.tab || 'all') === id;
        return { label, icon, sel: on ? 'true' : 'false', bg: on ? '#111111' : '#F6F6F6', color: on ? '#FFFFFF' : '#111111', pick: () => this.setState({ tab: id }) };
      }),
      recent: (() => {
        const seen = readRecent().map(id => this.deps.listingById?.(id)).filter(Boolean).map(toCard);
        return [...seen, ...M.filter(m => !seen.some(x => x.id === m.id))].slice(0, 6);
      })().map(mc => ({
        name: mc.name, meta: (mc.brand ? mc.brand + ' · ' : '') + (mc.sale != null ? bigWon(mc.sale) : '1일 ' + won(mc.price)),
        img: mc.img, hasImg: !!mc.img, noImg: !mc.img, icon: ICON[ICON_OF(mc.raw)],
        open: e => { e?.preventDefault?.(); this.deps.openDetail?.(mc.id); }
      })),
      keepTitle: (pickedLabel || '농기계') + '를 계속 찾아보세요',
      keepSub: (s.loc && s.loc !== '현재 위치' ? s.loc : '전체 지역') + ' · ' + (M.length + SALE.length) + '대 있어요',
      rows,
      searchRef: el => {
        if (!el || this._io || typeof IntersectionObserver === 'undefined') return;
        this._io = new IntersectionObserver(([e]) => { const m = !e.isIntersecting && e.boundingClientRect.top < 0; if (m !== !!this.state.mini) this.setState({ mini: m }); }, { threshold: 0, rootMargin: '-70px 0px 0px 0px' });
        this._io.observe(el);
      },
      miniH: s.mini ? '80px' : '0px', miniOp: s.mini ? 1 : 0, miniHidden: s.mini ? 'false' : 'true',
      toTop: () => this.openFromTop(null),
      miniSegs: [
        { icon: ICON.near, text: s.loc ? s.loc : '동네, 주소', on: !!s.loc, w: 'loc', flex: '1.3 1 0' },
        { icon: ICON.week, text: s.start ? MDW(s.start) + (s.end ? ' – ' + MDW(s.end) : '') + tm : '빌리는 날 – 돌려주는 날', on: !!s.start, w: 'date', flex: '1.6 1 0' },
        { icon: ICON.machine, text: pickedLabel || '전체 기계', on: !!pickedLabel, w: 'type', flex: '1 1 0' }
      ].map((g, i) => ({ ...g, color: g.on ? '#111111' : '#9A9A9A', line: i ? '1px solid #EEEEEE' : 'none', pick: () => this.openFromTop(g.w) }))
    };
  }
}
