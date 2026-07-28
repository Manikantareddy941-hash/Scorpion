import { groupFindingsByCve } from './cveGrouping';

const f = (over: Record<string, unknown>) => ({
  $id: 'f1', ruleId: 'CVE-2021-44228', severity: 'critical', status: 'open', repo_id: 'r1', ...over,
});

test('groups the same advisory across different repositories', () => {
  const clusters = groupFindingsByCve([
    f({ $id: 'f1', repo_id: 'r1' }),
    f({ $id: 'f2', repo_id: 'r2' }),
    f({ $id: 'f3', repo_id: 'r3' }),
  ]);

  expect(clusters).toHaveLength(1);
  expect(clusters[0].cveId).toBe('CVE-2021-44228');
  expect(clusters[0].findingCount).toBe(3);
  expect(clusters[0].repoIds.sort()).toEqual(['r1', 'r2', 'r3']);
});

test('recognises the other advisory prefixes, not just CVE', () => {
  const clusters = groupFindingsByCve([
    f({ $id: 'a', ruleId: 'GHSA-jfh8-c2jp-5v3q' }),
    f({ $id: 'b', ruleId: 'RUSTSEC-2021-0073' }),
    f({ $id: 'c', ruleId: 'OSV-2021-1234' }),
  ]);

  expect(clusters.map((c) => c.cveId).sort()).toEqual([
    'GHSA-jfh8-c2jp-5v3q', 'OSV-2021-1234', 'RUSTSEC-2021-0073',
  ]);
});

test('ignores findings whose ruleId is not an advisory id', () => {
  // SAST rules like 'python.lang.security.sql-injection' are real findings but
  // they are not a shared upstream advisory, so grouping them under one epic
  // would merge unrelated work.
  const clusters = groupFindingsByCve([
    f({ $id: 'a', ruleId: 'python.lang.security.sql-injection' }),
    f({ $id: 'b', ruleId: 'generic.secrets.detected' }),
  ]);

  expect(clusters).toEqual([]);
});

test('matches the advisory prefix case-insensitively', () => {
  const clusters = groupFindingsByCve([f({ ruleId: 'cve-2021-44228' })]);
  expect(clusters).toHaveLength(1);
});

test('excludes resolved findings — grouping is for outstanding work', () => {
  const clusters = groupFindingsByCve([
    f({ $id: 'a', status: 'resolved' }),
    f({ $id: 'b', status: 'open' }),
  ]);

  expect(clusters[0].findingCount).toBe(1);
  expect(clusters[0].findingIds).toEqual(['b']);
});

test('a fully resolved advisory produces no cluster at all', () => {
  expect(groupFindingsByCve([f({ status: 'resolved' })])).toEqual([]);
});

test('reports the highest severity present, not the first seen', () => {
  const clusters = groupFindingsByCve([
    f({ $id: 'a', ruleId: 'CVE-1', severity: 'low' }),
    f({ $id: 'b', ruleId: 'CVE-1', severity: 'critical' }),
    f({ $id: 'c', ruleId: 'CVE-1', severity: 'medium' }),
  ]);

  // A cluster is as urgent as its worst instance; averaging or first-wins would
  // let a critical hide behind a low.
  expect(clusters[0].severity).toBe('critical');
});

test('orders by severity, then by how widely the advisory has spread', () => {
  const clusters = groupFindingsByCve([
    f({ $id: 'a', ruleId: 'CVE-LOW', severity: 'low' }),
    f({ $id: 'b', ruleId: 'CVE-HIGH-1', severity: 'high', repo_id: 'r1' }),
    f({ $id: 'c', ruleId: 'CVE-HIGH-2', severity: 'high', repo_id: 'r1' }),
    f({ $id: 'd', ruleId: 'CVE-HIGH-2', severity: 'high', repo_id: 'r2' }),
  ]);

  expect(clusters.map((c) => c.cveId)).toEqual(['CVE-HIGH-2', 'CVE-HIGH-1', 'CVE-LOW']);
});

test('deduplicates repositories within a cluster', () => {
  const clusters = groupFindingsByCve([
    f({ $id: 'a', repo_id: 'r1' }),
    f({ $id: 'b', repo_id: 'r1' }),
  ]);

  expect(clusters[0].repoIds).toEqual(['r1']);
  expect(clusters[0].findingCount).toBe(2);
});

test('a finding without a repo id still counts but adds no repository', () => {
  const clusters = groupFindingsByCve([f({ repo_id: undefined })]);

  expect(clusters[0].findingCount).toBe(1);
  expect(clusters[0].repoIds).toEqual([]);
});

test('tolerates malformed records instead of throwing mid-report', () => {
  expect(groupFindingsByCve([null, undefined, {}, 'nonsense'])).toEqual([]);
});
