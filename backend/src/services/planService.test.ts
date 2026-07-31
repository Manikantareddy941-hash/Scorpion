/**
 * planService: ownership-guard behavior for every method, issue-field
 * defaulting, threat→issue conversion idempotency, and AI threat filtering.
 * planRepository and the Gemini analyzer are fully mocked.
 */

jest.mock('./tenancyService', () => ({ canAccessResource: jest.fn() }));
// createProject also stamps its access grant now; without this the real one
// runs and reaches for Appwrite.
jest.mock('../authz/backfill', () => ({
  grantAdmin: jest.fn(),
  emptyTally: () => ({ projects: 0, granted: 0, existing: 0, unowned: [] }),
}));
jest.mock('../repositories/planRepository', () => ({
  planRepository: {
    getProjectOwner: jest.fn(),
    getProject: jest.fn(),
    deleteProject: jest.fn(),
    getSprintProjectId: jest.fn(),
    getIssueProjectId: jest.fn(),
    listProjects: jest.fn(),
    createProject: jest.fn(),
    listEpics: jest.fn(),
    createEpic: jest.fn(),
    listSprints: jest.fn(),
    createSprint: jest.fn(),
    updateSprint: jest.fn(),
    listIssues: jest.fn(),
    createIssue: jest.fn(),
    updateIssue: jest.fn(),
    deleteIssue: jest.fn(),
    listComments: jest.fn(),
    createComment: jest.fn(),
    listAutomationRules: jest.fn(),
    createAutomationRule: jest.fn(),
    deleteAutomationRule: jest.fn(),
    listAutomationRuns: jest.fn(),
    createAutomationRun: jest.fn(),
    listSprintSnapshots: jest.fn(),
    createSprintSnapshot: jest.fn(),
    getIssue: jest.fn(),
    listIssuesBySprint: jest.fn(),
    listWorklogs: jest.fn(),
    createWorklog: jest.fn(),
    listVulnerabilitiesForUser: jest.fn(),
    listThreats: jest.fn(),
    createThreat: jest.fn(),
    getThreat: jest.fn(),
    updateThreat: jest.fn(),
    deleteThreat: jest.fn(),
  },
}));
jest.mock('./threatAiService', () => ({ generateStrideThreats: jest.fn() }));

import {
  planService, assertProjectAccess, severityToPriority,
  buildThreatAcceptanceCriteria, buildThreatIssueFields,
} from './planService';
import { planRepository } from '../repositories/planRepository';
import { generateStrideThreats } from './threatAiService';
import { Threat } from '../types/plan.types';

const repo = planRepository as jest.Mocked<typeof planRepository>;
import { canAccessResource } from './tenancyService';
const canAccess = canAccessResource as jest.Mock;
const ai = generateStrideThreats as jest.Mock;

const OWNER = 'user-1';
// Access is now the union check (owner OR team member), so the guard is
// driven through getProject + canAccessResource rather than owner equality.
const grantAccess = () => {
  repo.getProject.mockResolvedValue({ $id: 'p1', user_id: OWNER, team_id: null });
  canAccess.mockResolvedValue(true);
};
const denyAccess = () => {
  repo.getProject.mockResolvedValue({ $id: 'p1', user_id: 'someone-else', team_id: null });
  canAccess.mockResolvedValue(false);
};

const threat = (overrides: Partial<Threat> = {}): Threat => ({
  $id: 't1', projectId: 'p1', title: 'Spoofed tokens', strideCategory: 'Spoofing',
  severity: 'high', description: 'desc', mitigation: 'rotate keys\nadd mfa',
  status: 'identified', ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('pure helpers', () => {
  it('maps severities to priorities with a low fallback', () => {
    expect(severityToPriority('CRITICAL')).toBe('critical');
    expect(severityToPriority('High')).toBe('high');
    expect(severityToPriority('medium')).toBe('medium');
    expect(severityToPriority('informational')).toBe('low');
  });

  it('renders mitigation lines as acceptance-criteria checkboxes', () => {
    expect(buildThreatAcceptanceCriteria('- rotate keys\n* add mfa\n\n')).toBe('- [ ] rotate keys\n- [ ] add mfa');
    expect(buildThreatAcceptanceCriteria('')).toBe('- [ ] Define and implement a mitigation');
    expect(buildThreatAcceptanceCriteria(undefined)).toBe('- [ ] Define and implement a mitigation');
  });

  it('builds a traceable security story from a threat', () => {
    const fields = buildThreatIssueFields(threat(), 'p1');
    expect(fields.title).toBe('[Threat] Spoofed tokens');
    expect(fields.type).toBe('story');
    expect(fields.priority).toBe('high');
    expect(fields.labels).toEqual(['security', 'threat-model', 'stride:Spoofing']);
    expect(fields.description).toContain('- [ ] rotate keys');
  });
});

describe('assertProjectAccess', () => {
  it('denies anonymous callers without hitting the repository', async () => {
    expect(await assertProjectAccess('p1', undefined)).toBe(false);
    expect(repo.getProject).not.toHaveBeenCalled();
  });

  it('defers to the union check rather than comparing the owner itself', async () => {
    // canAccessResource owns the owner-or-team decision now, so drive it per
    // caller — a blanket mockResolvedValue(true) would make the intruder
    // assertion pass without proving anything.
    repo.getProject.mockResolvedValue({ $id: 'p1', user_id: OWNER, team_id: null });
    canAccess.mockImplementation(async (_project: unknown, userId?: string) => userId === OWNER);

    expect(await assertProjectAccess('p1', OWNER)).toBe(true);
    expect(await assertProjectAccess('p1', 'intruder')).toBe(false);
    expect(canAccess).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: OWNER }),
      'intruder',
    );
  });
});

describe('project-scoped guards', () => {
  it.each([
    ['listEpics', () => planService.listEpics('p1', 'intruder')],
    ['createEpic', () => planService.createEpic('p1', { title: 't' }, 'intruder')],
    ['listSprints', () => planService.listSprints('p1', 'intruder')],
    ['createSprint', () => planService.createSprint('p1', { name: 's' }, 'intruder')],
    ['listIssues', () => planService.listIssues('p1', 'intruder')],
    ['listAutomationRules', () => planService.listAutomationRules('p1', 'intruder')],
    ['createAutomationRule', () => planService.createAutomationRule('p1', { trigger: 't', action: 'a' }, 'intruder')],
    ['listThreats', () => planService.listThreats('p1', 'intruder')],
    ['createThreat', () => planService.createThreat('p1', { title: 't', strideCategory: 'Spoofing', severity: 'low' }, 'intruder')],
  ])('%s returns null for non-owners', async (_name, call) => {
    denyAccess();
    expect(await call()).toBeNull();
  });

  it('passes through to the repository for the owner', async () => {
    grantAccess();
    repo.listEpics.mockResolvedValue([{ $id: 'e1' }] as never);
    expect(await planService.listEpics('p1', OWNER)).toHaveLength(1);

    repo.createSprint.mockResolvedValue({ $id: 's1' } as never);
    expect((await planService.createSprint('p1', { name: 'S' }, OWNER))).toMatchObject({ $id: 's1' });
  });
});

describe('sprint and issue mutations', () => {
  it('updateSprint: not_found / forbidden / ok', async () => {
    repo.getSprintProjectId.mockResolvedValue(null);
    expect(await planService.updateSprint('s1', {}, OWNER)).toBe('not_found');

    repo.getSprintProjectId.mockResolvedValue('p1');
    denyAccess();
    expect(await planService.updateSprint('s1', {}, OWNER)).toBe('forbidden');

    grantAccess();
    repo.updateSprint.mockResolvedValue({ $id: 's1', status: 'completed' } as never);
    expect(await planService.updateSprint('s1', { status: 'completed' }, OWNER)).toMatchObject({ ok: true });

    repo.updateSprint.mockResolvedValue(null);
    expect(await planService.updateSprint('s1', {}, OWNER)).toBe('not_found');
  });

  it('createIssue applies defaults and requires a title', async () => {
    grantAccess();
    repo.createIssue.mockImplementation(async (i) => i);

    const issue = await planService.createIssue('p1', { title: 'Fix it', storyPoints: '5' as never }, OWNER);
    expect(issue).toMatchObject({
      type: 'task', priority: 'medium', status: 'todo',
      assignee: 'dev@scorpion.local', storyPoints: 5, timeLogged: 0,
    });

    await expect(planService.createIssue('p1', {}, OWNER)).rejects.toThrow('Title is required');
    denyAccess();
    expect(await planService.createIssue('p1', { title: 'x' }, OWNER)).toBeNull();
  });

  it('updateIssue and deleteIssue walk the guard ladder', async () => {
    repo.getIssueProjectId.mockResolvedValue(null);
    expect(await planService.updateIssue('i1', {}, OWNER)).toBe('not_found');
    expect(await planService.deleteIssue('i1', OWNER)).toBe('not_found');

    repo.getIssueProjectId.mockResolvedValue('p1');
    denyAccess();
    expect(await planService.updateIssue('i1', {}, OWNER)).toBe('forbidden');
    expect(await planService.deleteIssue('i1', OWNER)).toBe('forbidden');

    grantAccess();
    repo.updateIssue.mockResolvedValue({ $id: 'i1' } as never);
    repo.deleteIssue.mockResolvedValue(true);
    expect(await planService.updateIssue('i1', {}, OWNER)).toMatchObject({ ok: true });
    expect(await planService.deleteIssue('i1', OWNER)).toEqual({ ok: true });

    repo.updateIssue.mockResolvedValue(null);
    repo.deleteIssue.mockResolvedValue(false);
    expect(await planService.updateIssue('i1', {}, OWNER)).toBe('not_found');
    expect(await planService.deleteIssue('i1', OWNER)).toBe('not_found');
  });

  it('comments walk the same ladder and default the author', async () => {
    repo.getIssueProjectId.mockResolvedValue(null);
    expect(await planService.listComments('i1', OWNER)).toBe('not_found');
    expect(await planService.createComment('i1', 'hi', undefined, OWNER)).toBe('not_found');

    repo.getIssueProjectId.mockResolvedValue('p1');
    grantAccess();
    repo.listComments.mockResolvedValue([] as never);
    repo.createComment.mockImplementation(async (_id, input) => input as never);

    expect(await planService.listComments('i1', OWNER)).toMatchObject({ ok: true });
    const created = await planService.createComment('i1', 'hi', undefined, OWNER) as { ok: true; data: { author: string } };
    expect(created.data.author).toBe('dev@scorpion.local');
  });
});

describe('threats', () => {
  it('update/delete return forbidden for non-owners and not_found for missing rows', async () => {
    denyAccess();
    expect(await planService.updateThreat('p1', 't1', {}, OWNER)).toBe('forbidden');
    expect(await planService.deleteThreat('p1', 't1', OWNER)).toBe('forbidden');

    grantAccess();
    repo.updateThreat.mockResolvedValue(null);
    repo.deleteThreat.mockResolvedValue(false);
    expect(await planService.updateThreat('p1', 't1', {}, OWNER)).toBe('not_found');
    expect(await planService.deleteThreat('p1', 't1', OWNER)).toBe('not_found');

    repo.updateThreat.mockResolvedValue(threat() as never);
    repo.deleteThreat.mockResolvedValue(true);
    expect(await planService.updateThreat('p1', 't1', {}, OWNER)).toMatchObject({ ok: true });
    expect(await planService.deleteThreat('p1', 't1', OWNER)).toEqual({ ok: true });
  });

  it('convertThreatToIssue creates a linked story and marks the threat mitigated', async () => {
    grantAccess();
    repo.getThreat.mockResolvedValue(threat());
    repo.createIssue.mockResolvedValue({ $id: 'issue-9' } as never);
    repo.updateThreat.mockResolvedValue(threat({ issueId: 'issue-9', status: 'mitigated' }));

    const result = await planService.convertThreatToIssue('p1', 't1', OWNER) as { ok: true; data: Threat };
    expect(result.data.issueId).toBe('issue-9');
    expect(repo.updateThreat).toHaveBeenCalledWith('t1', { issueId: 'issue-9', status: 'mitigated' });
  });

  it('convertThreatToIssue is idempotent for already-converted threats', async () => {
    grantAccess();
    repo.getThreat.mockResolvedValue(threat({ issueId: 'issue-1' }));

    const result = await planService.convertThreatToIssue('p1', 't1', OWNER) as { ok: true; data: Threat };
    expect(result.data.issueId).toBe('issue-1');
    expect(repo.createIssue).not.toHaveBeenCalled();
  });

  it('convertThreatToIssue: forbidden and not_found paths', async () => {
    denyAccess();
    expect(await planService.convertThreatToIssue('p1', 't1', OWNER)).toBe('forbidden');

    grantAccess();
    repo.getThreat.mockResolvedValue(null);
    expect(await planService.convertThreatToIssue('p1', 't1', OWNER)).toBe('not_found');
  });
});

describe('aiGenerateThreats', () => {
  it('is forbidden for non-owners', async () => {
    denyAccess();
    expect(await planService.aiGenerateThreats('p1', {}, OWNER)).toBe('forbidden');
  });

  it('returns empty without calling the AI when there is nothing to analyze', async () => {
    grantAccess();
    expect(await planService.aiGenerateThreats('p1', { architecture: '  \n ' }, OWNER)).toEqual({ ok: true, data: [] });
    expect(ai).not.toHaveBeenCalled();
  });

  it('derives nodes from free-text architecture lines', async () => {
    grantAccess();
    ai.mockResolvedValue([]);
    await planService.aiGenerateThreats('p1', { architecture: 'api gateway\n\ndatabase\n' }, OWNER);
    expect(ai).toHaveBeenCalledWith({
      nodes: [{ label: 'api gateway', type: 'process' }, { label: 'database', type: 'process' }],
    });
  });

  it('persists only threats with valid STRIDE categories and clamps bad severities', async () => {
    grantAccess();
    ai.mockResolvedValue([
      { title: 'Good', strideCategory: 'Tampering', severity: 'high', description: 'd', component: 'api', mitigations: ['a', 'b'] },
      { title: 'BadCategory', strideCategory: 'Phishing', severity: 'high', description: 'd' },
      { title: 'BadSeverity', strideCategory: 'Spoofing', severity: 'apocalyptic', description: 'd' },
    ]);
    repo.createThreat.mockImplementation(async (_p, input) => ({ ...threat(), ...input } as Threat));

    const result = await planService.aiGenerateThreats('p1', { components: [{ label: 'api' }] }, OWNER) as { ok: true; data: Threat[] };

    expect(result.data).toHaveLength(2);
    expect(repo.createThreat).toHaveBeenCalledWith('p1', expect.objectContaining({
      title: 'Good', mitigation: 'a\nb', description: 'Component: api\n\nd',
    }));
    expect(repo.createThreat).toHaveBeenCalledWith('p1', expect.objectContaining({
      title: 'BadSeverity', severity: 'medium',
    }));
  });
});

describe('unguarded pass-throughs', () => {
  it('listProjects, createProject and listVulnerabilities delegate directly', async () => {
    repo.listProjects.mockResolvedValue([] as never);
    repo.createProject.mockResolvedValue({ $id: 'p1' } as never);
    repo.listVulnerabilitiesForUser.mockResolvedValue({ items: [], degraded: false });

    await planService.listProjects(OWNER);
    await planService.createProject({ name: 'N' }, OWNER);
    await planService.listVulnerabilities(OWNER);

    expect(repo.listProjects).toHaveBeenCalledWith(OWNER);
    expect(repo.createProject).toHaveBeenCalledWith({ name: 'N', userId: OWNER });
    expect(repo.listVulnerabilitiesForUser).toHaveBeenCalledWith(OWNER);
  });
});
