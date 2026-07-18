-- Up Migration
-- Per-tenant CI ingest / admission tokens.
--
-- Replaces a single global CI_INGEST_API_KEY shared by every tenant. With one
-- key and a scan cache keyed only by image digest, any key holder could declare
-- any digest clean and another tenant's pod would be admitted — a gate bypass,
-- not merely a disclosure.
--
-- Only the hash is stored. Tokens are 256 bits of CSPRNG output, so a single
-- SHA-256 is the right primitive: bcrypt/argon2 exist to slow brute force
-- against low-entropy human passwords, and buy nothing against a random 256-bit
-- secret while costing latency on a hot auth path.
CREATE TABLE IF NOT EXISTS ci_tokens (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  -- Tenant this token acts as. Mirrors the user_id/team_id pair used by
  -- tenancyService so token-authenticated writes land in the same tenant space
  -- as session-authenticated ones.
  user_id      TEXT NOT NULL,
  team_id      TEXT,
  name         TEXT NOT NULL,
  -- 'ingest' writes scan results; 'admission' reads them to gate deploys.
  scope        TEXT NOT NULL DEFAULT 'ingest',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

-- Auth looks the token up by hash on every ingest call; this must be an index hit.
CREATE INDEX IF NOT EXISTS idx_ci_tokens_hash ON ci_tokens (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ci_tokens_owner ON ci_tokens (user_id);

-- Down Migration
DROP TABLE IF EXISTS ci_tokens;
