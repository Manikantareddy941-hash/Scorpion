import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { DEFAULT_POD_SECURITY_CONFIG, PodSecurityConfig } from '../../services/podSecurityService';
import { podSecurityPgRepository } from './podSecurityPgRepository';

describeDb('podSecurityPgRepository', () => {
  beforeEach(() => truncateAll(['pod_security_rules']));
  afterAll(() => closePool());

  it('returns the default config for an unknown user', async () => {
    expect(await podSecurityPgRepository.get('nobody')).toEqual(DEFAULT_POD_SECURITY_CONFIG);
  });

  it('save then get round-trips and upserts', async () => {
    const config: PodSecurityConfig = {
      ...DEFAULT_POD_SECURITY_CONFIG,
      allowedRegistries: ['registry.example.com'],
    };
    await podSecurityPgRepository.save('system', config);
    expect(await podSecurityPgRepository.get('system')).toEqual(config);

    const updated: PodSecurityConfig = { ...config, requiredLabels: ['app'] };
    await podSecurityPgRepository.save('system', updated);
    expect((await podSecurityPgRepository.get('system')).requiredLabels).toEqual(['app']);
  });

  it('flushFallback is a no-op returning 0', async () => {
    expect(await podSecurityPgRepository.flushFallback()).toBe(0);
  });
});
