# P0 배포 준비: Vercel 크론과 DB 마이그레이션 (2026-11-18)

기준 코드: `main` `252b45779a190ca85b97e716dab5eb1121d54b92`. 이 문서의 변경은 `baejh3333-del/p0-cron-migration` 브랜치에 있다.

## 1. 확인된 상태 (근거)

| 항목 | 확인 결과 | 근거 |
| --- | --- | --- |
| 운영에서 서비스 중인 코드 | `378950c`가 마지막으로 성공한 배포다(2026-11-17 14:32 UTC). | GitHub 커밋 상태 `Vercel success` |
| 실패한 배포 | `45152eb`(#50)과 `252b457`(#51)의 Vercel 배포가 실패했다. | GitHub 커밋 상태 `Vercel failure` |
| 실패 원인 | `vercel.json`의 `*/5 * * * *` 크론. #50에서 들어왔다. Vercel 문서: "Hobby accounts are limited to cron jobs that run once per day. Cron expressions that would run more frequently will fail during deployment." Hobby 실행 시각 정밀도는 ±59분이다. | [Vercel Cron 사용 한도](https://vercel.com/docs/cron-jobs/usage-and-pricing) (문서 갱신 2026-07-15, 2026-11-18 확인) |
| 숨어 있던 두 번째 원인 | 크론을 고친 첫 프리뷰(`c7ade7c`)는 크론 검사를 통과한 뒤 `exceeded_serverless_functions_per_deployment`로 실패했다: "No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan." #50의 `api/delegation-jobs.js`가 13번째 함수였다. | Vercel API `GET /v13/deployments/dpl_oqUWa8gvfMUzNhssyiXRikYbQmEx` `errorCode` |
| 운영 이후 추가된 마이그레이션 | `0008_education_certificates`, `0008_role_scoped_ai_state`, `0009_trade_offers`, `0010_delegation_jobs` 4개. `0010`도 포함된다. | `git diff 378950c origin/main -- server/migrations` |
| 운영 DB 적용 여부 | **확인함(읽기 전용, 2026-11-18).** 환경 표시 `production`, 쓰기 동결 꺼짐. `0001~0007` 적용(마지막은 0007, 2026-11-17 11:36 UTC), 체크섬 일치. 미적용: 위 4개. `delegation_jobs`·`trade_offers`·`education_certificates`·`listing_ai_policies` 테이블 없음. 데이터: 대화 9, 메시지 30, 대여 신청 18, 사용자 10. | `READ ONLY` 세션에서 `inspectDatabase` + `migrationReadiness`(=`db:check`)를 실행. 아무것도 쓰지 않음 |
| `CRON_SECRET` 설정 여부 | **운영·프리뷰 모두 없음.** 이대로면 하루 1회 크론도 503으로 거부된다. 트래픽 기반 스윕은 비밀이 필요 없어 동작한다. | Vercel 프로젝트 환경 변수 이름 목록(값은 읽지 않음) |
| 프리뷰 배포 | 이 브랜치 `8e7a4f2`의 Vercel 프리뷰 배포가 **성공**했다(`378950c` 이후 첫 성공). | GitHub 커밋 상태 `Vercel success` |

## 2. 코드 변경

1. **크론을 Hobby 한도 안으로 줄임.** `vercel.json`의 `/api/delegation-jobs` 크론을 `0 19 * * *`(04:00~04:59 KST 사이, 하루 1회)로 바꿨다. 이 크론은 누락 이벤트 보충(24시간 창)과 남은 작업 정리를 맡는 백스톱이다.
2. **함수 수를 12개로 유지.** 스윕 처리기를 `server/delegation-sweep-api.js`로 옮기고, `vercel.json` rewrite(`/api/delegation-jobs` → `/api/conversations?route=delegation-jobs`)로 `api/conversations.js` 함수가 받게 했다. `/api/voice`가 `api/agent.js`로 들어가는 것과 같은 방식이다. 주소와 Bearer 인증은 그대로다. `api/`가 12개를 넘으면 테스트가 실패한다.
3. **트래픽 기반 스윕 추가 (`server/delegation-kick.js`).** 채팅 화면은 대화방을 2.5~4초, 목록을 20초마다 조회한다. `GET /api/conversations`가 응답을 기다리게 하지 않고 `waitUntil` 백그라운드에서 다음을 실행한다.
   - 조회한 대화방의 만기 작업: 대화방당 10초에 1회, 최대 2건.
   - 전체 큐: 60초에 1회, 최대 3건. 만료 임대(죽은 처리기)도 회수한다.
   - 누락 이벤트 보충: 15분에 1회.
   - 횟수 판정은 기존 `rate_limits` 테이블의 행 하나를 두고 모든 인스턴스가 경쟁하는 방식이라 새 마이그레이션이 필요 없다. 같은 창은 정확히 한 요청만 연다.
   - 쓰기 동결 중에는 돌지 않는다. `DELEGATION_KICK=0`으로 끌 수 있다.
4. **마이그레이션 점검 명령 `npm run db:check`.** 읽기 전용이다. 미적용·체크섬 불일치·알 수 없는 마이그레이션·환경 미표시가 있으면 종료 코드 1을 돌려준다.
5. **스키마 미준비를 500 대신 503으로.** 없는 테이블·열(`42P01`, `42703`)은 `503 SCHEMA_NOT_READY`로 응답한다. 로그와 사용자 화면에서 원인을 구분할 수 있다.
6. `.env.example`과 README에 `CRON_SECRET`, `DELEGATION_KICK`, `db:check`를 적었다.

### 지연 시간 비교

| 상황 | 기존(5분 크론, 배포 불가) | 변경 후 |
| --- | --- | --- |
| 새 메시지에 대한 자동 응대 | 요청 직후 빠른 경로 | 동일(바뀌지 않음) |
| 일시 실패 재시도(30초·2분·10분 백오프) | 만기 후 최대 5분 | 누군가 채팅을 보고 있으면 만기 후 최대 약 10초(해당 대화방) 또는 60초(전체) |
| 아무도 접속하지 않을 때 | 최대 5분 | 다음 접속 시 즉시, 최악의 경우 다음 날 04:00 KST 크론 |
| 처리 중 인스턴스 종료 | 임대 만료(2분) 후 크론 | 임대 만료 후 다음 조회 요청 또는 크론 |

아무도 접속하지 않을 때는 자동 응대 결과를 볼 사람도 없다. 상대가 대화방을 여는 순간 그 대화방의 만기 작업이 처리되어 몇 초 안에 답이 보인다. 접속이 없어도 몇 분 안에 처리돼야 한다면 4장의 결정 C가 필요하다.

## 3. 마이그레이션 호환성 분석

4개 모두 확장형(additive)이다. `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE/INDEX IF NOT EXISTS`를 쓰고, 새 NOT NULL 열에는 기본값이 있다. `rental_requests_total_price_check`는 더 느슨한 조건으로 바뀐다. 운영 중인 `378950c` 코드는 새 열을 읽지 않으므로 **먼저 마이그레이션하고 나중에 배포해도 기존 코드가 깨지지 않는다.** 반대로 마이그레이션 없이 새 코드를 배포하면 채팅·거래·대리 응대·이수증 기능이 실패한다.

주의할 점:

- `0008_role_scoped_ai_state`는 실행 시점의 레거시 일시정지·초안을 역할별 칸으로 복사하고, 읽음 위치를 현재 seq로 맞춘다. 마이그레이션과 새 배포 사이에 옛 코드가 쓴 레거시 상태는 복사되지 않는다. 그래서 그 사이에는 쓰기를 동결한다. `378950c`도 `assertWritesAllowed`로 동결을 따른다.
- `0009`는 `rental_requests`의 CHECK 제약을 지웠다가 다시 만든다. 기존 행은 이전 제약을 이미 만족하므로 검증에 실패하지 않는다. 테이블이 크면 잠금 시간이 늘어난다.

격리 DB 검증(`tests/delegation-schedule.test.js` S8): PGlite에 `0001~0007`만 적용한 DB(마지막 운영 배포 스키마)를 만들었다. 레거시 일시정지·초안이 있는 대화와 기존 대여 신청을 넣은 뒤 `runMigrations`를 실행했다. 결과는 다음과 같다.

- 미적용 목록이 정확히 위 4개였다.
- 업그레이드 후 `db:check` 기준 ready였다.
- 레거시 일시정지·초안이 대상 역할로 옮겨졌다.
- 기존 대화는 읽음 처리되었다.
- 기존 대여 신청은 `created_via = 'human'`이 되었다.
- 새 큐와 이수증 테이블이 바로 동작했다.
- 재실행해도 아무것도 바뀌지 않았다.

같은 업그레이드를 실제 PostgreSQL 18.7에서도 실행했다. 대상은 프로젝트의 개발용 격리 DB(`TESTDB_DATABASE_URL`, Neon)에 만든 임시 스키마이고, 끝난 뒤 삭제했다. 미적용 4개가 그대로 적용되어 ready가 됐고, 레거시 상태가 옮겨졌으며, 재실행은 멱등이었다. 걸린 시간은 Better Auth 점검과 카탈로그 동기화를 포함해 약 77초이고, 대부분 한국↔us-east-1 왕복 지연이다. 같은 DB에서 연결 10개가 `acquireTick`을 동시에 호출하면 정확히 1개만 이겼다. 트래픽 스윕은 만기 작업 1건을 처리했다.

같은 격리 DB에서 평소 건너뛰던 실제 PG 테스트도 실행했다.

- `delegation-queue-pg`: 3/3 통과.
- `pg-pool-integration`: 8개 중 7개 통과. B3 실패는 잠금 없는 조회를 벽시계 100ms와 경쟁시키는 테스트가 원인으로 보인다(추정). 모든 쿼리가 한국에서 us-east-1로 가므로, 이 실패는 잠금 문제가 아니라 네트워크 지연으로 판단했다. 이번 변경과 무관해 테스트는 고치지 않았다.
- Neon `-pooler` 주소(PgBouncer 트랜잭션 모드)로는 테스트 하네스의 세션 단위 `SET search_path`가 유지되지 않아 간헐적으로 `42P01`이 난다. 실제 PG 테스트에는 `_UNPOOLED` 주소를 써야 한다.

## 4. 배포 순서 (운영 DB에 쓰는 단계는 승인 필요)

운영 DB 변경은 되돌리기 어려워 이 작업에서는 실행하지 않았다. 순서는 다음과 같다.

1. 운영 DB 백업 또는 스냅샷 확보(공급자 기능).
2. 운영 `DATABASE_URL`, `APP_ENV=production`으로 `npm run db:check`(읽기 전용). 미적용 목록을 기록한다.
3. `npm run db:freeze -- --env production --on`. 운영 화면은 변경 요청에 503 점검 안내를 보여 준다.
4. `npm run db:migrate -- --env production`.
5. `npm run db:check`가 `ready: true`인지 확인한다.
6. Vercel 운영 환경 변수에 `CRON_SECRET`(16자 이상)이 있는지 확인하고 없으면 추가한다.
7. 이 PR을 `main`에 병합 → Vercel 운영 배포가 Ready인지 확인한다.
8. `npm run db:freeze -- --env production --off`.
9. 확인: 로그인, 채팅 전송과 자동 응대, 이수증 업로드. Vercel 크론 화면에 `/api/delegation-jobs`가 하루 1회로 등록됐는지 본다.

3~8 사이 동결 시간은 마이그레이션과 배포 빌드 시간(수 분)이다.

## 5. 필요한 결정

- **A. 운영 DB 마이그레이션 실행 승인과 실행 주체.** 운영 DB에는 4개가 미적용 상태로 확인됐다. 이 작업에서는 읽기 전용 점검만 했고, 승인 없이 쓰지 않는다. 4장 1~5, 8단계를 누가 언제 실행할지 정해야 한다.
- **B. `CRON_SECRET` 운영 설정.** 현재 운영·프리뷰 모두 없다. 16자 이상 무작위 값을 Vercel 프로젝트 Production 환경 변수로 추가해야 하루 1회 백스톱 크론이 동작한다. 추가한 뒤에는 재배포가 필요하다.
- **C. 접속이 없을 때의 지연 허용 범위.** 다음 중 하나를 고른다.
  - 현재안: 트래픽 스윕과 하루 1회 크론. 비용이 없다.
  - 외부 스케줄러: GitHub Actions `schedule` 등이 5~10분마다 `Authorization: Bearer <CRON_SECRET>`로 `/api/delegation-jobs`를 호출한다. 무료지만 GitHub 일정 실행은 지연·누락이 있을 수 있고, 저장소 비밀 설정이 필요하다.
  - Vercel Pro 전환: 유료라 이 작업에서 바꾸지 않았다.
- **D. 동결 시간대.** 사용자가 적은 시간(예: 04:00 KST 전후)에 진행할지.
