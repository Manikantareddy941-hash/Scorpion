jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), createDocument: jest.fn(), deleteDocument: jest.fn(), getDocument: jest.fn() },
  DB_ID: 'db', ID: { unique: () => 'id1' },
  Query: { equal: (f: string, v: unknown) => `${f}=${v}`, limit: (n: number) => `l${n}` },
}));
// Pin the storage facade to its legacy Appwrite path — this suite asserts on
// databases.* calls; the Postgres path is covered by pg/suppressionPgRepository.test.ts.
jest.mock('../db/pool', () => ({ isPostgresEnabled: () => false, getPool: jest.fn(), closePool: jest.fn() }));
import { databases } from '../lib/appwrite';
import { suppressionRepository } from './suppressionRepository';

test('listForOwner maps rows to SuppressionRule[]', async () => {
  (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [
    { $id: 's1', matchType: 'ruleId', matchValue: 'recon-to-exploit', expiresAt: null, reason: 'noisy' },
  ], total: 1 });
  const out = await suppressionRepository.listForOwner('u1');
  expect(out[0]).toEqual({ id: 's1', matchType: 'ruleId', matchValue: 'recon-to-exploit', expiresAt: undefined, reason: 'noisy' });
});

test('listForOwner returns [] on error (nothing suppressed)', async () => {
  (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('down'));
  await expect(suppressionRepository.listForOwner('u1')).resolves.toEqual([]);
});
