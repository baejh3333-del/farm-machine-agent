# Claude 교차 리뷰 — DB 재구축 계획 (라운드 1)

- 모델: Claude Fable 5.2 (`claude-fable-5-2`, 세션 시스템 정보 기준) — 요청 모델과 일치. effort 설정값은 세션 안에서 조회할 수 없어 **확인 불가**(대체 사용 정황은 없음).
- 기준: `feature/db-rebuild`, b6a90b0. 읽기 전용 검토, 이 파일만 작성. 비밀값·원본 체크아웃 미접근.
- 방법: server/api/scripts/tests 전체와 `src/main.js` 저장·소유·요청·채팅 구간, `src/garage.js`를 직접 읽음. 제안서는 서버 코드 확인 후 나머지 소스와 같은 묶음에서 읽었고, 아래 2장은 제안서와 무관하게 코드에서 나온 것.
- 표기: **[사실]** 코드로 확인 / **[선호]** 설계 판단 / **[미검증]** 인프라·외부 사실.

## 1. 제안서 Evidence 검증 [사실]

제안서 Evidence 6항목은 모두 코드와 일치한다. 보강할 점만 적는다.

- 배포 매물 DB는 영속이 아니다. `api/listings.js:9` → `listListings()` → `initListingsDb()` 기본값 `":memory:"`(`server/listings-db.js:18`). 인스턴스마다 시드 100건을 다시 만든다. 서버에 남는 것은 Better Auth 테이블뿐이다.
- 사양 결합은 FK가 아니라 **시드 매물 id** 기준 메모리 Map이다(`listings-db.js:9, 73-76`). 사용자 등록 매물은 `modelId`가 없어 차고 호환 검색에서 빠진다(`src/data/compatibility.js:19`).
- 소유 판정은 클라이언트의 이메일 문자열 비교다(`main.js:124`). 10jo가 아닌 로그인 사용자는 소유자 화면이 항상 비어 있다.

## 2. 제안서에 빠진 흐름·사실

1. **승인/거절 UI가 현재 없다 [사실].** 커밋 8f48141이 제거했다. `owner-row-actions`가 비어 있고(`main.js:1155-1157, 1170-1172`), `state.statuses`·`state.bookings`는 읽기만 있고 쓰는 코드가 없다(`main.js:191, 194`). 요청은 영원히 `pending`이다. D4의 승인 트랜잭션은 "보존"이 아니라 **신규 기능**이다.
2. **매물 등록 폼도 도달 불가 [사실].** `openNewListing()`은 정의(`main.js:1178`)만 있고 호출부가 없다. 사진 업로드(D6)·매물 CRUD(D5)도 신규 범위다. 매물 수정·삭제·판매 상태 변경 UI 역시 없다.
3. **게스트가 대여 요청·채팅·찜·차고를 모두 쓴다 [사실].** `rentalForm`(`main.js:982-1037`), `chatForm`(`1039-1077`)에 로그인 검사가 없다. D5의 "인증된 변경"은 UX 변경이므로 제품 결정이 필요하다.
4. **채팅은 매물당 단일 스레드, 역할은 현재 화면으로 결정된다**(`main.js:1041, 1055`). 소유자는 자기 대여 매물 상세에서 대여 신청 폼이 열린다(`main.js:1832`). 서버는 자기 매물 요청·대화를 거부해야 하고, 소유자 수신함(구매자별 대화 목록)은 새 UI다.
5. **가짜 "대여 중" 5건**(`main.js:172-196`)과 과거 날짜 시드 예약(`server/listing-seed.js:5, 68`)을 걷어내면 홈 화면 인상이 달라진다. 제안서 D7은 제거만 말하고 화면 변화를 다루지 않는다.
6. **차고의 `selectedId`**(`garage.js:13-19`)가 D3 `owned_machines`에 없다. 차고는 "매물 등록과 별개"라고 UI가 명시한다(`garage.js:31`) → `listings.owned_machine_id`는 현재 UX와 충돌한다.
7. **계정 전환 누출이 이미 있다.** `renderAccount`(`main.js:1985`)는 `state.requests/messages`를 비우지 않는다. 서버화 후에도 로그인·로그아웃 시 사용자 범위 데이터를 재조회해야 한다.
8. **라우팅 이중 구현.** `dev-server.js:18-45`가 `/api/listings`, `/api/recommend`를 `api/*.js`와 별도로 다시 구현한다. 엔드포인트를 늘리기 전에 공용 핸들러 하나로 합쳐야 로컬과 Vercel이 어긋나지 않는다.
9. `agent/`(eve)는 미구현 `/internal/agent/listings`를 호출한다(`agent/tools/search_listings.ts:37`). 이번 범위에서 **제외**를 명시할 것.

## 3. D1–D10 판정

| | 판정 | 요지 |
|---|---|---|
| D1 | 수정 동의 | PG 단일화는 필요[사실: 1장]. ① Better Auth 테이블은 기존 마이그레이터(`scripts/migrate-accounts.mjs:6-7`)를 1단계로 유지하고 앱 테이블만 번호 SQL로 관리. ② 체크섬은 생략 가능, `schema_migrations` + advisory lock이면 충분[선호]. ③ 로컬 PG 확보 방법(Docker 또는 개발용 DB)을 명시 — 지금은 무설정 SQLite(`account-auth.js:52-66`). ④ Vercel에는 "배포 잡"이 없으므로 누가 언제 실행하는지 정의(6장). |
| D2 | 수정 동의 | UX·검색 로직 보존 동의. 4계층은 과하다[선호]. `server/db.js`(풀·트랜잭션) + 도메인 모듈 3~4개 + 공용 라우터면 된다. `main.js`는 `persist()`(162-170)와 `allListings()`(186-198) 경계만 분리. |
| D3 | 수정 | 4장. `profiles`, `machine_models`, `listing_images`, 작물/작업 연결 테이블, `status_events`, 별도 `reservations`, `listings.version`, `owned_machine_id`는 제거 또는 보류. |
| D4 | 수정 동의 | 핵심(대기 요청은 재고 미점유, 승인 시 원자적 확정, 견적 스냅숏) 동의. 멱등 키·낙관적 버전은 조건부 UPDATE로 대체, 예약은 요청 테이블의 부분 EXCLUDE로 통합(5.2). |
| D5 | 동의 + 보강 | 세션 기반 신원 동의. 추가: 자기 매물 요청·대화 금지, 요청 메모 길이 제한(현재 무제한 textarea, `main.js:997`), 게스트 흐름 결정(Q2). |
| D6 | 수정 동의 | 바이트는 오브젝트 스토리지 동의. 현재 스펙은 **사진 1장, 1MB, PNG/JPEG/WebP**(`main.js:1208, 1223, 267`) → `photo_url` 컬럼 하나. 1MB는 서버 함수 경유 업로드로 충분해 finalization·고아 정리 잡이 필요 없다(DB 실패 시 즉시 삭제). 매직 바이트 검사, 클라이언트 canvas 재인코딩으로 EXIF 위치 제거. |
| D7 | 수정 동의 | 자동 가져오기 금지 동의. 서버로 옮길 레거시 업무 데이터는 **없다**[사실]. 게스트 찜·차고는 로컬 유지, 로그인 시 본인 것만 멱등 병합. 로컬 매물·요청·채팅은 가져오지 않는다("데모로 저장" 고지, `main.js:1182`). |
| D8 | 동의 + 구체화 | 5.1. |
| D9 | 동의 | 커서 페이지네이션 대신 `after_id` 폴링(대화창이 열려 있을 때만). 구매자별 대화 분리 동의. |
| D10 | 수정 | P0에 제품 결정 게이트(8장) 추가. 제안서 P5 "frontend integration"을 뒤에 따로 두면 스스로 말한 수직 슬라이스와 모순 → 슬라이스마다 화면까지 연결. 권장 순서: 인프라·공용 라우터·async 전환(화면 무변경) → 매물 읽기 PG 전환 → 찜·차고 → 등록+사진 → 요청·승인 → 채팅 → 리허설·승격. |

## 4. 제안 스키마 [선호, 규모 근거: 매물 100건·필터링은 클라이언트 공용 순수 함수]

- **Better Auth 테이블**: 변경 금지. FK 타입은 `user.id`에 맞춤(TEXT로 예상 [미검증]).
- **listings**: `id TEXT PK`(시드 id `r1`, `mock-…` 유지 → 로컬 찜·테스트 호환), `owner_id FK NOT NULL`, `type`, `title`, `brand`, `machine_type`, `model_id TEXT NULL`(코드의 `SPEC_BY_ID`로 검증), `crop_ids TEXT[]`, `operations TEXT[]`, `area_min/max`, `price INT`, `region`, `condition`, `inspected_at DATE`, `included`, `pickup`, `description`, `summary`, `photo_url NULL`, `status`(open/dealing/done/removed), `is_demo`, 타임스탬프. 기존 CHECK(`listings-db.js:26-44`)를 그대로 옮긴다.
- **favorites**(user_id, listing_id) PK.
- **owned_machines**(id, user_id, model_id, name≤40, is_selected).
- **rental_requests**(id, listing_id, requester_id, start_date, end_date, note, daily_price 스냅숏, status, created_at, decided_at).
  - `CHECK (end_date >= start_date)`
  - `EXCLUDE USING gist (listing_id WITH =, daterange(start_date, end_date, '[]') WITH &&) WHERE (status = 'approved')`
  - 부분 UNIQUE(listing_id, requester_id, start_date, end_date) `WHERE status = 'pending'` — 중복 제출 방지.
- **conversations**(id, listing_id, buyer_id, UNIQUE(listing_id, buyer_id)) — 소유자는 매물에서 파생. **messages**(id 증가형, conversation_id, sender_id, body≤500, created_at).
- **schema_migrations**, **app_meta(environment)**.

상태 기계:
- 요청: `pending → approved | rejected`(소유자), `pending → cancelled`(요청자), `approved → cancelled`(시작일 전, 양쪽). 만료·완료는 **저장하지 않고 날짜로 파생**(크론 불필요).
- 매물: `open ↔ dealing → done`, `removed`(소프트 삭제). `status != 'open'`이면 대여 불가(`recommendation.js:13`와 동일).
- DTO: 기존 `booked` 배열은 "승인된 요청 중 종료일이 오늘 이후"의 날짜만, `owner`는 서버가 세션으로 계산한 불리언 → `available()`, `findCompatibleRentals()`, 화면 코드가 그대로 동작한다.

## 5. 고위험 항목

**5.1 async 전파.** 동기 호출부는 `api/listings.js:9`, `dev-server.js:22`, `server/agent.js:93`, `scripts/seed-db.mjs:5`, `tests/app.test.js:9`(모듈 최상위)·`120-166`, `tests/machine-specifications.test.js:8`. 권장: `selectCandidates(message, context, listings)`를 **순수 함수**로 바꾸고 `recommend()`만 목록을 한 번 await 한다. 기존 테스트는 `buildMockListings()` 픽스처로 DB 없이 유지되고 DB 테스트는 별도 파일로 간다. 차고도 동기 로드·저장(`garage.js:12-27`)이라 소규모 비동기 전환이 필요하다.

**5.2 예약 동시성.** 승인 트랜잭션: 매물 행 `FOR UPDATE` → 소유자 확인 → `UPDATE … SET status='approved' WHERE id=$1 AND status='pending' RETURNING`(0행이면 409, 재시도는 자연 멱등) → 겹치는 pending을 같은 트랜잭션에서 자동 거절 → COMMIT. EXCLUDE 위반(23P01)은 409로 변환한다. 불변식은 DB 제약이, 친절한 오류는 행 잠금이 담당한다. 날짜는 `DATE`, 포함 구간, "오늘"은 서버의 Asia/Seoul 기준(`main.js:34`는 서버 Date 헤더 사용). `btree_gist` 사용 가능 여부는 [미검증]. 불가하면 행 잠금 + 겹침 조회로 대체하되 모든 쓰기 경로가 같은 함수를 지나야 한다.

**5.3 인증·소유.** `api/account.js:46-55`의 Origin·Content-Type 검사를 공용 미들웨어로 올려 모든 변경 API에 적용한다. 권한은 항상 `session.user.id`와 DB의 `owner_id`/`requester_id`/대화 참여자 비교로만 판정한다. 공개 목록에는 소유자 식별자·메모·요청자 정보를 넣지 않는다. 풀은 Better Auth와 **하나를 공유**하고(`account-auth.js:45`는 `max` 미설정) 서버리스용 풀러 연결 문자열을 쓴다 [미검증].

**5.4 preview/prod 격리.** 코드는 `DATABASE_URL` 하나만 본다(`account-auth.js:39-46`). Vercel 환경 변수의 실제 스코프는 [미검증]. 요건: Preview 전용 DB·`BETTER_AUTH_SECRET`·Blob 스토어, Preview에는 `BETTER_AUTH_URL` 미설정(`account-auth.js:41`이 이를 우선하므로). 마이그레이션·시드 스크립트는 시작 시 `app_meta.environment`와 `VERCEL_ENV`(또는 명시 인자)를 대조하고, 시드는 production에서 명시 플래그 없이는 거부한다.

**5.5 데이터 가져오기.** 가져오기는 사실상 **시드**다. 시드 100건에는 소유자가 필요하다. `owner: true`인 r1·s1은 10jo(`scripts/create-demo-account.mjs:14`), 나머지 98건은 데모 소유 계정에 붙인다. 운영에 가상 매물을 둘지는 Q3.

## 6. 마이그레이션·롤백

- 첫 릴리스는 **추가 전용**(새 테이블만, 인증 테이블 무변경)이다. 롤백은 Vercel 이전 배포 재승격이고 DB는 그대로 둔다. v1에 down 마이그레이션·expand-contract 리허설은 불필요하다[선호]. 두 번째 릴리스부터 적용.
- 필수: 운영 마이그레이션 전 덤프 백업, preview DB에서 복원 1회 리허설, 운영 인증 테이블 행 수 전후 비교.
- 실행 주체: preview는 수동 또는 빌드 단계, **운영은 승격 직전 수동 게이트 명령**. 요청 시점 DDL·자동 시드 금지 동의.
- 새 클라이언트는 새 로컬 키를 쓰고 `moa-farm-v1`은 지우지 않는다(롤백 시 구 화면 유지). 롤백하면 서버에 쌓인 데이터는 구 화면에 보이지 않는다는 점을 수용 위험으로 기록.

## 7. 회귀·수용 요건

- 기존 4개 테스트 파일과 `npm run build`는 데이터 로딩 변경 외 수정 없이 통과.
- DTO 계약: 새 `/api/listings` 응답이 현재 키 집합과 `modelId/specification/demo` 결합을 유지(`tests/machine-specifications.test.js:7` 확장).
- 실제 PG 통합: **겹치는 두 요청 동시 승인 → 정확히 1건 성공**, 경계일(종료일=다음 시작일은 충돌, 하루 차이는 허용), 승인 재시도 멱등, 자동 거절, FK·트랜잭션 롤백.
- 권한 A/B/C: 남의 매물 승인·수정, 남의 대화 읽기·쓰기, 자기 매물 요청, 비로그인 변경이 모두 거부.
- 계정 전환 후 이전 사용자의 요청·찜·대화가 보이지 않음(2장 7).
- preview: 콜드 스타트 후 데이터 유지, 쿠키 로그인, 업로드, 운영 DB와 다른 DB임을 `app_meta`로 확인.
- 제안서의 E2E 목록은 과하다[선호]. 브라우저 두 컨텍스트 해피패스 1개(등록 → 요청 → 승인 → 새로고침 반영 → 대화 → 취소)와 수동 체크리스트로 줄이고, 오프라인·만료·재시도는 API 수준에서 검증.

## 8. 조정자·사용자 결정 필요

- **Q1** 매물 등록, 승인/거절, 요청 취소, 매물 상태 변경을 **신규 구현**할지(현재 UI에서 도달 불가). 권장: 구현 — 없으면 다중 사용자 사이트가 성립하지 않는다.
- **Q2** 게스트의 대여 요청·채팅. 권장: 로그인 필수, 찜·차고는 게스트 유지.
- **Q3** 운영에 데모 매물 100건과 가짜 "대여 중" 표시를 둘지.
- **Q4** 모든 로그인 사용자가 소유자 화면을 쓰는지(현재는 10jo만 데이터 표시).
- **[미검증]** PG 제공자와 `btree_gist`·풀러, Vercel 환경 변수 스코프와 요금제(함수 개수 제한 → 액션 다중화 라우트 유지), Blob 스토어 분리, Better Auth `user.id` 타입, 운영 인증 DB의 실제 사용자 수.
