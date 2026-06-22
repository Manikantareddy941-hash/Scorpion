import { planRepository } from '../repositories/planRepository';
import { Issue, Threat } from '../types/plan.types';

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

async function assertProjectAccess(projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return false;
  const ownerId = await planRepository.getProjectOwner(projectId);
  return ownerId === userId;
}

function severityToPriority(severity: string): Issue['priority'] {
  const normalized = severity.toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  return 'low';
}

export const planService = {
  assertProjectAccess,

  listProjects(userId?: string) {
    return planRepository.listProjects(userId);
  },

  createProject(input: { name: string; repoId?: string; type?: 'kanban' | 'scrum' }, userId?: string) {
    return planRepository.createProject({ ...input, userId });
  },

  async listEpics(projectId: string, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.listEpics(projectId);
  },

  async createEpic(projectId: string, input: { title: string; color?: string; startDate?: string; endDate?: string }, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.createEpic(projectId, input);
  },

  async listSprints(projectId: string, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.listSprints(projectId);
  },

  async createSprint(projectId: string, input: { name: string; goal?: string; startDate?: string; endDate?: string }, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.createSprint(projectId, input);
  },

  async updateSprint(sprintId: string, updates: Record<string, unknown>, userId?: string): Promise<'not_found' | 'forbidden' | { ok: true; data: unknown }> {
    const sprintProjectId = await planRepository.getSprintProjectId(sprintId);
    if (!sprintProjectId) return 'not_found';
    if (!(await assertProjectAccess(sprintProjectId, userId))) return 'forbidden';
    const data = await planRepository.updateSprint(sprintId, updates);
    if (!data) return 'not_found';
    return { ok: true, data };
  },

  async listIssues(projectId: string, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.listIssues(projectId);
  },

  async createIssue(projectId: string, input: Partial<Issue>, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    if (!input.title) throw new Error('Title is required');

    const newIssue: Issue = {
      $id: randomId('issue'),
      projectId,
      epicId: input.epicId || null,
      sprintId: input.sprintId || null,
      type: input.type || 'task',
      title: input.title,
      description: input.description || '',
      priority: input.priority || 'medium',
      status: input.status || 'todo',
      assignee: input.assignee || 'dev@scorpion.local',
      storyPoints: input.storyPoints ? Number(input.storyPoints) : 0,
      timeEstimate: input.timeEstimate ? Number(input.timeEstimate) : 0,
      timeLogged: 0,
      vulnId: input.vulnId || null,
      labels: input.labels || [],
      dueDate: input.dueDate || undefined,
      createdAt: new Date().toISOString()
    };
    return planRepository.createIssue(newIssue);
  },

  async updateIssue(issueId: string, updates: Partial<Issue>, userId?: string): Promise<'not_found' | 'forbidden' | { ok: true; data: Issue }> {
    const issueProjectId = await planRepository.getIssueProjectId(issueId);
    if (!issueProjectId) return 'not_found';
    if (!(await assertProjectAccess(issueProjectId, userId))) return 'forbidden';
    const data = await planRepository.updateIssue(issueId, updates);
    if (!data) return 'not_found';
    return { ok: true, data };
  },

  async deleteIssue(issueId: string, userId?: string): Promise<'not_found' | 'forbidden' | { ok: true }> {
    const issueProjectId = await planRepository.getIssueProjectId(issueId);
    if (!issueProjectId) return 'not_found';
    if (!(await assertProjectAccess(issueProjectId, userId))) return 'forbidden';
    const ok = await planRepository.deleteIssue(issueId);
    if (!ok) return 'not_found';
    return { ok: true };
  },

  async listComments(issueId: string, userId?: string): Promise<'not_found' | 'forbidden' | { ok: true; data: unknown }> {
    const issueProjectId = await planRepository.getIssueProjectId(issueId);
    if (!issueProjectId) return 'not_found';
    if (!(await assertProjectAccess(issueProjectId, userId))) return 'forbidden';
    return { ok: true, data: await planRepository.listComments(issueId) };
  },

  async createComment(issueId: string, body: string, authorEmail: string | undefined, userId?: string): Promise<'not_found' | 'forbidden' | { ok: true; data: unknown }> {
    const issueProjectId = await planRepository.getIssueProjectId(issueId);
    if (!issueProjectId) return 'not_found';
    if (!(await assertProjectAccess(issueProjectId, userId))) return 'forbidden';
    const data = await planRepository.createComment(issueId, { author: authorEmail || 'dev@scorpion.local', body });
    return { ok: true, data };
  },

  async listAutomationRules(projectId: string, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.listAutomationRules(projectId);
  },

  async createAutomationRule(projectId: string, input: { trigger: string; conditions?: string; action: string }, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.createAutomationRule(projectId, input);
  },

  listVulnerabilities(userId?: string) {
    return planRepository.listVulnerabilitiesForUser(userId);
  },

  async listThreats(projectId: string, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.listThreats(projectId);
  },

  async createThreat(projectId: string, input: { title: string; strideCategory: Threat['strideCategory']; severity: Threat['severity']; description?: string; mitigation?: string }, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.createThreat(projectId, input);
  },

  async updateThreat(projectId: string, id: string, updates: Partial<Threat>, userId?: string): Promise<'forbidden' | 'not_found' | { ok: true; data: Threat }> {
    if (!(await assertProjectAccess(projectId, userId))) return 'forbidden';
    const data = await planRepository.updateThreat(id, updates);
    if (!data) return 'not_found';
    return { ok: true, data };
  },

  async deleteThreat(projectId: string, id: string, userId?: string): Promise<'forbidden' | 'not_found' | { ok: true }> {
    if (!(await assertProjectAccess(projectId, userId))) return 'forbidden';
    const ok = await planRepository.deleteThreat(id);
    if (!ok) return 'not_found';
    return { ok: true };
  },

  async convertThreatToIssue(projectId: string, threatId: string, userId?: string): Promise<'forbidden' | 'not_found' | { ok: true; data: Threat }> {
    if (!(await assertProjectAccess(projectId, userId))) return 'forbidden';

    const threat = await planRepository.getThreat(threatId);
    if (!threat) return 'not_found';

    const newIssue: Issue = {
      $id: randomId('issue'),
      projectId,
      title: `[Threat] ${threat.title}`,
      type: 'bug',
      priority: severityToPriority(threat.severity),
      storyPoints: 3,
      description: `Threat Category: ${threat.strideCategory}\n\nDescription:\n${threat.description || 'N/A'}\n\nProposed Mitigation:\n${threat.mitigation || 'N/A'}`,
      createdAt: new Date().toISOString(),
      status: 'todo',
      timeLogged: 0,
      labels: []
    };

    const issueData = await planRepository.createIssue(newIssue);

    const updatedThreat = await planRepository.updateThreat(threatId, {
      issueId: issueData.$id,
      status: 'mitigated'
    });

    if (!updatedThreat) return 'not_found';
    return { ok: true, data: updatedThreat };
  }
};
