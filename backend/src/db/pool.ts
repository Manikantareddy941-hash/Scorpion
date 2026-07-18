import { Pool } from 'pg';

let pool: Pool | undefined;

/**
 * True only when DATABASE_URL actually points at Postgres.
 *
 * Presence alone is not enough: the scan-audit store accepts `file:` (SQLite)
 * in the same variable, and treating that as "Postgres is enabled" routes every
 * repository facade into `new Pool({ connectionString: 'file:./dev.db' })`,
 * which fails at query time rather than at config time.
 */
export function isPostgresEnabled(): boolean {
  const url = process.env.DATABASE_URL;
  return Boolean(url && (url.startsWith('postgres://') || url.startsWith('postgresql://')));
}

/** Lazy singleton. Throws unless DATABASE_URL is a Postgres URL — callers must gate on isPostgresEnabled(). */
export function getPool(): Pool {
  if (!isPostgresEnabled()) {
    throw new Error('DATABASE_URL is not configured for Postgres');
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }
  return pool;
}

/** For tests and graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
