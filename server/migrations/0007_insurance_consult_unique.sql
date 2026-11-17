-- 같은 사용자·상품·매물(NULL 포함)에 대해 접수 중('requested')인 보험 상담 신청이 중복 생성되지 않도록 부분 유니크 인덱스를 부여한다.
DELETE FROM insurance_consult_requests a
USING insurance_consult_requests b
WHERE a.status = 'requested'
  AND b.status = 'requested'
  AND a.user_id = b.user_id
  AND a.product_id = b.product_id
  AND a.listing_id IS NOT DISTINCT FROM b.listing_id
  AND (a.created_at > b.created_at OR (a.created_at = b.created_at AND a.id > b.id));

CREATE UNIQUE INDEX IF NOT EXISTS insurance_consult_requests_open_listing_idx
  ON insurance_consult_requests (user_id, product_id, listing_id)
  WHERE status = 'requested' AND listing_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS insurance_consult_requests_open_no_listing_idx
  ON insurance_consult_requests (user_id, product_id)
  WHERE status = 'requested' AND listing_id IS NULL;
