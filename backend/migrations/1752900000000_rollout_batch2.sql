-- Up Migration
-- Batch 2 of the repository rollout: three more leaf repositories that own
-- their own collections. All typed-column tables — none of their consumers
-- read the Appwrite document shape, so no doc-table bridge is needed.
-- Fields Appwrite stored as JSON *strings* (playbook trigger/actions,
-- correlation matchedEventIds, drift severityCounts) become real JSONB here.

-- soarRepository ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playbooks (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  trigger    JSONB NOT NULL,
  actions    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soar_actions (
  id              TEXT PRIMARY KEY,
  incident_id     TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  playbook_id     TEXT NOT NULL,
  playbook_name   TEXT NOT NULL,
  status          TEXT NOT NULL,
  namespace       TEXT,
  pod_name        TEXT,
  owner_user_id   TEXT,
  container_image TEXT NOT NULL,
  falco_rule      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  resolved_at     TEXT,
  resolved_by     TEXT,
  result          TEXT,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_soar_actions_status ON soar_actions (status);
-- Serves listEvidenceForIncident (incident + action_type filter).
CREATE INDEX IF NOT EXISTS idx_soar_actions_incident ON soar_actions (incident_id, action_type);

-- correlationRepository -----------------------------------------------------
CREATE TABLE IF NOT EXISTS correlations (
  id                TEXT PRIMARY KEY,
  owner             TEXT NOT NULL,
  rule_id           TEXT NOT NULL,
  correlation_key   TEXT NOT NULL,
  bucket            BIGINT NOT NULL,
  severity          TEXT NOT NULL,
  incident_id       TEXT NOT NULL,
  matched_event_ids JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- wasFired() is the dedupe check on the alert path — it must be an index hit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_correlations_fired
  ON correlations (owner, rule_id, correlation_key, bucket);
CREATE INDEX IF NOT EXISTS idx_correlations_owner ON correlations (owner, created_at DESC);

CREATE TABLE IF NOT EXISTS correlation_rule_states (
  id                TEXT PRIMARY KEY,
  owner             TEXT NOT NULL,
  rule_id           TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  severity_override TEXT
);
-- One state row per (owner, rule) — the upsert conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_correlation_rule_states_owner_rule
  ON correlation_rule_states (owner, rule_id);

-- driftRepository -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS drift_anomalies (
  id              TEXT PRIMARY KEY,
  drift_type      TEXT NOT NULL,
  namespace       TEXT NOT NULL,
  pod_name        TEXT NOT NULL,
  container_name  TEXT NOT NULL,
  image           TEXT NOT NULL,
  image_digest    TEXT NOT NULL,
  previous_digest TEXT,
  env             TEXT NOT NULL,
  gate_status     TEXT NOT NULL,
  reason          TEXT NOT NULL,
  severity        TEXT NOT NULL,
  severity_rank   INTEGER NOT NULL,
  severity_counts JSONB NOT NULL,
  timestamp       TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true
);
-- listActive() orders by severity_rank then timestamp, both descending.
CREATE INDEX IF NOT EXISTS idx_drift_anomalies_active
  ON drift_anomalies (active, severity_rank DESC, timestamp DESC);

-- Down Migration
DROP TABLE IF EXISTS drift_anomalies;
DROP TABLE IF EXISTS correlation_rule_states;
DROP TABLE IF EXISTS correlations;
DROP TABLE IF EXISTS soar_actions;
DROP TABLE IF EXISTS playbooks;
