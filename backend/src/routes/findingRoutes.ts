import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { linkCommitToScan, getFindingHistory } from '../services/gitTraceabilityService';
import { hasRequiredRole } from '../services/rbacService';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Link commit to scan
router.post('/scans/:id/commit', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const scanId = req.params.id;
        const { repo_id, commit_hash, branch, pr_number } = req.body;
        await linkCommitToScan(scanId, repo_id, { commit_hash, branch, pr_number });
        res.json({ message: 'Commit linked to scan successfully' });
    } catch (err) {
        next(err);
    }
});

// Get finding history
router.get('/:id/history', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const history = await getFindingHistory(req.params.id);
        res.json(history);
    } catch (err) {
        next(err);
    }
});

// Resolve a finding manually
router.post('/:id/resolve', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const findingId = req.params.id;
        const { state, reason } = req.body;

        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
        if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
        const finding = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, findingId);
        if (!finding) return res.status(404).json({ error: 'Finding not found' });

        const userId = req.user!.$id;
        const hasPerm = await hasRequiredRole(userId, finding.repo_id, 'developer');
        if (!hasPerm) return res.status(403).json({ error: 'Requires developer permission' });

        if (!['fixed', 'accepted_risk'].includes(state)) {
            return res.status(400).json({ error: 'Invalid state' });
        }

        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITY_FIXES}`);
        if (!COLLECTIONS.VULNERABILITY_FIXES) throw new Error("collectionId is undefined");
        const resolution = await databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITY_FIXES, ID.unique(), {
            finding_id: findingId,
            state,
            reason,
            user_id: userId
        });

        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
        if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
        await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, findingId, {
            resolution_status: state,
            resolution_id: resolution.$id,
            updated_at: new Date().toISOString()
        });

        res.json({ message: `Finding marked as ${state}`, resolution });
    } catch (err) {
        next(err);
    }
});

// Get vulnerabilities for a specific scan
router.get('/scans/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
        if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
        const vulnerabilities = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('scanId', req.params.id)
        ]);
        res.json(vulnerabilities.documents);
    } catch (error: unknown) {
        next(error);
    }
});

// Convert vulnerability to task (issue)
router.post('/:id/convert', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
        if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
        const vuln = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, req.params.id);
        if (!vuln) return res.status(404).json({ error: 'Vulnerability not found' });

        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.TASKS}`);
        if (!COLLECTIONS.TASKS) throw new Error("collectionId is undefined");
        const task = await databases.createDocument(DB_ID, COLLECTIONS.TASKS, ID.unique(), {
            user_id: req.user!.$id,
            title: `Fix ${vuln.tool} finding: ${vuln.message.substring(0, 50)}...`,
            description: `Tool: ${vuln.tool}\nSeverity: ${vuln.severity}\nFile: ${vuln.file_path}:${vuln.line_number}\n\nOriginal Message: ${vuln.message}`,
            priority: vuln.severity === 'critical' || vuln.severity === 'high' ? 'high' : 'medium',
            status: 'todo',
            repository_id: vuln.repo_id
        });

        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
        if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
        await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, req.params.id, {
            status: 'resolved',
            updated_at: new Date().toISOString()
        });

        res.json(task);
    } catch (error: unknown) {
        next(error);
    }
});

export default router;
