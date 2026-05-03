import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { ID } from 'node-appwrite';
import { logger } from './logger';

export type AuditAction =
  | 'scan.created' | 'scan.deleted'
  | 'incident.created' | 'incident.resolved'
  | 'compliance.evaluated'
  | 'user.login' | 'user.logout'
  | 'gate.blocked' | 'rollback.triggered'
  | 'evidence.exported';

export async function auditLog({
  action, actor, actorEmail, resource,
  resourceId, details, ipAddress
}: {
  action: AuditAction;
  actor: string;
  actorEmail: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
}) {
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
      action,
      actor,
      actorEmail,
      resource,
      resourceId: resourceId ?? '',
      details: JSON.stringify(details ?? {}),
      ipAddress: ipAddress ?? '',
      timestamp: new Date().toISOString()
    });

    logger.info('audit_log', {
      event: 'audit_log',
      action,
      actor,
      resource,
      resourceId
    });
  } catch (err) {
    logger.error('audit_log_failed', { err });
  }
}

export async function exportEvidence(scanIds: string[]) {
  const evidence: any = {
    exportedAt: new Date().toISOString(),
    scans: [],
    vulnerabilities: [],
    incidents: [],
    complianceControls: []
  };

  for (const id of scanIds) {
    const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, id);
    evidence.scans.push(scan);
  }

  return evidence;
}
