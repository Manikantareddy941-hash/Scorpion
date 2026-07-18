import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { correlationPgRepository } from './correlationPgRepository';
import type { Correlation } from '../../monitor/securityEvent.types';

const correlation: Correlation = {
  ruleId: 'recon-to-exploit',
  title: 'recon-to-exploit',
  severity: 'high',
  correlationKey: '10.0.0.5',
  bucket: 1752900000000,
  matchedEventIds: ['ev-1', 'ev-2'],
  ownerUserId: 'user-a',
};

describeDb('correlationPgRepository', () => {
  beforeEach(() => truncateAll(['correlations', 'correlation_rule_states']));
  afterAll(() => closePool());

  it('wasFired is false before recordFired and true after', async () => {
    const { ownerUserId, ruleId, correlationKey, bucket } = correlation;
    expect(await correlationPgRepository.wasFired(ownerUserId, ruleId, correlationKey, bucket)).toBe(false);
    await correlationPgRepository.recordFired(correlation, 'inc-1');
    expect(await correlationPgRepository.wasFired(ownerUserId, ruleId, correlationKey, bucket)).toBe(true);
  });

  it('wasFired is scoped per owner — one tenant firing does not suppress another', async () => {
    await correlationPgRepository.recordFired(correlation, 'inc-1');
    const { ruleId, correlationKey, bucket } = correlation;
    expect(await correlationPgRepository.wasFired('user-b', ruleId, correlationKey, bucket)).toBe(false);
  });

  it('wasFired is scoped per bucket — a later window fires again', async () => {
    await correlationPgRepository.recordFired(correlation, 'inc-1');
    const { ownerUserId, ruleId, correlationKey, bucket } = correlation;
    expect(await correlationPgRepository.wasFired(ownerUserId, ruleId, correlationKey, bucket + 1)).toBe(false);
  });

  it('listFired returns the correlation with its incident id and matched events', async () => {
    await correlationPgRepository.recordFired(correlation, 'inc-1');
    const [found] = await correlationPgRepository.listFired('owner', 'user-a');
    expect(found.incidentId).toBe('inc-1');
    expect(found.matchedEventIds).toEqual(['ev-1', 'ev-2']);
    expect(found.bucket).toBe(correlation.bucket); // BIGINT comes back as string — must be numeric
    expect(found.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('listFired only returns the requested owner rows', async () => {
    await correlationPgRepository.recordFired(correlation, 'inc-1');
    await correlationPgRepository.recordFired({ ...correlation, ownerUserId: 'user-b' }, 'inc-2');
    expect(await correlationPgRepository.listFired('owner', 'user-a')).toHaveLength(1);
  });

  it('upsertRuleState inserts then updates in place', async () => {
    await correlationPgRepository.upsertRuleState('user-a', { id: 'rule-1', enabled: false });
    await correlationPgRepository.upsertRuleState('user-a', {
      id: 'rule-1', enabled: true, severityOverride: 'critical',
    });
    const states = await correlationPgRepository.listRuleStates('user-a');
    expect(states).toEqual([{ id: 'rule-1', enabled: true, severityOverride: 'critical' }]);
  });

  it('listRuleStates is owner-scoped', async () => {
    await correlationPgRepository.upsertRuleState('user-a', { id: 'rule-1', enabled: false });
    expect(await correlationPgRepository.listRuleStates('user-b')).toEqual([]);
  });
});
