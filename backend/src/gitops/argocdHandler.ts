import { scanImage } from '../scanners/imageScanner';
import { evaluatePolicy } from '../github/policyEngine';
import { triggerRollback } from './rollbackService';
import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { logDeployBlocked, logRollbackTriggered } from '../services/logEvents';
import { deploymentBlocks, scansTotal } from '../services/metrics';
import { withSpan } from '../services/tracing';
import { createIncident } from '../services/incidentService';
import axios from 'axios';
import { auditLog } from '../services/auditService';

export interface ArgoCDSyncPayload {
  app: string;
  image: string;
  revision: string;
  repo: string;
  namespace: string;
}

export async function handleArgoCDSync(payload: ArgoCDSyncPayload) {
  console.log(`[ArgoCD Handler] Processing sync event for ${payload.app} (${payload.image})`);
  
  try {
    // 1. Scan the deployed image using Trivy
    // In a real K8s environment, Trivy would need access to the registry
    const scanResult = await withSpan(
      'gitops.image_scan',
      { app: payload.app, image: payload.image },
      () => scanImage(payload.image)
    );
    
    // 2. Evaluate against policy
    // We wrap image results to match the policy engine's expected structure
    const policyResult = evaluatePolicy({
      trivy: { Results: [{ Vulnerabilities: scanResult.vulnerabilities }] },
      gitleaks: [], // Image scans usually focus on CVEs
      semgrep: { results: [] }
    });
    
    const { passed, criticalCount, highCount } = policyResult;
    
    // 3. Persist deployment scan to Appwrite
    await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), {
      repoUrl: payload.repo,
      repo_id: payload.app, // Use app name as ID for deployment tracking
      status: 'completed',
      scanType: 'gitops_deploy',
      scan_type: 'gitops_deploy',
      gateStatus: passed ? 'passed' : 'failed',
      criticalCount,
      highCount,
      details: JSON.stringify({
        image: payload.image,
        revision: payload.revision,
        namespace: payload.namespace,
        app: payload.app,
        passed,
        summary: policyResult.summary
      }),
      timestamp: new Date().toISOString()
    });

    scansTotal.inc({ scan_type: 'gitops_deploy', status: passed ? 'passed' : 'failed' });

    console.log(`[ArgoCD Handler] Deployment policy evaluation: ${passed ? 'PASSED' : 'FAILED'}`);

    if (!passed) {
      deploymentBlocks.inc();
      logDeployBlocked(payload.app, payload.image, criticalCount);

      // Create Security Incident
      await createIncident({
        title: `Deployment blocked: ${payload.app}`,
        severity: 'Critical',
        source: 'gitops',
        description: `Detected ${criticalCount} critical vulnerabilities in image: ${payload.image}`
      });

      // 4. Trigger automated rollback PR
      await triggerRollback({
        app: payload.app,
        image: payload.image,
        revision: payload.revision,
        repo: payload.repo,
        criticalCount
      });
      logRollbackTriggered(payload.app, payload.revision);
      
      await auditLog({
        action: 'rollback.triggered',
        actor: 'system',
        actorEmail: 'system@scorpion',
        resource: 'deployment',
        resourceId: payload.revision,
        details: { 
          app: payload.app, 
          image: payload.image, 
          criticalCount 
        }
      });
      
      // 5. Alert via Slack (if configured)
      if (process.env.SLACK_WEBHOOK_URL) {
        await axios.post(process.env.SLACK_WEBHOOK_URL, {
          text: `🚨 *SCORPION Security Alert: Deployment Blocked*\n\n*App*: ${payload.app}\n*Namespace*: ${payload.namespace}\n*Image*: \`${payload.image}\`\n*Result*: ❌ FAILED Security Gate\n*Reason*: Detected ${criticalCount} critical vulnerabilities.\n\n🔄 *Automated Rollback PR has been initiated.*`
        });
      }
    }

  } catch (error: any) {
    console.error(`[ArgoCD Handler] Error processing sync:`, error);
  }
}
