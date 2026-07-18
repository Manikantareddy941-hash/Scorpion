jest.mock('../services/scanService', () => ({ getInsightsSummary: jest.fn() }));
jest.mock('../services/tenancyService', () => ({
  resolveOwnershipScope: jest.fn().mockResolvedValue({ field: 'user_id', value: 'u1' }),
}));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn() },
  DB_ID: 'db',
  COLLECTIONS: { REPOSITORIES: 'repositories', COMMITS: 'commits', TEST_RUNS: 'test_runs', TASKS: 'tasks' },
  Query: {
    equal: (f: string, v: unknown) => `equal(${f},${JSON.stringify(v)})`,
    orderDesc: (f: string) => `orderDesc(${f})`,
    limit: (n: number) => `limit(${n})`,
  },
}));

import express from 'express';
import request from 'supertest';
import router from './insightRoutes';
import { databases } from '../lib/appwrite';

const app = express();
app.use((req: express.Request & { user?: { $id: string } }, _res, next) => {
  req.user = { $id: 'u1' };
  next();
});
app.use('/api/insights', router);

const listDocuments = databases.listDocuments as jest.Mock;

beforeEach(() => listDocuments.mockReset());

/** First call is always the repository scope lookup. */
function mockScope(repoIds: string[], payload: Record<string, unknown> = { total: 0, documents: [] }) {
  listDocuments
    .mockResolvedValueOnce({ total: repoIds.length, documents: repoIds.map(id => ({ $id: id })) })
    .mockResolvedValueOnce(payload);
}

describe.each([
  ['/api/insights/commits', 'commits'],
  ['/api/insights/test-runs', 'test_runs'],
])('GET %s', (path, collection) => {
  it('filters to the caller\'s repositories', async () => {
    mockScope(['r1', 'r2'], { total: 1, documents: [{ $id: 'c1', repo_id: 'r1' }] });

    const res = await request(app).get(path);

    expect(res.status).toBe(200);
    expect(listDocuments.mock.calls[1][1]).toBe(collection);
    expect(listDocuments.mock.calls[1][2]).toContain('equal(repo_id,["r1","r2"])');
  });

  it('returns nothing, and queries nothing, when the caller has no repositories', async () => {
    // An empty id list is not a filter that matches nothing — widening it by
    // accident would return every row in the collection, so the route must not
    // reach the collection at all.
    listDocuments.mockResolvedValueOnce({ total: 0, documents: [] });

    const res = await request(app).get(path);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 0, documents: [] });
    expect(listDocuments).toHaveBeenCalledTimes(1);
  });

  it('caps an oversized limit', async () => {
    mockScope(['r1']);

    await request(app).get(`${path}?limit=99999`);

    const queries: string[] = listDocuments.mock.calls[1][2];
    const limit = Number(queries.find(q => q.startsWith('limit('))!.match(/\d+/)![0]);
    expect(limit).toBeLessThanOrEqual(200);
  });
});

describe('GET /api/insights/test-runs pass_rate', () => {
  it('derives pass_rate when the ingest did not write one', async () => {
    // The UI reads pass_rate but the webhook ingest never writes it, so it
    // always rendered 0% next to counts that said otherwise.
    mockScope(['r1'], { total: 1, documents: [{ $id: 't1', total_tests: 200, passed_tests: 190 }] });

    const res = await request(app).get('/api/insights/test-runs');

    expect(res.body.documents[0].pass_rate).toBe(95);
  });

  it('leaves a stored pass_rate alone', async () => {
    mockScope(['r1'], { total: 1, documents: [{ $id: 't1', total_tests: 200, passed_tests: 190, pass_rate: 42 }] });

    const res = await request(app).get('/api/insights/test-runs');

    expect(res.body.documents[0].pass_rate).toBe(42);
  });

  it('does not divide by zero on a run with no tests', async () => {
    mockScope(['r1'], { total: 1, documents: [{ $id: 't1', total_tests: 0, passed_tests: 0 }] });

    const res = await request(app).get('/api/insights/test-runs');

    expect(res.body.documents[0].pass_rate).toBe(0);
  });
});
