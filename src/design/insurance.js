// 모아농 2.4 농기계 보험 — 농기계종합보험(사업방법서·상품요약서 2606)을 쉽게 풀어 보여 주는 화면. 보험료는 어림 참고값이에요.
import { DCLogic } from "./dc-runtime.js";
import { menuVals } from "./menu.js?v=20261121-1";

export class InsuranceDesign extends DCLogic {
  constructor(props) {
    super(props);
    this.deps = props.deps || {};
    this.state = { role: 'borrow', cov: { bi: true, pd: true, self: true, mach: true }, kind: 0, val: 1, days: 3, gov: true, joined: false, menu: null };
  }





  renderVals() {
    const s = this.state, lend = s.role === 'lend';
    const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
    const man = n => n >= 10000 ? (n / 10000).toLocaleString('ko-KR') + '억원' : n.toLocaleString('ko-KR') + '만원';
    const KINDS = ['농용트랙터', '관리기', '동력경운기', '콤바인', '이앙기', '농업용 드론'];
    const VALS = [[2000, '2천만원'], [5000, '5천만원'], [8000, '8천만원'], [12000, '1억 2천만원']];
    // 담보 비중(참고): 기본요율 0.68%를 담보별로 나눠 어림해요
    const COV = [
      ['bi', '남에게', '대인배상', '기계 사고로 다른 사람이 죽거나 다쳤을 때 법률상 배상책임을 보상해요.', '예: 농로에서 지나가던 이웃과 부딪혔을 때', 0.15],
      ['pd', '남에게', '대물배상', '기계 사고로 다른 사람의 물건(차, 담장 등)을 망가뜨렸을 때 보상해요.', '예: 후진하다 옆집 트럭을 긁었을 때 · 농작물·농지·농로 피해는 빼요', 0.1],
      ['self', '나에게', '자기신체사고', '기계를 운전하다 내가 죽거나 다쳤을 때 보상해요.', '부상은 상해등급 1~14급에 따라 3천만원~50만원', 0.1],
      ['mach', '내 기계에', '농기계손해', '충돌·전복·화재·도난·침수로 기계가 망가졌을 때 수리비를 보상해요.', '전부 망가지면 그때 기계 값, 일부면 수리비에서 자기부담금을 빼요', 0.65],
    ];
    const val = VALS[s.val][0] * 10000;
    const share = COV.filter(c => s.cov[c[0]]).reduce((a, c) => a + c[5], 0);
    const yearly = val * 0.0068 * share;
    const govPart = s.gov ? yearly * 0.5 : 0;
    const base = lend ? yearly : yearly * s.days / 365;
    const gov = lend ? govPart : govPart * s.days / 365;
    const pay = base - gov;
    const chipOf = (on, label, pick) => ({ label, on: on ? 'true' : 'false', bd: on ? '#111111' : '#DDDDDD', bg: on ? '#111111' : '#FFFFFF', fg: on ? '#FFFFFF' : '#111111', pick });
    const covNames = COV.filter(c => s.cov[c[0]]).map(c => c[2]);
    return {
      ...menuVals(this, 'mine', label => this.deps.navigate?.(label)),
      roles: [['borrow', '빌리는 분'], ['lend', '빌려주는 분']].map(([k, label]) => ({ label, on: s.role === k ? 'true' : 'false', bg: s.role === k ? '#FFFFFF' : 'transparent', fg: s.role === k ? '#111111' : '#767676', sh: s.role === k ? '0 2px 8px rgba(0,0,0,0.1)' : 'none', pick: () => this.setState({ role: k, joined: false }) })),
      wayTag: lend ? '자가용 · 1년' : '단기 임대용', wayTitle: lend ? '내 기계는 소유주가 1년 단위로 가입해요' : '빌린 날부터 돌려주는 날까지만 가입해요',
      wayDesc: lend ? '내 농작업이나 농작업 대행에 쓰는 기계는 소유주가 가입해요. 이웃에게 빌려줄 때도 보장되는지는 가입 전에 보험사에 꼭 물어보세요.' : '1개월 이내로 빌려 쓸 때, 빌리는 분(임차인)이 가입해요. 만 19세 이상이면 가입할 수 있어요.',
      covs: COV.map(c => { const on = !!s.cov[c[0]]; return { who: c[1], name: c[2], desc: c[3], ex: c[4], on: on ? 'true' : 'false', bd: on ? '#1E9B4B' : '#EEEEEE', bg: on ? '#FBFEFC' : '#FFFFFF', tagFg: on ? '#13773A' : '#767676', boxBg: on ? '#1E9B4B' : '#FFFFFF', boxBd: on ? 'none' : '2px solid #CCCCCC', mark: on ? '✓' : '', pick: () => this.setState({ cov: { ...s.cov, [c[0]]: !on }, joined: false }) }; }),
      kinds: KINDS.map((k, i) => chipOf(s.kind === i, k, () => this.setState({ kind: i, joined: false }))),
      values: VALS.map((v, i) => chipOf(s.val === i, v[1], () => this.setState({ val: i, joined: false }))),
      isBorrow: !lend, days: s.days,
      dayDown: () => this.setState({ days: Math.max(1, s.days - 1), joined: false }), dayUp: () => this.setState({ days: Math.min(30, s.days + 1), joined: false }),
      govOn: s.gov ? 'true' : 'false', govBd: s.gov ? '#1E9B4B' : '#DDDDDD', govBg: s.gov ? '#FBFEFC' : '#FFFFFF', govBox: s.gov ? '#1E9B4B' : '#FFFFFF', govBoxBd: s.gov ? 'none' : '2px solid #CCCCCC', govMark: s.gov ? '✓' : '',
      toggleGov: () => this.setState({ gov: !s.gov, joined: false }),
      lines: [
        { k: KINDS[s.kind] + ' · ' + VALS[s.val][1], v: covNames.length ? covNames.join('·') : '고른 담보 없음', fg: '#555555' },
        { k: lend ? '1년 보험료' : s.days + '일 보험료(1년 요율을 날짜로 나눈 값)', v: won(base), fg: '#111111' },
        { k: '국고지원 50%', v: s.gov ? '− ' + won(gov) : '받지 않음', fg: s.gov ? '#13773A' : '#9A9A9A' },
      ],
      totalLabel: lend ? '내가 낼 1년 보험료' : '내가 낼 보험료', total: won(pay),
      joinText: lend ? '내 기계 보험 가입 상담 받기' : '대여할 때 보험 가입하기', join: () => this.setState({ joined: true }),
      joined: s.joined, joinedMsg: lend ? '예시 안내예요. 실제 보험사 상담 접수는 준비 중이며, 가입 대상과 정확한 보험료는 보험사에서 확인해요.' : '대여 요청을 보낼 때 보험 가입 안내를 함께 보여 드릴게요. (현재는 참고용 예시 화면이에요)',
      yes: ['자동차·다른 농기계·물체와 부딪혔을 때', '기계가 떨어지거나 뒤집혔을 때', '불·폭발·벼락, 날아오거나 떨어진 물체 때문에', '기계를 통째로 도난당했을 때', '태풍·홍수·해일로 물에 잠겼을 때'],
      no: ['일부러 낸 사고', '긁힘·닳음·녹 같은 자연스러운 낡음', '부품이나 작업기만 따로 도난당했을 때', '무면허·음주·약물 운전 중 생긴 기계 손해', '사고와 상관없는 전기·기계 고장, 얼어서 터짐', '정해진 좌석이 아닌 곳에 타서 다쳤을 때'],
      rentTable: [['50마력 이하', 56290], ['60마력 이하', 73430], ['70마력 이하', 85880], ['100마력 이하', 134420], ['130마력 이하', 232270], ['130마력 초과', 256350]].map(([hp, w]) => ({ hp, won: w.toLocaleString('ko-KR') + '원' })),
      riders1: [{ t: '자기신체사고Ⅱ', d: '기본 자기신체사고보다 더 넉넉하게, 대인배상 기준으로 과실을 따지지 않고 보상해요. 둘 중 하나만 들 수 있어요.' }, { t: '적재농산물 위험담보', d: '경운기·트랙터·관리기·운반차에 싣고 가던 농산물이 사고로 상하면 보상해요. 1사고 500만원, 1년 1,000만원까지 (자기부담 5%).' }],
      riders2: [{ t: '법률비용지원금', d: '사고로 사람을 다치게 해 형사책임을 질 때 벌금(2천만원), 변호사 선임비(500만원), 형사합의금을 도와요. 대인배상에 든 경우만.' }, { t: '블랙박스 장착 · 농기계손해 확장', d: '블랙박스를 단 기계, 보장 범위를 넓히고 싶은 기계를 위한 특약이에요.' }],
      steps: [['01', '먼저 안전하게', '시동을 끄고, 다친 사람이 있으면 119에 연락해요.'], ['02', '사진 찍어 두기', '부서진 곳, 주변 모습, 상대 차·물건을 여러 장 찍어요.'], ['03', '모아농에서 접수', '내 대여 요청에서 ‘사고 접수’를 눌러요. 소유주와 보험사에 함께 알려요.'], ['04', '보상 받기', '보험사가 확인하고 보험금을 드려요.']].map(([n, t, d]) => ({ n, t, d })),
      facts: [{ t: '급하면 먼저 절반', d: '보험금이 정해지기 전이라도 지급할 금액의 50%까지 먼저 받을 수 있어요(가지급보험금).' }, { t: '도난당했다면', d: '경찰에 신고하고 30일이 지나면 보험금을 청구할 수 있어요.' }, { t: '음주 사고라면', d: '기계 손해는 보상이 안 되지만, 남을 다치게 한 배상 등 다른 담보는 보상될 수 있어요.' }],
      machines: ['동력경운기', '농용트랙터', '콤바인', '스피드스프레이어', '동력분무기', '이앙기', '관리기', '승용제초기', '농업용파쇄기', '베일러', '광역방제기', '농업용 무인헬기', '농업용 드론', '농용굴삭기', '농용동력운반차', '농업용고소작업차', '농업용리프트', '농용로우더', '농업용지게차'],
      notes: ['만기에 돌려받는 돈이 없는 순수 보장형 보험이에요.', '중간에 해지하면, 보험금을 받은 적이 없을 때 남은 기간 보험료를 돌려받아요.', '기계를 팔거나 다른 기계로 바꿔도 보험을 이어 갈 수 있어요.', '보험료는 계약할 때 한 번에 내요(국고지원분은 따로 처리돼요).'],
    };
  }
}
