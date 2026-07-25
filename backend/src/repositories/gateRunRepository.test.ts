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
  repoId: 'r1', commitSha: 'abc123', branch: 'main', status: 'blocked',
  violations: [{ projectId: 'pA', code: 'REQ', title: 't', frameworks: ['PCI DSS'], severity: 'high', findingCount: 1, jiraKey: 'SEC-1', findings: [] }],
  createdAt: '2026-07-25T00:00:00.000Z',
};

beforeEach(() => jest.clearAllMocks());

describe('gateRunRepository', () => {
  it('records a run with violations serialized to a JSON string', async () => {
    await repo.record(run);
    const payload = mockCreate.mock.calls[0][3];
    expect(payload.repoId).toBe('r1');
    expect(payload.status).toBe('blocked');
    expect(typeof payload.violations).toBe('string');
    expect(JSON.parse(payload.violations)[0].jiraKey).toBe('SEC-1');
  });

  it('lists runs for a repo set and parses violations back into objects', async () => {
    mockList.mockResolvedValue({ documents: [
      { $id: 'x', repoId: 'r1', status: 'blocked', createdAt: '2026-07-25', violations: JSON.stringify(run.violations) },
    ] });
    const runs = await repo.listByRepos(['r1']);
    expect(runs[0].violations[0].code).toBe('REQ');
    expect(Array.isArray(runs[0].violations)).toBe(true);
  });

  it('short-circuits to an empty list when no repos are bound', async () => {
    expect(await repo.listByRepos([])).toEqual([]);
    expect(mockList).not.toHaveBeenCalled();
  });
});
