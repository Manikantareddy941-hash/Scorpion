import { ticketsRepository, type TenantScope } from '../repositories/ticketsRepository';

/**
 * Ownership is a separate argument rather than part of the validated body on
 * purpose: taking it from the request would let a caller create a ticket owned
 * by another user or team. It comes from the authenticated session only.
 */
export type TicketOwnership = { user_id: string; team_id: string | null };
import { setJiraConfig, getJiraConfig, pushTicketToJira, pullFromJira, testConnection } from './jiraService';
import { Ticket, TicketFilters, TicketLinkType } from '../../../shared/types';
import { CreateTicketInput, FromFindingInput, JiraConfigInput, UpdateTicketInput } from '../types/tickets.types';

function severityToPriority(severity: number): Ticket['priority'] {
  if (severity >= 9) return 'critical';
  if (severity >= 7) return 'high';
  if (severity >= 4) return 'medium';
  return 'low';
}

export const ticketsService = {
  listTickets(filters: TicketFilters, scope?: TenantScope) {
    return ticketsRepository.listTickets(filters, scope);
  },

  getStats(scope?: TenantScope) {
    return ticketsRepository.getStats(scope);
  },

  getRedactedJiraConfig() {
    const config = getJiraConfig();
    if (!config) return { configured: false };
    return {
      configured: true,
      baseUrl: config.baseUrl,
      email: config.email,
      projectKey: config.projectKey,
      defaultIssueType: config.defaultIssueType,
      apiToken: '********'
    };
  },

  saveJiraConfig(config: JiraConfigInput) {
    setJiraConfig(config);
  },

  testJiraConnection() {
    return testConnection();
  },

  getTicketByFinding(findingId: string) {
    return ticketsRepository.findByLinkedFinding(findingId);
  },

  getTicket(id: string) {
    return ticketsRepository.getTicket(id);
  },

  async createFromFinding(input: FromFindingInput, reporterEmail: string, ownership: TicketOwnership): Promise<{ conflict: true; ticket: Ticket } | { conflict: false; ticket: Ticket }> {
    const existingTicket = await ticketsRepository.findByLinkedFinding(input.findingId);
    if (existingTicket) {
      return { conflict: true, ticket: existingTicket };
    }

    const severity = input.severity !== undefined ? Number(input.severity) : 0;

    const ticket = await ticketsRepository.createTicket({
      title: input.title,
      description: input.description,
      status: 'todo',
      priority: severityToPriority(severity),
      type: input.type || 'vulnerability',
      severity,
      assignee: '',
      reporter: reporterEmail,
      tags: [],
      linkedFindings: [input.findingId],
      // Same tenancy stamp as createTicket — an ownerless ticket is
      // unreachable by everyone once the access guard runs.
      ...ownership
    });

    return { conflict: false, ticket };
  },

  async createTicket(input: CreateTicketInput, reporterEmail: string, ownership: TicketOwnership): Promise<{ conflict: true; ticket: Ticket } | { conflict: false; ticket: Ticket }> {
    const linkedFindings = Array.isArray(input.linkedFindings) ? input.linkedFindings : [];

    for (const findingId of linkedFindings) {
      const existingTicket = await ticketsRepository.findByLinkedFinding(findingId);
      if (existingTicket) {
        return { conflict: true, ticket: existingTicket };
      }
    }

    const ticket = await ticketsRepository.createTicket({
      title: input.title,
      description: input.description,
      status: input.status || 'todo',
      priority: input.priority || 'medium',
      type: input.type || 'task',
      severity: input.severity !== undefined ? Number(input.severity) : 0,
      assignee: input.assignee || '',
      reporter: reporterEmail,
      tags: Array.isArray(input.tags) ? input.tags : [],
      linkedFindings,
      storyPoints: input.storyPoints !== undefined ? Number(input.storyPoints) : undefined,
      dueDate: input.dueDate,
      epicLink: input.epicLink,
      sprintId: input.sprintId,
      // Tenancy stamp from the route. Dropping these would leave the ticket
      // ownerless, and the access guard denies ownerless tickets to everyone.
      ...ownership
    });

    return { conflict: false, ticket };
  },

  updateTicket(id: string, updates: UpdateTicketInput, actorEmail: string) {
    const patch: Partial<Ticket> = {
      ...updates,
      severity: updates.severity !== undefined ? Number(updates.severity) : undefined,
      storyPoints: updates.storyPoints !== undefined ? Number(updates.storyPoints) : undefined
    };
    return ticketsRepository.updateTicket(id, patch, actorEmail);
  },

  deleteTicket(id: string) {
    return ticketsRepository.deleteTicket(id);
  },

  addLink(id: string, targetId: string, type: TicketLinkType, actorEmail: string) {
    return ticketsRepository.addLink(id, targetId, type, actorEmail);
  },

  removeLink(id: string, targetId: string, actorEmail: string) {
    return ticketsRepository.removeLink(id, targetId, actorEmail);
  },

  getComments(id: string) {
    return ticketsRepository.getComments(id);
  },

  addComment(id: string, body: string, authorEmail: string) {
    return ticketsRepository.addComment(id, body, authorEmail);
  },

  getActivity(id: string) {
    return ticketsRepository.getActivity(id);
  },

  async bulkSyncToJira() {
    const unsynced = await ticketsRepository.getUnsyncedTickets();
    const results: Array<{ ticketId: string; ok: boolean; jiraKey?: string; jiraId?: string; error?: string }> = [];
    let synced = 0;
    let failed = 0;

    for (const ticket of unsynced) {
      try {
        const syncResult = await pushTicketToJira(ticket.id);
        results.push({ ticketId: ticket.id, ...syncResult });
        if (syncResult.ok) synced++; else failed++;
      } catch (err) {
        failed++;
        results.push({ ticketId: ticket.id, ok: false, error: err instanceof Error ? err.message : 'Error during sync' });
      }
    }

    return { total: unsynced.length, synced, failed, results };
  },

  syncTicketToJira(id: string) {
    return pushTicketToJira(id);
  },

  pullTicketFromJira(jiraKey: string) {
    return pullFromJira(jiraKey);
  }
};
