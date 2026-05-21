import { databases, COLLECTIONS, DB_ID, ID } from '../lib/appwrite';
import { createIncident } from '../services/incidentService';
import { sendSlackNotification } from '../services/slackService';
import { logger } from '../services/logger';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

// NOTE: In a real app, this would be configured securely
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || 'https://hooks.slack.com/services/mock/url';

async function scanDockerImage(imageTag: string): Promise<boolean> {
  logger.info(`[DeployService] Running Trivy scan on image: ${imageTag}`);
  try {
    const { stdout } = await execAsync(`trivy image -q -f json ${imageTag}`);
    const report = JSON.parse(stdout);
    
    let hasCritical = false;
    if (report.Results) {
      for (const result of report.Results) {
        if (result.Vulnerabilities) {
          for (const vuln of result.Vulnerabilities) {
            if (vuln.Severity === 'CRITICAL') {
              hasCritical = true;
              break;
            }
          }
        }
      }
    }
    return hasCritical;
  } catch (error: any) {
    logger.error(`[DeployService] Trivy scan failed for image ${imageTag}`, error);
    // If trivy fails, we might assume it's unsafe or just proceed depending on strictness.
    // For now, fail safe by returning true (critical found/error)
    return true; 
  }
}

/**
 * Trigger a deployment
 */
export async function triggerDeploy(buildId: string, environment: 'dev' | 'staging' | 'production', triggeredBy: string = 'system') {
  const deploymentId = ID.unique();
  
  try {
    // 1. Fetch Build and Repo Info
    const build = await databases.getDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, buildId);
    const repoId = build.repoId;
    
    // Attempt to find the docker image artifact
    // We assume the artifact name or URL holds the docker image tag
    const artifacts = await databases.listDocuments(DB_ID, COLLECTIONS.BUILD_ARTIFACTS, [
      // Query.equal('buildId', buildId) // Assume we have a query object if needed
    ]);
    
    let imageTag = `repo-${repoId}:latest`; // Fallback mock image tag
    const dockerArtifact = artifacts.documents.find(a => a.buildId === buildId && a.type === 'docker-image');
    if (dockerArtifact) {
      imageTag = dockerArtifact.name;
    }

    // 2. Create Deployment Record
    await databases.createDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId, {
      repoId,
      buildId,
      environment,
      status: 'pending',
      imageTag,
      namespace: `scorpion-${environment}`,
      triggeredBy
    });

    // 3. Scan Image
    await databases.updateDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId, { status: 'scanning' });
    const hasCriticalCves = await scanDockerImage(imageTag);

    if (hasCriticalCves) {
      // 4. Block Deployment & Create Incident
      logger.warn(`[DeployService] Deployment blocked for ${deploymentId} due to critical vulnerabilities.`);
      
      await databases.updateDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId, { status: 'failed' });
      
      await createIncident({
        title: `Deployment Blocked: Critical CVEs in ${imageTag}`,
        severity: 'CRITICAL',
        source: 'ci_pipeline',
        description: `Deployment ${deploymentId} to ${environment} was blocked by GitOps gate due to critical vulnerabilities in the Docker image.`
      });

      await sendSlackNotification(SLACK_WEBHOOK_URL, {
        title: `Deployment Failed: ${environment}`,
        severity: 'CRITICAL',
        repository: repoId,
        rule: 'No Critical CVEs in Deployment'
      }).catch(() => {}); // catch to avoid throwing if slack fails
      
      return { deploymentId, status: 'failed', reason: 'Critical vulnerabilities found' };
    }

    // 5. Proceed with Deployment (Mock)
    await databases.updateDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId, { status: 'running' });
    logger.info(`[DeployService] Deploying ${imageTag} to ${environment}...`);
    
    // Simulate deployment delay
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 6. Update Deployment Status
    await databases.updateDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId, { 
      status: 'success',
      deployedAt: new Date().toISOString()
    });

    // 7. Send Slack notification
    await sendSlackNotification(SLACK_WEBHOOK_URL, {
      title: `Deployment Success: ${environment}`,
      severity: 'LOW',
      repository: repoId,
      rule: `Successfully deployed ${imageTag}`
    }).catch(() => {});

    // 8. Auto-rollback if health check fails after 60 seconds
    setTimeout(() => performHealthCheck(deploymentId, environment, imageTag), 60000);

    return { deploymentId, status: 'success' };

  } catch (error: any) {
    logger.error(`[DeployService] Deployment failed`, error);
    try {
      await databases.updateDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId, { status: 'failed' });
    } catch (_) {}
    throw error;
  }
}

/**
 * Health Check Simulation
 */
async function performHealthCheck(deploymentId: string, environment: string, imageTag: string) {
  try {
    const deployment = await databases.getDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId);
    if (deployment.status !== 'success') return; // Only check if currently considered successful

    logger.info(`[DeployService] Performing health check for deployment ${deploymentId}`);
    
    // Mock health check logic (10% chance of failure for demonstration)
    const isHealthy = Math.random() > 0.1; 

    if (!isHealthy) {
      logger.warn(`[DeployService] Health check failed for ${deploymentId}. Triggering auto-rollback.`);
      
      await createIncident({
        title: `Health Check Failed: ${environment}`,
        severity: 'HIGH',
        source: 'gitops',
        description: `Deployment ${deploymentId} failed health checks after 60 seconds. Auto-rollback initiated.`
      });

      await rollbackDeploy(deploymentId);
    } else {
      logger.info(`[DeployService] Health check passed for ${deploymentId}`);
    }
  } catch (err) {
    logger.error(`[DeployService] Health check error`, err);
  }
}

/**
 * Rollback a deployment
 */
export async function rollbackDeploy(deploymentId: string) {
  logger.info(`[DeployService] Rolling back deployment ${deploymentId}`);
  try {
    // 1. Fetch deployment
    const deployment = await databases.getDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId);
    
    // 2. Perform rollback logic (Mocked)
    // e.g., kubectl rollout undo deployment/xyz -n scorpion-production
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 3. Update status
    await databases.updateDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId, {
      status: 'rolled-back',
      rolledBackAt: new Date().toISOString()
    });

    // 4. Notify
    await sendSlackNotification(SLACK_WEBHOOK_URL, {
      title: `Rollback Completed: ${deployment.environment}`,
      severity: 'HIGH',
      repository: deployment.repoId,
      rule: `Rolled back from ${deployment.imageTag}`
    }).catch(() => {});

    return { deploymentId, status: 'rolled-back' };
  } catch (error: any) {
    logger.error(`[DeployService] Rollback failed for ${deploymentId}`, error);
    throw error;
  }
}
