-- 0008_role_scoped_ai_state.sql
-- 대리 응대 상태(일시정지·초안·정책 버전·읽음)를 구매자/판매자 역할별로 분리하고,
-- 판매자 매물 단위 "들어오는 문의" 위임 정책을 명시적으로 저장한다.
-- 레거시 공유 컬럼(ai_paused_reason, ai_draft_json)은 호환용으로만 남기며 권한 판단 근거로 쓰지 않는다.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS buyer_ai_pause TEXT,
  ADD COLUMN IF NOT EXISTS owner_ai_pause TEXT,
  ADD COLUMN IF NOT EXISTS buyer_ai_policy_version INTEGER NOT NULL DEFAULT 0
    CHECK (buyer_ai_policy_version >= 0),
  ADD COLUMN IF NOT EXISTS owner_ai_policy_version INTEGER NOT NULL DEFAULT 0
    CHECK (owner_ai_policy_version >= 0),
  ADD COLUMN IF NOT EXISTS buyer_ai_draft_json JSONB,
  ADD COLUMN IF NOT EXISTS owner_ai_draft_json JSONB,
  ADD COLUMN IF NOT EXISTS buyer_last_read_seq BIGINT NOT NULL DEFAULT 0
    CHECK (buyer_last_read_seq >= 0),
  ADD COLUMN IF NOT EXISTS owner_last_read_seq BIGINT NOT NULL DEFAULT 0
    CHECK (owner_last_read_seq >= 0);

-- 레거시 공유 초안을 대상 사용자의 역할 칸으로 옮긴다.
UPDATE conversations c
SET buyer_ai_draft_json = c.ai_draft_json
WHERE c.ai_draft_json IS NOT NULL
  AND c.buyer_ai_draft_json IS NULL
  AND (c.ai_draft_json->>'targetUserId' = c.buyer_id OR c.ai_draft_json->>'targetRole' = 'buyer');

UPDATE conversations c
SET owner_ai_draft_json = c.ai_draft_json
FROM listings l
WHERE l.id = c.listing_id
  AND c.ai_draft_json IS NOT NULL
  AND c.owner_ai_draft_json IS NULL
  AND (c.ai_draft_json->>'targetUserId' = l.owner_id OR c.ai_draft_json->>'targetRole' = 'owner')
  AND c.buyer_ai_draft_json IS DISTINCT FROM c.ai_draft_json;

-- 레거시 공유 일시정지: 에스컬레이션은 초안 대상 역할에만, 대상이 불명확하면 양쪽에 보수적으로 복사.
UPDATE conversations c
SET buyer_ai_pause = c.ai_paused_reason
WHERE c.ai_paused_reason IS NOT NULL
  AND c.buyer_ai_pause IS NULL
  AND (
    c.buyer_ai_draft_json IS NOT NULL
    OR c.ai_draft_json IS NULL
    OR c.ai_draft_json->>'targetUserId' IS NULL
    OR c.ai_paused_reason NOT LIKE 'escalated:%'
  );

UPDATE conversations c
SET owner_ai_pause = c.ai_paused_reason
WHERE c.ai_paused_reason IS NOT NULL
  AND c.owner_ai_pause IS NULL
  AND (
    c.owner_ai_draft_json IS NOT NULL
    OR c.ai_draft_json IS NULL
    OR c.ai_draft_json->>'targetUserId' IS NULL
    OR c.ai_paused_reason NOT LIKE 'escalated:%'
  );

-- 기존 대화가 배포 직후 전부 "안 읽음"으로 보이지 않게 현재 seq까지 읽음 처리한다.
UPDATE conversations
SET buyer_last_read_seq = GREATEST(buyer_last_read_seq, last_seq),
    owner_last_read_seq = GREATEST(owner_last_read_seq, last_seq);

-- 판매자 매물 단위 "들어오는 문의 맡기기" 정책. 새 대화 생성 시에만 판매자 칸으로 복사된다.
CREATE TABLE IF NOT EXISTS listing_ai_policies (
  listing_id TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'copilot', 'autonomous')),
  policy JSONB NOT NULL DEFAULT '{}',
  policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_ai_policies_owner_idx ON listing_ai_policies (owner_id);

-- 시연 농가(demo-owner) 매물에도 자동 위임을 부여하지 않는다. 과거의 암묵적 자동 응답은 제거되며,
-- 판매자 자동 응대는 판매자 본인이 명시적으로 저장한 정책(대화별 owner_ai_mode 또는 이 테이블)으로만 동작한다.
