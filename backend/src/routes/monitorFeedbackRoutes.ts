import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { resolveOwnershipScope } from '../services/tenancyService';
import { mttr, reopenRate, escapeByPhase, FindingRecord } from '../monitor/feedbackMetrics';
import { logger } from '../services/logger';

interface AuthedRequest extends Request<Record<string, string>> { user?: Models.User<Models.Preferences>; }
const router = Router();

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

    res.json({ mttr: mttr(findings), reopenRate: reopenRate(findings), byPhase: escapeByPhase(findings) });
  } catch (err) { logger.error('[feedbackRoutes] failed', err); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
