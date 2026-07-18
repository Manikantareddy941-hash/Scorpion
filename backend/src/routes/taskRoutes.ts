import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

const ALLOWED_STATUSES = new Set(['todo', 'in_progress', 'completed', 'blocked']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

interface TaskInput {
    title?: unknown;
    description?: unknown;
    status?: unknown;
    priority?: unknown;
    due_date?: unknown;
    repo_url?: unknown;
}

/**
 * Builds the stored shape from a request body, or returns an error string.
 *
 * Only these six fields are ever written. The browser used to assemble the
 * document itself, which meant it also chose `user_id` — the one field that
 * decides whose task list a row lands in. It is taken from the session below
 * and never read from the body.
 */
function buildTaskPatch(body: TaskInput, partial: boolean): string | Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    if (body.title !== undefined) {
        const title = String(body.title).trim();
        if (!title) return 'title cannot be empty';
        if (title.length > 512) return 'title is too long';
        patch.title = title;
    } else if (!partial) {
        return 'title is required';
    }

    if (body.description !== undefined) patch.description = String(body.description).slice(0, 8192);

    if (body.status !== undefined) {
        if (!ALLOWED_STATUSES.has(String(body.status))) {
            return `status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`;
        }
        patch.status = String(body.status);
    }

    if (body.priority !== undefined) {
        if (!ALLOWED_PRIORITIES.has(String(body.priority))) {
            return `priority must be one of: ${[...ALLOWED_PRIORITIES].join(', ')}`;
        }
        patch.priority = String(body.priority);
    }

    if (body.due_date !== undefined) {
        if (body.due_date === null || body.due_date === '') {
            patch.due_date = null;
        } else {
            const parsed = new Date(String(body.due_date));
            if (Number.isNaN(parsed.getTime())) return 'due_date must be a valid date';
            patch.due_date = parsed.toISOString();
        }
    }

    if (body.repo_url !== undefined) {
        patch.repo_url = body.repo_url === null || body.repo_url === '' ? null : String(body.repo_url);
    }

    return patch;
}

router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const built = buildTaskPatch(req.body ?? {}, false);
        if (typeof built === 'string') return res.status(400).json({ error: built });

        const task = await databases.createDocument(DB_ID, COLLECTIONS.TASKS, ID.unique(), {
            status: 'todo',
            priority: 'medium',
            ...built,
            user_id: req.user!.$id,
        });
        res.status(201).json(task);
    } catch (err) {
        next(err);
    }
});

router.patch('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const built = buildTaskPatch(req.body ?? {}, true);
        if (typeof built === 'string') return res.status(400).json({ error: built });

        // 404 rather than 403 on someone else's task: a 403 confirms the id
        // exists, which turns this route into an enumeration oracle.
        const existing = await databases
            .getDocument(DB_ID, COLLECTIONS.TASKS, req.params.id)
            .catch(() => null);
        if (!existing || existing.user_id !== req.user!.$id) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const task = await databases.updateDocument(DB_ID, COLLECTIONS.TASKS, req.params.id, built);
        res.json(task);
    } catch (err) {
        next(err);
    }
});

export default router;
