import express, { Request } from 'express';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { Query, Models } from 'node-appwrite';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: Models.User<Models.Preferences>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

const router = express.Router();

router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { scanId, severity, type, tool, file, status, repoId, limit = '100' } = req.query;

    // Scope to repos the caller can access (owned directly, or shared via team) so
    // one tenant can never list another tenant's vulnerabilities through this route.
    const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
      Query.equal('user_id', userId),
      Query.limit(200),
    ]);
    const teamIds = memberships.documents.map((m) => m.team_id);

    const ownedRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
      Query.equal('user_id', userId),
      Query.limit(500),
    ]);
    const teamRepos = teamIds.length > 0
      ? await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
          Query.equal('team_id', teamIds),
          Query.limit(500),
        ])
      : { documents: [] as Models.DefaultDocument[] };

    const accessibleRepoIds = [
      ...ownedRepos.documents.map((r) => r.$id),
      ...teamRepos.documents.map((r) => r.$id),
    ];

    if (accessibleRepoIds.length === 0) {
      return res.json({ total: 0, documents: [] });
    }

    // repoId narrows within the accessible set — it is intersected, never
    // substituted, so it cannot be used to reach another tenant's repository.
    if (repoId && !accessibleRepoIds.includes(repoId as string)) {
      return res.json({ total: 0, documents: [] });
    }
    const scopedRepoIds = repoId ? [repoId as string] : accessibleRepoIds;

    const filters: string[] = [
      Query.limit(Number(limit)),
      Query.orderDesc('$createdAt'),
      Query.equal('repo_id', scopedRepoIds),
    ];

    if (scanId) filters.push(Query.equal('scanId', scanId as string));
    if (severity) filters.push(Query.equal('severity', severity as string));
    if (type) filters.push(Query.equal('type', type as string));
    if (tool) filters.push(Query.equal('tool', tool as string));
    if (file) filters.push(Query.equal('file', file as string));
    if (status) filters.push(Query.equal('status', status as string));

    const result = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, filters);
    res.json(result);
  } catch (err: unknown) {
    logger.error('[IssuesRoute] Error:', err);
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
