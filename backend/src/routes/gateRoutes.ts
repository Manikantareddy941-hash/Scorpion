import { Router, Response, Request } from 'express';
import { databases, DB_ID, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logAuditEvent } from '../utils/auditLogger';

const router = Router();

/**
 * Check if a repository is allowed to be released
 */
async function checkReleaseGate(repoId: string) {
    const findingsResponse = await databases.listDocuments(
        DB_ID,
        'findings',
        [
            Query.equal('repo_id', repoId),
            Query.equal('status', 'open'),
            Query.equal('severity', ['critical', 'high']),
            Query.limit(100)
        ]
    );

    const blockerCount = findingsResponse.total;
    return {
        allowed: blockerCount === 0,
        blocker_count: blockerCount,
        blockers: findingsResponse.documents
    };
}

router.post('/release', verifyUser, async (req: Request, res: Response) => {
    const { repo_id } = req.body;
    if (!repo_id) return res.status(400).json({ error: 'repo_id is required' });

    try {
        const result = await checkReleaseGate(repo_id);
        const userId = (req as any).user?.$id;
        await logAuditEvent('GATE_CHECK', `Release gate checked for ${repo_id}. Result: ${result.allowed ? 'PASSED' : 'BLOCKED'} (${result.blocker_count} blockers)`, userId, repo_id);
        res.json(result);
    } catch (err: any) {
        console.error('[Gate API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/release/:repo_id', verifyUser, async (req: Request, res: Response) => {
    const { repo_id } = req.params;
    
    try {
        const result = await checkReleaseGate(repo_id);
        res.json(result);
    } catch (err: any) {
        console.error('[Gate API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
