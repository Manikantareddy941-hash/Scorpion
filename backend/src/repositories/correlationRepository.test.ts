jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), createDocument: jest.fn(), updateDocument: jest.fn() },
  DB_ID: 'db', ID: { unique: () => 'id1' },
  Query: { equal: (f: string, v: unknown) => `${f}=${v}`, limit: (n: number) => `limit${n}` },
}));
// Pin the storage facade to its legacy Appwrite path — this suite asserts on
// databases.* calls; the Postgres path is covered by pg/correlationPgRepository.test.ts.
jest.mock('../db/pool', () => ({ isPostgresEnabled: () => false, getPool: jest.fn(), closePool: jest.fn() }));
import { databases } from '../lib/appwrite';
import { correlationRepository } from './correlationRepository';
import type { Correlation } from '../monitor/securityEvent.types';

const c: Correlation = {
  ruleId: 'recon-to-exploit', title: 'x', severity: 'high',
  correlationKey: 'k', bucket: 60000, matchedEventIds: ['e1'], ownerUserId: 'u1',
};

test('wasFired true when a matching row exists', async () => {
  (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [{ $id: 'd1' }], total: 1 });
  await expect(correlationRepository.wasFired('u1', 'recon-to-exploit', 'k', 60000)).resolves.toBe(true);
});

test('recordFired writes to correlations collection', async () => {
  (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'd1' });
  await correlationRepository.recordFired(c, 'inc1');
  expect(databases.createDocument).toHaveBeenCalledWith('db', 'correlations', 'id1',
    expect.objectContaining({ ruleId: 'recon-to-exploit', bucket: 60000, incidentId: 'inc1' }));
});
