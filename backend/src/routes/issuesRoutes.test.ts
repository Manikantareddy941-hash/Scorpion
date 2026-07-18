import request from 'supertest';
import express, { Request } from 'express';

type MockAuthRequest = Request & { user?: { $id: string } };

// Pin the storage facade to legacy: this suite asserts against the mocked
// Appwrite layer, and CI sets DATABASE_URL.
jest.mock('../db/pool', () => ({
  isPostgresEnabled: () => false,
  getPool: jest.fn(),
  closePool: jest.fn(),
}));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn() },
  DB_ID: 'test-db',
  COLLECTIONS: { TEAM_MEMBERS: 'team_members', REPOSITORIES: 'repositories', VULNERABILITIES: 'vulnerabilities' },
}));

import issuesRoutes from './issuesRoutes';
import { databases } from '../lib/appwrite';
// issuesRoutes builds queries with node-appwrite's Query directly, so the
// assertions below compare against the same real serialisation.
import { Query } from 'node-appwrite';

const listDocuments = databases.listDocuments as jest.Mock;

const buildApp = () => {
  const app = express();
  app.use((req: MockAuthRequest, _res, next) => {
    req.user = { $id: 'user-1' } as never;
    next();
  });
  app.use('/api/issues', issuesRoutes);
  return app;
};

/** No team memberships, two owned repos, then whatever findings the test wants. */
function withRepos(findings: unknown[] = []) {
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })                                  // memberships
    .mockResolvedValueOnce({ total: 2, documents: [{ $id: 'repo-1' }, { $id: 'repo-2' }] }) // owned repos
    .mockResolvedValueOnce({ total: findings.length, documents: findings });             // findings
}

/** The query array passed to the findings lookup. */
const findingsQuery = () => listDocuments.mock.calls[2][2];

beforeEach(() => jest.clearAllMocks());

describe('issuesRoutes GET / — tenant scoping', () => {
  it('constrains findings to the repositories the caller can reach', async () => {
    withRepos([{ $id: 'f1' }]);

    const res = await request(buildApp()).get('/api/issues');

    expect(res.statusCode).toBe(200);
    expect(findingsQuery()).toContain(Query.equal('repo_id', ['repo-1', 'repo-2']));
  });

  it('returns an empty list rather than every finding when the caller has no repos', async () => {
    listDocuments
      .mockResolvedValueOnce({ total: 0, documents: [] })
      .mockResolvedValueOnce({ total: 0, documents: [] });

    const res = await request(buildApp()).get('/api/issues');

    expect(res.body).toEqual({ total: 0, documents: [] });
    // Never reaches the findings collection.
    expect(listDocuments).toHaveBeenCalledTimes(2);
  });

  it('requires authentication', async () => {
    const app = express();
    app.use('/api/issues', issuesRoutes);
    expect((await request(app).get('/api/issues')).statusCode).toBe(401);
  });
});

describe('issuesRoutes GET / — repoId narrowing', () => {
  it('narrows to a single repo the caller can reach', async () => {
    withRepos();

    await request(buildApp()).get('/api/issues?repoId=repo-2');

    expect(findingsQuery()).toContain(Query.equal('repo_id', ['repo-2']));
  });

  it('cannot be used to reach another tenant repository', async () => {
    // The security property: repoId is intersected with the accessible set,
    // never substituted for it. An unreachable id yields nothing, and the
    // findings collection is never queried at all.
    listDocuments
      .mockResolvedValueOnce({ total: 0, documents: [] })
      .mockResolvedValueOnce({ total: 1, documents: [{ $id: 'repo-1' }] });

    const res = await request(buildApp()).get('/api/issues?repoId=someone-elses-repo');

    expect(res.body).toEqual({ total: 0, documents: [] });
    expect(listDocuments).toHaveBeenCalledTimes(2);
  });
});

describe('issuesRoutes GET / — filters', () => {
  it('passes scanId, tool and status through', async () => {
    withRepos();

    await request(buildApp()).get('/api/issues?scanId=scan-1&tool=gitleaks&status=open');

    const q = findingsQuery();
    expect(q).toContain(Query.equal('scanId', 'scan-1'));
    expect(q).toContain(Query.equal('tool', 'gitleaks'));
    expect(q).toContain(Query.equal('status', 'open'));
  });

  it('treats a single severity as a scalar match', async () => {
    withRepos();
    await request(buildApp()).get('/api/issues?severity=critical');
    expect(findingsQuery()).toContain(Query.equal('severity', 'critical'));
  });

  it('treats a comma-separated severity as an any-of match', async () => {
    withRepos();
    await request(buildApp()).get('/api/issues?severity=low,info');
    expect(findingsQuery()).toContain(Query.equal('severity', ['low', 'info']));
  });

  it('ignores blank entries in a severity list', async () => {
    withRepos();
    await request(buildApp()).get('/api/issues?severity=low,,');
    expect(findingsQuery()).toContain(Query.equal('severity', 'low'));
  });

  it('filters by message prefix, which is how Trivy output is split', async () => {
    // '[VULN]' is dependency scanning, '[CONFIG]' is IaC — same tool, and the
    // SCA and Infrastructure pages differ only by this prefix.
    withRepos();
    await request(buildApp()).get('/api/issues?tool=trivy&messagePrefix=%5BCONFIG%5D');
    expect(findingsQuery()).toContain(Query.startsWith('message', '[CONFIG]'));
  });

  it('applies no optional filters when none are given', async () => {
    withRepos();
    await request(buildApp()).get('/api/issues');
    const q = findingsQuery();
    // Only the scope, ordering and limit.
    expect(q).toHaveLength(3);
  });
});
