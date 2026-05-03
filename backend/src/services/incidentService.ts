import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { notifySlack } from './notificationService';
import { logger } from './logger';

export interface Incident {
  title: string;
  severity: string;
  source: 'falco' | 'ci_pipeline' | 'gitops';
  relatedScanId?: string;
  description: string;
}

export async function createIncident(incident: Incident) {
  try {
    const doc = await databases.createDocument(
      DB_ID, 
      COLLECTIONS.INCIDENTS, 
      ID.unique(),
      { 
        ...incident, 
        status: 'open', 
        timestamp: new Date().toISOString() // for legacy field
      }
    );

    await notifySlack({
      message: `🚨 *New Security Incident Generated*\n\n*Title*: ${incident.title}\n*Severity*: ${incident.severity}\n*Source*: ${incident.source}\n*ID*: \`${doc.$id}\`\n\n[View in Dashboard](${process.env.FRONTEND_URL}/dashboard)`
    });

    logger.error('incident_created', {
      event: 'incident_created',
      id: doc.$id,
      ...incident
    });

    return doc;
  } catch (error) {
    console.error('[Incident Service] Failed to create incident:', error);
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
