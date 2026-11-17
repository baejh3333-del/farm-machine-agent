-- 보험 상담 신청 (농농 채팅). 가입·결제는 하지 않고 상담 신청만 남긴다.
CREATE TABLE IF NOT EXISTS insurance_consult_requests (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL CHECK (char_length(product_id) BETWEEN 1 AND 80),
  office_id TEXT NOT NULL CHECK (char_length(office_id) BETWEEN 1 AND 80),
  listing_id TEXT REFERENCES listings(id) ON DELETE RESTRICT,
  reservation_kind TEXT CHECK (reservation_kind IS NULL OR reservation_kind IN ('rental', 'purchase')),
  region TEXT NOT NULL DEFAULT '' CHECK (char_length(region) <= 40),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'contacted', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insurance_consult_requests_user_idx ON insurance_consult_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS insurance_consult_requests_status_idx ON insurance_consult_requests (status, created_at);
