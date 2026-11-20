// 디자인 화면 머리말의 세부 메뉴 (캔버스 2.3과 같은 모양)
// 메뉴 이름에 마우스를 올리면 그 메뉴의 세부 항목만 오른쪽 위 그라데이션 판 위에 펼쳐져요.
// 지도는 '매물 찾기'의 두 번째 줄에 있어요.
export const MENU = [
  ['find', '매물 찾기', ['매물 찾기', '내 동네 매물 지도', '빠른 예약 검색']],
  ['fit', '농기계 호환', ['내 농기계·호환 확인', '작물별 작업 가이드']],
  ['mine', '기계 관리', ['내 기계 관리', '거래 관리', '내 대여 요청', '찜 목록']],
];

export function openMenu(self, e, id, hover) {
  if (e && e.preventDefault && !hover) e.preventDefault();
  clearTimeout(self._menuT);
  if (!hover && self.state.menu === id) { self.setState({ menu: null }); return; }
  let top = 72, left = 0;
  const a = e && e.currentTarget;
  const box = a && a.closest && a.closest('header');
  if (box) top = Math.round(box.getBoundingClientRect().bottom);
  if (a && a.getBoundingClientRect) left = Math.round(a.getBoundingClientRect().left) - 24;
  if (!self._menuScroll) {
    self._menuScroll = () => { if (self.state.menu) self.setState({ menu: null }); };
    window.addEventListener('scroll', self._menuScroll, { passive: true });
  }
  if (self.state.menu === id && self.state.menuLeft === left + 'px') return;
  self.setState({ menu: id, menuTop: top + 'px', menuLeft: left + 'px', pop: null, hdrPop: false });
}

// active: 지금 화면이 속한 메뉴('find' 등), act: 세부 항목을 눌렀을 때 할 일(label)
export function menuVals(self, active, act) {
  const s = self.state;
  const close = () => { clearTimeout(self._menuT); if (self.state.menu) self.setState({ menu: null }); };
  const cur = MENU.find(m => m[0] === s.menu);
  return {
    navs: MENU.map(([id, label]) => {
      const open = s.menu === id, on = active === id;
      return {
        label, exp: open ? 'true' : 'false', weight: on ? 700 : 500,
        line: open ? 'inset 0 -2px 0 #111111' : on ? 'inset 0 -2px 0 #1E9B4B' : 'inset 0 -2px 0 transparent',
        pick: e => openMenu(self, e, id), hover: e => openMenu(self, e, id, true),
      };
    }),
    menuOpen: !!cur, menuTop: s.menuTop || '72px', menuLeft: s.menuLeft || '0px', closeMenu: close,
    keepMenu: () => clearTimeout(self._menuT),
    leaveMenu: () => { clearTimeout(self._menuT); self._menuT = setTimeout(close, 180); },
    menuItems: cur ? cur[2].map((label, i) => ({
      label, delay: (i * 0.05).toFixed(2) + 's',
      pick: e => { if (e && e.preventDefault) e.preventDefault(); close(); if (act) act(label); },
    })) : [],
  };
}

// 세부 항목 이름 → 앱 화면
export const MENU_DEST = {
  '매물 찾기': 'browse',
  '내 동네 매물 지도': 'map',
  '빠른 예약 검색': 'home-booking',
  '내 농기계·호환 확인': 'garage',
  '작물별 작업 가이드': 'guide',
  '내 기계 관리': 'owner',
  '거래 관리': 'deals',
  '내 대여 요청': 'requests',
  '찜 목록': 'favorites',
};
