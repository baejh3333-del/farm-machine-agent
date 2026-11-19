ALTER TABLE listings ADD COLUMN rental_operator JSONB;

ALTER TABLE rental_requests
  ADD COLUMN rental_operator JSONB,
  ADD COLUMN operator_owner_id TEXT,
  ADD COLUMN operator_daily_price INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT rental_requests_operator_check CHECK (
    (rental_operator IS NULL AND operator_owner_id IS NULL AND operator_daily_price = 0)
    OR (rental_operator IS NOT NULL AND operator_owner_id IS NOT NULL
        AND operator_daily_price > 0 AND offer_id IS NULL)
  );

ALTER TABLE rental_requests DROP CONSTRAINT rental_requests_total_price_check;
ALTER TABLE rental_requests ADD CONSTRAINT rental_requests_total_price_check
  CHECK (total_price >= 0 AND (offer_id IS NOT NULL
    OR total_price = (daily_price::bigint + operator_daily_price) * days));

ALTER TABLE rental_requests ADD CONSTRAINT rental_requests_operator_no_overlap
  EXCLUDE USING gist (
    operator_owner_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'approved' AND operator_owner_id IS NOT NULL);
