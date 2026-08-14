import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { sendSlackNotification } from './slackService';
import { freezeReleaseGateForIncident, isCriticalSeverity } from './incidentActionService';
import { logger, errorContext } from './logger';

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
    logger.error('[Incident Service] Failed to send Slack notification:', { event: 'INCIDENT_SLACK_NOTIFY_FAILED', ...errorContext(err) });
  }
};

export interface Incident {
  title: string;
  severity: string;
  source: 'falco' | 'ci_pipeline' | 'gitops' | 'soar' | 'correlation' | 'apm';
  relatedScanId?: string;
  description: string;
  // Incident ownership is a union of two modes; a caller sets whichever applies:
  //  - repoId: repo-scoped incidents (deploy blocks, Falco runtime threats,
  //    leaked keys, ArgoCD gate) — visible to everyone with access to the repo.
  //  - userId: tenant-scoped incidents that belong to no single repo (APM
  //    auth-failure spikes, cross-tenant correlation) — visible to that user.
  // An incident with neither is intentionally invisible via the incidents API
  // (e.g. an unresolved Falco event) rather than visible to everyone.
  userId?: string;
  repoId?: string;
}

export async function createIncident(incident: Incident) {
  try {
    const { userId, repoId, ...rest } = incident;
    const doc = await databases.createDocument(
      DB_ID,
      COLLECTIONS.INCIDENTS,
      ID.unique(),
      {
        ...rest,
        ...(userId ? { user_id: userId } : {}),
        ...(repoId ? { repo_id: repoId } : {}),
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
    logger.error('[Incident Service] Failed to create incident:', { event: 'INCIDENT_CREATE_FAILED', ...errorContext(error) });
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
