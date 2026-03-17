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

const router = Router();

/* -------------------------------------------------------------------------- */
/* CREATE PROJECT */
/* -------------------------------------------------------------------------- */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Project name is required' });

        const { data, error } = await createProject(req.user!.$id, name, description);

        if (error) return res.status(500).json({ error: (error as any).message });

        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/* -------------------------------------------------------------------------- */
/* LIST PROJECTS */
/* -------------------------------------------------------------------------- */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await getProjects(req.user!.$id);
        if (error) return res.status(500).json({ error: (error as any).message });

        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
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
                .json({ error: typeof error === 'string' ? error : (error as any).message });
        }

        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
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
                error: typeof error === 'string' ? error : (error as any).message
            });

        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/* -------------------------------------------------------------------------- */
/* PROJECT SCAN HISTORY */
/* -------------------------------------------------------------------------- */
router.get('/:id/scans', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await getProjectScanHistory(req.params.id, req.user!.$id);

        if (error) return res.status(500).json({ error: (error as any).message });

        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;