import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { DEFAULT_POD_SECURITY_CONFIG, PodSecurityConfig } from '../../services/podSecurityService';
import { podSecurityPgRepository } from './podSecurityPgRepository';
import { bufferConfig } from '../podSecurityShared';

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

  it('flushFallback returns 0 when nothing is buffered', async () => {
    expect(await podSecurityPgRepository.flushFallback()).toBe(0);
  });

  /**
   * This replaces an assertion that flushFallback "is a no-op returning 0",
   * which pinned the stub as if it were the contract. It was not: the Appwrite
   * implementation buffers to local JSON on failure and replays it, and this one
   * returned 0 unconditionally, so anything buffered while Postgres was down
   * stayed buffered forever.
   */
  it('flushFallback replays a buffered config into Postgres', async () => {
    const config: PodSecurityConfig = {
      ...DEFAULT_POD_SECURITY_CONFIG,
      allowedRegistries: ['buffered.example.com'],
    };
    await bufferConfig('buffered-user', config);

    expect(await podSecurityPgRepository.flushFallback()).toBe(1);
    expect(await podSecurityPgRepository.get('buffered-user')).toEqual(config);

    // Drained, so a second pass has nothing left to do.
    expect(await podSecurityPgRepository.flushFallback()).toBe(0);
  });
});
