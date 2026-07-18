import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { suppressionPgRepository } from './suppressionPgRepository';

describeDb('suppressionPgRepository', () => {
  beforeEach(() => truncateAll(['suppression_rules']));
  afterAll(() => closePool());

  it('creates and lists rules scoped to an owner', async () => {
    await suppressionPgRepository.create('owner-1', { matchType: 'ruleId', matchValue: 'CVE-2021-1', reason: 'accepted' });
    await suppressionPgRepository.create('owner-2', { matchType: 'ruleId', matchValue: 'CVE-2021-2' });
    const mine = await suppressionPgRepository.listForOwner('owner-1');
    expect(mine).toHaveLength(1);
    expect(mine[0].matchValue).toBe('CVE-2021-1');
    expect(mine[0].reason).toBe('accepted');
  });

  it('round-trips the optional expiresAt as a number', async () => {
    await suppressionPgRepository.create('owner-1', { matchType: 'severity', matchValue: 'openssl', expiresAt: 1893456000000 });
    expect((await suppressionPgRepository.listForOwner('owner-1'))[0].expiresAt).toBe(1893456000000);
  });

  it('remove enforces the owner tenancy guard', async () => {
    const rule = await suppressionPgRepository.create('owner-1', { matchType: 'ruleId', matchValue: 'CVE-2021-3' });
    expect(await suppressionPgRepository.remove('someone-else', rule.id)).toBe(false);
    expect(await suppressionPgRepository.listForOwner('owner-1')).toHaveLength(1);
    expect(await suppressionPgRepository.remove('owner-1', rule.id)).toBe(true);
    expect(await suppressionPgRepository.listForOwner('owner-1')).toHaveLength(0);
  });
});
