# 전체 PR 통합·코드 정리 및 `gpt-live-1` 대화형 음성 에이전트 마스터 결정안

> **기반 문서 및 검토 구조**:
> - **공식 API 레퍼런스**: OpenAI GPT-Live 공식 가이드 (`https://developers.openai.com/api/docs/guides/live`, `/live-prompting`, `/live-delegation`, `/live-conversations`, `/voice-webrtc`)
> - **평가 워커 1 (`R1 · Argon Middle`)**: `gemini-4-argon-medium` (`--effort medium`) — 백엔드 아키텍처, Vercel 12 함수 제약, PR 간 코드 충돌, 세션/레이트리밋 정합성 검토
> - **평가 워커 2 (`R2 · Astra Middle`)**: OpenAI Codex `gpt-6-astra` (`medium`) — 프론트엔드 UX, 실시간 음성 상태머신, 권한/승인 가드레일, 모듈 경계 및 스트리밍 부작용 검토
> - **최종 종합·결정**: 메인 오케스트레이터 세션

---

## 1. `gpt-live-1` 공식 API 명세 기반 신규 아키텍처 설계 (`신규 구축` 확정)

공식 가이드(`guides/live`, `guides/live-prompting`, `guides/live-delegation`, `guides/live-conversations`, `guides/voice-webrtc`)를 분석한 결과, **`gpt-live-1`은 구형 반이중 STT/TTS(PR #34)나 구형 Realtime API와도 다른 2-계층(Full-Duplex Voice Model + Backend Delegation) 프로토콜**을 사용합니다. 따라서 기존 `voice-panel.js`를 부분 수정하는 대신 **`gpt-live-1` 전용 모듈(`server/gpt-live.js` + `src/ai/gpt-live.js`)을 새로 구축**하고 기존 STT/TTS는 폴백 어댑터로 분리합니다.

### 1.1 `gpt-live-1` 핵심 프로토콜 요약 (공식 문서 기준)
1. **세션 생성 및 WebRTC SDP 교환 (`POST https://api.openai.com/v1/live/sessions`)**:
   - 브라우저가 `new RTCPeerConnection()` 생성 → 마이크 오디오 트랙 추가 → **`connection.createDataChannel("oai-events")`를 오퍼 생성 전에 먼저 등록** → `createOffer()` 및 `iceGatheringState === "complete"` 대기 후 서버(`POST /api/voice` `action: "live_session"`)로 `{ sdp }` 전송.
   - 서버가 `OPENAI_API_KEY`로 `POST https://api.openai.com/v1/live/sessions` 호출:
     ```json
     {
       "session": {
         "model": "gpt-live-1",
         "audio": {
           "output": { "voice": "noeul" }
         },
         "instructions": "너는 농기계 대여·구매·판매 플랫폼 모아농의 음성 도우미 농농이야...\n\nBackchannel policy: ...\n\nInterruption policy: ...\n\nDelegation policy:\nBackend tools:\n- ...\nGenerate <|SpawnThinking|> when:\n- ...\nDo not generate <|SpawnThinking|> when:\n- ...",
         "input": [
           {
             "type": "message",
             "role": "developer",
             "content": [{ "type": "input_text", "text": "한국어로 따뜻하고 천천히 인사하며 어떤 농사일이나 농기계를 찾으시는지 여쭤보고, 대답을 기다려 주세요." }]
           }
         ],
         "delegation": { "type": "client" }
       },
       "transport": {
         "type": "webrtc",
         "sdp": "<브라우저 SDP Offer>"
       }
     }
     ```
   - **한국어 네이티브 음성(`noeul`)**: `gpt-live-1` 공식 지원 음성 중 한국어 자연 음성인 **`noeul`**(`Noeul · Korean · Feminine · Natural`)을 기본값(`process.env.OPENAI_LIVE_VOICE || "noeul"`)으로 사용합니다.
   - OpenAI가 `HTTP 201`로 `{ session: { id: "live_..." }, transport: { type: "webrtc", sdp: "<SDP Answer>" } }`를 반환하면 브라우저는 `setRemoteDescription({ type: "answer", sdp: result.transport.sdp })`를 적용하고 데이터채널의 `session.started` 이벤트를 기다립니다(WebRTC에서는 데이터채널로 `session.start`를 보내지 않음).

2. **프롬프트 구조 (`Backchannel policy` · `Interruption policy` · `Delegation policy` + `<|SpawnThinking|>`)**:
   - `gpt-live-1`은 짧은 대화용 프롬프트(`session.instructions`)로 전이중(Full-duplex) 추임새(`Backchannel policy`), 말 끊기 양보(`Interruption policy`), 백엔드 위임 조건(`Delegation policy`)을 제어하며, 백엔드 에이전트의 도움이 필요할 때 **`<|SpawnThinking|>`** 토큰을 생성하여 위임(`session.delegation.created`)을 발생시킵니다.

3. **클라이언트 위임(`Client Delegation`) +Responses 위임(`Responses Delegation`) 연동 흐름**:
   ```mermaid
   sequenceDiagram
       participant User as 사용자 (마이크/스피커)
       participant Live as GPT-Live (gpt-live-1 · voice: noeul)
       participant Browser as 브라우저 (src/ai/gpt-live.js + panel.js)
       participant Server as 모아농 백엔드 (/api/agent · nongnong-agent.js)

       User->>Live: 🗣️ "영양읍인데 이번 주 금요일에 고추밭 관리기 빌릴 수 있나?" (WebRTC 오디오)
       Live-->>Browser: session.input_transcript.delta ({ delta, start_ms, end_ms })
       Live-->>Browser: session.delegation.created ({ delegation: { id: "item_...", target: "client" } })
       Browser->>Live: session.thinking.append ({ delegation_id: "item_...", content: "영양읍 금요일 관리기 매물과 기상청 날씨를 조회 중입니다." })
       Browser->>Server: POST /api/agent { action: "chat", inputMode: "voice", delegationId: "item_...", message, history, uiContext }
       Server-->>Browser: { reply, listingIds, weatherInfo, pendingAction, delegatedTransaction, insuranceContacts, ... }
       Browser->>Browser: renderAgentEffects() (전체화면 가로 이미지 카드 / 날씨 바 / 승인 카드 즉시 렌더링)
       Browser->>Live: session.commentary.append ({ delegation_id: "item_...", content: reply })
       Live-->>User: 🔊 "영양읍에 금요일 날씨가 맑아서 빌릴 수 있는 관리기 두 대를 화면에 띄워 드렸어요..." (실시간 한국어 음성 + session.output_transcript.delta)
   ```
   - **자막 처리**: `session.input_transcript.delta`(사용자 발화)와 `session.output_transcript.delta`(농농이 발화)를 `start_ms`/`end_ms` 타임라인 기준으로 독립된 채팅 버블에 실시간 누적 표시합니다(전이중 대화이므로 두 화자의 버블이 동시에 자랄 수 있게 분리).
   - **백엔드 위임 실행**:
     - `session.delegation.created` (`delegation.target === "client"`) 수신 시, `delegation.id`를 저장하고 현재까지 누적된 사용자 발화 텍스트와 화면 컨텍스트(`uiContext`)를 `/api/agent`(`inputMode: "voice"`)로 전달합니다.
     - 백엔드 조회가 진행되는 동안 `session.thinking.append`(`delegation_id: delegation.id`)로 진행 상태를 전달하고, 결과가 도착하면 화면에 카드를 렌더링(`renderAgentEffects`)한 뒤 `session.commentary.append`(`delegation_id: delegation.id`, 500토큰 이내 요약 텍스트)를 전송해 `gpt-live-1`이 자연스러운 한국어로 결과를 브리핑하게 합니다.
     - 또한 `delegation: { type: "responses" }` 모드를 선택했을 때 도착하는 `response.event` (`response.output_item.done`의 `function_call`)도 `response.item.create`(`function_call_output`) + `response.create`로 완벽히 지원합니다.
   - **마이크 제어 및 우아한 종료(Graceful Close)**:
     - 음소거/해제: `session.input_audio.mute` / `session.input_audio.unmute` 전송 후 `session.input_audio.muted` / `session.input_audio.unmuted` 수신 확인.
     - 대화 종료: 데이터채널에 `{ type: "session.close" }` 전송 후 `session.closed`(최종 사용량 `event.usage` 포함) 이벤트를 받은 뒤 미디어 트랙과 `RTCPeerConnection`을 정리합니다(15초 타임아웃 폴백 포함).

---

## 2. 6개 오픈 PR(`#28`, `#30`, `#31`, `#32`, `#33`, `#34`) 통합 및 코드 정리 결정

`R1(Argon Middle)`과 `R2(Astra Middle)`의 검토를 종합한 최종 통합 전략입니다:

1. **베이스 브랜치**: **PR #33 (`feat/moanong-motion-ux-craft`, PR #32 전체 포함)** 위에 새 통합 브랜치 **`feat/unified-gpt-live-and-prs`**를 생성합니다.
2. **PR #30 (`feature/chat-plus-menu`) 무충돌 통합**:
   - PR #33의 `.ai-composer-toolbar` 좌측에 `#aiPlusButton`(`+`) + `#aiPlusMenu`(`🖼️ 사진`, `📷 카메라`, `🌾 작물·기종`)를 단일 버튼·단일 이벤트 소유권으로 배치합니다(기존 중복 인라인 `[data-ai-picker-toggle]` 제거).
   - 컴포저 바깥에는 **`🎙️ 실시간 음성 대화(gpt-live-1)`** 버튼과 **`🤖 거래 전담`** 토글 칩만 남겨 UI를 간결하게 정돈합니다.
   - `Escape` 키 핸들러를 중앙화하여 `[+ 메뉴 / 작물 선택기 닫기] → [카메라 모달 닫기] → [농농이 패널 닫기]` 순으로 처리합니다.
3. **PR #31 (`feature/insurance-contact-buttons`) 100% 통합**:
   - [server/insurance-flow.js](file:///C:/Users/baejh/orca/workspaces/nongnong/db-rebuild-plan/server/insurance-flow.js)의 `insuranceContactsFor()`, [server/knowledge/insurance.js](file:///C:/Users/baejh/orca/workspaces/nongnong/db-rebuild-plan/server/knowledge/insurance.js)의 공식 연락처(`1644-9000`, `1544-4000`), [src/ai/panel.js](file:///C:/Users/baejh/orca/workspaces/nongnong/db-rebuild-plan/src/ai/panel.js)의 `appendContactCards`(수리센터·보험 연락처 공용 렌더러) 및 테스트를 통합합니다.
4. **PR #34 (`feat/nongnong-voice`) 흡수 + `gpt-live-1` 결합**:
   - **Vercel 12개 함수 제한 준수**: `vercel.json`의 `/api/voice` → `/api/agent?route=voice` 리라이트를 유지하여 `api/` 폴더 내 함수 개수를 정확히 12개로 유지합니다.
   - **보안 가드 패치 (`R2` 최우선 지적 반영)**: [server/nongnong-agent.js](file:///C:/Users/baejh/orca/workspaces/nongnong/db-rebuild-plan/server/nongnong-agent.js)에서 `create_rental_request`, `create_purchase_request`, `create_listing`뿐 아니라 **`delegate_transaction`까지 모두 `spokenApproval = !voice && isAffirmative(text)` 가드를 적용**하여, 음성 대화 중에는 절대 무단 DB 쓰기나 무단 거래 전담이 실행되지 않고 반드시 화면 승인 카드(`pendingAction`)를 띄우도록 강제합니다.
   - **폴백 보존**: `OPENAI_API_KEY`가 없거나 WebRTC가 지원되지 않는 환경을 위해 PR #34의 `server/voice.js` 및 `src/ai/voice.js`와 단위 테스트(`tests/voice.test.js`, `tests/voice-client.test.js`)를 100% 통과 상태로 유지합니다.
5. **PR #28 (`feature/nongnong-unify`)**: 이미 `/api/agent`에 흡수 완료되었으므로 단독 병합하지 않고 정리합니다.

---

## 3. 병렬 워커 실행 계획 (파일 충돌 0% · 4+1 파이프라인)

| 워커 | 담당 파일 | 핵심 구현 내용 |
|---|---|---|
| **`W1` (Backend Agent & PR #31 Insurance)** | `server/nongnong-agent.js`, `server/insurance-flow.js`, `server/knowledge/insurance.js`, `tests/insurance-flow.test.js`, `tests/nongnong-agent.test.js` | • PR #31 보험사/지역농협 연락처 카드(`insuranceContactsFor`) 통합<br>• `server/nongnong-agent.js`: `inputMode: "voice"` 안전 가드(`VOICE_GUIDE`, `spokenApproval`을 `delegate_transaction` 포함 모든 쓰기 도구에 적용), 도구 실행 함수 모듈화 및 `voice_tool` 실행 지원 |
| **`W2` (`gpt-live-1` Server & PR #34 Voice API)** | `api/agent.js`, `server/gpt-live.js`(신규), `server/voice-api.js`, `server/voice.js`, `server/rate-limit.js`, `vercel.json`, `dev-server.js`, `.env.example`, `README.md`, `tests/voice.test.js` | • `server/gpt-live.js`: `POST https://api.openai.com/v1/live/sessions` (`model: "gpt-live-1"`, `voice: "noeul"`, `Backchannel/Interruption/Delegation policy` + `<|SpawnThinking|>`, `delegation: { type: "client" }` 및 `responses` 모드 지원) 구현<br>• `server/voice-api.js` & `api/agent.js`: `GET /api/voice`(`liveAvailable`, `serverStt`, `provider`, `maxSeconds`), `POST /api/voice`(SDP 교환 세션 생성 및 WAV STT 폴백), `POST /api/agent`(`chat` \| `execute` \| `voice_tool`) 라우팅 및 레이트리밋 분리 |
| **`W3` (`gpt-live-1` WebRTC Client & Fallback)** | `src/ai/gpt-live.js`(신규), `src/ai/voice.js`, `src/ai/recommend-agent.js`, `tests/voice-client.test.js` | • `src/ai/gpt-live.js`: `RTCPeerConnection` + `oai-events` DataChannel 연결, `session.started` 인사 트리거(`session.commentary.append`), `session.input_transcript.delta` / `session.output_transcript.delta` 전이중 자막 처리, `session.delegation.created` 수신 시 `/api/agent`(`inputMode: "voice"`) 호출 및 `session.thinking.append` / `session.commentary.append` 응답 주입, `session.input_audio.mute/unmute`, `session.close` → `session.closed` 종료 처리<br>• 화면 버튼 승인 시 `session.commentary.append`(`delegation_id: null`)로 음성 안내 동기화 |
| **`W4` (Panel UI · PR #30 `+` Menu · State Machine)** | `index.html`, `src/ai/panel.js`, `src/styles/ai-panel.css` | • PR #30 `#aiPlusButton`(`+`) + `#aiPlusMenu`(`사진`, `카메라`, `작물·기종`) 단일 소유권 통합 및 `Escape` 우선순위 정리<br>• PR #31 `appendContactCards`(수리센터·보험 상담 연락처 카드 통합)<br>• `gpt-live-1` 실시간 음성 컨트롤 바(`.ai-voice-bar`: 연결·듣는중·생각중·말하는중 상태 파동, 음소거, 종료 버튼) 및 5차원 상태머신(`sessionGeneration` 펜싱, 사진 촬영 시 음성 자동 일시정지, `renderAgentEffects` 멱등 카드 렌더링) |
| **`W5` (Full Integration & Live Browser Verifier)** | (`W1~W4` 완료 후 실행) 전체 빌드·테스트 및 라이브 브라우저 검수 | • `npm run build` + `npm run check` (기존 177개 + 음성/GPT-Live 신규 테스트 전체 통과 확인)<br>• Playwright Chromium으로 `+` 메뉴, 보험 연락처 카드, `gpt-live-1` 음성 대화 UI, 거래 전담, 전체화면/우측분할 모션을 직접 검증 후 통합 PR 생성 및 Vercel Preview 공유 |
