CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('rent', 'sale')),
  model_id TEXT,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  brand TEXT NOT NULL CHECK (char_length(brand) BETWEEN 1 AND 40),
  machine_type TEXT NOT NULL,
  crop_ids TEXT[] NOT NULL CHECK (cardinality(crop_ids) > 0),
  operations TEXT[] NOT NULL CHECK (cardinality(operations) > 0),
  area_min INTEGER NOT NULL CHECK (area_min > 0),
  area_max INTEGER NOT NULL CHECK (area_max >= area_min),
  price INTEGER NOT NULL CHECK (price >= 0),
  region TEXT NOT NULL CHECK (char_length(region) BETWEEN 1 AND 40),
  condition TEXT NOT NULL CHECK (condition IN ('good', 'used', 'repair')),
  inspected_at DATE NOT NULL,
  included TEXT NOT NULL DEFAULT '' CHECK (char_length(included) <= 120),
  pickup TEXT NOT NULL DEFAULT '' CHECK (char_length(pickup) <= 120),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  summary TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 300),
  photo_key TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dealing', 'done', 'removed')),
  is_demo BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_owner_idx ON listings (owner_id);
CREATE INDEX IF NOT EXISTS listings_browse_idx ON listings (type, status, sort_order);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS owned_machines (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  model_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  is_selected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owned_machines_user_idx ON owned_machines (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS owned_machines_selected_one_idx
  ON owned_machines (user_id) WHERE is_selected = true;

CREATE TABLE IF NOT EXISTS rental_requests (
  id UUID PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  requester_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL CHECK (end_date >= start_date),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  daily_price INTEGER NOT NULL CHECK (daily_price >= 0),
  days INTEGER NOT NULL CHECK (days > 0),
  total_price INTEGER NOT NULL CHECK (total_price = daily_price * days),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  CONSTRAINT rental_requests_approved_no_overlap
    EXCLUDE USING gist (listing_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
    WHERE (status = 'approved')
);
CREATE INDEX IF NOT EXISTS rental_requests_listing_idx ON rental_requests (listing_id, status);
CREATE INDEX IF NOT EXISTS rental_requests_requester_idx ON rental_requests (requester_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS conversations_buyer_idx ON conversations (buyer_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  sender_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL CHECK (seq > 0),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, seq)
);
CREATE INDEX IF NOT EXISTS messages_conversation_seq_idx ON messages (conversation_id, seq);
