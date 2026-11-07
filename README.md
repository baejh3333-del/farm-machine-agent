# 모아농기계 웹 MVP

작물과 작업에 맞는 농기계를 대여하거나 구매하는 웹 데모입니다. 기존 단일 HTML 목업을 `index.html`, `src/`, `server/`, `api/`로 분리했습니다.

## 실행

Node.js 24 이상에서:

```powershell
npm ci
npm run dev
```

`http://localhost:3000`에서 화면과 API가 함께 동작합니다. `npm run check`는 API와 추천 로직 테스트를, `npm run build`는 Vercel용 `dist/`를 확인합니다.

### 데이터베이스

매물, 대여 신청·예약, 채팅, 찜, 보유 농기계, 계정이 모두 하나의 PostgreSQL에 저장됩니다(설계: `docs/server-data-design.md`).

- **로컬 개발**: 따로 설치할 것이 없습니다. 개발 의존성인 PGlite(내장 Postgres)가 `data/pglite/`에 DB를 만듭니다. 처음부터 다시 시작하려면 서버를 끄고 `data/pglite/`를 지우세요. `npm run check`는 메모리 DB를 씁니다.
- **배포(Vercel)**: `DATABASE_URL`의 PostgreSQL을 씁니다. 겹치는 예약을 DB가 막도록 `btree_gist` 확장을 사용하므로, DB 계정이 이 확장을 만들 수 있어야 합니다(Neon·Supabase 등 대부분의 관리형 Postgres에서 가능).
- **테이블과 시드**: 서버가 첫 요청을 받을 때 계정 테이블(better-auth)과 앱 테이블을 만들고 시드 매물을 넣습니다. 여러 인스턴스가 동시에 떠도 한 번만 실행됩니다. 배포 전에 미리 확인하려면 같은 서버 변수를 설정하고 `npm run db:migrate`를 실행하세요. 여러 번 실행해도 결과가 같습니다.

목 데이터는 10개 기종별로 대여 6건과 판매 4건, 총 100건입니다. 가격·점검일·예약은 시연용입니다. 시드 매물 중 `r1`, `s1`은 시연 계정(아이디 `10jo`)의 것이고, 나머지 98건은 로그인할 수 없는 "데모 농가" 소유라 신청해도 승인되지 않습니다(화면에 안내). 로컬에서 `10jo`로 가입하거나 `npm run db:demo-account`로 시연 계정을 만들면 두 매물이 그 계정으로 넘어갑니다.

## 계정 인증

상단 **로그인**을 열고 **회원가입**에서 이름, 아이디, 비밀번호로 가입하면 바로 로그인됩니다. 로그인 상태는 서버 세션과 HTTP 전용 쿠키로 관리합니다. 대여 신청, 채팅, 소유자 승인·거절은 로그인해야 쓸 수 있습니다. 로그인 전에 저장한 찜과 보유 농기계는 이 브라우저에만 있다가, 로그인하면 계정으로 합쳐집니다.

Vercel 배포에서는 PostgreSQL을 연결합니다.

1. 대상 환경에 `DATABASE_URL`과 `BETTER_AUTH_SECRET`을 서버 환경 변수로 설정합니다. 비밀값은 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`로 생성할 수 있습니다.
2. 운영 환경의 `BETTER_AUTH_URL`에 서비스의 HTTPS 주소를 설정합니다. Vercel 기본 도메인을 쓰는 프리뷰는 시스템 환경 변수에서 호스트를 가져옵니다.
3. (선택) 대상 DB에 연결할 수 있는 환경에서 같은 서버 변수를 설정하고 `npm run db:migrate`를 실행하면 배포 전에 테이블과 시드를 확인할 수 있습니다. 하지 않아도 서버가 첫 요청에서 만듭니다.

## AI API 연결

로컬에서는 `.env.example`을 참고해 `.env.local`에 다음 값을 적습니다.

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-6-luna
```

Vercel에서는 프로젝트의 서버 환경 변수 `OPENAI_API_KEY`를 설정한 뒤 다시 배포합니다. 키를 넣으면 `/api/recommend`가 OpenAI Responses API를 호출하고, 추천된 등록 매물에 대한 한줄 요약을 카드에 표시합니다. 키가 없을 때는 등록 데이터 기반 안내가 동작합니다. 키는 브라우저 코드에 포함되지 않습니다.

`/api/recommend`는 OpenAI 비용을 막기 위해 호출 횟수를 제한합니다. 기본값은 IP당 분당 15회·하루 150회, 서비스 전체 하루 3,000회이며 `RECOMMEND_LIMIT_PER_MINUTE`, `RECOMMEND_LIMIT_PER_DAY`, `RECOMMEND_GLOBAL_LIMIT_PER_DAY`로 바꿀 수 있습니다(0이면 해당 제한 해제). 사용자 메시지 하나는 의도 해석과 추천 요약으로 최대 2회 호출됩니다. 한도를 넘으면 `429`와 `Retry-After`를 돌려주고, 화면은 AI 없이 규칙 기반 안내로 계속 동작합니다. `DATABASE_URL`이 있으면 횟수를 Postgres `recommend_rate_limit` 테이블(처음 호출할 때 자동 생성)에 저장해 모든 Vercel 인스턴스가 공유하고, IP는 `BETTER_AUTH_SECRET`으로 HMAC 처리해 원래 값을 남기지 않습니다. `DATABASE_URL`이 없으면 프로세스 메모리에만 세므로 로컬 개발용으로만 충분합니다. 횟수를 확인할 수 없으면 OpenAI를 호출하지 않고 `503`을 돌려줍니다.

## 파일

- `src/data/farm-machines.js`: 작물, 재배 작업, 농기계 종류
- `server/db.js`: DB 연결(배포 Postgres / 로컬 PGlite)
- `server/schema.js`, `server/listing-seed.js`: 테이블, 시드 매물, 마이그레이션
- `server/listings-db.js`, `api/listings.js`: 매물 조회
- `server/rentals.js`, `api/requests.js`: 대여 신청·승인·거절·취소
- `server/chat.js`, `api/conversations.js`: 매물 문의 채팅
- `server/user-data.js`, `api/me.js`: 찜, 보유 농기계
- `server/http.js`: API 공통 처리(세션, 같은 출처 확인, JSON 검사)
- `src/user-store.js`, `src/trade.js`: 화면의 사용자 데이터와 신청·채팅·소유자 화면
- `src/ai/recommend-agent.js`, `server/agent.js`, `api/recommend.js`: 추천(후보는 서버가 DB에서 선정)
- `server/rate-limit.js`: 추천 API 호출 제한

## 현재 범위

대여 신청·승인, 채팅, 찜, 보유 농기계는 계정에 저장되어 다른 기기에서도 이어집니다. 매물 등록·수정, 사진 저장, 알림은 아직 없습니다. 지도 거리는 영양군 네 지역 사이의 예시값이며 GPS 실측 거리가 아닙니다.
