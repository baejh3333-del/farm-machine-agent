-- 0010_delegation_jobs.sql: 대리 응대 실행을 DB에 영속화하는 작업 큐
-- 같은 수신 이벤트(대화방·역할·트리거 seq)는 작업 1건으로만 기록되고, 임대(lease)·재시도·실패 상태가
-- 서버 재시작이나 서버리스 종료 후에도 남는다. 정기 스윕(/api/delegation-jobs)이 만료 임대와 재시도를 회수한다.

CREATE TABLE IF NOT EXISTS delegation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  target_role TEXT NOT NULL CHECK (target_role IN ('buyer', 'owner')),
  trigger_seq INTEGER NOT NULL CHECK (trigger_seq > 0),
  kind TEXT NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry', 'succeeded', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_owner TEXT CHECK (lease_owner IS NULL OR char_length(lease_owner) <= 80),
  lease_until TIMESTAMPTZ,
  last_reason TEXT CHECK (last_reason IS NULL OR char_length(last_reason) <= 120),
  last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  result JSONB,
  source TEXT NOT NULL DEFAULT 'event' CHECK (source IN ('event', 'chain', 'backfill', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT delegation_jobs_event_once UNIQUE (conversation_id, target_role, trigger_seq, kind),
  CONSTRAINT delegation_jobs_running_has_lease CHECK (
    status <> 'running' OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS delegation_jobs_due_idx
  ON delegation_jobs (next_attempt_at)
  WHERE status IN ('queued', 'retry');
CREATE INDEX IF NOT EXISTS delegation_jobs_lease_idx
  ON delegation_jobs (lease_until)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS delegation_jobs_conversation_idx
  ON delegation_jobs (conversation_id, target_role, trigger_seq DESC);
