import { prisma } from './prismaClient';
import { Prisma } from '../generated/prisma/client';
import { VulnerablePackage } from './reachabilityService';

/**
 * Durable per-digest audit/history of scan ingests (Prisma + SQLite).
 *
 * Distinct from imageStore.ts: that is the Redis hot path the admission webhook
 * reads to gate deploys; this is the persistent record for history/forensics and
 * is never on the gate's read path. Callers treat writes as best-effort so an
 * audit failure can't break ingest.
 */

export interface ReachabilityCounts {
  total: number;
  bySeverity: Record<string, number>;
}

/**
 * ponytail: at ingest we only have raw findings, so the first audit row records
 * a severity breakdown. The gate-eval path can upsert the same digest later with
 * true reachable/unreachable counts — which is why recordScanResult upserts
 * rather than creates.
 */
export function summarizeSeverity(packages: VulnerablePackage[]): ReachabilityCounts {
  const bySeverity: Record<string, number> = {};
  for (const pkg of packages) {
    const key = (pkg.severity ?? 'unknown').toLowerCase();
    bySeverity[key] = (bySeverity[key] ?? 0) + 1;
  }
  return { total: packages.length, bySeverity };
}

export async function recordScanResult(imageDigest: string, counts: ReachabilityCounts): Promise<void> {
  const reachabilityCounts = counts as unknown as Prisma.InputJsonValue;
  await prisma.scanResult.upsert({
    where: { imageDigest },
    create: { imageDigest, reachabilityCounts },
    update: { reachabilityCounts },
  });
}

export function getScanResult(imageDigest: string) {
  return prisma.scanResult.findUnique({ where: { imageDigest } });
}
