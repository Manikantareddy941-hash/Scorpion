import { Ticket, TicketComment, TicketActivity, TicketFilters, PaginatedResponse } from '../../../shared/types';
import crypto from 'crypto';

// In-memory stores
const ticketsMap = new Map<string, Ticket>();
const commentsMap = new Map<string, TicketComment[]>();
const activityMap = new Map<string, TicketActivity[]>();

// Initialize with some seed data
const SEED_TICKETS: Ticket[] = [
  {
    id: 't-1',
    title: 'SQL Injection in Auth Controller',
    description: 'A critical vulnerability was detected by semgrep in authRoutes.ts line 42. Input parameter is directly concatenated into query string.',
    status: 'todo',
    priority: 'critical',
    type: 'vulnerability',
    severity: 9.2,
    assignee: 'Alice Smith',
    reporter: 'SCORPION Scanner',
    tags: ['sast', 'security', 'sql-injection'],
    linkedFindings: ['f-101'],
    createdAt: new Date(Date.now() - 3600000 * 24 * 3).toISOString(), // 3 days ago
    updatedAt: new Date(Date.now() - 3600000 * 24 * 3).toISOString()
  },
  {
    id: 't-2',
    title: 'Outdated jsonwebtoken library',
    description: 'Trivy SCA scanner flagged jsonwebtoken as vulnerable to signature verification bypass. Upgrade is required.',
    status: 'in_progress',
    priority: 'high',
    type: 'vulnerability',
    severity: 7.8,
    assignee: 'Bob Jones',
    reporter: 'SCORPION Scanner',
    tags: ['sca', 'npm', 'dependencies'],
    linkedFindings: ['f-102'],
    createdAt: new Date(Date.now() - 3600000 * 24 * 2).toISOString(), // 2 days ago
    updatedAt: new Date(Date.now() - 3600000 * 4).toISOString()
  },
  {
    id: 't-3',
    title: 'Configure branch protection rules',
    description: 'Set up branch protection on main branch to require pull request reviews and passing status checks.',
    status: 'done',
    priority: 'medium',
    type: 'task',
    severity: 4.0,
    assignee: 'Alice Smith',
    reporter: 'System Admin',
    tags: ['governance', 'github'],
    linkedFindings: [],
    createdAt: new Date(Date.now() - 3600000 * 24 * 5).toISOString(), // 5 days ago
    updatedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    resolvedAt: new Date(Date.now() - 3600000 * 12).toISOString()
  }
];

// Seed the maps
SEED_TICKETS.forEach(t => {
  ticketsMap.set(t.id, t);
  activityMap.set(t.id, [
    {
      id: crypto.randomUUID(),
      ticketId: t.id,
      actor: t.reporter,
      type: 'created',
      details: { message: `Ticket initialized by ${t.reporter}` },
      createdAt: t.createdAt
    }
  ]);
});

commentsMap.set('t-2', [
  {
    id: crypto.randomUUID(),
    ticketId: 't-2',
    body: 'Investigating which package requires this. Will upgrade package.json shortly.',
    author: 'Bob Jones',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
  }
]);

export function createTicket(ticketData: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'>): Ticket {
  const id = `t-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  
  const newTicket: Ticket = {
    ...ticketData,
    id,
    createdAt: now,
    updatedAt: now
  };

  if (newTicket.status === 'done' || newTicket.status === 'closed') {
    newTicket.resolvedAt = now;
  }

  ticketsMap.set(id, newTicket);

  recordActivity(id, ticketData.reporter || 'System', 'created', {
    message: `Ticket created with title: "${newTicket.title}"`
  });

  return newTicket;
}

export function getTicket(id: string): Ticket | undefined {
  return ticketsMap.get(id);
}

export function findByLinkedFinding(findingId: string): Ticket | undefined {
  return Array.from(ticketsMap.values()).find(t => t.linkedFindings.includes(findingId));
}

export function getUnsyncedTickets(): Ticket[] {
  return Array.from(ticketsMap.values()).filter(t => !t.jiraKey || t.jiraSyncStatus === 'error');
}

export function updateTicket(id: string, updates: Partial<Ticket>, actor: string): Ticket | undefined {
  const ticket = ticketsMap.get(id);
  if (!ticket) return undefined;

  const now = new Date().toISOString();
  const oldStatus = ticket.status;
  const oldPriority = ticket.priority;
  const oldAssignee = ticket.assignee;

  // Apply updates
  const updatedTicket: Ticket = {
    ...ticket,
    ...updates,
    updatedAt: now
  };

  // Manage resolvedAt timestamp
  if (updates.status) {
    if ((updates.status === 'done' || updates.status === 'closed') && oldStatus !== 'done' && oldStatus !== 'closed') {
      updatedTicket.resolvedAt = now;
    } else if (updates.status !== 'done' && updates.status !== 'closed') {
      updatedTicket.resolvedAt = undefined;
    }
  }

  ticketsMap.set(id, updatedTicket);

  // Auto-log activity logs for status, priority, or assignee updates
  if (updates.status && updates.status !== oldStatus) {
    recordActivity(id, actor, 'status_change', {
      field: 'status',
      oldValue: oldStatus,
      newValue: updates.status,
      message: `Status updated from ${oldStatus} to ${updates.status}`
    });
  }

  if (updates.priority && updates.priority !== oldPriority) {
    recordActivity(id, actor, 'priority_change', {
      field: 'priority',
      oldValue: oldPriority,
      newValue: updates.priority,
      message: `Priority changed from ${oldPriority} to ${updates.priority}`
    });
  }

  if (updates.assignee !== undefined && updates.assignee !== oldAssignee) {
    recordActivity(id, actor, 'assignee_change', {
      field: 'assignee',
      oldValue: oldAssignee,
      newValue: updates.assignee,
      message: `Assignee updated from "${oldAssignee || 'Unassigned'}" to "${updates.assignee || 'Unassigned'}"`
    });
  }

  return updatedTicket;
}

export function deleteTicket(id: string): boolean {
  if (!ticketsMap.has(id)) return false;
  ticketsMap.delete(id);
  commentsMap.delete(id);
  activityMap.delete(id);
  return true;
}

export function listTickets(filters: TicketFilters): PaginatedResponse<Ticket> {
  let list = Array.from(ticketsMap.values());

  // Filtering
  if (filters.status) {
    list = list.filter(t => t.status === filters.status);
  }
  if (filters.priority) {
    list = list.filter(t => t.priority === filters.priority);
  }
  if (filters.type) {
    list = list.filter(t => t.type === filters.type);
  }
  if (filters.assignee) {
    list = list.filter(t => t.assignee.toLowerCase() === filters.assignee!.toLowerCase());
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
}

export function addComment(ticketId: string, body: string, author: string): TicketComment {
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

  recordActivity(ticketId, author, 'comment_added', {
    message: `Added a comment: "${body.substring(0, 30)}${body.length > 30 ? '...' : ''}"`
  });

  return newComment;
}

export function getComments(ticketId: string): TicketComment[] {
  return commentsMap.get(ticketId) || [];
}

export function recordActivity(
  ticketId: string, 
  actor: string, 
  type: TicketActivity['type'], 
  details: TicketActivity['details']
): TicketActivity {
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

export function getActivity(ticketId: string): TicketActivity[] {
  return activityMap.get(ticketId) || [];
}

export function getStats() {
  const tickets = Array.from(ticketsMap.values());
  const total = tickets.length;
  const open = tickets.filter(t => t.status !== 'done' && t.status !== 'closed').length;
  const critical = tickets.filter(t => t.priority === 'critical' && t.status !== 'done' && t.status !== 'closed').length;
  const resolved = tickets.filter(t => t.status === 'done' || t.status === 'closed').length;

  const countsByStatus = { todo: 0, in_progress: 0, in_review: 0, done: 0, closed: 0 };
  const countsByPriority = { critical: 0, high: 0, medium: 0, low: 0 };
  const countsByType = { bug: 0, vulnerability: 0, task: 0, feature: 0 };

  tickets.forEach(t => {
    if (countsByStatus[t.status] !== undefined) countsByStatus[t.status]++;
    if (countsByPriority[t.priority] !== undefined) countsByPriority[t.priority]++;
    if (countsByType[t.type] !== undefined) countsByType[t.type]++;
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
}
