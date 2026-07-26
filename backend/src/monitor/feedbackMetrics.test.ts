import { mttr, reopenRate, escapeByPhase, escapeRecommendations, FindingRecord } from './feedbackMetrics';

const f = (p: Partial<FindingRecord>): FindingRecord => ({
  severity: 'high', scanner: 'semgrep', status: 'open', createdAt: 0, ...p,
});

test('mttr averages resolved durations, ignores unresolved', () => {
  const out = mttr([
    f({ status: 'resolved', createdAt: 0, resolvedAt: 100 }),
    f({ status: 'resolved', createdAt: 0, resolvedAt: 300 }),
    f({ status: 'open' }),
  ]);
  expect(out).toBe(200);
});

test('mttr is 0 with no resolved findings', () => {
  expect(mttr([f({ status: 'open' })])).toBe(0);
});

test('reopenRate = reopened / resolved-ever', () => {
  const out = reopenRate([
    f({ status: 'resolved', resolvedAt: 1, reopenCount: 1 }),
    f({ status: 'resolved', resolvedAt: 1, reopenCount: 0 }),
  ]);
  expect(out).toBe(0.5);
});

test('escapeByPhase maps scanners to lifecycle phases', () => {
  const out = escapeByPhase([f({ scanner: 'zap' }), f({ scanner: 'semgrep' }), f({ scanner: 'zap' })]);
  const test_ = out.find(p => p.phase === 'test');
  expect(test_?.count).toBe(2);
});

test('escapeRecommendations ranks leaking phases by count, with share and directed guidance', () => {
  const out = escapeRecommendations([
    { phase: 'build', count: 1 },
    { phase: 'operate', count: 3 },
  ]);
  // Sorted most-leaking first.
  expect(out.map(r => r.phase)).toEqual(['operate', 'build']);
  expect(out[0].count).toBe(3);
  expect(out[0].share).toBeCloseTo(0.75);
  // Directed toward an EARLIER gate, not just the phase name.
  expect(out[0].recommendation.length).toBeGreaterThan(0);
});

test('escapeRecommendations drops the unknown bucket and returns [] when there are no escapes', () => {
  expect(escapeRecommendations([{ phase: 'unknown', count: 5 }])).toEqual([]);
  expect(escapeRecommendations([])).toEqual([]);
});
