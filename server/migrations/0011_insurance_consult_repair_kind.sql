-- 수리센터 안내 뒤 보험 추천 흐름(kind = 'repair')에서도 상담 신청을 남길 수 있도록 reservation_kind 허용 값을 넓힌다.
ALTER TABLE insurance_consult_requests
  DROP CONSTRAINT IF EXISTS insurance_consult_requests_reservation_kind_check;
ALTER TABLE insurance_consult_requests
  ADD CONSTRAINT insurance_consult_requests_reservation_kind_check
  CHECK (reservation_kind IS NULL OR reservation_kind IN ('rental', 'purchase', 'repair'));
