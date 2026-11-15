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
- **실제 운영 배포(`https://moa-farm-machines.vercel.app`) — 커밋 SHA 및 DB 제공자 미확인(Unverified)**:
  - `GET /api/listings` → HTTP 200, 100건 데모 매물 반환(`modelId`, `model`, `specification`, `demo: true` 포함) 및 `GET /api/account?action=session` → HTTP 200, `{"user":null}` 응답 형식을 확인함.
  - 그러나 이 HTTP 응답 형식만으로는 **실제 배포된 커밋 SHA(`origin/main` 여부)** 나 **운영 매물·인증 DB 제공자(메모리 SQLite인지 PostgreSQL인지, 어떤 DB 호스트/브랜치인지)** 를 증명할 수 없으며, Vercel CLI 인증 토큰 만료(`403 invalidToken: true`)로 인해 배포 메타데이터·커밋 SHA·DB 제공자 확인은 **미확인(Unverified)** 상태로 남음.
- **미병합 PR #19 (`origin/feature/server-data`, `6291d2d`)**:
  - 단수형 테이블명(`listing`, `rental_request`, `booking`, `conversation`, `message`, `favorite`, `owned_machine`, `schema_meta`)을 사용한 미병합 브랜치(`origin/feature/server-data`)가 존재함(실제 원격 환경에서 활성 Preview 여부·DB 연결 대상은 Vercel CLI 만료로 미확인).
  - 본 구현은 최종 계획(`db-rebuild-plan.md`)에 따라 복수형 테이블명(`listings`, `favorites`, `owned_machines`, `rental_requests`, `conversations`, `messages`, `schema_migrations`, `app_meta`) 및 추가 전용 마이그레이션으로 구성하여 기존 Better Auth 테이블(`"user"`, `"session"`, `"account"`, `"verification"`, `"rateLimit"`)이나 다른 테이블과 충돌하지 않도록 함.
- **로컬 환경·클라우드 접근 확인 및 차단 요인(Blockers)**:
  - 작업 공간 및 시스템 환경 변수에 `DATABASE_URL`, `TEST_DATABASE_URL`, `BETTER_AUTH_SECRET`, 객체 저장소(Blob/S3) 자격 증명, `OPENAI_API_KEY`가 없음(`.env.local` 없음).
  - 로컬 Vercel CLI 인증 토큰(`%APPDATA%/com.vercel.cli/Data/auth.json`)이 만료되어(`403 invalidToken: true`) Vercel 프로젝트 환경 변수 목록·스코프·Preview 배포 명령 실행 불가.
  - 로컬 PostgreSQL 서비스(`postgres`, `pg_ctl`, `initdb`, `psql`) 및 Docker 미설치 확인.
  - **로컬 검증 범위와 한계**: 로컬 개발·통합·브라우저 E2E는 `@electric-sql/pglite`(임베디드 PostgreSQL 16 + `btree_gist`)와 로컬 파일 객체 저장소(`data/objects`)로 검증했고, `pg.Pool` 다중 연결 코드 경로(`pg_advisory_lock`, `23505` 롤백 복구, `23P01` 처리)는 하네스 테스트로 검증함. 단, **실제 다중 연결 PostgreSQL 서버(`TEST_DATABASE_URL`)** 와 **Vercel Preview 배포/DB** 는 자격 증명 부재로 미실행 상태임.

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
- [ ] **P7 검증·Preview (부분 완료 / Partial)**:
  - **실행 완료된 로컬 검증 (`npm run build`, 단위/PGlite/Playwright/`pg.Pool` 실행 경로 하네스)**:
    - 기존 단위 테스트 **30/30 통과** (`tests/app.test.js` 17, `tests/compatibility.test.js` 4, `tests/machine-specifications.test.js` 4, `tests/rental-dates.test.js` 5)
    - 로컬 PGlite(단일 커넥션 직렬화 엔진) 통합 테스트 **6/6 통과** (`tests/pg-integration.test.js`: 마이그레이션/체크섬/`app_meta` 환경 가드/`btree_gist`, 쓰기 동결 `503` 및 회원가입 차단/해제 복구, 이미지 검증/EXIF 제거/실패·교체 정리/`reconcilePhotos`의 `removed` 키 보존, 중복 대여 승인 직렬화/`23P01`/KST 날짜 경계/취소 후 재승인/활성 예약 삭제 차단, 4개 엔드포인트 UUID 멱등성 및 `userC` 0행 시작 동시 `addOwnedMachine`, A/B/C 권한 격리 및 채팅 `seq` 순서·페이지네이션)
    - `pg.Pool` 다중 연결 실행 경로 하네스 테스트 **3/3 통과** (`tests/pg-pool-integration.test.js` Suite A: `createPgPool` `max>=2` 및 `describeDatabaseTarget(pool)`, `withMigrationLock`의 non-local `pg_advisory_lock`/`unlock` 실행 및 unlock 실패 시 `client.release(true)` 연결 폐기, `READ COMMITTED` `23505` 롤백 후 재조회 복구(4개 UUID 엔드포인트), `addOwnedMachine` 부모 `"user"` 행 선잠금 순서, `sendMessage` 잠금 획득 후 재조회로 불필요한 `last_seq` 증가 방지, `approveRentalRequest` `23P01` 변환)
    - 이중 브라우저 컨텍스트 Playwright E2E **1/1 통과** (`tests/browser-e2e.test.js` — 로컬 PGlite + 로컬 파일 스토리지 대상)
    - 프로덕션 정적 빌드 (`npm run build`): 통과 (`dist/ 생성 완료`)
  - **미실행(Not Run) 및 외부 차단(Blocked) 항목**:
    - **실제 다중 연결 PostgreSQL 서버 통합 테스트 (`tests/pg-pool-integration.test.js` Suite B, B1–B4)**: `TEST_DATABASE_URL` 환경 변수 미설정(로컬 PostgreSQL/Docker 부재)으로 **4건 미실행 (`skipped`)** — 별도 백엔드 PID 간 `pg_advisory_lock` 경합, 실제 동시 트랜잭션 겹치는 대여 승인·`23P01`, 지연된 채팅 쓰기 중 잠금 없는 `after_seq` 비차단 조회, 0행 시작 동시 보유 기계 추가는 격리된 `TEST_DATABASE_URL` 제공 시 `npm run test:pg-pool`로 즉시 실행 가능.
    - **원격 Preview DB 마이그레이션/시드 및 Vercel Preview URL 검증**: 격리된 Preview `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN` 부재 및 `%APPDATA%/com.vercel.cli/Data/auth.json` 토큰 만료(`403 invalidToken: true`)로 **미실행** (운영 `main` 및 운영 DB는 지침에 따라 변경·접근하지 않음).
    - **사용자 조치 필요 항목**: 격리된 `TEST_DATABASE_URL` 설정 시 `npm run test:pg-pool`로 실제 다중 연결 PG 서버 테스트 B1–B4 실행 가능; Vercel CLI 재로그인(`vercel login`) 및 Preview 전용 `DATABASE_URL` · `BETTER_AUTH_SECRET` · `BLOB_READ_WRITE_TOKEN` · `APP_ENV=preview` 설정 후 `npm run db:init`, `npm run db:migrate`, `npm run db:seed` 및 Preview 배포·검증 수행 필요.

---

## PGlite 단일 연결 직렬화가 가리는 동작과 `pg.Pool` 다중 연결 점검·수정 내역

1. **`createPglitePool` 직렬화 특성이 가리는 동시성 차이**:
   - `server/db.js`의 `createPglitePool`은 단일 WASM PostgreSQL 인스턴스 앞에서 `connect()`마다 JS 뮤텍스(`lock()`)를 직렬화하므로, 두 요청이 `Promise.all`로 호출돼도 실제로는 첫 트랜잭션이 `COMMIT`/`RELEASE`한 뒤에야 두 번째 트랜잭션의 `BEGIN`이 시작됨.
   - 반면 실제 `pg.Pool` + PostgreSQL 서버(`READ COMMITTED`)에서는 두 커넥션이 동시에 `BEGIN`에 진입해 스냅샷 `SELECT ... FOR UPDATE`에서 0행을 동시에 보거나, 한 커넥션이 열린 잠금(advisory lock·행 잠금)을 쥔 상태에서 다른 커넥션이 블로킹/경합함.
2. **실제 `pg.Pool` 경로 점검을 통해 발견·수정한 구체적 결함 4건**:
   - **`server/db.js` (`createPgPool`, `describeDatabaseTarget`)**: `pg.Pool` 생성을 `createPgPool(connectionString, options)`로 분리해 다중 연결(`max >= 2`)을 강제하고, `describeDatabaseTarget(pool)`이 `process.env.DATABASE_URL`뿐 아니라 주입된 `pool`의 메타정보/`mode: 'pg'`를 직접 검사하도록 수정.
   - **`server/migrator.js` (`withMigrationLock`, `current_schema()`)**: 기존 `if (usesLocalDatabase() || pool.isLocal)` 조건은 `DATABASE_URL` 미설정 상태(`TEST_DATABASE_URL` 직접 풀 주입 포함)에서 실제 `pg.Pool`이어도 `pg_advisory_lock`/`unlock`을 건너뛰는 결함이 있었음 → `if (pool?.isLocal)`로 수정하고, `finally`에서 `SELECT pg_advisory_unlock($1) AS unlocked` 결과를 검사해 해제 실패·오류 시 `client.release(true)`로 오염된 세션을 풀에서 폐기하도록 보강. 격리 테스트 스키마 호환을 위해 `current_schema()` / `to_regclass('app_meta')` 사용.
   - **`server/user-data.js` (`addOwnedMachine`, `selectOwnedMachine`, `removeOwnedMachine`, `importGuestData`)**: 사용자가 보유 기계가 **0대**일 때 `SELECT ... FROM owned_machines WHERE user_id = $1 FOR UPDATE`가 0행을 잠가 두 동시 요청이 모두 `is_selected = true`로 `INSERT`해 `owned_machines_selected_one_idx` `23505` 충돌을 일으키는 문제와 `addOwnedMachine`에 `23505` 롤백 후 멱등 재조회 복구가 누락된 결함을 수정 → 트랜잭션 시작 시 부모 `"user"` 행(`SELECT id FROM "user" WHERE id = $1 FOR UPDATE`)을 선잠금하고 `addOwnedMachine` 바깥에 `23505` 복구 분기를 추가.
   - **`server/chat.js` (`sendMessage`)**: `conversations ... FOR UPDATE` 잠금을 획득한 직후 `messages`를 재조회하지 않아, 동시에 같은 `messageId`를 재시도한 두 번째 트랜잭션이 첫 커밋 뒤에도 `last_seq`를 불필요하게 증가시킨 뒤 `23505`로 롤백되던 문제를 수정 → `conversations FOR UPDATE` 직후 `findExistingMessage(..., { lock: true })` 재조회를 추가해 `last_seq` 증가와 롤백 없이 `200 idempotent: true` 반환(`23505` catch는 다중 대화 경합 방어선으로 유지).
