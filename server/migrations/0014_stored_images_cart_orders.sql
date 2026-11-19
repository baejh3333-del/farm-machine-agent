-- 0014: DB 기반 이미지 저장소(stored_images), 장바구니(cart_items), 결제/주문 내역(orders)

CREATE TABLE IF NOT EXISTS stored_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key TEXT NOT NULL UNIQUE CHECK (char_length(storage_key) BETWEEN 1 AND 200),
  owner_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/webp' CHECK (char_length(mime_type) BETWEEN 1 AND 80),
  filename TEXT NOT NULL DEFAULT '' CHECK (char_length(filename) <= 180),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 2000000),
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stored_images_owner_idx
  ON stored_images (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stored_images_created_idx
  ON stored_images (created_at);

CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  start_date DATE,
  end_date DATE,
  days INTEGER NOT NULL DEFAULT 1 CHECK (days BETWEEN 1 AND 365),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id),
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS cart_items_user_idx
  ON cart_items (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE CHECK (char_length(order_number) BETWEEN 4 AND 40),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'cancelled')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('card', 'bank_transfer', 'easy_pay')),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  buyer_name TEXT NOT NULL DEFAULT '' CHECK (char_length(buyer_name) <= 60),
  buyer_phone TEXT NOT NULL DEFAULT '' CHECK (char_length(buyer_phone) <= 30),
  delivery_method TEXT NOT NULL DEFAULT 'pickup' CHECK (delivery_method IN ('pickup', 'delivery')),
  delivery_address TEXT NOT NULL DEFAULT '' CHECK (char_length(delivery_address) <= 200),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS orders_user_idx
  ON orders (user_id, created_at DESC);
