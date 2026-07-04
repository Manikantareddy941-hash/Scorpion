import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import axios from 'axios';
import { logRuntimeThreat } from '../services/logEvents';
import { runtimeThreats } from '../services/metrics';
import { withSpan } from '../services/tracing';
import { createIncident } from '../services/incidentService';
import { auditLog } from '../services/auditService';
import { sendSlackNotification } from '../services/slackService';
import { logger } from '../services/logger';
import { matchPlaybooks, normalizePriority } from '../soar/playbookMatcher';
import { soarRepository } from '../repositories/soarRepository';
import { enqueueSoarAction } from '../queues/soarQueue';
import { classifyEvent } from './falcoRuleCatalog';
import { falcoRuleRepository } from '../repositories/falcoRuleRepository';

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
  // --- classification gate (Component 2) ---
  // Fail-secure: any error here means no suppression, no override — the event
  // proceeds untouched. Classification must never break incident creation.
  let effectiveEvent = event;
  try {
    const managedRules = await falcoRuleRepository.listRules();
    const classification = classifyEvent(
      { rule: event.rule, containerImage: event.output_fields?.['container.image.repository'] || 'unknown' },
      managedRules,
    );
    if (classification.suppressed) {
      await auditLog({
        action: 'falco.event.suppressed',
        actor: 'system',
        actorEmail: 'system@scorpion',
        resource: 'falco_event',
        details: { rule: event.rule, image: event.output_fields?.['container.image.repository'] ?? 'unknown' },
      }).catch(() => undefined);
      logger.info(`[Falco Handler] Suppressed event '${event.rule}' by managed rule`);
      return;
    }
    if (classification.overridePriority) {
      effectiveEvent = { ...event, priority: classification.overridePriority };
    }
  } catch (err) {
    logger.error('[Falco Handler] Classification failed (event processed unmodified):', err);
    effectiveEvent = event;
  }

  const containerId = effectiveEvent.output_fields?.['container.id'] || 'unknown';
  const containerImage = effectiveEvent.output_fields?.['container.image.repository'] || 'unknown';

  logger.info(`[Falco Handler] Processing incident: ${effectiveEvent.rule} on ${containerImage}`);

  try {
    // 1. Correlate with existing scan data
    let correlatedScanId = '';
    let ownerUserId = '';
    
    if (containerImage !== 'unknown') {
      correlatedScanId = await withSpan(
        'runtime.correlate',
        { rule: effectiveEvent.rule, priority: effectiveEvent.priority, image: containerImage },
        async () => {
          const latestScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repoUrl', containerImage),
            Query.orderDesc('$createdAt'),
            Query.limit(1)
          ]);
          
          if (latestScans.documents.length > 0) {
            logger.info(`[Falco Handler] Correlated with scan: ${latestScans.documents[0].$id}`);
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
      rule: effectiveEvent.rule,
      priority: effectiveEvent.priority,
      output: effectiveEvent.output,
      container_id: containerId,
      container_image: containerImage,
      status: 'open',
      timestamp: effectiveEvent.time || new Date().toISOString(),
      correlated_scan_id: correlatedScanId,
      ...(ownerUserId ? { user_id: ownerUserId } : {})
    });

    await auditLog({
      action: 'incident.created',
      actor: 'system',
      actorEmail: 'system@scorpion',
      resource: 'incident',
      details: {
        rule: effectiveEvent.rule,
        priority: effectiveEvent.priority,
        image: containerImage
      }
    });

    // Loki Logging
    logRuntimeThreat(effectiveEvent.rule, effectiveEvent.priority, containerImage, !!correlatedScanId);

    // Metrics
    runtimeThreats.inc({ priority: effectiveEvent.priority.toLowerCase() });

    // Incident Response
    if (effectiveEvent.priority === 'Critical' || effectiveEvent.priority === 'Error') {
      await createIncident({
        title: `Runtime threat: ${effectiveEvent.rule}`,
        severity: effectiveEvent.priority,
        source: 'falco',
        relatedScanId: correlatedScanId,
        description: effectiveEvent.output,
        userId: ownerUserId || undefined
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
                     title: `Runtime threat: ${effectiveEvent.rule}`,
                     repository: containerImage,
                     severity: effectiveEvent.priority,
                     rule: effectiveEvent.rule,
                     incidentId: incidentDoc.$id
                 });
                 logger.info('[Falco Handler] Dynamic Slack notification dispatched successfully.');
             }
         }
      }
    }

    // SOAR dispatch runs LAST so a slow Appwrite write can never delay the
    // time-sensitive Critical/Error alerting above; errors are swallowed here.
    await dispatchSoar(effectiveEvent, incidentDoc.$id, containerImage, ownerUserId || undefined).catch((err) =>
      logger.error('[Falco Handler] SOAR dispatch failed (incident path unaffected):', err),
    );

  } catch (error) {
    logger.error('[Falco Handler] Failed to process runtime event:', error);
  }
}

async function dispatchSoar(
  event: FalcoEvent,
  incidentId: string,
  containerImage: string,
  ownerUserId?: string,
): Promise<void> {
  const playbooks = await soarRepository.listPlaybooks(); // [] on failure (fail-secure)
  const priority = normalizePriority(event.priority);
  const matched = matchPlaybooks({ rule: event.rule, priority }, playbooks);
  if (matched.length === 0) return;

  const namespace = event.output_fields?.['k8s.ns.name'] as string | undefined;
  const podName = event.output_fields?.['k8s.pod.name'] as string | undefined;

  for (const m of matched) {
    const record = await soarRepository.createAction({
      incidentId,
      actionType: m.type,
      playbookId: m.playbookId,
      playbookName: m.playbookName,
      status: m.execution === 'auto' ? 'approved' : 'pending',
      namespace,
      podName,
      ownerUserId,
      containerImage,
      falcoRule: event.rule,
    });
    if (m.execution === 'auto') {
      await enqueueSoarAction({ actionId: record.id, falcoEventJson: JSON.stringify(event), ownerUserId });
    }
  }
  logger.info(`[Falco Handler] SOAR dispatched ${matched.length} action(s) for '${event.rule}'`);
}
