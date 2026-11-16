-- 에이전트 상담 코어: 세션, 턴, 거래 초안, 구매 신청, 도구 호출 기록, 농가 프로필

CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  intent TEXT CHECK (intent IS NULL OR intent IN ('rent', 'buy', 'sell')),
  stage TEXT NOT NULL DEFAULT 'collecting'
    CHECK (stage IN ('collecting', 'confirming', 'submitted', 'closed')),
  slots JSONB NOT NULL DEFAULT '{}',
  last_seq INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_sessions_user_idx ON agent_sessions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('rental_request', 'purchase_order', 'listing')),
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL
    CHECK (status IN ('collecting', 'awaiting_confirm', 'confirmed', 'cancelled', 'expired')),
  result_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_actions_one_open_idx
  ON agent_actions (session_id) WHERE status IN ('collecting', 'awaiting_confirm');

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  price INTEGER NOT NULL CHECK (price >= 0),
  pickup TEXT NOT NULL DEFAULT '' CHECK (char_length(pickup) <= 120),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  agent_session_id UUID REFERENCES agent_sessions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_one_accepted_idx
  ON purchase_orders (listing_id) WHERE status = 'accepted';
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_one_pending_idx
  ON purchase_orders (listing_id, buyer_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS purchase_orders_buyer_idx ON purchase_orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_listing_idx ON purchase_orders (listing_id, status);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE RESTRICT,
  message_id UUID REFERENCES agent_messages(id) ON DELETE RESTRICT,
  tool TEXT NOT NULL CHECK (char_length(tool) <= 80),
  args JSONB NOT NULL DEFAULT '{}',
  result JSONB NOT NULL DEFAULT '{}',
  ok BOOLEAN NOT NULL,
  error_code TEXT,
  latency_ms INTEGER,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_tool_calls_session_idx ON agent_tool_calls (session_id, created_at);

CREATE TABLE IF NOT EXISTS farm_profiles (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE RESTRICT,
  region TEXT NOT NULL DEFAULT '' CHECK (char_length(region) <= 40),
  crop_ids TEXT[] NOT NULL DEFAULT '{}',
  area_pyeong INTEGER,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rental_requests
  ADD COLUMN IF NOT EXISTS agent_session_id UUID REFERENCES agent_sessions(id) ON DELETE RESTRICT;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form', 'agent'));
