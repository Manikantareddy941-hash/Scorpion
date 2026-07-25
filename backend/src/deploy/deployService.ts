import { ID } from '../lib/appwrite';
import { deployRepository, DeployTargetConfig, TrivyReport } from '../repositories/deployRepository';
import { createIncident } from '../services/incidentService';
import { sendSlackNotification } from '../services/slackService';
import { verifyImageDigest } from '../services/cosignService';
import { securityRequirementsService } from '../services/securityRequirementsService';
import { gateService } from '../services/gateService';
import { gateRunRepository } from '../repositories/gateRunRepository';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { logger } from '../services/logger';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

type DeployEnvironment = 'dev' | 'staging' | 'production';
type TargetType = 'docker' | 'kubernetes';

function defaultPortForEnvironment(environment: string): number {
  return environment === 'production' ? 8083 : environment === 'staging' ? 8082 : 8081;
}

function containerNameFor(repoId: string, environment: string): string {
  const sanitizedRepoId = repoId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  return `scorpion-${sanitizedRepoId}-${environment}`;
}

// repoId here is a real platform Repository document id (sourced from
// pipeline_runs.repoId / builds.repoId), so the owner is a direct lookup.
async function resolveRepoOwner(repoId: string): Promise<string | undefined> {
  try {
    const repo = await deployRepository.getRepository(repoId);
    return repo.user_id;
  } catch {
    return undefined;
  }
}

function reportHasCriticalCves(report: TrivyReport): boolean {
  if (!report.Results) return false;
  for (const result of report.Results) {
    if (result.Vulnerabilities?.some(v => v.Severity === 'CRITICAL')) {
      return true;
    }
  }
  return false;
}

async function scanDockerImage(imageTag: string): Promise<boolean> {
  try {
    const report = await deployRepository.runTrivyScan(imageTag);
    return reportHasCriticalCves(report);
  } catch (error) {
    logger.error(`[DeployService] Trivy scan failed/skipped for image ${imageTag}: ${error instanceof Error ? error.message : error}`);
    // Fallback: If trivy fails, don't block in local dev environment
    return false;
  }
}

/**
 * Execute actual deployment to target (Docker or Kubernetes)
 */
async function executeTargetDeployment(
  repoId: string,
  environment: string,
  imageTag: string,
  targetType: TargetType,
  config: DeployTargetConfig
): Promise<{ success: boolean; port?: number; error?: string }> {
  try {
    const containerName = containerNameFor(repoId, environment);

    if (targetType === 'docker') {
      const portMapping = config.portMapping || '8080:80';
      const [hostPort, containerPort] = portMapping.split(':');

      await deployRepository.deployToDocker(containerName, hostPort, containerPort, imageTag);
      return { success: true, port: parseInt(hostPort) };
    } else {
      const namespace = `scorpion-${environment}`;
      await deployRepository.deployToKubernetes(containerName, namespace, imageTag);
      return { success: true };
    }
  } catch (err) {
    logger.error('[DeployService] Target deployment execution failed:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown deployment error' };
  }
}

/**
 * Resolve which deploy target (docker/kubernetes) and config to use for an
 * environment. On first deploy to an environment (createIfMissing), seeds a
 * default Docker target; rollback only reads, it never seeds one.
 */
async function resolveDeployTarget(environment: string, createIfMissing: boolean): Promise<{ targetType: TargetType; config: DeployTargetConfig }> {
  const hostPort = defaultPortForEnvironment(environment);
  let targetType: TargetType = 'docker';
  let config: DeployTargetConfig = { portMapping: `${hostPort}:80` };

  try {
    const targets = await deployRepository.listDeployTargets(environment);
    if (targets.total > 0) {
      const t = targets.documents[0];
      targetType = t.type as TargetType;
      config = JSON.parse(t.config);
    } else if (createIfMissing) {
      await deployRepository.createDeployTarget(environment, `Default Local Docker (${environment})`, 'docker', config);
    }
  } catch (err) {
    logger.warn('[DeployService] Error resolving deploy targets config:', err);
  }

  return { targetType, config };
}

/**
 * Trigger a deployment
 */
export async function triggerDeploy(
  buildId: string,
  environment: DeployEnvironment,
  triggeredBy: string = 'system',
  // Emergency prod hotfix escape hatch. Only ever true when the caller proved
  // the gate:bypass permission; the override is tamper-audited, never silent.
  breakGlass: boolean = false,
) {
  const deploymentId = ID.unique();

  try {
    let repoId = '';
    let imageTag = '';
    let imageDigest: string | undefined;
    let imageSignature: string | undefined;

    // 1. Fetch details from Pipeline Runs or legacy builds
    try {
      const run = await deployRepository.getPipelineRun(buildId);
      repoId = run.repoId;
      imageTag = `repo-${repoId}:${buildId}`;
      imageDigest = run.imageDigest;
      imageSignature = run.imageSignature;
    } catch {
      try {
        const build = await deployRepository.getBuildPipeline(buildId);
        repoId = build.repoId;
        // Must match buildService.ts's `repo-${repoId}:${pipelineId}` tag
        // (pipelineId there IS this buildId) - ':latest' was never the
        // actual tag buildService.ts produces.
        imageTag = `repo-${repoId}:${buildId}`;
        imageDigest = build.imageDigest;
        imageSignature = build.imageSignature;
      } catch {
        logger.error(`[DeployService] Failed to resolve build/run for ID ${buildId}`);
        throw new Error(`Failed to resolve build/run for ID ${buildId}`);
      }
    }

    // 2. Resolve deploy target config
    const { targetType, config } = await resolveDeployTarget(environment, true);
    const hostPort = defaultPortForEnvironment(environment);

    // 3. Find previous successful deployment to map rollback link
    let previousDeploymentId = '';
    try {
      const prevDeploys = await deployRepository.findPreviousSuccessfulDeployment(repoId, environment);
      if (prevDeploys.total > 0) {
        previousDeploymentId = prevDeploys.documents[0].$id;
      }
    } catch (err) {
      logger.warn('[DeployService] Previous deployment resolution failed:', err);
    }

    // 4. Create Deployment Record
    await deployRepository.createDeployment(deploymentId, {
      repoId,
      buildId,
      environment,
      status: 'pending',
      imageTag,
      namespace: `scorpion-${environment}`,
      triggeredBy,
      previousDeploymentId
    });

    // 5. Scan Image via Trivy
    await deployRepository.updateDeploymentStatus(deploymentId, { status: 'scanning' });
    const hasCriticalCves = await scanDockerImage(imageTag);

    if (hasCriticalCves) {
      logger.warn(`[DeployService] Deployment blocked for ${deploymentId} due to critical vulnerabilities.`);
      await deployRepository.updateDeploymentStatus(deploymentId, { status: 'failed' });

      await createIncident({
        title: `Deployment Blocked: Critical CVEs in ${imageTag}`,
        severity: 'CRITICAL',
        source: 'ci_pipeline',
        description: `Deployment ${deploymentId} to ${environment} was blocked by GitOps gate due to critical vulnerabilities in the Docker image.`,
        userId: await resolveRepoOwner(repoId)
      });

      if (SLACK_WEBHOOK_URL) {
        await sendSlackNotification(SLACK_WEBHOOK_URL, {
          title: `Deployment Failed: ${environment}`,
          severity: 'CRITICAL',
          repository: repoId,
          rule: 'No Critical CVEs in Deployment'
        }).catch(() => {});
      }

      return { deploymentId, status: 'failed', reason: 'Critical vulnerabilities found' };
    }

    // 5b. Verify the build's image signature, if one was recorded and
    // verification is configured. Skips gracefully when signing wasn't set
    // up (most installs) - only blocks when a signature WAS recorded but
    // fails to verify, which means the image was tampered with or
    // substituted after the build signed it.
    if (imageDigest && imageSignature && process.env.COSIGN_PUB_KEY_PATH) {
      let verified = false;
      try {
        verified = await verifyImageDigest(imageDigest, imageSignature);
      } catch (err) {
        logger.warn(`[DeployService] Could not attempt image signature verification for ${deploymentId}:`, err instanceof Error ? err.message : err);
        verified = true; // couldn't attempt verification (tool/config issue) - don't block on that alone
      }

      if (!verified) {
        logger.error(`[DeployService] Deployment blocked for ${deploymentId}: image signature verification failed.`);
        await deployRepository.updateDeploymentStatus(deploymentId, { status: 'failed' });

        await createIncident({
          title: `Deployment Blocked: Image signature verification failed for ${imageTag}`,
          severity: 'CRITICAL',
          source: 'ci_pipeline',
          description: `Deployment ${deploymentId} to ${environment} was blocked: the image digest ${imageDigest} does not match its recorded build signature, indicating possible tampering or substitution.`,
          userId: await resolveRepoOwner(repoId)
        });

        return { deploymentId, status: 'failed', reason: 'Image signature verification failed' };
      }
    }

    // 5c. Compliance gate: block a production deploy when a required security
    // control is violated by live findings (the #133 verdict, project-scoped).
    // Env-aware, mirroring the release preflight: production hard-blocks; dev/
    // staging warn and proceed. Break-glass overrides the prod block for an
    // emergency hotfix — always tamper-audited, never a silent bypass.
    const compliance = await securityRequirementsService.complianceGate(repoId);
    if (compliance.blocked) {
      const codes = compliance.violations.map(v => v.code).join(', ');
      const isHardBlock = environment === 'production' && !breakGlass;
      // Ledger the deploy-gate event so it shows in the Pipeline Gates panel
      // alongside CI runs. A break-glass override is the highest-stakes event to
      // keep visible; a hard block, the next. Best-effort — never fail a deploy
      // (or a block) on a ledger-write error.
      gateRunRepository.record({
        repoId,
        source: 'deploy',
        environment,
        actor: triggeredBy,
        commitSha: buildId,
        status: isHardBlock ? 'blocked' : 'overridden',
        violations: compliance.violations,
        createdAt: new Date().toISOString(),
      }).catch(err => logger.warn('[DeployService] failed to record deploy gate run', err instanceof Error ? err.message : err));

      // Stamp the release-node state so /api/gates/state is the single source of
      // truth the panel already shows: a hard block leaves it BLOCKED; a break-
      // glass ship permanently marks it OVERRIDDEN (not "passing" — it bypassed
      // security). Best-effort; a state-write failure never gates the deploy.
      if (environment === 'production') {
        gateService.stampReleaseVerdict(isHardBlock ? 'BLOCKED' : 'OVERRIDDEN')
          .catch(err => logger.warn('[DeployService] failed to stamp release verdict', err instanceof Error ? err.message : err));
      }

      if (isHardBlock) {
        logger.warn(`[DeployService] Deployment ${deploymentId} blocked: ${compliance.violations.length} required control(s) violated.`);
        await deployRepository.updateDeploymentStatus(deploymentId, { status: 'failed' });
        await createIncident({
          title: `Deployment Blocked: compliance controls violated for ${imageTag}`,
          severity: 'CRITICAL',
          source: 'ci_pipeline',
          description: `Deployment ${deploymentId} to ${environment} was blocked: ${compliance.violations.length} required security control(s) are violated by live findings (${codes}). Remediate, or re-run with an audited break-glass override.`,
          userId: await resolveRepoOwner(repoId),
        });
        return { deploymentId, status: 'failed', reason: 'Compliance gate: required security control(s) violated', violations: compliance.violations };
      }
      if (breakGlass && environment === 'production') {
        await logSecureAuditEvent(
          triggeredBy,
          'BREAK_GLASS_BYPASS',
          repoId,
          `Compliance gate bypassed for production deployment ${deploymentId} of ${imageTag}: ${compliance.violations.length} violated control(s) [${codes}]`,
        );
      }
    }

    // 6. Proceed with Deployment
    await deployRepository.updateDeploymentStatus(deploymentId, { status: 'running' });
    logger.info(`[DeployService] Deploying ${imageTag} to target ${targetType}...`);

    const deployOutcome = await executeTargetDeployment(repoId, environment, imageTag, targetType, config);
    if (!deployOutcome.success) {
      await deployRepository.updateDeploymentStatus(deploymentId, { status: 'failed' });
      return { deploymentId, status: 'failed', reason: deployOutcome.error || 'Target deployment failed' };
    }

    // 7. Update Deployment Status
    await deployRepository.updateDeploymentStatus(deploymentId, {
      status: 'success',
      deployedAt: new Date().toISOString()
    });

    // 8. Send Slack notification
    if (SLACK_WEBHOOK_URL) {
      await sendSlackNotification(SLACK_WEBHOOK_URL, {
        title: `Deployment Success: ${environment}`,
        severity: 'LOW',
        repository: repoId,
        rule: `Successfully deployed ${imageTag}`
      }).catch(() => {});
    }

    // 9. Auto-rollback if health check fails after 60 seconds
    const pingPort = deployOutcome.port || hostPort;
    setTimeout(() => performHealthCheck(deploymentId, environment, pingPort), 60000);

    return { deploymentId, status: 'success' };

  } catch (error) {
    logger.error('[DeployService] Deployment failed', error);
    try {
      await deployRepository.updateDeploymentStatus(deploymentId, { status: 'failed' });
    } catch { /* best-effort status update */ }
    throw error;
  }
}

/**
 * Health Check ping execution
 */
async function performHealthCheck(deploymentId: string, environment: string, port: number) {
  try {
    const deployment = await deployRepository.getDeployment(deploymentId);
    if (deployment.status !== 'success') return; // Only check if currently considered successful

    logger.info(`[DeployService] Performing health check for deployment ${deploymentId} on port ${port}...`);

    const isHealthy = await deployRepository.pingHealth(port);

    if (!isHealthy) {
      logger.warn(`[DeployService] Health check failed for ${deploymentId}. Triggering auto-rollback.`);

      await createIncident({
        title: `Health Check Failed: ${environment}`,
        severity: 'HIGH',
        source: 'gitops',
        description: `Deployment ${deploymentId} failed health checks after 60 seconds. Auto-rollback initiated.`,
        userId: await resolveRepoOwner(deployment.repoId)
      });

      await rollbackDeploy(deploymentId);
    } else {
      logger.info(`[DeployService] Health check passed for ${deploymentId}`);
    }
  } catch (err) {
    logger.error('[DeployService] Health check error', err);
  }
}

/**
 * Rollback a deployment
 */
export async function rollbackDeploy(deploymentId: string) {
  logger.info(`[DeployService] Rolling back deployment ${deploymentId}...`);
  try {
    // 1. Fetch deployment
    const deployment = await deployRepository.getDeployment(deploymentId);
    const prevId = deployment.previousDeploymentId;

    if (!prevId) {
      logger.warn(`[DeployService] No previous successful deployment found for rollback of ${deploymentId}.`);
      throw new Error('No previous successful deployment found to roll back to.');
    }

    const prevDeployment = await deployRepository.getDeployment(prevId);
    const rollbackImageTag = prevDeployment.imageTag;

    // 2. Perform rollback redeployment
    const environment = deployment.environment;
    const { targetType, config } = await resolveDeployTarget(environment, false);

    logger.info(`[DeployService] Redeploying previous image: ${rollbackImageTag} on target ${targetType}...`);
    const rollbackOutcome = await executeTargetDeployment(deployment.repoId, environment, rollbackImageTag, targetType, config);

    if (!rollbackOutcome.success) {
      throw new Error(`Rollback deployment failed: ${rollbackOutcome.error}`);
    }

    // 3. Update status
    await deployRepository.updateDeploymentStatus(deploymentId, {
      status: 'rolled-back',
      rolledBackAt: new Date().toISOString()
    });

    // 4. Notify Slack
    if (SLACK_WEBHOOK_URL) {
      await sendSlackNotification(SLACK_WEBHOOK_URL, {
        title: `Rollback Completed: ${deployment.environment}`,
        severity: 'HIGH',
        repository: deployment.repoId,
        rule: `Rolled back from ${deployment.imageTag} to previous stable tag ${rollbackImageTag}`
      }).catch(() => {});
    }

    return { deploymentId, status: 'rolled-back' };
  } catch (error) {
    logger.error(`[DeployService] Rollback failed for ${deploymentId}`, error);
    throw error;
  }
}
