// 디자인 화면 머리말의 세부 메뉴 (캔버스 2.3과 같은 모양)
// 메뉴 이름에 마우스를 올리면 그 메뉴의 세부 항목만 오른쪽 위 그라데이션 판 위에 펼쳐져요.
// 세부 항목 목록은 화면 템플릿(data-mega-group)에 그대로 적혀 있어요.
// 지도는 '매물 찾기'의 두 번째 줄에 있어요.
export const MENU = [
  ['find', '매물 찾기', ['매물 찾기', '내 동네 매물 지도', '빠른 예약 검색']],
  ['fit', '농기계 호환', ['내 농기계·호환 확인', '작물별 작업 가이드']],
  ['mine', '기계 관리', ['내 기계 관리', '거래 관리', '내 대여 요청', '찜 목록']],
];

// 세부 메뉴는 상태(setState)를 바꾸지 않고 DOM에서 바로 열고 닫아요.
// 그래서 메뉴에 마우스를 올려도 화면 전체가 다시 그려지지 않아요(새로고침처럼 보이지 않음).
function navLinks(root) {
  const host = root && root.getRootNode ? root.getRootNode() : document;
  return host.querySelectorAll('nav[aria-label="주 메뉴"] a');
}

export function closeMenu(self) {
  clearTimeout(self._menuT);
  const root = self._mega;
  if (!root || root.getAttribute('data-open') === '') return;
  root.setAttribute('data-open', '');
  navLinks(root).forEach(x => x.setAttribute('aria-expanded', 'false'));
}

export function openMenu(self, e, id, hover) {
  if (e && e.preventDefault && !hover) e.preventDefault();
  clearTimeout(self._menuT);
  const root = self._mega;
  if (!root) return;
  if (!hover && root.getAttribute('data-open') === id) { closeMenu(self); return; }
  const a = e && e.currentTarget;
  const box = a && a.closest && a.closest('header');
  const top = box ? Math.round(box.getBoundingClientRect().bottom) : 72;
  const left = a && a.getBoundingClientRect ? Math.round(a.getBoundingClientRect().left) - 24 : 0;
  const band = root.querySelector('[data-mega]'), col = root.querySelector('[data-mega-col]');
  if (band) band.style.top = top + 'px';
  if (col) { col.style.top = top + 'px'; col.style.left = left + 'px'; }
  root.setAttribute('data-open', id);
  const label = a ? a.textContent.trim() : '';
  navLinks(root).forEach(x => x.setAttribute('aria-expanded', x.textContent.trim() === label ? 'true' : 'false'));
  if (!self._menuScroll) {
    self._menuScroll = () => closeMenu(self);
    window.addEventListener('scroll', self._menuScroll, { passive: true });
  }
}

// active: 지금 화면이 속한 메뉴('find' 등), act: 세부 항목을 눌렀을 때 할 일(label)
export function menuVals(self, active, act) {
  if (!self._menuFns) {
    self._menuFns = {
      megaRef: el => { if (el) self._mega = el; },
      keepMenu: () => clearTimeout(self._menuT),
      leaveMenu: () => { clearTimeout(self._menuT); self._menuT = setTimeout(() => closeMenu(self), 180); },
      closeMenu: () => closeMenu(self),
      menuPick: e => {
        if (e && e.preventDefault) e.preventDefault();
        const label = e && e.currentTarget ? e.currentTarget.textContent.trim() : '';
        closeMenu(self);
        if (self._menuAct) self._menuAct(label);
      },
    };
  }
  self._menuAct = act;
  return {
    ...self._menuFns,
    navs: MENU.map(([id, label]) => {
      const on = active === id;
      return {
        label, exp: 'false', weight: on ? 700 : 500,
        line: on ? 'inset 0 -2px 0 #1E9B4B' : 'inset 0 -2px 0 transparent',
        pick: e => openMenu(self, e, id), hover: e => openMenu(self, e, id, true),
      };
    }),
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
