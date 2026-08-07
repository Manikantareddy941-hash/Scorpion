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
    setWorkspaceCredential,
    startPlan,
    approveApply,
    getRun,
    listRuns,
} from '../services/iacService';
import { createProfile, listProfiles, deleteProfile } from '../services/iacCredentials';
import { logger, errorMessage } from '../services/logger';

// 256 KB of HCL is a very large config; anything bigger is abuse or a mistake.
const MAX_CONFIG_BYTES = 256 * 1024;

const workspaceSchema = z.object({
    name: z.string().min(1).max(100),
    config: z.string().min(1).max(MAX_CONFIG_BYTES),
    credentialProfileId: z.string().uuid().nullish(),
});

const profileSchema = z.object({
    name: z.string().min(1).max(100),
    provider: z.enum(['aws', 'azure', 'gcp', 'other']),
    // Env var names only (AWS_ACCESS_KEY_ID, ARM_CLIENT_SECRET, GOOGLE_CREDENTIALS, ...);
    // values capped at 16KB to fit GCP service-account JSON.
    env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().min(1).max(16 * 1024)).refine(
        env => Object.keys(env).length >= 1 && Object.keys(env).length <= 64,
        { message: 'Between 1 and 64 env vars required' }
    ),
});

const configSchema = z.object({
    config: z.string().min(1).max(MAX_CONFIG_BYTES),
});

const idSchema = z.string().uuid();

/** Maps iacService error codes to HTTP responses; anything else is a 500. */
function handleServiceError(err: unknown, res: Response): void {
    const message = errorMessage(err);
    if (message === 'IAC_CRED_KEY_MISSING') {
        res.status(503).json({ error: 'Credential encryption key not configured (set IAC_CRED_KEY on the backend)' });
    } else if (message === 'PROFILE_NOT_FOUND') {
        res.status(404).json({ error: 'Credential profile not found' });
    } else if (message === 'WORKSPACE_NOT_FOUND') {
        res.status(404).json({ error: 'Workspace not found' });
    } else if (message === 'WORKSPACE_BUSY') {
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
        const workspace = await createWorkspace(parsed.data.name, parsed.data.config, parsed.data.credentialProfileId);
        return res.status(201).json(workspace);
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// POST /api/iac/credentials — create an encrypted cloud credential profile
router.post('/credentials', async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    try {
        const profile = await createProfile(parsed.data.name, parsed.data.provider, parsed.data.env);
        return res.status(201).json(profile); // env keys only — values are never returned
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// GET /api/iac/credentials — list profiles (names + env key names, never values)
router.get('/credentials', async (_req, res) => {
    try {
        return res.json(await listProfiles());
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// DELETE /api/iac/credentials/:id
router.delete('/credentials/:id', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid profile id' });
    try {
        await deleteProfile(req.params.id);
        return res.json({ ok: true });
    } catch (err) {
        return handleServiceError(err, res);
    }
});

// PUT /api/iac/workspaces/:id/credential — link/unlink a profile ({ profileId: uuid | null })
router.put('/workspaces/:id/credential', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid workspace id' });
    const parsed = z.object({ profileId: z.string().uuid().nullable() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    try {
        return res.json(await setWorkspaceCredential(req.params.id, parsed.data.profileId));
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

// POST /api/iac/workspaces/:id/plan — start a plan
// body: { destroy?: true } for a destroy-plan, { force?: true } to override a failed security gate (audited on the run)
router.post('/workspaces/:id/plan', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid workspace id' });
    if (!(await getWorkspace(req.params.id))) return res.status(404).json({ error: 'Workspace not found' });
    try {
        const run = await startPlan(req.params.id, req.body?.destroy === true, req.body?.force === true);
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
