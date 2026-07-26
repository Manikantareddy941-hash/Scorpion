import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { resolveOwnershipScope } from '../services/tenancyService';
import { mttr, reopenRate, escapeByPhase, FindingRecord } from '../monitor/feedbackMetrics';
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
    logger.warn('[feedbackRoutes] runtime incidents excluded from metrics', { error: err instanceof Error ? err.message : err });
    return [];
  }
}

router.get('/', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    const scope = await resolveOwnershipScope(req, userId);
    const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal(scope.field, scope.value), Query.limit(50)]);
    const repoIds = repos.documents.map(r => r.$id);
    if (repoIds.length === 0) return res.json({ mttr: 0, reopenRate: 0, byPhase: [] });

    const findingsRes = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [Query.equal('repo_id', repoIds), Query.limit(500)]);
    const findings: FindingRecord[] = findingsRes.documents.map((d) => {
      const w = d as unknown as Record<string, string | number>;
      return {
        severity: String(w.severity ?? 'info'), scanner: String(w.scanner ?? 'unknown'),
        status: String(w.status ?? 'open'), createdAt: new Date(d.$createdAt).getTime(),
        resolvedAt: w.resolvedAt ? new Date(w.resolvedAt as string).getTime() : undefined,
        reopenCount: Number(w.reopenCount ?? 0),
      };
    });

    // Fold in runtime (Falco) incidents so MTTR and the 'operate' escape phase
    // actually count runtime threats — scoped by the repo_id #138 stamps.
    // Fail-open on its own: a pre-migration incidents collection (no repo_id
    // attr) must never break the findings-based metrics that already work.
    const runtimeFindings = await listRuntimeFindings(repoIds);

    const all = [...findings, ...runtimeFindings];
    res.json({ mttr: mttr(all), reopenRate: reopenRate(all), byPhase: escapeByPhase(all) });
  } catch (err) { logger.error('[feedbackRoutes] failed', err); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
