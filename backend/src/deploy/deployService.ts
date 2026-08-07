import { ID } from '../lib/appwrite';
import { deployRepository, DeployTargetConfig, TrivyReport } from '../repositories/deployRepository';
import { createIncident } from '../services/incidentService';
import { sendSlackNotification } from '../services/slackService';
import { verifyImageDigest } from '../services/cosignService';
import { signatureEnforcementActive } from '../services/signaturePolicy';
import { securityRequirementsService } from '../services/securityRequirementsService';
import { gateService } from '../services/gateService';
import { gateRunRepository } from '../repositories/gateRunRepository';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { logger, errorContext } from '../services/logger';

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
        repoId
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

    // 5b. Verify the build's image signature when one was recorded.
    //
    // A recorded signature is a claim that this exact digest was signed at build
    // time. Once the claim exists there are three outcomes and only one of them
    // deploys: verified, refuted (the digest does not match its signature —
    // tampering or substitution), and unjudgeable (no key, no cosign — we are
    // not in a position to say).
    //
    // The third used to pass. It no longer does. cosignService throws instead of
    // returning false precisely so this caller can tell a bad image from a blind
    // check, and treating "cannot check" as "checked out" hands a silent bypass
    // to anyone who can make cosign unresolvable — breaking this gate is far
    // cheaper than defeating it.
    //
    // The COSIGN_PUB_KEY_PATH condition that used to guard this branch is gone
    // on purpose: an absent key made verification skip silently, which is the
    // same fail-open by a quieter route. A missing key is now an unjudgeable
    // outcome and blocks like any other.
    //
    // A build with no recorded signature still proceeds *unless enforcement is
    // active*. Signing is opt-in, and an unsigned build makes no claim to check —
    // but that reasoning only holds while nobody has declared that a claim is
    // mandatory. REQUIRE_IMAGE_SIGNATURE is that declaration.
    //
    // This block is why the flag was previously a no-op on the path that matters.
    // k8sAdmission refused unsigned images; this service waved them through; and
    // this service is the one the deploy flow calls. Enabling the flag armed a
    // cluster webhook that has to be registered to do anything, while the
    // application kept deploying unsigned images and reporting success. Now both
    // gates answer through signatureEnforcementActive().
    if (signatureEnforcementActive(environment) && !(imageDigest && imageSignature)) {
      const missing = !imageDigest ? 'no image digest was recorded' : 'no build signature was recorded';
      const detail =
        `${imageTag} carries ${missing}, and REQUIRE_IMAGE_SIGNATURE is set for ${environment} — ` +
        'an image that makes no signature claim cannot satisfy a policy that requires one';

      logger.error(`[DeployService] Deployment blocked for ${deploymentId}: unsigned image under signature enforcement.`);
      await deployRepository.updateDeploymentStatus(deploymentId, { status: 'failed' });

      await createIncident({
        title: `Deployment Blocked: unsigned image ${imageTag}`,
        severity: 'CRITICAL',
        source: 'ci_pipeline',
        description: `Deployment ${deploymentId} to ${environment} was blocked: ${detail}.`,
        repoId
      });

      // Best-effort, deliberately: this is a DENY. A deny that fails to log is
      // not an unlogged privileged action — the deploy did not happen. Required
      // audit writes are reserved for events that GRANT (break-glass), where a
      // missing entry means a bypass nobody can see.
      await logSecureAuditEvent(
        triggeredBy,
        'IMAGE_SIGNATURE_MISSING',
        repoId,
        `Deployment ${deploymentId} of ${imageTag} to ${environment} blocked: ${detail}`,
      ).catch(err => logger.warn('[DeployService] failed to audit unsigned-image block', errorContext(err)));

      return { deploymentId, status: 'failed', reason: 'Image signature required but not present' };
    }

    if (imageDigest && imageSignature) {
      let outcome: 'verified' | 'refuted' | 'unjudgeable';
      let blindReason = '';

      try {
        outcome = (await verifyImageDigest(imageDigest, imageSignature)) ? 'verified' : 'refuted';
      } catch (err) {
        outcome = 'unjudgeable';
        blindReason = err instanceof Error ? err.message : String(err);
      }

      if (outcome !== 'verified') {
        const refuted = outcome === 'refuted';
        const reason = refuted
          ? 'Image signature verification failed'
          : 'Image signature could not be verified';
        const detail = refuted
          ? `the image digest ${imageDigest} does not match its recorded build signature, indicating possible tampering or substitution`
          : `the recorded signature for ${imageDigest} could not be checked (${blindReason}), leaving the image unverified rather than trusted`;

        logger.error(`[DeployService] Deployment blocked for ${deploymentId}: ${reason.toLowerCase()}.`);
        await deployRepository.updateDeploymentStatus(deploymentId, { status: 'failed' });

        await createIncident({
          title: `Deployment Blocked: ${reason} for ${imageTag}`,
          severity: 'CRITICAL',
          source: 'ci_pipeline',
          description: `Deployment ${deploymentId} to ${environment} was blocked: ${detail}.`,
          repoId
        });

        // Tamper-audited for the same reason break-glass is. A deploy stopped by
        // a broken verifier and a deploy stopped by a bad signature are
        // indistinguishable in the deployment record, and only one of them is an
        // operator's problem to fix. Best-effort: an audit-write failure must not
        // turn a clean block into a thrown error the caller handles differently.
        await logSecureAuditEvent(
          triggeredBy,
          refuted ? 'IMAGE_SIGNATURE_REFUTED' : 'IMAGE_SIGNATURE_UNVERIFIABLE',
          repoId,
          `Deployment ${deploymentId} of ${imageTag} to ${environment} blocked: ${detail}`,
        ).catch(err => logger.warn('[DeployService] failed to audit signature gate block', errorContext(err)));

        return { deploymentId, status: 'failed', reason };
      }
    }

    // 5c. Compliance gate: block a production deploy when a required security
    // control is violated by live findings (the #133 verdict, project-scoped).
    // Env-aware, mirroring the release preflight: production hard-blocks; dev/
    // staging warn and proceed. Break-glass overrides the prod block for an
    // emergency hotfix — always tamper-audited, never a silent bypass.
    const compliance = await securityRequirementsService.complianceGate(repoId);
    if (compliance.blocked) {
      // `degraded` means the evidence could not be read at all, so the empty
      // violation list is an unknown rather than a pass. Name it explicitly:
      // "0 controls violated" as a block reason reads like a bug.
      const codes = compliance.degraded
        ? 'evidence unavailable — compliance could not be evaluated'
        : compliance.violations.map(v => v.code).join(', ');
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
      }).catch(err => logger.warn('[DeployService] failed to record deploy gate run', errorContext(err)));

      // Stamp the release-node state so /api/gates/state is the single source of
      // truth the panel already shows: a hard block leaves it BLOCKED; a break-
      // glass ship permanently marks it OVERRIDDEN (not "passing" — it bypassed
      // security). Best-effort; a state-write failure never gates the deploy.
      if (environment === 'production') {
        gateService.stampReleaseVerdict(isHardBlock ? 'BLOCKED' : 'OVERRIDDEN')
          .catch(err => logger.warn('[DeployService] failed to stamp release verdict', errorContext(err)));
      }

      if (isHardBlock) {
        logger.warn(`[DeployService] Deployment ${deploymentId} blocked: ${compliance.violations.length} required control(s) violated.`);
        await deployRepository.updateDeploymentStatus(deploymentId, { status: 'failed' });
        await createIncident({
          title: `Deployment Blocked: compliance controls violated for ${imageTag}`,
          severity: 'CRITICAL',
          source: 'ci_pipeline',
          description: `Deployment ${deploymentId} to ${environment} was blocked: ${compliance.violations.length} required security control(s) are violated by live findings (${codes}). Remediate, or re-run with an audited break-glass override.`,
          repoId,
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
        repoId: deployment.repoId
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
