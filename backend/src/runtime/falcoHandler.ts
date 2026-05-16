import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import axios from 'axios';
import { logRuntimeThreat } from '../services/logEvents';
import { runtimeThreats } from '../services/metrics';
import { withSpan } from '../services/tracing';
import { createIncident } from '../services/incidentService';
import { auditLog } from '../services/auditService';
import { sendSlackNotification } from '../services/slackService';

export interface FalcoEvent {
  rule: string;
  priority: string;
  output: string;
  output_fields?: {
    'container.id'?: string;
    'container.image.repository'?: string;
    [key: string]: any;
  };
  time: string;
}

export async function handleFalcoEvent(event: FalcoEvent) {
  const containerId = event.output_fields?.['container.id'] || 'unknown';
  const containerImage = event.output_fields?.['container.image.repository'] || 'unknown';
  
  console.log(`[Falco Handler] Processing incident: ${event.rule} on ${containerImage}`);

  try {
    // 1. Correlate with existing scan data
    let correlatedScanId = '';
    let ownerUserId = '';
    
    if (containerImage !== 'unknown') {
      correlatedScanId = await withSpan(
        'runtime.correlate',
        { rule: event.rule, priority: event.priority, image: containerImage },
        async () => {
          const latestScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repoUrl', containerImage),
            Query.orderDesc('$createdAt'),
            Query.limit(1)
          ]);
          
          if (latestScans.documents.length > 0) {
            console.log(`[Falco Handler] Correlated with scan: ${latestScans.documents[0].$id}`);
            // Extract user_id from scan or repository to route the alert later
            const scanDoc = latestScans.documents[0];
            if (scanDoc.user_id) {
               ownerUserId = scanDoc.user_id;
            } else if (scanDoc.repo_id) {
               try {
                  const repoDoc = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, scanDoc.repo_id);
                  ownerUserId = repoDoc.user_id;
               } catch (e) {}
            }
            return scanDoc.$id;
          }
          return '';
        }
      );
    }

    // 2. Persist incident to Appwrite
    const incidentDoc = await databases.createDocument(DB_ID, COLLECTIONS.INCIDENTS, ID.unique(), {
      rule: event.rule,
      priority: event.priority,
      output: event.output,
      container_id: containerId,
      container_image: containerImage,
      status: 'open',
      timestamp: event.time || new Date().toISOString(),
      correlated_scan_id: correlatedScanId
    });

    await auditLog({
      action: 'incident.created',
      actor: 'system',
      actorEmail: 'system@scorpion',
      resource: 'incident',
      details: { 
        rule: event.rule, 
        priority: event.priority, 
        image: containerImage 
      }
    });

    // Loki Logging
    logRuntimeThreat(event.rule, event.priority, containerImage, !!correlatedScanId);

    // Metrics
    runtimeThreats.inc({ priority: event.priority.toLowerCase() });

    // Incident Response
    if (event.priority === 'Critical' || event.priority === 'Error') {
      await createIncident({
        title: `Runtime threat: ${event.rule}`,
        severity: event.priority,
        source: 'falco',
        relatedScanId: correlatedScanId,
        description: event.output
      });

      // 3. Trigger Slack Alert dynamically via INTEGRATIONS collection
      if (ownerUserId) {
         const integrationsRes = await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS, [
            Query.equal('userId', ownerUserId)
         ]);

         if (integrationsRes.total > 0) {
             const integration = integrationsRes.documents[0] as any;
             if (integration.isEnabled && integration.slack_webhook) {
                 await sendSlackNotification(integration.slack_webhook, {
                     title: `Runtime threat: ${event.rule}`,
                     repository: containerImage,
                     severity: event.priority,
                     rule: event.rule,
                     incidentId: incidentDoc.$id
                 });
                 console.log('[Falco Handler] Dynamic Slack notification dispatched successfully.');
             }
         }
      }
    }

  } catch (error) {
    console.error('[Falco Handler] Failed to process runtime event:', error);
  }
}
