jest.mock('@kubernetes/client-node');
jest.mock('../repositories/postureRepository', () => ({
  postureRepository: { saveSnapshot: jest.fn(), listSnapshots: jest.fn() },
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { runPostureScan, ClusterReader } from './postureScanner';
import { postureRepository } from '../repositories/postureRepository';

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
});
