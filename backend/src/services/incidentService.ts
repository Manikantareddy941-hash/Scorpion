import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { sendSlackNotification } from './slackService';
import { freezeReleaseGateForIncident, isCriticalSeverity } from './incidentActionService';
import { logger } from './logger';

const notifySlack = async (payload: { title: string; severity: string; source: string; incidentId: string }) => {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.info('[Incident Service] SLACK_WEBHOOK_URL not configured, skipping Slack notification');
    return;
  }
  try {
    await sendSlackNotification(webhookUrl, {
      title: payload.title,
      severity: payload.severity,
      rule: payload.source,
      incidentId: payload.incidentId,
    });
  } catch (err) {
    logger.error('[Incident Service] Failed to send Slack notification:', err);
  }
};

export interface Incident {
  title: string;
  severity: string;
  source: 'falco' | 'ci_pipeline' | 'gitops' | 'soar';
  relatedScanId?: string;
  description: string;
  // Owning user, when derivable (e.g. correlated from a scan's repo owner).
  // Left unset for sources that don't yet resolve to a platform user
  // (raw GitOps/ArgoCD app names aren't linked to repository records) --
  // such incidents are intentionally invisible via the regular incidents
  // API until that integration exists, rather than visible to everyone.
  userId?: string;
}

export async function createIncident(incident: Incident) {
  try {
    const { userId, ...rest } = incident;
    const doc = await databases.createDocument(
      DB_ID,
      COLLECTIONS.INCIDENTS,
      ID.unique(),
      {
        ...rest,
        ...(userId ? { user_id: userId } : {}),
        status: 'open',
        timestamp: new Date().toISOString() // for legacy field
      }
    );

    await notifySlack({
      title: incident.title,
      severity: incident.severity,
      source: incident.source,
      incidentId: doc.$id,
    });

    if (isCriticalSeverity(incident.severity)) {
      await freezeReleaseGateForIncident(`${incident.source} incident "${incident.title}" (${doc.$id})`);
    }

    logger.error('incident_created', {
      event: 'incident_created',
      id: doc.$id,
      ...incident
    });

    return doc;
  } catch (error) {
    logger.error('[Incident Service] Failed to create incident:', error);
    throw error;
  }
}

export async function updateIncidentStatus(
  id: string,
  status: 'investigating' | 'resolved',
  assignee?: string
) {
  return databases.updateDocument(DB_ID, COLLECTIONS.INCIDENTS, id, {
    status,
    ...(assignee && { assignee }),
    ...(status === 'resolved' && { resolvedAt: new Date().toISOString() })
  });
}
