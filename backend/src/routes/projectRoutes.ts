import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { logger, errorContext } from '../services/logger';

import {
    createProject,
    getProjects,
    getProjectDashboard,
    importRepoToProject,
    getProjectScanHistory
} from '../services/projectService';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

/* -------------------------------------------------------------------------- */
/* CREATE PROJECT */
/* -------------------------------------------------------------------------- */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Project name is required' });

        const { data, error } = await createProject(req.user!.$id, name, description);

        // Logging added with this change, not moved: these handlers had none, so
        // the response body was the only place the cause existed. Sanitising the
        // body without this would have deleted the failure outright rather than
        // relocating it.
        if (error) {
            logger.error('[Projects] create failed', { event: 'PROJECT_CREATE_FAILED', ...errorContext(error) });
            return res.status(500).json({ error: 'Failed to create project' });
        }

        res.json(data);
    } catch (err: unknown) {
        logger.error('[Projects] create failed', { event: 'PROJECT_CREATE_FAILED', ...errorContext(err) });
        res.status(500).json({ error: 'Failed to create project' });
    }
});

/* -------------------------------------------------------------------------- */
/* LIST PROJECTS */
/* -------------------------------------------------------------------------- */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await getProjects(req.user!.$id);
        if (error) {
            logger.error('[Projects] list failed', { event: 'PROJECT_LIST_FAILED', ...errorContext(error) });
            return res.status(500).json({ error: 'Failed to list projects' });
        }

        res.json(data);
    } catch (err: unknown) {
        logger.error('[Projects] list failed', { event: 'PROJECT_LIST_FAILED', ...errorContext(err) });
        res.status(500).json({ error: 'Failed to list projects' });
    }
});

/* -------------------------------------------------------------------------- */
/* PROJECT DASHBOARD */
/* -------------------------------------------------------------------------- */
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await getProjectDashboard(req.params.id, req.user!.$id);

        if (error) {
            // The service signals not-found as a plain string and a real failure
            // as an Error; that split stays, only the body text is genericised.
            const notFound = typeof error === 'string';
            logger.error('[Projects] dashboard read failed', {
                event: 'PROJECT_DASHBOARD_READ_FAILED', projectId: req.params.id, notFound, ...errorContext(error),
            });
            return res
                .status(notFound ? 404 : 500)
                .json({ error: notFound ? 'Project not found' : 'Failed to load project dashboard' });
        }

        res.json(data);
    } catch (err: unknown) {
        logger.error('[Projects] dashboard read failed', {
            event: 'PROJECT_DASHBOARD_READ_FAILED', projectId: req.params.id, ...errorContext(err),
        });
        res.status(500).json({ error: 'Failed to load project dashboard' });
    }
});

/* -------------------------------------------------------------------------- */
/* IMPORT REPO */
/* -------------------------------------------------------------------------- */
router.post('/:id/repos', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'Repo URL is required' });

        const { data, error } = await importRepoToProject(req.params.id, req.user!.$id, url);

        if (error) {
            logger.error('[Projects] repo import failed', {
                event: 'PROJECT_REPO_IMPORT_FAILED', projectId: req.params.id, ...errorContext(error),
            });
            return res.status(500).json({ error: 'Failed to import repository' });
        }

        res.json(data);
    } catch (err: unknown) {
        logger.error('[Projects] repo import failed', {
            event: 'PROJECT_REPO_IMPORT_FAILED', projectId: req.params.id, ...errorContext(err),
        });
        res.status(500).json({ error: 'Failed to import repository' });
    }
});

/* -------------------------------------------------------------------------- */
/* PROJECT SCAN HISTORY */
/* -------------------------------------------------------------------------- */
router.get('/:id/scans', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await getProjectScanHistory(req.params.id, req.user!.$id);

        if (error) {
            logger.error('[Projects] scan history read failed', {
                event: 'PROJECT_SCAN_HISTORY_READ_FAILED', projectId: req.params.id, ...errorContext(error),
            });
            return res.status(500).json({ error: 'Failed to load scan history' });
        }

        res.json(data);
    } catch (err: unknown) {
        logger.error('[Projects] scan history read failed', {
            event: 'PROJECT_SCAN_HISTORY_READ_FAILED', projectId: req.params.id, ...errorContext(err),
        });
        res.status(500).json({ error: 'Failed to load scan history' });
    }
});

export default router;