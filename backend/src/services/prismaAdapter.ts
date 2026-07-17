import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Picks the Prisma driver adapter from the DATABASE_URL scheme so the durable
 * scan-audit store runs on SQLite in dev and Postgres in production without a
 * code change — only DATABASE_URL differs.
 *
 * NOTE: the Prisma schema's datasource `provider` is generated at build time.
 * A Postgres deployment must regenerate the client with the postgres provider
 * (see `npm run prisma:generate:pg`); this only selects the runtime driver.
 */
export type AdapterKind = 'sqlite' | 'postgres';

export function adapterKindFor(url: string | undefined): AdapterKind {
  if (!url) throw new Error('DATABASE_URL not configured for the scan-audit store');
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'postgres';
  if (url.startsWith('file:')) return 'sqlite';
  throw new Error(`Unsupported DATABASE_URL scheme: ${url.split(':')[0]}:`);
}

export function createAdapter(url: string | undefined) {
  switch (adapterKindFor(url)) {
    case 'postgres':
      return new PrismaPg({ connectionString: url! });
    case 'sqlite':
      return new PrismaBetterSqlite3({ url: url! });
  }
}
