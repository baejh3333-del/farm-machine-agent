CREATE TABLE IF NOT EXISTS listing_draft_photos (
  listing_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  photo_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_draft_photos_user_idx
  ON listing_draft_photos (user_id, created_at DESC);
