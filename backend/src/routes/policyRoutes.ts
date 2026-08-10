import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { evaluatePolicy, isOpaAvailable } from '../services/opaService';
import { logger, errorContext, errorMessage } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: { $id: string };
}

// Appwrite SDK errors carry a numeric `.code` (e.g. 404) that isn't part of the
// standard Error shape.
function errorCode(err: unknown): number | undefined {
    return typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: number }).code : undefined;
}

const router = Router();

const evaluateSchema = z.object({
    input: z.record(z.string(), z.unknown()),
    query: z.string().trim().min(1).optional(),
});

// Get policies
router.get('/', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.$id;
        const response = await databases.listDocuments(
            DB_ID,
            'policies',
            [Query.equal('userId', userId || '')]
        );
        res.json(response.documents);
    } catch (err) {
        logger.error('[Policy API Error]', { event: 'POLICY_LIST_FAILED', userId: req.user?.$id, ...errorContext(err) });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create policy
router.post('/', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.$id;
        const policyData = {
            ...req.body,
            userId,
            isActive: true, // Legacy support
            code: 'N/A' // Legacy support
        };

        const policy = await databases.createDocument(
            DB_ID,
            'policies',
            ID.unique(),
            policyData
        );
        res.json(policy);
    } catch (err) {
        logger.error('[Policy Create Error]', { event: 'POLICY_CREATE_FAILED', userId: req.user?.$id, ...errorContext(err) });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update policy
router.patch('/:id', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.$id;

        const existing = await databases.getDocument(DB_ID, 'policies', id);
        if (existing.userId !== userId) {
            return res.status(403).json({ error: 'You do not have access to this policy' });
        }

        // Don't let the request body reassign ownership or the document id
        const updates = { ...req.body };
        delete updates.userId;
        delete updates.$id;

        const policy = await databases.updateDocument(
            DB_ID,
            'policies',
            id,
            updates
        );
        res.json(policy);
    } catch (err) {
        logger.error('[Policy Update Error]', { event: 'POLICY_UPDATE_FAILED', policyId: req.params.id, ...errorContext(err) });
        if (errorCode(err) === 404) return res.status(404).json({ error: 'Policy not found' });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete policy
router.delete('/:id', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.$id;

        const existing = await databases.getDocument(DB_ID, 'policies', id);
        if (existing.userId !== userId) {
            return res.status(403).json({ error: 'You do not have access to this policy' });
        }

        await databases.deleteDocument(DB_ID, 'policies', id);
        res.json({ message: 'Policy deleted' });
    } catch (err) {
        logger.error('[Policy Delete Error]', { event: 'POLICY_DELETE_FAILED', policyId: req.params.id, ...errorContext(err) });
        if (errorCode(err) === 404) return res.status(404).json({ error: 'Policy not found' });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/policies/opa/status - Is the OPA CLI available on this host?
router.get('/opa/status', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    res.json({ available: await isOpaAvailable() });
});

// POST /api/policies/:id/evaluate - Run this policy's Rego code (regoCode field)
// against the given input, falling back to the bundled default release-gate
// policy if the stored policy has no regoCode of its own.
router.post('/:id/evaluate', verifyUser, validateBody(evaluateSchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.$id;
        const { input, query } = req.body;

        const policy = await databases.getDocument(DB_ID, 'policies', id);
        if (policy.userId !== userId) {
            return res.status(403).json({ error: 'You do not have access to this policy' });
        }

        const evaluation = await evaluatePolicy(input, {
            regoCode: typeof policy.regoCode === 'string' ? policy.regoCode : undefined,
            query,
        });

        res.json(evaluation);
    } catch (err) {
        logger.error('[Policy Evaluate Error]', { event: 'POLICY_EVALUATE_FAILED', policyId: req.params.id, ...errorContext(err) });
        if (errorCode(err) === 404) return res.status(404).json({ error: 'Policy not found' });
        res.status(502).json({ error: 'Policy evaluation failed' });
    }
});

export default router;
