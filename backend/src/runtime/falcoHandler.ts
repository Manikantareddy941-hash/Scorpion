import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import axios from 'axios';
import { logRuntimeThreat } from '../services/logEvents';
import { runtimeThreats } from '../services/metrics';
import { withSpan } from '../services/tracing';
import { createIncident } from '../services/incidentService';
import { auditLog } from '../services/auditService';

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
    // Find the latest scan for this image
    let correlatedScanId = '';
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
            return latestScans.documents[0].$id;
          }
          return '';
        }
      );
    }

    // 2. Persist incident to Appwrite
    await databases.createDocument(DB_ID, COLLECTIONS.INCIDENTS, ID.unique(), {
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
    }

    // 3. Trigger Slack Alert
    if (process.env.SLACK_WEBHOOK_URL) {
      const priorityEmoji = event.priority === 'Critical' ? '🚨' : '⚠️';
      await axios.post(process.env.SLACK_WEBHOOK_URL, {
        text: `${priorityEmoji} *SCORPION Runtime Security Incident*\n\n*Rule*: ${event.rule}\n*Priority*: ${event.priority}\n*Container*: \`${containerId}\`\n*Image*: \`${containerImage}\`\n*Output*: \`${event.output}\`\n\n${correlatedScanId ? `🔍 *Correlated Scan Found*: [View in Dashboard](${process.env.FRONTEND_URL}/scans/${correlatedScanId})` : '❓ *No Correlation*: Image has not been pre-scanned.'}`
      });
    }

  } catch (error) {
    console.error('[Falco Handler] Failed to process runtime event:', error);
  }
}
