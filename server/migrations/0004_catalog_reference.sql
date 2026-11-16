CREATE TABLE IF NOT EXISTS crop_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  peak_work_months INTEGER[] NOT NULL DEFAULT '{}',
  operation_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operation_catalog (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  stage_label TEXT NOT NULL DEFAULT '',
  default_machine_types TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS machine_type_catalog (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'standalone',
  area_min INTEGER,
  area_max INTEGER,
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS machine_model_specs (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  machine_type TEXT NOT NULL REFERENCES machine_type_catalog(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('powerUnit', 'implement', 'standalone')),
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  connection JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  unknowns TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS machine_model_specs_type_idx ON machine_model_specs (machine_type, role);
