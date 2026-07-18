import { Models } from 'node-appwrite';
import { Ticket, TicketComment, TicketActivity, TicketFilters, PaginatedResponse, TicketLink, TicketLinkType } from '../../../shared/types';
import crypto from 'crypto';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { logger } from '../services/logger';
import { isPostgresEnabled } from '../db/pool';
import { ticketsPgRepository } from './pg/ticketsPgRepository';

// In-memory stores for comments and activity log (these remain local for now)
const commentsMap = new Map<string, TicketComment[]>();
const activityMap = new Map<string, TicketActivity[]>();
const linksMap = new Map<string, TicketLink[]>();

type TicketDocument = Models.Document & {
  title: string;
  description: string;
  status: Ticket['status'];
  priority: Ticket['priority'];
  type: Ticket['type'];
  severity: number;
  assignee: string;
  reporter: string;
  tags?: string[];
  linkedFindings?: string[];
  storyPoints?: number;
  dueDate?: string;
  epicLink?: string;
  sprintId?: string;
  resolvedAt?: string;
  jiraKey?: string;
  jiraId?: string;
  jiraSyncedAt?: string;
  jiraSyncStatus?: 'synced' | 'error';
  slaDeadline?: string;
};

function mapDocumentToTicket(doc: TicketDocument): Ticket {
  return {
    id: doc.$id,
    title: doc.title,
    description: doc.description,
    status: doc.status,
    priority: doc.priority,
    type: doc.type,
    severity: doc.severity,
    assignee: doc.assignee,
    reporter: doc.reporter,
    tags: doc.tags || [],
    linkedFindings: doc.linkedFindings || [],
    storyPoints: doc.storyPoints,
    dueDate: doc.dueDate,
    epicLink: doc.epicLink,
    sprintId: doc.sprintId,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt,
    resolvedAt: doc.resolvedAt,
    jiraKey: doc.jiraKey,
    jiraId: doc.jiraId,
    jiraSyncedAt: doc.jiraSyncedAt,
    jiraSyncStatus: doc.jiraSyncStatus,
    slaDeadline: doc.slaDeadline,
    links: linksMap.get(doc.$id) || [],
  };
}

async function createTicket(ticketData: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'>): Promise<Ticket> {
  const now = new Date().toISOString();

  const data: Record<string, unknown> = {
    title: ticketData.title,
    description: ticketData.description,
    status: ticketData.status,
    priority: ticketData.priority,
    type: ticketData.type,
    severity: ticketData.severity !== undefined ? Number(ticketData.severity) : 0,
    assignee: ticketData.assignee || '',
    reporter: ticketData.reporter,
    tags: ticketData.tags || [],
    linkedFindings: ticketData.linkedFindings || [],
    storyPoints: ticketData.storyPoints || null,
    dueDate: ticketData.dueDate || null,
    epicLink: ticketData.epicLink || null,
    sprintId: ticketData.sprintId || null,
  };

  // Compute slaDeadline if not provided
  if (!ticketData.slaDeadline) {
    if (data.dueDate) {
      data.slaDeadline = data.dueDate;
    } else {
      const msInHour = 60 * 60 * 1000;
      let addedMs = 0;
      switch (data.priority) {
        case 'critical': addedMs = 24 * msInHour; break;
        case 'high': addedMs = 72 * msInHour; break;
        case 'medium': addedMs = 7 * 24 * msInHour; break;
        case 'low': addedMs = 30 * 24 * msInHour; break;
      }
      data.slaDeadline = addedMs > 0 ? new Date(Date.now() + addedMs).toISOString() : null;
    }
  } else {
    data.slaDeadline = ticketData.slaDeadline;
  }

  if (data.status === 'done' || data.status === 'closed') {
    data.resolvedAt = now;
  }

  const doc = await databases.createDocument(DB_ID, 'tickets', ID.unique(), data) as unknown as TicketDocument;

  const newTicket = mapDocumentToTicket(doc);
  linksMap.set(newTicket.id, ticketData.links || []);

  await recordActivity(newTicket.id, ticketData.reporter || 'System', 'created', {
    message: `Ticket created with title: "${newTicket.title}"`
  });

  return newTicket;
}

async function getTicket(id: string): Promise<Ticket | undefined> {
  try {
    const doc = await databases.getDocument<TicketDocument>(DB_ID, 'tickets', id);
    return mapDocumentToTicket(doc);
  } catch {
    return undefined;
  }
}

async function findByLinkedFinding(findingId: string): Promise<Ticket | undefined> {
  try {
    const response = await databases.listDocuments<TicketDocument>(DB_ID, 'tickets', [
      Query.equal('linkedFindings', findingId),
      Query.limit(1)
    ]);
    if (response.documents.length === 0) return undefined;
    return mapDocumentToTicket(response.documents[0]);
  } catch {
    return undefined;
  }
}

async function getUnsyncedTickets(): Promise<Ticket[]> {
  try {
    const response = await databases.listDocuments<TicketDocument>(DB_ID, 'tickets', [
      Query.limit(1000)
    ]);
    const tickets = response.documents.map(mapDocumentToTicket);
    return tickets.filter(t => !t.jiraKey || t.jiraSyncStatus === 'error');
  } catch (err) {
    logger.error('Error getting unsynced tickets:', err);
    return [];
  }
}

async function updateTicket(id: string, updates: Partial<Ticket>, actor: string): Promise<Ticket | undefined> {
  try {
    const ticket = await getTicket(id);
    if (!ticket) return undefined;

    const now = new Date().toISOString();
    const oldStatus = ticket.status;
    const oldPriority = ticket.priority;
    const oldAssignee = ticket.assignee;

    // Apply updates
    const data: Record<string, unknown> = { ...updates };
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;
    delete data.links;

    // Manage resolvedAt timestamp
    if (updates.status) {
      if ((updates.status === 'done' || updates.status === 'closed') && oldStatus !== 'done' && oldStatus !== 'closed') {
        data.resolvedAt = now;
      } else if (updates.status !== 'done' && updates.status !== 'closed') {
        data.resolvedAt = null;
      }
    }

    const doc = await databases.updateDocument<TicketDocument>(DB_ID, 'tickets', id, data);
    if (updates.links) {
      linksMap.set(id, updates.links);
    }
    const updatedTicket = mapDocumentToTicket(doc);

    // Auto-log activity logs for status, priority, or assignee updates
    if (updates.status && updates.status !== oldStatus) {
      await recordActivity(id, actor, 'status_change', {
        field: 'status',
        oldValue: oldStatus,
        newValue: updates.status,
        message: `Status updated from ${oldStatus} to ${updates.status}`
      });
    }

    if (updates.priority && updates.priority !== oldPriority) {
      await recordActivity(id, actor, 'priority_change', {
        field: 'priority',
        oldValue: oldPriority,
        newValue: updates.priority,
        message: `Priority changed from ${oldPriority} to ${updates.priority}`
      });
    }

    if (updates.assignee !== undefined && updates.assignee !== oldAssignee) {
      await recordActivity(id, actor, 'assignee_change', {
        field: 'assignee',
        oldValue: oldAssignee,
        newValue: updates.assignee,
        message: `Assignee updated from "${oldAssignee || 'Unassigned'}" to "${updates.assignee || 'Unassigned'}"`
      });
    }

    return updatedTicket;
  } catch (err) {
    logger.error('Error updating ticket in Appwrite:', err);
    throw err;
  }
}

async function deleteTicket(id: string): Promise<boolean> {
  try {
    await databases.deleteDocument(DB_ID, 'tickets', id);
    commentsMap.delete(id);
    activityMap.delete(id);
    return true;
  } catch (err) {
    logger.error('Error deleting ticket in Appwrite:', err);
    return false;
  }
}

async function listTickets(filters: TicketFilters): Promise<PaginatedResponse<Ticket>> {
  try {
    const queries: string[] = [];
    if (filters.status) {
      queries.push(Query.equal('status', filters.status));
    }
    if (filters.priority) {
      queries.push(Query.equal('priority', filters.priority));
    }
    if (filters.type) {
      queries.push(Query.equal('type', filters.type));
    }
    if (filters.assignee) {
      queries.push(Query.equal('assignee', filters.assignee));
    }

    // Retrieve up to 1000 matching documents to sort, search, and paginate locally safely
    queries.push(Query.limit(1000));

    const response = await databases.listDocuments<TicketDocument>(DB_ID, 'tickets', queries);
    const nowMs = Date.now();
    let list = response.documents.map(doc => {
      const t = mapDocumentToTicket(doc);
      // Compute isOverdue dynamically
      if (t.status !== 'done' && t.status !== 'closed') {
        const deadline = t.dueDate || t.slaDeadline;
        t.isOverdue = deadline ? new Date(deadline).getTime() < nowMs : false;
      } else {
        t.isOverdue = false;
      }
      return t;
    });

    // Filtering
    if (filters.overdue) {
      list = list.filter(t => t.isOverdue);
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      list = list.filter(t =>
        t.title.toLowerCase().includes(searchLower) ||
        t.description.toLowerCase().includes(searchLower) ||
        (t.jiraKey && t.jiraKey.toLowerCase().includes(searchLower))
      );
    }

    // Sorting
    const sortBy = (filters.sortBy || 'createdAt') as keyof Ticket;
    const sortOrder = filters.sortOrder || 'desc';

    list.sort((a, b) => {
      const valA = a[sortBy];
      const valB = b[sortBy];

      if (valA === undefined) return 1;
      if (valB === undefined) return -1;

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortOrder === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
    });

    // Pagination
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const total = list.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const paginatedData = list.slice(startIndex, startIndex + limit);

    return {
      data: paginatedData,
      total,
      page,
      totalPages
    };
  } catch (err) {
    logger.error('Error listing tickets from Appwrite:', err);
    return {
      data: [],
      total: 0,
      page: filters.page || 1,
      totalPages: 0
    };
  }
}

async function addComment(ticketId: string, body: string, author: string): Promise<TicketComment> {
  const id = `c-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  const newComment: TicketComment = { id, ticketId, body, author, createdAt: now };

  if (!commentsMap.has(ticketId)) {
    commentsMap.set(ticketId, []);
  }
  commentsMap.get(ticketId)!.push(newComment);

  await recordActivity(ticketId, author, 'comment_added', {
    message: `Added a comment: "${body.substring(0, 30)}${body.length > 30 ? '...' : ''}"`
  });

  return newComment;
}

async function getComments(ticketId: string): Promise<TicketComment[]> {
  return commentsMap.get(ticketId) || [];
}

async function recordActivity(
  ticketId: string,
  actor: string,
  type: TicketActivity['type'],
  details: TicketActivity['details']
): Promise<TicketActivity> {
  const id = `a-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  const newActivity: TicketActivity = { id, ticketId, actor, type, details, createdAt: now };

  if (!activityMap.has(ticketId)) {
    activityMap.set(ticketId, []);
  }
  activityMap.get(ticketId)!.push(newActivity);

  return newActivity;
}

async function getActivity(ticketId: string): Promise<TicketActivity[]> {
  return activityMap.get(ticketId) || [];
}

async function getStats() {
  const emptyStats = {
    total: 0,
    open: 0,
    critical: 0,
    resolved: 0,
    overdue: 0,
    countsByStatus: { todo: 0, in_progress: 0, in_review: 0, done: 0, closed: 0 },
    countsByPriority: { critical: 0, high: 0, medium: 0, low: 0 },
    countsByType: { bug: 0, vulnerability: 0, task: 0, feature: 0, story: 0, epic: 0 },
    agingTickets: [] as Ticket[]
  };

  try {
    const response = await databases.listDocuments<TicketDocument>(DB_ID, 'tickets', [Query.limit(1000)]);
    const tickets = response.documents.map(mapDocumentToTicket);
    const total = tickets.length;
    const open = tickets.filter(t => t.status !== 'done' && t.status !== 'closed').length;
    const critical = tickets.filter(t => t.priority === 'critical' && t.status !== 'done' && t.status !== 'closed').length;
    const resolved = tickets.filter(t => t.status === 'done' || t.status === 'closed').length;

    const countsByStatus = { ...emptyStats.countsByStatus };
    const countsByPriority = { ...emptyStats.countsByPriority };
    const countsByType = { ...emptyStats.countsByType };

    tickets.forEach(t => {
      if (t.status in countsByStatus) countsByStatus[t.status]++;
      if (t.priority in countsByPriority) countsByPriority[t.priority]++;
      if (t.type in countsByType) countsByType[t.type]++;
    });

    // top-5 aging open tickets (oldest createdAt, status !== done & !== closed)
    const openTickets = tickets.filter(t => t.status !== 'done' && t.status !== 'closed');
    const nowMs = Date.now();
    let overdueCount = 0;
    openTickets.forEach(t => {
      const deadline = t.dueDate || t.slaDeadline;
      if (deadline && new Date(deadline).getTime() < nowMs) {
        overdueCount++;
      }
    });

    openTickets.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const agingTickets = openTickets.slice(0, 5);

    return { total, open, critical, resolved, overdue: overdueCount, countsByStatus, countsByPriority, countsByType, agingTickets };
  } catch (err) {
    logger.error('Error getting ticket stats:', err);
    return emptyStats;
  }
}

async function addLink(fromId: string, toId: string, type: TicketLinkType, userEmail = 'System'): Promise<Ticket | null> {
  const fromTicket = await getTicket(fromId);
  const toTicket = await getTicket(toId);
  if (!fromTicket || !toTicket) {
    return null;
  }

  const fromLinks = linksMap.get(fromId) || [];
  const toLinks = linksMap.get(toId) || [];

  if (fromLinks.some(l => l.ticketId === toId && l.type === type)) {
    return (await getTicket(fromId)) || null;
  }

  let inverseType: TicketLinkType = 'relates_to';
  if (type === 'blocks') {
    inverseType = 'blocked_by';
  } else if (type === 'blocked_by') {
    inverseType = 'blocks';
  }

  fromLinks.push({ ticketId: toId, type });
  toLinks.push({ ticketId: fromId, type: inverseType });

  linksMap.set(fromId, fromLinks);
  linksMap.set(toId, toLinks);

  await recordActivity(fromId, userEmail, 'status_change', { message: `Linked ticket ${toId} as ${type}` });
  await recordActivity(toId, userEmail, 'status_change', { message: `Linked ticket ${fromId} as ${inverseType}` });

  return (await getTicket(fromId)) || null;
}

async function removeLink(fromId: string, toId: string, userEmail = 'System'): Promise<Ticket | null> {
  const fromTicket = await getTicket(fromId);
  if (!fromTicket) {
    return null;
  }

  const fromLinks = linksMap.get(fromId) || [];
  const toLinks = linksMap.get(toId) || [];

  linksMap.set(fromId, fromLinks.filter(l => l.ticketId !== toId));
  linksMap.set(toId, toLinks.filter(l => l.ticketId !== fromId));

  await recordActivity(fromId, userEmail, 'status_change', { message: `Removed link to ticket ${toId}` });
  await recordActivity(toId, userEmail, 'status_change', { message: `Removed link to ticket ${fromId}` });

  return (await getTicket(fromId)) || null;
}

const legacyTicketsRepository = {
  createTicket,
  getTicket,
  findByLinkedFinding,
  getUnsyncedTickets,
  updateTicket,
  deleteTicket,
  listTickets,
  addComment,
  getComments,
  recordActivity,
  getActivity,
  getStats,
  addLink,
  removeLink
};

/**
 * Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite
 * otherwise. Note the legacy path keeps comments, activity and links in
 * process memory and loses them on restart; only the Postgres path persists
 * them.
 */
export const ticketsRepository: typeof legacyTicketsRepository =
  isPostgresEnabled() ? ticketsPgRepository : legacyTicketsRepository;
