/**
 * planRepository: every method has an Appwrite path and a local-JSON fallback
 * path (handleQuery). Both are exercised here — Appwrite via a mocked
 * databases client, the fallback by making the Appwrite call reject and
 * backing fs/promises with an in-memory store.
 */

jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    createDocument: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
  },
  DB_ID: 'test-db',
  COLLECTIONS: { REPOSITORIES: 'repositories', FINDINGS: 'findings' },
  ID: { unique: () => 'unique-id' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    orderDesc: (f: string) => ({ orderDesc: f }),
    limit: (n: number) => ({ limit: n }),
    offset: (n: number) => ({ offset: n }),
  },
}));
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

let mockFileContent: string | null = null;
jest.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockImplementation(async () => {
      if (mockFileContent === null) throw new Error('ENOENT');
      return mockFileContent;
    }),
    writeFile: jest.fn().mockImplementation(async (_p: string, data: string) => {
      mockFileContent = data;
    }),
  },
}));

import { planRepository } from './planRepository';
import { databases } from '../lib/appwrite';
import { logger } from '../services/logger';
import { Issue, PlanSchema } from '../types/plan.types';

const db = databases as jest.Mocked<typeof databases>;
const warn = logger.warn as jest.Mock;

const seedDb = (overrides: Partial<PlanSchema> = {}) => {
  const base: PlanSchema = {
    projects: [{ $id: 'p1', name: 'Proj', repoId: 'all', type: 'kanban', createdAt: '2026-01-01', user_id: 'u1' }],
    epics: [{ $id: 'e1', projectId: 'p1', title: 'Epic', color: '#fff', status: 'active' }],
    sprints: [
      { $id: 's1', projectId: 'p1', name: 'Sprint 1', status: 'active' },
      { $id: 's2', projectId: 'p1', name: 'Sprint 2', status: 'planned' },
    ],
    issues: [
      { $id: 'i1', projectId: 'p1', epicId: 'e1', sprintId: 's1', type: 'task', title: 'Task', priority: 'high', status: 'todo', createdAt: '2026-01-02' } as Issue,
      { $id: 'i2', projectId: 'p1', epicId: null, sprintId: 's1', type: 'bug', title: 'Done bug', priority: 'low', status: 'done', createdAt: '2026-01-03' } as Issue,
    ],
    comments: [{ $id: 'c1', issueId: 'i1', author: 'a', body: 'b', createdAt: '2026-01-04' }],
    automationRules: [{ $id: 'r1', projectId: 'p1', trigger: 'vuln_resolved', action: 'auto_create_task' }],
    automationRuns: [],
    sprintSnapshots: [],
    worklogs: [],
    threats: [{ $id: 't1', projectId: 'p1', title: 'Spoof', strideCategory: 'Spoofing', severity: 'high', description: '', mitigation: '', status: 'identified' }],
    ...overrides,
  };
  mockFileContent = JSON.stringify(base);
  return base;
};

const appwriteDown = () => {
  db.listDocuments.mockRejectedValue(new Error('appwrite down'));
  db.getDocument.mockRejectedValue(new Error('appwrite down'));
  db.createDocument.mockRejectedValue(new Error('appwrite down'));
  db.updateDocument.mockRejectedValue(new Error('appwrite down'));
  db.deleteDocument.mockRejectedValue(new Error('appwrite down'));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFileContent = null;
});

describe('ownership lookups', () => {
  it('reads project owner from Appwrite', async () => {
    db.getDocument.mockResolvedValue({ user_id: 'owner-1' } as never);
    expect(await planRepository.getProjectOwner('p1')).toBe('owner-1');
  });

  it('falls back to the JSON store for project owner', async () => {
    appwriteDown();
    seedDb();
    expect(await planRepository.getProjectOwner('p1')).toBe('u1');
    expect(await planRepository.getProjectOwner('missing')).toBeNull();
  });

  it('resolves sprint and issue project ids from Appwrite', async () => {
    db.getDocument.mockResolvedValue({ projectId: 'p9' } as never);
    expect(await planRepository.getSprintProjectId('s1')).toBe('p9');
    expect(await planRepository.getIssueProjectId('i1')).toBe('p9');
  });

  it('resolves sprint and issue project ids from the fallback store', async () => {
    appwriteDown();
    seedDb();
    expect(await planRepository.getSprintProjectId('s1')).toBe('p1');
    expect(await planRepository.getIssueProjectId('i1')).toBe('p1');
    expect(await planRepository.getSprintProjectId('nope')).toBeNull();
    expect(await planRepository.getIssueProjectId('nope')).toBeNull();
  });
});

describe('projects', () => {
  it('lists projects for a user via Appwrite', async () => {
    db.listDocuments.mockResolvedValue({ documents: [{ $id: 'p1' }] } as never);
    const projects = await planRepository.listProjects('u1');
    expect(projects).toHaveLength(1);
  });

  it('lists projects from the fallback filtered by user', async () => {
    appwriteDown();
    seedDb();
    expect(await planRepository.listProjects('u1')).toHaveLength(1);
    expect(await planRepository.listProjects('someone-else')).toHaveLength(0);
  });

  it('creates a project via Appwrite', async () => {
    db.createDocument.mockResolvedValue({ $id: 'new-p', name: 'N' } as never);
    const proj = await planRepository.createProject({ name: 'N', userId: 'u1' });
    expect(proj.$id).toBe('new-p');
  });

  it('creates a project in the fallback store with defaults', async () => {
    appwriteDown();
    seedDb();
    const proj = await planRepository.createProject({ name: 'N' });
    expect(proj.repoId).toBe('all');
    expect(proj.type).toBe('kanban');
    const stored = JSON.parse(mockFileContent!) as PlanSchema;
    expect(stored.projects.map(p => p.name)).toContain('N');
  });
});

describe('epics and sprints', () => {
  it('lists and creates epics via Appwrite', async () => {
    db.listDocuments.mockResolvedValue({ documents: [{ $id: 'e1' }] } as never);
    db.createDocument.mockResolvedValue({ $id: 'e2' } as never);
    expect(await planRepository.listEpics('p1')).toHaveLength(1);
    expect((await planRepository.createEpic('p1', { title: 'T' })).$id).toBe('e2');
  });

  it('lists and creates epics via the fallback', async () => {
    appwriteDown();
    seedDb();
    expect(await planRepository.listEpics('p1')).toHaveLength(1);
    const epic = await planRepository.createEpic('p1', { title: 'T' });
    expect(epic.color).toBe('#3b82f6');
    expect((JSON.parse(mockFileContent!) as PlanSchema).epics).toHaveLength(2);
  });

  it('lists, creates and updates sprints via Appwrite', async () => {
    db.listDocuments.mockResolvedValue({ documents: [{ $id: 's1' }] } as never);
    db.createDocument.mockResolvedValue({ $id: 's3' } as never);
    db.updateDocument.mockResolvedValue({ $id: 's1', status: 'completed' } as never);
    expect(await planRepository.listSprints('p1')).toHaveLength(1);
    expect((await planRepository.createSprint('p1', { name: 'S' })).$id).toBe('s3');
    expect((await planRepository.updateSprint('s1', { status: 'completed' }))?.status).toBe('completed');
  });

  it('completing a sprint in the fallback moves unfinished issues out', async () => {
    appwriteDown();
    seedDb();
    const updated = await planRepository.updateSprint('s1', { status: 'completed' });
    expect(updated?.status).toBe('completed');
    const stored = JSON.parse(mockFileContent!) as PlanSchema;
    expect(stored.issues.find(i => i.$id === 'i1')?.sprintId).toBeNull(); // todo → kicked out
    expect(stored.issues.find(i => i.$id === 'i2')?.sprintId).toBe('s1'); // done → stays
  });

  it('updating a missing sprint in the fallback returns null', async () => {
    appwriteDown();
    seedDb();
    expect(await planRepository.updateSprint('missing', { name: 'x' })).toBeNull();
  });
});

describe('issues', () => {
  const newIssue = { $id: 'i9', projectId: 'p1', epicId: null, sprintId: null, type: 'task', title: 'New', priority: 'low', status: 'backlog', createdAt: '2026-01-05' } as Issue;

  it('lists, creates, updates and deletes issues via Appwrite', async () => {
    db.listDocuments.mockResolvedValue({ documents: [{ $id: 'i1' }] } as never);
    db.createDocument.mockResolvedValue({ $id: 'i9' } as never);
    db.updateDocument.mockResolvedValue({ $id: 'i1', status: 'done' } as never);
    db.deleteDocument.mockResolvedValue(undefined as never);

    expect(await planRepository.listIssues('p1')).toHaveLength(1);
    expect((await planRepository.createIssue(newIssue)).$id).toBe('i9');
    expect((await planRepository.updateIssue('i1', { status: 'done' }))?.status).toBe('done');
    expect(await planRepository.deleteIssue('i1')).toBe(true);
  });

  it('full issue lifecycle in the fallback store', async () => {
    appwriteDown();
    seedDb();

    expect(await planRepository.listIssues('p1')).toHaveLength(2);
    await planRepository.createIssue(newIssue);
    expect((await planRepository.updateIssue('i9', { status: 'todo' }))?.status).toBe('todo');
    expect(await planRepository.updateIssue('missing', {})).toBeNull();

    // deleting an issue also drops its comments
    expect(await planRepository.deleteIssue('i1')).toBe(true);
    const stored = JSON.parse(mockFileContent!) as PlanSchema;
    expect(stored.comments.filter(c => c.issueId === 'i1')).toHaveLength(0);
    expect(await planRepository.deleteIssue('missing')).toBe(false);
  });
});

describe('comments and automation rules', () => {
  it('lists and creates comments via Appwrite', async () => {
    db.listDocuments.mockResolvedValue({ documents: [{ $id: 'c1' }] } as never);
    db.createDocument.mockResolvedValue({ $id: 'c2' } as never);
    expect(await planRepository.listComments('i1')).toHaveLength(1);
    expect((await planRepository.createComment('i1', { author: 'a', body: 'b' })).$id).toBe('c2');
  });

  it('lists and creates comments via the fallback', async () => {
    appwriteDown();
    seedDb();
    expect(await planRepository.listComments('i1')).toHaveLength(1);
    const comment = await planRepository.createComment('i1', { author: 'me', body: 'hello' });
    expect(comment.$id).toMatch(/^comm-/);
  });

  it('lists and creates automation rules on both paths', async () => {
    db.listDocuments.mockResolvedValue({ documents: [{ $id: 'r1' }] } as never);
    db.createDocument.mockResolvedValue({ $id: 'r2' } as never);
    expect(await planRepository.listAutomationRules('p1')).toHaveLength(1);
    expect((await planRepository.createAutomationRule('p1', { trigger: 't', action: 'a' })).$id).toBe('r2');

    appwriteDown();
    seedDb();
    expect(await planRepository.listAutomationRules('p1')).toHaveLength(1);
    const rule = await planRepository.createAutomationRule('p1', { trigger: 't', action: 'a' });
    expect(rule.conditions).toBe('');
  });
});

describe('listVulnerabilitiesForUser', () => {
  it('returns empty when the user has no repos, without querying findings', async () => {
    db.listDocuments.mockResolvedValueOnce({ documents: [] } as never);
    expect(await planRepository.listVulnerabilitiesForUser('u1')).toEqual([]);
    expect(db.listDocuments).toHaveBeenCalledTimes(1);
  });

  it('pages past the first 100 findings instead of silently truncating', async () => {
    db.listDocuments
      .mockResolvedValueOnce({ documents: [{ $id: 'repo-1' }] } as never)
      .mockResolvedValueOnce({ documents: Array.from({ length: 100 }, (_, i) => ({ $id: `f${i}` })) } as never)
      .mockResolvedValueOnce({ documents: Array.from({ length: 40 }, (_, i) => ({ $id: `f${100 + i}` })) } as never);

    const findings = await planRepository.listVulnerabilitiesForUser('u1');
    expect(findings).toHaveLength(140);
  });

  it('swallows Appwrite failures and returns empty', async () => {
    db.listDocuments.mockRejectedValue(new Error('down'));
    expect(await planRepository.listVulnerabilitiesForUser('u1')).toEqual([]);
  });
});

describe('threats', () => {
  it('full threat lifecycle via Appwrite', async () => {
    db.listDocuments.mockResolvedValue({ documents: [{ $id: 't1' }] } as never);
    db.createDocument.mockResolvedValue({ $id: 't2' } as never);
    db.getDocument.mockResolvedValue({ $id: 't1' } as never);
    db.updateDocument.mockResolvedValue({ $id: 't1', status: 'mitigated' } as never);
    db.deleteDocument.mockResolvedValue(undefined as never);

    expect(await planRepository.listThreats('p1')).toHaveLength(1);
    expect((await planRepository.createThreat('p1', { title: 'T', strideCategory: 'Spoofing', severity: 'high' })).$id).toBe('t2');
    expect((await planRepository.getThreat('t1'))?.$id).toBe('t1');
    expect((await planRepository.updateThreat('t1', { status: 'mitigated' }))?.status).toBe('mitigated');
    expect(await planRepository.deleteThreat('t1')).toBe(true);
  });

  it('full threat lifecycle in the fallback store', async () => {
    appwriteDown();
    seedDb();

    expect(await planRepository.listThreats('p1')).toHaveLength(1);
    const threat = await planRepository.createThreat('p1', { title: 'New', strideCategory: 'Tampering', severity: 'low' });
    expect(threat.status).toBe('identified');
    expect((await planRepository.getThreat('t1'))?.title).toBe('Spoof');
    expect(await planRepository.getThreat('missing')).toBeNull();
    expect((await planRepository.updateThreat('t1', { status: 'mitigated' }))?.status).toBe('mitigated');
    expect(await planRepository.updateThreat('missing', {})).toBeNull();
    expect(await planRepository.deleteThreat('t1')).toBe(true);
    expect(await planRepository.deleteThreat('missing')).toBe(false);
  });

  it('handles a store written before threats existed', async () => {
    appwriteDown();
    const base = seedDb();
    delete (base as Partial<PlanSchema>).threats;
    mockFileContent = JSON.stringify(base);
    expect(await planRepository.listThreats('p1')).toEqual([]);
  });
});

describe('mock db bootstrap', () => {
  it('seeds the default store when the file does not exist', async () => {
    appwriteDown();
    // no seedDb(): first read throws ENOENT → default written
    const projects = await planRepository.listProjects(undefined);
    expect(Array.isArray(projects)).toBe(true);
    expect(mockFileContent).not.toBeNull(); // default store was persisted
  });
});

describe('fail-open reads are observable, not silent (audit finding #4)', () => {
  const degraded = (source: string) =>
    warn.mock.calls.find(
      (c) => (c[1] as { event?: string; source?: string })?.event === 'plan_read_degraded'
        && (c[1] as { source?: string })?.source === source,
    );

  it('listVulnerabilitiesForRepos reports degraded on a read error, still returning no items', async () => {
    db.listDocuments.mockRejectedValueOnce(new Error('appwrite down'));
    expect(await planRepository.listVulnerabilitiesForRepos(['r1'])).toEqual({ items: [], degraded: true });
    expect(degraded('vulnerabilities')).toBeTruthy();
  });

  it('does NOT log degraded for a genuinely empty result (secure empty is distinguishable)', async () => {
    db.listDocuments.mockResolvedValueOnce({ documents: [] } as never);
    // A genuinely empty result is NOT degraded — that distinction is the point.
    expect(await planRepository.listVulnerabilitiesForRepos(['r1'])).toEqual({ items: [], degraded: false });
    expect(degraded('vulnerabilities')).toBeFalsy();
  });

  it('listRuntimeIncidentsForRepos reports degraded(runtime_incidents) on a read error', async () => {
    db.listDocuments.mockRejectedValueOnce(new Error('appwrite down'));
    expect(await planRepository.listRuntimeIncidentsForRepos(['r1'])).toEqual({ items: [], degraded: true });
    expect(degraded('runtime_incidents')).toBeTruthy();
  });
});
