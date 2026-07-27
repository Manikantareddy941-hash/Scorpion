jest.mock('../repositories/planRepository', () => ({
  planRepository: {
    getProjectOwner: jest.fn(),
    listVulnerabilitiesForRepos: jest.fn(),
    // Defaulted to [] so existing correlation tests (which don't set it) don't
    // crash on the new second evidence stream in computeCorrelation.
    listRuntimeIncidentsForRepos: jest.fn().mockResolvedValue({ items: [], degraded: false }),
  },
}));
jest.mock('../repositories/projectRepoRepository', () => ({
  projectRepoRepository: { listRepoIds: jest.fn(), listBindings: jest.fn(), setBindings: jest.fn(), listProjectIdsForRepo: jest.fn() },
}));
jest.mock('../lib/appwrite', () => ({
  databases: { getDocument: jest.fn() },
  DB_ID: 'db',
  COLLECTIONS: { REPOSITORIES: 'repositories' },
}));
jest.mock('./tenancyService', () => ({ canAccessResource: jest.fn() }));
jest.mock('../repositories/gateRunRepository', () => ({ gateRunRepository: { listByRepos: jest.fn(), record: jest.fn() } }));
jest.mock('../repositories/securityRequirementsRepository', () => ({
  securityRequirementsRepository: {
    getProfile: jest.fn(), upsertProfile: jest.fn(), listRequirements: jest.fn(),
    applyReconcile: jest.fn(), getRequirement: jest.fn(), updateRequirement: jest.fn(),
    setTicketRef: jest.fn(),
  },
}));
jest.mock('./ticketsService', () => ({ ticketsService: { createTicket: jest.fn() } }));
jest.mock('./jiraService', () => ({ pushTicketToJira: jest.fn() }));

import { securityRequirementsService as svc } from './securityRequirementsService';
import { planRepository } from '../repositories/planRepository';
import { projectRepoRepository } from '../repositories/projectRepoRepository';
import { databases } from '../lib/appwrite';
import { canAccessResource } from './tenancyService';
import { gateRunRepository } from '../repositories/gateRunRepository';
import { securityRequirementsRepository as repo } from '../repositories/securityRequirementsRepository';
import { ticketsService } from './ticketsService';
import { pushTicketToJira } from './jiraService';

const owner = planRepository.getProjectOwner as jest.Mock;
const listVulns = planRepository.listVulnerabilitiesForRepos as jest.Mock;
const listIncidents = planRepository.listRuntimeIncidentsForRepos as jest.Mock;
const listRepoIds = projectRepoRepository.listRepoIds as jest.Mock;
const listProjectsForRepo = projectRepoRepository.listProjectIdsForRepo as jest.Mock;
const setBindings = projectRepoRepository.setBindings as jest.Mock;
const getRepoDoc = databases.getDocument as jest.Mock;
const canAccess = canAccessResource as jest.Mock;
const mockRepo = repo as unknown as Record<string, jest.Mock>;
const ticketsCreate = ticketsService.createTicket as jest.Mock;
const jiraPush = pushTicketToJira as jest.Mock;

describe('securityRequirementsService tenant isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies list when the caller does not own the project', async () => {
    owner.mockResolvedValue('someone-else');
    const res = await svc.list('p1', 'user-1');
    expect(res).toBe('denied');
    expect(mockRepo.listRequirements).not.toHaveBeenCalled();
  });

  it('returns requirements when the caller owns the project', async () => {
    owner.mockResolvedValue('user-1');
    mockRepo.listRequirements.mockResolvedValue([{ code: 'REQ-A' }]);
    const res = await svc.list('p1', 'user-1');
    expect(res).toEqual({ ok: true, data: [{ code: 'REQ-A' }] });
  });

  it('denies when no user id is present', async () => {
    const res = await svc.list('p1', undefined);
    expect(res).toBe('denied');
    expect(owner).not.toHaveBeenCalled();
  });

  it('setLifecycle answers not_found (not forbidden) when the requirement is another tenant\'s', async () => {
    mockRepo.getRequirement.mockResolvedValue({ $id: 'r1', projectId: 'p1' });
    owner.mockResolvedValue('someone-else');
    const res = await svc.setLifecycle('r1', { lifecycleStatus: 'satisfied' }, 'user-1', 'e@x');
    expect(res).toBe('not_found');
    expect(mockRepo.updateRequirement).not.toHaveBeenCalled();
  });

  it('setLifecycle writes updatedBy from the session when owned', async () => {
    mockRepo.getRequirement.mockResolvedValue({ $id: 'r1', projectId: 'p1' });
    owner.mockResolvedValue('user-1');
    mockRepo.updateRequirement.mockResolvedValue({ $id: 'r1', lifecycleStatus: 'waived' });
    await svc.setLifecycle('r1', { lifecycleStatus: 'waived', justification: 'ok' }, 'user-1', 'auditor@x');
    expect(mockRepo.updateRequirement).toHaveBeenCalledWith('r1', {
      lifecycleStatus: 'waived', justification: 'ok', updatedBy: 'auditor@x',
    });
  });

  it('generate returns no_profile when the project has no profile yet', async () => {
    owner.mockResolvedValue('user-1');
    mockRepo.getProfile.mockResolvedValue(null);
    const res = await svc.generate('p1', 'user-1');
    expect(res).toBe('no_profile');
    expect(mockRepo.applyReconcile).not.toHaveBeenCalled();
  });

  it('saveProfile stamps projectId from the path, not the body', async () => {
    owner.mockResolvedValue('user-1');
    mockRepo.upsertProfile.mockImplementation(async (p) => p);
    await svc.saveProfile('p1', { appType: 'api', stack: ['node'], dataTypes: ['card'], deployment: 'cloud', authModel: 'session', frameworks: ['PCI DSS'] }, 'user-1');
    expect(mockRepo.upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
  });
});

describe('securityRequirementsService.getCorrelation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies when the caller does not own the project', async () => {
    owner.mockResolvedValue('someone-else');
    const res = await svc.getCorrelation('p1', 'user-1');
    expect(res).toBe('denied');
    expect(mockRepo.listRequirements).not.toHaveBeenCalled();
  });

  it('correlates only the findings from the project-bound repos, not the whole owner set', async () => {
    owner.mockResolvedValue('user-1');
    mockRepo.listRequirements.mockResolvedValue([
      { code: 'REQ-PCI-6.5.1-SQLI', category: 'Secure Coding', lifecycleStatus: 'open', frameworks: ['PCI DSS'] },
    ]);
    listRepoIds.mockResolvedValue(['r1', 'r2']);
    listVulns.mockResolvedValue({ degraded: false, items: [
      { tool: 'semgrep', category: 'py.sql-injection', ruleId: 'py.sql-injection', message: 'SQL injection', status: 'open' },
    ] });

    const res = await svc.getCorrelation('p1', 'user-1');

    if (res === 'denied') throw new Error('unexpected denial');
    expect(res.data[0].status).toBe('violated');
    // The findings query is scoped to the project's bound repos, never the owner.
    expect(listVulns).toHaveBeenCalledWith(['r1', 'r2']);
  });
});

describe('securityRequirementsService.fanOutCorrelation (SARIF ingest fan-out)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('re-correlates every project bound to the repo and reports each violated count', async () => {
    listProjectsForRepo.mockResolvedValue(['pA', 'pB']);
    listRepoIds.mockResolvedValue(['r1']);
    mockRepo.listRequirements.mockResolvedValue([
      { code: 'REQ', category: 'Secure Coding', lifecycleStatus: 'open', frameworks: ['PCI DSS'] },
    ]);
    listVulns.mockResolvedValue({ degraded: false, items: [
      { tool: 'semgrep', category: 'sql-injection', ruleId: 'sql-injection', message: 'SQL injection', status: 'open' },
    ] });

    const res = await svc.fanOutCorrelation('r1');

    expect(listProjectsForRepo).toHaveBeenCalledWith('r1');
    expect(res).toEqual([
      { projectId: 'pA', violated: 1, total: 1 },
      { projectId: 'pB', violated: 1, total: 1 },
    ]);
  });

  it('returns an empty list when no project is bound to the repo', async () => {
    listProjectsForRepo.mockResolvedValue([]);
    expect(await svc.fanOutCorrelation('orphan')).toEqual([]);
  });
});

describe('securityRequirementsService.getGateRuns', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies when the caller does not own the project', async () => {
    owner.mockResolvedValue('someone-else');
    expect(await svc.getGateRuns('p1', 'user-1')).toBe('denied');
  });

  it('returns the run ledger for the project\'s bound repos', async () => {
    owner.mockResolvedValue('user-1');
    listRepoIds.mockResolvedValue(['r1', 'r2']);
    (gateRunRepository.listByRepos as jest.Mock).mockResolvedValue([{ repoId: 'r1', status: 'blocked' }]);
    const res = await svc.getGateRuns('p1', 'user-1');
    if (res === 'denied') throw new Error('unexpected denial');
    expect(gateRunRepository.listByRepos).toHaveBeenCalledWith(['r1', 'r2']);
    expect(res.data).toEqual([{ repoId: 'r1', status: 'blocked' }]);
  });
});

describe('securityRequirementsService.complianceGate (Build & Test gate)', () => {
  beforeEach(() => jest.clearAllMocks());

  const violatingFinding = { $id: 'f1', tool: 'semgrep', category: 'sql-injection', ruleId: 'sql-injection', title: 'sql-injection', message: 'SQL injection', severity: 'HIGH', status: 'open', file_path: 'src/db.js' };

  it('blocks on a REQUIRED violation and carries the Jira + finding traceability', async () => {
    listProjectsForRepo.mockResolvedValue(['pA']);
    listRepoIds.mockResolvedValue(['r1']);
    mockRepo.listRequirements.mockResolvedValue([
      { code: 'REQ-PCI-6.5.1-SQLI', title: 'Prevent injection', category: 'Secure Coding', status: 'required', severity: 'high', lifecycleStatus: 'open', frameworks: ['PCI DSS'], jiraKey: 'SEC-42' },
    ]);
    listVulns.mockResolvedValue({ degraded: false, items: [violatingFinding] });

    const res = await svc.complianceGate('r1');

    expect(res.blocked).toBe(true);
    expect(res.violations[0]).toMatchObject({
      projectId: 'pA', code: 'REQ-PCI-6.5.1-SQLI', severity: 'high', findingCount: 1,
      jiraKey: 'SEC-42',
      findings: [{ id: 'f1', title: 'sql-injection', tool: 'semgrep', severity: 'HIGH', file: 'src/db.js' }],
    });
  });

  it('does NOT block when only a recommended requirement is violated', async () => {
    listProjectsForRepo.mockResolvedValue(['pA']);
    listRepoIds.mockResolvedValue(['r1']);
    mockRepo.listRequirements.mockResolvedValue([
      { code: 'REQ-REC', title: 'nice to have', category: 'Secure Coding', status: 'recommended', severity: 'medium', lifecycleStatus: 'open', frameworks: ['SOC 2'] },
    ]);
    listVulns.mockResolvedValue({ degraded: false, items: [violatingFinding] });

    const res = await svc.complianceGate('r1');
    expect(res.blocked).toBe(false);
    expect(res.violations).toHaveLength(0);
  });

  it('aggregates violations across every project bound to the repo', async () => {
    listProjectsForRepo.mockResolvedValue(['pA', 'pB']);
    listRepoIds.mockResolvedValue(['r1']);
    mockRepo.listRequirements.mockResolvedValue([
      { code: 'REQ', title: 't', category: 'Secure Coding', status: 'required', severity: 'high', lifecycleStatus: 'open', frameworks: ['PCI DSS'] },
    ]);
    listVulns.mockResolvedValue({ degraded: false, items: [violatingFinding] });

    const res = await svc.complianceGate('r1');
    expect(res.violations.map((v) => v.projectId)).toEqual(['pA', 'pB']);
  });

  it('passes clean when no project is bound to the repo', async () => {
    listProjectsForRepo.mockResolvedValue([]);
    expect(await svc.complianceGate('orphan')).toEqual({ blocked: false, violations: [], degraded: false });
  });

  // A gate that cannot read its evidence must not report "no violations".
  // listVulnerabilitiesForRepos fails open to an empty list, so a degraded read
  // previously produced zero violations -> blocked:false, and the deploy
  // hard-block waved the release through on a database hiccup.
  describe('degraded evidence', () => {
    const requiredReq = {
      code: 'REQ', title: 't', category: 'Secure Coding', status: 'required',
      severity: 'high', lifecycleStatus: 'open', frameworks: ['PCI DSS'],
    };

    // clearAllMocks() clears call records but NOT implementations set with
    // mockResolvedValue, so a `degraded: true` from one test leaks into the
    // next and silently flips its verdict. Re-establish healthy reads here and
    // let each test opt into degradation explicitly.
    beforeEach(() => {
      listVulns.mockResolvedValue({ items: [], degraded: false });
      listIncidents.mockResolvedValue({ items: [], degraded: false });
    });

    it('blocks when the findings read is degraded, even with zero violations', async () => {
      listProjectsForRepo.mockResolvedValue(['pA']);
      listRepoIds.mockResolvedValue(['r1']);
      mockRepo.listRequirements.mockResolvedValue([requiredReq]);
      listVulns.mockResolvedValue({ items: [], degraded: true });

      const res = await svc.complianceGate('r1');

      expect(res.blocked).toBe(true);
      expect(res.degraded).toBe(true);
      // Distinguishable from a real violation: an operator debugging a blocked
      // deploy must not go hunting for violations that do not exist.
      expect(res.violations).toHaveLength(0);
    });

    it('blocks when the runtime-incident read is degraded', async () => {
      listProjectsForRepo.mockResolvedValue(['pA']);
      listRepoIds.mockResolvedValue(['r1']);
      mockRepo.listRequirements.mockResolvedValue([requiredReq]);
      listVulns.mockResolvedValue({ items: [], degraded: false });
      listIncidents.mockResolvedValue({ items: [], degraded: true });

      const res = await svc.complianceGate('r1');

      expect(res.blocked).toBe(true);
      expect(res.degraded).toBe(true);
    });

    it('reports degraded alongside genuine violations rather than hiding them', async () => {
      listProjectsForRepo.mockResolvedValue(['pA']);
      listRepoIds.mockResolvedValue(['r1']);
      mockRepo.listRequirements.mockResolvedValue([requiredReq]);
      listVulns.mockResolvedValue({ items: [violatingFinding], degraded: true });

      const res = await svc.complianceGate('r1');

      expect(res.blocked).toBe(true);
      expect(res.degraded).toBe(true);
      expect(res.violations).toHaveLength(1);
    });

    it('a healthy read is not marked degraded', async () => {
      listProjectsForRepo.mockResolvedValue(['pA']);
      listRepoIds.mockResolvedValue(['r1']);
      mockRepo.listRequirements.mockResolvedValue([requiredReq]);
      listVulns.mockResolvedValue({ items: [], degraded: false });

      const res = await svc.complianceGate('r1');

      expect(res.blocked).toBe(false);
      expect(res.degraded).toBe(false);
    });
  });
});

describe('securityRequirementsService runtime-incident feedback (Monitor & Operate)', () => {
  beforeEach(() => jest.clearAllMocks());

  const shellIncident = { $id: 'inc1', rule: 'Terminal shell in container', priority: 'Critical', output: 'A shell was spawned', container_image: 'ghcr.io/acme/api', repo_id: 'r1', status: 'open' };
  const monitoringReq = (over = {}) => ({ code: 'REQ-RUNTIME-DETECT', title: 'Detect runtime intrusions', category: 'Logging & Monitoring', status: 'required', severity: 'high', lifecycleStatus: 'open', frameworks: ['SOC 2'], ...over });

  it('getCorrelation: a live Falco incident violates a Logging & Monitoring requirement', async () => {
    owner.mockResolvedValue('user-1');
    mockRepo.listRequirements.mockResolvedValue([monitoringReq()]);
    listRepoIds.mockResolvedValue(['r1']);
    listVulns.mockResolvedValue({ degraded: false, items: [] });
    listIncidents.mockResolvedValue({ degraded: false, items: [shellIncident] });

    const res = await svc.getCorrelation('p1', 'user-1');

    if (res === 'denied') throw new Error('unexpected denial');
    expect(res.data[0].status).toBe('violated');
    expect(res.data[0].matchedFindings[0]).toMatchObject({ tool: 'falco', file: 'ghcr.io/acme/api', severity: 'critical' });
    expect(listIncidents).toHaveBeenCalledWith(['r1']);
  });

  it('complianceGate: an open runtime incident on a bound repo blocks the pipeline with falco traceability', async () => {
    listProjectsForRepo.mockResolvedValue(['pA']);
    listRepoIds.mockResolvedValue(['r1']);
    mockRepo.listRequirements.mockResolvedValue([monitoringReq()]);
    listVulns.mockResolvedValue({ degraded: false, items: [] });
    listIncidents.mockResolvedValue({ degraded: false, items: [shellIncident] });

    const res = await svc.complianceGate('r1');

    expect(res.blocked).toBe(true);
    expect(res.violations[0]).toMatchObject({
      projectId: 'pA', code: 'REQ-RUNTIME-DETECT',
      findings: [{ id: 'inc1', title: 'Terminal shell in container', tool: 'falco', file: 'ghcr.io/acme/api' }],
    });
  });

  it('does not block when the runtime incident is already resolved', async () => {
    listProjectsForRepo.mockResolvedValue(['pA']);
    listRepoIds.mockResolvedValue(['r1']);
    mockRepo.listRequirements.mockResolvedValue([monitoringReq()]);
    listVulns.mockResolvedValue({ degraded: false, items: [] });
    listIncidents.mockResolvedValue({ degraded: false, items: [{ ...shellIncident, status: 'resolved' }] });

    const res = await svc.complianceGate('r1');
    expect(res.blocked).toBe(false);
  });
});

describe('securityRequirementsService.setRepos (project<->repo binding)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies when the caller does not own the project', async () => {
    owner.mockResolvedValue('someone-else');
    expect(await svc.setRepos('p1', ['r1'], 'user-1')).toBe('denied');
    expect(setBindings).not.toHaveBeenCalled();
  });

  it('binds only repos the caller can access, taking repoUrl from the repo doc not the body', async () => {
    owner.mockResolvedValue('user-1');
    getRepoDoc.mockImplementation(async (_db, _col, id) =>
      id === 'r-owned' ? { $id: 'r-owned', url: 'https://x/owned', user_id: 'user-1' }
        : { $id: 'r-foreign', url: 'https://x/foreign', user_id: 'someone-else' });
    canAccess.mockImplementation(async (repo) => repo.user_id === 'user-1');
    setBindings.mockImplementation(async (_pid, repos) => repos.map((r: object, i: number) => ({ $id: `b${i}`, ...r })));

    const res = await svc.setRepos('p1', ['r-owned', 'r-foreign'], 'user-1');

    if (res === 'denied') throw new Error('unexpected denial');
    // The foreign repo is dropped; only the owned one is persisted.
    expect(setBindings).toHaveBeenCalledWith('p1', [{ repoId: 'r-owned', repoUrl: 'https://x/owned' }]);
    expect(res.data).toEqual([{ repoId: 'r-owned', repoUrl: 'https://x/owned' }]);
  });
});

describe('securityRequirementsService.pushToTicket (3a bridge)', () => {
  beforeEach(() => jest.clearAllMocks());

  const requirement = (over = {}) => ({
    $id: 'r1', projectId: 'p1', code: 'REQ-PCI-6.5.1-SQLI', title: 'Prevent injection',
    description: 'desc', category: 'Secure Coding', frameworks: ['PCI DSS', 'SOC 2'],
    controlIds: ['PCI DSS 6.5.1', 'CC6.1'], severity: 'high', status: 'required',
    lifecycleStatus: 'open', remediation: 'Use parameterized queries', sourceRuleId: ['pci'],
    createdAt: '2026-01-01', ...over,
  });
  const ownership = { user_id: 'user-1', team_id: null };

  it('returns not_found when the requirement is another tenant\'s', async () => {
    mockRepo.getRequirement.mockResolvedValue(requirement());
    owner.mockResolvedValue('someone-else');
    const res = await svc.pushToTicket('r1', 'user-1', 'e@x', ownership);
    expect(res).toBe('not_found');
    expect(ticketsCreate).not.toHaveBeenCalled();
  });

  it('creates a labelled ticket, pushes to Jira, and stores the refs', async () => {
    mockRepo.getRequirement.mockResolvedValue(requirement());
    owner.mockResolvedValue('user-1');
    ticketsCreate.mockResolvedValue({ conflict: false, ticket: { id: 'tk1' } });
    jiraPush.mockResolvedValue({ ok: true, jiraKey: 'SEC-42' });

    const res = await svc.pushToTicket('r1', 'user-1', 'auditor@x', ownership);

    expect(res).toEqual({ ok: true, alreadyLinked: false, ticketId: 'tk1', jiraKey: 'SEC-42' });
    const [input, reporter, own] = ticketsCreate.mock.calls[0];
    // 2b escalation: a required requirement bumps priority (high -> critical)
    // and is tagged a compliance-blocker.
    expect(input.priority).toBe('critical');
    expect(input.tags).toEqual(expect.arrayContaining(['scorpion-security', 'compliance', 'pci-dss', 'soc-2', 'req-pci-6.5.1-sqli', 'compliance-blocker']));
    expect(input.description).toContain('PCI DSS 6.5.1');
    expect(input.description).toContain('Use parameterized queries');
    expect(reporter).toBe('auditor@x');
    expect(own).toEqual(ownership);
    expect(jiraPush).toHaveBeenCalledWith('tk1');
    expect(mockRepo.setTicketRef).toHaveBeenCalledWith('r1', { ticketId: 'tk1', jiraKey: 'SEC-42' });
  });

  it('does not escalate a recommended requirement (2b)', async () => {
    mockRepo.getRequirement.mockResolvedValue(requirement({ status: 'recommended', severity: 'medium' }));
    owner.mockResolvedValue('user-1');
    ticketsCreate.mockResolvedValue({ conflict: false, ticket: { id: 'tk3' } });
    jiraPush.mockResolvedValue({ ok: true, jiraKey: 'SEC-50' });

    await svc.pushToTicket('r1', 'user-1', 'e@x', ownership);

    const [input] = ticketsCreate.mock.calls[0];
    expect(input.priority).toBe('medium');
    expect(input.tags).not.toContain('compliance-blocker');
  });

  it('is idempotent — a requirement already linked returns the existing ticket', async () => {
    mockRepo.getRequirement.mockResolvedValue(requirement({ ticketId: 'tk-existing', jiraKey: 'SEC-9' }));
    owner.mockResolvedValue('user-1');
    const res = await svc.pushToTicket('r1', 'user-1', 'e@x', ownership);
    expect(res).toEqual({ ok: true, alreadyLinked: true, ticketId: 'tk-existing', jiraKey: 'SEC-9' });
    expect(ticketsCreate).not.toHaveBeenCalled();
  });

  it('still creates the local ticket when Jira is not configured', async () => {
    mockRepo.getRequirement.mockResolvedValue(requirement({ frameworks: ['GDPR'], controlIds: ['GDPR Art. 32'] }));
    owner.mockResolvedValue('user-1');
    ticketsCreate.mockResolvedValue({ conflict: false, ticket: { id: 'tk2' } });
    jiraPush.mockResolvedValue({ ok: false, error: 'Jira not configured' });

    const res = await svc.pushToTicket('r1', 'user-1', 'e@x', ownership);

    expect(res).toEqual({ ok: true, alreadyLinked: false, ticketId: 'tk2', jiraKey: undefined });
    expect(mockRepo.setTicketRef).toHaveBeenCalledWith('r1', { ticketId: 'tk2', jiraKey: undefined });
  });
});
