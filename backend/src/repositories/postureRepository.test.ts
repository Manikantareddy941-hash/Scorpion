jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    createDocument: jest.fn(),
    updateDocument: jest.fn(),
  },
  DB_ID: 'test-db',
  ID: { unique: () => 'new-id' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    orderDesc: (f: string) => ({ orderDesc: f }),
    limit: (n: number) => ({ limit: n }),
  },
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { postureRepository } from './postureRepository';
import { databases } from '../lib/appwrite';
import type { PostureFinding } from '../posture/postureChecks';

const mocked = databases as jest.Mocked<typeof databases>;

const finding: PostureFinding = {
  checkId: 'latest-image-tag', severity: 'medium', namespace: 'prod',
  resource: 'prod/web-1/app', reason: 'image not pinned',
};

beforeEach(() => jest.clearAllMocks());

describe('postureRepository.saveSnapshot', () => {
  it('creates when no existing doc, updates when one exists', async () => {
    mocked.listDocuments
      .mockResolvedValueOnce({ total: 0, documents: [] } as never)
      .mockResolvedValueOnce({ total: 1, documents: [{ $id: 'doc-1' }] } as never);

    await postureRepository.saveSnapshot([
      { namespace: 'new-ns', score: 100, findings: [] },
      { namespace: 'prod', score: 92, findings: [finding] },
    ]);

    expect(mocked.createDocument).toHaveBeenCalledWith('test-db', 'posture_snapshots', 'new-id',
      expect.objectContaining({ namespace: 'new-ns', score: 100, findings: '[]' }));
    expect(mocked.updateDocument).toHaveBeenCalledWith('test-db', 'posture_snapshots', 'doc-1',
      expect.objectContaining({ namespace: 'prod', score: 92, findings: JSON.stringify([finding]) }));
  });

  it('logs and rethrows on mutation failure', async () => {
    mocked.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never);
    mocked.createDocument.mockRejectedValue(new Error('appwrite down'));

    await expect(postureRepository.saveSnapshot([{ namespace: 'ns', score: 100, findings: [] }]))
      .rejects.toThrow('appwrite down');
  });
});

describe('postureRepository.listSnapshots', () => {
  it('skips malformed rows and keeps valid siblings', async () => {
    mocked.listDocuments.mockResolvedValue({
      total: 2,
      documents: [
        { $id: 'bad', namespace: 'broken', score: 0, findings: '{not json', updatedAt: '2026-01-01T00:00:00Z' },
        { $id: 'ok', namespace: 'prod', score: 92, findings: JSON.stringify([finding]), updatedAt: '2026-01-01T00:00:00Z' },
      ],
    } as never);

    const out = await postureRepository.listSnapshots();
    expect(out).toEqual([{
      namespace: 'prod', score: 92, findings: [finding], updatedAt: '2026-01-01T00:00:00Z',
    }]);
  });

  it('returns [] when Appwrite is down (fail-secure)', async () => {
    mocked.listDocuments.mockRejectedValue(new Error('down'));
    await expect(postureRepository.listSnapshots()).resolves.toEqual([]);
  });
});
