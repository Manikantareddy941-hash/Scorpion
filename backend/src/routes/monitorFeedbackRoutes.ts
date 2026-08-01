import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { resolveOwnershipScope } from '../services/tenancyService';
import { mttr, reopenRate, escapeByPhase, escapeRecommendations, slaAttainment, mttrByRepo, toFindingRecord, FindingRecord } from '../monitor/feedbackMetrics';

/** Repo scan cap. Hitting it means the metrics describe a subset — reported as `truncated`. */
const REPO_SCAN_LIMIT = 500;
import { logger } from '../services/logger';

interface AuthedRequest extends Request<Record<string, string>> { user?: Models.User<Models.Preferences>; }
const router = Router();

/**
 * Runtime (Falco) incidents as FindingRecords for the feedback metrics. scanner
 * is 'falco' so escapeByPhase buckets them under 'operate'; createdAt/resolvedAt
 * come from the incident's timestamp/resolvedAt so a resolved incident feeds
 * MTTR. Fail-open: any read error (e.g. a pre-migration collection missing the
 * repo_id attribute) returns [] so the findings-based metrics keep working.
 */
async function listRuntimeFindings(repoIds: string[]): Promise<FindingRecord[]> {
  try {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.INCIDENTS, [Query.equal('repo_id', repoIds), Query.limit(500)]);
    return res.documents.map((d) => {
      const w = d as unknown as Record<string, string | number>;
      return {
        severity: String(w.priority ?? 'info').toLowerCase(),
        scanner: 'falco',
        status: String(w.status ?? 'open'),
        createdAt: new Date(String(w.timestamp ?? d.$createdAt)).getTime(),
        resolvedAt: w.resolvedAt ? new Date(String(w.resolvedAt)).getTime() : undefined,
        reopenCount: 0,
      };
    });
  } catch (err) {
    // Fail-open but observable: distinguishes a degraded read from a genuinely
    // empty one, so MTTR is never quietly understated as "no runtime incidents".
    logger.warn('[feedbackRoutes] runtime incidents read degraded — excluded from metrics', {
      event: 'feedback_read_degraded', source: 'runtime_incidents', repoCount: repoIds.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

router.get('/', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    // Scope comes from resolveOwnershipScope, so every metric below inherits the
    // tenancy boundary instead of re-deriving one — a bespoke grouping query is
    // how a rollup starts including repos the caller cannot see.
    const scope = await resolveOwnershipScope(req, userId);
    const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
      Query.equal(scope.field, scope.value),
      Query.limit(REPO_SCAN_LIMIT),
    ]);
    const repoIds = repos.documents.map(r => r.$id);
    // Hitting the cap means the numbers describe a subset. Say so rather than
    // presenting a partial rollup as the whole picture.
    const truncated = repoIds.length >= REPO_SCAN_LIMIT;
    if (repoIds.length === 0) {
      return res.json({
        mttr: 0, reopenRate: 0, byPhase: [], recommendations: [],
        sla: slaAttainment([]), byRepo: [], truncated: false,
      });
    }

    const repoNames: Record<string, string> = {};
    for (const r of repos.documents) {
      repoNames[r.$id] = String((r as unknown as Record<string, unknown>).name ?? r.$id);
    }

    const findingsRes = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [Query.equal('repo_id', repoIds), Query.limit(500)]);
    const findings: FindingRecord[] = findingsRes.documents.map(
      (d) => toFindingRecord(d as unknown as Record<string, unknown>),
    );

    // Fold in runtime (Falco) incidents so MTTR and the 'operate' escape phase
    // actually count runtime threats — scoped by the repo_id #138 stamps.
    // Fail-open on its own: a pre-migration incidents collection (no repo_id
    // attr) must never break the findings-based metrics that already work.
    const runtimeFindings = await listRuntimeFindings(repoIds);

    const all = [...findings, ...runtimeFindings];
    const byPhase = escapeByPhase(all);
    res.json({
      mttr: mttr(all),
      reopenRate: reopenRate(all),
      byPhase,
      recommendations: escapeRecommendations(byPhase),
      // Per-severity attainment against the shared SLA windows: the aggregate
      // mttr above is one number for everything, which hides a critical-severity
      // backlog behind a healthy average on low-severity noise.
      sla: slaAttainment(all),
      // Which repo is holding remediation up — the aggregate above cannot say.
      // Only scanner findings carry repo_id here; runtime incidents are folded
      // into the totals but not attributed per repo.
      byRepo: mttrByRepo(all, repoNames),
      truncated,
    });
  } catch (err) { logger.error('[feedbackRoutes] failed', err); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
