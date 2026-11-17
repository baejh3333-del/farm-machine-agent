# 모아농(Moanong) UI·UX 및 모션그래픽 마스터 플랜

## 1. 기획 원칙: "기술과 기법만 차용하고, 브랜드 정체성은 모아농 고유의 색을 지킨다"
- **금지 사항 (No Brand Cloning)**:
  - 토스 특유의 코발트 블루(`#3182F6`), 구글 제미나이 특유의 보라·파랑 우주 그라데이션(`#4285F4`~`#9B72CB`), 챗GPT 특유의 무채색 흑백 미니멀리즘 등 **타 기업을 연상시키는 색상·아이콘·브랜드 요소를 일절 사용하지 않는다.**
- **모아농 고유 디자인 언어 (Warm Agrarian Craft)**:
  - **바탕**: 따뜻한 한지·들판 크림(`--bg-page: #f5efe4`, `--bg-surface: #fffcf6`, `--bg-warm: #faf5ec`)
  - **주조색**: 깊은 솔숲 녹색(`--forest: #174233`, `--primary: #2d5a3f`)과 새싹 라임(`--accent-lime: #dcf29d`)
  - **강조색**: 수확 황토·호박 앰버(`--harvest-gold: #d97724`, `--accent-amber: #fef3c7`)
- **차용하는 3대 인터랙션·모션 엔지니어링 기법**:
  1. **Toss 기법 (Tactile Spring & Progressive Disclosure)**:
     - **촉각적 탄성(Tactile Press)**: 모든 버튼·칩·카드 클릭 시 즉각적인 미세 압축(`scale(0.97)`)과 탄성 복원(`--ease-spring-pop: cubic-bezier(0.34, 1.56, 0.64, 1)`).
     - **숫자 카운트업(Rolling Number Feedback)**: 매물 건수(`#filterPreviewCount`), 예상 대여료 합계 등이 바뀔 때 숫자가 부드럽게 롤링/카운트업(`animateNumber`).
     - **단계적 정보 노출(Progressive Disclosure)**: 복잡한 설정(필터, 농농이 거래 전담 정책, 초기 조건 빌더)은 한 번에 쏟아내지 않고 아코디언/드로어 모션으로 부드럽게 펼쳐짐.
  2. **Google 기법 (Spatial Continuity & Shared-Axis Choreography)**:
     - **공간 연속성(Container Transform)**: 버튼이나 카드를 눌렀을 때 갑자기 창이 뜨는 대신, 트리거 지점의 맥락을 이어받으며 표면이 확장(`--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`).
     - **공유 축 화면 전환(Shared-Axis View Transition)**: 상단 메뉴(`홈`, `매물 찾기`, `작업 가이드`, `내 농기계·호환`, `대여 요청`, `내 기계 관리`) 전환 시 Y축/X축 미세 슬라이드+페이드(`choreographViewSwitch`).
     - **스태거드 캐스케이드(Staggered Card Cascade)**: 매물 그리드 카드·가이드 카드가 렌더링될 때 `--stagger-i` 변수 기반으로 35ms 간격의 물결처럼 등장(`staggerCards`).
  3. **GPT 기법 (Conversational Stream Rhythm & Adaptive Workspace)**:
     - **대화형 리듬 & 유기적 사고 파동(Organic Thinking Wave)**: 에이전트가 도구를 호출하고 답변을 생성할 때 딱딱한 로딩 스피너 대신 새싹·물결 파동 애니메이션과 단계별 상태 필(Pill)을 표시.
     - **적응형 캔버스 모핑(Adaptive Canvas Morphing)**: 농농이 실행 시 부드러운 전체화면 스튜디오(`is-fullscreen`)로 열리며 가로형 이미지 카드 레일(`.ai-result-cards`)을 펼쳐 보여주고, 우측 분할(`docked`)로 전환하면 본문 탐색을 방해하지 않도록 이미지를 숨긴 컴팩트 세로 리스트로 즉시 리플로우.

---

## 2. 공통 모션 토큰 설계 (`src/styles/tokens.css`)
| 토큰명 | 값 | 용도 |
|---|---|---|
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | 모달, 전체화면, 드로어 진입 및 공간 확장 |
| `--ease-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` | 카드 호버, 레이아웃 리플로우, 탭 인디케이터 이동 |
| `--ease-spring-pop` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 버튼 클릭 복원, 찜 하트 팝, 배지 등장 |
| `--ease-in-out-soft` | `cubic-bezier(0.4, 0, 0.2, 1)` | 배경 페이드, 색상·보더 전환 |
| `--dur-fast` | `160ms` | 마이크로 인터랙션 (버튼 프레스, 칩 토글) |
| `--dur-normal` | `280ms` | 카드 리프트, 드롭다운, 툴팁 |
| `--dur-slow` | `440ms` | 전체화면/우측분할 전환, 뷰 전환, 모달 모핑 |
| `--surface-glass` | `rgba(255, 252, 246, 0.86)` | 따뜻한 한지 글래스모피즘 배경 (`backdrop-filter: blur(16px)`) |

---

## 3. 병렬 워커 분할 및 파일 소유권 (Zero File Conflict)

### Worker 1 (`W1-Motion-Core-And-Shell`)
- **담당 파일**:
  - `src/styles/tokens.css`
  - `src/core/motion.js`
  - `src/styles/header-nav.css`
  - `src/styles/region-picker.css`
- **핵심 구현**:
  1. `src/styles/tokens.css`: 모션 이징·듀레이션·글래스·수확 골드/포레스트 그림자 토큰 추가 및 전역 마이크로 인터랙션 유틸 클래스(`.motion-press`, `.motion-lift`, `.stagger-item`, `.view-enter`) 정의.
  2. `src/core/motion.js`:
     - 기존 `initBannerCarousel`, `initRevealOnScroll`, `trackHeaderHeight`, `initScrollMotion` 유지·고도화.
     - 신규 모션 엔진 함수 추가 및 export:
       - `animateNumber(el, targetValue, { duration, suffix, prefix })`: 숫자 롤링/카운트업 애니메이션.
       - `staggerElements(container, selector, { stepMs, maxItems })`: 리스트/카드 렌더링 시 `--stagger-i` 자동 부여 및 캐스케이드 진입.
       - `choreographViewSwitch(targetEl)`: 화면(View) 전환 시 공유 축 페이드+업워드 슬라이드 모션 적용.
       - `initTactileFeedback()`: 버튼·칩·카드 프레스 리플/바운스 및 MutationObserver 기반 자동 스태거 연결.
  3. `src/styles/header-nav.css` & `src/styles/region-picker.css`:
     - 상단 네비게이션 글래스 블러, 활성 탭 스프링 인디케이터, 마이페이지 드롭다운 스프링 팝오버, 전국 시/도 → 시/군/구 선택 모달의 2단계 슬라이드 전환 모션.

### Worker 2 (`W2-Catalog-Weather-Garage-UX`)
- **담당 파일**:
  - `src/styles.css`
  - `src/garage.css`
  - `src/views/catalog.js`
  - `src/views/map-weather.js`
  - `src/garage.js`
- **핵심 구현**:
  1. `src/styles.css` & `src/views/catalog.js`:
     - 홈 히어로 배너 줌-인 케인번스(Ken Burns) 미세 모션 및 퀵서치 독(`#machineSearch`) 포커스 엘리베이션.
     - 매물 카드(`.listing-card` / `.card`) 스태거드 등장 애니메이션(`--stagger-i`), 호버 시 이미지 미세 줌(`scale(1.04)`) + 카드 리프트(`translateY(-4px)`), 찜 버튼 클릭 시 스프링 하트 팝(`--ease-spring-pop`).
     - 상세 모달(`#detailBackdrop`) 및 필터 모달(`#filterBackdrop`) 컨테이너 모핑 진입 및 필터 매칭 카운트(`#filterPreviewCount`) 롤링 피드백.
  2. `src/views/map-weather.js`:
     - 날씨 카드 및 주간 예보 바의 기상 적합도 배지 펄스, 지도 마커 선택 시 부드러운 포커스 하이라이트.
  3. `src/garage.css` & `src/garage.js`:
     - 내 농기계 차고 추가/선택 시 호환성 상태(호환 확인 / 조건부 / 미확인) 프로그레시브 배지 모션 및 세트 추천 카드 전환 애니메이션.

### Worker 3 (`W3-Agent-And-Delegated-Chat-Motion`)
- **담당 파일**:
  - `src/styles/ai-panel.css`
  - `src/ai/panel.js`
  - `src/styles/delegated-chat.css`
  - `src/views/transactions.js`
- **핵심 구현**:
  1. **브랜드 순수성 강화**: `src/styles/ai-panel.css`에 남아 있는 제미나이/외부 기업 느낌의 보라·파랑 색상이나 이질적 요소를 **모아농 고유의 숲녹색·새싹라임·수확앰버·한지크림 톤**으로 완전 교체.
  2. **전체화면 ↔ 우측 화면 모션그래픽 고도화 (`src/styles/ai-panel.css`, `src/ai/panel.js`)**:
     - `#aiLauncher` / `#headerAiOpen` 클릭 시 스프링 물리 곡선(`--ease-out-expo`)으로 전체화면(`is-fullscreen`)이 펼쳐지며, 웰컴 히어로·역량 카드·하단 컴포저가 시간차(Stagger)로 부드럽게 떠오름.
     - `⤢ 전체화면` ↔ `◧ 우측 화면` 전환 시 패널 크기·모서리 반경이 부드럽게 모핑되고, **전체화면에서는 농기계 이미지 포함 가로 스크롤 카드 레일(`.ai-result-cards`)이 카드별 스태거 모션으로 펼쳐지며, 우측 화면에서는 이미지가 즉시 숨겨지고(`display: none !important`) 세로 컴팩트 리스트로 정돈됨**.
  3. **1:1 대리 채팅 & 거래 전담 모션 (`src/styles/delegated-chat.css`, `src/views/transactions.js`)**:
     - `🤖 거래 전담` 설정 패널의 부드러운 확장/축소 트랜지션, `⏸️ 답변 보류·사용자 직접 응답 대기` 배너의 앰버 호흡 효과, 메시지 버블 슬라이드-인 모션.

### Worker 4 (`W4-Live-Browser-Visual-Inspector` — `W1`, `W2`, `W3` 완료 후 실행)
- **역할**: 실제 브라우저(Playwright Chromium)로 로컬 서버에 접속하여 데스크톱(`1440×900`) 및 모바일(`390×844`) 해상도에서 모든 화면과 모션 상태를 **직접 눈으로(스크린샷 + DOM/ComputedStyle 정밀 검사) 확인**하고 결함이 있으면 즉시 패치.
- **필수 점검 체크리스트**:
  1. 홈 배너, 퀵서치 독, 상단바 메뉴 전환, 마이페이지 드롭다운, 전국 지역 선택기 모달 작동 및 시각적 정렬.
  2. AI 농농이 버튼 클릭 → 전체화면(`is-fullscreen`) 모션 오픈, 추천 매물 가로 스크롤 리스트 내 **농기계 이미지 노출 확인**, 우측 화면(`docked`) 전환 시 **농기계 이미지 숨김(`display: none`) 및 세로 리스트 전환 확인**.
  3. 카메라 모달, 이미지 첨부 프리뷰, `🤖 거래 전담` 토글 및 1:1 채팅 전담 패널/배너 렌더링 확인.
  4. 콘솔 에러 0건, 가로 오버플로우(의도치 않은 수평 스크롤바) 0건, 타 기업(토스 파랑/구글 보라 등) 색상 잔재 0건 검증.
