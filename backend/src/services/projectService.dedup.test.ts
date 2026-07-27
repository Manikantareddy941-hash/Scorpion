// importRepoToProject did its own exact-string URL lookup before creating a
// repo, so importing an already-tracked repository under a different spelling
// (.git suffix, trailing slash, casing, SSH remote) created a SECOND row for
// the same repository — splitting that project's findings across two records.
// The canonical lookup lives in repoRepository; this pins that the service
// actually goes through it.
jest.mock('../db/pool', () => ({ isPostgresEnabled: () => false }));
jest.mock('../lib/appwrite', () => ({
  databases: {
    getDocument: jest.fn(),
    listDocuments: jest.fn(),
    createDocument: jest.fn(),
    updateDocument: jest.fn(),
  },
  DB_ID: 'db',
  ID: { unique: () => 'new-id' },
  COLLECTIONS: { REPOSITORIES: 'repositories', PROJECTS: 'projects' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    limit: (n: number) => ({ limit: n }),
  },
}));
jest.mock('../queues/scanQueue', () => ({ enqueueScan: jest.fn() }));
jest.mock('./logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { importRepoToProject } from './projectService';
import { databases } from '../lib/appwrite';

const getDocument = databases.getDocument as jest.Mock;
const listDocuments = databases.listDocuments as jest.Mock;
const createDocument = databases.createDocument as jest.Mock;
const updateDocument = databases.updateDocument as jest.Mock;

const CANONICAL = 'https://github.com/Org/Repo';

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: clear leaves queued mockResolvedValueOnce
  // values in place, so an unconsumed one leaks into the next test and answers
  // a call it was never meant for.
  jest.resetAllMocks();
  getDocument.mockResolvedValue({ $id: 'p1', user_id: 'u1' }); // project owned by caller
  updateDocument.mockResolvedValue({ $id: 'r1' });
  createDocument.mockResolvedValue({ $id: 'new-id' });
});

test.each([
  ['a .git suffix', 'https://github.com/Org/Repo.git'],
  ['a trailing slash', 'https://github.com/Org/Repo/'],
  ['different casing', 'https://github.com/ORG/REPO'],
  ['an ssh remote', 'git@github.com:Org/Repo.git'],
])('importing a URL with %s reuses the existing repo', async (_label, variant) => {
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })                             // exact miss
    .mockResolvedValueOnce({ total: 1, documents: [{ $id: 'r1', url: CANONICAL }] }); // canonical hit

  await importRepoToProject('p1', 'u1', variant);

  expect(updateDocument).toHaveBeenCalledWith('db', 'repositories', 'r1', expect.objectContaining({ project_id: 'p1' }));
  expect(createDocument).not.toHaveBeenCalled();
});

test('a genuinely new repo is still created', async () => {
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })
    .mockResolvedValueOnce({ total: 0, documents: [] });

  await importRepoToProject('p1', 'u1', 'https://github.com/Org/Brand-New');

  expect(createDocument).toHaveBeenCalled();
  expect(updateDocument).not.toHaveBeenCalled();
});

test('the repo lookup stays scoped to the calling user', async () => {
  listDocuments
    .mockResolvedValueOnce({ total: 0, documents: [] })
    .mockResolvedValueOnce({ total: 0, documents: [] });

  await importRepoToProject('p1', 'u1', 'https://github.com/Org/Repo.git');

  // Every lookup must carry the owner; an unscoped one could adopt another
  // tenant's repository into this project.
  for (const call of listDocuments.mock.calls) {
    expect(call[2]).toContainEqual({ equal: ['user_id', 'u1'] });
  }
});

test('a project the caller does not own is refused before any repo work', async () => {
  getDocument.mockResolvedValue({ $id: 'p1', user_id: 'someone-else' });

  const res = await importRepoToProject('p1', 'u1', CANONICAL);

  expect(res).toEqual({ error: 'Project not found or access denied' });
  expect(listDocuments).not.toHaveBeenCalled();
  expect(createDocument).not.toHaveBeenCalled();
});
