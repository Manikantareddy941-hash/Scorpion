import { slaAttainment, FindingRecord } from './feedbackMetrics';

const H = 3600_000;
const NOW = 1_000 * H; // arbitrary fixed clock so nothing depends on wall time

// SLA windows (shared/sla.ts): critical 24h, high 72h, medium 168h, low 720h.
const f = (over: Partial<FindingRecord> & { severity: string }): FindingRecord => ({
  scanner: 'semgrep', status: 'open', createdAt: NOW - 1 * H, ...over,
});

const bySeverity = (rows: ReturnType<typeof slaAttainment>, severity: string) =>
  rows.find((r) => r.severity === severity)!;

test('reports the SLA target per severity', () => {
  const rows = slaAttainment([], NOW);
  expect(bySeverity(rows, 'critical').targetHours).toBe(24);
  expect(bySeverity(rows, 'high').targetHours).toBe(72);
  expect(bySeverity(rows, 'medium').targetHours).toBe(168);
  expect(bySeverity(rows, 'low').targetHours).toBe(720);
});

test('counts a finding resolved inside its window as met', () => {
  const rows = slaAttainment(
    [f({ severity: 'critical', status: 'resolved', createdAt: NOW - 30 * H, resolvedAt: NOW - 20 * H })],
    NOW,
  );
  const crit = bySeverity(rows, 'critical');
  expect(crit.met).toBe(1);
  expect(crit.breached).toBe(0);
  expect(crit.attainment).toBe(1);
  expect(crit.mttrMs).toBe(10 * H);
});

test('counts a finding resolved after its window as breached', () => {
  const rows = slaAttainment(
    [f({ severity: 'critical', status: 'resolved', createdAt: NOW - 60 * H, resolvedAt: NOW - 10 * H })],
    NOW,
  );
  const crit = bySeverity(rows, 'critical');
  expect(crit.met).toBe(0);
  expect(crit.breached).toBe(1);
  expect(crit.attainment).toBe(0);
});

test('an open finding already past its window counts as breached, not pending', () => {
  // Still unresolved and overdue is the worst case; excluding it would flatter
  // the number precisely when remediation is failing.
  const rows = slaAttainment([f({ severity: 'critical', createdAt: NOW - 48 * H })], NOW);
  const crit = bySeverity(rows, 'critical');
  expect(crit.breached).toBe(1);
  expect(crit.open).toBe(0);
});

test('an open finding still inside its window is pending, not counted either way', () => {
  const rows = slaAttainment([f({ severity: 'critical', createdAt: NOW - 2 * H })], NOW);
  const crit = bySeverity(rows, 'critical');
  expect(crit.open).toBe(1);
  expect(crit.met).toBe(0);
  expect(crit.breached).toBe(0);
  // Nothing decided yet -> no attainment figure to report.
  expect(crit.attainment).toBeNull();
});

test('attainment is null rather than 0 when nothing has been decided', () => {
  // 0 would render as "0% of SLAs met" — a failing grade invented from no data.
  // This is the same lie as an empty findings list reading as "all clear".
  const rows = slaAttainment([], NOW);
  for (const row of rows) {
    expect(row.attainment).toBeNull();
    expect(row.mttrMs).toBeNull();
  }
});

test('mttr is null when nothing of that severity has been resolved', () => {
  const rows = slaAttainment([f({ severity: 'high' })], NOW);
  expect(bySeverity(rows, 'high').mttrMs).toBeNull();
});

test('attainment mixes met and breached across the same severity', () => {
  const rows = slaAttainment(
    [
      f({ severity: 'high', status: 'resolved', createdAt: NOW - 100 * H, resolvedAt: NOW - 90 * H }), // 10h, met
      f({ severity: 'high', status: 'resolved', createdAt: NOW - 100 * H, resolvedAt: NOW - 10 * H }), // 90h, breached
      f({ severity: 'high', createdAt: NOW - 1 * H }),                                                 // pending
    ],
    NOW,
  );
  const high = bySeverity(rows, 'high');
  expect(high.met).toBe(1);
  expect(high.breached).toBe(1);
  expect(high.open).toBe(1);
  expect(high.attainment).toBe(0.5); // pending is excluded from the ratio
});

test('an unrecognised severity is bucketed without inventing a target', () => {
  const rows = slaAttainment([f({ severity: 'INFORMATIONAL' })], NOW);
  // Unknown severities fall back to the medium window rather than being dropped
  // silently — a finding that vanishes from the report is worse than one in the
  // wrong bucket.
  const bucket = rows.find((r) => r.severity === 'medium');
  expect(bucket && bucket.open).toBe(1);
});

test('severity casing does not split a bucket', () => {
  const rows = slaAttainment([f({ severity: 'CRITICAL' }), f({ severity: 'critical' })], NOW);
  expect(bySeverity(rows, 'critical').open).toBe(2);
});
