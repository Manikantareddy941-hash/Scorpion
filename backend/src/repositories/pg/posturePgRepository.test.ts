import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { posturePgRepository } from './posturePgRepository';

describeDb('posturePgRepository', () => {
  beforeEach(() => truncateAll(['posture_snapshots']));
  afterAll(() => closePool());

  it('saves snapshots and lists them back', async () => {
    await posturePgRepository.saveSnapshot([
      { namespace: 'prod', score: 80, findings: [] },
      { namespace: 'dev', score: 55, findings: [] },
    ]);
    const snaps = await posturePgRepository.listSnapshots();
    expect(snaps).toHaveLength(2);
    expect(snaps.map(s => s.namespace).sort()).toEqual(['dev', 'prod']);
  });

  it('upserts by namespace — second save overwrites the score', async () => {
    await posturePgRepository.saveSnapshot([{ namespace: 'prod', score: 80, findings: [] }]);
    await posturePgRepository.saveSnapshot([{ namespace: 'prod', score: 42, findings: [] }]);
    const snaps = await posturePgRepository.listSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].score).toBe(42);
  });

  it('preserves the findings payload as structured JSON', async () => {
    const findings = [{ id: 'POD-1', severity: 'high', message: 'privileged container' }] as never;
    await posturePgRepository.saveSnapshot([{ namespace: 'prod', score: 30, findings }]);
    expect((await posturePgRepository.listSnapshots())[0].findings).toEqual(findings);
  });
});
