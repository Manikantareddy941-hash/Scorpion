jest.mock('../middleware/rateLimiters', () => ({ aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }));
jest.mock('../services/logger', () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock('../services/tenancyService', () => ({ canAccessResource: jest.fn().mockResolvedValue(true) }));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), getDocument: jest.fn(), updateDocument: jest.fn() },
  DB_ID: 'db',
  COLLECTIONS: { REPOSITORIES: 'repositories', VULNERABILITIES: 'vulnerabilities' },
  Query: { equal: (f: string, v: string) => `equal(${f},${v})`, limit: (n: number) => `limit(${n})` },
}));

// The PR machinery itself is not under test here — only what the handler
// records against the finding once GitHub has accepted the PR.
const pullsCreate = jest.fn().mockResolvedValue({ data: { html_url: 'https://github.com/acme/api/pull/7', number: 7 } });
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    repos: { get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }) },
    pulls: { create: pullsCreate },
  })),
}));
jest.mock('simple-git', () => jest.fn(() => ({
  clone: jest.fn().mockResolvedValue(undefined),
  checkoutLocalBranch: jest.fn().mockResolvedValue(undefined),
  add: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  push: jest.fn().mockResolvedValue(undefined),
})));
jest.mock('fs/promises', () => ({
  mkdtemp: jest.fn().mockResolvedValue('/tmp/scorpion-test'),
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
}));

import express from 'express';
import request from 'supertest';
import router from './remediation';
import { databases } from '../lib/appwrite';

const app = express();
app.use(express.json());
app.use((req: express.Request & { user?: { $id: string } }, _res, next) => {
  req.user = { $id: 'u1' };
  next();
});
app.use('/api/remediation', router);

const listDocuments = databases.listDocuments as jest.Mock;
const getDocument = databases.getDocument as jest.Mock;
const updateDocument = databases.updateDocument as jest.Mock;

const validBody = {
  findingId: 'f1',
  repoUrl: 'https://github.com/acme/api',
  filePath: 'src/auth.ts',
  fixedContent: 'export const safe = true;\n',
  vulnerabilityTitle: 'Hardcoded secret',
  severity: 'high',
};

beforeEach(() => {
  listDocuments.mockReset();
  getDocument.mockReset();
  updateDocument.mockReset();
  updateDocument.mockResolvedValue({});
  // The caller owns repo r1, which is what repoUrl resolves to.
  listDocuments.mockResolvedValue({ total: 1, documents: [{ $id: 'r1', url: 'https://github.com/acme/api' }] });
});

test('records the PR against a finding belonging to the authorised repo', async () => {
  getDocument.mockResolvedValue({ $id: 'f1', repo_id: 'r1', status: 'open' });

  const res = await request(app).post('/api/remediation/create-pr').send(validBody);

  expect(res.status).toBe(200);
  const payload = updateDocument.mock.calls[0][3];
  expect(payload.pr_url).toBe('https://github.com/acme/api/pull/7');
  expect(payload.resolution_status).toBe('remediated');
  // An open PR is a proposed fix, not a confirmed one — only a later scan that
  // stops reporting the finding may move it to resolved.
  expect(payload).not.toHaveProperty('status');
});

test('does not write to a finding from a repo the caller was not authorised for', async () => {
  // Ownership was checked against repoUrl -> r1, but this findingId belongs to
  // r2. Without the cross-check, any finding id would be writable by pairing it
  // with a repo the caller does own.
  getDocument.mockResolvedValue({ $id: 'f1', repo_id: 'r2', status: 'open' });

  const res = await request(app).post('/api/remediation/create-pr').send(validBody);

  expect(res.status).toBe(200);
  expect(updateDocument).not.toHaveBeenCalled();
});

test('still returns the PR when recording it fails', async () => {
  // The PR exists on GitHub either way; reporting failure here would tell the
  // caller the remediation did not happen when it did.
  getDocument.mockResolvedValue({ $id: 'f1', repo_id: 'r1', status: 'open' });
  updateDocument.mockRejectedValue(new Error('appwrite down'));

  const res = await request(app).post('/api/remediation/create-pr').send(validBody);

  expect(res.status).toBe(200);
  expect(res.body.prUrl).toBe('https://github.com/acme/api/pull/7');
});

test('403s when the repo is not one the caller can reach', async () => {
  listDocuments.mockResolvedValue({ total: 0, documents: [] });

  const res = await request(app).post('/api/remediation/create-pr').send(validBody);

  expect(res.status).toBe(403);
  expect(updateDocument).not.toHaveBeenCalled();
});
