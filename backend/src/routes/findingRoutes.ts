import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logAuditEvent } from '../utils/auditLogger';
import { canAccessResource } from '../services/tenancyService';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

const router = Router();

/**
 * The statuses a finding may be moved to. Previously any string the caller sent
 * was written straight through, so a typo silently created a status nothing
 * counts — a finding set to 'resolved ' or 'Resolved' disappears from the open
 * list without appearing in the resolved one.
 */
const ALLOWED_STATUSES = new Set([
    'open', 'resolved', 'remediated', 'dismissed', 'false_positive', 'snoozed',
]);

// Update finding status (e.g., mark as resolved)
router.patch('/:id', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status, snoozeUntil } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }
        if (!ALLOWED_STATUSES.has(status)) {
            return res.status(400).json({
                error: `Unsupported status. Expected one of: ${[...ALLOWED_STATUSES].join(', ')}`,
            });
        }

        const userId = req.user?.$id || '';
        // 404 rather than 403 for a finding this caller cannot reach: a 403
        // confirms the id exists, which makes this route an enumeration oracle.
        // A missing finding, a finding with no repository, and someone else's
        // finding are deliberately indistinguishable from outside.
        const existingFinding = await databases
            .getDocument(DB_ID, COLLECTIONS.FINDINGS, id)
            .catch(() => null);
        if (!existingFinding) {
            return res.status(404).json({ error: 'Finding not found' });
        }
        const repo = existingFinding.repo_id
            ? await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, existingFinding.repo_id).catch(() => null)
            : null;
        if (!repo || !(await canAccessResource(repo, userId))) {
            return res.status(404).json({ error: 'Finding not found' });
        }

        const wasResolved = existingFinding.status === 'resolved';
        const nowReopened = status !== 'resolved';
        const patch: Record<string, unknown> = { status };
        if (status === 'resolved') patch.resolvedAt = new Date().toISOString();
        if (wasResolved && nowReopened) patch.reopenCount = Number(existingFinding.reopenCount ?? 0) + 1;
        // Only meaningful alongside a snooze, and only as a timestamp — the
        // client supplies the deadline, so it must not be written unvalidated.
        if (status === 'snoozed' && snoozeUntil !== undefined) {
            const parsed = new Date(snoozeUntil);
            if (Number.isNaN(parsed.getTime())) {
                return res.status(400).json({ error: 'snoozeUntil must be a valid date' });
            }
            patch.snoozeUntil = parsed.toISOString();
        }

        const updatedFinding = await databases.updateDocument(
            DB_ID,
            COLLECTIONS.FINDINGS,
            id,
            patch
        );

        await logAuditEvent('FINDING_RESOLVED', `Security finding "${updatedFinding.title}" marked as ${status}`, userId, updatedFinding.repo_id);

        res.json(updatedFinding);
    } catch (err: unknown) {
        logger.error('[Finding API Error]', errorMessage(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
