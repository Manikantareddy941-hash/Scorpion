import { describeDb, truncateAll } from '../db/testDb';
import { closePool } from '../db/pool';
import { getScanResult, recordScanResult, summarizeSeverity } from './scanAudit';

describe('summarizeSeverity', () => {
  it('counts packages per lowercased severity', () => {
    const counts = summarizeSeverity([
      { severity: 'HIGH' }, { severity: 'high' }, { severity: 'Low' },
    ] as never);
    expect(counts).toEqual({ total: 3, bySeverity: { high: 2, low: 1 } });
  });

  it('buckets a missing severity as unknown', () => {
    expect(summarizeSeverity([{}] as never).bySeverity).toEqual({ unknown: 1 });
  });
});

// These run against the same Postgres the repositories use. Before this change
// the table lived only in the Prisma schema, which nothing applies to Postgres —
// so every write here failed with `relation "ScanResult" does not exist`.
describeDb('scanAudit (postgres)', () => {
  beforeEach(() => truncateAll(['scan_results']));
  afterAll(() => closePool());

  it('records a scan result and reads it back', async () => {
    const counts = { total: 2, bySeverity: { critical: 1, low: 1 } };
    await recordScanResult('sha256:abc', counts);
    expect(await getScanResult('sha256:abc')).toEqual({
      imageDigest: 'sha256:abc',
      reachabilityCounts: counts,
    });
  });

  it('returns null for an unknown digest', async () => {
    expect(await getScanResult('sha256:nope')).toBeNull();
  });

  it('upserts by digest — a re-scan overwrites rather than duplicating', async () => {
    await recordScanResult('sha256:abc', { total: 1, bySeverity: { low: 1 } });
    await recordScanResult('sha256:abc', { total: 9, bySeverity: { critical: 9 } });
    const found = await getScanResult('sha256:abc');
    expect(found?.reachabilityCounts.total).toBe(9);
  });
});
