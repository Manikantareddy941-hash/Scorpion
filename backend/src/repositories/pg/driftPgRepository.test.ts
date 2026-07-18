import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { driftPgRepository } from './driftPgRepository';
import type { DriftAnomaly } from '../../workers/driftMonitor';

const anomaly: DriftAnomaly = {
  driftType: 'unscanned-image',
  namespace: 'prod',
  podName: 'api-7d9f',
  containerName: 'api',
  image: 'ghcr.io/acme/api:1.4.0',
  imageDigest: 'sha256:aaa',
  env: 'prod',
  gateStatus: 'warning',
  reason: 'no scan record for this digest',
  severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
};

describeDb('driftPgRepository', () => {
  beforeEach(() => truncateAll(['drift_anomalies']));
  afterAll(() => closePool());

  it('saves an anomaly and lists it back with derived severity', async () => {
    const saved = await driftPgRepository.save(anomaly);
    const [found] = await driftPgRepository.listActive();
    expect(found.id).toBe(saved.id);
    expect(found.severity).toBe('medium'); // no counts + not gate-violation
    expect(found.severityRank).toBe(2);
    expect(found.active).toBe(true);
  });

  it('preserves severityCounts as structured JSON', async () => {
    const counts = { critical: 2, high: 1, medium: 0, low: 0 };
    await driftPgRepository.save({ ...anomaly, severityCounts: counts });
    const [found] = await driftPgRepository.listActive();
    expect(found.severityCounts).toEqual(counts);
    expect(found.severity).toBe('critical'); // highest severity actually present
  });

  it('maps an absent previousDigest to undefined, not null', async () => {
    await driftPgRepository.save(anomaly);
    expect((await driftPgRepository.listActive())[0].previousDigest).toBeUndefined();
  });

  it('orders by severity rank first, then recency', async () => {
    await driftPgRepository.save({ ...anomaly, severityCounts: { critical: 0, high: 0, medium: 0, low: 1 } });
    await driftPgRepository.save({ ...anomaly, severityCounts: { critical: 1, high: 0, medium: 0, low: 0 } });
    expect((await driftPgRepository.listActive()).map(r => r.severity)).toEqual(['critical', 'low']);
  });

  it('filters by driftType and severity', async () => {
    await driftPgRepository.save(anomaly);
    await driftPgRepository.save({ ...anomaly, driftType: 'gate-violation' });
    expect(await driftPgRepository.listActive({ driftType: 'gate-violation' })).toHaveLength(1);
    expect(await driftPgRepository.listActive({ severity: 'high' })).toHaveLength(1); // gate-violation → high
    expect(await driftPgRepository.listActive({ severity: 'critical' })).toHaveLength(0);
  });

  it('clamps the limit to at least 1', async () => {
    await driftPgRepository.save(anomaly);
    await driftPgRepository.save(anomaly);
    expect(await driftPgRepository.listActive({ limit: 0 })).toHaveLength(1);
  });
});
