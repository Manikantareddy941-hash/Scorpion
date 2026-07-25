jest.mock('../lib/appwrite', () => ({
  databases: { createDocument: jest.fn(), listDocuments: jest.fn() },
  DB_ID: 'db',
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    orderDesc: (f: string) => ({ orderDesc: f }),
    limit: (n: number) => ({ limit: n }),
  },
  ID: { unique: () => 'run-id' },
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { databases } from '../lib/appwrite';
import { gateRunRepository as repo, GateRun } from './gateRunRepository';

const mockCreate = databases.createDocument as jest.Mock;
const mockList = databases.listDocuments as jest.Mock;

const run: GateRun = {
  repoId: 'r1', source: 'deploy', environment: 'production', actor: 'dev@x', commitSha: 'abc123', branch: 'main', status: 'overridden',
  violations: [{ projectId: 'pA', code: 'REQ', title: 't', frameworks: ['PCI DSS'], severity: 'high', findingCount: 1, jiraKey: 'SEC-1', findings: [] }],
  createdAt: '2026-07-25T00:00:00.000Z',
};

beforeEach(() => jest.clearAllMocks());

describe('gateRunRepository', () => {
  it('records a deploy run with source/environment/actor and JSON-serialized violations', async () => {
    await repo.record(run);
    const payload = mockCreate.mock.calls[0][3];
    expect(payload.repoId).toBe('r1');
    expect(payload.source).toBe('deploy');
    expect(payload.environment).toBe('production');
    expect(payload.actor).toBe('dev@x');
    expect(payload.status).toBe('overridden');
    expect(typeof payload.violations).toBe('string');
    expect(JSON.parse(payload.violations)[0].jiraKey).toBe('SEC-1');
  });

  it('lists runs and parses source/violations back, defaulting legacy rows to source ci', async () => {
    mockList.mockResolvedValue({ documents: [
      { $id: 'x', repoId: 'r1', status: 'blocked', createdAt: '2026-07-25', violations: JSON.stringify(run.violations) },
    ] });
    const runs = await repo.listByRepos(['r1']);
    expect(runs[0].source).toBe('ci'); // legacy row (no source field) defaults to ci
    expect(runs[0].violations[0].code).toBe('REQ');
  });

  it('short-circuits to an empty list when no repos are bound', async () => {
    expect(await repo.listByRepos([])).toEqual([]);
    expect(mockList).not.toHaveBeenCalled();
  });
});
