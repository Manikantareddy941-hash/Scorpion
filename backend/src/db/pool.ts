import { Pool } from 'pg';

let pool: Pool | undefined;

export function isPostgresEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Lazy singleton. Throws if DATABASE_URL is missing — callers must gate on isPostgresEnabled(). */
export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
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
