import { Models, Permission, Role } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { normalizeSarif } from '../scanners/sarifNormalizer';
import { deduplicateFindings } from '../deduplication';
import { ingestVulnerabilitiesDelta } from './scanService';
import { logger } from './logger';

/**
 * Ingests a SARIF report pushed from a customer's own CI (CodeQL, Semgrep,
 * Trivy, Snyk, ...) and stores its findings under the target repo using the
 * same delta-ingest path the built-in orchestrator uses. Once stored, the
 * requirement-correlation engine sees them like any other finding.
 */

export type SarifIngestResult =
  | { ok: true; scanId: string; findings: number }
  | { ok: false; reason: 'repo_not_found' };

interface IngestInput {
  // Machine tenant from the CI token (team_id ?? user_id), or null for the
  // legacy single-tenant global key.
  tenant: string | null;
  repoUrl: string;
  sarif: unknown;
  branch?: string;
}

const ownerReadPerms = (repo: Models.DefaultDocument): string[] => {
  const perms: string[] = [];
  if (repo.user_id) perms.push(Permission.read(Role.user(String(repo.user_id))));
  if (repo.team_id) perms.push(Permission.read(Role.team(String(repo.team_id))));
  return perms;
};

/**
 * Resolve the repo by URL, scoped to the presenting tenant. Tenant comes from
 * the authenticated CI token, never the request body — a body-supplied owner
 * would let one customer write findings into another's repo. The legacy global
 * key (tenant === null) matches by URL alone, as it does for image ingest.
 */
async function resolveRepo(tenant: string | null, repoUrl: string): Promise<Models.DefaultDocument | null> {
  const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
    Query.equal('url', repoUrl),
    Query.limit(25),
  ]);
  const owned = repos.documents.filter(
    (r) => tenant === null || String(r.user_id) === tenant || String(r.team_id) === tenant,
  );
  return owned[0] ?? null;
}

function severityCounts(issues: { severity?: string }[]): Record<string, number> {
  const counts = { criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0 };
  for (const i of issues) {
    switch ((i.severity ?? '').toUpperCase()) {
      case 'CRITICAL': counts.criticalCount++; break;
      case 'HIGH': counts.highCount++; break;
      case 'MEDIUM': counts.mediumCount++; break;
      case 'LOW': counts.lowCount++; break;
    }
  }
  return counts;
}

export async function ingestSarif(input: IngestInput): Promise<SarifIngestResult> {
  const repo = await resolveRepo(input.tenant, input.repoUrl);
  if (!repo) return { ok: false, reason: 'repo_not_found' };

  const issues = deduplicateFindings(normalizeSarif(input.sarif));
  const docPerms = ownerReadPerms(repo);
  const startedAt = new Date().toISOString();
  const counts = severityCounts(issues);

  const scan = await databases.createDocument(
    DB_ID,
    COLLECTIONS.SCANS,
    ID.unique(),
    {
      repo_id: repo.$id,
      status: 'running',
      scan_type: 'sarif',
      repoUrl: repo.url,
      startedAt,
      timestamp: startedAt,
      scannerVersion: 'sarif-ingest',
      visibility: 'public',
      ...counts,
      details: JSON.stringify({ started_at: startedAt, source: 'sarif-ingest', branch: input.branch || 'main' }),
    },
    docPerms,
  );

  await ingestVulnerabilitiesDelta(repo.$id, scan.$id, issues, undefined, docPerms);

  await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scan.$id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });

  logger.info('sarif-ingest stored findings', {
    event: 'sarif_ingest_stored',
    repoId: repo.$id,
    scanId: scan.$id,
    findings: issues.length,
  });

  return { ok: true, scanId: scan.$id, findings: issues.length };
}
