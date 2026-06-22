import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';

import {
    createProject,
    getProjects,
    getProjectDashboard,
    importRepoToProject,
    getProjectScanHistory
} from '../services/projectService';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

function errorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    return err instanceof Error ? err.message : 'Unknown error';
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

        if (error) return res.status(500).json({ error: errorMessage(error) });

        res.json(data);
    } catch (err: unknown) {
        res.status(500).json({ error: errorMessage(err) });
    }
});

/* -------------------------------------------------------------------------- */
/* LIST PROJECTS */
/* -------------------------------------------------------------------------- */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await getProjects(req.user!.$id);
        if (error) return res.status(500).json({ error: errorMessage(error) });

        res.json(data);
    } catch (err: unknown) {
        res.status(500).json({ error: errorMessage(err) });
    }
});

/* -------------------------------------------------------------------------- */
/* PROJECT DASHBOARD */
/* -------------------------------------------------------------------------- */
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await getProjectDashboard(req.params.id, req.user!.$id);

        if (error) {
            return res
                .status(typeof error === 'string' ? 404 : 500)
                .json({ error: errorMessage(error) });
        }

        res.json(data);
    } catch (err: unknown) {
        res.status(500).json({ error: errorMessage(err) });
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

        if (error)
            return res.status(500).json({
                error: errorMessage(error)
            });

        res.json(data);
    } catch (err: unknown) {
        res.status(500).json({ error: errorMessage(err) });
    }
});

/* -------------------------------------------------------------------------- */
/* PROJECT SCAN HISTORY */
/* -------------------------------------------------------------------------- */
router.get('/:id/scans', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await getProjectScanHistory(req.params.id, req.user!.$id);

        if (error) return res.status(500).json({ error: errorMessage(error) });

        res.json(data);
    } catch (err: unknown) {
        res.status(500).json({ error: errorMessage(err) });
    }
});

export default router;