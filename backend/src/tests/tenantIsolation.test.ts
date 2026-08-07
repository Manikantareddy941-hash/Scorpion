/**
 * Tenant-isolation suite: proves user B cannot read or mutate user A's
 * resources through the API. Unlike the per-route tests, tenancyService is
 * NOT mocked — the real ownership checks run against an in-memory Appwrite
 * fake, so a regression in the enforcement chain fails here.
 */

type Doc = { $id: string } & Record<string, unknown>;
type FakeQuery =
  | { op: 'equal'; attr: string; values: unknown[] }
  | { op: 'contains'; attr: string; values: unknown[] }
  | { op: 'or'; queries: FakeQuery[] }
  | { op: 'limit'; n: number }
  | { op: 'ignore' };

// A single query's predicate, so `or` can union the branches it wraps.
function matches(doc: Doc, q: FakeQuery): boolean {
  if (q.op === 'equal') return q.values.includes(doc[q.attr]);
  if (q.op === 'contains') return q.values.some((v) => String(doc[q.attr] ?? '').includes(String(v)));
  if (q.op === 'or') return q.queries.some((sub) => matches(doc, sub));
  return true;
}

const store: Record<string, Doc[]> = {};

function applyQueries(docs: Doc[], queries: FakeQuery[] = []): Doc[] {
  let out = docs;
  let limit = Infinity;
  for (const q of queries) {
    if (!q || typeof q !== 'object') continue;
    if (q.op === 'equal' || q.op === 'contains' || q.op === 'or') {
      out = out.filter((d) => matches(d, q));
    } else if (q.op === 'limit') {
      limit = q.n;
    }
  }
  return out.slice(0, limit);
}

// Pin the storage facade to its legacy Appwrite path: this suite mocks Appwrite
// directly, so under CI's DATABASE_URL the pg facade would bypass these mocks.
// Postgres tenancy scoping is covered by the pg repository unit tests.
jest.mock('../db/pool', () => ({
  isPostgresEnabled: () => false,
  getPool: jest.fn(),
  closePool: jest.fn(),
}));
jest.mock('../lib/appwrite', () => ({
  DB_ID: 'test-db',
  // Any COLLECTIONS.X resolves to a stable per-key collection name.
  COLLECTIONS: new Proxy({}, { get: (_t, key) => String(key).toLowerCase() }),
  ID: { unique: () => `id-${Math.random().toString(36).slice(2)}` },
  Query: {
    equal: (attr: string, value: unknown) => ({
      op: 'equal',
      attr,
      values: Array.isArray(value) ? value : [value]
    }),
    contains: (attr: string, value: unknown) => ({
      op: 'contains',
      attr,
      values: Array.isArray(value) ? value : [value]
    }),
    or: (queries: FakeQuery[]) => ({ op: 'or', queries }),
    limit: (n: number) => ({ op: 'limit', n }),
    offset: () => ({ op: 'ignore' }),
    orderDesc: () => ({ op: 'ignore' }),
    orderAsc: () => ({ op: 'ignore' })
  },
  databases: {
    listDocuments: jest.fn(async (_db: string, coll: string, queries?: FakeQuery[]) => {
      const documents = applyQueries(store[coll] ?? [], queries);
      return { total: documents.length, documents };
    }),
    getDocument: jest.fn(async (_db: string, coll: string, id: string) => {
      const doc = (store[coll] ?? []).find((d) => d.$id === id);
      if (!doc) throw new Error(`Document ${id} not found in ${coll}`);
      return doc;
    }),
    createDocument: jest.fn(async (_db: string, coll: string, id: string, data: Record<string, unknown>) => {
      const doc = { $id: id, ...data };
      (store[coll] = store[coll] ?? []).push(doc);
      return doc;
    }),
    updateDocument: jest.fn(async (_db: string, coll: string, id: string, data: Record<string, unknown>) => {
      const doc = (store[coll] ?? []).find((d) => d.$id === id);
      if (!doc) throw new Error(`Document ${id} not found in ${coll}`);
      Object.assign(doc, data);
      return doc;
    }),
    deleteDocument: jest.fn(async (_db: string, coll: string, id: string) => {
      store[coll] = (store[coll] ?? []).filter((d) => d.$id !== id);
    })
  }
}));

// Switchable identity: tests flip between owner and attacker.
let currentUser = { $id: 'user-a', email: 'a@example.com' };
jest.mock('../middleware/auth', () => ({
  verifyUser: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = currentUser;
    next();
  }
}));

// Heavy side-effect modules not under test.
jest.mock('../queues/scanQueue', () => ({ enqueueScan: jest.fn() }));
jest.mock('../services/ingestionService', () => ({ cleanupWorkspace: jest.fn() }));
jest.mock('../utils/auditLogger', () => ({ logAuditEvent: jest.fn() }));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));
jest.mock('../services/incidentService', () => ({
  updateIncidentStatus: jest.fn().mockResolvedValue({ ok: true })
}));
jest.mock('../services/incidentPostmortem', () => ({
  buildPostmortemPatch: jest.fn().mockReturnValue({})
}));
jest.mock('../services/incidentFeedbackService', () => ({
  convertIncidentToIssue: jest.fn().mockResolvedValue('forbidden')
}));
jest.mock('../repositories/soarRepository', () => ({
  soarRepository: { listEvidenceByIncident: jest.fn().mockResolvedValue([]) }
}));

import express, { Request } from 'express';
import request from 'supertest';
import repoRoutes from '../routes/repoRoutes';
import findingRoutes from '../routes/findingRoutes';
import incidentRoutes from '../routes/incidentRoutes';

const app = express();
app.use(express.json());
// Routers mounted behind app-level auth (mirrors index.ts) get the same
// switchable identity as routers that call verifyUser internally.
app.use((req: Request & { user?: unknown }, _res, next) => {
  req.user = currentUser;
  next();
});
app.use('/api/repos', repoRoutes);
app.use('/api/findings', findingRoutes);
app.use('/api/incidents', incidentRoutes);

const OWNER = { $id: 'user-a', email: 'a@example.com' };
const ATTACKER = { $id: 'user-b', email: 'b@example.com' };

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  store['repositories'] = [
    { $id: 'repo-a', user_id: 'user-a', name: 'shop', url: 'https://github.com/a/shop', updated_at: '2026-01-01' }
  ];
  store['scans'] = [
    { $id: 'scan-a', repo_id: 'repo-a', status: 'completed', details: '{}' }
  ];
  // COLLECTIONS proxy maps COLLECTIONS.FINDINGS -> 'findings'
  store['findings'] = [
    { $id: 'finding-a', repo_id: 'repo-a', status: 'open', title: 'SQL injection' }
  ];
  store['incidents'] = [
    { $id: 'inc-a', user_id: 'user-a', title: 'Prod breach', status: 'open', severity: 'high' }
  ];
  store['team_members'] = []; // attacker is in no team
  currentUser = OWNER;
});

describe('repositories', () => {
  it('owner lists own repos', async () => {
    const res = await request(app).get('/api/repos');
    expect(res.status).toBe(200);
    expect(res.body.map((r: Doc) => r.$id)).toEqual(['repo-a']);
  });

  it("attacker's repo list never contains another tenant's repo", async () => {
    currentUser = ATTACKER;
    const res = await request(app).get('/api/repos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('attacker cannot delete a repo they do not own', async () => {
    currentUser = ATTACKER;
    const res = await request(app).delete('/api/repos/repo-a');
    expect(res.status).toBe(403);
    expect(store['repositories']).toHaveLength(1);
  });
});

describe('scan results', () => {
  it('owner reads own scan status', async () => {
    const res = await request(app).get('/api/repos/scans/scan-a');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('scan-a');
  });

  it("attacker cannot read another tenant's scan status by id", async () => {
    currentUser = ATTACKER;
    const res = await request(app).get('/api/repos/scans/scan-a');
    expect(res.status).toBe(403);
  });
});

describe('findings', () => {
  it('owner can resolve own finding', async () => {
    const res = await request(app)
      .patch('/api/findings/finding-a')
      .send({ status: 'resolved' });
    expect(res.status).toBe(200);
  });

  it("attacker cannot mutate another tenant's finding by id", async () => {
    currentUser = ATTACKER;
    const res = await request(app)
      .patch('/api/findings/finding-a')
      .send({ status: 'resolved' });
    // 404, not 403: a 403 distinguishes "exists but forbidden" from "no such
    // finding", which lets a caller enumerate valid finding ids. The property
    // that matters — the write does not land — is asserted below and is
    // unchanged.
    expect(res.status).toBe(404);
    expect(store['findings'][0].status).toBe('open');
  });
});

describe('incidents', () => {
  it('owner lists own incidents', async () => {
    const res = await request(app).get('/api/incidents');
    expect(res.status).toBe(200);
    const ids = (res.body.documents ?? res.body).map((i: Doc) => i.$id);
    expect(ids).toContain('inc-a');
  });

  it("attacker's incident list never contains another tenant's incident", async () => {
    currentUser = ATTACKER;
    const res = await request(app).get('/api/incidents');
    expect(res.status).toBe(200);
    const list = res.body.documents ?? res.body;
    expect(list).toEqual([]);
  });

  it("attacker cannot read another tenant's incident evidence", async () => {
    currentUser = ATTACKER;
    const res = await request(app).get('/api/incidents/inc-a/evidence');
    expect(res.status).toBe(403);
  });

  it("attacker cannot change another tenant's incident status", async () => {
    currentUser = ATTACKER;
    const res = await request(app)
      .patch('/api/incidents/inc-a/status')
      .send({ status: 'resolved' });
    expect(res.status).toBe(403);
    expect(store['incidents'][0].status).toBe('open');
  });
});
