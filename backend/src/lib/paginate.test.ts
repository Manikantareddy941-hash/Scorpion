jest.mock('./appwrite', () => ({
  databases: { listDocuments: jest.fn() },
  DB_ID: 'db',
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    limit: (n: number) => ({ limit: n }),
    offset: (n: number) => ({ offset: n }),
  },
}));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { fetchAllDocuments } from './paginate';
import { databases } from './appwrite';
import { logger } from '../services/logger';

const listDocuments = databases.listDocuments as jest.Mock;

const page = (n: number, total: number) => ({
  total,
  documents: Array.from({ length: n }, (_, i) => ({ $id: `d${i}` })),
});

beforeEach(() => {
  listDocuments.mockReset();
  (logger.warn as jest.Mock).mockReset();
});

test('returns everything when it fits in one page', async () => {
  listDocuments.mockResolvedValueOnce(page(3, 3));

  const res = await fetchAllDocuments('scans', []);

  expect(res.items).toHaveLength(3);
  expect(res.total).toBe(3);
  expect(res.truncated).toBe(false);
  expect(listDocuments).toHaveBeenCalledTimes(1);
});

test('pages to completion rather than stopping at the first page', async () => {
  // The whole point: a single call would have silently returned 100 of 250 and
  // any aggregate over it would be wrong while looking complete.
  listDocuments
    .mockResolvedValueOnce(page(100, 250))
    .mockResolvedValueOnce(page(100, 250))
    .mockResolvedValueOnce(page(50, 250));

  const res = await fetchAllDocuments('scans', []);

  expect(res.items).toHaveLength(250);
  expect(res.truncated).toBe(false);
  expect(listDocuments).toHaveBeenCalledTimes(3);
});

test('advances the offset between pages', async () => {
  listDocuments.mockResolvedValueOnce(page(100, 150)).mockResolvedValueOnce(page(50, 150));

  await fetchAllDocuments('scans', []);

  expect(listDocuments.mock.calls[0][2]).toContainEqual({ offset: 0 });
  expect(listDocuments.mock.calls[1][2]).toContainEqual({ offset: 100 });
});

test('preserves the caller filters on every page', async () => {
  listDocuments.mockResolvedValueOnce(page(100, 150)).mockResolvedValueOnce(page(50, 150));

  await fetchAllDocuments('scans', [{ equal: ['repo_id', ['r1']] } as unknown as string]);

  // Losing the filter on page 2 would pull in other tenants' rows.
  for (const call of listDocuments.mock.calls) {
    expect(call[2]).toContainEqual({ equal: ['repo_id', ['r1']] });
  }
});

test('reports truncated — and says so loudly — when the safety cap is hit', async () => {
  listDocuments.mockResolvedValue(page(100, 100_000));

  const res = await fetchAllDocuments('scans', [], { maxItems: 300 });

  expect(res.truncated).toBe(true);
  expect(res.items).toHaveLength(300);
  // Silent truncation is the defect this helper exists to remove.
  const warned = (logger.warn as jest.Mock).mock.calls.find(
    (c) => (c[1] as { event?: string })?.event === 'read_truncated',
  );
  expect(warned).toBeTruthy();
});

test('stops when a page comes back short, without looping forever', async () => {
  // Defensive: a backend reporting a total it cannot deliver must not spin.
  listDocuments.mockResolvedValueOnce(page(10, 999));

  const res = await fetchAllDocuments('scans', []);

  expect(res.items).toHaveLength(10);
  expect(listDocuments).toHaveBeenCalledTimes(1);
});

test('an empty collection is not truncated', async () => {
  listDocuments.mockResolvedValueOnce(page(0, 0));

  const res = await fetchAllDocuments('scans', []);

  expect(res.items).toEqual([]);
  expect(res.truncated).toBe(false);
});
