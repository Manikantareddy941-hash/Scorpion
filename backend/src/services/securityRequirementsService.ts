import { planRepository } from '../repositories/planRepository';
import { securityRequirementsRepository as repo } from '../repositories/securityRequirementsRepository';
import { projectRepoRepository } from '../repositories/projectRepoRepository';
import { gateRunRepository, GateRun } from '../repositories/gateRunRepository';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { canAccessResource } from './tenancyService';
import { logger } from './logger';
import { generate as engineGenerate, reconcile } from './securityRequirementsEngine';
import { ticketsService, TicketOwnership } from './ticketsService';
import { pushTicketToJira } from './jiraService';
import { correlate, CorrelatableFinding, CorrelatedRequirement } from './correlationEngine';
import { LifecycleStatus, ProjectProfile, StoredRequirement } from '../types/securityRequirements.types';

// Requirement severity uses the same vocabulary as ticket priority, but the
// ticket also carries a numeric severity — map it.
const SEVERITY_TO_NUMBER: Record<string, number> = { critical: 9, high: 7, medium: 4, low: 1 };
const frameworkSlug = (framework: string): string => framework.toLowerCase().replace(/\s+/g, '-');

// 2b: a required requirement is a compliance mandate — escalate its ticket one
// priority notch (capped at critical) so it can't sit at the bottom of a
// backlog. A recommended requirement keeps its severity-derived priority.
const PRIORITY_LADDER = ['low', 'medium', 'high', 'critical'];
function ticketPriority(severity: string, status: string): string {
  if (status !== 'required') return severity;
  const i = PRIORITY_LADDER.indexOf(severity);
  return i < 0 ? severity : PRIORITY_LADDER[Math.min(i + 1, PRIORITY_LADDER.length - 1)];
}

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

/** A finding that violates a control, reduced to what the gate panel links to. */
export interface ViolationFinding {
  id?: string;
  title?: string;
  tool?: string;
  severity?: string;
  file?: string;
}

/** A required requirement a live finding violates — a pipeline-blocking event.
 *  Carries the traceability the UI turns into action: the Jira ticket (3a
 *  bridge) and the specific findings (correlation) behind the block. */
export interface ComplianceViolation {
  projectId: string;
  code: string;
  title: string;
  frameworks: string[];
  severity: string;
  findingCount: number;
  jiraKey?: string;
  findings: ViolationFinding[];
}

// A stored finding doc (vulnerabilities collection) reduced to the fields the
// correlation engine reads. Persisted findings are third-party-shaped, so read
// defensively and fall back to `scanner` (deduplication renames tool->scanner).
function toCorrelatable(doc: unknown): CorrelatableFinding {
  const f = (doc ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  return {
    id: str(f.$id),
    tool: str(f.tool) ?? str(f.scanner),
    category: str(f.category),
    ruleId: str(f.ruleId),
    title: str(f.title),
    message: str(f.message),
    severity: str(f.severity),
    status: str(f.status),
    file: str(f.file_path) ?? str(f.file),
  };
}

// Falco priority → the severity vocabulary the panel/correlation share. Only
// affects how a violation is surfaced (correlate() never classifies on
// severity), so an unknown priority degrades to 'low' rather than dropping.
const FALCO_PRIORITY_TO_SEVERITY: Record<string, string> = {
  critical: 'critical', emergency: 'critical', alert: 'critical',
  error: 'high', warning: 'medium', notice: 'low', informational: 'low', info: 'low', debug: 'low',
};

// A runtime (Falco) incident doc reduced to what correlation reads. Tagged
// category 'runtime-threat' so it can only ever violate a Logging & Monitoring
// requirement (see CATEGORY_EVIDENCE). file carries the container image so the
// gate panel shows which workload tripped.
function toRuntimeCorrelatable(doc: unknown): CorrelatableFinding {
  const f = (doc ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const rule = str(f.rule);
  return {
    id: str(f.$id),
    tool: 'falco',
    category: 'runtime-threat',
    ruleId: rule,
    title: rule,
    message: str(f.output),
    severity: FALCO_PRIORITY_TO_SEVERITY[(str(f.priority) ?? '').toLowerCase()] ?? 'low',
    status: str(f.status),
    file: str(f.container_image),
  };
}

// Profile shape accepted from the transport layer (projectId is stamped here,
// never taken from the body).
type ProfileInput = Omit<ProjectProfile, 'projectId' | 'updatedAt'>;

async function owns(projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return false;
  const owner = await planRepository.getProjectOwner(projectId);
  return owner === userId;
}

/**
 * Correlate a project's requirements against its bound-repo findings. Pure
 * read: no ownership check (callers gate that) and nothing persisted —
 * correlation is computed on demand, so it is always fresh for whoever reads.
 */
async function computeCorrelation(projectId: string): Promise<{ correlated: CorrelatedRequirement[]; degraded: boolean }> {
  const requirements = await repo.listRequirements(projectId);
  const repoIds = await projectRepoRepository.listRepoIds(projectId);
  // Two evidence streams over the same bound repos: scanner findings (Code &
  // Commit) and live runtime incidents (Monitor & Operate). Both feed the one
  // correlate() call; runtime incidents can only violate Logging & Monitoring.
  const [findings, incidents] = await Promise.all([
    planRepository.listVulnerabilitiesForRepos(repoIds),
    planRepository.listRuntimeIncidentsForRepos(repoIds),
  ]);
  // Either read failing open to empty makes the verdict unsafe to trust: an
  // unread finding is indistinguishable from an absent one, so "no violations"
  // may simply mean "no evidence available".
  return {
    correlated: correlate(requirements, [
      ...findings.items.map(toCorrelatable),
      ...incidents.items.map(toRuntimeCorrelatable),
    ]),
    degraded: findings.degraded || incidents.degraded,
  };
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

  /**
   * Correlate the project's requirements against live scanner findings — the
   * return leg of the requirement->Jira loop. Findings only ever flag a
   * requirement VIOLATED; satisfied comes solely from human attestation.
   *
   * ponytail: findings are scoped to the owner's repos (all of them), not to a
   * specific project — no project->repo link exists yet. Upgrade path: filter by
   * the project's repo set once that mapping lands.
   */
  async getCorrelation(projectId: string, userId?: string): Promise<Access<CorrelatedRequirement[]>> {
    if (!(await owns(projectId, userId))) return 'denied';
    // Project-scoped, not owner-scoped: computeCorrelation reads only the repos
    // bound to this project. An unbound project correlates against nothing.
    // The UI surface reads the correlated list; a degraded read shows as an
    // absence here rather than a block. Only the gate fails closed.
    return { ok: true, data: (await computeCorrelation(projectId)).correlated };
  },

  /**
   * Fan-out (SARIF ingest): the moment findings land for a repo, re-correlate
   * every project bound to it — a shared library's new CVE instantly re-scores
   * Project A's PCI reqs AND Project B's GDPR reqs. Correlation is on-demand, so
   * this doesn't persist a status; it surfaces the cross-project blast radius as
   * an audit signal and is the seam a Build & Test gate will call to pass/fail.
   */
  /**
   * Build & Test compliance gate: does any project bound to this repo have a
   * REQUIRED requirement that live findings VIOLATE? Only required requirements
   * block a pipeline — recommended violations are advisory (mirrors the 2b
   * required/recommended split). Reuses computeCorrelation, so it enforces the
   * exact project-scoped, on-demand verdict the UI shows.
   */
  async complianceGate(repoId: string): Promise<{ blocked: boolean; violations: ComplianceViolation[]; degraded: boolean }> {
    const projectIds = await projectRepoRepository.listProjectIdsForRepo(repoId);
    const violations: ComplianceViolation[] = [];
    let degraded = false;
    for (const projectId of projectIds) {
      const { correlated, degraded: readDegraded } = await computeCorrelation(projectId);
      if (readDegraded) degraded = true;
      for (const c of correlated) {
        if (c.status === 'violated' && c.requirement.status === 'required') {
          violations.push({
            projectId,
            code: c.requirement.code,
            title: c.requirement.title,
            frameworks: c.requirement.frameworks,
            severity: c.requirement.severity,
            findingCount: c.matchedFindings.length,
            jiraKey: c.requirement.jiraKey,
            findings: c.matchedFindings.map((f) => ({ id: f.id, title: f.title, tool: f.tool, severity: f.severity, file: f.file })),
          });
        }
      }
    }
    // Fail CLOSED on degraded evidence. An empty violation list from an
    // unreadable findings store is not a pass — it is an unknown, and a gate
    // that answers "unknown" with "go ahead" is not a gate. `degraded` is
    // returned separately so callers can say "could not evaluate" rather than
    // sending an operator hunting for violations that do not exist. The
    // audited break-glass override remains the escape hatch for a real outage.
    if (degraded) {
      logger.warn('[complianceGate] blocking on degraded evidence', {
        event: 'compliance_gate_degraded', repoId, projectCount: projectIds.length,
        violationCount: violations.length,
      });
    }
    return { blocked: degraded || violations.length > 0, violations, degraded };
  },

  async fanOutCorrelation(repoId: string): Promise<{ projectId: string; violated: number; total: number }[]> {
    const projectIds = await projectRepoRepository.listProjectIdsForRepo(repoId);
    const affected: { projectId: string; violated: number; total: number }[] = [];
    for (const projectId of projectIds) {
      const { correlated, degraded } = await computeCorrelation(projectId);
      const violated = correlated.filter((c) => c.status === 'violated').length;
      affected.push({ projectId, violated, total: correlated.length });
      logger.info('sarif fan-out re-correlated project', {
        event: 'correlation_fanout', repoId, projectId, violated, total: correlated.length, degraded,
      });
    }
    return affected;
  },

  /** Compliance-gate run history for the project — every evaluation across its
   *  bound repos, newest first. Powers the Pipeline Gates panel. */
  async getGateRuns(projectId: string, userId?: string): Promise<Access<GateRun[]>> {
    if (!(await owns(projectId, userId))) return 'denied';
    const repoIds = await projectRepoRepository.listRepoIds(projectId);
    return { ok: true, data: await gateRunRepository.listByRepos(repoIds) };
  },

  async getRepos(projectId: string, userId?: string): Promise<Access<{ repoId: string; repoUrl: string }[]>> {
    if (!(await owns(projectId, userId))) return 'denied';
    const bindings = await projectRepoRepository.listBindings(projectId);
    return { ok: true, data: bindings.map((b) => ({ repoId: b.repoId, repoUrl: b.repoUrl })) };
  },

  /**
   * Bind a set of repositories to the project. Each repoId is validated against
   * the caller's access before it is stored: binding a repo you don't own would
   * let correlation read another tenant's findings, since the findings query is
   * keyed by repo_id and not tenant-checked. repoUrl is read from the repo doc,
   * never trusted from the body.
   */
  async setRepos(projectId: string, repoIds: string[], userId?: string): Promise<Access<{ repoId: string; repoUrl: string }[]>> {
    if (!(await owns(projectId, userId))) return 'denied';
    const validated: { repoId: string; repoUrl: string }[] = [];
    for (const repoId of [...new Set(repoIds)]) {
      const repoDoc = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId).catch(() => null);
      if (repoDoc && (await canAccessResource(repoDoc, userId!))) {
        validated.push({ repoId, repoUrl: String((repoDoc as { url?: unknown }).url ?? '') });
      }
    }
    const saved = await projectRepoRepository.setBindings(projectId, validated);
    return { ok: true, data: saved.map((b) => ({ repoId: b.repoId, repoUrl: b.repoUrl })) };
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
    if (req.status === 'required') tags.push('compliance-blocker');
    const { ticket } = await ticketsService.createTicket(
      {
        title: req.title,
        description: ticketDescription(req),
        priority: ticketPriority(req.severity, req.status) as 'critical' | 'high' | 'medium' | 'low',
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
