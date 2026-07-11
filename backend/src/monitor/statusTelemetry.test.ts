import { statusTelemetry } from './statusTelemetry';

beforeEach(() => statusTelemetry.reset());

test('aggregates denied vs total per key in the current minute', () => {
  statusTelemetry.record('1.2.3.4', 200);
  statusTelemetry.record('1.2.3.4', 403);
  statusTelemetry.record('1.2.3.4', 401);
  const snap = statusTelemetry.snapshot().find(b => b.key === '1.2.3.4')!;
  expect(snap.total).toBe(3);
  expect(snap.denied).toBe(2);
});

test('prune drops buckets older than 5 minutes', () => {
  statusTelemetry.record('x', 403);
  statusTelemetry.prune(Date.now() + 6 * 60_000);
  expect(statusTelemetry.snapshot()).toHaveLength(0);
});
