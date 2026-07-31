import { Router, Response } from 'express';
import { planService } from '../services/planService';
import { resolveCreationOwnership } from '../services/tenancyService';
import { AuthenticatedRequest } from '../types/plan.types';

const router = Router();

function sendAccessResult(res: Response, result: 'not_found' | 'forbidden' | { ok: true; data: unknown }) {
  if (result === 'not_found') return res.status(404).json({ error: 'Not found' });
  if (result === 'forbidden') return res.status(403).json({ error: 'You do not have access to this resource' });
  res.json(result.data);
}

/* PROJECTS */

router.get('/projects', async (req: AuthenticatedRequest, res: Response) => {
  res.json(await planService.listProjects(req.user?.$id));
});

router.post('/projects', async (req: AuthenticatedRequest, res: Response) => {
  const { name, repoId, type } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  // Ownership comes from the session and the verified active team, never the
  // body — a body-supplied team would let a caller file a project under a team
  // they do not belong to.
  const ownership = await resolveCreationOwnership(req, req.user?.$id || '');
  const data = await planService.createProject({ name, repoId, type }, req.user?.$id, ownership.team_id);
  res.status(201).json(data);
});

/* CVE CLUSTERS */

// Outstanding findings across the project's bound repositories, grouped by the
// advisory they share. Read-only: it proposes the grouping, it does not create
// anything.
router.get('/projects/:projectId/cve-clusters', async (req: AuthenticatedRequest, res: Response) => {
  const data = await planService.listCveClusters(req.params.projectId, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.json(data);
});

// Groups every outstanding finding for one advisory under a single epic.
// 412 when the cveId attribute has not been provisioned: without it a repeat
// call would mint a duplicate epic, so this refuses rather than littering the
// project during the migration window.
router.post('/projects/:projectId/epics/from-cve', async (req: AuthenticatedRequest, res: Response) => {
  const { cveId } = req.body ?? {};
  if (!cveId || typeof cveId !== 'string') return res.status(400).json({ error: 'cveId is required' });

  const result = await planService.createEpicFromCve(req.params.projectId, cveId, req.user?.$id);
  if (result === null) return res.status(403).json({ error: 'You do not have access to this project' });
  if (result === 'not_migrated') {
    return res.status(412).json({ error: 'Epic grouping is being upgraded — try again shortly' });
  }
  if (result === 'degraded') {
    return res.status(503).json({ error: 'Findings could not be read in full; grouping would be incomplete' });
  }
  if (result === 'no_findings') {
    return res.status(404).json({ error: `No outstanding findings for ${cveId} in this project` });
  }
  res.status(201).json(result);
});

/* EPICS */

router.get('/projects/:projectId/epics', async (req: AuthenticatedRequest, res: Response) => {
  const data = await planService.listEpics(req.params.projectId, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.json(data);
});

router.post('/projects/:projectId/epics', async (req: AuthenticatedRequest, res: Response) => {
  const { title, color, startDate, endDate } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const data = await planService.createEpic(req.params.projectId, { title, color, startDate, endDate }, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.status(201).json(data);
});

/* SPRINTS */

router.get('/projects/:projectId/sprints', async (req: AuthenticatedRequest, res: Response) => {
  const data = await planService.listSprints(req.params.projectId, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.json(data);
});

router.post('/projects/:projectId/sprints', async (req: AuthenticatedRequest, res: Response) => {
  const { name, goal, startDate, endDate } = req.body;
  if (!name) return res.status(400).json({ error: 'Sprint name is required' });
  const data = await planService.createSprint(req.params.projectId, { name, goal, startDate, endDate }, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.status(201).json(data);
});

router.patch('/sprints/:sprintId', async (req: AuthenticatedRequest, res: Response) => {
  const result = await planService.updateSprint(req.params.sprintId, req.body, req.user?.$id, req.user?.email);
  sendAccessResult(res, result);
});

/* ISSUES */

router.get('/projects/:projectId/issues', async (req: AuthenticatedRequest, res: Response) => {
  const data = await planService.listIssues(req.params.projectId, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.json(data);
});

router.post('/projects/:projectId/issues', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await planService.createIssue(req.params.projectId, req.body, req.user?.$id);
    if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
    res.status(201).json(data);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid issue payload' });
  }
});

router.patch('/issues/:issueId', async (req: AuthenticatedRequest, res: Response) => {
  const result = await planService.updateIssue(req.params.issueId, req.body, req.user?.$id, req.user?.email);
  sendAccessResult(res, result);
});

router.delete('/issues/:issueId', async (req: AuthenticatedRequest, res: Response) => {
  const result = await planService.deleteIssue(req.params.issueId, req.user?.$id);
  sendAccessResult(res, result === 'not_found' || result === 'forbidden' ? result : { ok: true, data: { success: true } });
});

/* COMMENTS */

router.get('/issues/:issueId/comments', async (req: AuthenticatedRequest, res: Response) => {
  const result = await planService.listComments(req.params.issueId, req.user?.$id);
  sendAccessResult(res, result);
});

router.post('/issues/:issueId/comments', async (req: AuthenticatedRequest, res: Response) => {
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'Body is required' });
  const result = await planService.createComment(req.params.issueId, body, req.user?.email, req.user?.$id);
  if (result === 'not_found' || result === 'forbidden') return sendAccessResult(res, result);
  res.status(201).json(result.data);
});

/* AUTOMATION RULES */

router.get('/projects/:projectId/automation-rules', async (req: AuthenticatedRequest, res: Response) => {
  const data = await planService.listAutomationRules(req.params.projectId, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.json(data);
});

router.post('/projects/:projectId/automation-rules', async (req: AuthenticatedRequest, res: Response) => {
  const { trigger, conditions, action } = req.body;
  if (!trigger || !action) return res.status(400).json({ error: 'Trigger and action are required' });
  const data = await planService.createAutomationRule(req.params.projectId, { trigger, conditions, action }, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.status(201).json(data);
});

router.delete('/projects/:projectId/automation-rules/:ruleId', async (req: AuthenticatedRequest, res: Response) => {
  const result = await planService.deleteAutomationRule(req.params.projectId, req.params.ruleId, req.user?.$id);
  sendAccessResult(res, result === 'forbidden' || result === 'not_found' ? result : { ok: true, data: { success: true } });
});

// Automation run history (proof the rules actually fire)
router.get('/projects/:projectId/automation-runs', async (req: AuthenticatedRequest, res: Response) => {
  const data = await planService.listAutomationRuns(req.params.projectId, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.json(data);
});

/* SPRINT SNAPSHOTS (real velocity history) */

router.get('/projects/:projectId/sprint-snapshots', async (req: AuthenticatedRequest, res: Response) => {
  const data = await planService.listSprintSnapshots(req.params.projectId, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.json(data);
});

/* WORKLOGS (time tracking) */

router.get('/issues/:issueId/worklogs', async (req: AuthenticatedRequest, res: Response) => {
  const result = await planService.listWorklogs(req.params.issueId, req.user?.$id);
  sendAccessResult(res, result);
});

router.post('/issues/:issueId/worklogs', async (req: AuthenticatedRequest, res: Response) => {
  const minutes = Number(req.body.minutes);
  if (!minutes || minutes <= 0) return res.status(400).json({ error: 'minutes must be a positive number' });
  const result = await planService.createWorklog(req.params.issueId, { minutes, comment: req.body.comment }, req.user?.email, req.user?.$id);
  if (result === 'not_found' || result === 'forbidden') return sendAccessResult(res, result);
  res.status(201).json(result.data);
});

/* VULNERABILITIES */

// Returns { items, degraded }. `degraded` lets the client distinguish "no
// findings" from "could not read them" — rendering the latter as the former
// tells the user everything is handled at the moment we could not check.
router.get('/vulnerabilities', async (req: AuthenticatedRequest, res: Response) => {
  res.json(await planService.listVulnerabilities(req.user?.$id));
});

/* THREATS */

router.get('/projects/:projectId/threats', async (req: AuthenticatedRequest, res: Response) => {
  const data = await planService.listThreats(req.params.projectId, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.json(data);
});

router.post('/projects/:projectId/threats', async (req: AuthenticatedRequest, res: Response) => {
  const { title, strideCategory, severity, description, mitigation } = req.body;
  if (!title || !strideCategory || !severity) {
    return res.status(400).json({ error: 'Title, strideCategory, and severity are required' });
  }
  const data = await planService.createThreat(req.params.projectId, { title, strideCategory, severity, description, mitigation }, req.user?.$id);
  if (data === null) return res.status(403).json({ error: 'You do not have access to this project' });
  res.status(201).json(data);
});

router.patch('/projects/:projectId/threats/:id', async (req: AuthenticatedRequest, res: Response) => {
  const result = await planService.updateThreat(req.params.projectId, req.params.id, req.body, req.user?.$id);
  sendAccessResult(res, result === 'forbidden' || result === 'not_found' ? result : result);
});

router.delete('/projects/:projectId/threats/:id', async (req: AuthenticatedRequest, res: Response) => {
  const result = await planService.deleteThreat(req.params.projectId, req.params.id, req.user?.$id);
  sendAccessResult(res, result === 'forbidden' || result === 'not_found' ? result : { ok: true, data: { success: true } });
});

router.post('/projects/:projectId/threats/:id/convert', async (req: AuthenticatedRequest, res: Response) => {
  const result = await planService.convertThreatToIssue(req.params.projectId, req.params.id, req.user?.$id);
  sendAccessResult(res, result === 'forbidden' || result === 'not_found' ? result : result);
});

// AI STRIDE: generate threats for the project from its components / architecture text
router.post('/projects/:projectId/threats/ai-generate', async (req: AuthenticatedRequest, res: Response) => {
  const { components, architecture } = req.body ?? {};
  try {
    const result = await planService.aiGenerateThreats(
      req.params.projectId,
      { components, architecture },
      req.user?.$id
    );
    if (result === 'forbidden') return res.status(403).json({ error: 'You do not have access to this project' });
    res.status(201).json(result.data);
  } catch (err: unknown) {
    res.status(502).json({ error: 'AI threat generation failed', details: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
