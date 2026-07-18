-- Up Migration
-- Batch 1 of the repository rollout: four independent leaf repositories that
-- own their own collection and return domain objects. Typed-column tables for
-- the three that map cleanly; a document-table bridge for threat_models (its
-- callers consume the Appwrite document shape, incl. $createdAt).

CREATE TABLE IF NOT EXISTS falco_rules (
  id                TEXT PRIMARY KEY,
  template          TEXT NOT NULL,
  params            JSONB NOT NULL,
  app_scope         TEXT,
  severity_override TEXT,
  suppressed        BOOLEAN NOT NULL DEFAULT false,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppression_rules (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  match_type  TEXT NOT NULL,
  match_value TEXT NOT NULL,
  expires_at  BIGINT,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppression_rules_owner ON suppression_rules (owner);

-- One snapshot per namespace (upserted each posture scan tick).
CREATE TABLE IF NOT EXISTS posture_snapshots (
  namespace  TEXT PRIMARY KEY,
  score      INTEGER NOT NULL,
  findings   JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS threat_models (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_threat_models_creator ON threat_models ((data->>'createdBy'));

-- Down Migration
DROP TABLE IF EXISTS threat_models;
DROP TABLE IF EXISTS posture_snapshots;
DROP TABLE IF EXISTS suppression_rules;
DROP TABLE IF EXISTS falco_rules;
