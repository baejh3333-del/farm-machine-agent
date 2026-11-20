// 모아농 2.1 홈 · Desktop — 캔버스 디자인 로직을 실제 매물 데이터에 연결
import { DCLogic } from "./dc-runtime.js";
import { menuVals } from "./menu.js?v=20261121-1";
import {
  WD, K, P, won, bigWon, todayKey, todayYm, keyToIso, photoOf, nameOf, placeOf, areaKey,
  openListings, available, shared, locationChoices,
  machineFilterLabel, matchesMachineFilter, buildTypeChoices, pickCurrentLocationGps,
} from "./data.js?v=20261120-9";

let TODAY = todayKey();
let TODAY_YM = todayYm();
const LOCS = (gpsPending) => [
  { name: '현재 위치', sub: gpsPending ? '현재 위치를 확인하고 있어요...' : 'GPS로 내 위치 찾기', value: '현재 위치', type: 'nav' },
  ...locationChoices(5).map((c, i) => ({ name: c.key, sub: i ? '' : '매물이 가장 많은 곳', value: c.key, type: i ? 'pin' : 'recent' }))
];


const FAQ = [
  { cat: 'rent', tag: '대여', q: '농기계는 어떻게 빌리나요?', a: '위치·날짜·기종을 고르고 대여 요청을 보내면 돼요. 소유주가 승인하면 예약이 확정돼요.' },
  { cat: 'reg', tag: '기계 등록', q: '쉬는 농기계는 어떻게 올리나요?', a: '‘농기계 등록하기’를 누르고 사진과 대여료를 적으면 돼요. 농농이에게 말로 부탁해도 올려 드려요.' },
  { cat: 'pay', tag: '결제', q: '대여료는 언제 내나요?', a: '소유주가 승인한 뒤에 결제해요. 승인 전에는 돈이 나가지 않아요.' },
  { cat: 'pay', tag: '반납', q: '반납이 늦어지거나 기계가 고장 나면요?', a: '바로 소유주에게 알려 주세요. 반납일 변경이나 수리 상담은 농농이가 도와드려요.' }
];
const MD = k => { const [, m, d] = P(k); return m + '월 ' + d + '일'; };
const SL = k => { const [, m, d] = P(k); return m + '/' + d; };
const FULL = k => { const [y, m, d] = P(k); return m + '월 ' + d + '일 (' + WD[new Date(y, m - 1, d).getDay()] + ')'; };
const DAYS = (a, b) => { const [y1, m1, d1] = P(a), [y2, m2, d2] = P(b); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1; };
export class HomeDesign extends DCLogic {
  constructor(props) {
    super(props);
    this.deps = props.deps || {};
    this._pick = null;
    this.state = { open: 0, pop: null, searched: false, loc: '현재 위치', radius: 10, start: null, end: null, type: 'all', typeQuery: '', typeSet: false, ym: TODAY_YM, pickH: 9, pickM: 0, retH: 18, retM: 0, pickDraft: null, retDraft: null, tab: 'rent', locError: '', gpsPending: false };
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
    for (let i = 0; i < first; i++) days.push({ label: '', pick: () => {}, style: 'height: 56px; border: none; background: transparent' });
    for (let d = 1; d <= n; d++) {
      const k = K(y, m, d);
      const past = k < TODAY;
      const sel = k === s.start || k === s.end;
      const inR = s.start && s.end && k > s.start && k < s.end;
      let look = 'color: #111111; background: transparent; border-radius: 999px; cursor: pointer';
      if (past) look = 'color: #C8C8C8; background: transparent; border-radius: 999px; cursor: default';
      else if (sel) look = 'color: #FFFFFF; background: #1E9B4B; border-radius: 999px; font-weight: 700; cursor: pointer';
      else if (inR) look = 'color: #111111; background: #EDF6F0; border-radius: 0; cursor: pointer';
      days.push({ label: String(d), pick: past ? () => {} : () => this.pickDay(k), style: 'height: 56px; border: none; font-family: inherit; font-size: 18px; ' + look });
    }
    return { title: y + '년 ' + (m + 1) + '월', days };
  }

  syncCol(el, i) {
    if (!el) return;
    if (el.dataset.v !== String(i)) { el.dataset.v = String(i); el.scrollTop = i * 44; }
  }

  wheel(e, key, n, dk, step = 1) {
    const el = e.currentTarget;
    const i = Math.max(0, Math.min(n - 1, Math.round(el.scrollTop / 44)));
    if (el.dataset.v !== String(i)) { el.dataset.v = String(i); this.setState({ [key]: i * step, [dk]: null }); }
  }

  matches() {
    const s = this.state;
    const startIso = s.tab === 'rent' && s.start ? keyToIso(s.start) : '';
    const endIso = s.tab === 'rent' && s.end ? keyToIso(s.end) : startIso;
    return openListings(s.tab === 'rent' ? 'rent' : 'sale').filter(it =>
      (!s.locSet || s.loc === '현재 위치' || areaKey(it, s.loc.split(' ').length) === s.loc) &&
      (!startIso || available(it, startIso, endIso || startIso)) &&
      matchesMachineFilter(it, s.type, s.typeQuery));
  }

  syncShared() {
    const s = this.state;
    const isRent = s.tab === 'rent';
    const hasTime = isRent && (s.timeSet || s.pickH !== 9 || s.pickM !== 0 || s.retH !== 18 || s.retM !== 0 || s.searched || !!s.start);
    Object.assign(shared, {
      loc: s.locSet && s.loc !== '현재 위치' ? s.loc : null,
      radius: s.radius || 10,
      start: isRent ? s.start : null,
      end: isRent ? (s.end || s.start) : null,
      pickH: hasTime ? s.pickH : null,
      pickM: hasTime ? s.pickM : 0,
      retH: hasTime ? s.retH : null,
      retM: hasTime ? s.retM : 0,
      task: null,
      tab: isRent ? 'all' : 'buy',
      type: s.type || 'all',
      typeQuery: s.typeQuery || '',
    });
  }

  seeAll(e) {
    if (e && e.preventDefault) e.preventDefault();
    this.syncShared();
    this.deps.goBrowse?.();
  }

  hdrBounds(w, triggerEl) {
    const vw = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
    const widths = { loc: 420, date: 740, time: 500, type: 420 };
    const popW = Math.min(widths[w] || 420, vw - 32);
    const pill = triggerEl?.closest?.('[role="search"]')
      || this.$root?.querySelector?.(this.state.compact ? '[data-sticky-hdr] [role="search"]' : 'header [role="search"]');
    const pillRect = pill?.getBoundingClientRect?.();
    const btnRect = triggerEl?.getBoundingClientRect?.();
    const top = Math.max(76, Math.round((pillRect?.bottom || 74) + 12));
    let left;
    if (w === 'date' || w === 'time' || !btnRect) {
      const center = pillRect ? pillRect.left + pillRect.width / 2 : vw / 2;
      left = Math.round(center - popW / 2);
    } else if (w === 'type') {
      left = Math.round(btnRect.right - popW);
    } else {
      left = Math.round(btnRect.left);
    }
    const clampedLeft = Math.max(16, Math.min(vw - popW - 16, left));
    const anchorCenter = btnRect ? btnRect.left + btnRect.width / 2 : clampedLeft + popW / 2;
    const arrowLeft = Math.max(24, Math.min(popW - 38, Math.round(anchorCenter - clampedLeft - 7)));
    return { hdrTop: top + 'px', hdrLeft: clampedLeft + 'px', hdrArrowLeft: arrowLeft + 'px' };
  }

  jump(w, e) {
    if (!w) {
      const el = this.$root.getElementById('search');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.setState({ pop: null, hdrPop: false });
      return;
    }
    const same = this.state.pop === w && this.state.hdrPop;
    if (same) {
      this.setState({ pop: null, hdrPop: false, locError: '' });
      return;
    }
    const bounds = this.hdrBounds(w, e?.currentTarget);
    this.setState({ pop: w, hdrPop: true, locError: '', ...bounds });
  }

  // 세부 메뉴 항목 → 앱 화면. 홈에서 '빠른 예약 검색'은 예약창으로 바로 내려가요.
  menuAct(label) {
    if (label === '빠른 예약 검색') { this.jump(null); return; }
    this.deps.navigate?.(label);
  }

  // 로고를 누르면 새로고침했을 때처럼 첫 화면 모션이 다시 나와요
  replay() {
    window.scrollTo({ top: 0, behavior: 'auto' });
    this._pick = null;
    this.setState({ open: 0, pop: null, hdrPop: false, menu: null, searched: false, loc: '현재 위치', radius: 10, start: null, end: null, type: 'all', typeQuery: '', ym: TODAY_YM, pickH: 9, pickM: 0, retH: 18, retM: 0, pickDraft: null, retDraft: null, tab: 'rent', locSet: false, dateSet: false, timeSet: false, typeSet: false, locError: '', gpsPending: false, faqCat: 'all', risen: false, compact: false });
    try {
      const host = this.$root && this.$root.getAnimations ? this.$root : document;
      host.getAnimations().forEach(a => { if (a.animationName) { a.cancel(); a.play(); } });
    } catch (err) {}
    clearTimeout(this._riseT);
    this._riseT = setTimeout(() => { if (!this.state.risen) this.setState({ risen: true }); }, 1300);
  }

  renderVals() {
    const s = this.state;
    const serif = (this.props.headingFont ?? '고딕') === '명조';
    const qs = ['[질문 1을 입력해 주세요]', '[질문 2를 입력해 주세요]', '[질문 3을 입력해 주세요]', '[질문 4를 입력해 주세요]'];
    const toggle = w => () => this.setState({ pop: s.pop === w ? null : w, hdrPop: false, locError: '' });
    const ring = w => s.pop === w ? 'inset 0 0 0 2px #111111' : 'none';
    const ranged = s.start && s.end;

    const HH = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    const sameDay = ranged && s.start === s.end;
    let dateText = '날짜';
    if (s.start && !s.end) dateText = SL(s.start) + ' – 반납일';
    if (ranged) dateText = sameDay ? SL(s.start) + ' · 하루' : SL(s.start) + ' – ' + SL(s.end) + ' · ' + DAYS(s.start, s.end) + '일';
    let rangeHint = '빌리는 날을 먼저 눌러 주세요';
    if (s.start && !s.end) rangeHint = FULL(s.start) + '부터 · 반납하는 날을 눌러 주세요';
    if (ranged) rangeHint = FULL(s.start) + ' – ' + FULL(s.end) + ' · ' + DAYS(s.start, s.end) + '일';
    const timeText = HH(s.pickH, s.pickM) + '–' + HH(s.retH, s.retM);
    const timeBad = sameDay && (s.retH * 60 + s.retM) <= (s.pickH * 60 + s.pickM);
    const TRE = /^\s*([01]?\d|2[0-3])\s*:?\s*([03]0)\s*$/;
    const col = (key, n, val, dk, step = 1) => { const cur = Math.round(val / step); return {
      items: Array.from({ length: n }, (_, i) => {
        const d = Math.abs(i - cur);
        const look = d === 0 ? 'font-size: 22px; font-weight: 700; color: #111111' : d === 1 ? 'font-size: 18px; font-weight: 500; color: #555555' : 'font-size: 16px; font-weight: 500; color: #B4B4B4';
        return { label: String(i * step).padStart(2, '0'), look, pick: () => this.setState({ [key]: i * step, [dk]: null }) };
      }),
      ref: el => this.syncCol(el, cur),
      onScroll: e => this.wheel(e, key, n, dk, step)
    }; };
    const tcol = which => {
      const hk = which + 'H', mk = which + 'M', dk = which + 'Draft';
      const cur = s[hk] * 2 + (s[mk] >= 30 ? 1 : 0);
      const set = i => this.setState({ [hk]: Math.floor(i / 2), [mk]: (i % 2) * 30, [dk]: null });
      return {
        items: Array.from({ length: 48 }, (_, i) => {
          const d = Math.abs(i - cur);
          const look = d === 0 ? 'font-size: 22px; font-weight: 700; color: #111111' : d === 1 ? 'font-size: 18px; font-weight: 500; color: #555555' : 'font-size: 16px; font-weight: 500; color: #B4B4B4';
          return { label: HH(Math.floor(i / 2), (i % 2) * 30), look, pick: () => set(i) };
        }),
        ref: el => this.syncCol(el, cur),
        onScroll: e => {
          const el = e.currentTarget;
          const i = Math.max(0, Math.min(47, Math.round(el.scrollTop / 44)));
          if (el.dataset.v !== String(i)) { el.dataset.v = String(i); set(i); }
        }
      };
    };
    const input = which => {
      const hk = which + 'H', mk = which + 'M', dk = which + 'Draft';
      const draft = s[dk];
      const ok = draft == null || TRE.test(draft);
      return {
        value: draft == null ? HH(s[hk], s[mk]) : draft,
        border: ok ? '#E2E2E2' : '#D93025',
        onChange: e => {
          const v = e.target.value;
          const m = v.match(TRE);
          if (m) this.setState({ [dk]: v, [hk]: +m[1], [mk]: +m[2] });
          else this.setState({ [dk]: v });
        },
        onBlur: () => this.setState({ [dk]: null })
      };
    };

    const pickedLabel = machineFilterLabel(s.type, s.typeQuery);
    const showType = pickedLabel || (s.typeSet && s.type === 'all' ? '전체' : '');
    const bits = [s.locSet && s.loc !== '현재 위치' ? s.loc : '전체 지역'];
    if (ranged && s.tab === 'rent') bits.push(s.start === s.end ? SL(s.start) : SL(s.start) + '–' + SL(s.end));
    if (showType) bits.push(showType);
    TODAY = todayKey(); TODAY_YM = todayYm();
    const found = s.searched ? this.matches() : [];
    const count = found.length;
    if (!this._pick || this._pick.tab !== s.tab || !this._pick.list.length) {
      const pool = openListings(s.tab === 'rent' ? 'rent' : 'sale');
      this._pick = { tab: s.tab, list: pool.map(it => it.id).sort(() => Math.random() - 0.5).slice(0, 3) };
    }
    const pickList = this._pick.list.map(id => this.deps.listingById?.(id)).filter(Boolean);
    const recs = (s.searched ? [...found].sort((x, y) => x.price - y.price).slice(0, 3) : pickList)
      .map(it => ({ img: photoOf(it), hasImg: true, noImg: false, name: nameOf(it), place: placeOf(it), price: it.type === 'rent' ? '1일 ' + won(it.price) : bigWon(it.price), badge: it.type === 'rent' ? '대여 가능' : '중고 매물', open: () => { this.syncShared(); this.deps.openDetail?.(it.id); } }));

    return {
      // 사용 방법 탭: 빌리는 분 / 빌려주는 분 (누르면 STEP 01~04가 바뀌어요)
      howBorrow: (s.howRole || 'borrow') === 'borrow', howLend: s.howRole === 'lend',
      howBorrowPick: () => { if ((this.state.howRole || 'borrow') !== 'borrow') this.setState({ howRole: 'borrow' }); },
      howLendPick: () => { if (this.state.howRole !== 'lend') this.setState({ howRole: 'lend' }); },
      howBorrowSel: (s.howRole || 'borrow') === 'borrow' ? 'true' : 'false', howLendSel: s.howRole === 'lend' ? 'true' : 'false',
      howBorrowBg: s.howRole === 'lend' ? 'transparent' : '#111111', howBorrowColor: s.howRole === 'lend' ? '#555555' : '#FFFFFF', howBorrowWeight: s.howRole === 'lend' ? 500 : 700,
      howLendBg: s.howRole === 'lend' ? '#111111' : 'transparent', howLendColor: s.howRole === 'lend' ? '#FFFFFF' : '#555555', howLendWeight: s.howRole === 'lend' ? 700 : 500,
      ...menuVals(this, null, label => this.menuAct(label)),
      goHome: e => { if (e && e.preventDefault) e.preventDefault(); this.replay(); },
      headFont: serif ? "'Noto Serif KR', serif" : "'Noto Sans KR', sans-serif",
      sum: s.searched ? bits.join(' · ') : '추천하는 매물', countText: s.searched ? (count ? (s.tab === 'rent' ? '농기계 ' : '중고 매물 ') + count + '대' : '조건에 맞는 매물이 아직 없어요') : '우리 동네에서 많이 찾는 농기계예요',
      seeAll: e => this.seeAll(e),
      wrapZ: s.pop && !s.hdrPop ? 35 : 3,
      locText: s.locSet ? (s.loc === '현재 위치' ? '전체 지역' : s.loc) + ' · ' + s.radius + 'km 이내' : '이용할 위치', locTextColor: s.locSet ? '#111111' : '#9A9A9A',
      dateText, dateTextColor: s.start ? '#111111' : '#9A9A9A',
      timeShow: s.timeSet ? timeText : '시간', timeTextColor: s.timeSet ? '#111111' : '#9A9A9A',
      typeText: showType || '기종 선택/입력', typeTextColor: showType ? '#111111' : '#9A9A9A',
      doSearch: e => { if (e && e.preventDefault) e.preventDefault(); this.setState({ searched: true, pop: null, hdrPop: false }); this.syncShared(); },
      openLoc: toggle('loc'), openDate: toggle('date'), openType: toggle('type'),
      locRing: ring('loc'), dateRing: ring('date'), typeRing: ring('type'),
      locOpen: s.pop === 'loc' && !s.hdrPop, dateOpen: s.pop === 'date' && !s.hdrPop, typeOpen: s.pop === 'type' && !s.hdrPop,
      hdrLocOpen: s.pop === 'loc' && !!s.hdrPop, dateOpenHdr: s.pop === 'date' && !!s.hdrPop, timeOpenHdr: s.pop === 'time' && !!s.hdrPop, hdrTypeOpen: s.pop === 'type' && !!s.hdrPop,
      hdrTop: s.hdrTop || '86px', hdrLeft: s.hdrLeft || '16px', hdrArrowLeft: s.hdrArrowLeft || '32px',
      anyOpen: !!s.pop,
      locError: s.locError || '',
      closePop: () => this.setState({ pop: null, hdrPop: false, locError: '' }),
      locs: LOCS(s.gpsPending).map(l => ({
        name: l.name, sub: l.type === 'pin' ? '' : l.sub, isNav: l.type === 'nav', isRecent: l.type === 'recent', isPin: l.type === 'pin',
        color: l.type === 'nav' ? '#1E9B4B' : '#111111', bg: s.loc === l.value ? '#F4F4F4' : 'transparent',
        pick: () => {
          const next = s.tab === 'rent' ? 'date' : 'type';
          if (l.value === '현재 위치') {
            pickCurrentLocationGps(this, {
              nextPop: next,
              onHdrBounds: () => (this.state.hdrPop ? this.hdrBounds(next) : {}),
            });
            return;
          }
          this.setState({ loc: l.value, locSet: true, locError: '', pop: next, ...(s.hdrPop ? this.hdrBounds(next) : {}) });
        }
      })),
      radii: [5, 10, 20, 30].map(r => ({ label: r + 'km', bg: s.radius === r ? '#111111' : '#FFFFFF', color: s.radius === r ? '#FFFFFF' : '#111111', border: s.radius === r ? '#111111' : '#E2E2E2', pick: () => this.setState({ radius: r }) })),
      m1: this.month(s.ym), m2: this.month(s.ym + 1),
      prevMonth: () => this.setState({ ym: Math.max(TODAY_YM, s.ym - 1) }), nextMonth: () => this.setState({ ym: s.ym + 1 }),
      prevColor: s.ym <= TODAY_YM ? '#C8C8C8' : '#111111',
      rangeHint, timeText, timeBad,
      openTime: toggle('time'), timeRing: ring('time'), timeOpen: s.pop === 'time' && !s.hdrPop,
      pickHCol: col('pickH', 24, s.pickH, 'pickDraft'), pickMCol: col('pickM', 2, s.pickM, 'pickDraft', 30),
      retHCol: col('retH', 24, s.retH, 'retDraft'), retMCol: col('retM', 2, s.retM, 'retDraft', 30),
      pickIn: input('pick'), retIn: input('ret'), pickCol: tcol('pick'), retCol: tcol('ret'),
      pickDay: s.start ? FULL(s.start) : '빌리는 날', retDay: s.end ? FULL(s.end) : '반납하는 날',
      applyTime: () => this.setState({ pop: 'type', pickDraft: null, retDraft: null, timeSet: true, ...(s.hdrPop ? this.hdrBounds('type') : {}) }),
      resetDate: () => this.setState({ start: null, end: null }),
      applyDate: () => this.setState({ pop: 'time', dateSet: true, ...(s.hdrPop ? this.hdrBounds('time') : {}) }),
      typeQuery: s.typeQuery || '',
      onTypeInput: e => {
        const v = e.target.value;
        this.setState({ typeQuery: v, type: 'all', typeSet: !!v.trim() });
      },
      resetType: () => this.setState({ type: 'all', typeQuery: '', typeSet: false }),
      applyType: () => this.setState({
        typeSet: s.type !== 'all' || !!(s.typeQuery || '').trim(),
        pop: null,
        hdrPop: false,
      }),
      typeChoices: buildTypeChoices(s.type, s.typeQuery, id =>
        this.setState({ type: id, typeQuery: '', typeSet: true, pop: null, hdrPop: false })
      ),
      recs,
      compact: !!s.compact, noPill: false,
      tractorRef: el => {
        if (!el || this._trOn) return;
        this._trOn = true;
        const svg = el.querySelector('svg');
        if (!svg) return;
        svg.style.zIndex = '1'; svg.style.transition = 'transform 0.18s ease-out';
        // 왼쪽 '쉬는 농기계가 있다면' 테두리에서 출발해, 오른쪽 '농사가 처음이라면'까지 달려요.
        // 연결선이 화면 아래쪽(85%)에 보이면 출발하고, 화면 가운데쯤(40%)에 오면 도착해요.
        const upd = () => {
          const vh = Math.min(window.innerHeight || 800, 1000);
          const r = el.getBoundingClientRect();
          const p = Math.max(0, Math.min(1, (vh * 0.85 - r.top) / (vh * 0.45)));
          const tw = svg.getBoundingClientRect().width;
          const edge = 28;
          const room = Math.max(0, el.offsetWidth - tw + edge * 2);
          svg.style.transform = 'translate(' + Math.round(-edge + p * room) + 'px, -50%)';
        };
        window.addEventListener('scroll', upd, { passive: true });
        window.addEventListener('resize', upd, { passive: true });
        upd();
      },
      cardRise: 'none', cardOp: 1,
      riseRef: el => {
        if (!el || this._riseOn) return;
        this._riseOn = true;
        const go = () => { if (!this.state.risen) this.setState({ risen: true }); ['wheel', 'scroll', 'touchmove', 'keydown'].forEach(t => window.removeEventListener(t, go)); };
        ['wheel', 'scroll', 'touchmove', 'keydown'].forEach(t => window.addEventListener(t, go, { passive: true }));
        setTimeout(() => { if (!this.state.risen) this.setState({ risen: true }); }, 1300);
        if (typeof IntersectionObserver !== 'undefined') {
          const els = this.$root.querySelectorAll('#search + section > div, #about > div > *, [data-feat-dim] > section > div > div, #about ~ section > div > *, #about ~ section [style*="grid-template-columns: repeat(4"] > div');
          const io = new IntersectionObserver(list => list.forEach(e => { if (e.isIntersecting) { e.target.style.opacity = '1'; e.target.style.transform = 'none'; e.target.style.filter = 'none'; io.unobserve(e.target); } }), { threshold: 0.12 });
          els.forEach(x => { const k = x.parentNode ? [...x.parentNode.children].indexOf(x) : 0; const d = (Math.min(k, 4) * 0.1) + 's'; x.style.opacity = '0'; x.style.transform = 'translateY(30px)'; x.style.filter = 'blur(6px)'; x.style.transition = 'opacity 0.9s ease ' + d + ', transform 1s cubic-bezier(0.22, 1, 0.36, 1) ' + d + ', filter 0.9s ease ' + d; io.observe(x); });
        }
      },
      hdrShift: s.compact ? 'translateY(0)' : 'translateY(-110%)', hdrHidden: s.compact ? 'false' : 'true',
      heroRef: el => {
        if (!el || this._io || typeof IntersectionObserver === 'undefined') return;
        this._io = new IntersectionObserver(([e]) => { const vh = e.rootBounds ? e.rootBounds.height : window.innerHeight; const c = e.boundingClientRect.top < Math.min(vh, 1000) - 40; if (c !== !!this.state.compact) this.setState({ compact: c }); }, { threshold: [0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1] });
        this._io.observe(el);
      },
      pillLoc: s.locSet ? (s.loc === '현재 위치' ? '전체 지역' : s.loc) + ' · ' + s.radius + 'km' : '동네 검색', pillLocColor: s.locSet ? '#111111' : '#9A9A9A',
      pillDate: s.dateSet && ranged ? dateText : '날짜 추가', pillDateColor: s.dateSet && ranged ? '#111111' : '#9A9A9A',
      pillType: showType || '기종 선택/입력', pillTypeColor: showType ? '#111111' : '#9A9A9A',
      popAt: 'position: absolute; z-index: 32; top: calc(100% + 14px); left: 0;',
      arrowDisp: 'block',
      cardFx: '-webkit-backdrop-filter: blur(24px) saturate(140%); backdrop-filter: blur(24px) saturate(140%);',
      jumpLoc: e => this.jump('loc', e), jumpDate: e => this.jump('date', e), jumpType: e => this.jump('type', e), jumpGo: () => this.jump(null),
      isRent: s.tab === 'rent', rentSel: s.tab === 'rent' ? 'true' : 'false', buySel: s.tab === 'rent' ? 'false' : 'true',
      knobLeft: s.tab === 'rent' ? '4px' : '50%',
      rentColor: s.tab === 'rent' ? '#111111' : '#767676', buyColor: s.tab === 'rent' ? '#767676' : '#111111',
      setRent: () => this.setState({ tab: 'rent' }), setBuy: () => this.setState({ tab: 'buy', pop: null }),
      faqCats: [['all', '전체', -1], ['rent', '대여', 0], ['reg', '기계 등록', 1], ['pay', '결제·반납', 2]].map(([id, label, idx]) => {
        const on = (s.faqCat || 'all') === id;
        return { label, bg: on ? '#111111' : '#F6F6F6', color: on ? '#FFFFFF' : '#555555', pressed: on ? 'true' : 'false', pick: () => this.setState({ faqCat: id, open: idx }) };
      }),
      faqs: FAQ.map((f, i) => {
        const open = s.open === i;
        return { q: (i + 1) + '. ' + f.q, a: f.a, tag: f.tag, open, expanded: open ? 'true' : 'false', sign: open ? '−' : '+', toggle: () => this.setState({ open: open ? -1 : i, faqCat: open ? 'all' : f.cat }) };
      })
    };
  }
}
