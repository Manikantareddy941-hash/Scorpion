jest.mock('../lib/appwrite', () => ({ ID: { unique: () => 'dep-1' } }));
jest.mock('../repositories/deployRepository', () => ({
  deployRepository: {
    getRepository: jest.fn(),
    runTrivyScan: jest.fn(),
    deployToDocker: jest.fn(),
    deployToKubernetes: jest.fn(),
    listDeployTargets: jest.fn(),
    createDeployTarget: jest.fn(),
    getPipelineRun: jest.fn(),
    getBuildPipeline: jest.fn(),
    findPreviousSuccessfulDeployment: jest.fn(),
    createDeployment: jest.fn(),
    updateDeploymentStatus: jest.fn(),
    getDeployment: jest.fn(),
    pingHealth: jest.fn(),
  },
}));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));
jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/cosignService', () => ({ verifyImageDigest: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
// Mocked so the signature gate's audit write is assertable rather than merely
// swallowed by its .catch(). The real logger chains hashes into Appwrite.
jest.mock('../utils/tamperAuditLogger', () => ({ logSecureAuditEvent: jest.fn().mockResolvedValue(undefined) }));

import { triggerDeploy, rollbackDeploy } from './deployService';
import { deployRepository } from '../repositories/deployRepository';
import { createIncident } from '../services/incidentService';
import { sendSlackNotification } from '../services/slackService';
import { verifyImageDigest } from '../services/cosignService';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';

const repo = deployRepository as jest.Mocked<typeof deployRepository>;

/** Happy-path scaffolding: pipeline run resolves, no targets/prev deploys, clean scan. */
const arrangeHappyPath = () => {
  repo.getPipelineRun.mockResolvedValue({ repoId: 'repo1' } as never);
  repo.listDeployTargets.mockResolvedValue({ total: 0, documents: [] } as never);
  repo.createDeployTarget.mockResolvedValue({} as never);
  repo.findPreviousSuccessfulDeployment.mockResolvedValue({ total: 0, documents: [] } as never);
  repo.createDeployment.mockResolvedValue({} as never);
  repo.updateDeploymentStatus.mockResolvedValue({} as never);
  repo.runTrivyScan.mockResolvedValue({ Results: [] } as never);
  repo.deployToDocker.mockResolvedValue(undefined as never);
  repo.deployToKubernetes.mockResolvedValue(undefined as never);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  delete process.env.COSIGN_PUB_KEY_PATH;
  jest.useRealTimers();
});

describe('triggerDeploy', () => {
  it('deploys a pipeline-run build to docker and links the previous deployment', async () => {
    arrangeHappyPath();
    repo.findPreviousSuccessfulDeployment.mockResolvedValue({ total: 1, documents: [{ $id: 'prev-9' }] } as never);

    const result = await triggerDeploy('build-1', 'production', 'tester');

    expect(result).toEqual({ deploymentId: 'dep-1', status: 'success' });
    expect(repo.createDeployment).toHaveBeenCalledWith('dep-1', expect.objectContaining({
      repoId: 'repo1',
      imageTag: 'repo-repo1:build-1',
      previousDeploymentId: 'prev-9',
    }));
    expect(repo.deployToDocker).toHaveBeenCalledWith('scorpion-repo1-production', '8083', '80', 'repo-repo1:build-1');
    expect(repo.updateDeploymentStatus).toHaveBeenCalledWith('dep-1', expect.objectContaining({ status: 'success' }));
  });

  it('falls back to the legacy build pipeline when no pipeline run exists', async () => {
    arrangeHappyPath();
    repo.getPipelineRun.mockRejectedValue(new Error('not found'));
    repo.getBuildPipeline.mockResolvedValue({ repoId: 'repo2' } as never);

    const result = await triggerDeploy('build-2', 'dev');

    expect(result.status).toBe('success');
    expect(repo.createDeployment).toHaveBeenCalledWith('dep-1', expect.objectContaining({ imageTag: 'repo-repo2:build-2' }));
  });

  it('fails and marks the deployment failed when neither run nor build resolves', async () => {
    arrangeHappyPath();
    repo.getPipelineRun.mockRejectedValue(new Error('not found'));
    repo.getBuildPipeline.mockRejectedValue(new Error('not found'));

    await expect(triggerDeploy('ghost', 'dev')).rejects.toThrow('Failed to resolve build/run for ID ghost');
    expect(repo.updateDeploymentStatus).toHaveBeenCalledWith('dep-1', { status: 'failed' });
  });

  it('blocks the deployment and raises an incident when the image has critical CVEs', async () => {
    arrangeHappyPath();
    repo.runTrivyScan.mockResolvedValue({
      Results: [{ Vulnerabilities: [{ Severity: 'CRITICAL' }] }],
    } as never);
    repo.getRepository.mockResolvedValue({ user_id: 'owner-1' } as never);

    const result = await triggerDeploy('build-1', 'production');

    expect(result).toEqual({ deploymentId: 'dep-1', status: 'failed', reason: 'Critical vulnerabilities found' });
    expect(repo.updateDeploymentStatus).toHaveBeenCalledWith('dep-1', { status: 'failed' });
    expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({ severity: 'CRITICAL', repoId: 'repo1' }));
    expect(repo.deployToDocker).not.toHaveBeenCalled();
  });

  it('does not block when the trivy scan itself fails (local-dev fallback)', async () => {
    arrangeHappyPath();
    repo.runTrivyScan.mockRejectedValue(new Error('trivy not installed'));

    const result = await triggerDeploy('build-1', 'dev');

    expect(result.status).toBe('success');
  });

  // REVERSAL, deliberate. This test previously asserted `status: 'success'` for
  // this exact arrangement — an unverifiable signature shipped. Do not restore
  // that. cosignService throws rather than returning false so this caller can
  // distinguish a bad image from a blind check; both block, and only one of them
  // is the image's fault. See verifyImageSignature's contract in cosignService.
  it('blocks when a recorded signature cannot be verified at all (tool/config issue)', async () => {
    process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
    arrangeHappyPath();
    repo.getPipelineRun.mockResolvedValue({ repoId: 'repo1', imageDigest: 'sha256:abc', imageSignature: 'sig' } as never);
    (verifyImageDigest as jest.Mock).mockRejectedValue(new Error('cosign missing'));

    const result = await triggerDeploy('build-1', 'production');

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('Image signature could not be verified');
    expect(repo.deployToDocker).not.toHaveBeenCalled();
    // Audited under a distinct action from a refuted signature: an operator
    // reading the ledger needs to know whether to fix the image or the toolchain.
    // 'system' is triggerDeploy's default actor when no caller is named.
    expect(logSecureAuditEvent).toHaveBeenCalledWith(
      'system', 'IMAGE_SIGNATURE_UNVERIFIABLE', 'repo1', expect.stringContaining('cosign missing'),
    );
  });

  // The condition that used to short-circuit the whole branch. Previously this
  // deployed with no verification performed and no record that none happened.
  it('blocks a recorded signature when COSIGN_PUB_KEY_PATH is unset, rather than skipping', async () => {
    delete process.env.COSIGN_PUB_KEY_PATH;
    arrangeHappyPath();
    repo.getPipelineRun.mockResolvedValue({ repoId: 'repo1', imageDigest: 'sha256:abc', imageSignature: 'sig' } as never);
    (verifyImageDigest as jest.Mock).mockRejectedValue(new Error('COSIGN_PUB_KEY_PATH is not configured'));

    const result = await triggerDeploy('build-1', 'dev');

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('Image signature could not be verified');
  });

  it('records a refuted signature under its own audit action', async () => {
    process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
    arrangeHappyPath();
    repo.getPipelineRun.mockResolvedValue({ repoId: 'repo1', imageDigest: 'sha256:abc', imageSignature: 'sig' } as never);
    (verifyImageDigest as jest.Mock).mockResolvedValue(false);

    const result = await triggerDeploy('build-1', 'production');

    expect(result.reason).toBe('Image signature verification failed');
    expect(logSecureAuditEvent).toHaveBeenCalledWith(
      'system', 'IMAGE_SIGNATURE_REFUTED', 'repo1', expect.stringContaining('does not match'),
    );
  });

  // The opt-in escape hatch that must survive. An unsigned build makes no claim,
  // so there is nothing to block on. Guards against over-correcting the gate into
  // "no cosign, no deploys, ever" — which would break every install that never
  // configured signing.
  it('still deploys when the build recorded no signature at all', async () => {
    delete process.env.COSIGN_PUB_KEY_PATH;
    arrangeHappyPath();

    const result = await triggerDeploy('build-1', 'production');

    expect(result.status).toBe('success');
    expect(verifyImageDigest).not.toHaveBeenCalled();
  });

  it('uses a stored kubernetes deploy target when one exists', async () => {
    arrangeHappyPath();
    repo.listDeployTargets.mockResolvedValue({
      total: 1,
      documents: [{ type: 'kubernetes', config: '{}' }],
    } as never);

    const result = await triggerDeploy('build-1', 'staging');

    expect(result.status).toBe('success');
    expect(repo.deployToKubernetes).toHaveBeenCalledWith('scorpion-repo1-staging', 'scorpion-staging', 'repo-repo1:build-1');
    expect(repo.createDeployTarget).not.toHaveBeenCalled();
  });

  it('falls back to the default docker target when target resolution errors', async () => {
    arrangeHappyPath();
    repo.listDeployTargets.mockRejectedValue(new Error('collection missing'));

    const result = await triggerDeploy('build-1', 'dev');

    expect(result.status).toBe('success');
    expect(repo.deployToDocker).toHaveBeenCalledWith('scorpion-repo1-dev', '8081', '80', 'repo-repo1:build-1');
  });

  it('still deploys when the previous-deployment lookup errors (link stays empty)', async () => {
    arrangeHappyPath();
    repo.findPreviousSuccessfulDeployment.mockRejectedValue(new Error('index missing'));

    const result = await triggerDeploy('build-1', 'dev');

    expect(result.status).toBe('success');
    expect(repo.createDeployment).toHaveBeenCalledWith('dep-1', expect.objectContaining({ previousDeploymentId: '' }));
  });

  // The incident is scoped to the repo id carried by the pipeline run, so it no
  // longer depends on a repository lookup that can fail — ownership (and with it
  // the incident's visibility) survives a missing repository document.
  it('scopes the CVE incident to the repo even when the repository document is gone', async () => {
    arrangeHappyPath();
    repo.runTrivyScan.mockResolvedValue({
      Results: [{ Vulnerabilities: [{ Severity: 'CRITICAL' }] }],
    } as never);
    repo.getRepository.mockRejectedValue(new Error('repo doc gone'));

    const result = await triggerDeploy('build-1', 'production');

    expect(result.status).toBe('failed');
    expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({ repoId: 'repo1' }));
  });

  it('marks the deployment failed when the target deployment errors', async () => {
    arrangeHappyPath();
    repo.deployToDocker.mockRejectedValue(new Error('docker daemon unreachable'));

    const result = await triggerDeploy('build-1', 'dev');

    expect(result).toEqual({ deploymentId: 'dep-1', status: 'failed', reason: 'docker daemon unreachable' });
    expect(repo.updateDeploymentStatus).toHaveBeenCalledWith('dep-1', { status: 'failed' });
  });
});

describe('health check and auto-rollback', () => {
  it('leaves a healthy deployment alone after the 60s check', async () => {
    arrangeHappyPath();
    repo.getDeployment.mockResolvedValue({ status: 'success', repoId: 'repo1' } as never);
    repo.pingHealth.mockResolvedValue(true as never);

    await triggerDeploy('build-1', 'dev');
    await jest.advanceTimersByTimeAsync(60000);

    expect(repo.pingHealth).toHaveBeenCalledWith(8081);
    expect(createIncident).not.toHaveBeenCalled();
  });

  it('skips the health check when the deployment is no longer marked success', async () => {
    arrangeHappyPath();
    repo.getDeployment.mockResolvedValue({ status: 'rolled-back' } as never);

    await triggerDeploy('build-1', 'dev');
    await jest.advanceTimersByTimeAsync(60000);

    expect(repo.pingHealth).not.toHaveBeenCalled();
  });

  it('swallows health-check errors instead of crashing the process', async () => {
    arrangeHappyPath();
    repo.getDeployment.mockRejectedValue(new Error('appwrite down'));

    await triggerDeploy('build-1', 'dev');
    await expect(jest.advanceTimersByTimeAsync(60000)).resolves.not.toThrow();

    expect(repo.pingHealth).not.toHaveBeenCalled();
  });

  it('raises an incident and rolls back when the health check fails', async () => {
    arrangeHappyPath();
    repo.getRepository.mockResolvedValue({ user_id: 'owner-1' } as never);
    repo.pingHealth.mockResolvedValue(false as never);
    repo.getDeployment.mockImplementation((id: string) => Promise.resolve(
      id === 'prev-9'
        ? { imageTag: 'repo-repo1:old' }
        : {
            status: 'success',
            repoId: 'repo1',
            environment: 'dev',
            imageTag: 'repo-repo1:build-1',
            previousDeploymentId: 'prev-9',
          }
    ) as never);

    await triggerDeploy('build-1', 'dev');
    await jest.advanceTimersByTimeAsync(60000);

    expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Health Check Failed'),
      severity: 'HIGH',
    }));
    expect(repo.deployToDocker).toHaveBeenCalledWith('scorpion-repo1-dev', '8081', '80', 'repo-repo1:old');
    expect(repo.updateDeploymentStatus).toHaveBeenCalledWith('dep-1', expect.objectContaining({ status: 'rolled-back' }));
  });
});

describe('slack notifications (webhook configured)', () => {
  // SLACK_WEBHOOK_URL is captured at module load, so re-import a fresh copy
  // of the service with the env set to exercise the notification branches.
  const withSlackService = async (): Promise<typeof import('./deployService')> => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/T000/B000';
    let mod: typeof import('./deployService') | undefined;
    await jest.isolateModulesAsync(async () => {
      mod = await import('./deployService');
    });
    if (!mod) throw new Error('failed to load deployService');
    return mod;
  };

  afterEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it('notifies slack on a successful deployment', async () => {
    const { triggerDeploy: freshTrigger } = await withSlackService();
    arrangeHappyPath();
    (sendSlackNotification as jest.Mock).mockResolvedValue(undefined);

    const result = await freshTrigger('build-1', 'dev');

    expect(result.status).toBe('success');
    expect(sendSlackNotification).toHaveBeenCalledWith(
      'https://hooks.slack.test/T000/B000',
      expect.objectContaining({ title: 'Deployment Success: dev', severity: 'LOW' })
    );
  });

  it('notifies slack when a deployment is blocked on critical CVEs', async () => {
    const { triggerDeploy: freshTrigger } = await withSlackService();
    arrangeHappyPath();
    repo.runTrivyScan.mockResolvedValue({
      Results: [{ Vulnerabilities: [{ Severity: 'CRITICAL' }] }],
    } as never);
    repo.getRepository.mockResolvedValue({ user_id: 'owner-1' } as never);
    (sendSlackNotification as jest.Mock).mockResolvedValue(undefined);

    const result = await freshTrigger('build-1', 'production');

    expect(result.status).toBe('failed');
    expect(sendSlackNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: 'Deployment Failed: production', severity: 'CRITICAL' })
    );
  });

  it('notifies slack after a completed rollback', async () => {
    const { rollbackDeploy: freshRollback } = await withSlackService();
    repo.getDeployment.mockImplementation((id: string) => Promise.resolve(
      id === 'prev-9'
        ? { imageTag: 'repo-repo1:old' }
        : { repoId: 'repo1', environment: 'dev', imageTag: 'repo-repo1:new', previousDeploymentId: 'prev-9' }
    ) as never);
    repo.listDeployTargets.mockResolvedValue({ total: 0, documents: [] } as never);
    repo.deployToDocker.mockResolvedValue(undefined as never);
    repo.updateDeploymentStatus.mockResolvedValue({} as never);
    (sendSlackNotification as jest.Mock).mockResolvedValue(undefined);

    const result = await freshRollback('dep-1');

    expect(result.status).toBe('rolled-back');
    expect(sendSlackNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: 'Rollback Completed: dev', severity: 'HIGH' })
    );
  });
});

describe('rollbackDeploy', () => {
  it('redeploys the previous image and marks the deployment rolled back', async () => {
    repo.getDeployment.mockImplementation((id: string) => Promise.resolve(
      id === 'prev-9'
        ? { imageTag: 'repo-repo1:old' }
        : { repoId: 'repo1', environment: 'staging', imageTag: 'repo-repo1:new', previousDeploymentId: 'prev-9' }
    ) as never);
    repo.listDeployTargets.mockResolvedValue({ total: 0, documents: [] } as never);
    repo.deployToDocker.mockResolvedValue(undefined as never);
    repo.updateDeploymentStatus.mockResolvedValue({} as never);

    const result = await rollbackDeploy('dep-1');

    expect(result).toEqual({ deploymentId: 'dep-1', status: 'rolled-back' });
    expect(repo.deployToDocker).toHaveBeenCalledWith('scorpion-repo1-staging', '8082', '80', 'repo-repo1:old');
    // rollback never seeds a default target
    expect(repo.createDeployTarget).not.toHaveBeenCalled();
  });

  it('throws when there is no previous successful deployment to roll back to', async () => {
    repo.getDeployment.mockResolvedValue({ repoId: 'repo1', previousDeploymentId: '' } as never);

    await expect(rollbackDeploy('dep-1')).rejects.toThrow('No previous successful deployment');
  });

  it('throws when the rollback redeployment itself fails', async () => {
    repo.getDeployment.mockImplementation((id: string) => Promise.resolve(
      id === 'prev-9'
        ? { imageTag: 'repo-repo1:old' }
        : { repoId: 'repo1', environment: 'dev', imageTag: 'repo-repo1:new', previousDeploymentId: 'prev-9' }
    ) as never);
    repo.listDeployTargets.mockResolvedValue({ total: 0, documents: [] } as never);
    repo.deployToDocker.mockRejectedValue(new Error('daemon gone'));

    await expect(rollbackDeploy('dep-1')).rejects.toThrow('Rollback deployment failed: daemon gone');
  });
});
