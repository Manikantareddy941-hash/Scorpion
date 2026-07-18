import { getPool, isPostgresEnabled } from '../db/pool';
import { VulnerablePackage } from './reachabilityService';

/**
 * Durable per-digest audit/history of scan ingests.
 *
 * Distinct from imageStore.ts: that is the Redis hot path the admission webhook
 * reads to gate deploys; this is the persistent record for history/forensics and
 * is never on the gate's read path. Callers treat writes as best-effort so an
 * audit failure can't break ingest.
 *
 * Storage follows the same facade rule as the repositories: Postgres (table
 * `scan_results`, owned by node-pg-migrate) when DATABASE_URL points at
 * Postgres, and the Prisma/SQLite model otherwise. Prisma is imported lazily
 * because its adapter throws when DATABASE_URL is unset — a module-load import
 * turns a missing env var into a boot crash for every consumer of this file,
 * including ones that never touch the audit store.
 */

export interface ReachabilityCounts {
  total: number;
  bySeverity: Record<string, number>;
}

export interface ScanAuditRecord {
  imageDigest: string;
  reachabilityCounts: ReachabilityCounts;
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

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const loadPrisma = () => (require('./prismaClient') as typeof import('./prismaClient')).prisma;

export async function recordScanResult(imageDigest: string, counts: ReachabilityCounts): Promise<void> {
  if (isPostgresEnabled()) {
    await getPool().query(
      `INSERT INTO scan_results (image_digest, reachability_counts)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (image_digest) DO UPDATE SET reachability_counts = $2::jsonb`,
      [imageDigest, JSON.stringify(counts)]
    );
    return;
  }

  await loadPrisma().scanResult.upsert({
    where: { imageDigest },
    create: { imageDigest, reachabilityCounts: counts as unknown as never },
    update: { reachabilityCounts: counts as unknown as never },
  });
}

export async function getScanResult(imageDigest: string): Promise<ScanAuditRecord | null> {
  if (isPostgresEnabled()) {
    const result = await getPool().query(
      'SELECT image_digest, reachability_counts FROM scan_results WHERE image_digest = $1',
      [imageDigest]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as { image_digest: string; reachability_counts: ReachabilityCounts };
    return { imageDigest: row.image_digest, reachabilityCounts: row.reachability_counts };
  }

  const row = await loadPrisma().scanResult.findUnique({ where: { imageDigest } });
  if (!row) return null;
  return {
    imageDigest: row.imageDigest,
    reachabilityCounts: row.reachabilityCounts as unknown as ReachabilityCounts,
  };
}
