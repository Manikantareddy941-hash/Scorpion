// Repo lookup must match on canonical identity, not exact string. The same
// repository arrives as different strings depending on who sends it (CI, CLI,
// hand-typed), and an exact-match miss creates a DUPLICATE repo row — each with
// its own findings, so a tenant's security posture silently splits in two.
jest.mock('../db/pool', () => ({ isPostgresEnabled: () => false }));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), createDocument: jest.fn(), updateDocument: jest.fn(), getDocument: jest.fn(), deleteDocument: jest.fn() },
  DB_ID: 'db',
  COLLECTIONS: { REPOSITORIES: 'repositories', SCANS: 'scans' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    limit: (n: number) => ({ limit: n }),
    orderDesc: (f: string) => ({ orderDesc: f }),
  },
}));

import { repoRepository } from './repoRepository';
import { databases } from '../lib/appwrite';

const listDocuments = databases.listDocuments as jest.Mock;
const CANONICAL = 'https://github.com/Org/Repo';

beforeEach(() => listDocuments.mockReset());

test('an exact URL match short-circuits without scanning the tenant', async () => {
  listDocuments.mockResolvedValueOnce({ total: 1, documents: [{ $id: 'r1', url: CANONICAL }] });

  const res = await repoRepository.findByOwnershipAndUrl('user_id', 'u1', CANONICAL);

  expect(res.total).toBe(1);
  expect(res.documents[0].$id).toBe('r1');
  // Only the indexed exact query ran — the fallback list is the slow path.
  expect(listDocuments).toHaveBeenCalledTimes(1);
});

describe.each([
  ['a .git suffix', 'https://github.com/Org/Repo.git'],
  ['a trailing slash', 'https://github.com/Org/Repo/'],
  ['different casing', 'https://github.com/ORG/REPO'],
  ['an ssh remote', 'git@github.com:Org/Repo.git'],
  ['a www host', 'https://www.github.com/Org/Repo'],
])('a URL variant with %s', (_label, variant) => {
  test('resolves to the existing repo instead of creating a duplicate', async () => {
    listDocuments
      .mockResolvedValueOnce({ total: 0, documents: [] })                            // exact miss
      .mockResolvedValueOnce({ total: 1, documents: [{ $id: 'r1', url: CANONICAL }] }); // tenant scan

    const res = await repoRepository.findByOwnershipAndUrl('user_id', 'u1', variant);

    expect(res.total).toBe(1);
    expect(res.documents[0].$id).toBe('r1');
  });
});

test('a genuinely different repo does not match', async () => {
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })
    .mockResolvedValueOnce({ total: 1, documents: [{ $id: 'r1', url: 'https://github.com/Org/Other' }] });

  const res = await repoRepository.findByOwnershipAndUrl('user_id', 'u1', CANONICAL);

  expect(res.total).toBe(0);
  expect(res.documents).toEqual([]);
});

test('the same path on a different host does not match', async () => {
  // canonicalizeRepoUrl keeps the host deliberately — gitlab.com/org/repo and
  // github.com/org/repo are different repositories.
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })
    .mockResolvedValueOnce({ total: 1, documents: [{ $id: 'r1', url: 'https://gitlab.com/Org/Repo' }] });

  const res = await repoRepository.findByOwnershipAndUrl('user_id', 'u1', CANONICAL);

  expect(res.total).toBe(0);
});

test('the fallback scan stays scoped to the caller, never the whole collection', async () => {
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })
    .mockResolvedValueOnce({ total: 0, documents: [] });

  await repoRepository.findByOwnershipAndUrl('team_id', 'team-9', 'https://github.com/Org/Repo.git');

  // Without the ownership filter this becomes a cross-tenant read that could
  // return another tenant's repo as "already exists".
  const fallbackQueries = listDocuments.mock.calls[1][2];
  expect(fallbackQueries).toContainEqual({ equal: ['team_id', 'team-9'] });
});

test('an empty url does not fall back and match an arbitrary repo', async () => {
  listDocuments.mockResolvedValueOnce({ total: 0, documents: [] });

  const res = await repoRepository.findByOwnershipAndUrl('user_id', 'u1', '');

  expect(res.total).toBe(0);
  expect(listDocuments).toHaveBeenCalledTimes(1);
});
