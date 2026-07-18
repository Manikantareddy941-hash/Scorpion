-- Up Migration
-- The durable per-digest scan-audit store.
--
-- This table already had a definition — as a Prisma model (prisma/schema.prisma,
-- model ScanResult) whose schema is applied by `prisma migrate`. Nothing in this
-- project runs that, so on a Postgres deployment the table simply did not exist
-- and every scanAudit write failed with `relation "ScanResult" does not exist`.
--
-- Bringing it under node-pg-migrate makes one tool the schema authority for the
-- Postgres database. The Prisma model stays as the SQLite dev path, which is
-- the only place it was ever actually applied.
CREATE TABLE IF NOT EXISTS scan_results (
  image_digest        TEXT PRIMARY KEY,
  reachability_counts JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS scan_results;
