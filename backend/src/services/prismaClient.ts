import { PrismaClient } from '../generated/prisma/client';
import { createAdapter } from './prismaAdapter';

/**
 * Single shared Prisma client for the durable scan-audit store.
 *
 * Prisma 7 drives the DB through a driver adapter chosen from the
 * DATABASE_URL scheme (file: → SQLite, postgres:// → Postgres), so the same
 * code runs on SQLite in dev and Postgres in production.
 *
 * ts-node-dev respawns the process on each change; a global guard in non-prod
 * stops a new PrismaClient (and its connection pool) leaking on every reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const createClient = (): PrismaClient =>
  new PrismaClient({ adapter: createAdapter(process.env.DATABASE_URL) });

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
