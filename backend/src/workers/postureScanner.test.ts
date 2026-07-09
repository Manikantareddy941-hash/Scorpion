// Factory mock scoped to this file: the real package is ESM and unparseable
// under ts-jest CJS; the factory keeps the real module from ever loading.
jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class { loadFromDefault(): void {} makeApiClient(): object { return {}; } },
  CoreV1Api: class {},
  NetworkingV1Api: class {},
}));
jest.mock('../repositories/postureRepository', () => ({
  postureRepository: { saveSnapshot: jest.fn(), listSnapshots: jest.fn() },
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { runPostureScan, ClusterReader } from './postureScanner';
import { postureRepository } from '../repositories/postureRepository';
import { logger } from '../services/logger';

const repo = postureRepository as jest.Mocked<typeof postureRepository>;

beforeEach(() => jest.clearAllMocks());

describe('runPostureScan', () => {
  it('scores each namespace and persists grouped findings', async () => {
    const reader: ClusterReader = {
      readSnapshot: async () => ({
        pods: [{
          namespace: 'prod', podName: 'web-1', serviceAccountName: 'sa',
          automountServiceAccountToken: false, hostPathVolumes: [],
          containers: [{
            name: 'app', image: 'reg/app:latest', privileged: false, runAsNonRoot: true,
            hasCpuLimit: true, hasMemoryLimit: true, envVars: [],
          }],
        }],
        namespaces: [
          { name: 'prod', podCount: 1, networkPolicyCount: 1 },
          { name: 'clean', podCount: 0, networkPolicyCount: 0 },
        ],
      }),
    };

    await runPostureScan(reader);

    expect(repo.saveSnapshot).toHaveBeenCalledWith([
      expect.objectContaining({
        namespace: 'prod',
        score: 92, // one medium finding (latest-image-tag) = 100 - 8
        findings: [expect.objectContaining({ checkId: 'latest-image-tag' })],
      }),
      expect.objectContaining({ namespace: 'clean', score: 100, findings: [] }),
    ]);
  });

  it('reader failure is swallowed and logged, never thrown', async () => {
    const reader: ClusterReader = { readSnapshot: async () => { throw new Error('no cluster'); } };
    await expect(runPostureScan(reader)).resolves.toBeUndefined();
    expect(repo.saveSnapshot).not.toHaveBeenCalled();
  });

  it('save failure is swallowed and logged, never thrown', async () => {
    const reader: ClusterReader = {
      readSnapshot: async () => ({ pods: [], namespaces: [{ name: 'ns', podCount: 0, networkPolicyCount: 0 }] }),
    };
    repo.saveSnapshot.mockRejectedValue(new Error('appwrite down'));
    await expect(runPostureScan(reader)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('save failed'), 'appwrite down');
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('scanned'));
  });
});
