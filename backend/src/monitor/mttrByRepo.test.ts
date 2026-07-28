import { mttrByRepo, FindingRecord } from './feedbackMetrics';

const H = 3600_000;
const NOW = 1_000 * H;

const f = (over: Partial<FindingRecord> & { repoId: string }): FindingRecord => ({
  severity: 'high', scanner: 'semgrep', status: 'open', createdAt: NOW - 1 * H, ...over,
});

const NAMES = { r1: 'api-gateway', r2: 'billing' };

test('groups findings by repo and names them', () => {
  const rows = mttrByRepo([f({ repoId: 'r1' }), f({ repoId: 'r2' })], NAMES, NOW);
  expect(rows.map((r) => r.repoId).sort()).toEqual(['r1', 'r2']);
  expect(rows.find((r) => r.repoId === 'r1')!.name).toBe('api-gateway');
});

test('averages resolution time per repo', () => {
  const rows = mttrByRepo(
    [
      f({ repoId: 'r1', status: 'resolved', createdAt: NOW - 20 * H, resolvedAt: NOW - 10 * H }), // 10h
      f({ repoId: 'r1', status: 'resolved', createdAt: NOW - 30 * H, resolvedAt: NOW - 10 * H }), // 20h
    ],
    NAMES,
    NOW,
  );
  expect(rows[0].mttrMs).toBe(15 * H);
});

test('sorts slowest first — the point is finding the laggard', () => {
  const rows = mttrByRepo(
    [
      f({ repoId: 'r1', status: 'resolved', createdAt: NOW - 20 * H, resolvedAt: NOW - 15 * H }), // 5h
      f({ repoId: 'r2', status: 'resolved', createdAt: NOW - 60 * H, resolvedAt: NOW - 10 * H }), // 50h
    ],
    NAMES,
    NOW,
  );
  expect(rows.map((r) => r.repoId)).toEqual(['r2', 'r1']);
});

test('a repo with nothing resolved reports null mttr, not zero', () => {
  // 0ms would sort as the fastest repo — a backlog nobody has touched would top
  // the leaderboard. Same reason attainment is null in slaAttainment.
  const rows = mttrByRepo([f({ repoId: 'r1' })], NAMES, NOW);
  expect(rows[0].mttrMs).toBeNull();
  expect(rows[0].findingCount).toBe(1);
});

test('repos with no measurable mttr sort last, not first', () => {
  const rows = mttrByRepo(
    [
      f({ repoId: 'r1' }), // nothing resolved -> null
      f({ repoId: 'r2', status: 'resolved', createdAt: NOW - 20 * H, resolvedAt: NOW - 10 * H }),
    ],
    NAMES,
    NOW,
  );
  expect(rows[0].repoId).toBe('r2');
  expect(rows[1].mttrMs).toBeNull();
});

test('counts findings still breaching their SLA per repo', () => {
  const rows = mttrByRepo(
    [
      f({ repoId: 'r1', severity: 'critical', createdAt: NOW - 48 * H }), // 24h target -> breached
      f({ repoId: 'r1', severity: 'low', createdAt: NOW - 48 * H }),      // 720h target -> fine
    ],
    NAMES,
    NOW,
  );
  expect(rows[0].breached).toBe(1);
  expect(rows[0].findingCount).toBe(2);
});

test('a repo id with no name still appears, labelled by its id', () => {
  // Dropping it would hide a repo's backlog because of a missing lookup.
  const rows = mttrByRepo([f({ repoId: 'r-unknown' })], NAMES, NOW);
  expect(rows[0].name).toBe('r-unknown');
});

test('findings without a repo id are ignored rather than bucketed together', () => {
  const rows = mttrByRepo([{ severity: 'high', scanner: 'semgrep', status: 'open', createdAt: NOW }], NAMES, NOW);
  expect(rows).toEqual([]);
});
