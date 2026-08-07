import axios from 'axios';
import { JiraConfig, JiraSyncResult, Ticket } from '../../../shared/types';
import { ticketsRepository } from '../repositories/ticketsRepository';
import { logger, errorContext } from './logger';

const { getTicket, updateTicket, listTickets } = ticketsRepository;

// In-memory JiraConfig store
let currentJiraConfig: JiraConfig | null = null;

export function getJiraConfig(): JiraConfig | null {
  return currentJiraConfig;
}

export function setJiraConfig(config: JiraConfig): void {
  currentJiraConfig = config;
}

/**
 * Shared API request helper building Base URL and Authorization Headers
 */
async function jiraRequest(method: string, path: string, body?: any) {
  if (!currentJiraConfig) {
    throw new Error('Jira is not configured. Please set your Jira Credentials.');
  }

  const { baseUrl, email, apiToken } = currentJiraConfig;
  const cleanedBaseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  const url = `${cleanedBaseUrl}${path}`;
  const authHeader = Buffer.from(`${email}:${apiToken}`).toString('base64');

  const headers: Record<string, string> = {
    'Authorization': `Basic ${authHeader}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  const response = await axios({
    method,
    url,
    headers,
    data: body,
    timeout: 8000 // 8 second timeout
  });

  return response.data;
}

/**
 * Map internal priority to Jira priority name
 */
function mapPriorityToJira(priority: Ticket['priority']): string {
  switch (priority) {
    case 'critical': return 'Highest';
    case 'high': return 'High';
    case 'medium': return 'Medium';
    case 'low': return 'Low';
    default: return 'Medium';
  }
}

/**
 * Map Jira priority name to internal priority
 */
function mapPriorityFromJira(jiraPriorityName: string): Ticket['priority'] {
  const p = jiraPriorityName.toLowerCase();
  if (p === 'highest' || p === 'critical') return 'critical';
  if (p === 'high') return 'high';
  if (p === 'medium' || p === 'default') return 'medium';
  if (p === 'low' || p === 'lowest') return 'low';
  return 'medium';
}

/**
 * Map internal status to Jira status transition names
 */
function mapStatusToJiraTransitionName(status: Ticket['status']): string {
  switch (status) {
    case 'todo': return 'To Do';
    case 'in_progress': return 'In Progress';
    case 'in_review': return 'In Review';
    case 'done': return 'Done';
    case 'closed': return 'Closed';
    default: return 'To Do';
  }
}

/**
 * Map Jira status category or name back to internal status
 */
function mapStatusFromJira(jiraStatusName: string): Ticket['status'] {
  const s = jiraStatusName.toLowerCase();
  if (s === 'to do' || s === 'open' || s === 'backlog' || s === 'new') return 'todo';
  if (s === 'in progress' || s === 'started' || s === 'dev') return 'in_progress';
  if (s === 'in review' || s === 'qa' || s === 'testing') return 'in_review';
  if (s === 'done' || s === 'resolved' || s === 'completed') return 'done';
  if (s === 'closed') return 'closed';
  return 'todo';
}

/**
 * Converts description text to Atlassian Document Format (ADF)
 */
function convertToADF(text: string) {
  return {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: text || 'No description provided.'
          }
        ]
      }
    ]
  };
}

/**
 * Push local ticket update to Jira (create or update issue)
 */
export async function pushTicketToJira(ticketId: string): Promise<JiraSyncResult> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) {
      return { ok: false, error: `Ticket with ID ${ticketId} not found.` };
    }

    if (!currentJiraConfig) {
      return { ok: false, error: 'Jira integration is not configured.' };
    }

    const { projectKey, defaultIssueType } = currentJiraConfig;
    const jiraPriority = mapPriorityToJira(ticket.priority);

    // Prepare fields
    const fields: any = {
      project: { key: projectKey },
      summary: ticket.title,
      description: convertToADF(ticket.description),
      issuetype: { name: defaultIssueType },
      priority: { name: jiraPriority },
      labels: [
        'scorpion-security',
        ticket.type,
        ...ticket.tags.map((t: string) => t.replace(/[^a-zA-Z0-9-_]/g, '')), // Clean labels
        ...ticket.linkedFindings.map((f: string) => `finding-${f}`)
      ]
    };

    let jiraKey = ticket.jiraKey;
    let jiraId = ticket.jiraId;

    if (!jiraKey) {
      // Create new Jira issue
      const response = await jiraRequest('POST', '/rest/api/3/issue', { fields });
      jiraKey = response.key;
      jiraId = response.id;

      if (!jiraKey) {
        throw new Error('Jira response did not return an issue key.');
      }

      await updateTicket(ticketId, {
        jiraKey,
        jiraId,
        jiraSyncedAt: new Date().toISOString(),
        jiraSyncStatus: 'synced'
      }, 'Jira Sync Engine');

      // Now if the status is not 'todo', perform transition
      if (ticket.status !== 'todo') {
        await transitionJiraIssue(jiraKey, ticket.status);
      }
    } else {
      // Update existing Jira issue
      const updatePayload = {
        fields: {
          summary: fields.summary,
          description: fields.description,
          priority: fields.priority,
          labels: fields.labels
        }
      };
      await jiraRequest('PUT', `/rest/api/3/issue/${jiraKey}`, updatePayload);

      // Transition check
      await transitionJiraIssue(jiraKey, ticket.status);

      await updateTicket(ticketId, {
        jiraSyncedAt: new Date().toISOString(),
        jiraSyncStatus: 'synced'
      }, 'Jira Sync Engine');
    }

    return { ok: true, jiraKey, jiraId };
  } catch (err: any) {
    logger.error('Error syncing to Jira', {
      // The Jira error body is an object and survived winston on its own; the
      // `.message` fallback did not. Both are recorded now, so a transport
      // failure and a rejected payload no longer look the same in the log.
      jiraResponse: err?.response?.data,
      ...errorContext(err),
    });
    const errorMsg = err?.response?.data?.errorMessages?.join(', ') || 
                     JSON.stringify(err?.response?.data?.errors) || 
                     err.message;
    
    // Update local ticket sync status to error
    await updateTicket(ticketId, {
      jiraSyncStatus: 'error'
    }, 'Jira Sync Engine');

    return { ok: false, error: errorMsg };
  }
}

/**
 * Dynamic transition executor
 */
async function transitionJiraIssue(jiraKey: string, targetStatus: Ticket['status']): Promise<void> {
  try {
    // 1. Fetch available transitions
    const transitionsData = await jiraRequest('GET', `/rest/api/3/issue/${jiraKey}/transitions`);
    const transitions: any[] = transitionsData.transitions || [];

    // 2. Find target transition by mapping name
    const targetTransitionName = mapStatusToJiraTransitionName(targetStatus);
    
    // Try exact case-insensitive match on name
    let transition = transitions.find(t => t.name.toLowerCase() === targetTransitionName.toLowerCase());
    
    // Fallback matches (e.g. "Done", "Resolved", "Close Issue", "Start Progress")
    if (!transition) {
      if (targetStatus === 'in_progress') {
        transition = transitions.find(t => t.name.toLowerCase().includes('progress') || t.name.toLowerCase().includes('start'));
      } else if (targetStatus === 'done' || targetStatus === 'closed') {
        transition = transitions.find(t => t.name.toLowerCase().includes('done') || t.name.toLowerCase().includes('resolve') || t.name.toLowerCase().includes('close'));
      } else if (targetStatus === 'todo') {
        transition = transitions.find(t => t.name.toLowerCase().includes('to do') || t.name.toLowerCase().includes('reopen'));
      }
    }

    // 3. Execute transition if found
    if (transition) {
      await jiraRequest('POST', `/rest/api/3/issue/${jiraKey}/transitions`, {
        transition: { id: transition.id }
      });
    } else {
      logger.warn(`Jira transition for status "${targetStatus}" (Mapped: "${targetTransitionName}") not found on issue ${jiraKey}.`);
    }
  } catch (err: any) {
    logger.error(`Failed to transition Jira issue ${jiraKey}`, {
      // The Jira error body is an object and survived winston on its own; the
      // `.message` fallback did not. Both are recorded now, so a transport
      // failure and a rejected payload no longer look the same in the log.
      jiraResponse: err?.response?.data,
      ...errorContext(err),
    });
  }
}

/**
 * Fetch issue from Jira and update internal ticket
 */
export async function pullFromJira(jiraKey: string): Promise<{ ok: boolean; ticket?: Ticket; error?: string }> {
  try {
    if (!currentJiraConfig) {
      return { ok: false, error: 'Jira integration is not configured.' };
    }

    // Find the local ticket with this jiraKey
    const paginatedTickets = await listTickets({ search: jiraKey, page: 1, limit: 100 });
    const localTicket = paginatedTickets.data.find((t: Ticket) => t.jiraKey === jiraKey);

    if (!localTicket) {
      return { ok: false, error: `No internal ticket found with Jira Key: ${jiraKey}` };
    }

    // Fetch details from Jira
    const issueData = await jiraRequest('GET', `/rest/api/3/issue/${jiraKey}`);
    const fields = issueData.fields;

    if (!fields) {
      return { ok: false, error: `Jira issue ${jiraKey} returned invalid fields.` };
    }

    // Map fields back
    const mappedStatus = mapStatusFromJira(fields.status?.name || 'To Do');
    const mappedPriority = mapPriorityFromJira(fields.priority?.name || 'Medium');
    
    // Parse labels back as tags
    const jiraLabels: string[] = fields.labels || [];
    const tags = jiraLabels.filter(label => !label.startsWith('finding-') && label !== 'scorpion-security');

    // Update internal ticket
    const updated = await updateTicket(localTicket.id, {
      status: mappedStatus,
      priority: mappedPriority,
      tags: tags.length > 0 ? tags : localTicket.tags,
      jiraSyncedAt: new Date().toISOString(),
      jiraSyncStatus: 'synced'
    }, 'Jira Sync Engine (Webhook/Pull)');

    return { ok: true, ticket: updated };
  } catch (err: any) {
    logger.error(`Error pulling from Jira for ${jiraKey}`, {
      // The Jira error body is an object and survived winston on its own; the
      // `.message` fallback did not. Both are recorded now, so a transport
      // failure and a rejected payload no longer look the same in the log.
      jiraResponse: err?.response?.data,
      ...errorContext(err),
    });
    const errorMsg = err?.response?.data?.errorMessages?.join(', ') || err.message;
    return { ok: false, error: errorMsg };
  }
}

/**
 * Verify credentials
 */
export async function testConnection(): Promise<{ ok: boolean; projectName?: string; error?: string }> {
  try {
    if (!currentJiraConfig) {
      return { ok: false, error: 'Jira integration credentials are not set.' };
    }

    const { projectKey } = currentJiraConfig;
    const response = await jiraRequest('GET', `/rest/api/3/project/${projectKey}`);
    return { ok: true, projectName: response.name };
  } catch (err: any) {
    logger.error('Jira Connection Test Failed', {
      // The Jira error body is an object and survived winston on its own; the
      // `.message` fallback did not. Both are recorded now, so a transport
      // failure and a rejected payload no longer look the same in the log.
      jiraResponse: err?.response?.data,
      ...errorContext(err),
    });
    const errorMsg = err?.response?.data?.errorMessages?.join(', ') || 
                     JSON.stringify(err?.response?.data?.errors) || 
                     err.message;
    return { ok: false, error: errorMsg };
  }
}
