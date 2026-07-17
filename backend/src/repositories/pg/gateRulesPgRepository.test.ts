import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { DEFAULT_CONFIG, GateConfig } from '../gateRulesRepository';
import { gateRulesPgRepository } from './gateRulesPgRepository';

describeDb('gateRulesPgRepository', () => {
  beforeEach(() => truncateAll(['gate_rules']));
  afterAll(() => closePool());

  it('returns DEFAULT_CONFIG for an unknown user', async () => {
    expect(await gateRulesPgRepository.get('nobody')).toEqual(DEFAULT_CONFIG);
  });

  it('save then get round-trips a config, scoped per user', async () => {
    const config: GateConfig = {
      rules: [{ id: 'r1', severity: 'critical', threshold: 0, action: 'block', enabled: true }],
      env: 'stage',
    };
    await gateRulesPgRepository.save('user-1', config);
    expect(await gateRulesPgRepository.get('user-1')).toEqual(config);
    expect(await gateRulesPgRepository.get('user-2')).toEqual(DEFAULT_CONFIG);
  });

  it('save is an upsert — second save overwrites', async () => {
    const first: GateConfig = { rules: [], env: 'dev' };
    const second: GateConfig = { rules: [], env: 'prod' };
    await gateRulesPgRepository.save('user-1', first);
    await gateRulesPgRepository.save('user-1', second);
    expect((await gateRulesPgRepository.get('user-1')).env).toBe('prod');
  });

  it('flushFallback is a no-op returning 0', async () => {
    expect(await gateRulesPgRepository.flushFallback()).toBe(0);
  });
});
