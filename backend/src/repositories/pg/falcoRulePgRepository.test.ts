import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { falcoRulePgRepository } from './falcoRulePgRepository';
import { FALCO_TEMPLATES } from '../../runtime/falcoRuleCatalog';
import type { ManagedFalcoRule } from '../../runtime/falcoRuleCatalog';

const template = Object.keys(FALCO_TEMPLATES)[0] as ManagedFalcoRule['template'];

const baseRule: Omit<ManagedFalcoRule, 'id'> = {
  template,
  params: {} as ManagedFalcoRule['params'],
  appScope: undefined,
  severityOverride: undefined,
  suppressed: false,
  enabled: true,
};

describeDb('falcoRulePgRepository', () => {
  beforeEach(() => truncateAll(['falco_rules']));
  afterAll(() => closePool());

  it('creates a rule and lists it back', async () => {
    const created = await falcoRulePgRepository.createRule(baseRule);
    expect(created.id).toBeTruthy();
    const rules = await falcoRulePgRepository.listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].template).toBe(template);
    expect(rules[0].enabled).toBe(true);
  });

  it('updateRule patches only the provided fields', async () => {
    const created = await falcoRulePgRepository.createRule(baseRule);
    await falcoRulePgRepository.updateRule(created.id, { suppressed: true, appScope: 'ns/app' });
    const rule = (await falcoRulePgRepository.listRules())[0];
    expect(rule.suppressed).toBe(true);
    expect(rule.appScope).toBe('ns/app');
    expect(rule.enabled).toBe(true); // untouched
  });

  it('skips rows with an unknown template (fail-secure)', async () => {
    await falcoRulePgRepository.createRule(baseRule);
    await falcoRulePgRepository.updateRule((await falcoRulePgRepository.listRules())[0].id, {});
    // Corrupt the template directly, then confirm the row is skipped, not thrown.
    const { getPool } = await import('../../db/pool');
    await getPool().query(`UPDATE falco_rules SET template = 'nonexistent'`);
    expect(await falcoRulePgRepository.listRules()).toEqual([]);
  });
});
