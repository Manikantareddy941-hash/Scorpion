import { Models, Permission, Role } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { normalizeSarif } from '../scanners/sarifNormalizer';
import { deduplicateFindings } from '../deduplication';
import { ingestVulnerabilitiesDelta } from './scanService';
import { securityRequirementsService } from './securityRequirementsService';
import { canonicalizeRepoUrl } from '../utils/repoUrl';
import { logger } from './logger';

/**
 * Ingests a SARIF report pushed from a customer's own CI (CodeQL, Semgrep,
 * Trivy, Snyk, ...) and stores its findings under the target repo using the
 * same delta-ingest path the built-in orchestrator uses. Once stored, the
 * requirement-correlation engine sees them like any other finding.
 */

export type SarifIngestResult =
  | { ok: true; scanId: string; findings: number; affectedProjects: { projectId: string; violated: number; total: number }[] }
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

const tenantOwns = (r: Models.DefaultDocument, tenant: string | null): boolean =>
  tenant === null || String(r.user_id) === tenant || String(r.team_id) === tenant;

/**
 * The tenant's own repositories — the candidate set for a canonical URL match.
 * Queried by owner (indexed), never scanned wholesale, so one customer can't
 * see another's repos. The legacy global key (tenant === null) has no owner to
 * filter on, so it scans a capped set.
 * ponytail: per-tenant repo counts are small; the caps below are the ceiling.
 * If a tenant ever exceeds them, add a stored `urlCanonical` index instead.
 */
async function listTenantRepos(tenant: string | null): Promise<Models.DefaultDocument[]> {
  if (tenant === null) {
    const all = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.limit(200)]);
    return all.documents;
  }
  const [byUser, byTeam] = await Promise.all([
    databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal('user_id', tenant), Query.limit(100)]),
    databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal('team_id', tenant), Query.limit(100)]),
  ]);
  return [...byUser.documents, ...byTeam.documents];
}

/**
 * Resolve the repo by URL, scoped to the presenting tenant. Tenant comes from
 * the authenticated CI token, never the request body — a body-supplied owner
 * would let one customer write findings into another's repo.
 *
 * Two-step so a URL-format difference between CI and what was stored (a `.git`
 * suffix, trailing slash, or case) doesn't silently 404 the whole ingest and
 * blind the compliance gate for that repo:
 *   1. exact URL match (indexed, the common case), then
 *   2. canonical match over the tenant's own repos (handles the variants,
 *      including repos stored before this normalization existed — no backfill).
 */
async function resolveRepo(tenant: string | null, repoUrl: string): Promise<Models.DefaultDocument | null> {
  const exact = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
    Query.equal('url', repoUrl),
    Query.limit(25),
  ]);
  const exactOwned = exact.documents.filter((r) => tenantOwns(r, tenant));
  if (exactOwned[0]) return exactOwned[0];

  const target = canonicalizeRepoUrl(repoUrl);
  if (!target) return null;
  const candidates = await listTenantRepos(tenant);
  return (
    candidates.find((r) => tenantOwns(r, tenant) && canonicalizeRepoUrl(String(r.url)) === target) ?? null
  );
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

  // Fan-out: re-correlate every project bound to this repo the moment its
  // findings land, so a shared repo's new finding re-scores each project's
  // requirements immediately (event-driven, not on-next-view).
  const affectedProjects = await securityRequirementsService.fanOutCorrelation(repo.$id);

  await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scan.$id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });

  logger.info('sarif-ingest stored findings', {
    event: 'sarif_ingest_stored',
    repoId: repo.$id,
    scanId: scan.$id,
    findings: issues.length,
    affectedProjects: affectedProjects.length,
  });

  return { ok: true, scanId: scan.$id, findings: issues.length, affectedProjects };
}
