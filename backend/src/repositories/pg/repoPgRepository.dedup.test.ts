// Mirrors repoRepository.dedup.test.ts against the Postgres implementation.
// Two implementations of the same lookup drift silently unless both are
// pinned by tests — and a miss here creates a duplicate repo row, splitting a
// tenant's findings across two records for the same repository.
// Pool is mocked, so this needs no database and cannot race the RUN_DB_IT suites.
const query = jest.fn();
jest.mock('../../db/pool', () => ({ getPool: () => ({ query }) }));

import { repoPgRepository } from './repoPgRepository';

const CANONICAL = 'https://github.com/Org/Repo';
const row = (id: string, url: string) => ({ id, data: { url }, created_at: new Date(0) });

beforeEach(() => query.mockReset());

test('an exact URL match short-circuits without scanning the tenant', async () => {
  query.mockResolvedValueOnce({ rowCount: 1, rows: [row('r1', CANONICAL)] });

  const res = await repoPgRepository.findByOwnershipAndUrl('user_id', 'u1', CANONICAL);

  expect(res.total).toBe(1);
  expect(res.documents[0].$id).toBe('r1');
  expect(query).toHaveBeenCalledTimes(1);
});

describe.each([
  ['a .git suffix', 'https://github.com/Org/Repo.git'],
  ['a trailing slash', 'https://github.com/Org/Repo/'],
  ['different casing', 'https://github.com/ORG/REPO'],
  ['an ssh remote', 'git@github.com:Org/Repo.git'],
])('a URL variant with %s', (_label, variant) => {
  test('resolves to the existing repo instead of creating a duplicate', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // exact miss
      .mockResolvedValueOnce({ rowCount: 1, rows: [row('r1', CANONICAL)] }); // owner scan

    const res = await repoPgRepository.findByOwnershipAndUrl('user_id', 'u1', variant);

    expect(res.total).toBe(1);
    expect(res.documents[0].$id).toBe('r1');
  });
});

test('a genuinely different repo does not match', async () => {
  query
    .mockResolvedValueOnce({ rowCount: 0, rows: [] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [row('r1', 'https://github.com/Org/Other')] });

  const res = await repoPgRepository.findByOwnershipAndUrl('user_id', 'u1', CANONICAL);

  expect(res.total).toBe(0);
  expect(res.documents).toEqual([]);
});

test('the fallback scan stays scoped to the caller, never the whole table', async () => {
  query
    .mockResolvedValueOnce({ rowCount: 0, rows: [] })
    .mockResolvedValueOnce({ rowCount: 0, rows: [] });

  await repoPgRepository.findByOwnershipAndUrl('user_id', 'u1', 'https://github.com/Org/Repo.git');

  // Ownership stays a bound parameter — never interpolated, never dropped.
  const [sql, params] = query.mock.calls[1];
  expect(sql).toContain(`data->>$1 = $2`);
  expect(params[0]).toBe('user_id');
  expect(params[1]).toBe('u1');
});

test('an empty url does not fall back and match an arbitrary repo', async () => {
  query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

  const res = await repoPgRepository.findByOwnershipAndUrl('user_id', 'u1', '');

  expect(res.total).toBe(0);
  expect(query).toHaveBeenCalledTimes(1);
});

test('an unsupported ownership field is still rejected before any query', async () => {
  await expect(
    repoPgRepository.findByOwnershipAndUrl('tenant_id', 'x', CANONICAL),
  ).rejects.toThrow(/Unsupported ownership field/);
  expect(query).not.toHaveBeenCalled();
});

test('team_id is a supported ownership field', async () => {
  // repoService.syncRepo passes 'team_id' whenever a team is active, so
  // rejecting it here breaks repo sync outright for every team-scoped user.
  query.mockResolvedValueOnce({ rowCount: 1, rows: [row('r1', CANONICAL)] });

  const res = await repoPgRepository.findByOwnershipAndUrl('team_id', 'team-9', CANONICAL);

  expect(res.total).toBe(1);
  expect(query.mock.calls[0][1]).toEqual(['team_id', 'team-9', CANONICAL]);
});

test('listByScope also accepts team_id', async () => {
  query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

  await expect(repoPgRepository.listByScope('team_id', 'team-9')).resolves.toBeDefined();
});
