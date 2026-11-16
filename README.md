# 모아농기계 웹 MVP

작물과 작업에 맞는 농기계를 대여하거나 구매하는 웹 데모입니다. 기존 단일 HTML 목업을 `index.html`, `src/`, `server/`, `api/`로 분리했습니다.

## 실행

Node.js 24 이상에서:

```powershell
npm ci
npm run dev
```

`http://localhost:3000`에서 화면과 추천 API가 함께 동작합니다. `npm run check`는 추천 후보와 응답을, `npm run build`는 Vercel용 `dist/`를 확인합니다.

개발 서버를 시작하면 `data/farm-machines.sqlite`가 생성됩니다. 서버를 띄우지 않고 DB만 준비하려면 `npm run db:seed`를 실행하세요. 같은 명령을 다시 실행해도 매물이 중복되지 않습니다.

목 데이터는 현재 카탈로그의 10개 기종별로 대여 6건과 판매 4건, 총 100건입니다. 가격·점검일·예약은 시연용입니다. 화면은 `GET /api/listings`에서 매물을 가져오며 추천 API도 같은 데이터베이스를 읽습니다. Vercel 함수에서는 동일한 시드로 메모리 SQLite를 초기화해 조회합니다.

## 계정 인증

상단 **로그인**을 열고 **회원가입**에서 이름, 이메일, 비밀번호로 가입하면 바로 로그인됩니다. 로컬에서는 첫 계정 요청 시 `data/accounts.sqlite`를 준비합니다. 로그인 상태는 서버 세션과 HTTP 전용 쿠키로 관리합니다.

Vercel 배포에서는 PostgreSQL을 연결합니다.

1. 대상 환경에 `DATABASE_URL`과 `BETTER_AUTH_SECRET`을 서버 환경 변수로 설정합니다. 비밀값은 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`로 생성할 수 있습니다.
2. 운영 환경의 `BETTER_AUTH_URL`에 서비스의 HTTPS 주소를 설정합니다. Vercel 기본 도메인을 쓰는 프리뷰는 시스템 환경 변수에서 호스트를 가져옵니다.
3. 대상 DB에 연결할 수 있는 환경에서 같은 서버 변수를 설정하고 `npm run db:accounts`를 실행해 계정 테이블을 준비한 뒤 배포합니다.

## AI API 연결

로컬에서는 `.env.example`을 참고해 `.env.local`에 다음 값을 적습니다.

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-6-luna
```

Vercel에서는 프로젝트의 서버 환경 변수 `OPENAI_API_KEY`를 설정한 뒤 다시 배포합니다. 키를 넣으면 `/api/recommend`가 OpenAI Responses API를 호출하고, 추천된 등록 매물에 대한 한줄 요약을 카드에 표시합니다. 키가 없을 때는 등록 데이터 기반 안내가 동작합니다. 키는 브라우저 코드에 포함되지 않습니다.

## 농농 대화형 에이전트 (`/api/nongnong`)

`OPENAI_API_KEY`가 있으면 채팅창이 농농 에이전트로 동작합니다. 사용자가 채팅만으로 빌리기·사기·팔기를 예약까지 끝낼 수 있습니다. 키가 없으면 기존 조건 검색 상담으로 자동 전환됩니다.

- 지침: `server/nongnong-prompt.js`
- 도구와 대화 처리: `server/nongnong.js` (매물 검색, 예약 가능 확인, 비용 계산, 날씨, 대여 예약, 구매 신청, 매물 등록)
- 예약·구매 신청·등록은 로그인한 사용자만, 그리고 사용자의 마지막 말이 긍정("네", "예약해 줘" 등)일 때만 서버가 실행합니다. 모델이 잘못 불러도 막힙니다.
- 결제는 하지 않습니다. 대여 예약은 기존 대여 요청(승인 대기)으로, 구매 신청은 판매자와의 채팅 첫 메시지로 만들어집니다.
- 보증금·연식은 매물 데이터에 없어 "판매자 확인 필요"로 안내합니다.
- 테스트: `node --test tests/nongnong.test.js`

## 호출 제한과 DB 타임아웃

- `/api/recommend`는 OpenAI 비용을 막기 위해 IP당 분당 15회·하루 150회, 서비스 전체 하루 3,000회로 제한합니다. `RECOMMEND_LIMIT_PER_MINUTE`, `RECOMMEND_LIMIT_PER_DAY`, `RECOMMEND_GLOBAL_LIMIT_PER_DAY`로 바꿀 수 있고 0이면 해당 제한을 끕니다. 횟수를 확인할 수 없으면 OpenAI를 호출하지 않고 `503`을 돌려줍니다.
- 메시지 전송(분당 30회), 매물 등록·수정(분당 20회), 대여 요청(분당 10회)은 계정 단위로 제한합니다. 한도를 넘으면 `429`와 `Retry-After`를 돌려줍니다.
- 횟수는 `rate_limits` 테이블에 저장해 모든 인스턴스가 공유하며, IP는 `BETTER_AUTH_SECRET`으로 HMAC 처리해 원래 값을 남기지 않습니다.
- 트랜잭션에는 문장 10초·잠금 대기 5초·유휴 15초 타임아웃을 적용합니다(`DB_STATEMENT_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`).
- 대여 요청은 최대 365일까지 가능합니다.
- 이 변경은 `0002_rate_limits_and_rental_bounds.sql` 마이그레이션이 필요합니다. 배포 전에 `npm run db:migrate -- --env <환경>`을 실행하세요.

## 파일

- `src/data/farm-machines.js`: 작물, 재배 작업, 농기계 종류
- `server/listings-db.js`, `server/listing-seed.js`: SQLite 스키마와 목 데이터
- `api/listings.js`: 매물 조회 API
- `src/ai/recommend-agent.js`: 화면과 추천 API 연결
- `server/agent.js`: 서버 추천 후보 선정과 AI 호출
- `api/recommend.js`: Vercel 함수
- `agent/`: 기존 Eve 에이전트 실험 파일. 현재 화면의 추천 API와는 별도입니다.

## 현재 범위

등록, 대여 요청, 대화, 관심 목록은 브라우저 `localStorage`에 저장되는 데모입니다. 다른 기기나 사용자와 데이터가 공유되지 않습니다. 지도 거리도 영양군 네 지역 사이의 예시값이며 GPS 실측 거리가 아닙니다. 실제 서비스에는 회원/거래자 식별, 공동 데이터베이스, 사진 저장소, 재고 동기화, 알림, 위치 권한 및 거리 계산, API 요청 제한이 필요합니다.
