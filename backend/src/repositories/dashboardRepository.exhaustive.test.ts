// The findings reads were capped at Query.limit(5000) while dashboardService
// used findingsResponse.total (the backend's real count) for the headline
// figure and .documents for every breakdown. Past the cap the headline and the
// parts disagreed, and the breakdowns understated — severity counts, by_repo,
// by_type and the SLA widgets were all computed over a subset.
// octokit is ESM and jest cannot parse it; dashboardRepository imports it for
// unrelated GitHub calls, so stub it to keep this suite on the data path.
jest.mock('octokit', () => ({ Octokit: class {} }));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), getDocument: jest.fn() },
  DB_ID: 'db',
  COLLECTIONS: { FINDINGS: 'vulnerabilities', REPOSITORIES: 'repositories' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    or: (q: unknown[]) => ({ or: q }),
    orderDesc: (f: string) => ({ orderDesc: f }),
    limit: (n: number) => ({ limit: n }),
    offset: (n: number) => ({ offset: n }),
  },
}));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { dashboardRepository } from './dashboardRepository';
import { databases } from '../lib/appwrite';

const listDocuments = databases.listDocuments as jest.Mock;

/** Serves `total` rows, honouring the offset/limit the caller pages with. */
function serve(total: number) {
  listDocuments.mockImplementation(async (_db: string, _col: string, queries: Record<string, number>[]) => {
    const offset = queries.find((q) => 'offset' in q)?.offset ?? 0;
    const limit = queries.find((q) => 'limit' in q)?.limit ?? 25;
    const documents = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, i) => ({ $id: `f${offset + i}`, severity: 'high' }),
    );
    return { total, documents };
  });
}

beforeEach(() => listDocuments.mockReset());

describe.each([
  ['listFindingsForReposOrScans', () => dashboardRepository.listFindingsForReposOrScans(['r1'], ['s1'])],
  ['listOpenFindingsForRepos', () => dashboardRepository.listOpenFindingsForRepos(['r1'])],
  ['listFindingsForReposScoped', () => dashboardRepository.listFindingsForReposScoped(['r1'])],
])('%s', (_name, call) => {
  it('returns every finding, not just the first page', async () => {
    serve(250);

    const res = await call();

    expect(res.documents).toHaveLength(250);
    expect(res.total).toBe(250);
    expect(res.truncated).toBe(false);
  });

  it('keeps documents and total consistent, so the parts sum to the headline', async () => {
    // The defect: total said 250 while documents held only the first page, so
    // the dashboard's headline count and its severity breakdown disagreed.
    serve(250);

    const res = await call();

    expect(res.documents).toHaveLength(res.total);
  });

  it('preserves the caller filter on every page', async () => {
    serve(250);

    await call();

    // Losing the repo filter after page one would pull another tenant's
    // findings into this dashboard.
    for (const c of listDocuments.mock.calls) {
      expect(JSON.stringify(c[2])).toMatch(/repo_id|scanId/);
    }
  });
});
