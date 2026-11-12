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

Vercel에서는 서버 환경 변수 `OPENAI_API_KEY`와 `DATABASE_URL`을 설정한 뒤 다시 배포합니다. 추천 API는 PostgreSQL에 요청 수를 공유하며, 분당 IP별 12건과 전체 120건을 넘기면 HTTP 429를 반환합니다. 키가 없거나 요청 수를 확인할 수 없을 때는 등록 데이터 기반 안내가 동작합니다. 키는 브라우저 코드에 포함되지 않습니다.

## 파일

- `src/data/farm-machines.js`: 작물, 재배 작업, 농기계 종류
- `server/listings-db.js`, `server/listing-seed.js`: SQLite 스키마와 목 데이터
- `api/listings.js`: 매물 조회 API
- `src/ai/recommend-agent.js`: 화면과 추천 API 연결
- `server/agent.js`: 서버 추천 후보 선정과 AI 호출
- `api/recommend.js`: Vercel 함수
- `agent/`: 기존 Eve 에이전트 실험 파일. 현재 화면의 추천 API와는 별도입니다.

## 현재 범위

등록, 대여 요청, 대화, 관심 목록은 브라우저 `localStorage`에 저장되는 데모입니다. 다른 기기나 사용자와 데이터가 공유되지 않습니다. 지도 거리도 영양군 네 지역 사이의 예시값이며 GPS 실측 거리가 아닙니다. 실제 서비스에는 회원/거래자 식별, 공동 데이터베이스, 사진 저장소, 재고 동기화, 알림, 위치 권한 및 거리 계산이 필요합니다.
