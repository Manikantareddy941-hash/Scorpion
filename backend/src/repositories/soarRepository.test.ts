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

  it('skips a malformed row but returns its valid sibling', async () => {
    mocked.listDocuments.mockResolvedValue({
      total: 2,
      documents: [
        { $id: 'pb-bad', name: 'Broken', enabled: true, trigger: 'not json', actions: '[]' },
        {
          $id: 'pb-1', name: 'Shell response', enabled: true,
          trigger: JSON.stringify({ rulePattern: 'Terminal*', minPriority: 'Warning' }),
          actions: JSON.stringify([{ type: 'kill_pod', mode: 'approval' }]),
        },
      ],
    } as never);
    const out = await soarRepository.listPlaybooks();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('pb-1');
  });
});

describe('soarRepository playbook mutations', () => {
  const draft = {
    name: 'Shell response', enabled: true,
    trigger: { rulePattern: 'Terminal*', minPriority: 'Warning' as const },
    actions: [{ type: 'kill_pod' as const, mode: 'approval' as const }],
  };

  it('createPlaybook stringifies trigger/actions and returns id', async () => {
    mocked.createDocument.mockResolvedValue({ $id: 'pb-9' } as never);
    const out = await soarRepository.createPlaybook(draft);
    expect(out).toEqual({ ...draft, id: 'pb-9' });
    expect(mocked.createDocument).toHaveBeenCalledWith('test-db', 'playbooks', 'new-id', {
      name: draft.name, enabled: true,
      trigger: JSON.stringify(draft.trigger),
      actions: JSON.stringify(draft.actions),
    });
  });

  it('createPlaybook rethrows on Appwrite failure', async () => {
    mocked.createDocument.mockRejectedValue(new Error('down'));
    await expect(soarRepository.createPlaybook(draft)).rejects.toThrow('down');
  });

  it('updatePlaybook patches only provided fields', async () => {
    mocked.updateDocument.mockResolvedValue({} as never);
    await soarRepository.updatePlaybook('pb-1', { enabled: false });
    expect(mocked.updateDocument).toHaveBeenCalledWith('test-db', 'playbooks', 'pb-1', { enabled: false });
  });

  it('updatePlaybook rethrows on Appwrite failure', async () => {
    mocked.updateDocument.mockRejectedValue(new Error('down'));
    await expect(soarRepository.updatePlaybook('pb-1', { enabled: false })).rejects.toThrow('down');
  });
});

describe('soarRepository actions', () => {
  it('createAction stamps createdAt and round-trips ownerUserId', async () => {
    mocked.createDocument.mockResolvedValue({ $id: 'act-1' } as never);
    const rec = await soarRepository.createAction({
      incidentId: 'inc-1', actionType: 'kill_pod', playbookId: 'pb-1', playbookName: 'Shell response',
      status: 'pending', containerImage: 'img', falcoRule: 'Terminal shell in container',
      namespace: 'prod', podName: 'web-1', ownerUserId: 'user-42',
    });
    expect(rec.id).toBe('act-1');
    expect(rec.createdAt).toBeTruthy();
    expect(rec.ownerUserId).toBe('user-42');
    expect(mocked.createDocument).toHaveBeenCalledWith('test-db', 'soar_actions', 'new-id',
      expect.objectContaining({ ownerUserId: 'user-42' }));
  });

  it('getAction surfaces ownerUserId from the document', async () => {
    mocked.getDocument.mockResolvedValue({
      $id: 'act-1', incidentId: 'inc-1', actionType: 'kill_pod', playbookId: 'pb-1',
      playbookName: 'Shell response', status: 'pending', containerImage: 'img',
      falcoRule: 'r', createdAt: '2026-07-04T00:00:00.000Z', ownerUserId: 'user-42',
    } as never);
    const rec = await soarRepository.getAction('act-1');
    expect(rec?.ownerUserId).toBe('user-42');
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

  it('createAction rethrows on Appwrite failure', async () => {
    mocked.createDocument.mockRejectedValue(new Error('down'));
    await expect(soarRepository.createAction({
      incidentId: 'inc-1', actionType: 'kill_pod', playbookId: 'pb-1', playbookName: 'Shell response',
      status: 'pending', containerImage: 'img', falcoRule: 'Terminal shell in container',
    })).rejects.toThrow('down');
  });

  it('setActionStatus rethrows on Appwrite failure', async () => {
    mocked.updateDocument.mockRejectedValue(new Error('down'));
    await expect(soarRepository.setActionStatus('act-1', 'failed')).rejects.toThrow('down');
  });

  it('listActions filters by status', async () => {
    mocked.listDocuments.mockResolvedValue({
      total: 1,
      documents: [{
        $id: 'act-1', incidentId: 'inc-1', actionType: 'kill_pod', playbookId: 'pb-1',
        playbookName: 'Shell response', status: 'pending', containerImage: 'img',
        falcoRule: 'Terminal shell in container', createdAt: '2026-07-04T00:00:00.000Z',
      }],
    } as never);
    const out = await soarRepository.listActions('pending');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('act-1');
    expect(mocked.listDocuments).toHaveBeenCalledWith('test-db', 'soar_actions',
      expect.arrayContaining([{ equal: ['status', 'pending'] }]));
  });

  it('listActions returns [] when Appwrite is down (fail-secure)', async () => {
    mocked.listDocuments.mockRejectedValue(new Error('down'));
    await expect(soarRepository.listActions()).resolves.toEqual([]);
  });
});
