import { Router, Response } from 'express';
import { User } from '@supabase/supabase-js';
import { Request } from 'express';
import {
    createProject,
    getProjects,
    getProjectDashboard,
    importRepoToProject,
    getProjectScanHistory
} from '../services/projectService';

interface AuthenticatedRequest extends Request {
    user?: User;
}

const router = Router();

// Create Project
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });

    const { data, error } = await createProject(req.user!.id, name, description);
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

// List Projects
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    const { data, error } = await getProjects(req.user!.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Project Dashboard
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    const { data, error } = await getProjectDashboard(req.params.id, req.user!.id);
    if (error) return res.status(typeof error === 'string' ? 404 : 500).json({ error: typeof error === 'string' ? error : (error as any).message });
    res.json(data);
});

// Import Repo to Project
router.post('/:id/repos', async (req: AuthenticatedRequest, res: Response) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Repo URL is required' });

    const { data, error } = await importRepoToProject(req.params.id, req.user!.id, url);
    if (error) return res.status(500).json({ error: typeof error === 'string' ? error : (error as any).message });
    res.json(data);
});

// Project Scan History (Placeholder)
router.get('/:id/scans', async (req: AuthenticatedRequest, res: Response) => {
    const { data, error } = await getProjectScanHistory(req.params.id, req.user!.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

export default router;
