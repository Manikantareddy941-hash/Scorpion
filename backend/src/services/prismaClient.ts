import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Single shared Prisma client for the durable scan-audit store (SQLite).
 *
 * Prisma 7 drives SQLite through a driver adapter; the connection string comes
 * from DATABASE_URL (file:./dev.db, resolved from the process cwd).
 *
 * ts-node-dev respawns the process on each change; a global guard in non-prod
 * stops a new PrismaClient (and its connection pool) leaking on every reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const createClient = (): PrismaClient => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured for the scan-audit store');
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
