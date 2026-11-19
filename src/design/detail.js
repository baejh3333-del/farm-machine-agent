// 모아농 2.2 매물 상세 · Desktop — 캔버스 디자인 로직을 실제 매물 데이터에 연결
import { DCLogic } from "./dc-runtime.js";
import { CROP_BY_ID, OPERATION_BY_ID } from "../data/farm-machines.js";
import {
  WD, K, P, won, bigWon, todayKey, todayYm, isoToKey, keyToIso, photoOf, nameOf, placeOf, ratingOf,
  groupOf, openListings, available, shared, typeLabel,
} from "./data.js";

let TODAY = todayKey();
let TODAY_YM = todayYm();
const MDW = k => { const [y, m, d] = P(k); return m + '/' + d + ' (' + WD[new Date(y, m - 1, d).getDay()] + ')'; };
const SL = k => { const [, m, d] = P(k); return m + '/' + d; };
const DAYS = (a, b) => { const [y1, m1, d1] = P(a), [y2, m2, d2] = P(b); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1; };
const TIMES = ['오전 7시', '오전 9시', '오전 10시', '오후 1시', '오후 6시'];
const I = {
  hp: 'M13 3L5 14h6l-1 7 8-11h-6z', rot: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M21 3l-6 6', fuel: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M7 7h4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', weight: 'M6 8h12l2 12H4zM9 8a3 3 0 0 1 6 0', area: 'M4 4h16v16H4zM4 12h16M12 4v16',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11', chat: 'M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5', wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8 6.2 21l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  shield: 'M20 12V7l-8-4-8 4v5c0 5 3.4 8.6 8 9.5 4.6-.9 8-4.5 8-9.5z', drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z', dirt: 'M3 17c3-4 6-4 9 0s6 4 9 0M3 12h4M10 9h4M17 12h4', noalc: 'M8 3h8l-1 7a3 3 0 0 1-6 0zM12 13v6M9 21h6M4 4l16 16', job: 'M4 7h16v12H4zM9 7V5h6v2M4 12h16'
};
const CONDITION = { good: '상태 좋음', used: '사용감 있음', repair: '수리 중' };
const num = n => Number(n).toLocaleString('ko-KR');
const dateKo = iso => { const k = isoToKey(iso); if (!k) return '기록 없음'; const [y, m, d] = P(k); return y + '년 ' + m + '월 ' + d + '일'; };

function bookedKeys(item) {
  const out = [];
  for (const r of item?.booked || []) {
    let k = isoToKey(r.start); const e = isoToKey(r.end);
    let guard = 0;
    while (k && e && k <= e && guard++ < 400) {
      out.push(k);
      const [y, m, d] = P(k); const nx = new Date(y, m - 1, d + 1);
      k = K(nx.getFullYear(), nx.getMonth(), nx.getDate());
    }
  }
  return out;
}

function specChips(item) {
  const sp = item.specification?.specs || {};
  const chips = [];
  if (sp.nominalPowerPs) chips.push({ icon: I.hp, label: num(sp.nominalPowerPs) + '마력' });
  else if (sp.ratedPowerKw) chips.push({ icon: I.hp, label: sp.ratedPowerKw + ' kW' });
  if (sp.displacementCc) chips.push({ icon: I.fuel, label: num(Math.round(sp.displacementCc)) + ' cc' });
  if (sp.rows) chips.push({ icon: I.rot, label: sp.rows + '조식' });
  if (sp.workingWidthMm) chips.push({ icon: I.rot, label: '작업 폭 ' + num(sp.workingWidthMm) + 'mm' });
  if (sp.weightKg) chips.push({ icon: I.weight, label: sp.weightKg >= 1000 ? (sp.weightKg / 1000).toFixed(1) + '톤' : num(sp.weightKg) + 'kg' });
  if (item.areaMin || item.areaMax) chips.push({ icon: I.area, label: num(item.areaMin || 0) + '~' + num(item.areaMax || 0) + '평' });
  chips.push({ icon: I.clock, label: CONDITION[item.condition] || '상태 확인 필요' });
  return chips.slice(0, 6);
}

export class DetailDesign extends DCLogic {
  constructor(props) {
    super(props);
    this.deps = props.deps || {};
    this.state = { id: null, pop: null, start: null, end: null, st: 1, et: 4, pickup: 'self', opts: [], gallery: false, ym: todayYm() };
  }

  show(id) {
    TODAY = todayKey(); TODAY_YM = todayYm();
    const item = this.deps.listingById?.(id);
    const self = item?.delivery?.methods?.includes('owner_delivery') && !item.delivery.methods.includes('self_pickup') ? 'deliver' : 'self';
    const start = shared.start && shared.start >= TODAY ? shared.start : null;
    const end = start && shared.end && shared.end >= start ? shared.end : start;
    this.setState({ id, pop: null, gallery: false, start, end, pickup: self, opts: [], ym: start ? (P(start)[0] * 12 + P(start)[1] - 1) : TODAY_YM });
  }

  item() { return this.state.id ? this.deps.listingById?.(this.state.id) : null; }

  pickDay(k) {
    const s = this.state;
    const BOOKED = bookedKeys(this.item());
    if (BOOKED.includes(k)) return;
    if (!s.start || s.end || k < s.start) this.setState({ start: k, end: null });
    else if (BOOKED.some(b => b > s.start && b < k)) this.setState({ start: k, end: null });
    else this.setState({ end: k });
  }

  month(ym) {
    const s = this.state;
    const BOOKED = bookedKeys(this.item());
    const y = Math.floor(ym / 12), m = ym % 12;
    const first = new Date(y, m, 1).getDay();
    const n = new Date(y, m + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < first; i++) days.push({ label: '', pick: () => {}, style: 'height: 36px; border: none; background: transparent' });
    for (let d = 1; d <= n; d++) {
      const k = K(y, m, d);
      const past = k < TODAY, booked = BOOKED.includes(k);
      const on = k === s.start || k === s.end;
      const inR = s.start && s.end && k > s.start && k < s.end;
      let look = 'color: #111111; background: transparent; border-radius: 999px; cursor: pointer';
      if (past) look = 'color: #C8C8C8; background: transparent; cursor: default';
      else if (booked) look = 'color: #B4B4B4; background: #EEEEEE; border-radius: 8px; text-decoration: line-through; cursor: not-allowed';
      else if (on) look = 'color: #FFFFFF; background: #1E9B4B; border-radius: 999px; font-weight: 700; cursor: pointer';
      else if (inR) look = 'color: #111111; background: #EDF6F0; border-radius: 0; cursor: pointer';
      days.push({ label: String(d), pick: past ? () => {} : () => this.pickDay(k), style: 'height: 36px; border: none; font-family: inherit; font-size: 14px; ' + look });
    }
    return { title: y + '년 ' + (m + 1) + '월', days };
  }

  submit(e, total, chosen) {
    e?.preventDefault?.();
    const it = this.item();
    if (!it) return;
    if (it.type !== 'rent') { this.deps.chatForm?.({ listingId: it.id }); return; }
    const s = this.state;
    const notes = [];
    if (s.start) notes.push('받는 시간 ' + TIMES[s.st] + ', 돌려주는 시간 ' + TIMES[s.et]);
    notes.push('받는 방법: ' + (s.pickup === 'deliver' ? '배달 받기' : '직접 가지러 가기'));
    chosen.filter(o => o.id !== 'work').forEach(o => notes.push('부탁: ' + o.t));
    this.deps.rentalForm?.(it.id, {
      start: keyToIso(s.start), end: keyToIso(s.end || s.start), note: notes.join('\n'),
      rentalOperator: chosen.some(o => o.id === 'work') ? it.rentalOperator : null,
    });
  }

  renderVals() {
    const s = this.state;
    const it = this.item();
    if (!it) return { ...EMPTY };
    const isRent = it.type === 'rent';
    const DAY = it.price || 0;
    const days = s.start && s.end ? DAYS(s.start, s.end) : 1;
    const has = id => s.opts.includes(id);
    const flip = id => () => this.setState({ opts: has(id) ? s.opts.filter(x => x !== id) : [...s.opts, id] });
    const op = it.rentalOperator;
    const OPTS = isRent ? [
      op ? { id: 'work', t: '농작업 대행', d: '소유주 ' + op.name + '님이 기계를 몰고 와서 직접 작업해 드려요. ' + (op.experience || ''), unit: op.dailyPrice || 0, per: 'day' } : null,
      { id: 'lesson', t: '처음 쓰는 법 알려 주기', d: '받을 때 시동부터 작업까지 알려 달라고 소유주에게 부탁해요.', unit: 0, per: 'once' }
    ].filter(Boolean) : [];
    const optCost = o => o.per === 'day' ? o.unit * days : o.unit;
    const methods = it.delivery?.methods || ['self_pickup'];
    const fee = Number(it.delivery?.fee) || 0;
    const deliveryFee = s.pickup === 'deliver' ? fee : 0;
    const base = isRent ? DAY * days : DAY;
    const chosen = OPTS.filter(o => has(o.id));
    const total = base + deliveryFee + chosen.reduce((a, o) => a + optCost(o), 0);
    const lines = isRent ? [{ k: '대여료 (1일 ' + won(DAY) + ' × ' + days + '일)', v: won(base), color: '#333333' }] : [{ k: '판매가', v: bigWon(base), color: '#333333' }];
    if (deliveryFee) lines.push({ k: '배달·회수', v: won(deliveryFee), color: '#333333' });
    else if (s.pickup === 'deliver') lines.push({ k: '배달·회수', v: '소유주와 협의', color: '#333333' });
    chosen.forEach(o => lines.push({ k: o.t, v: optCost(o) ? won(optCost(o)) : '무료', color: '#333333' }));

    let rangeHint = '빌리는 날을 눌러 주세요';
    if (s.start && !s.end) rangeHint = '돌려주는 날을 눌러 주세요';
    if (s.start && s.end) rangeHint = SL(s.start) + ' – ' + SL(s.end) + ' · ' + days + '일';

    const photo = photoOf(it);
    const title = nameOf(it);
    const label = typeLabel(it.machineType);
    const caps = ['앞쪽 전체', '옆모습', '작업하는 부분', '뒤쪽'];
    const shots = caps.map((cap, i) => ({ cap, pos: ['center', '15% 80%', '70% 40%', '85% 75%'][i], zoom: [1, 1.7, 1.6, 1.8][i], ratio: i ? '4 / 3' : '16 / 9', span: i ? 'auto' : '1 / 3', hasImg: true, noImg: false, img: photo }));

    // 같은 기종 대여료와 비교
    const peers = openListings(it.type).filter(x => x.machineType === it.machineType && x.id !== it.id).map(x => x.price).sort((a, b) => a - b);
    const mid = peers.length ? peers[Math.floor(peers.length / 2)] : 0;
    const gap = mid - DAY;
    const unit = isRent ? '1일 ' : '';
    const fmt = isRent ? won : bigWon;
    const dealTitle = !mid ? '가격을 확인해 보세요' : gap > 0 ? '좋은 가격이에요' : gap === 0 ? '보통 가격이에요' : '가격을 비교해 보세요';
    const dealText = !mid ? '같은 기종 매물이 아직 적어요.' : gap > 0 ? '같은 기종 매물보다 ' + unit + fmt(gap) + ' 저렴해요.' : gap === 0 ? '같은 기종 매물과 가격이 같아요.' : '같은 기종 매물의 보통 가격은 ' + unit + fmt(mid) + '이에요.';

    const opLabels = (it.operations || []).map(o => OPERATION_BY_ID[o]?.label).filter(Boolean);
    const cropNames = (it.cropIds || []).map(c => CROP_BY_ID[c]?.name).filter(Boolean);
    const keywords = [
      ...opLabels.slice(0, 2).map(l => l + ' 특화'),
      ...(cropNames.length ? [cropNames.slice(0, 2).join('·') + ' 밭에 딱'] : []),
      ...(it.inspectedAt ? ['점검 기록 있음'] : []),
      ...(op ? ['농작업 대행 가능'] : []),
      ...(methods.includes('owner_delivery') ? ['배달 받을 수 있음'] : ['직접 가지러 가기'])
    ].slice(0, 6);
    const brandModel = [it.brand, it.model].filter(Boolean).join(' ');
    const conn = it.specification?.connection?.label;
    const unknown = (it.specification?.unknowns || [])[0];
    const r = ratingOf(it);
    const reviewList = Array.isArray(it.reviews) ? it.reviews.slice(0, 3) : [];
    const ownerName = it.ownerName || '소유주';
    const pickPlace = it.delivery?.pickupPlace || it.pickup || placeOf(it);
    const pickOpts = [
      methods.includes('self_pickup') ? { id: 'self', t: '직접 가지러 가기', d: pickPlace + '에서 받아요.', price: '무료' } : null,
      methods.includes('owner_delivery') ? { id: 'deliver', t: '배달 받기', d: (it.delivery?.area ? it.delivery.area + '까지 ' : '') + '소유주가 내 밭까지 가져다 드려요.', price: fee ? '+' + won(fee) : '요금 협의' } : null
    ].filter(Boolean);
    const similar = openListings(it.type)
      .filter(x => x.id !== it.id && groupOf(x.machineType) === groupOf(it.machineType) && (groupOf(it.machineType) || x.machineType === it.machineType))
      .filter(x => !isRent || !s.start || available(x, keyToIso(s.start), keyToIso(s.end || s.start)))
      .sort((a, b) => Math.abs(a.price - DAY) - Math.abs(b.price - DAY)).slice(0, 4);
    const favOn = this.deps.isFavorite?.(it.id);

    return {
      title, typeLabel: label, maker: brandModel || label, crumbLoc: placeOf(it),
      photo, shotCount: shots.length, placeLine: placeOf(it),
      hasReviews: !!r, noReviews: !r, rating: r ? r.avg.toFixed(1) : '', rentCount: r ? '후기 ' + r.count + '개' : '', reviewCount: r ? r.count : 0, newBadge: '새 매물',
      dealTitle, dealText,
      aiLead: label + (brandModel ? '(' + brandModel + ')' : '') + '라서',
      aiFocus: (it.areaMin || it.areaMax ? num(it.areaMin || 0) + '~' + num(it.areaMax || 0) + '평 ' : '') + (opLabels[0] || '농작업'),
      aiTail: '에 알맞아요.' + (cropNames.length ? ' ' + cropNames.slice(0, 3).join('·') + ' 농사에 많이 써요.' : '') + (conn ? ' 연결 방식은 ' + conn + '이에요.' : ''),
      ownerText: it.description || it.summary || '소유주가 아직 설명을 적지 않았어요.',
      ownerInitial: ownerName.slice(0, 1), ownerBadge: it.inspectedAt ? '점검 ✓' : '소유주', ownerName: '소유주 ' + ownerName,
      ownerMeta: placeOf(it) + ' · ' + (isRent ? '대여' : '판매') + ' 매물 · 승인 후 확정돼요',
      askOwner: () => this.deps.chatForm?.({ listingId: it.id }),
      askAi: () => this.deps.askAi?.(title + ' 매물에 대해 알려 줘'),
      openMap: () => this.deps.openMap?.(it.id),
      goType: e => { e?.preventDefault?.(); this.deps.browseType?.(groupOf(it.machineType) || 'all'); },
      seeMore: e => { e?.preventDefault?.(); this.deps.browseType?.(groupOf(it.machineType) || 'all'); },
      dayPrice: isRent ? '1일 ' + won(DAY) : bigWon(DAY), subPrice: isRent ? days + '일 · 옵션 포함' : '판매가 · 배달비 별도',
      isRent, hasOptions: OPTS.length > 0,
      ctaText: isRent ? '대여 요청 보내기' : '구매 문의하기',
      submit: e => this.submit(e, total, chosen),

      anyOpen: s.pop === 'date', closePop: () => this.setState({ pop: null }),
      rangeShort: s.start && s.end ? SL(s.start) + '–' + SL(s.end) : '날짜',
      openGallery: () => this.setState({ gallery: true }), closeGallery: () => this.setState({ gallery: false }), galleryOpen: s.gallery, shots,
      toggleFav: () => Promise.resolve(this.deps.toggleFavorite?.(it.id)).finally(() => this.setState({})),
      favSel: favOn ? 'true' : 'false', favFill: favOn ? '#1E9B4B' : 'rgba(17,17,17,0.2)', favStroke: favOn ? '#1E9B4B' : '#111111', favLabel: favOn ? '찜했어요' : '찜하기',
      specs: specChips(it),
      keywords,
      notes: [
        { k: '최근 점검', v: dateKo(it.inspectedAt), color: '#111111' },
        { k: '기계 상태', v: CONDITION[it.condition] || '확인 필요', color: it.condition === 'good' ? '#13773A' : '#111111' },
        { k: '작업기 연결', v: conn || '소유주에게 물어보세요', color: '#111111' },
        { k: '알고 빌려 주세요', v: unknown ? unknown + '는 확인이 필요해요' : '특별히 알릴 점이 없어요', color: '#9A5B00' }
      ],
      included: [
        { icon: I.book, t: '함께 오는 것', d: it.included || '본체만 와요. 필요한 작업기는 소유주에게 물어보세요.' },
        { icon: I.chat, t: '농농이 작업 도우미', d: '작업 중 궁금한 건 말로 물어보세요.' },
        { icon: I.wrench, t: '고장 나면 수리 상담', d: '농농이가 가까운 수리점까지 찾아 드려요.' },
        { icon: I.shield, t: '승인 후 확정', d: isRent ? '소유주가 승인해야 예약과 결제가 진행돼요.' : '소유주와 이야기한 뒤 거래를 정해요.' }
      ],
      scores: [], reviews: reviewList.map(v => ({ text: v.text || '', who: v.who || '', hasReply: !!v.reply, reply: v.reply || '' })),
      rules: [
        { icon: I.drop, t: '쓴 만큼 연료 채워 주세요', d: '받을 때와 같은 만큼 채워서 돌려주세요.' },
        { icon: I.dirt, t: '흙은 털고 돌려주세요', d: '물 세척까지는 안 해도 돼요.' },
        { icon: I.job, t: '정한 작업에만 써 주세요', d: '돌밭·자갈밭 작업은 미리 말해 주세요.' },
        { icon: I.noalc, t: '술 마시고 작업 금지', d: '안전을 위해 꼭 지켜 주세요.' }
      ],
      days, totalText: isRent ? won(total) : bigWon(total), lines,
      startText: s.start ? MDW(s.start) : '날짜', endText: s.end ? MDW(s.end) : '날짜',
      startT: TIMES[s.st], endT: TIMES[s.et],
      cycleStartT: () => this.setState({ st: (s.st + 1) % TIMES.length }), cycleEndT: () => this.setState({ et: (s.et + 1) % TIMES.length }),
      openDate: () => this.setState({ pop: s.pop === 'date' ? null : 'date' }), dateOpen: s.pop === 'date',
      m1: this.month(s.ym), m2: this.month(s.ym + 1), rangeHint,
      prevMonth: () => this.setState({ ym: Math.max(TODAY_YM, s.ym - 1) }), nextMonth: () => this.setState({ ym: s.ym + 1 }),
      prevColor: s.ym <= TODAY_YM ? '#C8C8C8' : '#111111',
      pickups: pickOpts.map(p => { const on = s.pickup === p.id; return { ...p, on: on ? 'true' : 'false', border: on ? '#111111' : '#E6E6E6', bg: on ? '#FAFAFA' : '#FFFFFF', ring: on ? '6px solid #1E9B4B' : '2px solid #CCCCCC', priceColor: p.price === '무료' ? '#13773A' : '#111111', pick: () => this.setState({ pickup: p.id }) }; }),
      mapPill: s.pickup === 'deliver' ? '배달 받을 곳' : '받는 곳 · ' + placeOf(it),
      placeLabel: s.pickup === 'deliver' ? '배달 받을 곳' : '받는 곳 (소유주)',
      placeText: s.pickup === 'deliver' ? '내 밭 · 요청할 때 적어 주세요' : pickPlace,
      options: OPTS.map(o => { const on = has(o.id); return { t: o.t, d: o.d, price: o.unit ? '+' + won(o.unit) + (o.per === 'day' ? ' / 1일' : '') : '무료', on: on ? 'true' : 'false', border: on ? '#111111' : '#E6E6E6', bg: on ? '#FAFAFA' : '#FFFFFF', boxBg: on ? '#1E9B4B' : '#FFFFFF', boxBorder: on ? 'none' : '2px solid #CCCCCC', check: on ? '✓' : '', pick: flip(o.id) }; }),
      similar: similar.map(x => {
        const rr = ratingOf(x);
        return {
          name: nameOf(x), meta: [x.brand, rr ? '★ ' + rr.avg.toFixed(1) + ' (' + rr.count + ')' : '새 매물'].filter(Boolean).join(' · '),
          price: x.type === 'rent' ? '1일 ' + won(x.price) : bigWon(x.price), total: x.type === 'rent' ? '총 ' + won(x.price * days) : '판매가',
          img: photoOf(x), hasImg: true, noImg: false, pos: 'center',
          open: () => this.deps.openDetail?.(x.id)
        };
      })
    };
  }
}

const EMPTY = {
  title: '', typeLabel: '', maker: '', crumbLoc: '', photo: '', shotCount: 0, placeLine: '', hasReviews: false, noReviews: true,
  specs: [], keywords: [], notes: [], included: [], scores: [], reviews: [], rules: [], lines: [], pickups: [], options: [], similar: [], shots: [],
  m1: { title: '', days: [] }, m2: { title: '', days: [] },
};
