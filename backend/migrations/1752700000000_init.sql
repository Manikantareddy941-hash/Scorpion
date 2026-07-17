-- Up Migration
CREATE TABLE IF NOT EXISTS gate_rules (
  user_id    TEXT PRIMARY KEY,
  rules      JSONB NOT NULL,
  env        TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pod_security_rules (
  user_id    TEXT PRIMARY KEY,
  config     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Document-table bridge: preserves the Appwrite document shape callers consume
-- today ({ $id, ...fields }). Typed columns come later, per-table, when a real
-- query needs them. app_ prefix avoids clashing with node-pg-migrate internals.
CREATE TABLE IF NOT EXISTS app_repositories (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_repositories_user ON app_repositories ((data->>'user_id'));
CREATE INDEX IF NOT EXISTS idx_app_repositories_url  ON app_repositories ((data->>'url'));

CREATE TABLE IF NOT EXISTS app_scans (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_scans_repo ON app_scans ((data->>'repo_id'));

-- Down Migration
DROP TABLE IF EXISTS app_scans;
DROP TABLE IF EXISTS app_repositories;
DROP TABLE IF EXISTS pod_security_rules;
DROP TABLE IF EXISTS gate_rules;
