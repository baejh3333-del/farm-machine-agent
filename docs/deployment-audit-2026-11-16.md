# GitHub · Vercel · DB 점검 (2026-11-16)

## 확인된 상태

| 대상 | 확인 결과 |
| --- | --- |
| GitHub | `baejh3333-del/farm-machine-agent`의 `main`은 `8061f838d96f47a036807ecc0c3843dffb600fbc`. PR #25에 Z.ai 지원이 이미 포함됨. |
| Vercel 운영 | Chrome 대시보드에서 `moa-farm-machines`의 운영 배포가 위 커밋과 동일하고 Ready인 것을 확인. GitHub MCP의 Vercel 상태도 success. 운영 주소는 https://moa-farm-machines.vercel.app/ |
| 작업 브랜치 | `fix/backend-hardening`, 시작 HEAD `fd484ab`. 최신 main 대비 로컬 고유 커밋 2개, 원격 고유 커밋 3개. 원격 동일 브랜치보다 15커밋 앞섬. |
| 로컬 DB | `DATABASE_URL` 미설정. `data/pglite/`의 PGlite이며 환경 표시는 development. 사용자 1명, 매물 100개. |
| 로컬 스키마 | `0001`, `0002` 적용됨. 파일과 DB의 SHA-256 체크섬 일치. `0003_agent_core.sql`은 미적용. |
| 운영 DB | 실제 접속 및 스키마 대조 미완료. 로컬 DB 검사 결과를 운영 DB 결과로 간주하면 안 됨. |

## 반영한 코드

- 최신 `origin/main`의 Z.ai/Claude 공급자 모듈, `/api/agent`, 채팅 UI 및 관련 테스트를 현재 작업 파일에 통합했다. 기존 `0003` 스키마와 DB 테스트는 보존했다.
- 변경은 커밋되지 않은 작업 파일로 남겼다. 원격 push, 운영 재배포, DB 마이그레이션은 실행하지 않았다.
- README의 SQLite/메모리 DB 설명을 PostgreSQL/PGlite 및 명시적 환경별 마이그레이션 절차로 수정했다.
- 웹 서비스의 Z.ai 설정 예시는 일반 Model API 엔드포인트로 정리했다.

## Z.ai 설정

서버 환경 변수에 다음을 설정하면 된다. API 키를 소스나 브라우저 코드에 넣지 않는다.

```dotenv
AI_PROVIDER=zai
ZAI_API_KEY=<Z.ai Model API 키>
ZAI_MODEL=glm-5.1
```

`ZAI_BASE_URL`은 생략하면 `https://api.z.ai/api/paas/v4`를 사용한다. 키가 없거나 호출이 실패하면 규칙 기반 안내로 대체된다. Vercel 환경 변수 변경 후에는 해당 환경의 재배포가 필요하다. 실제 키가 제공되지 않아 실 API 인증/응답 검증은 수행하지 않았다.

공식 API: https://docs.z.ai/api-reference/llm/chat-completion

## 검증

- `npm run build`: 통과.
- `git diff --check`: 통과.
- `npm run check`: 총 75개, 통과 70개, 실패 1개, 건너뜀 4개.
- 실패: `tests/browser-e2e.test.js:104`, 회원가입 후 `#ownerView` 표시 대기 시간 초과. 단독 재실행에서도 재현됨. 원인은 확정하지 않았다.
- 건너뜀: `TEST_DATABASE_URL` 미설정으로 실제 PostgreSQL 다중 연결 테스트 4개 미실행.
- Z.ai 공급자 선택, Bearer 인증 요청/JSON 변환, 도구 호출 왕복, 오류 폴백 테스트는 통과.

## 운영 점검의 차단 요인

Vercel MCP는 올바른 사용자 `baejh3333-6736`와 팀 `team_Laxa2gdKUioi9HceRNs19Eb6`를 반환하지만, 프로젝트 목록에 `gemini-campus-guide`, `gemini-campus-guide-ypm4`만 반환한다. `moa-farm-machines`는 이름·ID로 조회해도 404이며 팀 접근 승인 후에도 동일하다. Chrome에서는 프로젝트가 존재함을 확인했다. 사용자 요청에 따라 이후 브라우저 점검은 중단하고 MCP만 사용했다.

MCP 연결에서 이 프로젝트가 조회되도록 프로젝트 접근 범위/연결 상태 확인이 필요하다. 조회가 복구되면 다음을 확인해야 한다.

1. Production/Preview의 `DATABASE_URL`, `APP_ENV`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, `AI_PROVIDER`, `ZAI_API_KEY` 설정 여부 및 환경 분리.
2. 실제 운영 DB의 환경 표시, 적용 마이그레이션 및 체크섬. 새 `0003`은 GitHub main에도 아직 없으므로 DB 변경 전에 코드 배포 범위와 함께 검토.
3. 최신 배포의 실제 DB 조회·로그인·사진 저장·AI 요청 상태. Ready 빌드는 이러한 런타임 검증을 대신하지 않는다.
