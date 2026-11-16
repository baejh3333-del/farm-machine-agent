# 농농이 사진 인식 상담 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅창에서 농기계 사진을 올리면 농농이가 기종과 상태를 알아보고 답하게 한다.
- 1(구매·대여받는 사람)에게는 안전한 자가점검 → 수리센터 연결을 안내한다.
- 2(판매·대여해 주는 사람)에게는 참고가, 소개글, 사진 저장, 매물 등록 화면 미리 채우기를 제공한다.
- 보험은 요청할 때만 안내한다.

**Architecture:** 기존 `/api/agent` 도구 호출 루프(`server/nongnong-agent.js`)에 이미지 입력과 도구 7개를 더한다.
- 모델 호출은 `server/llm.js`가 공급자별 이미지 형식과 비전 모델을 맞춘다.
- 사실 데이터는 출처가 붙은 `server/knowledge/*.js`와 순수 함수 모듈 `server/photo-tools.js`에 둔다.
- 판매·대여 사진은 기존 사진 저장소와 키 형식으로 저장하고, `createListing`이 `draftPhotoKey`를 받는다.

**Tech Stack:** Node.js 24 ESM, `node:test`, sharp(기존), PGlite 통합 테스트, Playwright 확인, 바닐라 JS 프런트엔드.

**Spec:** `docs/superpowers/specs/2026-11-16-nongnong-photo-assist-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- AI 설정값:
  - `ZAI_MODEL` 기본 `glm-5.3`
  - `ZAI_VISION_MODEL` 기본 `glm-5.3-flash`
  - `AI_WEB_SEARCH=1`일 때만 웹 검색을 켠다(기본 꺼짐).
- 사진 처리:
  - 업로드 상한은 1MB(`server/images.js`)다. 클라이언트에서 긴 변 1280px JPEG로 줄인다.
  - 1의 사진은 저장하지 않는다. 2의 판매·대여 사진은 로그인 사용자만 `listings/<새 매물 ID>/<uuid>.webp`로 저장한다.
  - 대화 기록(history)에 data URL을 절대 넣지 않는다. `[사진 첨부]`와 인식 요약만 넣는다.
- 가격과 호출 제한:
  - 가격은 상태 보정 없이 비교 매물의 중앙값·최솟값·최댓값·건수로만 낸다.
  - 문구에 "플랫폼 등록 매물 기준 참고가"를 붙인다.
  - 사진 상담 전용 호출 제한은 두지 않는다(기존 `recommend` 한도 공유).
- 지식 데이터:
  - 모든 항목에 `source: { title, url }`와 `checkedAt: "YYYY-MM-DD"`를 붙인다.
  - 공식 출처에서 확인하지 못한 전화번호·사이트는 넣지 않는다.
- 답변 원칙:
  - 사진 판단은 추정으로 표현한다.
  - 보험 도구는 사용자가 보험을 물었을 때만 호출한다.
  - 수리는 가이드에 있는 단계만 안내한다.
- 화면: 새 버튼은 높이 44px 이상, 문구는 짧은 한국어 존댓말로 쓴다.

## Review Focus

1. **iPhone HEIC나 이미지가 아닌 파일:** 기대 동작은 "JPG·PNG 사진만 올릴 수 있어요" 안내다. 서버는 400과 친절한 문구를 돌려주고 충돌하지 않는다. → Task 5 테스트
2. **질문 없이 사진만 전송:** 사진만으로 대화를 시작할 수 있어야 한다. 빈 메시지 400이 나오면 안 된다. → Task 5 테스트
3. **비전 모델 호출 실패(모델명 오설정 등):** 규칙 기반 상담으로 넘기면 사진을 무시한 엉뚱한 답이 나온다. 대신 "사진을 지금 확인하지 못했어요" 안내를 보여 준다. → Task 5(서버 502 코드 `PHOTO_UNAVAILABLE`)와 Task 6(화면 문구)
4. **비로그인 2의 「이 내용으로 매물 등록하기」:** 로그인 후 등록 화면이 사진까지 채워진 채로 다시 열린다. → Task 6 테스트
5. **같은 대화에서 초안 생성을 두 번 호출:** 사진이 중복 저장되지 않고 처음 키를 다시 쓴다. → Task 5 테스트

---

### Task 1: 공급자별 이미지 입력과 모델 설정

**Files:**
- Modify: `server/llm.js`
- Modify: `.env.example`, `README.md` (AI API 연결 절)
- Test: `tests/nongnong-agent.test.js`

**Interfaces:**
- Produces:
  - Anthropic 형식 이미지 블록 `{ type: "image", source: { type: "base64", media_type: "image/jpeg"|"image/png"|"image/webp", data: string } }`을 메시지 content 배열에서 쓸 수 있다.
  - `llmModel(provider, { vision: boolean } = {}) -> string`
  - `DEFAULT_ZAI_MODEL = "glm-5.3"`, `DEFAULT_ZAI_VISION_MODEL = "glm-5.3-flash"`
  - `callLLM(...)`는 messages 안에 이미지 블록이 하나라도 있으면 Z.ai 비전 모델을 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `"Z.ai 기본 모델은 glm-5.3, 사진이 있으면 glm-5.3-flash를 쓴다"`
    - fetch를 모의한다. 이미지 없는 호출은 `body.model === "glm-5.3"`, 이미지 있는 호출은 `"glm-5.3-flash"`다.
    - `ZAI_VISION_MODEL="x"`로 바꾸면 `"x"`다.
  - `"이미지 블록을 Z.ai image_url 형식으로 바꾼다"`
    - `toOpenAiMessages`에 `[{type:"text",text:"이거 뭐예요"},{type:"image",source:{type:"base64",media_type:"image/jpeg",data:"AAA"}}]`를 준다.
    - 결과 user 메시지 content는 `[{type:"text",text:"이거 뭐예요"},{type:"image_url",image_url:{url:"data:image/jpeg;base64,AAA"}}]`다.
  - `"Anthropic 호출은 이미지 블록을 그대로 보낸다"`
    - `ANTHROPIC_API_KEY`만 설정한다. `body.messages[0].content[1].type === "image"`이고 `body.model === "claude-haiku-5-5"`다.
  - 기존 테스트 `"Z.ai 호출은 Bearer 키와..."`의 기대 모델을 `glm-5.3`으로 바꾼다.
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `node --test tests/nongnong-agent.test.js`
  - Expected: 위 3개 FAIL
- [ ] **Step 3: 구현**
  - `toOpenAiMessages`의 user 분기: 이미지 블록이 있으면 content를 배열(text/image_url)로 만든다. 없으면 지금처럼 문자열로 둔다.
  - `callZai`: `messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === "image"))`로 비전 모델을 고른다.
- [ ] **Step 4: 실행해서 통과 확인**
  - Run: `node --test tests/nongnong-agent.test.js`
  - Expected: 전부 PASS
- [ ] **Step 5: 문서 갱신 후 커밋**
  - `.env.example`과 README에 `ZAI_VISION_MODEL`을 추가하고 기본값을 `glm-5.3`/`glm-5.3-flash`로 적는다.
  - 커밋: `git commit -m "feat: AI 호출에 이미지 입력과 Z.ai 비전 모델(glm-5.3-flash) 지원"`

### Task 2: 검증 지식 데이터 (수리 가이드 · 수리센터 · 보험)

**Files:**
- Create: `server/knowledge/repair-guides.js`, `server/knowledge/repair-centers.js`, `server/knowledge/insurance.js`
- Test: `tests/knowledge.test.js`

**Interfaces:**
- Produces:
  - `REPAIR_GUIDES: Array<{ id, machineGroups: string[], symptom: string, symptomLabel: string, keywords: string[], safetyFirst: string[], steps: Array<{ text: string, caution?: string }>, stopIf: string[], source, checkedAt }>`
    - `machineGroups`는 `"engine"` | `"implement"` | `"sprayer"`이다.
    - `symptom` ∈ `noStart`, `lowPowerSmoke`, `noiseVibration`, `leak`, `implementNotWorking`, `afterStorage`.
  - `MACHINE_GROUP_BY_TYPE: Record<machineTypeId, "engine"|"implement"|"sprayer">` (13개 기종 모두)
  - `REPAIR_CENTERS: Array<{ id, name, kind: "public"|"coop"|"maker", brands: string[], regions: string[] | "all", services: string, phone: string|null, url: string|null, hours?: string, source, checkedAt }>`
  - `INSURANCE_PRODUCTS: Array<{ id, name, audience: Array<"owner"|"renter">, machineTypes: string[]|"all", summary, subsidy, whereToJoin: Array<{ name, phone|null, url|null }>, checklist: string[], source, checkedAt }>`

- [ ] **Step 1: 실패하는 데이터 검사 테스트 작성** (`tests/knowledge.test.js`)
  - `"모든 지식 항목에 출처 URL과 확인일이 있다"`: 세 배열의 각 항목에 대해 `source.url`이 `https://`로 시작하고 `checkedAt`이 `/^\d{4}-\d{2}-\d{2}$/`에 맞는다.
  - `"수리 가이드는 6개 증상 × 3개 기종군을 덮는다"`: 모든 (group, symptom) 조합에 가이드가 1개 이상 있다. 단, `sprayer`의 `implementNotWorking`은 제외한다.
  - `"자가점검 단계는 엔진 정지로 시작하고 위험 작업을 안내하지 않는다"`
    - 모든 가이드의 `safetyFirst[0]`이 `/엔진.*(끄|정지)/`에 맞는다.
    - 모든 `steps[].text`가 `/분해|해체|뜯어|용접|유압 호스를 풀|노즐.*(입|손가락)|작동 중/`에 맞지 않는다.
    - 모든 가이드의 `stopIf.length >= 2`다.
  - `"모든 기종이 기종군에 연결된다"`: `MACHINE_TYPES`의 모든 id가 `MACHINE_GROUP_BY_TYPE`에 있다.
  - `"수리센터 연락처는 국내 번호 형식이거나 null이고, 전화·사이트 중 하나는 있다"`: phone이 `/^(0\d{1,2}-\d{3,4}-\d{4}|1\d{3}-\d{4})$/` 또는 null이고, `phone || url`이 참이다.
  - `"영양군 기관 1곳 이상과 카탈로그 제조사 A/S 창구가 있다"`
    - `regions`에 `"영양읍"`이 포함된 항목이 1개 이상 있다.
    - 브랜드 `대동`, `아세아텍`, `얀마`, `혼다`, `강농`, `두루기계통상` 각각에 `kind:"maker"` 항목이 있다. 공식 연락처를 끝내 확인하지 못한 제조사는 이 목록에서 빼고, 커밋 메시지에 이유를 적는다.
  - `"보험은 빌려주는 사람과 빌리는 사람 모두에게 안내할 항목이 있다"`
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `node --test tests/knowledge.test.js`
  - Expected: FAIL (모듈 없음)
- [ ] **Step 3: 자료 조사 후 데이터 작성**
  - WebSearch/WebFetch로 공식 출처만 쓴다: 제조사 홈페이지·취급설명서, 농촌진흥청 농기계 안전 자료, 영양군청·영양군 농업기술센터, 농협, NH농협손해보험·정책보험 안내.
  - `checkedAt`은 조사한 날짜다.
  - 가이드 문구는 시니어용으로 한 단계 한 문장, 쉬운 말로 쓴다.
- [ ] **Step 4: 실행해서 통과 확인**
  - Run: `node --test tests/knowledge.test.js`
  - Expected: PASS
- [ ] **Step 5: 커밋**
  - `git commit -m "feat: 농농이 수리 가이드·수리센터·보험 검증 지식 데이터"`

### Task 3: 조회·계산 도구 순수 함수

**Files:**
- Create: `server/photo-tools.js`
- Test: `tests/photo-tools.test.js`

**Interfaces:**
- Consumes: Task 2의 상수, `MACHINE_SPECIFICATIONS`/`SPEC_BY_ID`(`src/data/machine-specifications.js`), `fetchRentalOffices`(`server/integrations/rental-offices.js`)
- Produces:
  - `lookupMachineSpec({ modelId?, machineType? }) -> { model?: {...facts, unknowns, sources}, machineType?: { id, label } } | { error }`
  - `getRepairGuide({ machineType, symptom? , text? }) -> { guides: Array<guide>, note } | { error }`
    - symptom이 없으면 `text`를 `keywords`와 맞춰 고른다. 그래도 못 고르면 증상 목록을 돌려준다.
  - `findRepairCenters({ region?, brand? }, { fetchOffices = fetchRentalOffices } = {}) -> Promise<{ centers: Array<center>, note }>`
    - 정렬: 해당 지역 공공·농협 → 해당 브랜드 제조사 → 나머지 제조사. 최대 5개.
    - 임대사업소 API가 설정되어 있으면 결과를 `kind:"public"`으로 덧붙이고 `name+phone` 기준으로 중복을 없앤다.
  - `estimatePrice(listings, { purpose: "sale"|"rent", modelId?, machineType? }) -> { basis: "model"|"machineType"|"none", count, median, min, max, unit: "total"|"day", lowConfidence: boolean, note }`
  - `getInsuranceInfo({ role: "owner"|"renter", machineType? }) -> { products, note }`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `"가격은 같은 모델 → 같은 기종 순으로 찾고 중앙값·범위를 낸다"`
    - 모의 매물을 쓴다: 대여 모델 A 3건(가격 40000, 50000, 60000), 판매 1건, `status:"removed"` 1건.
    - `{purpose:"rent", modelId:"A"}`의 결과는 `{basis:"model", count:3, median:50000, min:40000, max:60000, unit:"day", lowConfidence:false}`다.
  - `"모델 매물이 없으면 기종으로, 3건 미만이면 lowConfidence"`
  - `"비교 매물이 없으면 가격을 내지 않는다"`: `{basis:"none", count:0, median:null}`이고 note가 `/직접/`에 맞는다.
  - `"짝수 건수 중앙값은 두 가운데 값의 평균을 원 단위로 반올림한다"`
  - `"수리 가이드는 증상 키워드로 고른다"`: `{machineType:"cultivator", text:"시동이 안 걸려요"}`의 결과에서 `guides[0].symptom === "noStart"`다.
  - `"수리센터는 지역 기관이 먼저, 브랜드 제조사가 다음이다"`: `{region:"영양읍", brand:"대동"}`의 결과에서 `centers[0].kind !== "maker"`이고, 그다음 maker 항목의 brands에 `"대동"`이 포함된다.
  - `"임대사업소 API 결과를 합치고 중복을 없앤다"`: 모의 `fetchOffices`가 같은 이름·번호 2건을 반환하면 1건만 남는다.
  - `"보험 안내는 역할에 맞는 상품만 준다"`
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `node --test tests/photo-tools.test.js`
  - Expected: FAIL
- [ ] **Step 3: 위 시그니처대로 구현**
  - `estimatePrice`는 `status === "open"`인 매물만 쓴다.
  - 모든 결과의 `note`에 "플랫폼 등록 매물 기준 참고가, 실제 시세와 다를 수 있어요"를 넣는다.
- [ ] **Step 4: 실행해서 통과 확인**
  - Run: `node --test tests/photo-tools.test.js`
  - Expected: PASS
- [ ] **Step 5: 커밋**
  - `git commit -m "feat: 사진 상담용 제원·수리·가격·보험 조회 함수"`

### Task 4: 판매·대여 초안 사진 저장과 `draftPhotoKey` 등록

**Files:**
- Create: `server/listing-drafts.js`
- Modify: `server/listings-service.js` (`createListing`)
- Modify: `README.md` (`db:reconcile-photos`는 `--min-age-minutes 1440` 이상으로 실행하라는 안내)
- Test: `tests/pg-integration.test.js` (새 테스트 9번)

**Interfaces:**
- Consumes: `validateAndReencodeImage`(`server/images.js`), `newListingPhotoKey`·`putPhotoObject`·`getPhotoObject`·`photoPublicUrl`(`server/storage.js`)
- Produces:
  - `saveDraftPhoto(user, imageDataUrl) -> Promise<{ listingId: string(uuid), photoKey: string, photoUrl: string }>`
    - user가 없으면 `fail(401, "LOGIN_REQUIRED", ...)`
  - `createListing(user, payload)`는 `payload.draftPhotoKey`를 받는다.
    - `photoDataUrl`보다 우선한다.
    - 키가 `listings/${payload.id}/`로 시작하지 않거나 저장소에 없으면 `fail(400, "INVALID_DRAFT_PHOTO", "사진을 다시 올려 주세요.")`
    - 통과하면 업로드 없이 그 키를 `photo_key`로 쓴다.

- [ ] **Step 1: 실패하는 통합 테스트 작성** (`[PGlite 로컬 엔진] 9. 초안 사진 저장과 draftPhotoKey 등록`)
  - `saveDraftPhoto(userB.user, <sharp로 만든 64×64 JPEG data URL>)` → `photoKey`가 `listings/${listingId}/`로 시작하고, `getPhotoObject(photoKey)`가 존재한다.
  - `createListing(userB.user, { id: listingId, ...유효 필드, draftPhotoKey: photoKey }, { pool })` → 201이고 `listing.photoKey === photoKey`다. 저장소의 `listings/${listingId}/` 객체 수는 1이다.
  - 다른 ID로 같은 키를 쓰면 400 `INVALID_DRAFT_PHOTO`다.
  - 존재하지 않는 키(형식은 맞음)도 400이다.
  - `saveDraftPhoto(null, ...)`은 401이다.
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `node --test tests/pg-integration.test.js`
  - Expected: 9번 FAIL
- [ ] **Step 3: 구현**
  - `createListing`의 멱등성 사전 검사 이후, 업로드 분기 앞에서 `draftPhotoKey`를 검증한다.
  - 트랜잭션 실패 시 정리 로직(`discardUploaded`)은 업로드한 키에만 적용한다. 초안 키는 지우지 않는다.
- [ ] **Step 4: 실행해서 통과 확인**
  - Run: `node --test tests/pg-integration.test.js`
  - Expected: 1~9 PASS
- [ ] **Step 5: 커밋**
  - `git commit -m "feat: 판매·대여 초안 사진 저장과 draftPhotoKey 매물 등록"`

### Task 5: 에이전트에 사진·새 도구 연결

**Files:**
- Modify: `server/nongnong-agent.js`, `api/agent.js`
- Test: `tests/nongnong-agent.test.js`, `tests/pg-integration.test.js` (8번에 사진 케이스 추가)

**Interfaces:**
- Consumes: Task 1(이미지 블록), Task 3 함수 전부, Task 4 `saveDraftPhoto`
- Produces:
  - `runAgentTurn(message, { history, region, image?: { mediaType, base64, dataUrl }, user?, savedDraft?: { listingId, photoKey, photoUrl } }, deps)` 반환값에 아래가 추가된다.
    - `photoSummary?: { machineType, modelId: string|null, confidence: "high"|"medium"|"low", observations: string[] }`
    - `repairCenters?: Array<center>`
    - `listingDraft?: { listingId: string|null, photoKey: string|null, photoUrl: string|null, type: "sale"|"rent", title, description, price: number|null, priceBasis: {count, min, max, unit, lowConfidence}, machineType, modelId: string|null, brand: string|null }`
    - `sources?: Array<{ title, url }>`
  - `/api/agent` `chat` 요청 본문에 `image?: string`(data URL)과 `savedDraft?`를 받는다.
    - message는 이미지가 있으면 0~500자, 없으면 1~500자다.
  - 오류 코드:
    - 이미지 검증 실패 → 400 `INVALID_PHOTO`("JPG·PNG·WebP 사진을 1MB 이하로 올려 주세요.")
    - 이미지가 있는데 모델 호출 실패 → 502 `PHOTO_UNAVAILABLE`("사진을 지금 확인하지 못했어요. 잠시 후 다시 올려 주세요.")
    - 이미지 없이 키가 없음 → 기존대로 `mode:"unavailable"`
- 새 도구(이름은 고정):
  - `note_photo`, `lookup_machine_spec`, `get_repair_guide`, `find_repair_centers`, `estimate_price`, `prepare_listing_draft`, `get_insurance_info`
  - `AI_WEB_SEARCH=1`일 때만 공급자 내장 웹 검색을 추가한다.
    - Anthropic: 서버 도구 `web_search`
    - Z.ai: `tools`의 `web_search` 타입
    - 정확한 형식은 각 공식 문서에서 확인한다.
  - `prepare_listing_draft` 입력: `{ type, title, description, machineType, modelId|null, brand|null }`
    - 서버가 `estimatePrice`로 가격을 채운다.
    - `user`와 `image`가 있고 `savedDraft`가 없을 때만 `saveDraftPhoto`를 부른다. `savedDraft`가 있으면 그것을 다시 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** (scripted `call` 사용)
  - `"사진이 있으면 첫 사용자 메시지에 이미지 블록이 붙고 history에는 data URL이 없다"`
    - `calls[0].messages.at(-1).content`에 `type:"image"`가 있다.
    - 반환값을 `JSON.stringify` 했을 때 `"base64,"`가 없다.
  - `"note_photo 결과가 photoSummary로 돌아오고 modelId는 카탈로그에 있는 것만 남는다"`: 없는 modelId는 null이 된다.
  - `"수리 흐름: get_repair_guide → find_repair_centers 결과가 repairCenters로 돌아온다"`
  - `"prepare_listing_draft는 로그인+사진이면 저장하고, 두 번째 호출은 savedDraft를 재사용한다"`
    - 모의 `saveDraftPhoto`(deps 주입)를 쓴다. 첫 턴에 1회 호출된다.
    - 두 번째 턴에 `savedDraft`를 넘기면 호출 0회다(Review Focus 5).
  - `"비로그인 판매 초안은 저장 없이 listingId·photoKey가 null이다"`
  - `"보험을 묻지 않았으면 get_insurance_info를 거부한다"`
    - 시스템 지시 문자열에 "사용자가 보험을 물었을 때만"이 포함된다.
    - 마지막 사용자 메시지에 `/보험/`이 없으면 도구 결과가 `is_error:true`, `"보험은 요청하실 때만 안내해요"`다.
  - `"AI_WEB_SEARCH가 없으면 웹 검색 도구를 보내지 않는다"`
  - `"이미지 + 모델 실패면 PHOTO_UNAVAILABLE로 구분된다"`: 반환 `{ error: "PHOTO_UNAVAILABLE" }`
  - 통합 테스트(8번 확장):
    - `/api/agent`에 `image:"data:image/heic;base64,AAAA"` → 400 `INVALID_PHOTO` (Review Focus 1)
    - 키가 없는데 `message:""`와 유효 이미지 → 200 `unavailable`, 400이 아님 (Review Focus 2)
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `node --test tests/nongnong-agent.test.js tests/pg-integration.test.js`
  - Expected: 새 테스트 FAIL
- [ ] **Step 3: 구현**
  - `api/agent.js`가 `decodePhotoDataUrl`·`validateAndReencodeImage`로 검증한다. 재인코딩 결과(webp)를 base64로 모델에 보낸다(EXIF 제거본).
  - `currentUser(request)`로 user를 얻는다(없으면 null).
  - 시스템 지시에 설계 문서 6.8의 5개 원칙을 추가한다.
  - history에는 사용자 턴을 `"[사진 첨부] " + message`로, 인식 요약을 assistant 턴 끝에 `"(사진 인식: …)"`로 넣도록 클라이언트에 `photoSummary`를 돌려준다.
- [ ] **Step 4: 실행해서 통과 확인**
  - Run: `npm run check`
  - Expected: 새 테스트 PASS. 실패는 기존 browser-e2e 1건뿐이다.
- [ ] **Step 5: 커밋**
  - `git commit -m "feat: 농농이 사진 인식 상담 도구와 /api/agent 이미지 입력"`

### Task 6: 채팅창 사진 첨부와 결과 카드

**Files:**
- Modify: `index.html`(채팅 입력부에 📷 버튼, 숨긴 `input[type=file accept="image/*"]`, 미리보기 영역)
- Modify: `src/ai/panel.js`, `src/ai/recommend-agent.js`(`askAgent`에 `image`, `savedDraft` 전달), `src/styles.css`
- Modify: `src/views/transactions.js`(`listingFormModal`이 `draftValues.draftPhotoKey`/`draftPhotoUrl`을 미리보기로 보여 주고 payload에 `draftPhotoKey` 포함. `openNewListing` export 확인)
- Create: `src/ai/photo.js`
- Test: `tests/app.test.js`(순수 함수), 브라우저 확인 스크립트(작업 디렉터리 밖)

**Interfaces:**
- Consumes: Task 5 응답 필드
- Produces:
  - `downscaleImage(file: File, { maxSide = 1280, quality = 0.85 }) -> Promise<string /* data:image/jpeg;base64 */>`
    - 디코딩에 실패하면 `Error("JPG·PNG 사진만 올릴 수 있어요.")`
  - `listingDraftToFormValues(draft, photoDataUrl?) -> draftValues`
    - `{ id: draft.listingId || crypto.randomUUID(), type, modelId, machineType, brand, title, price, description, draftPhotoKey, draftPhotoUrl, photoDataUrl }`
    - `photoKey`가 null이면 `photoDataUrl`을 넣는다(Review Focus 4).

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/app.test.js`)
  - `"초안을 등록 화면 값으로 바꾸고, 저장 안 된 초안은 사진 data URL을 넘긴다"`
    - 저장된 초안: `draftPhotoKey === "listings/x/…"`이고 `photoDataUrl === undefined`다.
    - 저장 안 된 초안: `draftPhotoKey === undefined`이고 `photoDataUrl === "data:image/jpeg;base64,AAA"`다.
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `node --test tests/app.test.js`
  - Expected: FAIL
- [ ] **Step 3: 구현**
  - 📷 → 파일 선택 → `downscaleImage` → 미리보기(✕로 삭제). 전송 시 내 말풍선에 썸네일을 넣는다. 사진만 있으면 message를 `""`로 보낸다.
  - 사진이 있는 턴은 에이전트가 쓸 수 없으면(`unavailable`) 규칙 기반으로 넘기지 않는다. "사진 상담은 AI 설정이 필요해요" 안내를 보여 준다. 502 `PHOTO_UNAVAILABLE`이면 서버 문구를 보여 준다.
  - 수리센터 카드: 이름, 하는 일, `📞 전화하기`(`href="tel:..."`), `🌐 사이트`(`target="_blank" rel="noopener"`), "확인일 YYYY-MM-DD".
  - 판매·대여 카드: 사진, 제목, 참고가 문구, 소개글, `📋 소개글 복사`(`navigator.clipboard.writeText`), `📝 이 내용으로 매물 등록하기`(`deps.openNewListing(listingDraftToFormValues(draft, lastPhotoDataUrl))`).
  - `createAiPanel`에 `openNewListing`을 주입한다(`src/main.js`).
  - history에 `photoSummary`를 붙이고, `savedDraft`를 대화 상태로 보관해 다음 요청에 보낸다.
- [ ] **Step 4: 통과 확인과 브라우저 확인**
  - Run: `node --test tests/app.test.js` → PASS
  - Playwright로 `/api/agent`를 모의한다. 📷 첨부 → 미리보기 → 전송 → 수리센터 카드의 `tel:` 링크 → 판매 카드 → 등록하기 → 등록 폼에 제목·가격·사진 미리보기가 채워졌는지 확인한다.
  - 비로그인일 때 등록하기 → 로그인 이동 intent에 `photoDataUrl`이 있는지 확인한다.
  - 스크린샷 2장을 남긴다.
- [ ] **Step 5: 커밋**
  - `git commit -m "feat: 채팅창 사진 첨부, 수리센터·판매 초안 카드, 매물 등록 미리 채우기"`

### Task 7: 마무리 검증과 PR 갱신

- [ ] **Step 1:** `npm run check` 실행. 결과가 기존 browser-e2e 1건 실패 외에 모두 통과(또는 건너뜀)인지 확인한다.
- [ ] **Step 2:** README에 사진 상담, 지식 데이터 갱신 주기(분기 1회 권장), 초안 사진 정리 명령을 적는다.
- [ ] **Step 3:** `git -c push.negotiate=true push` 후 PR #25 본문에 사진 상담 절과 새 환경 변수를 추가한다(`gh api -X PATCH`).
