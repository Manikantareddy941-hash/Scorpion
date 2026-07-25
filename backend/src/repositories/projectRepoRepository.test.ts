jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), createDocument: jest.fn(), deleteDocument: jest.fn() },
  DB_ID: 'db',
  Query: { equal: (f: string, v: unknown) => ({ equal: [f, v] }), limit: (n: number) => ({ limit: n }) },
  ID: { unique: (() => { let n = 0; return () => `id-${n++}`; })() },
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { databases } from '../lib/appwrite';
import { projectRepoRepository as repo } from './projectRepoRepository';

const mockList = databases.listDocuments as jest.Mock;
const mockCreate = databases.createDocument as jest.Mock;
const mockDelete = databases.deleteDocument as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('projectRepoRepository', () => {
  it('listRepoIds returns the repoId of each binding for the project', async () => {
    mockList.mockResolvedValue({ documents: [
      { $id: 'b1', projectId: 'p1', repoId: 'r1', repoUrl: 'u1' },
      { $id: 'b2', projectId: 'p1', repoId: 'r2', repoUrl: 'u2' },
    ] });
    expect(await repo.listRepoIds('p1')).toEqual(['r1', 'r2']);
  });

  it('setBindings replaces the project set — deletes existing then creates the new ones', async () => {
    mockList.mockResolvedValue({ documents: [{ $id: 'old1' }, { $id: 'old2' }] });
    mockCreate.mockImplementation(async (_db, _col, _id, body) => ({ $id: 'new', ...body }));

    await repo.setBindings('p1', [
      { repoId: 'r1', repoUrl: 'u1' },
      { repoId: 'r2', repoUrl: 'u2' },
    ]);

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const createdRepoIds = mockCreate.mock.calls.map((c) => c[3].repoId);
    expect(createdRepoIds).toEqual(['r1', 'r2']);
  });

  it('setBindings to an empty list clears the project bindings', async () => {
    mockList.mockResolvedValue({ documents: [{ $id: 'old1' }] });
    await repo.setBindings('p1', []);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
