import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types/plan.types';
import { securityRequirementsService as svc } from '../services/securityRequirementsService';

const router = Router();

// Validate at the transport boundary; reject unknown enum values with 400.
const profileSchema = z.object({
  appType: z.enum(['web', 'api', 'mobile', 'service']),
  stack: z.array(z.enum(['node', 'python', 'java', 'go', 'dotnet', 'ruby'])),
  dataTypes: z.array(z.enum(['card', 'health', 'pii', 'none'])),
  deployment: z.enum(['cloud', 'on-prem', 'hybrid']),
  authModel: z.enum(['none', 'session', 'oauth', 'mtls']),
  frameworks: z.array(z.enum(['PCI DSS', 'NIST 800-53', 'SOC 2', 'ISO 27001', 'HIPAA', 'GDPR'])),
});

// 'obsolete' is system-managed (set by reconcile), never client-settable.
const patchSchema = z.object({
  lifecycleStatus: z.enum(['open', 'satisfied', 'waived']),
  justification: z.string().max(4096).optional(),
});

const notFound = (res: Response) => res.status(404).json({ error: 'Not found' });

router.get('/projects/:projectId/profile', async (req: AuthenticatedRequest, res: Response) => {
  const result = await svc.getProfile(req.params.projectId, req.user?.$id);
  if (result === 'denied') return notFound(res);
  res.json(result.data);
});

router.put('/projects/:projectId/profile', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid profile', details: parsed.error.issues });
  const result = await svc.saveProfile(req.params.projectId, parsed.data, req.user?.$id);
  if (result === 'denied') return notFound(res);
  res.json(result.data);
});

router.post('/projects/:projectId/requirements/generate', async (req: AuthenticatedRequest, res: Response) => {
  const result = await svc.generate(req.params.projectId, req.user?.$id);
  if (result === 'denied') return notFound(res);
  if (result === 'no_profile') return res.status(400).json({ error: 'Configure the project profile before generating requirements' });
  res.json(result.data);
});

router.get('/projects/:projectId/requirements', async (req: AuthenticatedRequest, res: Response) => {
  const result = await svc.list(req.params.projectId, req.user?.$id);
  if (result === 'denied') return notFound(res);
  res.json(result.data);
});

// Correlate requirements against live scanner findings (Code & Commit): each
// requirement comes back tagged violated / attested / unverified.
router.get('/projects/:projectId/requirements/correlation', async (req: AuthenticatedRequest, res: Response) => {
  const result = await svc.getCorrelation(req.params.projectId, req.user?.$id);
  if (result === 'denied') return notFound(res);
  res.json(result.data);
});

// Repositories bound to the project — the scope correlation pulls findings from.
router.get('/projects/:projectId/repos', async (req: AuthenticatedRequest, res: Response) => {
  const result = await svc.getRepos(req.params.projectId, req.user?.$id);
  if (result === 'denied') return notFound(res);
  res.json(result.data);
});

const reposSchema = z.object({ repoIds: z.array(z.string()).max(200) });
router.put('/projects/:projectId/repos', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = reposSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid repos', details: parsed.error.issues });
  const result = await svc.setRepos(req.params.projectId, parsed.data.repoIds, req.user?.$id);
  if (result === 'denied') return notFound(res);
  res.json(result.data);
});

router.patch('/requirements/:reqId', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid update', details: parsed.error.issues });
  // updatedBy comes from the authenticated session, never the request body.
  const result = await svc.setLifecycle(req.params.reqId, parsed.data, req.user?.$id, req.user?.email);
  if (result === 'not_found') return notFound(res);
  res.json(result.data);
});

// Push a requirement into a sprint as a ticket (feature 3a). Ownership and
// reporter come from the authenticated session, never the body.
router.post('/requirements/:reqId/ticket', async (req: AuthenticatedRequest, res: Response) => {
  const ownership = { user_id: req.user?.$id ?? '', team_id: null };
  const result = await svc.pushToTicket(req.params.reqId, req.user?.$id, req.user?.email ?? '', ownership);
  if (result === 'not_found') return notFound(res);
  res.json(result);
});

export default router;
