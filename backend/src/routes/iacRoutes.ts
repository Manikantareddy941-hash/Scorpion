// backend/src/routes/iacRoutes.ts
// IaC engine API: workspaces hold Terraform/OpenTofu config (HCL or .tf.json),
// runs go plan → human approval → apply. Mounted behind `authenticate`.
import { Router, Response } from 'express';
import { z } from 'zod';
import {
    createWorkspace,
    listWorkspaces,
    getWorkspace,
    getConfig,
    updateConfig,
    startPlan,
    approveApply,
    getRun,
    listRuns,
} from '../services/iacService';
import { logger } from '../services/logger';

// 256 KB of HCL is a very large config; anything bigger is abuse or a mistake.
const MAX_CONFIG_BYTES = 256 * 1024;

const workspaceSchema = z.object({
    name: z.string().min(1).max(100),
    config: z.string().min(1).max(MAX_CONFIG_BYTES),
});

const configSchema = z.object({
    config: z.string().min(1).max(MAX_CONFIG_BYTES),
});

const idSchema = z.string().uuid();

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

/** Maps iacService error codes to HTTP responses; anything else is a 500. */
function handleServiceError(err: unknown, res: Response): void {
    const message = errorMessage(err);
    if (message === 'WORKSPACE_BUSY') {
        res.status(409).json({ error: 'A run is already in progress for this workspace' });
    } else if (message === 'RUN_NOT_FOUND') {
        res.status(404).json({ error: 'Run not found' });
    } else if (message === 'RUN_NOT_APPROVABLE') {
        res.status(409).json({ error: 'Run is not in planned state; only planned runs can be applied' });
    } else {
        logger.error(`[IaC API] ${message}`);
        res.status(500).json({ error: 'Internal error' });
    }
}

const router = Router();

// POST /api/iac/workspaces — create a workspace with its initial config
router.post('/workspaces', async (req, res) => {
    const parsed = workspaceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    try {
        const workspace = await createWorkspace(parsed.data.name, parsed.data.config);
        return res.status(201).json(workspace);
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// GET /api/iac/workspaces — list workspaces
router.get('/workspaces', async (_req, res) => {
    try {
        return res.json(await listWorkspaces());
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// GET /api/iac/workspaces/:id — workspace + current config
router.get('/workspaces/:id', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid workspace id' });
    const workspace = await getWorkspace(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    try {
        return res.json({ ...workspace, config: await getConfig(req.params.id) });
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// PUT /api/iac/workspaces/:id/config — replace the config
router.put('/workspaces/:id/config', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid workspace id' });
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    if (!(await getWorkspace(req.params.id))) return res.status(404).json({ error: 'Workspace not found' });
    try {
        await updateConfig(req.params.id, parsed.data.config);
        return res.json({ ok: true });
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// POST /api/iac/workspaces/:id/plan — start a plan (body { destroy: true } for a destroy-plan)
router.post('/workspaces/:id/plan', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid workspace id' });
    if (!(await getWorkspace(req.params.id))) return res.status(404).json({ error: 'Workspace not found' });
    try {
        const run = await startPlan(req.params.id, req.body?.destroy === true);
        return res.status(202).json(run);
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// POST /api/iac/workspaces/:id/runs/:runId/apply — approve and apply a planned run
router.post('/workspaces/:id/runs/:runId/apply', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success || !idSchema.safeParse(req.params.runId).success) {
        return res.status(400).json({ error: 'Invalid id' });
    }
    try {
        const run = await approveApply(req.params.id, req.params.runId);
        return res.status(202).json(run);
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// GET /api/iac/workspaces/:id/runs — run history (newest first)
router.get('/workspaces/:id/runs', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid workspace id' });
    try {
        return res.json(await listRuns(req.params.id));
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// GET /api/iac/workspaces/:id/runs/:runId — run status, summary, logs
router.get('/workspaces/:id/runs/:runId', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success || !idSchema.safeParse(req.params.runId).success) {
        return res.status(400).json({ error: 'Invalid id' });
    }
    const run = await getRun(req.params.id, req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json(run);
});

export default router;
