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

## AI API 연결 (농농이 · Z.ai 또는 Claude)

농농이는 Z.ai(GLM)와 Anthropic(Claude) 중 하나로 동작합니다. 로컬에서는 `.env.example`을 참고해 `.env.local`에 적습니다.

```dotenv
# Z.ai 사용 (권장 설정)
ZAI_API_KEY=your_zai_key
ZAI_MODEL=            # 선택, 글 상담 모델 · 기본값 glm-5.3
ZAI_VISION_MODEL=     # 선택, 사진 상담 모델 · 기본값 glm-5.3-flash
ZAI_BASE_URL=         # 선택, 기본값 https://api.z.ai/api/paas/v4 · GLM Coding Plan 키는 https://api.z.ai/api/coding/paas/v4

# 또는 Claude 사용
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=      # 선택, 기본값 claude-haiku-5-5

AI_PROVIDER=          # 선택: zai | anthropic. 비우면 키가 있는 쪽, 둘 다 있으면 Z.ai
```

Vercel에서는 같은 이름의 서버 환경 변수를 설정한 뒤 다시 배포합니다. 키는 브라우저 코드에 포함되지 않습니다. Z.ai는 OpenAI 호환 `chat/completions` API로 호출하며, 에이전트 코드는 `server/llm.js`가 두 공급자의 형식 차이를 맞춰 주므로 공급자를 바꿔도 동작이 같습니다.

키를 넣으면 농농이 채팅창이 `/api/agent`의 AI 도구 호출 에이전트로 동작합니다.

1. 사용자의 말에서 의도와 대상(작물, 작업, 거래 방식, 면적, 예산, 날짜, 매물)을 파악합니다.
2. 대상이나 조건이 모호하면 필요한 것만 선택지와 함께 묻습니다(`offer_choices`).
3. 매물 검색(`search_listings`)과 작물 안내(`get_crop_guidance`)처럼 읽기만 하는 작업은 바로 실행합니다.
4. 대여 요청처럼 상태를 바꾸는 작업은 모델이 직접 실행하지 못하고 `propose_rental_request`로 제안만 합니다. 채팅창이 승인 카드(매물, 기간, 총 대여료)를 보여 주고, 사용자가 승인하면 서버가 로그인한 사용자 권한으로 `createRentalRequest`를 실행합니다.
5. 실행 후 대여 요청 목록을 다시 조회해 실제 상태를 확인하고 완료(`completed`)·부분 성공(`partial`)·실패(`failed`)로 안내합니다.

`/api/recommend`의 조건 해석과 매물 한줄 요약도 같은 AI를 사용합니다. 키가 없거나 AI 호출에 실패하면 기존 규칙 기반 상담과 등록 데이터 기반 안내로 자동 전환됩니다.

## 농농이 사진 상담

채팅창의 📷 버튼으로 농기계 사진을 올리면 농농이가 기종과 상태를 추정해서 답합니다. Z.ai는 `ZAI_VISION_MODEL`(기본 `glm-5.3-flash`)을 쓰고, Claude는 같은 모델이 사진을 처리합니다.

- **빌리거나 사는 분:** 수리 질문에는 엔진 정지부터 시작하는 안전한 자가점검 단계만 안내합니다. 그래도 안 되면 수리·상담 연락처 카드(📞 전화, 🌐 사이트)로 연결합니다. 이 사진은 저장하지 않습니다.
- **빌려주거나 파는 분:** 비슷한 등록 매물로 참고가를 계산하고 소개글 초안을 씁니다. 로그인했으면 사진을 초안으로 저장하고, 「이 내용으로 매물 등록하기」로 사진·제목·소개글·가격이 채워진 등록 화면을 엽니다.
- **보험:** 사용자가 물었을 때만 농기계종합보험·농업인안전보험 개요와 가입처(지역 농협)를 안내합니다.
- **웹 검색:** `AI_WEB_SEARCH=1`일 때만 공급자 내장 웹 검색을 켭니다(기본 꺼짐).

### 지식 데이터 갱신

수리 가이드, 수리 창구, 보험 정보는 `server/knowledge/*.js`에 출처(`source`)와 확인일(`checkedAt`)을 붙여 둡니다. 전화번호와 지원 비율은 바뀔 수 있으니 **분기마다 한 번** 공식 출처를 다시 확인하고 `checkedAt`을 갱신하세요. `tests/knowledge.test.js`가 출처·확인일·전화번호 형식, 그리고 자가점검 단계에 위험한 작업(분해 등)이 없는지를 검사합니다.

## 호출 제한과 DB 타임아웃

- `/api/recommend`와 `/api/agent` 대화는 AI 비용을 막기 위해 같은 한도를 쓰며 IP당 분당 15회·하루 150회, 서비스 전체 하루 3,000회로 제한합니다. `RECOMMEND_LIMIT_PER_MINUTE`, `RECOMMEND_LIMIT_PER_DAY`, `RECOMMEND_GLOBAL_LIMIT_PER_DAY`로 바꿀 수 있고 0이면 해당 제한을 끕니다. 횟수를 확인할 수 없으면 AI를 호출하지 않고 `503`을 돌려줍니다.
- 메시지 전송(분당 30회), 매물 등록·수정(분당 20회), 대여 요청(분당 10회)은 계정 단위로 제한합니다. 한도를 넘으면 `429`와 `Retry-After`를 돌려줍니다.
- 횟수는 `rate_limits` 테이블에 저장해 모든 인스턴스가 공유하며, IP는 `BETTER_AUTH_SECRET`으로 HMAC 처리해 원래 값을 남기지 않습니다.
- 트랜잭션에는 문장 10초·잠금 대기 5초·유휴 15초 타임아웃을 적용합니다(`DB_STATEMENT_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`).
- 대여 요청은 최대 365일까지 가능합니다.
- 농농이 사진 상담에서 판매·대여용으로 올린 사진은 매물 등록 전에 초안으로 저장됩니다. 등록하지 않은 초안 사진은 `npm run db:reconcile-photos -- --env <환경> --min-age-minutes 1440`처럼 **하루(1440분) 이상** 지난 것만 정리하세요. 더 짧게 잡으면 사용자가 등록 화면을 작성하는 중에 사진이 지워질 수 있습니다.
- 이 변경은 `0002_rate_limits_and_rental_bounds.sql` 마이그레이션이 필요합니다. 배포 전에 `npm run db:migrate -- --env <환경>`을 실행하세요.

## 파일

- `src/data/farm-machines.js`: 작물, 재배 작업, 농기계 종류
- `server/listings-db.js`, `server/listing-seed.js`: SQLite 스키마와 목 데이터
- `api/listings.js`: 매물 조회 API
- `src/ai/recommend-agent.js`: 화면과 추천 API 연결
- `server/agent.js`: 서버 추천 후보 선정과 AI 호출
- `server/llm.js`: AI 호출(Z.ai·Claude 공급자 선택과 형식 변환)
- `server/nongnong-agent.js`: 농농이 도구 호출 에이전트(질문·검색·대여 제안, 승인 후 실행·상태 확인, 사진 상담)
- `server/photo-tools.js`, `server/knowledge/`: 사진 상담용 제원·수리·가격·보험 조회와 검증 데이터
- `server/listing-drafts.js`: 판매·대여 초안 사진 저장
- `src/ai/photo.js`: 사진 축소와 초안 → 등록 화면 값 변환
- `api/recommend.js`, `api/agent.js`: Vercel 함수
- `agent/`: 기존 Eve 에이전트 실험 파일. 현재 화면의 추천 API와는 별도입니다.

## 현재 범위

등록, 대여 요청, 대화, 관심 목록은 브라우저 `localStorage`에 저장되는 데모입니다. 다른 기기나 사용자와 데이터가 공유되지 않습니다. 지도 거리도 영양군 네 지역 사이의 예시값이며 GPS 실측 거리가 아닙니다. 실제 서비스에는 회원/거래자 식별, 공동 데이터베이스, 사진 저장소, 재고 동기화, 알림, 위치 권한 및 거리 계산, API 요청 제한이 필요합니다.
