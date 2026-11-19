-- 판매·대여 매물의 운송 방식(체크 조건). 하나 이상 필수, 둘 다 가능.
--   owner_delivery: 판매자·대여해 주는 사람이 상대 농가까지 가져다줌(직접 운송)
--   self_pickup:    구매자·대여자가 직접 와서 가져감(직접 픽업)
-- 기존 pickup(인수·전달 방법) 글은 지우지 않고 "픽업 장소·메모"로 계속 쓴다.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS delivery_methods TEXT[] NOT NULL DEFAULT ARRAY['self_pickup']::text[];
ALTER TABLE listings ADD COLUMN IF NOT EXISTS delivery_fee INTEGER;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS delivery_area TEXT NOT NULL DEFAULT '';

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_delivery_methods_check;
ALTER TABLE listings ADD CONSTRAINT listings_delivery_methods_check CHECK (
  cardinality(delivery_methods) >= 1
  AND delivery_methods <@ ARRAY['owner_delivery', 'self_pickup']::text[]
);
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_delivery_fee_check;
ALTER TABLE listings ADD CONSTRAINT listings_delivery_fee_check CHECK (
  delivery_fee IS NULL OR (delivery_fee >= 0 AND 'owner_delivery' = ANY (delivery_methods))
);
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_delivery_area_check;
ALTER TABLE listings ADD CONSTRAINT listings_delivery_area_check CHECK (
  char_length(delivery_area) <= 80 AND (delivery_area = '' OR 'owner_delivery' = ANY (delivery_methods))
);

-- 기존 매물 이관: pickup 글로 운송 방식을 추정한다(판단이 안 되면 직접 픽업).
UPDATE listings
SET delivery_methods = guessed.methods
FROM (
  SELECT id,
    CASE WHEN cardinality(m) = 0 THEN ARRAY['self_pickup']::text[] ELSE m END AS methods
  FROM (
    SELECT id, array_remove(ARRAY[
      CASE WHEN pickup ~ '(운반|배송|배달|운송|가져다|갖다)' THEN 'owner_delivery' END,
      CASE WHEN pickup ~ '(방문|인수|픽업|가지러|수령)' THEN 'self_pickup' END
    ]::text[], NULL) AS m
    FROM listings
  ) raw
) guessed
WHERE listings.id = guessed.id
  AND listings.delivery_methods = ARRAY['self_pickup']::text[]
  AND listings.delivery_fee IS NULL
  AND listings.delivery_area = '';
