import { Router, Response, Request } from 'express';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logAuditEvent } from '../utils/auditLogger';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { sendSecurityAlert } from '../services/notificationService';
import { getDynamicPolicy } from '../services/policyService';
import { checkPermission } from '../middleware/iamMiddleware';

const router = Router();

// Helper to ensure pipeline_state collection exists
async function ensurePipelineStateCollection() {
  try {
    await databases.getCollection(DB_ID, 'pipeline_state');
  } catch (err: any) {
    if (err.code === 404 || err.type === 'collection_not_found') {
      console.log('[Pipeline State Setup] pipeline_state collection not found. Creating it...');
      try {
        await databases.createCollection(DB_ID, 'pipeline_state', 'Pipeline State');
        await databases.createStringAttribute(DB_ID, 'pipeline_state', 'nodeId', 50, true);
        await databases.createStringAttribute(DB_ID, 'pipeline_state', 'status', 50, true);
        console.log('[Pipeline State Setup] pipeline_state collection created.');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (createErr) {
        console.error('[Pipeline State Setup] Error creating pipeline_state collection:', createErr);
      }
    }
  }
}

// Check if a repository is allowed to be released
async function checkReleaseGate(repoId: string) {
    const findingsResponse = await databases.listDocuments(
        DB_ID,
        'vulnerabilities',
        [
            Query.equal('repo_id', repoId),
            Query.equal('status', 'open'),
            Query.limit(100)
        ]
    );

    const blockers = findingsResponse.documents;
    const blockerCount = blockers.length;

    // Calculate score
    let score = 100;
    blockers.forEach((b: any) => {
        const sev = (b.severity || 'low').toLowerCase();
        if (sev === 'critical') score -= 15;
        else if (sev === 'high') score -= 10;
        else if (sev === 'medium') score -= 5;
        else score -= 2;
    });
    score = Math.max(0, score);

    const hasCritical = blockers.some((b: any) => (b.severity || '').toLowerCase() === 'critical');
    
    // Fetch Dynamic Policy from centralized service
    const policy = await getDynamicPolicy(repoId);
    
    // Evaluate compliance thresholds dynamically
    const allowed = score >= policy.minSecurityScore && !(policy.blockOnCritical && hasCritical);

    return {
        allowed,
        score,
        blocker_count: blockerCount,
        blockers: blockers,
        minSecurityScore: policy.minSecurityScore
    };
}

// POST /api/gates/evaluate
router.post('/evaluate', async (req: Request, res: Response) => {
    const { repo_id } = req.body;
    if (!repo_id) return res.status(400).json({ error: 'repo_id is required' });

    try {
        await ensurePipelineStateCollection();
        const result = await checkReleaseGate(repo_id);
        const status = result.allowed ? 'passing' : 'BLOCKED';

        if (status === 'BLOCKED') {
            sendSecurityAlert({
                type: 'gate_blocked',
                title: 'CI/CD Release Gate BLOCKED',
                severity: 'CRITICAL',
                details: `Security Gate dropped below 80% compliance threshold.\nPosture Score: ${result.score}%\nActive Blockers: ${result.blocker_count}`,
                repo_id
            });
        }

        // Update pipeline_state in Appwrite
        const existingState = await databases.listDocuments(DB_ID, 'pipeline_state', [
            Query.equal('nodeId', 'release'),
            Query.limit(1)
        ]);

        if (existingState.total > 0) {
            await databases.updateDocument(DB_ID, 'pipeline_state', existingState.documents[0].$id, {
                status
            });
        } else {
            await databases.createDocument(DB_ID, 'pipeline_state', ID.unique(), {
                nodeId: 'release',
                status
            });
        }

        res.json({
            repo_id,
            score: result.score,
            status,
            blocker_count: result.blocker_count,
            blockers: result.blockers.map((b: any) => ({
                id: b.$id,
                title: b.title,
                severity: b.severity,
                package: b.packageName || b.package || 'unknown'
            }))
        });
    } catch (err: any) {
        console.error('[Gate Evaluate Error]', err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

// POST /api/gates/deploy
router.post('/deploy', verifyUser, checkPermission('repo:deploy'), async (req: Request, res: Response) => {
    const { repo_id } = req.body;
    if (!repo_id) return res.status(400).json({ error: 'repo_id is required' });

    try {
        await ensurePipelineStateCollection();
        
        // Fetch from pipeline_state to see if blocked
        const existingState = await databases.listDocuments(DB_ID, 'pipeline_state', [
            Query.equal('nodeId', 'release'),
            Query.limit(1)
        ]);

        const isBlocked = existingState.total > 0 && existingState.documents[0].status === 'BLOCKED';

        if (isBlocked) {
            const result = await checkReleaseGate(repo_id);
            return res.status(403).json({
                error: 'Deployment Rejected: CI/CD Release Gate is BLOCKED',
                reason: `Security posture score falls below ${result.minSecurityScore}% threshold or active Critical vulnerabilities are present.`,
                score: result.score,
                blockers: result.blockers.map((b: any) => ({
                    id: b.$id,
                    title: b.title,
                    severity: b.severity,
                    package: b.packageName || b.package || 'unknown'
                }))
            });
        }

        res.json({
            status: 'success',
            message: 'Deployment triggered successfully. All release gate validations passed.'
        });
    } catch (err: any) {
        console.error('[Gate Deploy Error]', err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

// POST /api/gates/override
router.post('/override', verifyUser, checkPermission('gate:bypass'), async (req: Request, res: Response) => {
    const { repo_id } = req.body;
    if (!repo_id) return res.status(400).json({ error: 'repo_id is required' });

    try {
        await ensurePipelineStateCollection();

        // Update pipeline_state to passing (Break Glass)
        const existingState = await databases.listDocuments(DB_ID, 'pipeline_state', [
            Query.equal('nodeId', 'release'),
            Query.limit(1)
        ]);

        if (existingState.total > 0) {
            await databases.updateDocument(DB_ID, 'pipeline_state', existingState.documents[0].$id, {
                status: 'passing'
            });
        } else {
            await databases.createDocument(DB_ID, 'pipeline_state', ID.unique(), {
                nodeId: 'release',
                status: 'passing'
            });
        }

        await logSecureAuditEvent('system', 'BREAK_GLASS_BYPASS', repo_id, `Manual Break Glass override activated for repository: ${repo_id}`);

        res.json({
            success: true,
            message: 'Break Glass Override activated. CI/CD Release Gate has been bypassed and unlocked.'
        });
    } catch (err: any) {
        console.error('[Gate Override Error]', err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

// GET /api/gates/state
router.get('/state', async (req: Request, res: Response) => {
    try {
        await ensurePipelineStateCollection();
        const existingState = await databases.listDocuments(DB_ID, 'pipeline_state', [
            Query.equal('nodeId', 'release'),
            Query.limit(1)
        ]);

        const status = existingState.total > 0 ? existingState.documents[0].status : 'passing';
        res.json({ status });
    } catch (err: any) {
        console.error('[GET Gate State Error]', err.message);
        res.status(500).json({ error: 'Failed to fetch gate state', details: err.message });
    }
});

// Original legacy routes for compatibility
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

router.get('/summary', verifyUser, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.$id;
        const reposResponse = await databases.listDocuments(
            DB_ID,
            'repositories',
            [Query.equal('user_id', userId)]
        );

        const summary = await Promise.all(reposResponse.documents.map(async (repo) => {
            const gateResult = await checkReleaseGate(repo.$id);
            return {
                repo_id: repo.$id,
                repo_name: repo.name,
                allowed: gateResult.allowed,
                blocker_count: gateResult.blocker_count,
                reasons: gateResult.blockers.map((b: any) => `${b.severity.toUpperCase()} ${b.packageName || 'VULN'}: ${b.title}`)
            };
        }));

        res.json(summary);
    } catch (err: any) {
        console.error('[Gate Summary API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
