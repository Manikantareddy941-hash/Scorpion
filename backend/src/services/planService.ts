import { randomUUID } from 'crypto';
import { planRepository } from '../repositories/planRepository';
import { canAccessResource } from './tenancyService';
import { projectRepoRepository } from '../repositories/projectRepoRepository';
import { groupFindingsByCve } from '../plan/cveGrouping';
import { Issue, Sprint, Threat } from '../types/plan.types';
import { generateStrideThreats } from './threatAiService';
import { runAutomation, writeSprintSnapshot, rollUnfinishedToBacklog } from './planAutomationService';
import { emptyTally, grantAdmin } from '../authz/backfill';
import { listPermissions } from '../authz/authorizationService';
import { logger } from './logger';

function randomId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

const STRIDE_CATEGORIES: Threat['strideCategory'][] = [
  'Spoofing', 'Tampering', 'Repudiation', 'Information Disclosure', 'Denial of Service', 'Elevation of Privilege',
];
const SEVERITIES: Threat['severity'][] = ['low', 'medium', 'high', 'critical'];

// A threat's mitigation is a single text field that may hold several lines.
// Render each as an acceptance-criteria checkbox so the dev has a concrete
// definition of done, not a prose blob.
export function buildThreatAcceptanceCriteria(mitigation?: string): string {
  const lines = (mitigation || '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean);
  if (lines.length === 0) return '- [ ] Define and implement a mitigation';
  return lines.map((l) => `- [ ] ${l}`).join('\n');
}

// Pure: STRIDE threat -> issue fields. Extracted so the security-story shape
// (type, priority, acceptance criteria, traceability labels) is unit-testable.
export function buildThreatIssueFields(threat: Threat, projectId: string): Issue {
  return {
    $id: randomId('issue'),
    projectId,
    title: `[Threat] ${threat.title}`,
    type: 'story',
    priority: severityToPriority(threat.severity),
    storyPoints: 3,
    description:
      `**STRIDE:** ${threat.strideCategory}\n` +
      `**Severity:** ${threat.severity}\n\n` +
      `${threat.description || 'N/A'}\n\n` +
      `**Acceptance criteria (mitigations):**\n${buildThreatAcceptanceCriteria(threat.mitigation)}`,
    createdAt: new Date().toISOString(),
    status: 'todo',
    timeLogged: 0,
    labels: ['security', 'threat-model', `stride:${threat.strideCategory}`],
  };
}

/**
 * Union access check for a Plan project: the owner, or a member of the owning
 * team. This used to be strict owner equality, so a teammate was refused a
 * project they collaborate on — Plan was the last surface still single-owner
 * after repositories and incidents moved to the union model (#151/#161).
 *
 * Safe on an un-migrated database: `team_id` is simply absent until the
 * migration adds it, and canAccessResource then falls back to owner equality —
 * exactly the previous behaviour. It cannot widen access by accident.
 *
 * Fails closed: an unreadable ownership record denies rather than proceeds.
 */
export async function assertLegacyProjectAccess(projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const project = await planRepository.getProject(projectId);
    if (!project) return false;
    return await canAccessResource(project, userId);
  } catch {
    return false;
  }
}

/**
 * Project access for the service layer: the legacy union OR an explicit RBAC
 * grant.
 *
 * The union alone is owner-or-team, so someone an admin deliberately granted
 * project_viewer — and who is neither the owner nor in the owning team — would
 * clear the route middleware and then be refused here. Grant management would
 * assign roles that do nothing.
 *
 * Strictly additive: it can only widen, never narrow, so no existing caller
 * loses access. RBAC is consulted only when the legacy check has already said
 * no, so the common path (the owner) costs nothing extra.
 *
 * This is coarse by design — it answers "may this user touch the project at
 * all". The verb-level decision (issue:read versus issue:delete) belongs to
 * requirePermission, which has already run by the time a service is reached.
 */
export async function assertProjectAccess(projectId: string, userId?: string): Promise<boolean> {
  if (await assertLegacyProjectAccess(projectId, userId)) return true;
  const { reason } = await listPermissions(projectId, userId);
  return reason === 'granted';
}

export function severityToPriority(severity: string): Issue['priority'] {
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

  /**
   * Creates a project and, in the same operation, the access grants that make
   * it reachable.
   *
   * The grant is not optional bookkeeping. Under RBAC a project with no
   * project_access row is invisible to everyone including the person who just
   * created it, and they cannot delete what they cannot see. The migration
   * backfilled existing projects; this is the same guarantee for new ones, and
   * it uses the same idempotent grantAdmin.
   *
   * Both the owner and the active team are granted, matching the backfill: a
   * teammate must be able to open a project created under their shared team.
   *
   * If the grants cannot be written for a project that IS in Appwrite, the
   * project is removed and the call fails. Appwrite has no transactions, so
   * this is the compensating action — an honest error the caller can retry
   * beats a project that silently becomes unreachable the day enforcement is
   * switched on.
   *
   * When the repository fell back to its local JSON store, however, nothing
   * reached Appwrite and a grant would have nowhere to point. That path is
   * already degraded by definition, so it is logged and allowed through rather
   * than turned into a failure the fallback exists to avoid.
   */
  async createProject(
    input: { name: string; repoId?: string; type?: 'kanban' | 'scrum' },
    userId?: string,
    teamId?: string | null,
  ) {
    const project = await planRepository.createProject({ ...input, userId, teamId });
    try {
      const tally = emptyTally();
      if (userId) await grantAdmin(project.$id, 'user', userId, tally, userId);
      if (teamId) await grantAdmin(project.$id, 'team', teamId, tally, userId);
      return project;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!(await planRepository.projectExistsInAppwrite(project.$id))) {
        logger.warn('[plan] project went to the local JSON fallback, so no access grant was written', {
          event: 'project_grant_skipped_fallback', projectId: project.$id, userId, error: message,
        });
        return project;
      }
      logger.error('[plan] project created but its access grant failed; rolling back', {
        event: 'project_grant_failed', projectId: project.$id, userId, teamId, error: message,
      });
      await planRepository.deleteProject(project.$id).catch(() => undefined);
      throw new Error('Project could not be created: access grant failed');
    }
  },

  /**
   * Outstanding findings across this project's bound repositories, clustered by
   * the upstream advisory they share — one Log4j CVE in six repos reads as one
   * unit of work instead of six unrelated rows.
   *
   * `degraded` rides along for the same reason it does on the compliance gate:
   * an unreadable findings store yields an empty cluster list, and "no shared
   * advisories" must not be indistinguishable from "could not look".
   */
  async listCveClusters(projectId: string, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    const repoIds = await projectRepoRepository.listRepoIds(projectId);
    const findings = await planRepository.listVulnerabilitiesForRepos(repoIds);
    return { clusters: groupFindingsByCve(findings.items), degraded: findings.degraded };
  },

  /**
   * Groups every outstanding finding for one advisory under a single epic.
   *
   * One epic with N issues, rather than one issue covering N findings: the same
   * CVE is patched at different times by different people per repository, and
   * Issue.vulnId is singular, so per-repo traceability only survives this way.
   *
   * Per finding:
   *   no issue yet          -> create one under the epic
   *   issue with no epic    -> adopt it (its assignee, comments and logged
   *                            time are real work; a second issue for the same
   *                            finding is the duplicate this feature removes)
   *   issue in another epic -> skip and report, never silently re-parent it
   *                            out of a deliberate grouping
   *
   * Returns 'not_migrated' when cveId is unprovisioned. Proceeding would mint a
   * duplicate epic on every call, so this fails closed rather than littering
   * the project during a rollout window.
   */
  async createEpicFromCve(projectId: string, cveId: string, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;

    const existing = await planRepository.findEpicByCve(projectId, cveId);
    if (existing === 'unavailable') return 'not_migrated' as const;

    const repoIds = await projectRepoRepository.listRepoIds(projectId);
    const findings = await planRepository.listVulnerabilitiesForRepos(repoIds);
    // A cluster built from an unknown subset would produce an epic missing
    // findings nobody could see were missing.
    if (findings.degraded) return 'degraded' as const;

    const cluster = groupFindingsByCve(findings.items).find((c) => c.cveId === cveId);
    if (!cluster) return 'no_findings' as const;

    const epic = existing ?? await planRepository.createEpic(projectId, {
      title: `${cveId} — ${cluster.findingCount} finding(s) across ${cluster.repoIds.length} repo(s)`,
      cveId,
    });

    const issues = await planRepository.listIssues(projectId);
    const byVulnId = new Map(issues.filter(i => i.vulnId).map(i => [i.vulnId as string, i]));

    const created: { findingId: string; issueId: string }[] = [];
    const adopted: { findingId: string; issueId: string }[] = [];
    const skipped: { findingId: string; issueId: string; reason: string }[] = [];

    for (const findingId of cluster.findingIds) {
      const issue = byVulnId.get(findingId);

      if (!issue) {
        const made = await planRepository.createIssue({
          $id: randomId('issue'),
          projectId,
          epicId: epic.$id,
          type: 'task',
          title: `${cveId} — remediate finding ${findingId}`,
          priority: severityToPriority(cluster.severity),
          status: 'todo',
          vulnId: findingId,
          labels: ['security', `cve:${cveId}`],
          timeLogged: 0,
          createdAt: new Date().toISOString(),
        } as Issue);
        created.push({ findingId, issueId: made.$id });
        continue;
      }

      if (issue.epicId === epic.$id) continue; // already grouped here: re-running is a no-op
      if (issue.epicId) {
        skipped.push({ findingId, issueId: issue.$id, reason: `already in ${issue.epicId}` });
        continue;
      }

      await planRepository.updateIssue(issue.$id, { epicId: epic.$id });
      adopted.push({ findingId, issueId: issue.$id });
    }

    return { epicId: epic.$id, cveId, created, adopted, skipped };
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

  async updateSprint(sprintId: string, updates: Record<string, unknown>, userId?: string, userEmail?: string): Promise<'not_found' | 'forbidden' | { ok: true; data: unknown }> {
    const sprintProjectId = await planRepository.getSprintProjectId(sprintId);
    if (!sprintProjectId) return 'not_found';
    if (!(await assertProjectAccess(sprintProjectId, userId))) return 'forbidden';

    // Pre-read the sprint's issues before the update: the mock store rolls
    // unfinished issues out of a completing sprint inside updateSprint, and the
    // velocity snapshot needs the committed set as it stood at close.
    const isCompleting = updates.status === 'completed';
    let preCloseIssues: Issue[] = [];
    if (isCompleting) {
      try { preCloseIssues = (await planRepository.listIssuesBySprint(sprintId)) ?? []; } catch { /* snapshot is best-effort */ }
    }

    const data = await planRepository.updateSprint(sprintId, updates);
    if (!data) return 'not_found';

    // On sprint completion: snapshot velocity first, then fire automation rules,
    // then guarantee unfinished issues roll to the backlog regardless of whether
    // a move_to_backlog rule exists. All three are best-effort by design.
    if (isCompleting) {
      const sprint = data as Sprint;
      await writeSprintSnapshot(sprintProjectId, sprint, preCloseIssues);
      await runAutomation(sprintProjectId, 'sprint_ended', { sprint, userEmail });
      await rollUnfinishedToBacklog(sprintId);
    }

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
    const created = await planRepository.createIssue(newIssue);

    // A newly created critical issue is the "Critical Issue Created" trigger.
    if (created.priority === 'critical' || newIssue.priority === 'critical') {
      await runAutomation(projectId, 'critical_vuln', { issue: { ...newIssue, ...created }, userEmail: input.assignee });
    }
    return created;
  },

  async updateIssue(issueId: string, updates: Partial<Issue>, userId?: string, userEmail?: string): Promise<'not_found' | 'forbidden' | { ok: true; data: Issue }> {
    const issueProjectId = await planRepository.getIssueProjectId(issueId);
    if (!issueProjectId) return 'not_found';
    if (!(await assertProjectAccess(issueProjectId, userId))) return 'forbidden';

    // Capture the prior status so the resolve trigger only fires on the actual
    // transition into 'done' (not on every save of an already-done issue).
    let priorStatus: Issue['status'] | undefined;
    try { priorStatus = (await planRepository.getIssue(issueId))?.status; } catch { /* non-fatal */ }

    const data = await planRepository.updateIssue(issueId, updates);
    if (!data) return 'not_found';

    if (updates.status === 'done' && priorStatus !== 'done') {
      await runAutomation(issueProjectId, 'vuln_resolved', { issue: data, userEmail });
    }
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

  async deleteAutomationRule(projectId: string, ruleId: string, userId?: string): Promise<'forbidden' | 'not_found' | { ok: true }> {
    if (!(await assertProjectAccess(projectId, userId))) return 'forbidden';
    const ok = await planRepository.deleteAutomationRule(ruleId);
    if (!ok) return 'not_found';
    return { ok: true };
  },

  async listAutomationRuns(projectId: string, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.listAutomationRuns(projectId);
  },

  async listSprintSnapshots(projectId: string, userId?: string) {
    if (!(await assertProjectAccess(projectId, userId))) return null;
    return planRepository.listSprintSnapshots(projectId);
  },

  async listWorklogs(issueId: string, userId?: string): Promise<'not_found' | 'forbidden' | { ok: true; data: unknown }> {
    const issueProjectId = await planRepository.getIssueProjectId(issueId);
    if (!issueProjectId) return 'not_found';
    if (!(await assertProjectAccess(issueProjectId, userId))) return 'forbidden';
    return { ok: true, data: await planRepository.listWorklogs(issueId) };
  },

  async createWorklog(issueId: string, input: { minutes: number; comment?: string }, authorEmail: string | undefined, userId?: string): Promise<'not_found' | 'forbidden' | { ok: true; data: unknown }> {
    const issueProjectId = await planRepository.getIssueProjectId(issueId);
    if (!issueProjectId) return 'not_found';
    if (!(await assertProjectAccess(issueProjectId, userId))) return 'forbidden';
    const data = await planRepository.createWorklog(issueId, {
      author: authorEmail || 'dev@scorpion.local',
      minutes: input.minutes,
      comment: input.comment,
    });
    return { ok: true, data };
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

    // Idempotent: a threat already backed by an issue must not spawn a duplicate.
    if (threat.issueId) return { ok: true, data: threat };

    const issueData = await planRepository.createIssue(buildThreatIssueFields(threat, projectId));

    const updatedThreat = await planRepository.updateThreat(threatId, {
      issueId: issueData.$id,
      status: 'mitigated'
    });

    if (!updatedThreat) return 'not_found';
    return { ok: true, data: updatedThreat };
  },

  // Plan phase: AI STRIDE. Feed the project's components (or a free-text
  // architecture) to the same Gemini analyzer the threat-model system uses,
  // then persist each result as a project threat ready to convert to backlog.
  async aiGenerateThreats(
    projectId: string,
    input: { components?: Array<{ label: string; type?: string }>; architecture?: string },
    userId?: string
  ): Promise<'forbidden' | { ok: true; data: Threat[] }> {
    if (!(await assertProjectAccess(projectId, userId))) return 'forbidden';

    const nodes = (input.components && input.components.length > 0)
      ? input.components.map((c) => ({ label: c.label, type: c.type || 'process' }))
      : (input.architecture || '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((label) => ({ label, type: 'process' }));

    if (nodes.length === 0) return { ok: true, data: [] };

    const aiThreats = await generateStrideThreats({ nodes });
    const created: Threat[] = [];

    for (const t of aiThreats) {
      // AI output is untrusted; only persist rows whose enums match our schema.
      if (!STRIDE_CATEGORIES.includes(t.strideCategory as Threat['strideCategory'])) continue;
      const severity = SEVERITIES.includes(t.severity as Threat['severity'])
        ? (t.severity as Threat['severity'])
        : 'medium';

      const row = await planRepository.createThreat(projectId, {
        title: t.title,
        strideCategory: t.strideCategory as Threat['strideCategory'],
        severity,
        description: t.component ? `Component: ${t.component}\n\n${t.description}` : t.description,
        mitigation: Array.isArray(t.mitigations) ? t.mitigations.join('\n') : undefined,
      });
      created.push(row);
    }

    return { ok: true, data: created };
  }
};
