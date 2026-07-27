// The GitHub App install path calls findRepoByUserAndUrl before creating a
// repo. It used to match the URL exactly, so installing over a repo already
// tracked under a different spelling registered a duplicate. Exercises the
// real repoRepository underneath (appwrite is mocked, not repoRepository) so
// this pins the seam rather than the delegation.
jest.mock('../db/pool', () => ({ isPostgresEnabled: () => false }));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), createDocument: jest.fn(), updateDocument: jest.fn(), getDocument: jest.fn(), deleteDocument: jest.fn() },
  users: { updatePrefs: jest.fn(), list: jest.fn() },
  DB_ID: 'db',
  ID: { unique: () => 'new-id' },
  COLLECTIONS: { REPOSITORIES: 'repositories' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    limit: (n: number) => ({ limit: n }),
    orderDesc: (f: string) => ({ orderDesc: f }),
  },
}));

import { webhookRepository } from './webhookRepository';
import { databases } from '../lib/appwrite';

const listDocuments = databases.listDocuments as jest.Mock;
const CANONICAL = 'https://github.com/Org/Repo';

beforeEach(() => listDocuments.mockReset());

test.each([
  ['a .git suffix', 'https://github.com/Org/Repo.git'],
  ['different casing', 'https://github.com/ORG/REPO'],
  ['an ssh remote', 'git@github.com:Org/Repo.git'],
])('an install with %s finds the already-tracked repo', async (_label, variant) => {
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })
    .mockResolvedValueOnce({ total: 1, documents: [{ $id: 'r1', url: CANONICAL }] });

  const res = await webhookRepository.findRepoByUserAndUrl('u1', variant);

  // total > 0 is what the install path checks before creating.
  expect(res.total).toBe(1);
  expect(res.documents[0].$id).toBe('r1');
});

test('an unrelated repo is still reported as absent so it gets registered', async () => {
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })
    .mockResolvedValueOnce({ total: 1, documents: [{ $id: 'r1', url: 'https://github.com/Org/Other' }] });

  const res = await webhookRepository.findRepoByUserAndUrl('u1', CANONICAL);

  expect(res.total).toBe(0);
});

test('the lookup stays scoped to the installing user', async () => {
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })
    .mockResolvedValueOnce({ total: 0, documents: [] });

  await webhookRepository.findRepoByUserAndUrl('u1', 'https://github.com/Org/Repo.git');

  for (const call of listDocuments.mock.calls) {
    expect(call[2]).toContainEqual({ equal: ['user_id', 'u1'] });
  }
});
