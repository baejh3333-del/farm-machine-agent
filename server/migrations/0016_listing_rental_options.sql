-- 매물별 선택 옵션(옵트인 제공 항목)과 대여 요청의 수령 방식·옵션·요금 저장
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS rental_options JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE rental_requests
  ADD COLUMN IF NOT EXISTS delivery_method TEXT,
  ADD COLUMN IF NOT EXISTS delivery_fee INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rental_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS options_total INTEGER NOT NULL DEFAULT 0;

ALTER TABLE rental_requests DROP CONSTRAINT IF EXISTS rental_requests_delivery_method_check;
ALTER TABLE rental_requests ADD CONSTRAINT rental_requests_delivery_method_check CHECK (
  delivery_method IS NULL OR delivery_method IN ('self_pickup', 'owner_delivery')
);

ALTER TABLE rental_requests DROP CONSTRAINT IF EXISTS rental_requests_delivery_fee_check;
ALTER TABLE rental_requests ADD CONSTRAINT rental_requests_delivery_fee_check CHECK (
  delivery_fee >= 0 AND (delivery_fee = 0 OR delivery_method = 'owner_delivery')
);

ALTER TABLE rental_requests DROP CONSTRAINT IF EXISTS rental_requests_options_total_check;
ALTER TABLE rental_requests ADD CONSTRAINT rental_requests_options_total_check CHECK (
  options_total >= 0
);

ALTER TABLE rental_requests DROP CONSTRAINT IF EXISTS rental_requests_total_price_check;
ALTER TABLE rental_requests ADD CONSTRAINT rental_requests_total_price_check CHECK (
  total_price >= 0 AND (
    offer_id IS NOT NULL
    OR total_price = (daily_price::bigint + operator_daily_price) * days + delivery_fee + options_total
  )
);
