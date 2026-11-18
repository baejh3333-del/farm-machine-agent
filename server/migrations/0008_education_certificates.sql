-- 마이페이지(내 계정) 교육이수증 사진. 개인 서류라 공개 사진 저장소가 아닌 DB에 계정당 1장만 보관한다.
-- 계정이 삭제되면 이수증 사진도 함께 지운다.
CREATE TABLE IF NOT EXISTS education_certificates (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  image BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/webp' CHECK (content_type = 'image/webp'),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0 AND byte_length <= 2000000),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
