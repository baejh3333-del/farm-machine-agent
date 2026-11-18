-- 0009_trade_offers.sql: 구조화된 거래 조건(제안) 버전과 양측 수락 기록, 신청서-합의 연결
-- - 대화방마다 조건 버전(terms_version)이 단조 증가하고, 같은 버전에 구매자·판매자 수락이 모두 있어야 합의(accepted)다.
-- - 운송비가 미정(transport_payer/transport_fee NULL)이면 조건이 미완성이며 신청 대상이 아니다.
--   명시적 직접 인수(transport_payer = 'none')만 운송비 0원으로 본다.
-- - 신청서(rental_requests/purchase_orders)는 offer_id로 합의에 연결되고, 같은 합의로는 한 번만 신청된다.

CREATE TABLE IF NOT EXISTS trade_offers (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  terms_version INTEGER NOT NULL CHECK (terms_version > 0),
  from_role TEXT NOT NULL CHECK (from_role IN ('buyer', 'owner')),
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('human', 'ai_proxy')),
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  listing_type TEXT NOT NULL CHECK (listing_type IN ('rent', 'sale')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  amount_unit TEXT NOT NULL CHECK (amount_unit IN ('total', 'daily')),
  start_date DATE,
  end_date DATE,
  days INTEGER CHECK (days IS NULL OR days > 0),
  item_total INTEGER NOT NULL CHECK (item_total >= 0),
  transport_fee INTEGER CHECK (transport_fee IS NULL OR transport_fee >= 0),
  transport_payer TEXT CHECK (transport_payer IS NULL OR transport_payer IN ('buyer', 'owner', 'none')),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'superseded', 'rejected', 'withdrawn')),
  buyer_accepted_at TIMESTAMPTZ,
  buyer_accepted_kind TEXT CHECK (buyer_accepted_kind IS NULL OR buyer_accepted_kind IN ('human', 'ai_proxy')),
  owner_accepted_at TIMESTAMPTZ,
  owner_accepted_kind TEXT CHECK (owner_accepted_kind IS NULL OR owner_accepted_kind IN ('human', 'ai_proxy')),
  message_id UUID REFERENCES messages(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, terms_version),
  CHECK (amount_unit = 'total' OR listing_type = 'rent'),
  CHECK (listing_type = 'sale' OR (start_date IS NOT NULL AND end_date IS NOT NULL AND days IS NOT NULL AND end_date >= start_date)),
  CHECK (transport_payer IS DISTINCT FROM 'none' OR transport_fee = 0),
  CHECK (status <> 'accepted' OR (buyer_accepted_at IS NOT NULL AND owner_accepted_at IS NOT NULL))
);

-- 대화방마다 열린 제안·합의는 각각 최대 1개
CREATE UNIQUE INDEX IF NOT EXISTS trade_offers_one_open_idx
  ON trade_offers (conversation_id) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS trade_offers_one_accepted_idx
  ON trade_offers (conversation_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS trade_offers_conversation_idx
  ON trade_offers (conversation_id, terms_version DESC);

-- 대여 신청: 합의 금액을 그대로 저장한다.
-- total_price = 신청 대여료 총액(운송비 제외), daily_price = 표시용 일단가.
-- 합의 연결이 없는 레거시/직접 신청 행은 기존처럼 total_price = daily_price * days 를 유지한다.
ALTER TABLE rental_requests
  ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES trade_offers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS list_daily_price INTEGER CHECK (list_daily_price IS NULL OR list_daily_price >= 0),
  ADD COLUMN IF NOT EXISTS transport_fee INTEGER CHECK (transport_fee IS NULL OR transport_fee >= 0),
  ADD COLUMN IF NOT EXISTS transport_payer TEXT
    CHECK (transport_payer IS NULL OR transport_payer IN ('buyer', 'owner', 'none')),
  ADD COLUMN IF NOT EXISTS created_via TEXT NOT NULL DEFAULT 'human'
    CHECK (created_via IN ('human', 'buyer_ai', 'legacy_ai'));

ALTER TABLE rental_requests DROP CONSTRAINT IF EXISTS rental_requests_total_price_check;
ALTER TABLE rental_requests
  ADD CONSTRAINT rental_requests_total_price_check
  CHECK (total_price >= 0 AND (offer_id IS NOT NULL OR total_price = daily_price::bigint * days));

CREATE UNIQUE INDEX IF NOT EXISTS rental_requests_offer_once_idx
  ON rental_requests (offer_id) WHERE offer_id IS NOT NULL;

-- 구매 신청: 합의 연결, 운송비, 생성 주체
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES trade_offers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS transport_fee INTEGER CHECK (transport_fee IS NULL OR transport_fee >= 0),
  ADD COLUMN IF NOT EXISTS transport_payer TEXT
    CHECK (transport_payer IS NULL OR transport_payer IN ('buyer', 'owner', 'none')),
  ADD COLUMN IF NOT EXISTS created_via TEXT NOT NULL DEFAULT 'human'
    CHECK (created_via IN ('human', 'buyer_ai', 'legacy_ai'));

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_offer_once_idx
  ON purchase_orders (offer_id) WHERE offer_id IS NOT NULL;

-- 과거 대리 채팅이 만든 행은 합의 근거가 없으므로 출처만 표시한다(권한·중복 판단 근거로 쓰지 않음).
UPDATE purchase_orders SET created_via = 'legacy_ai'
WHERE agent_session_id IS NULL AND note LIKE '거래 전담 모드로 자동 접수%' AND created_via = 'human';
UPDATE rental_requests SET created_via = 'legacy_ai'
WHERE note LIKE '거래 전담 모드로 자동 접수%' AND created_via = 'human';
