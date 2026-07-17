/** Shared gating + cleanup for Postgres integration tests (RUN_DB_IT pattern). */
import { getPool } from './pool';

export const describeDb =
  process.env.RUN_DB_IT && process.env.DATABASE_URL ? describe : describe.skip;

/** TRUNCATE the given tables between tests. Table names are code-owned constants, never user input. */
export async function truncateAll(tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  await getPool().query(`TRUNCATE ${tables.map(t => `"${t}"`).join(', ')}`);
}
