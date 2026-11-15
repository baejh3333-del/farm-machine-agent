# DB 재구축 구현 진행 기록 (`feature/db-rebuild`)

기준 커밋: `origin/main` (`b6a90b02c588df7a11f78519e81989be91c9a01f`)
기획 문서 커밋: `8393f94`

## P0 기준선 및 인프라 조사 결과

### 1. 코드·테스트·빌드 기준선
- `node scripts/build.mjs`: 통과 (`dist/ 생성 완료`)
- `node --test tests/*.test.js` (4개 파일, 30개 테스트): 30/30 통과
  - `tests/app.test.js`: 17개 통과
  - `tests/compatibility.test.js`: 4개 통과
  - `tests/machine-specifications.test.js`: 4개 통과
  - `tests/rental-dates.test.js`: 5개 통과

### 2. 배포·DB·환경 재고
- **실제 운영 배포(`https://moa-farm-machines.vercel.app`)**:
  - `GET /api/listings` → HTTP 200, 100건 데모 매물 반환 (`modelId`, `model`, `specification`, `demo: true` 포함) → 현재 운영은 `origin/main`(`b6a90b0`, 메모리 SQLite 매물 + Better Auth PostgreSQL)으로 동작 중임을 확인.
  - `GET /api/account?action=session` → HTTP 200, `{"user":null}` → Better Auth PostgreSQL 세션 조회 정상 동작.
- **미병합 PR #19 (`origin/feature/server-data`, `6291d2d`)**:
  - 단수형 테이블명(`listing`, `rental_request`, `booking`, `conversation`, `message`, `favorite`, `owned_machine`, `schema_meta`)을 사용한 미병합 프리뷰가 존재함.
  - 본 구현은 최종 계획(`db-rebuild-plan.md`)에 따라 복수형 테이블명(`listings`, `favorites`, `owned_machines`, `rental_requests`, `conversations`, `messages`, `schema_migrations`, `app_meta`) 및 추가 전용 마이그레이션으로 구성하여 기존 Better Auth 테이블(`"user"`, `"session"`, `"account"`, `"verification"`, `"rateLimit"`)이나 다른 테이블과 충돌하지 않도록 함.
- **로컬 환경·클라우드 접근 확인 및 차단 요인(Blockers)**:
  - 작업 공간 및 시스템 환경 변수에 `DATABASE_URL`, `BETTER_AUTH_SECRET`, 객체 저장소(Blob/S3) 자격 증명, `OPENAI_API_KEY`가 없음(`.env.local` 없음).
  - 로컬 Vercel CLI 인증 토큰(`%APPDATA%/com.vercel.cli/Data/auth.json`)이 만료되어(`403 invalidToken: true`) Vercel 프로젝트 환경 변수 목록·스코프·Preview 배포 명령 실행 불가.
  - 로컬 PostgreSQL 서비스/Docker 미설치 확인.
  - **대응**: 로컬 개발 및 PG 통합·브라우저 검증은 실제 PostgreSQL 16 엔진 + `btree_gist` 확장을 내장한 `@electric-sql/pglite`와 격리된 로컬 파일 객체 저장소(`data/objects`)로 구현 및 완전 검증을 수행하고, Vercel Preview/Production에서는 `DATABASE_URL`(`pg.Pool`) 및 분리된 환경 변수/저장소 구성을 사용하도록 구현함.

### 3. 화면별 현행 동작 기준표 (P0)
- `home` / `browse`: 검색, 필터, 정렬, 상세 보기, 찜하기(로컬) 동작
- `guide`: 작물·단계·작업 선택 → 매물 필터링 연동 동작
- `garage`: 보유 기계 등록·선택(로컬 `moa-owned-machines-v1`) 및 호환 검색 동작
- `requests`: 대여 요청 목록 표시(로컬 `moa-farm-v1`), 취소 UI 없음
- `owner`: `10jo` 계정만 데모 매물 표시, `openNewListing` 호출부 없음, 승인/거절/상태변경/문의 답장 UI 없음
- `login`: Better Auth 회원가입·로그인·로그아웃 동작 (`api/account.js`)
- `aiPanel`: `/api/recommend` 호출 및 API 키 미설정 시 규칙 기반 fallback 동작

---

## 단계별 진행 상태

- [x] **P0 기준선 확인**: 배포 상태, 환경/차단 요인, 기존 테스트(30/30) 및 빌드 확인 완료
- [x] **P1 기반 구성**: 패키지 설치(`pg`, `sharp`, `@vercel/blob`, `zod`, `@electric-sql/pglite`, `playwright`), 공용 DB 풀/트랜잭션(`server/db.js`, `server/account-auth.js`), 마이그레이터(`server/migrations/0001_initial_schema.sql`, `server/migrator.js`, `scripts/db-admin.mjs`: SHA-256 체크섬·PostgreSQL 권고 잠금·`app_meta` 환경 가드·`writes_frozen` 503 동결 및 복구), HTTP 미들웨어(`server/http.js`), 스크립트(`scripts/migrate-accounts.mjs`, `scripts/create-demo-account.mjs`, `scripts/seed-db.mjs`) 구현 및 임시 PGlite 대상 CLI(`init`/`migrate`/`seed`/`inspect`/`freeze`) 검증 완료
- [x] **P2 매물 읽기·추천**: `node:sqlite` 제거 및 PostgreSQL 기반 `fetchListings`/`fetchListingById`/`toListingDto`(`{ start, end }` 범위 + `SPEC_BY_ID[row.model_id]`) 구현(`server/listings-db.js`), 순수 `selectCandidates` 리팩터링(`server/agent.js`), 공용 로컬 앱/API 서버(`dev-server.js`, `api/listings.js`, `api/recommend.js`, `api/photos.js`) 구현 완료
- [x] **P3 찜·차고**: 세션 소유권 기반 회원 데이터(`server/validate.js`, `server/user-data.js`, `api/me.js`), 게스트 모드 유지 및 명시적 가져오기 배너(`#guestImportBanner`), `src/garage.js` · `src/main.js` `authEpoch` + `AbortController` 기반 계정 전환·늦은 응답 격리 구현 완료
- [x] **P4 매물 관리·사진**: 소유자 등록/수정/숨김/상태 변경 API+UI(`server/listings-service.js`, `api/listings.js`, `src/main.js`, `index.html`), `sharp` 매직 바이트·해상도 검증·EXIF/ICC/XMP 제거 WebP 재인코딩(`server/images.js`), 객체 저장소 어댑터 및 고아 객체 정리(`server/storage.js`, `scripts/db-admin.mjs reconcile-photos` — `removed` 매물 키 보존, 실패 시 즉시 삭제, 교체 커밋 후 이전 키 삭제), 활성 확정 예약 존재 시 `remove`/`done` `409 ACTIVE_BOOKING_EXISTS` 차단, 클라이언트 UUID 멱등성 구현 완료
- [x] **P5 대여**: server-derived 스냅숏 계산, `listings FOR UPDATE` → `rental_requests FOR UPDATE` 고정 잠금 순서 + `EXCLUDE USING gist`(`rental_requests_approved_no_overlap`) 동시 승인 배타 제어, Asia/Seoul 날짜 경계(`start_date >= kstToday()`, `kstToday() < start_date`), 비승인 겹침 요청 `derivedState: 'conflict'` 유지 및 `approvableCount` 기반 소유자 배지, 거절·취소·재승인 및 상태 전이 `200`/`409` 구분, UUID 멱등성(`server/rentals.js`, `api/requests.js`) 구현 완료
- [x] **P6 문의**: 매물×구매자 1:1 대화(`conversations`/`messages`), 소유자·구매자 수신함(`#ownerConversations`, `#buyerConversations`), `conversations FOR UPDATE` 쓰기 `seq` 직렬화 및 `seq ASC` 잠금 없는 조회·`after_seq` 폴링·`before_seq` 이전 대화 불러오기, UUID 멱등성(`server/chat.js`, `api/conversations.js`) 구현 완료
- [x] **P7 검증·Preview**:
  - **전체 테스트 (`npm run check` / `node --test tests/*.test.js`)**: **37/37 통과, 0 실패, 0 건너뜀**
    - 기존 단위 테스트 30/30 (`tests/app.test.js` 17, `tests/compatibility.test.js` 4, `tests/machine-specifications.test.js` 4, `tests/rental-dates.test.js` 5)
    - PostgreSQL 통합 테스트 6/6 (`tests/pg-integration.test.js`: 마이그레이션/체크섬/`app_meta` 환경 가드/`btree_gist`, 쓰기 동결 `503` 및 회원가입 차단/해제 복구, 이미지 검증/EXIF 제거/실패·교체 정리/`reconcilePhotos`의 `removed` 키 보존, `Promise.all` 동시 승인 레이스/`23P01`/KST 날짜 경계/취소 후 재승인/활성 예약 삭제 차단, 4개 엔드포인트 UUID 멱등성, A/B/C 권한 격리 및 채팅 `seq` 순서·페이지네이션)
    - 이중 브라우저 컨텍스트 Playwright E2E 1/1 (`tests/browser-e2e.test.js`: A/B 동시 세션, 회원가입·실사진 업로드·`/api/photos` 서빙·검색/AI 추천·찜/차고 등록 후 로그인 intent 복원·게스트 항목 명시적 가져오기·대여 승인 및 배지 갱신·1:1 채팅 양방향 송수신·새로고침 영속성·동결 중 `503` 오류 처리 및 모달 유지·미래 예약 취소·B→C 계정 전환 후 상태 완전 격리)
  - **프로덕션 빌드 (`npm run build` / `node scripts/build.mjs`)**: 통과 (`dist/ 생성 완료`)
  - **Preview 배포 및 원격 PostgreSQL 검증 차단(Blocker)**:
    - 로컬 작업 공간/시스템 환경에 격리된 Preview `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`이 없고, `%APPDATA%/com.vercel.cli/Data/auth.json`의 Vercel CLI 인증 토큰이 만료(`403 invalidToken: true`)되어 Preview 환경 변수 확인·원격 DB 마이그레이션/시드·Preview URL 배포는 실행하지 못함(운영 `main` 및 운영 DB는 지침에 따라 변경·접근하지 않음).
    - **사용자 조치 필요 항목**: Vercel CLI 재로그인(`vercel login`) 및 Preview 전용 격리 `DATABASE_URL` · `BETTER_AUTH_SECRET` · `BLOB_READ_WRITE_TOKEN` · `APP_ENV=preview` 설정 후 `npm run db:init`, `npm run db:migrate`, `npm run db:seed` 및 Preview 배포·검증 수행 가능.
