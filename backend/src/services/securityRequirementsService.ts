import { planRepository } from '../repositories/planRepository';
import { securityRequirementsRepository as repo } from '../repositories/securityRequirementsRepository';
import { generate as engineGenerate, reconcile } from './securityRequirementsEngine';
import { ticketsService, TicketOwnership } from './ticketsService';
import { pushTicketToJira } from './jiraService';
import { LifecycleStatus, ProjectProfile, StoredRequirement } from '../types/securityRequirements.types';

// Requirement severity uses the same vocabulary as ticket priority, but the
// ticket also carries a numeric severity — map it.
const SEVERITY_TO_NUMBER: Record<string, number> = { critical: 9, high: 7, medium: 4, low: 1 };
const frameworkSlug = (framework: string): string => framework.toLowerCase().replace(/\s+/g, '-');

function ticketDescription(r: StoredRequirement): string {
  return [
    r.description,
    '',
    `Control(s): ${r.controlIds.join(', ')}`,
    `Framework(s): ${r.frameworks.join(', ')}`,
    `Severity: ${r.severity} | Status: ${r.status}`,
    '',
    `Remediation: ${r.remediation}`,
    '',
    `Source: Scorpion Security Requirements (${r.code})`,
  ].join('\n');
}

// 'denied' collapses "not owned" and "no such project" into one result so the
// transport layer can answer 404 for both — no enumeration oracle.
type Access<T> = 'denied' | { ok: true; data: T };

// Profile shape accepted from the transport layer (projectId is stamped here,
// never taken from the body).
type ProfileInput = Omit<ProjectProfile, 'projectId' | 'updatedAt'>;

async function owns(projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return false;
  const owner = await planRepository.getProjectOwner(projectId);
  return owner === userId;
}

export const securityRequirementsService = {
  async getProfile(projectId: string, userId?: string): Promise<Access<ProjectProfile | null>> {
    if (!(await owns(projectId, userId))) return 'denied';
    return { ok: true, data: await repo.getProfile(projectId) };
  },

  async saveProfile(projectId: string, input: ProfileInput, userId?: string): Promise<Access<ProjectProfile>> {
    if (!(await owns(projectId, userId))) return 'denied';
    return { ok: true, data: await repo.upsertProfile({ ...input, projectId }) };
  },

  async generate(projectId: string, userId?: string): Promise<Access<StoredRequirement[]> | 'no_profile'> {
    if (!(await owns(projectId, userId))) return 'denied';
    const profile = await repo.getProfile(projectId);
    if (!profile) return 'no_profile';
    const generated = engineGenerate({ ...profile, projectId });
    const stored = await repo.listRequirements(projectId);
    await repo.applyReconcile(projectId, reconcile(generated, stored));
    return { ok: true, data: await repo.listRequirements(projectId) };
  },

  async list(projectId: string, userId?: string): Promise<Access<StoredRequirement[]>> {
    if (!(await owns(projectId, userId))) return 'denied';
    return { ok: true, data: await repo.listRequirements(projectId) };
  },

  async setLifecycle(
    reqId: string,
    input: { lifecycleStatus: LifecycleStatus; justification?: string },
    userId?: string,
    updatedBy?: string,
  ): Promise<'not_found' | { ok: true; data: StoredRequirement }> {
    const existing = await repo.getRequirement(reqId);
    // Not found and not-owned both answer 404 — never reveal which.
    if (!existing || !(await owns(existing.projectId, userId))) return 'not_found';
    const updated = await repo.updateRequirement(reqId, {
      lifecycleStatus: input.lifecycleStatus,
      justification: input.justification,
      updatedBy: updatedBy ?? 'unknown',
    });
    if (!updated) return 'not_found';
    return { ok: true, data: updated };
  },

  /**
   * Push a requirement into a sprint as a ticket (feature 3a), then sync it to
   * Jira via the existing pipeline. Idempotent: once a requirement carries a
   * ticketId it returns the existing link instead of creating a duplicate. The
   * local ticket is created even if Jira is unconfigured (best-effort sync).
   */
  async pushToTicket(
    reqId: string,
    userId: string | undefined,
    reporterEmail: string,
    ownership: TicketOwnership,
  ): Promise<'not_found' | { ok: true; alreadyLinked: boolean; ticketId: string; jiraKey?: string }> {
    const req = await repo.getRequirement(reqId);
    if (!req || !(await owns(req.projectId, userId))) return 'not_found';
    if (req.ticketId) return { ok: true, alreadyLinked: true, ticketId: req.ticketId, jiraKey: req.jiraKey };

    const tags = ['scorpion-security', 'compliance', ...req.frameworks.map(frameworkSlug), req.code.toLowerCase()];
    const { ticket } = await ticketsService.createTicket(
      {
        title: req.title,
        description: ticketDescription(req),
        priority: req.severity,
        type: 'task',
        severity: SEVERITY_TO_NUMBER[req.severity] ?? 0,
        tags,
        linkedFindings: [],
      },
      reporterEmail,
      ownership,
    );

    const jira = await pushTicketToJira(ticket.id);
    const jiraKey = jira.ok ? jira.jiraKey : undefined;
    await repo.setTicketRef(reqId, { ticketId: ticket.id, jiraKey });
    return { ok: true, alreadyLinked: false, ticketId: ticket.id, jiraKey };
  },
};
