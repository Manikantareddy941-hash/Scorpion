import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logAuditEvent } from '../utils/auditLogger';
import { canAccessResource } from '../services/tenancyService';
import { logger, errorContext } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
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

/**
 * Loads a finding together with the repository it belongs to, or null if this
 * caller cannot reach it.
 *
 * A missing finding, a finding with no repository, and someone else's finding
 * are deliberately indistinguishable: callers turn all three into a 404. A 403
 * would confirm the id exists, which makes these routes an enumeration oracle.
 */
interface FindingDocument extends Models.Document {
    status?: string;
    repo_id?: string;
    reopenCount?: number;
    title?: string;
}

async function loadAccessibleFinding(
    id: string,
    userId: string,
): Promise<{ finding: FindingDocument; repo: Models.Document } | null> {
    const finding = await databases
        .getDocument<FindingDocument>(DB_ID, COLLECTIONS.FINDINGS, id)
        .catch(() => null);
    if (!finding) return null;

    const repo = finding.repo_id
        ? await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, finding.repo_id).catch(() => null)
        : null;
    if (!repo || !(await canAccessResource(repo, userId))) return null;

    return { finding, repo };
}

/**
 * A single finding plus its repository.
 *
 * The remediation panel used to assemble this in the browser, and reached the
 * repository by way of `finding.scan_result_id` — a field nothing in the system
 * writes. That lookup threw on every open, so the panel never got past it to
 * request an AI remediation. Findings carry `repo_id` directly, so the scan hop
 * was never needed.
 */
router.get('/:id', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const loaded = await loadAccessibleFinding(req.params.id, req.user?.$id || '');
        if (!loaded) return res.status(404).json({ error: 'Finding not found' });
        res.json(loaded);
    } catch (err: unknown) {
        logger.error('[Finding API Error]', {
            event: 'FINDING_READ_FAILED', findingId: req.params.id, ...errorContext(err),
        });
        res.status(500).json({ error: 'Internal server error' });
    }
});

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
        const loaded = await loadAccessibleFinding(id, userId);
        if (!loaded) {
            return res.status(404).json({ error: 'Finding not found' });
        }
        const existingFinding = loaded.finding;

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
        logger.error('[Finding API Error]', {
            event: 'FINDING_STATUS_UPDATE_FAILED', findingId: req.params.id, ...errorContext(err),
        });
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
