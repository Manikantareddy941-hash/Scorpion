import { databases, COLLECTIONS, DB_ID, ID, Query } from '../lib/appwrite';
import { sendSlackNotification } from './slackService';
import { logger, errorContext, errorMessage } from './logger';
import axios from 'axios';
import { isAppwriteError } from '../utils/errorGuards';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

// In-memory state tracking to prevent duplicate alerting storms
const previousStatus = new Map<string, 'up' | 'down'>();

/**
 * Perform ping check on a URL and record the health metrics
 */
export async function checkDeploymentUptime(deployment: any) {
  const deploymentId = deployment.$id;
  const repoId = deployment.repoId;
  const environment = deployment.environment;
  
  // Resolve hostPort from environment fallback
  const hostPort = environment === 'production' ? 8083 : environment === 'staging' ? 8082 : 8081;
  const url = deployment.healthCheckUrl || `http://localhost:${hostPort}`;

  const startTime = Date.now();
  let isUp = false;
  let latency = 0;

  try {
    const res = await axios.get(url, { timeout: 5000 });
    latency = Date.now() - startTime;
    if (res.status >= 200 && res.status < 400) {
      isUp = true;
    }
  } catch (err) {
    latency = Date.now() - startTime;
    logger.warn(`[MonitorService] Health check failed for ${url}: ${errorMessage(err)}`);
  }

  const status = isUp ? 'up' : 'down';
  const key = `${repoId}-${environment}`;
  const lastState = previousStatus.get(key) || 'up';

  try {
    // Helper to sanitize URLs containing credentials
    const sanitizeUrl = (u: string): string => u.replace(/https:\/\/[^@]+@/, 'https://**REDACTED**@');
    const sanitizedUrl = sanitizeUrl(url);
    if (!deployment.healthCheckUrl) {
      await databases.updateDocument(DB_ID, 'deployments', deploymentId, {
        healthCheckUrl: sanitizedUrl
      });
    }

    await databases.createDocument(DB_ID, 'health_checks', ID.unique(), {
      repoId,
      deploymentId,
      url: sanitizedUrl,
      status,
      latency,
      timestamp: new Date().toISOString()
    });

    // 2. Alert on transition to down
    if (status === 'down' && lastState === 'up') {
      logger.warn(`[MonitorService] Transition to DOWN detected for ${key}! Sending alert... URL: ${sanitizedUrl}`);
      
      if (SLACK_WEBHOOK_URL) {
        await sendSlackNotification(SLACK_WEBHOOK_URL, {
          title: `🚨 SERVICE DOWN: ${repoId} in ${environment}`,
          severity: 'CRITICAL',
          repository: repoId,
          rule: `Uptime SLA check failed. Container URL ${sanitizedUrl} returned error or timed out.`
        }).catch((e) => logger.error(`[MonitorService] Alert failed:`, e));
      }

      // Persist status to deployment_status collection (upsert)
      try {
        await databases.createDocument(DB_ID, 'deployment_status', deploymentId, {
          deploymentId,
          repoId,
          environment,
          status,
          lastUpdated: new Date().toISOString()
        });
      } catch (e) {
        if (isAppwriteError(e) && e.code === 409) {
          // Update existing status document
          await databases.updateDocument(DB_ID, 'deployment_status', deploymentId, {
            status,
            lastUpdated: new Date().toISOString()
          });
        } else {
          logger.error(`[MonitorService] Failed to persist ${status} status:`, e);
        }
      }
    }

    // 3. Alert on recovery (transition back to up) and clear the stale "down" status
    if (status === 'up' && lastState === 'down') {
      logger.info(`[MonitorService] Transition to UP detected for ${key}. Service recovered.`);

      if (SLACK_WEBHOOK_URL) {
        await sendSlackNotification(SLACK_WEBHOOK_URL, {
          title: `✅ SERVICE RECOVERED: ${repoId} in ${environment}`,
          severity: 'LOW',
          repository: repoId,
          rule: `Uptime SLA check passed again. Container URL ${sanitizedUrl} is responding.`
        }).catch((e) => logger.error(`[MonitorService] Recovery alert failed:`, e));
      }

      try {
        await databases.updateDocument(DB_ID, 'deployment_status', deploymentId, {
          status,
          lastUpdated: new Date().toISOString()
        });
      } catch (e) {
        logger.error(`[MonitorService] Failed to clear stale down status:`, e);
      }
    }

    previousStatus.set(key, status);
  } catch (err) {
    logger.error(`[MonitorService] Error recording health check:`, err);
  }
}

/**
 * Main orchestrator of scheduled health checks
 */
export async function runUptimeMonitor() {
  try {
    // Fetch all active successful deployments
    const deployments = await databases.listDocuments(DB_ID, 'deployments', [
      Query.equal('status', 'success'),
      Query.limit(50)
    ]);

    // Group deployments by repoId and environment to check only the latest active one
    const uniqueDeployments = new Map<string, any>();
    deployments.documents.forEach(d => {
      const key = `${d.repoId}-${d.environment}`;
      const existing = uniqueDeployments.get(key);
      if (!existing || new Date(d.$createdAt) > new Date(existing.$createdAt)) {
        uniqueDeployments.set(key, d);
      }
    });

    for (const deployment of uniqueDeployments.values()) {
      await checkDeploymentUptime(deployment);
    }
  } catch (err) {
    logger.error('[MonitorService] uptime monitor run failed', {
        event: 'UPTIME_MONITOR_FAILED',
        ...errorContext(err),
    });
  }
}

/**
 * Initialize uptime scheduler (every 30 seconds)
 */
export function initUptimeScheduler() {
  logger.info(`[MonitorService] Uptime Monitor Scheduler initialized.`);
  setInterval(runUptimeMonitor, 30000);
}
