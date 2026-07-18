import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { repoPgRepository } from './repoPgRepository';

describeDb('repoPgRepository', () => {
  beforeEach(() => truncateAll(['app_repositories', 'app_scans']));
  afterAll(() => closePool());

  it('creates a repo and returns an Appwrite-shaped document', async () => {
    const doc = await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://github.com/a/b', name: 'b' });
    expect(doc.$id).toBeTruthy();
    expect(doc.url).toBe('https://github.com/a/b');
  });

  it('findByOwnershipAndUrl scopes by dynamic field + url', async () => {
    await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://x/1' });
    await repoPgRepository.createRepo({ user_id: 'u2', url: 'https://x/1' });
    const found = await repoPgRepository.findByOwnershipAndUrl('user_id', 'u1', 'https://x/1');
    expect(found.total).toBe(1);
    expect(found.documents[0].user_id).toBe('u1');
  });

  it('updateRepo merges fields; getRepo returns them; deleteRepo removes', async () => {
    const doc = await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://x/2', name: 'old' });
    await repoPgRepository.updateRepo(doc.$id, { name: 'new' });
    const fetched = await repoPgRepository.getRepo(doc.$id);
    expect(fetched.name).toBe('new');
    expect(fetched.url).toBe('https://x/2');
    await repoPgRepository.deleteRepo(doc.$id);
    await expect(repoPgRepository.getRepo(doc.$id)).rejects.toThrow('document not found');
  });

  it('listByScope orders by updated_at descending', async () => {
    await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://x/old', updated_at: '2026-01-01T00:00:00Z' });
    await repoPgRepository.createRepo({ user_id: 'u1', url: 'https://x/new', updated_at: '2026-06-01T00:00:00Z' });
    const list = await repoPgRepository.listByScope('user_id', 'u1');
    expect(list.documents[0].url).toBe('https://x/new');
  });

  it('findActiveScan matches pending or running scans for a repo', async () => {
    await repoPgRepository.createScan({ repo_id: 'r1', status: 'done' });
    expect((await repoPgRepository.findActiveScan('r1')).total).toBe(0);
    await repoPgRepository.createScan({ repo_id: 'r1', status: 'running' });
    expect((await repoPgRepository.findActiveScan('r1')).total).toBe(1);
  });

  it('getScan round-trips a created scan', async () => {
    const scan = await repoPgRepository.createScan({ repo_id: 'r1', status: 'pending' });
    expect((await repoPgRepository.getScan(scan.$id)).status).toBe('pending');
  });

  it('listScans filters to the given repos, newest first', async () => {
    await repoPgRepository.createScan({ repo_id: 'r1', status: 'completed' });
    await repoPgRepository.createScan({ repo_id: 'r2', status: 'completed' });
    await repoPgRepository.createScan({ repo_id: 'other-tenant', status: 'completed' });

    const list = await repoPgRepository.listScans(['r1', 'r2'], undefined, 50);

    expect(list.total).toBe(2);
    expect(list.documents.map(d => d.repo_id).sort()).toEqual(['r1', 'r2']);
  });

  it('listScans applies the status filter', async () => {
    await repoPgRepository.createScan({ repo_id: 'r1', status: 'completed' });
    await repoPgRepository.createScan({ repo_id: 'r1', status: 'failed' });

    const list = await repoPgRepository.listScans(['r1'], 'completed', 50);

    expect(list.total).toBe(1);
    expect(list.documents[0].status).toBe('completed');
  });

  it('listScans returns nothing for an empty repo list rather than every scan', async () => {
    await repoPgRepository.createScan({ repo_id: 'r1', status: 'completed' });
    expect((await repoPgRepository.listScans([], undefined, 50)).total).toBe(0);
  });

  it('listScans honours the limit', async () => {
    for (let i = 0; i < 5; i++) await repoPgRepository.createScan({ repo_id: 'r1', status: 'completed' });
    expect((await repoPgRepository.listScans(['r1'], undefined, 2)).total).toBe(2);
  });
});
