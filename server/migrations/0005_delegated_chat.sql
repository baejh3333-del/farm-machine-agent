-- 0005_delegated_chat.sql: 1:1 대리 채팅 위임 정책·상태 및 메시지 발신 주체 확장

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
