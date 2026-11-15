-- API 호출 제한 카운터 (server/rate-limit.js)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0)
);
CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits (expires_at);

-- total_price를 BIGINT로 넓혀 daily_price * days가 INTEGER 범위를 넘는 오버플로를 없앤다.
-- 기존 CHECK는 INTEGER 곱셈이라 이름과 무관하게 찾아서 제거한 뒤 BIGINT 곱셈으로 다시 만든다.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'rental_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%total_price%'
  LOOP
    EXECUTE format('ALTER TABLE rental_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE rental_requests ALTER COLUMN total_price TYPE BIGINT;
ALTER TABLE rental_requests
  ADD CONSTRAINT rental_requests_total_price_check
  CHECK (total_price = daily_price::bigint * days);

-- 대여 기간 상한(365일)과 days = 기간 일수 일관성. 기존 행은 검사하지 않고 새 쓰기부터 적용한다.
ALTER TABLE rental_requests
  ADD CONSTRAINT rental_requests_days_range_check
  CHECK (days <= 365 AND days = end_date - start_date + 1) NOT VALID;
