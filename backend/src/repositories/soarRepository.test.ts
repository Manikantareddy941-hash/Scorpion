jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    createDocument: jest.fn(),
    getDocument: jest.fn(),
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

import { soarRepository } from './soarRepository';
import { databases } from '../lib/appwrite';

const mocked = databases as jest.Mocked<typeof databases>;

beforeEach(() => jest.clearAllMocks());

describe('soarRepository.listPlaybooks', () => {
  it('parses JSON-string trigger and actions columns', async () => {
    mocked.listDocuments.mockResolvedValue({
      total: 1,
      documents: [{
        $id: 'pb-1', name: 'Shell response', enabled: true,
        trigger: JSON.stringify({ rulePattern: 'Terminal*', minPriority: 'Warning' }),
        actions: JSON.stringify([{ type: 'kill_pod', mode: 'approval' }]),
      }],
    } as never);
    const out = await soarRepository.listPlaybooks();
    expect(out).toEqual([{
      id: 'pb-1', name: 'Shell response', enabled: true,
      trigger: { rulePattern: 'Terminal*', minPriority: 'Warning' },
      actions: [{ type: 'kill_pod', mode: 'approval' }],
    }]);
  });

  it('returns [] when Appwrite is down (fail-secure)', async () => {
    mocked.listDocuments.mockRejectedValue(new Error('down'));
    await expect(soarRepository.listPlaybooks()).resolves.toEqual([]);
  });
});

describe('soarRepository actions', () => {
  it('createAction stamps createdAt and returns the record', async () => {
    mocked.createDocument.mockResolvedValue({ $id: 'act-1' } as never);
    const rec = await soarRepository.createAction({
      incidentId: 'inc-1', actionType: 'kill_pod', playbookId: 'pb-1', playbookName: 'Shell response',
      status: 'pending', containerImage: 'img', falcoRule: 'Terminal shell in container',
      namespace: 'prod', podName: 'web-1',
    });
    expect(rec.id).toBe('act-1');
    expect(rec.createdAt).toBeTruthy();
  });

  it('setActionStatus stamps resolvedAt', async () => {
    mocked.updateDocument.mockResolvedValue({} as never);
    await soarRepository.setActionStatus('act-1', 'executed', { result: 'ok' });
    expect(mocked.updateDocument).toHaveBeenCalledWith('test-db', 'soar_actions', 'act-1',
      expect.objectContaining({ status: 'executed', result: 'ok', resolvedAt: expect.any(String) }));
  });

  it('getAction returns null on not-found', async () => {
    mocked.getDocument.mockRejectedValue(new Error('404'));
    await expect(soarRepository.getAction('missing')).resolves.toBeNull();
  });
});
