import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { ID, Models } from 'node-appwrite';
import { logger } from './logger';

export type AuditAction =
  | 'scan.created' | 'scan.deleted'
  | 'incident.created' | 'incident.resolved'
  | 'compliance.evaluated'
  | 'user.login' | 'user.logout'
  | 'gate.blocked' | 'rollback.triggered'
  | 'evidence.exported'
  | 'build.triggered' | 'build.completed' | 'build.cancelled'
  | 'threat_model.created' | 'threat_model.updated' | 'threat_model.deleted' | 'threat_model.analyzed'
  | 'canary.started' | 'canary.promoted' | 'canary.rolled_back' | 'canary.aborted'
  | 'soar.capture_evidence' | 'soar.slack_escalate' | 'soar.isolate_pod' | 'soar.kill_pod'
  | 'falco.event.suppressed';

export async function auditLog({
  action, actor, actorEmail, resource,
  resourceId, details, ipAddress
}: {
  action: AuditAction;
  actor: string;
  actorEmail: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
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

export interface EvidenceExport {
  exportedAt: string;
  scans: Models.Document[];
  vulnerabilities: Models.Document[];
  incidents: Models.Document[];
  complianceControls: Models.Document[];
}

export async function exportEvidence(scanIds: string[]): Promise<EvidenceExport> {
  const evidence: EvidenceExport = {
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
