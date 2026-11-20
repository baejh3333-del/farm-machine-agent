// 모아농 2.4 AS 도움 — 고장 종류를 고르면 가까운 AS센터를 보여 주고 출장 수리를 요청하는 화면. 센터 목록은 아직 예시 데이터예요.
import { DCLogic } from "./dc-runtime.js";
import { menuVals } from "./menu.js?v=20261121-3";

export class AsDesign extends DCLogic {
  constructor(props) {
    super(props);
    this.deps = props.deps || {};
    this.state = { mach: 0, prob: 0, sort: 'near', sel: 0, req: null, stage: 0, menu: null };
  }





  renderVals() {
    const s = this.state;
    const MACH = [['트랙터 + 로터리 50마력', '대여 중 · 11/24까지 · 소유주 김농부', '대여 중', '#E3F3E8', '#13773A', '/src/design/assets/tractor.jpg'], ['관리기 (소형)', '내 기계 · 2022년식', '내 기계', '#F2F2F2', '#555555', '/src/design/assets/cultivator.jpg']];
    const PROB = [['시동이 안 걸려요', '연료가 남아 있는지, 비상 정지 스위치가 눌려 있지 않은지 먼저 봐 주세요.', 'engine'], ['연기·타는 냄새', '바로 시동을 끄고 기계에서 떨어져 주세요. 다시 켜지 마세요.', 'engine'], ['기름이 새요', '시동을 끄고 새는 곳을 사진으로 찍어 두면 수리가 빨라요.', 'oil'], ['작업기가 안 붙어요', '핀 크기와 PTO 연결부를 확인해 보세요. 농기계 호환에서 맞는 작업기도 볼 수 있어요.', 'hitch'], ['바퀴·벨트 문제', '평평한 곳에 세우고 바퀴 밑에 받침을 대 주세요.', 'wheel'], ['잘 모르겠어요', '소리나 움직임을 짧게 동영상으로 찍어 두면 설명이 쉬워요.', 'all']];
    const C = [
      ['신북 농기계 서비스센터', 1.8, '신북읍 율문리', true, true, ['engine', 'oil', 'hitch', 'wheel', 'all'], ['트랙터·관리기', '출장 수리', '평균 40분'], '58%', '24%'],
      ['춘천 농협 농기계수리센터', 3.4, '동면 만천리', true, false, ['engine', 'oil', 'wheel', 'all'], ['모든 제조사', '부품 보유 많음', '방문 수리'], '74%', '62%'],
      ['동면 농기계 정비소', 4.9, '동면 감정리', false, true, ['engine', 'hitch', 'all'], ['관리기·경운기', '출장 수리', '내일 9시 문 열어요'], '84%', '44%'],
      ['사북 농업기계 수리점', 7.2, '사북면 오탄리', true, true, ['oil', 'wheel', 'hitch', 'all'], ['작업기 용접', '출장 수리', '평균 70분'], '20%', '80%'],
    ];
    const key = PROB[s.prob][2];
    let rows = C.map((c, i) => ({ c, i })).filter(r => r.c[5].includes(key));
    if (s.sort === 'open') rows = rows.filter(r => r.c[3]);
    if (s.sort === 'visit') rows = rows.filter(r => r.c[4]);
    rows.sort((a, b) => a.c[1] - b.c[1]);
    const selI = rows.some(r => r.i === s.sel) ? s.sel : (rows[0] ? rows[0].i : -1);
    const chipOf = (on, label, pick) => ({ label, on: on ? 'true' : 'false', bd: on ? '#111111' : '#DDDDDD', bg: on ? '#111111' : '#FFFFFF', fg: on ? '#FFFFFF' : '#111111', pick });
    const STAGES = [['접수', '요청 흐름 시작'], ['배정', '기사님 배정 안내'], ['이동 중', '도착 시간 안내'], ['수리 중', '현장 수리 진행'], ['완료', '수리·보험 안내']];
    const NOW = [
      '예시 진행 화면이에요(실제 출장 요청은 전송되지 않아요). 실제 접수 시 센터에서 확인 후 연락이 와요.',
      '예시 단계: 기사님이 배정되면 연락처와 도착 예정 시간을 안내해요.',
      '예시 단계: 기사님이 이동 중이면 예상 도착 시간을 보여 드려요.',
      '예시 단계: 현장 수리가 진행되며 완료 후 비용을 안내해요.',
      '예시 단계: 수리가 끝나면 보험 청구 안내로 이어져요.',
    ];
    const r = s.req;
    return {
      ...menuVals(this, 'mine', label => this.deps.navigate?.(label)),
      machines: MACH.map((m, i) => ({ name: m[0], meta: m[1], tag: m[2], tagBg: m[3], tagFg: m[4], img: m[5], on: s.mach === i ? 'true' : 'false', bd: s.mach === i ? '#1E9B4B' : '#EEEEEE', bg: s.mach === i ? '#FBFEFC' : '#FFFFFF', pick: () => this.setState({ mach: i }) })),
      problems: PROB.map((p, i) => chipOf(s.prob === i, p[0], () => this.setState({ prob: i }))),
      tip: PROB[s.prob][1], problemName: PROB[s.prob][0], count: rows.length,
      sorts: [['near', '가까운 순'], ['open', '지금 문 연 곳'], ['visit', '출장 가능']].map(([k, label]) => ({ label, bg: s.sort === k ? '#111111' : '#FFFFFF', fg: s.sort === k ? '#FFFFFF' : '#111111', pick: () => this.setState({ sort: k }) })),
      centers: rows.map(({ c, i }) => ({ dist: c[1] + 'km', x: c[7], y: c[8], pinBg: i === selI ? '#111111' : '#FFFFFF', pinFg: i === selI ? '#FFFFFF' : '#111111', pick: () => this.setState({ sel: i }) })),
      list: rows.map(({ c, i }) => ({
        name: c[0], dist: c[1] + 'km', addr: c[2], tags: c[6],
        open: c[3] ? '지금 열려 있어요' : '문 닫았어요', openBg: c[3] ? '#E3F3E8' : '#F2F2F2', openFg: c[3] ? '#13773A' : '#767676',
        bd: i === selI ? '#111111' : '#EEEEEE', sh: i === selI ? '0 12px 30px rgba(0,0,0,0.08)' : 'none',
        reqText: r === i ? '요청 체험 중' : c[4] ? '출장 수리 요청 (체험)' : '방문 예약 (체험)', reqBg: r === i ? '#13773A' : '#1E9B4B',
        pick: () => this.setState({ sel: i }), request: () => this.setState({ req: i, sel: i, stage: 0 }),
      })),
      hasReq: r !== null && r !== undefined,
      reqCenter: r != null ? C[r][0] : '', reqSummary: MACH[s.mach][0] + ' · ' + PROB[s.prob][0] + (s.mach === 0 ? ' · 실제 접수 시 소유주에게도 알려요' : ''),
      stages: STAGES.map((st, i) => ({ t: st[0], d: st[1], bar: i <= s.stage ? '#1E9B4B' : '#E6E6E6', fg: i <= s.stage ? '#111111' : '#9A9A9A' })),
      reqNow: NOW[s.stage],
      advance: () => this.setState({ stage: Math.min(4, s.stage + 1) }), cancel: () => this.setState({ req: null, stage: 0 }),
    };
  }
}
