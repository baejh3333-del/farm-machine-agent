# 농농이 1:1 대리 채팅(자율 응대) 기획 및 구현 설계서

작성일: 2026-11-17  
대상 브랜치: `feat/catalog-research-camera-agent`  
문서 성격: 현행 에이전트·채팅 아키텍처 전수 조사 기반 기획 및 기술 설계서 (코드 미수정)

---

## 1. 현행 에이전트 및 1:1 채팅 아키텍처 전수 조사

### 1.1 `agent/` (Eve 스캐폴드) vs 실제 서비스 런타임의 관계 및 역할 차이

현재 저장소에는 두 개의 에이전트 계층이 공존하지만, **실제 웹 서비스와 연결된 것은 `api/agent.js` → `server/nongnong-agent.js` → `server/llm.js` 경로뿐**이다.

| 구분 | `agent/` (Eve 프레임워크 스캐폴드) | 실제 서비스 런타임 (`api/agent.js` 계열) |
|---|---|---|
| **진입점 / 정의** | `agent/agent.ts` (`defineAgent`, `model: "openai/gpt-6-luna-fast"`, `reasoning: "low"`, `defaultTools: false`, `tool: false`) | `src/ai/panel.js` → `src/ai/recommend-agent.js` (`askAgent`, `executeAgentAction`) → `api/agent.js` (`handle(["POST"], ...)`) |
| **핵심 로직** | `agent/instructions.md` (추천 전용 프롬프트), `agent/lib/farm-api.ts` (`farmGet`) | `server/nongnong-agent.js` (`runAgentTurn`, `runTurn`, `SYSTEM_PROMPT`, `TOOLS` 21개) |
| **LLM 어댑터** | `eve` SDK 런타임 위임 (`package.json`의 `agent:dev`, `agent:build`, `agent:info`) | `server/llm.js` (`callLLM`, `askLLMJson`, `llmProvider`, `toOpenAiMessages`, `fromOpenAiResponse`, `callAnthropic`, `callOpenAiCompatible` — OpenAI · Z.ai · Anthropic 직접 `fetch`) |
| **도구 구성** | 읽기 전용 2개 (`agent/tools/get_crop_guidance.ts`, `agent/tools/search_listings.ts`) | 읽기·쓰기 혼합 21개 (`search_listings`, `check_availability`, `check_farm_compatibility`, `get_weather`, `suggest_work_dates`, `propose_rental_request`, `create_rental_request`, `create_purchase_request`, `create_listing`, `update_listing`, `open_listing_chat`, `offer_choices` 등) |
| **연결 상태** | `agent/README.md` 명시대로 **현재 웹 앱과 미연결**. 호출 대상인 `/internal/agent/crop-guidance`, `/internal/agent/listings` 서버 엔드포인트가 아직 구현되지 않음 | 프로덕션/로컬 실제 동작 경로. `vercel.json`에서 `api/agent.js`에만 `maxDuration: 60`이 설정됨 |
| **실행·승인 모델** | 쓰기 권한 없음 (조회·비교만 담당) | 1) 대화 중 사용자 긍정 시 `runTurn()` 내 즉시 실행(로그인+정책 통과 시) 또는 `pendingAction` 반환 → 2) 사용자가 확인 카드 클릭 시 `api/agent.js` (`action: "execute"`)에서 `executeRentalRequest`, `executePurchaseRequest`, `executeListingAction`, `toggleFavorite` 실행 |

**핵심 시사점:**  
1:1 대리 채팅은 기존 `conversations`·`messages`·`listings`·`rental_requests`·`owned_machines` DB와 직접 트랜잭션을 공유해야 하므로, 미연결 상태인 `agent/` 스캐폴드가 아니라 **실제 서비스 런타임(`server/nongnong-agent.js` + `server/llm.js` + `server/chat.js`)을 확장**해 구현하는 것이 정합성과 배포 속도 측면에서 타당하다.

---

### 1.2 `0003_agent_core.sql`과 현행 `/api/agent` 상태 관리 간 갭(Gap) 분석

`server/migrations/0003_agent_core.sql`은 에이전트 영속화를 위한 6개 테이블과 2개 외래키/컬럼 확장을 정의하고 있으나, **현행 `api/agent.js`와 `server/nongnong-agent.js`는 이 스키마를 전혀 사용하지 않고 완전한 Stateless 방식으로 동작**한다.

| DB 객체 (`0003_agent_core.sql`) | 설계 의도 | 현행 `/api/agent` 실제 동작 | 갭 및 영향 |
|---|---|---|---|
| `agent_sessions` (`id`, `user_id`, `intent`, `stage`, `slots`, `last_seq`) | 서버 측 멀티턴 세션 및 슬롯 상태 영속화 | 미사용. `src/ai/panel.js`의 메모리 변수 `agentHistory` (`MAX_AGENT_HISTORY = 12`)만 유지되며 새로고침/탭 이동 시 소실 | 세션 복구·디바이스 간 이어하기 불가. 대리 채팅처럼 비동기 백그라운드 맥락 유지가 필요한 기능에 그대로 쓰기 어려움 |
| `agent_messages` (`session_id`, `seq`, `role`, `body`, `meta`) | 에이전트 대화 턴 이력 DB 저장 | 미사용. 요청마다 클라이언트가 `body.history`를 전송하면 `sanitizeHistory()`(`MAX_HISTORY = 12`)로 정제해 LLM에 전달 | 서버가 과거 대화 원문을 신뢰·감사할 수 없고, 비회원/회원 전환 시 대화 연속성 단절 |
| `agent_actions` (`kind`, `payload`, `status`, `result_id`, `expires_at`, `confirmed_at`) | `awaiting_confirm` 상태의 거래 초안을 서버에 저장·만료 관리 | 미사용. `runTurn()`이 `pendingAction` JSON을 클라이언트에 반환하고, `api/agent.js` (`action: "execute"`)가 클라이언트 페이로드를 받아 실행 | 만료 시간·단일 오픈 액션 제약(`agent_actions_one_open_idx`)이 적용되지 않음 |
| `purchase_orders` (`listing_id`, `buyer_id`, `price`, `status`, `agent_session_id`) | 구매 신청의 정식 주문 레코드 및 단일 수락 제어 | 미사용. `executePurchaseRequest()`(`server/nongnong-agent.js`)가 `sendChatMessage()`를 호출해 `conversations`/`messages`에 `[농농 구매 신청] ...` 채팅 메시지를 남김 | 구매 신청 상태(`pending`/`accepted`/`rejected`)를 별도 테이블로 추적하지 못하고 채팅 메시지에 의존 |
| `agent_tool_calls` (`session_id`, `tool`, `args`, `result`, `ok`, `latency_ms`, `model`, `input_tokens`, `output_tokens`) | 도구 호출 감사 로그, 지연 시간 및 토큰 비용 추적 | 미사용. `callLLM()` 실패 시 `console.warn("llm_request_failed", diagnostic)`만 출력 | 대리 채팅 자율 실행 시 장애 원인·비용·판단 근거(audit trail) 추적이 불가능하므로, 대리 채팅 도입 시 로깅 연계 또는 별도 감사 기록 필요 |
| `farm_profiles` (`user_id`, `region`, `crop_ids`, `area_pyeong`, `notes`) | 농가 프로필(작물·면적·특이사항) 영속화 | 미사용. `cleanUiContext()`로 매 요청 UI 필터(`region`, `areaPyeong`, `ownedModelId`)를 전달받고, 보유 기계만 `owned_machines`(`server/user-data.js`)에서 조회 | 대리 채팅에서 소유자/구매자의 농장 특이사항(예: "트럭 상차 불가", "주말만 가능")을 활용하려면 위임 정책(`policy`) 또는 `farm_profiles` 연계 필요 |
| `rental_requests.agent_session_id`, `listings.source` | 에이전트 경유 대여/등록 추적 | `createRentalRequest()`, `createListing()` 호출 시 해당 컬럼을 채우지 않고 기본값(`NULL`, `'form'`)으로 저장 | 에이전트 기여도·전환율 측정 불가 |

---

### 1.3 `conversations` + `messages` 기반 1:1 채팅 동작 원리

1:1 채팅은 `0001_initial_schema.sql`의 `conversations`·`messages` 테이블과 `server/chat.js`, `api/conversations.js`, `src/views/transactions.js`로 구성된다.

1. **데이터 모델 (`server/migrations/0001_initial_schema.sql`)**
   - `conversations`: `(listing_id, buyer_id)` 복합 `UNIQUE` 제약을 가지며 매물×구매자 쌍당 1개의 대화방만 생성된다. `last_seq`로 메시지 순번을 관리한다.
   - `messages`: `id` (UUID PK), `conversation_id`, `sender_id`, `seq` (`UNIQUE(conversation_id, seq)`), `body` (1~500자).
2. **쓰기 직렬화 및 멱등성 (`server/chat.js` `sendMessage`)**
   - `messageId`(클라이언트 생성 UUID)를 기준으로 트랜잭션 시작 직후 `findExistingMessage(client, messageId, { lock: true })`로 중복 재시도 여부를 확인한다.
   - 대화방이 지정된 경우 `SELECT * FROM conversations WHERE id = $1 FOR UPDATE`로 행 잠금을 획득하고, 매물 ID로 첫 문의를 시작하는 경우 본인 매물 문의 차단(`SELF_INQUIRY_FORBIDDEN`) 후 `INSERT ... ON CONFLICT (listing_id, buyer_id) DO NOTHING` → `SELECT ... FOR UPDATE` 순으로 잠근다.
   - `READ COMMITTED` 격리 수준에서 동시 동일 UUID 재시도로 `last_seq`가 헛증가하는 것을 막기 위해 `FOR UPDATE` 획득 직후 `findExistingMessage(..., { lock: true })`를 한 번 더 검사한다.
   - 이후 `UPDATE conversations SET last_seq = last_seq + 1, updated_at = now() ... RETURNING last_seq`로 `seq`를 발급하고 `messages`에 삽입한다.
3. **조회 및 API (`api/conversations.js`, `server/chat.js`)**
   - `GET /api/conversations`: `conversationId` 또는 `listingId`가 있으면 `getConversationMessages()`를 호출해 `after_seq`(증분 폴링용, `seq > $2 ORDER BY seq ASC`) 또는 `before_seq`(과거 내역 로드용, `seq < $2 ORDER BY seq DESC`)로 잠금 없이 조회한다. 파라미터가 없으면 `listConversationsForUser()`로 내가 구매자이거나 매물 소유자인 대화방 목록을 `LATERAL` 조인으로 마지막 메시지와 함께 반환한다.
   - `POST /api/conversations`: `assertWritesAllowed()` → `enforceRateLimit(request, "message", { userId: user.id })` → `action === "send"` 검증 → `sendMessage()` 호출 → 비멱등 신규 메시지이고 `body.recipientPhone`이 있으면 `notifyAlimtalkSafe()` 발송.
4. **프론트엔드 폴링 (`src/views/transactions.js` `chatForm`)**
   - `openForm()`으로 대화 모달을 열면 `stopChatPolling()`으로 기존 타이머를 정리한 뒤 `loadInitialMessages()`로 최근 50건을 불러온다.
   - 이후 `startPolling()`에서 `setInterval(pollNewMessages, 2500)`(2.5초 주기)으로 `after_seq=${maxSeq()}`를 폴링해 새 메시지가 오면 `bySeq` Map에 병합하고 `renderChat()`을 호출한다.
   - `runtime.authEpoch` 비교와 모달 숨김(`$("formBackdrop").hidden`) 체크로 계정 전환·모달 종료 시 늦은 응답을 무시한다.

---

## 2. 농농이 1:1 대리 채팅(자율 응대) 상세 기획

### 2.1 핵심 사용자 시나리오

1. **구매자(대여자) 측 위임 시나리오**
   - *사용자 요청*: "이 매물 소유자한테 이번 주 토요일 오전 인수 가능한지, 로터리 작업기 포함인지, 우리 마을까지 운반해 줄 수 있는지 농농이가 대신 물어보고 조율해 줘."
   - *동작*: 농농이 메인 패널(`src/ai/panel.js`) 또는 1:1 채팅 모달에서 구매자가 대리 응대를 켜고 위임 지침(희망 일정, 필요 작업기, 운반 요청 여부 등)을 설정하면, 농농이가 첫 문의 메시지를 작성·전송(`copilot`이면 초안 확인 후 전송, `autonomous`면 즉시 전송)한다.
   - *연속 응대*: 소유자가 답장하면(예: "토요일 오전 10시 가능하고 로터리는 포함인데 운반은 직접 오셔야 해요") 농농이가 맥락과 구매자 위임 조건(예: "직접 인수 가능, 10시 OK")을 대조해 자동으로 후속 조율 답장을 보내거나, 조건이 어긋나면(예: 운반 불가인데 구매자가 운반 필수 조건을 건 경우) 구매자에게 판단을 요청한다.
2. **소유자(판매자) 측 위임 시나리오**
   - *사용자 요청*: "내가 농작업 중이라 바쁠 때 문의 채팅이 오면, 농농이가 내 매물 정보·예약 캘린더·위임 규칙을 보고 알아서 답장해 줘."
   - *동작*: 구매자가 문의를 보내면 서버가 소유자의 `owner_ai_mode`를 확인한다. `autonomous`인 경우 농농이가 해당 매물의 `description`·`included`·`pickup`·`price`·`rental_requests`(확정 예약 일정)·`get_weather`(해당 지역 기상) 및 소유자의 `owner_ai_policy`(예: "오전 8시~오후 5시 직접 인수만 가능, 운반 불가, 가격 흥정 불가")를 조회해 즉시 답변한다.
   - *연속 응대*: 구매자가 다시 날짜를 바꾸거나 부착기 호환성을 물으면 농농이가 실시간 DB 예약 현황과 기종 제원을 재확인해 연속으로 응대한다.

### 2.2 위임 정책 (Guardrails & Delegation Scope)

#### A. 대화방별 모드 선택 (`off` | `copilot` | `autonomous`)
- **`off` (기본값)**: 기존과 동일한 수동 1:1 채팅.
- **`copilot` (초안 확인 후 전송)**: 상대방의 인간 메시지(`sender_kind = 'human'`)가 도착하면 농농이가 답변 초안만 생성해 채팅창 상단/입력창에 제안한다. 사용자가 `[보내기]` 또는 `[수정 후 보내기]`를 눌러야 실제 `messages`에 전송된다.
- **`autonomous` (자동 전송)**: 위임 범위 내 질문이고 확신도(`ai_confidence`)가 `high` 또는 `medium`이며 에스컬레이션 사유가 없을 때 즉시 `sender_kind = 'ai_proxy'` 메시지로 전송한다.

#### B. 허용 주제 vs 금지·에스컬레이션 주제
정책은 `conversations.buyer_ai_policy` / `owner_ai_policy` (JSONB)에 구조화해 저장한다.

| 구분 | 허용 주제 (자율 응대 가능) | 금지 / 즉시 에스컬레이션 주제 (자동 전송 금지) |
|---|---|---|
| **소유자(판매자) 측** | - 등록된 사양·포함 작업기(`included`)·픽업 조건(`pickup`) 안내<br>- `rental_requests` 기반 빈 날짜 확인 및 일정 조율<br>- 날씨 예보 기반 작업 적합일 안내<br>- 보유 농기계/면적 호환성 일반 안내(`check_farm_compatibility`)<br>- 위임 지침에 명시된 인수 시간대·장소(면/리 수준) 조율 | - **가격 할인·흥정 임의 수락** (정책에 `allowNegotiation: true` 및 하한가가 명시되지 않은 경우 무조건 에스컬레이션)<br>- **하자 보증·안전/법적 책임 확약** ("고장 안 납니다", "수리비 제가 냅니다" 등)<br>- **최종 대여 승인(`approve`)·결제·거래 확정**<br>- **상세 주소(지번/도로명)·전화번호·계좌번호 등 개인정보 임의 공개**<br>- 매물 설명에 없는 실물 상태(최근 엔진 수리 이력, 누유 여부 등) 단정 |
| **구매자(대여자) 측** | - 희망 작업 일정·인수 가능 시간 조율<br>- 보유 본체 모델(`owned_machines`)·작업 면적·필요 작업기 전달<br>- 운반 가능 여부·인수 방식 문의<br>- 조건 합의 시 `propose_rental_handoff`로 대여 요청 카드 제안 | - **위임 조건을 벗어난 추가 비용/보증금 수용 확약**<br>- **실제 대여 요청(`create_rental_request`) 및 결제 최종 제출** (반드시 사람이 버튼 클릭으로 승인)<br>- 현장 방문/계약 변경 등 금전적 책임이 따르는 약속 |

### 2.3 무한 루프 및 핑퐁 방지 설계

양측 모두 `autonomous` 모드를 켠 대화방에서 AI끼리 끝없이 인사하거나 재확인하는 루프를 원천 차단해야 한다.

1. **메시지 발신 주체 구분 (`messages.sender_kind`)**
   - `'human'`: 실제 사용자가 직접 입력해 보낸 메시지.
   - `'ai_proxy'`: 농농이가 사용자를 대리해 보낸 메시지.
   - `'system'`: 정지/에스컬레이션/조건 요약/대여 제안 카드 등 시스템 안내 메시지.
   - **원칙**: `'system'` 메시지는 절대 AI 자동 응대를 트리거하지 않는다.
2. **연속 AI 턴 상한 (`ai_consecutive_turns`, 기본 상한 `MAX_CONSECUTIVE_AI_TURNS = 4`)**
   - `'human'` 메시지가 저장되면 `ai_consecutive_turns = 0`으로 초기화한다.
   - `'ai_proxy'` 메시지가 저장될 때마다 `ai_consecutive_turns`를 `+1` 증가시킨다.
   - `ai_consecutive_turns >= maxTurns`에 도달하면 더 이상 자동 응대를 실행하지 않고, `ai_paused_reason = 'max_turns_reached'`로 설정한 뒤 `'system'` 요약 메시지를 남기고 정지한다.
3. **양측 AI 동시 활성(AI-to-AI) 조율 제한**
   - 수신 측이 `autonomous`이면서 발신 직전 메시지도 `ai_proxy`인 경우(즉, AI끼리 주고받는 턴), 최대 2회 왕복(총 `ai_consecutive_turns = 4`) 이내에 합의(예: 일정·인수 시간 확정)에 도달하지 못하거나 합의에 도달한 즉시 **`propose_rental_handoff` 또는 핵심 조건 요약 `'system'` 메시지를 생성하고 `ai_paused_reason = 'both_ai_handoff'`로 자동 정지**한다.
   - 정지 시 양쪽 사용자에게 "농농이끼리 핵심 조건을 정리했어요. 확인 후 대여 요청이나 답장을 진행해 주세요." 배너를 노출한다.
4. **쿨다운(`ai_last_run_at`) 및 동시 실행 락**
   - 동일 대화방에서 `ai_last_run_at`으로부터 최소 쿨다운(예: 10초) 이내 중복 트리거를 방지하고, `reply_to_seq`와 멱등성 키를 통해 동일 `seq`에 대한 이중 응답을 차단한다.

### 2.4 확신 부족 및 민감 질문 시 에스컬레이션

- LLM이 도구 실행 후 답변을 생성할 때 자체 확신도(`ai_confidence`: `'high' | 'medium' | 'low'`)와 에스컬레이션 여부를 판단하도록 강제한다.
- 다음 중 하나에 해당하면 **`send_proxy_reply` 대신 `escalate_to_owner`(또는 구매자 측 `escalate_to_user`) 도구를 호출**한다:
  1. 상대방이 가격 할인·흥정, 보증/수리 책임, 상세 주소·연락처를 요구함.
  2. 매물 정보·예약 캘린더·위임 지침에 없는 사실(예: "타이어 트레드 몇 % 남았나요?", "트레일러 상차 발판 있나요?")을 물음.
  3. `ai_confidence === 'low'`이거나 프롬프트 인젝션 의심 발화가 감지됨.
- 에스컬레이션 발생 시:
  - 상대방에게는 **임의의 추측 답변을 보내지 않는다**(또는 필요 시 "담당 농가 확인이 필요한 내용이라 확인 후 안내드리겠습니다" 수준의 최소 안내만 정책에 따라 선택).
  - 대화방 상태를 `ai_paused_reason = 'escalated:<사유코드>'`로 전환하고, `messages`에 `sender_kind = 'system'`, `escalation_reason`이 담긴 안내 레코드를 기록해 위임자 화면에 즉시 배너와 알림톡(`notifyAlimtalkSafe`)을 띄운다.

---

## 3. 구현 방식 및 아키텍처 설계 (Vercel Serverless + PostgreSQL)

### 3.1 DB 스키마 변경안 (`server/migrations/0004_delegated_chat.sql`)

기존 `0001_initial_schema.sql`의 `conversations`, `messages`에 추가 전용(additive) 컬럼과 인덱스를 부여한다.

```sql
-- 0004_delegated_chat.sql: 1:1 대리 채팅 위임 정책·상태 및 메시지 발신 주체 확장

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS buyer_ai_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (buyer_ai_mode IN ('off', 'copilot', 'autonomous')),
  ADD COLUMN IF NOT EXISTS owner_ai_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (owner_ai_mode IN ('off', 'copilot', 'autonomous')),
  ADD COLUMN IF NOT EXISTS buyer_ai_policy JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS owner_ai_policy JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_consecutive_turns INTEGER NOT NULL DEFAULT 0
    CHECK (ai_consecutive_turns >= 0),
  ADD COLUMN IF NOT EXISTS ai_paused_reason TEXT,
  ADD COLUMN IF NOT EXISTS ai_last_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_draft_json JSONB;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_kind TEXT NOT NULL DEFAULT 'human'
    CHECK (sender_kind IN ('human', 'ai_proxy', 'system')),
  ADD COLUMN IF NOT EXISTS ai_confidence TEXT
    CHECK (ai_confidence IS NULL OR ai_confidence IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS reply_to_seq INTEGER,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT;

-- 동일 대화방의 특정 seq에 대한 AI 대리 응답이 중복 생성되지 않도록 부분 유니크 인덱스 부여
CREATE UNIQUE INDEX IF NOT EXISTS messages_ai_reply_once_idx
  ON messages (conversation_id, reply_to_seq, sender_id)
  WHERE sender_kind = 'ai_proxy' AND reply_to_seq IS NOT NULL;
```

**설계 포인트:**
- `conversations.ai_draft_json`: `copilot` 모드에서 생성된 초안(`{ targetUserId, replyToSeq, body, confidence, suggestedHandoff, createdAt }`)을 저장해 두면, 사용자가 창을 닫았다가 다시 열거나 다른 기기에서 접속해도 초안을 그대로 확인·전송할 수 있다.
- `messages_ai_reply_once_idx`: `(conversation_id, reply_to_seq, sender_id)` 부분 유니크 인덱스를 DB 레벨에 두어, 애플리케이션 락 외에 최후의 방어선으로 동일 메시지(`reply_to_seq`)에 대한 AI 중복 발송을 원천 차단한다.
- `buyer_ai_policy` / `owner_ai_policy` JSONB 권장 구조:
  ```json
  {
    "instructions": "토요일 오전 9시~12시 직접 인수만 가능. 운반 불가. 가격 흥정 정중히 거절.",
    "allowNegotiation": false,
    "minPrice": null,
    "allowDelivery": false,
    "preferredPickupWindow": "09:00-17:00",
    "maxConsecutiveAiTurns": 4,
    "autoReplyOn": ["schedule", "spec", "availability", "compatibility", "weather"]
  }
  ```

---

### 3.2 실행 트리거 및 비동기 처리 (Vercel Serverless 환경 고려)

Vercel Serverless 함수는 HTTP 응답을 반환한 뒤 이벤트 루프가 동결되므로, **단순 `Promise` fire-and-forget은 실행 중간에 중단될 위험**이 있다. 이를 해결하기 위해 다음 이중 구조를 채택한다.

1. **트리거 지점 (`POST /api/conversations` → `server/chat.js` `sendMessage`)**
   - 사용자(또는 `ai_proxy`)가 메시지를 커밋하면, 수신 측(`recipientRole`: 발신자가 `buyer`면 `owner`, `owner`면 `buyer`)의 `ai_mode`를 확인한다.
   - `ai_mode IN ('autonomous', 'copilot')`이고 `ai_paused_reason IS NULL`이며 `sender_kind !== 'system'`이면 **대리 응답 실행 대상**으로 판정한다.
   - `sendMessage()`가 `human` 메시지를 커밋할 때는 트랜잭션 내에서 `ai_consecutive_turns = 0`, `ai_paused_reason = NULL` (인간이 직접 개입해 응답했으므로 일시정지 해제)으로 리셋한다.
2. **비동기 실행 경로 (Vercel Fluid Compute `waitUntil` + 전용 엔드포인트 폴백)**
   - **경로 A (권장 — `waitUntil` 비동기 백그라운드)**: `api/conversations.js`에서 `@vercel/functions`의 `waitUntil()`을 사용해 `runDelegatedChatReply({ conversationId, triggerSeq, targetRole })`를 비동기로 실행한다. 클라이언트는 `POST /api/conversations` 응답(201 Created)을 즉시 받고, 기존 `chatForm`의 2.5초 폴링(`GET /api/conversations?after_seq=...`)이 AI 응답(`ai_proxy`)이나 초안(`ai_draft_json`)을 자동으로 수신한다.
   - **경로 B (전용 트리거 엔드포인트 `/api/agent-chat-reply`)**: `vercel.json`에 `"api/agent-chat-reply.js": { "maxDuration": 60 }`을 추가한다. `copilot` 모드에서 사용자가 "초안 다시 만들기"를 누르거나, `waitUntil` 타임아웃/미지원 환경(로컬/특수 런타임)에서 프론트엔드가 트리거하거나, 내부 서명 토큰(`INTERNAL_AGENT_SECRET`)으로 비동기 호출할 때 사용한다.
3. **동시성 제어 및 멱등성 (`ai-reply:<conversationId>:<triggerSeq>`)**
   - `runDelegatedChatReply` 시작 시 DB에서 `pg_try_advisory_xact_lock(hashtext(conversationId || ':' || triggerSeq))` 또는 `SELECT ... FROM conversations WHERE id = $1 FOR UPDATE`로 락을 잡는다.
   - 락 획득 후 다음 사전 조건을 재검증한다(하나라도 불만족 시 즉시 종료):
     1. 해당 `triggerSeq`가 여전히 최신 메시지이거나, 그 이후 인간 메시지가 아직 처리되지 않았는가?
     2. `messages`에 `(conversation_id, reply_to_seq = triggerSeq, sender_id = targetUserId, sender_kind = 'ai_proxy')`가 이미 존재하는가? (멱등성 키 `ai-reply:<conversationId>:<triggerSeq>` 기반 결정론적 UUID 또는 `messages_ai_reply_once_idx` 활용)
     3. `ai_paused_reason IS NULL`이고 `ai_consecutive_turns < maxTurns`이며 `ai_last_run_at` 쿨다운을 지났는가?
   - **LLM 호출 중 DB 락 점유 금지**: 사전 검증 후 트랜잭션을 닫고 LLM + 읽기 도구(`get_listing_context`, `check_availability` 등)를 실행한 뒤, 최종 메시지 삽입 시점에만 다시 `conversations FOR UPDATE` 트랜잭션을 열어 `last_seq`와 `reply_to_seq`를 커밋한다(커밋 시점에 `last_seq > triggerSeq`로 인간이 이미 먼저 답장했다면 AI 응답을 폐기해 어색한 뒷북 답장을 방지한다).

---

### 3.3 대리 채팅 전용 LLM Tool Set 설계

기존 `server/nongnong-agent.js`의 `TOOLS`(21개)는 일반 검색·매물 등록·사진 상담용이므로, 대리 채팅에서는 **권한이 축소되고 위임 안전장치가 내장된 전용 Tool Set(7개)**을 사용한다.

| 도구명 | 역할 및 입출력 | 권한 / 가드레일 |
|---|---|---|
| `get_listing_context` | 대상 매물의 상세 정보(`title`, `type`, `price`, `region`, `condition`, `included`, `pickup`, `description`, `modelId`, `SPEC_BY_ID`)와 대화 상대/위임자 정보 조회 | 읽기 전용. 비공개/삭제 매물 차단 |
| `check_availability` | 기존 `checkAvailabilityTool` 재사용. `rental_requests`의 `approved` 구간과 대여 희망일 충돌 여부 및 가장 가까운 빈 기간 반환 | 읽기 전용. KST 기준 날짜 검증 |
| `get_weather` | 기존 `server/weather.js` 연계. 해당 지역·희망 날짜의 기상 예보 및 농작업 적합도/대안 날짜 반환 | 읽기 전용 |
| `check_farm_compatibility` | 기존 `checkFarmCompatibilityTool` 재사용. 구매자의 `owned_machines`·작업 면적과 매물의 `area_min`~`area_max`, `included` 작업기 호환성 검사 | 읽기 전용 |
| `send_proxy_reply` | 대리 답변 텍스트(`body`, 최대 500자), `confidence` (`high`\|`medium`\|`low`), 근거 요약(`rationale`) 전달 | `autonomous` 모드이고 `confidence !== 'low'`일 때만 `messages`(`sender_kind = 'ai_proxy'`)로 저장. `copilot` 모드면 `conversations.ai_draft_json`에 저장 |
| `propose_rental_handoff` | 합의된 시작일(`start`), 반납일(`end`), 예상 금액, 메모(`note`)를 담아 채팅방에 **대여 요청 확인 버튼 카드**(`sender_kind = 'system'`)를 생성 | **절대 `createRentalRequest`를 직접 호출하지 않음**. 실제 요청·승인은 구매자/소유자가 버튼을 눌러 확정 |
| `escalate_to_owner` | 확신 부족, 가격 흥정, 하자 보증, 위임 범위 초과 시 호출. `reasonCode`, `summaryForUser`, `suggestedReplyDraft` 전달 | `conversations.ai_paused_reason` 설정 + `system` 에스컬레이션 배너 기록 + 위임자에게 알림톡/인앱 알림 발송 |

> **참고**: 구매자 측 위임 시에도 동일한 `escalate_to_owner` 도구를 역할 중립적 이름(예: `escalate_to_user`)으로 통합하거나, `targetRole`에 따라 알림 수신자를 자동 분기하도록 구현하면 도구 중복을 없앨 수 있다.

---

### 3.4 UI/UX 설계

1. **1:1 채팅 모달 (`src/views/transactions.js` `chatForm`) 확장**
   - **상단 대리 응대 컨트롤 바**:
     - `🤖 농농이 대리 응대` 스위치 + 모드 선택 세그먼트(`끄기` / `초안 확인` / `자동 응대`).
     - 위임 조건 빠른 설정 칩: `[인수 시간 조율]` `[작업기·호환성 안내]` `[빈 날짜 확인]` `[가격 흥정 거절]` + 한 줄 위임 지침 입력란.
   - **메시지 버블 구분**:
     - `sender_kind === 'ai_proxy'`: 발신자 이름 옆에 `🤖 AI 대신 답변` 배지 표시. (상대방에게도 AI가 대리 응답했음을 투명하게 고지)
     - `sender_kind === 'system'`: 가운데 정렬 카드형 안내(에스컬레이션 알림, AI-to-AI 조건 요약, `propose_rental_handoff`의 `[이 조건으로 대여 요청하기]` 원탭 버튼).
   - **에스컬레이션 배너**:
     - `conversation.aiPausedReason`이 존재할 때 채팅 로그 하단에 경고 배너 표시:  
       *"농농이가 확인이 필요해 답변을 멈췄어요 (사유: 가격 할인 요청). 직접 답장하시면 대화가 이어집니다."* + `[다시 자동 응대 켜기]` 버튼.
   - **Copilot 초안 확인 바**:
     - `conversation.aiDraftJson`이 존재하고 내가 대상자일 때 입력창 위에 초안 미리보기 카드 표시: `[이대로 보내기]` · `[입력창에 불러와 수정]` · `[무시]`.
2. **농농이 메인 패널 (`src/ai/panel.js`) 원클릭 연결**
   - 기존 `renderChatTargetCta()`(`💬 소유자와 1:1 채팅 열기`) 옆 또는 채팅 열기 시 옵션으로 `🤖 이 매물 대리 채팅 맡기기` 버튼 제공.
   - 클릭 시 농농이 패널에서 이미 파악한 조건(희망 날짜, 작업 면적, 보유 기종, 운반 필요 여부)을 `buyer_ai_policy`에 자동 채워 대화방 모달을 열고 즉시 위임 모드를 활성화한다.
3. **대화 목록(`#ownerConversations`, `#buyerConversations`) 배지**
   - 각 대화방 카드에 `🤖 대리 중` 또는 `⚠️ 확인 필요(에스컬레이션)` 상태 배지를 표시해 소유자가 바쁜 중에도 개입이 필요한 방만 즉시 찾을 수 있게 한다.

---

### 3.5 단계별 구현 로드맵 (P1 ~ P4)

| 단계 | 목표 | 주요 작업 파일 | 완료 기준 |
|---|---|---|---|
| **P1: DB 스키마 & 채팅 코어 확장** | 대리 채팅 상태/정책 영속화 및 `sender_kind` 구분 | `server/migrations/0004_delegated_chat.sql`, `server/chat.js`, `api/conversations.js` | `conversations`/`messages` DTO에 AI 모드·정책·`sender_kind` 반영, 위임 설정 업데이트 API(`action: "update_ai_policy"`) 동작, 기존 채팅 테스트 전부 통과 |
| **P2: 대리 채팅 에이전트 & 가드레일 엔진** | 전용 7개 도구, 무한루프/에스컬레이션 로직, 비동기 트리거 | `server/delegated-chat.js` (신규), `api/agent-chat-reply.js` (신규), `vercel.json` | Mock LLM 기준 `autonomous`/`copilot`/에스컬레이션/AI-to-AI 정지/동시성 멱등성 단위·통합 테스트 통과 |
| **P3: 프론트엔드 UI/UX 연동** | 1:1 채팅 모달 제어 UI, 초안 바, 에스컬레이션 배너, 패널 연동 | `src/views/transactions.js`, `src/ai/panel.js`, `index.html`, 스타일시트 | 2.5초 폴링으로 AI 응답·초안·에스컬레이션 배너 실시간 반영, 원클릭 대리 채팅 맡기기 동작 |
| **P4: E2E 검증 & Preview 배포** | 실제 다중 연결 PG 및 이중 브라우저 E2E 검증 | `tests/pg-integration.test.js`, `tests/pg-pool-integration.test.js`, `tests/browser-e2e.test.js` | PGlite/PG Pool 동시성 테스트 및 Playwright 2인 브라우저 시나리오 통과 |

---

### 3.6 테스트 전략

1. **PGlite / `pg.Pool` 동시성 & 멱등성 테스트**
   - 동일 `triggerSeq`에 대해 `runDelegatedChatReply`를 동시에 2회 호출했을 때 `messages_ai_reply_once_idx` 또는 락에 의해 정확히 1건의 `ai_proxy` 메시지만 생성되는지 검증.
   - LLM 호출 중 인간이 먼저 답장을 커밋한 경우(`last_seq > triggerSeq`), 뒤늦게 끝난 AI 응답이 커밋되지 않고 안전하게 폐기되는지 검증.
2. **무한 루프 & AI-to-AI 핑퐁 방지 테스트**
   - 구매자·소유자 양측 모두 `autonomous`로 설정하고 첫 인간 메시지를 보냈을 때, `ai_consecutive_turns`가 상한(예: 4턴)에 도달하면 `ai_paused_reason = 'both_ai_handoff'`(또는 `'max_turns_reached'`)로 전환되며 더 이상 LLM을 호출하지 않는지 검증.
   - `sender_kind = 'system'` 메시지 삽입 시 트리거가 발화하지 않는지 검증.
3. **에스컬레이션 & 가드레일 테스트**
   - "가격 20% 깎아주세요", "엔진 수리 이력 보증되나요?", "집 정확한 주소 알려주세요" 입력 시 `send_proxy_reply`가 호출되지 않고 `escalate_to_owner`가 호출되어 `ai_paused_reason`이 기록되는지 검증.
   - `propose_rental_handoff`가 호출되어도 `rental_requests` 테이블에 행이 자동 `INSERT`되지 않음을 검증.
4. **Playwright 이중 브라우저 E2E 테스트**
   - 브라우저 A(소유자: 대리 응대 `autonomous` ON + "오전 인수만 가능, 흥정 불가" 정책)와 브라우저 B(구매자)가 1:1 채팅을 진행하며 자동 답변, 에스컬레이션 배너 노출, 인간 개입 후 일시정지 해제를 종단 간 검증.
