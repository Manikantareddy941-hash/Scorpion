import { randomUUID } from 'crypto';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { planRepository } from '../repositories/planRepository';
import { assertProjectAccess, severityToPriority } from './planService';
import { canAccessIncident } from './tenancyService';
import { Issue } from '../types/plan.types';
import { logger, errorContext } from './logger';

export interface IncidentDoc {
  $id: string; title: string; severity: string; user_id?: string; repo_id?: string; status?: string;
  rootCause?: string; escapedPhase?: string; lessons?: string; actionItemIssueId?: string;
}

function lessonsToChecklist(lessons?: string): string {
  const lines = (lessons || '').split('\n').map((l) => l.trim().replace(/^[-*]\s*/, '')).filter(Boolean);
  if (lines.length === 0) return '- [ ] Define and implement the remediation';
  return lines.map((l) => `- [ ] ${l}`).join('\n');
}

// Pure: resolved incident's post-mortem -> Plan-phase security story.
export function buildIncidentIssueFields(incident: IncidentDoc, projectId: string): Issue {
  return {
    $id: `issue-${randomUUID()}`,
    projectId,
    title: `[Post-mortem] ${incident.title}`,
    type: 'story',
    priority: severityToPriority(incident.severity),
    storyPoints: 3,
    description:
      `**Root cause:** ${incident.rootCause || 'N/A'}\n` +
      `**Escaped at phase:** ${incident.escapedPhase || 'unknown'}\n\n` +
      `**Action items (lessons learned):**\n${lessonsToChecklist(incident.lessons)}`,
    createdAt: new Date().toISOString(),
    status: 'todo',
    timeLogged: 0,
    labels: ['security', 'incident-response', `escaped:${incident.escapedPhase || 'unknown'}`],
  };
}

export async function convertIncidentToIssue(
  projectId: string, incidentId: string, userId?: string,
): Promise<'forbidden' | 'not_found' | 'not_resolved' | 'no_postmortem' | { ok: true; issueId: string }> {
  if (!(await assertProjectAccess(projectId, userId))) return 'forbidden';

  let incident: IncidentDoc;
  try {
    incident = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, incidentId) as unknown as IncidentDoc;
  } catch (err) {
    logger.error('[incidentFeedback] getDocument failed', { event: 'INCIDENT_FEEDBACK_READ_FAILED', ...errorContext(err) });
    return 'not_found';
  }
  if (!(await canAccessIncident(incident as unknown as Record<string, unknown>, userId))) return 'forbidden';
  if (incident.status !== 'resolved') return 'not_resolved';
  if (!incident.rootCause) return 'no_postmortem';
  if (incident.actionItemIssueId) return { ok: true, issueId: incident.actionItemIssueId }; // idempotent

  const issue = await planRepository.createIssue(buildIncidentIssueFields(incident, projectId));
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.INCIDENTS, incidentId, { actionItemIssueId: issue.$id });
  } catch (err) {
    // Issue exists but the link-back failed: log loudly; a retry will create a
    // duplicate only if this write keeps failing (acceptable at-least-once).
    logger.error('[incidentFeedback] failed to link issue back to incident', {
      event: 'INCIDENT_ISSUE_LINK_FAILED', ...errorContext(err),
    });
  }
  return { ok: true, issueId: issue.$id };
}
