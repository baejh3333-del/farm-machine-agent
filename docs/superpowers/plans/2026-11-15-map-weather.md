# 전국 지도·실거리·날씨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매물에 좌표를 저장해 전국 지도와 실제 직선거리를 제공하고, 대여 희망일의 날씨 예보를 보여준다.

**Architecture:** 좌표·거리 계산은 클라이언트와 서버가 함께 쓰는 순수 모듈(`src/data/geo.js`)에 둔다. 지도(카카오맵)는 `src/map/` 아래 별도 모듈로 두고 SDK가 없으면 `null`을 돌려주어 나머지 화면이 그대로 동작한다. 날씨는 서버(`server/weather.js` + `api/weather.js`)가 기상청을 호출해 DB에 캐시하고, 브라우저는 정리된 결과만 받는다.

**Tech Stack:** Node.js 24, 순수 JS(ES 모듈), PostgreSQL(`pg`) / PGlite(테스트), `node --test`, Playwright, 카카오맵 JavaScript SDK(`services`, `clusterer` 라이브러리), 기상청 단기예보 `getVilageFcst`.

**Spec:** `docs/superpowers/specs/2026-11-15-map-weather-design.md`

## Global Constraints

- 시작 전 조건: PostgreSQL 재구축 코드(`server/migrations/0001`, `0002`가 있는 상태)가 `main`에 머지된 뒤 `main`에서 새 브랜치 `feature/map-weather`를 만든다.
- `npm run check`는 외부 키와 네트워크 없이 통과해야 한다. 카카오·기상청 실제 호출을 자동 테스트에 넣지 않는다.
- 환경 변수 이름은 `KAKAO_MAP_APP_KEY`, `KMA_SERVICE_KEY`. 값은 저장소에 커밋하지 않는다. 기상청 키는 브라우저로 내려보내지 않는다.
- 좌표는 소수 둘째 자리로 반올림해 저장한다. 원본 좌표를 DB·로그·응답 어디에도 남기지 않는다.
- 좌표 허용 범위: 위도 33~39, 경도 124~132.
- 기본 내 위치: 홍천읍 중심. 이름은 `"강원 홍천군 홍천읍"`, 좌표는 홍천군청 위치를 실제로 확인해 소수 둘째 자리로 적는다(대략 37.70, 127.89).
- 화면 문구: 거리에는 "직선"을 붙인다. 예시 매물에는 "예시 위치"를 표시한다. 등록 화면 안내문은 `약 1km 단위로 흐리게 저장되며 정확한 주소는 공개되지 않습니다`.
- 날씨 한 줄 형식: `11/17(화) 흐리고 비 60% · 3~11℃`.
- 지도·날씨가 실패해도 목록·검색·등록·추천·대여 요청은 동작한다.
- `agent/` 폴더는 건드리지 않는다. 새 코드는 `src/main.js`에 쌓지 말고 아래 파일 구조의 모듈에 둔다.
- 스키마 변경은 `server/migrations/`에 번호를 이어 추가한다. 이미 적용된 마이그레이션 파일은 수정하지 않는다(체크섬 검증이 있다).

## Review Focus

1. 위치 권한을 거부하거나 응답이 오지 않을 때: 내 위치는 기존 값을 유지하고 안내 토스트만 뜬다. 화면이 멈추지 않는다. → Task 4
2. 카카오 SDK를 못 불러올 때(키 없음, 도메인 미등록, 네트워크 차단): 지도 자리에 안내 문구가 나오고 목록·거리·등록은 정상이다. → Task 5, 6
3. 좌표가 한쪽만 오거나, 문자열·NaN이거나, 국외 좌표일 때: 서버가 400으로 거절하고 아무것도 저장하지 않는다. → Task 2
4. 기상청이 비정상 응답을 줄 때(HTML 오류 페이지, `resultCode`가 `00`이 아님, 빈 목록, 시간 초과): `/api/weather`는 500이 아니라 빈 예보를 돌려주고 화면은 날씨 줄만 숨긴다. → Task 7, 8
5. 브라우저에 예전 상태(`region: "영양읍"`)가 저장되어 있을 때: 오류 없이 기본 내 위치로 바뀐다. → Task 4

## File Structure

| 파일 | 역할 |
|---|---|
| `src/data/geo.js` (신규) | 하버사인 거리, 좌표 반올림·범위 검사, 기본 위치. 클라이언트·서버 공용 |
| `src/data/recommendation.js` (수정) | `compareListings`, `selectMatchingListings`가 지역 이름 대신 좌표 기준으로 정렬 |
| `src/data/farm-machines.js` (수정) | 가짜 `distanceKm`와 난수 캐시 삭제 |
| `server/migrations/0003_listing_coordinates.sql` (신규) | `listings.lat`, `listings.lng` |
| `server/migrations/0004_weather_cache.sql` (신규) | 예보 캐시 테이블 |
| `server/listings-service.js`, `server/listings-db.js` (수정) | 좌표 검증·저장·응답 |
| `server/demo-locations.js` (신규) | 예시 매물을 놓을 장소 목록 |
| `server/listing-seed.js`, `server/migrator.js` (수정) | 시드에 좌표·새 지역 이름, 기존 예시 매물 갱신 |
| `server/runtime-config.js` (신규) | 브라우저용 설정 모듈 소스 생성 |
| `dev-server.js`, `scripts/build.mjs` (수정) | `/src/runtime-config.js` 제공, `/api/weather` 연결 |
| `src/location.js` (신규) | 내 위치 상태 정규화, 브라우저 위치 권한 요청 |
| `src/map/kakao-loader.js` (신규) | SDK 로드. 실패하면 `null` |
| `src/map/listing-map.js` (신규) | 매물 지도와 마커 묶음 |
| `src/map/location-picker.js` (신규) | 지도에서 위치를 찍는 대화상자 |
| `server/weather.js`, `api/weather.js` (신규) | 격자 변환, 기상청 호출, 캐시, 응답 정리 |
| `src/weather.js` (신규) | 예보 조회, 한 줄 문구, 작업별 날씨 안내 |
| `src/main.js`, `index.html`, `src/styles.css` (수정) | 위 모듈 연결, 목록/지도 전환, 내 위치 버튼 |

---

### Task 1: 좌표·거리 공용 모듈

**Files:**
- Create: `src/data/geo.js`
- Test: `tests/geo.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_LOCATION: { lat: number, lng: number, label: "강원 홍천군 홍천읍" }`
  - `isKoreaCoord(lat: unknown, lng: unknown): boolean` — 둘 다 유한한 숫자이고 범위 안일 때만 `true`
  - `roundCoord(value: number): number` — 소수 둘째 자리 반올림
  - `haversineKm(a: {lat,lng}, b: {lat,lng}): number` — 지구 반지름 6371.0088km
  - `listingDistanceKm(origin: {lat,lng}, item: {lat?: number|null, lng?: number|null}): number|null` — 소수 첫째 자리 반올림, 좌표가 없으면 `null`

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/geo.test.js`)

```js
test("서울시청–부산시청 직선거리는 약 325km다", () => {
  const km = haversineKm({ lat: 37.5665, lng: 126.978 }, { lat: 35.1796, lng: 129.0756 });
  assert.ok(km > 320 && km < 330);
});
test("같은 점의 거리는 0이다", () => assert.equal(haversineKm(DEFAULT_LOCATION, DEFAULT_LOCATION), 0));
test("좌표는 소수 둘째 자리로 반올림한다", () => {
  assert.equal(roundCoord(37.69724), 37.7);
  assert.equal(roundCoord(127.88449), 127.88);
});
test("범위 밖이거나 숫자가 아닌 좌표를 거절한다", () => {
  assert.equal(isKoreaCoord(37.7, 127.89), true);
  for (const [lat, lng] of [[32.9, 127], [39.1, 127], [37, 123.9], [37, 132.1], ["37.7", 127.89], [NaN, 127], [null, null], [37.7, undefined]])
    assert.equal(isKoreaCoord(lat, lng), false);
});
test("좌표가 없는 매물의 거리는 null이다", () => {
  assert.equal(listingDistanceKm(DEFAULT_LOCATION, { lat: null, lng: null }), null);
  assert.equal(listingDistanceKm(DEFAULT_LOCATION, {}), null);
});
test("기본 위치는 허용 범위 안의 홍천읍이다", () => {
  assert.equal(DEFAULT_LOCATION.label, "강원 홍천군 홍천읍");
  assert.ok(isKoreaCoord(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng));
  assert.ok(haversineKm(DEFAULT_LOCATION, { lat: 37.7, lng: 127.89 }) < 3);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/geo.test.js` → FAIL (모듈 없음)
- [ ] **Step 3: `src/data/geo.js` 구현** — 위 Interfaces의 다섯 가지를 내보낸다. `DEFAULT_LOCATION` 좌표는 홍천군청 위치를 확인해 넣는다.
- [ ] **Step 4: 통과 확인** — Run: `node --test tests/geo.test.js` → PASS
- [ ] **Step 5: 커밋** — `git add src/data/geo.js tests/geo.test.js && git commit -m "feat: add shared coordinate and distance helpers"`

---

### Task 2: 매물 좌표 저장

**Files:**
- Create: `server/migrations/0003_listing_coordinates.sql`
- Modify: `server/listings-service.js` (정규화 함수의 `region` 처리 부근, INSERT·UPDATE 문, 멱등 비교), `server/listings-db.js` (`toListingDto`)
- Test: `tests/pg-integration.test.js`

**Interfaces:**
- Consumes: `isKoreaCoord`, `roundCoord` (Task 1)
- Produces:
  - `listings.lat`, `listings.lng` — `DOUBLE PRECISION NULL`
  - 매물 응답에 `lat: number|null`, `lng: number|null` 추가
  - `POST /api/listings`의 `create`·`update` 본문이 `lat`, `lng`(숫자)를 받는다. 오류 코드 `INVALID_LOCATION`(400)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/pg-integration.test.js`에 테스트 `"8. 매물 좌표 저장·반올림·검증"`을 추가한다. 기존 테스트의 매물 생성 헬퍼를 그대로 쓴다. 확인할 것:
  - `lat: 37.69724, lng: 127.88449`로 만들면 응답과 DB 값이 `37.7`, `127.88`이다. DB의 `lat::text`에 `37.69724`가 남아 있지 않다.
  - `lat`, `lng` 없이 만들면 201이고 둘 다 `null`이다.
  - `lat`만 보냄 / `lat: "37.7"` / `lat: NaN`에 해당하는 `null` 아닌 비숫자 / `lat: 40, lng: 127` → 각각 400 `INVALID_LOCATION`, 매물 수가 늘지 않는다.
  - `update`에서 좌표를 생략하면 기존 좌표가 유지되고, 새 좌표를 보내면 반올림되어 바뀐다.
  - `GET /api/listings` 응답의 각 매물에 `lat`, `lng` 키가 있다.
  - 마이그레이션 적용 후 `region = '영양읍'`이고 `is_demo = false`인 매물은 좌표가 채워진다(테스트에서 0003 적용 전 상태로 한 건 넣고 0003을 적용해 확인).
- [ ] **Step 2: 실패 확인** — Run: `node --test tests/pg-integration.test.js` → 새 테스트 FAIL
- [ ] **Step 3: 마이그레이션 작성** — `0003_listing_coordinates.sql`:
  - `lat`, `lng` 컬럼 추가(`IF NOT EXISTS`).
  - CHECK 하나: 둘 다 NULL이거나, 둘 다 값이 있고 `lat BETWEEN 33 AND 39 AND lng BETWEEN 124 AND 132`.
  - `is_demo = false`이고 좌표가 NULL이며 `region`이 영양읍·청기면·입암면·수비면인 행을 각 읍·면 행정복지센터 좌표(실제 값을 확인해 소수 둘째 자리)로 채우고, `region`을 `'경북 영양군 ' || region`으로 바꾼다.
- [ ] **Step 4: 서비스·응답 구현** — `server/listings-service.js`에 `normalizeCoords(payload, fallback): { lat: number|null, lng: number|null }`를 두고 정규화 결과·INSERT·UPDATE·멱등 비교에 `lat`, `lng`를 포함한다. `toListingDto`는 `Number(row.lat)` 또는 `null`을 돌려준다.
- [ ] **Step 5: 통과 확인** — Run: `node --test tests/pg-integration.test.js` → 전부 PASS
- [ ] **Step 6: 커밋** — `git commit -m "feat: store rounded listing coordinates"`

---

### Task 3: 예시 매물의 가짜 위치

**Files:**
- Create: `server/demo-locations.js`
- Modify: `server/listing-seed.js` (원본 14건의 `region`, `regions` 배열, `buildMockListings`), `server/migrator.js` (`seedDemoListings`의 INSERT)
- Test: `tests/demo-locations.test.js`, `tests/pg-integration.test.js`

**Interfaces:**
- Consumes: `DEFAULT_LOCATION`, `haversineKm`, `isKoreaCoord`, `roundCoord` (Task 1); `lat`·`lng` 컬럼 (Task 2)
- Produces:
  - `DEMO_PLACES: Array<{ region: string, lat: number, lng: number, highland?: true }>` — `region`은 `"강원 홍천군 서석면"` 형식
  - `buildMockListings()`의 모든 매물에 `region`, `lat`, `lng`

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/demo-locations.test.js`)

```js
const LISTINGS = buildMockListings();
test("예시 매물 100건 모두 허용 범위의 반올림된 좌표를 가진다", () => {
  assert.equal(LISTINGS.length, 100);
  for (const { lat, lng } of LISTINGS) {
    assert.ok(isKoreaCoord(lat, lng));
    assert.equal(lat, roundCoord(lat)); assert.equal(lng, roundCoord(lng));
  }
});
test("다시 만들어도 위치가 같다", () => {
  assert.deepEqual(buildMockListings().map(({ id, lat, lng, region }) => [id, lat, lng, region]),
    LISTINGS.map(({ id, lat, lng, region }) => [id, lat, lng, region]));
});
test("홍천군에 40건 이상, 홍천읍 기준 70km 안에 60건 이상 있다", () => {
  const hongcheon = LISTINGS.filter(({ region }) => region.startsWith("강원 홍천군 "));
  assert.ok(hongcheon.length >= 40);
  assert.equal(new Set(hongcheon.map(({ region }) => region)).size, 10);
  assert.ok(LISTINGS.filter((item) => haversineKm(DEFAULT_LOCATION, item) <= 70).length >= 60);
});
test("전국 20곳 이상의 시·군에 나뉘어 있다", () => {
  const counties = new Set(LISTINGS.map(({ region }) => region.split(" ").slice(0, 2).join(" ")));
  assert.ok(counties.size >= 26); // 홍천 + 인접 5 + 전국 20
});
test("영양군 지역 이름이 남아 있지 않다", () => {
  assert.ok(LISTINGS.every(({ region, title }) => !/영양|청기면|입암면|수비면/.test(region + title)));
});
test("벼 전용 장비를 고랭지(내면)에 두지 않는다", () => {
  assert.ok(LISTINGS.every(({ region, cropIds }) => !(region.endsWith(" 내면") && cropIds.join() === "rice")));
});
test("같은 좌표에 4건 넘게 겹치지 않는다", () => {
  const counts = new Map();
  for (const { lat, lng } of LISTINGS) counts.set(`${lat},${lng}`, (counts.get(`${lat},${lng}`) || 0) + 1);
  assert.ok(Math.max(...counts.values()) <= 4);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/demo-locations.test.js` → FAIL
- [ ] **Step 3: `server/demo-locations.js` 작성** — 장소 35곳 이상:
  - 홍천군 10곳: 홍천읍, 화촌면, 두촌면, 내촌면, 서석면, 영귀미면, 남면, 서면, 북방면, 내면(`highland: true`)
  - 인접 5곳: 춘천시, 횡성군, 인제군, 평창군, 경기 양평군의 농촌 읍·면 각 1곳
  - 전국 20곳 이상: 도별로 고르게 고른 농업 지역 읍·면(예: 철원, 이천, 충주, 논산, 김제, 나주, 해남, 상주, 안동, 밀양, 제주 등)
  - 좌표는 각 읍·면 행정복지센터 위치를 **실제로 조회해** 적는다. 기억으로 추정해 쓰지 않는다. 카카오맵이나 공공 주소 자료로 5곳 이상을 지도에서 열어 육지·마을 위치인지 확인한다.
- [ ] **Step 4: 시드 수정** — `buildMockListings`가 매물 순번으로 장소를 고른다: 앞쪽 가중치로 홍천 40건·인접 20건·전국 40건이 되게 한다. 같은 장소의 매물은 순번에서 계산한 고정 오프셋(±0.03도 이내)을 더한 뒤 `roundCoord`한다. `Math.random`을 쓰지 않는다. 벼 전용 매물이 `highland` 장소에 걸리면 다음 장소로 넘긴다. 원본 14건의 `region`도 홍천 지역으로 바꾸고 제목·설명에 든 "영양읍" 같은 문구를 고친다.
- [ ] **Step 5: 기존 예시 매물 갱신** — `seedDemoListings`의 INSERT에 `lat`, `lng`를 추가하고, 이미 있는 예시 매물은 `ON CONFLICT (id) DO UPDATE SET title, region, summary, description, pickup, lat, lng ... WHERE listings.is_demo`로 갱신한다. `tests/pg-integration.test.js`에 "시드를 두 번 실행해도 100건이고, 예전 지역 이름의 예시 매물이 새 좌표로 바뀐다" 확인을 추가한다.
- [ ] **Step 6: 통과 확인** — Run: `node --test tests/demo-locations.test.js tests/pg-integration.test.js tests/app.test.js` → PASS (`app.test.js`가 지역 이름에 의존하는 곳이 있으면 새 이름으로 고친다)
- [ ] **Step 7: 커밋** — `git commit -m "feat: place demo listings nationwide around Hongcheon"`

---

### Task 4: 실제 거리로 교체와 내 위치

**Files:**
- Create: `src/location.js`
- Modify: `src/data/recommendation.js:17-22,53`, `src/data/farm-machines.js:64-87`(삭제), `src/main.js`(`state.region` 사용처 전부: 96, 109, 243, 861, 879, 946, 961, 1063, 2011, 2239-2243, 2617 부근), `index.html:58-67`(내 동네 선택), `index.html:608-620`(반경), `server/agent.js`(컨텍스트 전달)
- Test: `tests/geo.test.js`, `tests/app.test.js`, `tests/browser-e2e.test.js`

**Interfaces:**
- Consumes: Task 1 전부, 매물의 `lat`·`lng` (Task 2, 3)
- Produces:
  - `compareListings(a, b, origin: {lat,lng}, sort)` — 세 번째 인자가 좌표로 바뀐다. 거리 `null`은 맨 뒤
  - `selectMatchingListings(message, context, listings)` — `context.origin: {lat,lng}`를 읽고, 없거나 잘못되면 `DEFAULT_LOCATION`
  - `normalizeLocation(saved: unknown): { lat, lng, label }` — 유효하지 않으면 `DEFAULT_LOCATION`
  - `requestCurrentPosition({ timeoutMs = 8000 } = {}): Promise<{lat,lng}|null>` — 권한 거부·시간 초과·범위 밖이면 `null`. 반올림된 좌표를 돌려준다
  - `state.location: { lat, lng, label }` (`state.region` 대체)

- [ ] **Step 1: 실패하는 테스트 작성**
  - `tests/geo.test.js`에 추가:

```js
test("거리순은 가까운 순서이고 좌표 없는 매물은 맨 뒤다", () => {
  const near = { id: "a", price: 9, inspectedAt: "2026-10-01", lat: 37.7, lng: 127.9 };
  const far = { id: "b", price: 1, inspectedAt: "2026-10-01", lat: 35.18, lng: 129.08 };
  const none = { id: "c", price: 1, inspectedAt: "2026-10-01", lat: null, lng: null };
  assert.deepEqual([none, far, near].sort((x, y) => compareListings(x, y, DEFAULT_LOCATION, "distance")).map(({ id }) => id), ["a", "b", "c"]);
});
test("저장된 예전 상태는 기본 위치로 바뀐다", () => {
  for (const saved of [undefined, "영양읍", {}, { lat: "x", lng: 1 }, { lat: 50, lng: 127 }])
    assert.deepEqual(normalizeLocation(saved), DEFAULT_LOCATION);
  assert.deepEqual(normalizeLocation({ lat: 37.5, lng: 127, label: "경기 양평군 양평읍" }), { lat: 37.5, lng: 127, label: "경기 양평군 양평읍" });
});
```

  - `tests/app.test.js`에 추가: 같은 조건의 후보에서 `context.origin`을 홍천으로 주면 첫 후보가 홍천군 매물이고, 부산 좌표로 주면 첫 후보가 달라진다.
  - `tests/browser-e2e.test.js`에 추가: `localStorage`에 예전 상태(`region: "영양읍"`)를 넣고 열어도 콘솔 오류 없이 내 위치 표시가 `강원 홍천군 홍천읍`이다. 목록 카드에 `직선 `과 `km`가 보이고 `영양`이라는 글자가 화면에 없다. 위치 권한을 거부로 설정한 컨텍스트에서 "현재 위치" 버튼을 눌러도 내 위치가 그대로이고 안내 토스트가 뜬다. 권한을 허용하고 가짜 위치를 부산으로 주면 거리순 첫 매물이 바뀐다.
- [ ] **Step 2: 실패 확인** — Run: `node --test tests/geo.test.js tests/app.test.js` → 새 테스트 FAIL
- [ ] **Step 3: 공용 모듈 교체** — `compareListings`, `selectMatchingListings`를 Interfaces대로 바꾸고 `distanceKm`·`distanceCache`를 삭제한다. `server/agent.js`의 `selectCandidates`는 `context.origin`을 그대로 넘긴다(검증은 `selectMatchingListings`에서).
- [ ] **Step 4: `src/location.js` 구현** — `normalizeLocation`, `requestCurrentPosition`. `navigator.geolocation`이 없으면 `null`.
- [ ] **Step 5: 화면 연결** — `src/main.js`의 `state.region`을 `state.location`으로 바꾼다. 저장된 상태는 `normalizeLocation`으로 읽는다. 거리 표시는 `listingDistanceKm`을 쓰고 `직선 7.2km` 형식, `null`이면 거리 부분을 생략한다. 반경 필터는 거리 `null`인 매물을 제외한다. 추천 요청 컨텍스트의 `region`을 `origin: { lat, lng }`로 바꾼다. `index.html`의 `regionSelect` 선택 목록을 현재 이름을 보여주는 버튼(`id="locationButton"`)과 "현재 위치" 버튼(`id="useCurrentLocation"`)으로 바꾼다. 현재 위치를 쓰면 이름은 `"현재 위치"`로 둔다(행정구역 이름은 Task 6에서 채운다). 반경 선택에 `50km 이내`, `100km 이내`를 추가한다.
- [ ] **Step 6: 통과 확인** — Run: `npm run check` → PASS
- [ ] **Step 7: 커밋** — `git commit -m "feat: compute real straight-line distance from my location"`

---

### Task 5: 지도 보기

**Files:**
- Create: `server/runtime-config.js`, `src/map/kakao-loader.js`, `src/map/listing-map.js`
- Modify: `dev-server.js`(정적 처리 앞에서 `/src/runtime-config.js` 응답), `scripts/build.mjs`(`dist/src/runtime-config.js` 쓰기), `index.html:240` 부근(목록/지도 전환과 지도 영역), `src/main.js`(전환·렌더 연결), `src/styles.css`, `.env.example`, `README.md`
- Test: `tests/runtime-config.test.js`, `tests/browser-e2e.test.js`

**Interfaces:**
- Consumes: `state.location`, 필터가 적용된 매물 목록(`filteredListings()`), `listingDistanceKm`
- Produces:
  - `runtimeConfigSource(env = process.env): string` — `export const KAKAO_MAP_APP_KEY = "…";\n` 한 줄. 키가 `/^[A-Za-z0-9]{10,64}$/`에 맞지 않으면 빈 문자열을 넣는다
  - 브라우저 모듈 `/src/runtime-config.js` — `KAKAO_MAP_APP_KEY`
  - `loadKakao(): Promise<typeof kakao | null>` — 키가 비었거나 스크립트 오류·6초 초과면 `null`. 한 번만 로드하고 결과를 재사용
  - `createListingMap(container: HTMLElement, { onSelect(id: string): void }): Promise<{ render(items, origin): void, relayout(): void } | null>`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `tests/runtime-config.test.js`:

```js
test("키가 없으면 빈 문자열을 내보낸다", () =>
  assert.equal(runtimeConfigSource({}), 'export const KAKAO_MAP_APP_KEY = "";\n'));
test("정상 키는 그대로 내보낸다", () =>
  assert.equal(runtimeConfigSource({ KAKAO_MAP_APP_KEY: "abc123DEF456abc123DEF456abc12345" }),
    'export const KAKAO_MAP_APP_KEY = "abc123DEF456abc123DEF456abc12345";\n'));
test("형식이 다른 값은 내보내지 않는다", () => {
  for (const bad of ['";alert(1)//', "short", "a b c d e f g h i j k", "</script>"])
    assert.equal(runtimeConfigSource({ KAKAO_MAP_APP_KEY: bad }), 'export const KAKAO_MAP_APP_KEY = "";\n');
});
test("기상청 키는 포함하지 않는다", () =>
  assert.ok(!runtimeConfigSource({ KMA_SERVICE_KEY: "secretsecretsecret" }).includes("secret")));
```

  - `tests/browser-e2e.test.js`에 추가(키 없는 상태): "지도" 전환을 누르면 `지도를 불러올 수 없습니다` 안내가 보이고 콘솔 오류가 없다. "목록"으로 돌아가면 카드가 그대로 보인다. `dapi.kakao.com` 요청을 Playwright로 차단한 상태에서도 같다.
- [ ] **Step 2: 실패 확인** — Run: `node --test tests/runtime-config.test.js` → FAIL
- [ ] **Step 3: 설정 전달 구현** — `runtimeConfigSource`를 만들고, `dev-server.js`는 `/src/runtime-config.js` 요청에 이 문자열을 `application/javascript`로 응답한다. `scripts/build.mjs`는 `src` 복사 뒤 `dist/src/runtime-config.js`에 쓴다. 소스 트리에는 이 파일을 만들지 않는다.
- [ ] **Step 4: `loadKakao` 구현** — 스크립트 주소 `https://dapi.kakao.com/v2/maps/sdk.js?appkey=<키>&libraries=services,clusterer&autoload=false`, 로드 후 `kakao.maps.load()`로 초기화. 주소와 초기화 방식은 카카오맵 Web API 공식 문서에서 확인한다.
- [ ] **Step 5: `createListingMap` 구현** — 처음 중심은 `origin`, 배율은 홍천군과 인접 시·군이 한 화면에 들어오는 값. 내 위치 마커 1개, 좌표가 있는 매물마다 마커, `MarkerClusterer`로 묶음. 마커를 누르면 `onSelect(id)`. `render`는 기존 마커를 지우고 다시 그린다. 지도는 처음 "지도" 전환을 눌렀을 때 만들고, 숨겨졌다 보일 때 `relayout()`을 부른다.
- [ ] **Step 6: 화면 연결** — `index.html`에 `목록 | 지도` 전환 버튼(`id="viewList"`, `id="viewMap"`), 지도 영역(`id="listingMap"`), 선택한 매물 요약 카드 영역(`id="mapSelection"`)을 추가한다. 요약 카드는 제목, 지역, `직선 N.Nkm`, 가격을 보여주고 예시 매물이면 `예시 위치`를 붙인다. 카드를 누르면 기존 상세 화면을 연다. 필터·검색어·정렬이 바뀌면 지도도 다시 그린다. `createListingMap`이 `null`이면 지도 영역에 `지도를 불러올 수 없습니다. 목록에서 매물을 확인해 주세요.`를 보여준다. 상세 화면의 예시 매물에도 `예시 위치`를 붙인다.
- [ ] **Step 7: 문서** — `.env.example`에 `KAKAO_MAP_APP_KEY=`와 도메인 등록 안내 주석을, `README.md`에 "지도 연결" 절(키 발급, 운영·프리뷰·`localhost:3000` 도메인 등록)을 추가한다. README의 "지도 거리도 영양군 네 지역 사이의 예시값" 문장을 현재 상태로 고친다.
- [ ] **Step 8: 통과 확인** — Run: `npm run check && npm run build` → PASS, `dist/src/runtime-config.js`가 생긴다
- [ ] **Step 9: 키를 넣고 손으로 확인** — `.env.local`에 사용자가 넣은 키로 `npm run dev`를 띄워, 홍천 주변 마커, 축소 시 묶음, 마커 선택 카드, 필터 변경 반영을 확인한다. 키가 없으면 이 단계를 건너뛰고 건너뛰었다고 보고한다.
- [ ] **Step 10: 커밋** — `git commit -m "feat: show listings on a nationwide map"`

---

### Task 6: 지도에서 위치 지정 (매물 등록·내 위치)

**Files:**
- Create: `src/map/location-picker.js`
- Modify: `src/main.js:1688-1760, 1818`(등록·수정 화면의 `editRegion`), 내 위치 버튼 처리, `src/styles.css`
- Test: `tests/browser-e2e.test.js`

**Interfaces:**
- Consumes: `loadKakao` (Task 5), `requestCurrentPosition`, `roundCoord`, `isKoreaCoord`, 매물 API의 `lat`·`lng` (Task 2)
- Produces:
  - `pickLocation({ initial: {lat,lng}, title: string }): Promise<{ lat, lng, label } | null>` — 취소하거나 SDK가 없으면 `null`. 좌표는 반올림된 값, `label`은 `"시·도 시·군·구 읍·면·동"`
  - `regionLabelAt(kakao, lat, lng): Promise<string|null>` — 좌표→행정구역 이름(행정동 기준)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/browser-e2e.test.js`에 추가(키 없는 상태):
  - 등록 화면에 안내문 `약 1km 단위로 흐리게 저장되며 정확한 주소는 공개되지 않습니다`가 보인다.
  - "지도에서 선택" 버튼이 비활성이고, 지역 이름 직접 입력(`id="editRegionText"`)과 "현재 위치 사용"으로 등록할 수 있다. 가짜 위치(37.69724, 127.88449)를 허용하고 "현재 위치 사용" 후 등록하면 응답의 좌표가 `37.7`, `127.88`이다.
  - 위치 권한을 거부한 상태에서 지역 이름만 적어 등록하면 성공하고 좌표는 `null`이다.
  - 지역 이름이 비어 있으면 등록되지 않는다.
- [ ] **Step 2: 실패 확인** — Run: `node --test tests/browser-e2e.test.js` → FAIL
- [ ] **Step 3: `location-picker.js` 구현** — 대화상자에 지도를 띄우고, 지도를 누르면 핀이 옮겨지며 `regionLabelAt`으로 이름을 갱신한다. "이 위치로 정하기"를 누르면 값을 돌려준다. 범위 밖을 찍으면 확정 버튼을 비활성으로 둔다. 좌표→행정구역 변환은 카카오 `services.Geocoder`의 좌표→행정구역 API를 쓰며 호출 방식은 공식 문서에서 확인한다.
- [ ] **Step 4: 등록·수정 화면 연결** — `editRegion` 선택 목록을 없애고, 지역 이름 입력란(`editRegionText`, 최대 40자, 필수), "지도에서 선택", "현재 위치 사용" 버튼, 안내문을 둔다. 지도나 현재 위치로 정하면 이름 입력란과 숨은 좌표 값이 채워진다. 이름을 손으로 고쳐도 좌표는 유지한다. 저장 요청에 `region`, `lat`, `lng`를 보낸다. 수정 화면은 기존 좌표를 초기값으로 쓴다.
- [ ] **Step 5: 내 위치 연결** — `locationButton`을 누르면 `pickLocation`을 열어 내 위치를 바꾼다. SDK가 없으면 버튼은 이름만 보여준다. "현재 위치"로 정한 뒤 SDK가 있으면 `regionLabelAt`으로 이름을 채운다.
- [ ] **Step 6: 통과 확인** — Run: `npm run check` → PASS
- [ ] **Step 7: 키를 넣고 손으로 확인** — 지도에서 서석면을 찍어 등록하면 지역 이름이 `강원 홍천군 서석면`으로 들어가고 지도 보기에 마커가 생기는지 확인한다. 키가 없으면 건너뛰고 보고한다.
- [ ] **Step 8: 커밋** — `git commit -m "feat: pick listing and home location on the map"`

---

### Task 7: 날씨 서버

**Files:**
- Create: `server/migrations/0004_weather_cache.sql`, `server/weather.js`, `api/weather.js`, `tests/fixtures/kma-vilage-fcst.json`
- Modify: `server/rate-limit.js:28-42`(정책 추가), `dev-server.js`(`/api/weather` 연결), `.env.example`, `README.md`
- Test: `tests/weather.test.js`, `tests/pg-integration.test.js`

**Interfaces:**
- Consumes: `isKoreaCoord` (Task 1), `enforceRateLimit`, `handle`, `queryParams`, `getPool`
- Produces:
  - `toKmaGrid(lat, lng): { nx: number, ny: number }`
  - `latestBaseTime(now: Date): { baseDate: "YYYYMMDD", baseTime: "HHMM" }` — 한국 시간 기준, 발표 시각 02·05·08·11·14·17·20·23시, 발표 후 10분이 지나야 그 시각을 쓴다
  - `summarizeForecast(items: Array<{category, fcstDate, fcstTime, fcstValue}>): WeatherDay[]`
  - `WeatherDay = { date: "YYYY-MM-DD", sky: "맑음"|"구름많음"|"흐림", precip: "없음"|"비"|"비/눈"|"눈"|"소나기", pop: number, tmin: number|null, tmax: number|null, windMax: number|null }`
  - `getForecast({ lat, lng }, { now, fetchImpl, pool, env }): Promise<{ days: WeatherDay[] }>` — 실패하면 `{ days: [] }`
  - `GET /api/weather?lat=&lng=` → 200 `{ days }`. 좌표가 잘못되면 400 `INVALID_LOCATION`
  - 테이블 `weather_cache(nx INTEGER, ny INTEGER, base TEXT, payload JSONB, fetched_at TIMESTAMPTZ, PRIMARY KEY (nx, ny))`
  - 호출 제한 정책 `weather: { failOpen: true, limits: [perMinute(30), perDay(600)] }`

- [ ] **Step 1: 응답 예시 파일 준비** — `tests/fixtures/kma-vilage-fcst.json`에 기상청 `getVilageFcst` JSON 응답 형식(`response.header.resultCode`, `response.body.items.item[]`)으로 이틀치 항목을 넣는다. 첫날: `SKY` 4, `PTY` 1이 낮에 있고 `POP` 최대 60, `TMN` 3.0, `TMX` 11.0, `WSD` 최대 4.2. 둘째 날: `SKY` 1, `PTY` 0, `POP` 최대 10, `TMN`·`TMX` 없음, `TMP` 2~9. 응답 형식과 분류 코드는 공공데이터포털의 서비스 활용 가이드에서 확인한다.
- [ ] **Step 2: 실패하는 테스트 작성** (`tests/weather.test.js`)

```js
test("서울시청은 격자 (60, 127)이다", () => assert.deepEqual(toKmaGrid(37.5665, 126.978), { nx: 60, ny: 127 }));
test("발표 시각은 한국 시간 기준으로 10분 뒤부터 쓴다", () => {
  assert.deepEqual(latestBaseTime(new Date("2026-11-16T20:05:00Z")), { baseDate: "20261117", baseTime: "0200" }); // KST 05:05
  assert.deepEqual(latestBaseTime(new Date("2026-11-16T20:10:00Z")), { baseDate: "20261117", baseTime: "0500" }); // KST 05:10
  assert.deepEqual(latestBaseTime(new Date("2026-11-16T16:00:00Z")), { baseDate: "20261116", baseTime: "2300" }); // KST 01:00
});
test("예보를 날짜별로 정리한다", () => {
  const [first, second] = summarizeForecast(fixture.response.body.items.item);
  assert.deepEqual(first, { date: first.date, sky: "흐림", precip: "비", pop: 60, tmin: 3, tmax: 11, windMax: 4.2 });
  assert.deepEqual({ sky: second.sky, precip: second.precip, pop: second.pop, tmin: second.tmin, tmax: second.tmax }, { sky: "맑음", precip: "없음", pop: 10, tmin: 2, tmax: 9 });
});
test("비정상 응답에는 빈 예보를 돌려준다", async () => {
  const cases = [
    async () => new Response("<html>SERVICE ERROR</html>", { status: 200 }),
    async () => Response.json({ response: { header: { resultCode: "03", resultMsg: "NO_DATA" } } }),
    async () => Response.json({ response: { header: { resultCode: "00" }, body: { items: { item: [] } } } }),
    async () => new Response("", { status: 500 }),
    async () => { throw new Error("timeout"); },
  ];
  for (const fetchImpl of cases)
    assert.deepEqual(await getForecast({ lat: 37.7, lng: 127.89 }, { fetchImpl, pool, env: { KMA_SERVICE_KEY: "k" } }), { days: [] });
});
test("키가 없으면 기상청을 부르지 않는다", async () => {
  let called = 0;
  assert.deepEqual(await getForecast({ lat: 37.7, lng: 127.89 }, { fetchImpl: async () => { called++; }, pool, env: {} }), { days: [] });
  assert.equal(called, 0);
});
test("같은 격자·같은 발표 시각은 한 번만 요청한다", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return Response.json(fixture); };
  const options = { fetchImpl, pool, env: { KMA_SERVICE_KEY: "k" }, now: new Date("2026-11-16T20:30:00Z") };
  await getForecast({ lat: 37.7, lng: 127.89 }, options);
  await getForecast({ lat: 37.7, lng: 127.89 }, options);
  assert.equal(called, 1);
  await getForecast({ lat: 37.7, lng: 127.89 }, { ...options, now: new Date("2026-11-16T23:30:00Z") });
  assert.equal(called, 2);
});
```

  (`pool`은 `createPglitePool()`에 마이그레이션을 적용해 만든다. `tests/pg-integration.test.js`의 준비 방식을 따른다.) `tests/pg-integration.test.js`에는 `GET /api/weather`가 좌표 없음·국외 좌표에 400 `INVALID_LOCATION`, 정상 좌표에 키가 없어도 200 `{ days: [] }`를 주는지 추가한다.
- [ ] **Step 3: 실패 확인** — Run: `node --test tests/weather.test.js` → FAIL
- [ ] **Step 4: 격자 변환·발표 시각·정리 구현** — 격자 변환은 기상청 람베르트 정각원추도법 상수를 쓴다: 지구 반지름 6371.00877km, 격자 간격 5km, 표준위도 30°·60°, 기준 경도 126°, 기준 위도 38°, 기준점 X 43, Y 136. 하루 정리 규칙: `sky`는 06~18시 `SKY`의 최빈값(1 맑음, 3 구름많음, 4 흐림), `precip`는 그날 `PTY` 중 0이 아닌 첫 값(1 비, 2 비/눈, 3 눈, 4 소나기), `pop`은 `POP` 최댓값, `tmin`·`tmax`는 `TMN`·`TMX`가 있으면 그 값, 없으면 `TMP`의 최소·최대, `windMax`는 `WSD` 최댓값. 숫자는 소수 첫째 자리까지.
- [ ] **Step 5: `getForecast` 구현** — 요청 주소 `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst`, 인자 `serviceKey`, `dataType=JSON`, `numOfRows=1000`, `pageNo=1`, `base_date`, `base_time`, `nx`, `ny`. 시간 제한 5초. 성공한 결과만 `weather_cache`에 `(nx, ny)` 기준으로 덮어쓴다. 캐시의 `base`가 현재 발표 시각과 같으면 기상청을 부르지 않는다. 키와 요청 주소를 로그에 남기지 않는다.
- [ ] **Step 6: API 연결** — `api/weather.js`는 `handle(["GET"], …)`로 좌표를 검증하고 `enforceRateLimit(request, "weather")` 뒤 `getForecast`를 부른다. `dev-server.js`의 `apiRouteLoaders`에 추가한다. `.env.example`에 `KMA_SERVICE_KEY=`를, `README.md`에 "날씨 연결" 절(공공데이터포털 "기상청_단기예보 조회서비스" 활용 신청, 서버 환경 변수로만 설정)을 추가한다.
- [ ] **Step 7: 통과 확인** — Run: `npm run check` → PASS
- [ ] **Step 8: 커밋** — `git commit -m "feat: add cached KMA short-term forecast API"`

---

### Task 8: 날씨 표시와 추천 안내

**Files:**
- Create: `src/weather.js`
- Modify: `src/main.js`(날짜 필터, 대여 요청 날짜 선택, 추천 답변 표시 `2024-2081` 부근), `index.html:620` 부근(날짜 필터 아래 날씨 줄), `src/styles.css`
- Test: `tests/weather-ui.test.js`, `tests/browser-e2e.test.js`

**Interfaces:**
- Consumes: `GET /api/weather` (Task 7), `WeatherDay`, `state.location`, `OPERATION_BY_ID`
- Produces:
  - `fetchWeather(origin: {lat,lng}): Promise<WeatherDay[]>` — 실패하면 `[]`. 같은 좌표는 10분 동안 다시 요청하지 않는다
  - `formatWeatherLine(day: WeatherDay): string`
  - `weatherAdvice(day: WeatherDay, operationIds: string[]): string|null`

> 설계 문서는 "예보를 AI 프롬프트에 넣는다"고 했으나, 현재 `server/agent.js`의 `recommend`는 모델이 쓴 답변을 버리고 `recommendationGuide`의 문장만 쓴다(`tests/app.test.js`의 "모델은 … 답변과 매물 ID를 지정할 수 없다"). 그래서 날씨 안내는 모델이 아니라 정해진 규칙(`weatherAdvice`)으로 만들어 추천 답변 아래에 붙인다. 키 없이도 동작하고 예보 값을 지어낼 수 없다.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/weather-ui.test.js`)

```js
const rainy = { date: "2026-11-17", sky: "흐림", precip: "비", pop: 60, tmin: 3, tmax: 11, windMax: 4.2 };
const clear = { date: "2026-11-18", sky: "맑음", precip: "없음", pop: 10, tmin: 2, tmax: 9, windMax: 2 };
test("날씨 한 줄 형식", () => {
  assert.equal(formatWeatherLine(rainy), "11/17(화) 흐리고 비 60% · 3~11℃");
  assert.equal(formatWeatherLine(clear), "11/18(수) 맑음 · 2~9℃");
  assert.equal(formatWeatherLine({ ...clear, tmin: null, tmax: null }), "11/18(수) 맑음");
});
test("비 예보가 있으면 비에 약한 작업에 안내한다", () => {
  assert.equal(weatherAdvice(rainy, ["spray"]), "11/17 비 예보(60%)가 있어 방제 작업은 날짜를 다시 확인해 보세요.");
  assert.equal(weatherAdvice(clear, ["spray"]), null);
  assert.equal(weatherAdvice(rainy, ["transport"]), null);
});
test("바람이 강하면 방제 작업에 안내한다", () =>
  assert.equal(weatherAdvice({ ...clear, windMax: 8 }, ["spray"]), "11/18 바람이 강할 것으로 예보되어(최대 8m/s) 방제 작업은 날짜를 다시 확인해 보세요."));
```

  `tests/browser-e2e.test.js`에 추가: Playwright로 `/api/weather`를 가로채 위 `rainy` 하루를 돌려주고, 대여 날짜 필터에 그 날짜를 고르면 `11/17(화) 흐리고 비 60% · 3~11℃`가 보인다. 예보에 없는 날짜를 고르면 날씨 줄이 없다. `/api/weather`가 500을 주거나 `{ days: [] }`를 줘도 콘솔 오류 없이 날씨 줄만 없고, 검색과 대여 요청은 정상이다.
- [ ] **Step 2: 실패 확인** — Run: `node --test tests/weather-ui.test.js` → FAIL
- [ ] **Step 3: `src/weather.js` 구현** — 하늘·강수 문구: 강수가 `없음`이면 하늘 상태만(`맑음`, `구름많음`, `흐림`), 강수가 있으면 `흐리고 비 60%`처럼 `<하늘 연결형> <강수> <강수확률>%`(맑음→`맑고`, 구름많음→`구름 많고`, 흐림→`흐리고`). 안내 규칙: 강수가 있고 강수확률 60 이상이면 비에 약한 작업(`spray`, `till`, `ridge`, `mulch`, `transplant`, `seed`, `ricePlant`, `riceHarvest`, `potatoHarvest`, `hill`, `level` 중 `OPERATION_BY_ID`에 있는 것)에 안내하고, 최대 풍속 7m/s 이상이면 `spray`에 안내한다. 작업 이름은 `OPERATION_BY_ID[id].label`의 첫 번째 해당 작업을 쓴다. 비 안내가 바람 안내보다 우선한다.
- [ ] **Step 4: 화면 연결** — 대여 날짜 필터와 대여 요청의 날짜 선택 아래에 날씨 줄을 둔다(시작일 기준). 내 위치나 날짜가 바뀌면 갱신한다. 예보에 그 날짜가 없으면 줄을 지운다. 추천 답변을 표시할 때 대여 시작일의 예보가 있고 `weatherAdvice`가 문장을 돌려주면 답변 아래에 날씨 줄과 안내 문장을 붙인다.
- [ ] **Step 5: 통과 확인** — Run: `npm run check && npm run build` → PASS
- [ ] **Step 6: 키를 넣고 손으로 확인** — `KMA_SERVICE_KEY`를 넣은 로컬에서 오늘~모레 날짜를 골라 날씨 줄이 보이고, 4일 뒤 날짜에는 보이지 않는지 확인한다. 내 위치를 홍천읍에서 내면 쪽으로 바꾸면 값이 달라지는지 본다. 키가 없으면 건너뛰고 보고한다.
- [ ] **Step 7: 커밋** — `git commit -m "feat: show forecast for rental dates and recommendation advice"`

---

## 마무리 확인

- [ ] `npm run check`와 `npm run build`가 키 없는 환경에서 통과한다.
- [ ] `git grep -n "영양\|distanceKm("` 결과가 문서와 마이그레이션 0003 외에는 없다.
- [ ] `git grep -n "KMA_SERVICE_KEY" -- src index.html` 결과가 없다.
- [ ] Vercel 프리뷰에 두 키를 넣고(사용자가 직접) 지도·등록 위치 지정·날씨를 한 번씩 확인한다. 프리뷰 DB에 `npm run db:migrate`, `npm run db:seed`를 실행해 예시 매물이 홍천 주변으로 바뀌었는지 본다.
