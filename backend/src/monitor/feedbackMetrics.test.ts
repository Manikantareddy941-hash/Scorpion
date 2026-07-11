import { mttr, reopenRate, escapeByPhase, FindingRecord } from './feedbackMetrics';

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
