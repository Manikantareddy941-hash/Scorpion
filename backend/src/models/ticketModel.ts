import { Ticket, TicketComment, TicketActivity, TicketFilters, PaginatedResponse } from '../../../shared/types';
import crypto from 'crypto';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';

// In-memory stores for comments and activity log (these remain local for now)
const commentsMap = new Map<string, TicketComment[]>();
const activityMap = new Map<string, TicketActivity[]>();

/**
 * Maps an Appwrite document to the Ticket interface format.
 */
function mapDocumentToTicket(doc: any): Ticket {
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
  };
}

export async function createTicket(ticketData: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'>): Promise<Ticket> {
  const now = new Date().toISOString();
  
  const data: any = {
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
    storyPoints: (ticketData as any).storyPoints || null,
    dueDate: (ticketData as any).dueDate || null,
    epicLink: (ticketData as any).epicLink || null,
    sprintId: (ticketData as any).sprintId || null,
  };

  if (data.status === 'done' || data.status === 'closed') {
    data.resolvedAt = now;
  }

  const doc = await databases.createDocument(
    DB_ID,
    'tickets',
    ID.unique(),
    data
  );

  const newTicket = mapDocumentToTicket(doc);

  await recordActivity(newTicket.id, ticketData.reporter || 'System', 'created', {
    message: `Ticket created with title: "${newTicket.title}"`
  });

  return newTicket;
}

export async function getTicket(id: string): Promise<Ticket | undefined> {
  try {
    const doc = await databases.getDocument(DB_ID, 'tickets', id);
    return mapDocumentToTicket(doc);
  } catch (err) {
    return undefined;
  }
}

export async function findByLinkedFinding(findingId: string): Promise<Ticket | undefined> {
  try {
    const response = await databases.listDocuments(DB_ID, 'tickets', [
      Query.equal('linkedFindings', findingId),
      Query.limit(1)
    ]);
    if (response.documents.length === 0) return undefined;
    return mapDocumentToTicket(response.documents[0]);
  } catch (err) {
    return undefined;
  }
}

export async function getUnsyncedTickets(): Promise<Ticket[]> {
  try {
    const response = await databases.listDocuments(DB_ID, 'tickets', [
      Query.limit(1000)
    ]);
    const tickets = response.documents.map(mapDocumentToTicket);
    return tickets.filter(t => !t.jiraKey || t.jiraSyncStatus === 'error');
  } catch (err) {
    console.error('Error getting unsynced tickets:', err);
    return [];
  }
}

export async function updateTicket(id: string, updates: Partial<Ticket>, actor: string): Promise<Ticket | undefined> {
  try {
    const ticket = await getTicket(id);
    if (!ticket) return undefined;

    const now = new Date().toISOString();
    const oldStatus = ticket.status;
    const oldPriority = ticket.priority;
    const oldAssignee = ticket.assignee;

    // Apply updates
    const data: any = { ...updates };
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    // Manage resolvedAt timestamp
    if (updates.status) {
      if ((updates.status === 'done' || updates.status === 'closed') && oldStatus !== 'done' && oldStatus !== 'closed') {
        data.resolvedAt = now;
      } else if (updates.status !== 'done' && updates.status !== 'closed') {
        data.resolvedAt = null;
      }
    }

    const doc = await databases.updateDocument(DB_ID, 'tickets', id, data);
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
    console.error('Error updating ticket in Appwrite:', err);
    throw err;
  }
}

export async function deleteTicket(id: string): Promise<boolean> {
  try {
    await databases.deleteDocument(DB_ID, 'tickets', id);
    commentsMap.delete(id);
    activityMap.delete(id);
    return true;
  } catch (err) {
    console.error('Error deleting ticket in Appwrite:', err);
    return false;
  }
}

export async function listTickets(filters: TicketFilters): Promise<PaginatedResponse<Ticket>> {
  try {
    const queries: any[] = [];
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

    const response = await databases.listDocuments(DB_ID, 'tickets', queries);
    let list = response.documents.map(mapDocumentToTicket);

    // Filtering
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      list = list.filter(t => 
        t.title.toLowerCase().includes(searchLower) || 
        t.description.toLowerCase().includes(searchLower) ||
        (t.jiraKey && t.jiraKey.toLowerCase().includes(searchLower))
      );
    }

    // Sorting
    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder || 'desc';

    list.sort((a: any, b: any) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (valA === undefined) return 1;
      if (valB === undefined) return -1;

      if (typeof valA === 'string') {
        return sortOrder === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        return sortOrder === 'asc' 
          ? valA - valB 
          : valB - valA;
      }
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
    console.error('Error listing tickets from Appwrite:', err);
    return {
      data: [],
      total: 0,
      page: filters.page || 1,
      totalPages: 0
    };
  }
}

export async function addComment(ticketId: string, body: string, author: string): Promise<TicketComment> {
  const id = `c-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  
  const newComment: TicketComment = {
    id,
    ticketId,
    body,
    author,
    createdAt: now
  };

  if (!commentsMap.has(ticketId)) {
    commentsMap.set(ticketId, []);
  }
  commentsMap.get(ticketId)!.push(newComment);

  await recordActivity(ticketId, author, 'comment_added', {
    message: `Added a comment: "${body.substring(0, 30)}${body.length > 30 ? '...' : ''}"`
  });

  return newComment;
}

export async function getComments(ticketId: string): Promise<TicketComment[]> {
  return commentsMap.get(ticketId) || [];
}

export async function recordActivity(
  ticketId: string, 
  actor: string, 
  type: TicketActivity['type'], 
  details: TicketActivity['details']
): Promise<TicketActivity> {
  const id = `a-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  const newActivity: TicketActivity = {
    id,
    ticketId,
    actor,
    type,
    details,
    createdAt: now
  };

  if (!activityMap.has(ticketId)) {
    activityMap.set(ticketId, []);
  }
  activityMap.get(ticketId)!.push(newActivity);

  return newActivity;
}

export async function getActivity(ticketId: string): Promise<TicketActivity[]> {
  return activityMap.get(ticketId) || [];
}

export async function getStats() {
  try {
    const response = await databases.listDocuments(DB_ID, 'tickets', [Query.limit(1000)]);
    const tickets = response.documents.map(mapDocumentToTicket);
    const total = tickets.length;
    const open = tickets.filter(t => t.status !== 'done' && t.status !== 'closed').length;
    const critical = tickets.filter(t => t.priority === 'critical' && t.status !== 'done' && t.status !== 'closed').length;
    const resolved = tickets.filter(t => t.status === 'done' || t.status === 'closed').length;

    const countsByStatus = { todo: 0, in_progress: 0, in_review: 0, done: 0, closed: 0 };
    const countsByPriority = { critical: 0, high: 0, medium: 0, low: 0 };
    const countsByType = { bug: 0, vulnerability: 0, task: 0, feature: 0, story: 0, epic: 0 };

    tickets.forEach(t => {
      if ((countsByStatus as any)[t.status] !== undefined) (countsByStatus as any)[t.status]++;
      if ((countsByPriority as any)[t.priority] !== undefined) (countsByPriority as any)[t.priority]++;
      if ((countsByType as any)[t.type] !== undefined) (countsByType as any)[t.type]++;
    });

    // top-5 aging open tickets (oldest createdAt, status !== done & !== closed)
    const openTickets = tickets.filter(t => t.status !== 'done' && t.status !== 'closed');
    openTickets.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const agingTickets = openTickets.slice(0, 5);

    return {
      total,
      open,
      critical,
      resolved,
      countsByStatus,
      countsByPriority,
      countsByType,
      agingTickets
    };
  } catch (err) {
    console.error('Error getting ticket stats:', err);
    return {
      total: 0,
      open: 0,
      critical: 0,
      resolved: 0,
      countsByStatus: { todo: 0, in_progress: 0, in_review: 0, done: 0, closed: 0 },
      countsByPriority: { critical: 0, high: 0, medium: 0, low: 0 },
      countsByType: { bug: 0, vulnerability: 0, task: 0, feature: 0, story: 0, epic: 0 },
      agingTickets: []
    };
  }
}
