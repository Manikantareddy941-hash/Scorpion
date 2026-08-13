import crypto from 'crypto';
import { getPool } from '../../db/pool';
import { logger, errorContext } from '../../services/logger';
import { newId } from './docTable';
import type {
  Ticket, TicketComment, TicketActivity, TicketFilters, PaginatedResponse, TicketLink, TicketLinkType,
} from '../../../../shared/types';

/**
 * Postgres implementation of ticketsRepository (facade-selected).
 *
 * The legacy implementation kept comments, activity and links in module-level
 * Maps, so all three were lost on every process restart — a user could add a
 * comment, see it accepted, and find it gone after a deploy. Here they are
 * ordinary tables with cascading foreign keys.
 */

const MS_IN_HOUR = 60 * 60 * 1000;
/** How long a ticket has before it breaches SLA, by priority. */
const SLA_HOURS: Record<string, number> = { critical: 24, high: 72, medium: 24 * 7, low: 24 * 30 };

type TicketRow = { id: string; data: Record<string, unknown>; created_at: Date; updated_at: Date };

/** Ownership filter from tenancyService.resolveOwnershipScope. */
export type TenantScope = { field: 'user_id' | 'team_id'; value: string };

/** Fields owned by columns or derived — never stored inside the JSONB payload. */
const NON_PAYLOAD_FIELDS = ['id', 'createdAt', 'updatedAt', 'links', 'isOverdue'] as const;

function stripNonPayload(fields: Record<string, unknown>): Record<string, unknown> {
  const out = { ...fields };
  for (const key of NON_PAYLOAD_FIELDS) delete out[key];
  return out;
}

function rowToTicket(row: TicketRow, links: TicketLink[] = []): Ticket {
  const data = row.data;
  return {
    ...(data as unknown as Ticket),
    id: row.id,
    tags: (data.tags as string[]) ?? [],
    linkedFindings: (data.linkedFindings as string[]) ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    links,
  };
}

/** Computed on read, never stored — it depends on the current time. */
function withOverdue(ticket: Ticket, nowMs: number): Ticket {
  const isClosed = ticket.status === 'done' || ticket.status === 'closed';
  const deadline = ticket.dueDate || ticket.slaDeadline;
  return { ...ticket, isOverdue: isClosed || !deadline ? false : new Date(deadline).getTime() < nowMs };
}

async function linksFor(ticketId: string): Promise<TicketLink[]> {
  const res = await getPool().query(
    'SELECT linked_ticket_id, type FROM ticket_links WHERE ticket_id = $1',
    [ticketId]
  );
  return (res.rows as { linked_ticket_id: string; type: TicketLinkType }[])
    .map(r => ({ ticketId: r.linked_ticket_id, type: r.type }));
}

/** One query for many tickets — the list and stats paths would otherwise N+1. */
async function linksForMany(ticketIds: string[]): Promise<Map<string, TicketLink[]>> {
  const byTicket = new Map<string, TicketLink[]>();
  if (ticketIds.length === 0) return byTicket;
  const res = await getPool().query(
    'SELECT ticket_id, linked_ticket_id, type FROM ticket_links WHERE ticket_id = ANY($1)',
    [ticketIds]
  );
  for (const r of res.rows as { ticket_id: string; linked_ticket_id: string; type: TicketLinkType }[]) {
    const list = byTicket.get(r.ticket_id) ?? [];
    list.push({ ticketId: r.linked_ticket_id, type: r.type });
    byTicket.set(r.ticket_id, list);
  }
  return byTicket;
}

function computeSlaDeadline(ticketData: Partial<Ticket>): string | null {
  if (ticketData.slaDeadline) return ticketData.slaDeadline;
  if (ticketData.dueDate) return ticketData.dueDate;
  const hours = SLA_HOURS[ticketData.priority ?? ''];
  return hours ? new Date(Date.now() + hours * MS_IN_HOUR).toISOString() : null;
}

async function recordActivity(
  ticketId: string,
  actor: string,
  type: TicketActivity['type'],
  details: TicketActivity['details']
): Promise<TicketActivity> {
  const id = `a-${crypto.randomBytes(4).toString('hex')}`;
  const createdAt = new Date().toISOString();
  await getPool().query(
    `INSERT INTO ticket_activity (id, ticket_id, actor, type, details, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [id, ticketId, actor, type, JSON.stringify(details ?? {}), createdAt]
  );
  return { id, ticketId, actor, type, details, createdAt };
}

async function getTicket(id: string): Promise<Ticket | undefined> {
  try {
    const res = await getPool().query(
      'SELECT id, data, created_at, updated_at FROM tickets WHERE id = $1',
      [id]
    );
    if (res.rows.length === 0) return undefined;
    return rowToTicket(res.rows[0] as TicketRow, await linksFor(id));
  } catch (err) {
    logger.error('[ticketsPgRepository] getTicket failed:', { event: 'TICKET_READ_FAILED', ...errorContext(err) });
    return undefined;
  }
}

async function createTicket(
  ticketData: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'>
): Promise<Ticket> {
  const id = newId();
  const now = new Date().toISOString();

  const payload = stripNonPayload({
    ...ticketData,
    severity: ticketData.severity !== undefined ? Number(ticketData.severity) : 0,
    assignee: ticketData.assignee || '',
    tags: ticketData.tags || [],
    linkedFindings: ticketData.linkedFindings || [],
    storyPoints: ticketData.storyPoints ?? null,
    dueDate: ticketData.dueDate ?? null,
    epicLink: ticketData.epicLink ?? null,
    sprintId: ticketData.sprintId ?? null,
    slaDeadline: computeSlaDeadline(ticketData),
    resolvedAt: ticketData.status === 'done' || ticketData.status === 'closed' ? now : undefined,
  });

  const res = await getPool().query(
    `INSERT INTO tickets (id, data) VALUES ($1, $2::jsonb)
     RETURNING id, data, created_at, updated_at`,
    [id, JSON.stringify(payload)]
  );

  for (const link of ticketData.links ?? []) {
    await getPool().query(
      `INSERT INTO ticket_links (ticket_id, linked_ticket_id, type) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [id, link.ticketId, link.type]
    );
  }

  const ticket = rowToTicket(res.rows[0] as TicketRow, ticketData.links ?? []);
  await recordActivity(id, ticketData.reporter || 'System', 'created', {
    message: `Ticket created with title: "${ticket.title}"`,
  });
  return ticket;
}

async function updateTicket(id: string, updates: Partial<Ticket>, actor: string): Promise<Ticket | undefined> {
  const existing = await getTicket(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const patch = stripNonPayload(updates);

  // resolvedAt tracks entry into and exit from a terminal status.
  if (updates.status) {
    const wasClosed = existing.status === 'done' || existing.status === 'closed';
    const isClosed = updates.status === 'done' || updates.status === 'closed';
    if (isClosed && !wasClosed) patch.resolvedAt = now;
    else if (!isClosed) patch.resolvedAt = null;
  }

  const res = await getPool().query(
    `UPDATE tickets SET data = data || $2::jsonb, updated_at = now() WHERE id = $1
     RETURNING id, data, created_at, updated_at`,
    [id, JSON.stringify(patch)]
  );
  if (res.rows.length === 0) return undefined;

  if (updates.links) {
    await getPool().query('DELETE FROM ticket_links WHERE ticket_id = $1', [id]);
    for (const link of updates.links) {
      await getPool().query(
        `INSERT INTO ticket_links (ticket_id, linked_ticket_id, type) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [id, link.ticketId, link.type]
      );
    }
  }

  if (updates.status && updates.status !== existing.status) {
    await recordActivity(id, actor, 'status_change', {
      field: 'status', oldValue: existing.status, newValue: updates.status,
      message: `Status updated from ${existing.status} to ${updates.status}`,
    });
  }
  if (updates.priority && updates.priority !== existing.priority) {
    await recordActivity(id, actor, 'priority_change', {
      field: 'priority', oldValue: existing.priority, newValue: updates.priority,
      message: `Priority changed from ${existing.priority} to ${updates.priority}`,
    });
  }
  if (updates.assignee !== undefined && updates.assignee !== existing.assignee) {
    await recordActivity(id, actor, 'assignee_change', {
      field: 'assignee', oldValue: existing.assignee, newValue: updates.assignee,
      message: `Assignee updated from "${existing.assignee || 'Unassigned'}" to "${updates.assignee || 'Unassigned'}"`,
    });
  }

  return rowToTicket(res.rows[0] as TicketRow, await linksFor(id));
}

async function deleteTicket(id: string): Promise<boolean> {
  try {
    // Comments, activity and both link directions go with it via ON DELETE
    // CASCADE — the legacy path forgot links entirely and left them dangling.
    const res = await getPool().query('DELETE FROM tickets WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    logger.error('[ticketsPgRepository] deleteTicket failed:', { event: 'TICKET_DELETE_FAILED', ...errorContext(err) });
    return false;
  }
}

async function findByLinkedFinding(findingId: string): Promise<Ticket | undefined> {
  try {
    const res = await getPool().query(
      `SELECT id, data, created_at, updated_at FROM tickets
       WHERE data->'linkedFindings' @> $1::jsonb LIMIT 1`,
      [JSON.stringify([findingId])]
    );
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0] as TicketRow;
    return rowToTicket(row, await linksFor(row.id));
  } catch (err) {
    logger.error('[ticketsPgRepository] findByLinkedFinding failed:', { event: 'TICKET_FINDING_LOOKUP_FAILED', ...errorContext(err) });
    return undefined;
  }
}

async function allTickets(scope?: TenantScope): Promise<Ticket[]> {
  const res = scope
    ? await getPool().query(
        `SELECT id, data, created_at, updated_at FROM tickets WHERE data->>'${scope.field}' = $1 LIMIT 1000`,
        [scope.value]
      )
    : await getPool().query('SELECT id, data, created_at, updated_at FROM tickets LIMIT 1000');
  const rows = res.rows as TicketRow[];
  const links = await linksForMany(rows.map(r => r.id));
  return rows.map(r => rowToTicket(r, links.get(r.id) ?? []));
}

async function getUnsyncedTickets(): Promise<Ticket[]> {
  try {
    return (await allTickets()).filter(t => !t.jiraKey || t.jiraSyncStatus === 'error');
  } catch (err) {
    logger.error('[ticketsPgRepository] getUnsyncedTickets failed:', { event: 'TICKET_UNSYNCED_LIST_FAILED', ...errorContext(err) });
    return [];
  }
}

async function listTickets(filters: TicketFilters, scope?: TenantScope): Promise<PaginatedResponse<Ticket>> {
  const page = filters.page || 1;
  const limit = filters.limit || 10;
  try {
    const where: string[] = [];
    const values: unknown[] = [];

    // Tenant scope is applied in SQL, not after fetching. Filtering in memory
    // would still pull another tenant's rows into this process, and the LIMIT
    // would then be spent on rows the caller may not see.
    if (scope) {
      values.push(scope.value);
      where.push(`data->>'${scope.field}' = $${values.length}`);
    }

    for (const [column, value] of [
      ['status', filters.status], ['priority', filters.priority],
      ['type', filters.type], ['assignee', filters.assignee],
    ] as const) {
      if (value) { values.push(value); where.push(`data->>'${column}' = $${values.length}`); }
    }

    const res = await getPool().query(
      `SELECT id, data, created_at, updated_at FROM tickets
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} LIMIT 1000`,
      values
    );
    const rows = res.rows as TicketRow[];
    const linkMap = await linksForMany(rows.map(r => r.id));
    const nowMs = Date.now();
    let list = rows.map(r => withOverdue(rowToTicket(r, linkMap.get(r.id) ?? []), nowMs));

    if (filters.overdue) list = list.filter(t => t.isOverdue);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.jiraKey ? t.jiraKey.toLowerCase().includes(q) : false)
      );
    }

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

    const total = list.length;
    const start = (page - 1) * limit;
    return { data: list.slice(start, start + limit), total, page, totalPages: Math.ceil(total / limit) };
  } catch (err) {
    logger.error('[ticketsPgRepository] listTickets failed:', { event: 'TICKET_LIST_FAILED', ...errorContext(err) });
    return { data: [], total: 0, page, totalPages: 0 };
  }
}

async function addComment(ticketId: string, body: string, author: string): Promise<TicketComment> {
  const id = `c-${crypto.randomBytes(4).toString('hex')}`;
  const createdAt = new Date().toISOString();
  await getPool().query(
    'INSERT INTO ticket_comments (id, ticket_id, body, author, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, ticketId, body, author, createdAt]
  );
  await recordActivity(ticketId, author, 'comment_added', {
    message: `Added a comment: "${body.substring(0, 30)}${body.length > 30 ? '...' : ''}"`,
  });
  return { id, ticketId, body, author, createdAt };
}

async function getComments(ticketId: string): Promise<TicketComment[]> {
  const res = await getPool().query(
    'SELECT id, ticket_id, body, author, created_at FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at',
    [ticketId]
  );
  return (res.rows as { id: string; ticket_id: string; body: string; author: string; created_at: Date }[])
    .map(r => ({
      id: r.id, ticketId: r.ticket_id, body: r.body, author: r.author,
      createdAt: r.created_at.toISOString(),
    }));
}

async function getActivity(ticketId: string): Promise<TicketActivity[]> {
  const res = await getPool().query(
    'SELECT id, ticket_id, actor, type, details, created_at FROM ticket_activity WHERE ticket_id = $1 ORDER BY created_at',
    [ticketId]
  );
  return (res.rows as {
    id: string; ticket_id: string; actor: string;
    type: TicketActivity['type']; details: TicketActivity['details']; created_at: Date;
  }[]).map(r => ({
    id: r.id, ticketId: r.ticket_id, actor: r.actor, type: r.type,
    details: r.details, createdAt: r.created_at.toISOString(),
  }));
}

async function getStats(scope?: TenantScope) {
  const emptyStats = {
    total: 0, open: 0, critical: 0, resolved: 0, overdue: 0,
    countsByStatus: { todo: 0, in_progress: 0, in_review: 0, done: 0, closed: 0 },
    countsByPriority: { critical: 0, high: 0, medium: 0, low: 0 },
    countsByType: { bug: 0, vulnerability: 0, task: 0, feature: 0, story: 0, epic: 0 },
    agingTickets: [] as Ticket[],
  };

  try {
    const tickets = await allTickets(scope);
    const isOpen = (t: Ticket) => t.status !== 'done' && t.status !== 'closed';
    const countsByStatus = { ...emptyStats.countsByStatus };
    const countsByPriority = { ...emptyStats.countsByPriority };
    const countsByType = { ...emptyStats.countsByType };

    for (const t of tickets) {
      if (t.status in countsByStatus) countsByStatus[t.status]++;
      if (t.priority in countsByPriority) countsByPriority[t.priority]++;
      if (t.type in countsByType) countsByType[t.type]++;
    }

    const openTickets = tickets.filter(isOpen);
    const nowMs = Date.now();
    const overdue = openTickets.filter(t => {
      const deadline = t.dueDate || t.slaDeadline;
      return deadline ? new Date(deadline).getTime() < nowMs : false;
    }).length;

    openTickets.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return {
      total: tickets.length,
      open: openTickets.length,
      critical: openTickets.filter(t => t.priority === 'critical').length,
      resolved: tickets.filter(t => !isOpen(t)).length,
      overdue, countsByStatus, countsByPriority, countsByType,
      agingTickets: openTickets.slice(0, 5),
    };
  } catch (err) {
    logger.error('[ticketsPgRepository] getStats failed:', { event: 'TICKET_STATS_READ_FAILED', ...errorContext(err) });
    return emptyStats;
  }
}

/** blocks/blocked_by are mirrored; everything else relates symmetrically. */
function inverseOf(type: TicketLinkType): TicketLinkType {
  if (type === 'blocks') return 'blocked_by';
  if (type === 'blocked_by') return 'blocks';
  return 'relates_to';
}

async function addLink(
  fromId: string, toId: string, type: TicketLinkType, userEmail = 'System'
): Promise<Ticket | null> {
  const [fromTicket, toTicket] = await Promise.all([getTicket(fromId), getTicket(toId)]);
  if (!fromTicket || !toTicket) return null;

  // Already linked this way — return unchanged rather than logging a second time.
  if (fromTicket.links?.some(l => l.ticketId === toId && l.type === type)) {
    return fromTicket;
  }

  const inverseType = inverseOf(type);
  await getPool().query(
    `INSERT INTO ticket_links (ticket_id, linked_ticket_id, type) VALUES ($1, $2, $3), ($2, $1, $4)
     ON CONFLICT DO NOTHING`,
    [fromId, toId, type, inverseType]
  );

  await recordActivity(fromId, userEmail, 'status_change', { message: `Linked ticket ${toId} as ${type}` });
  await recordActivity(toId, userEmail, 'status_change', { message: `Linked ticket ${fromId} as ${inverseType}` });

  return (await getTicket(fromId)) || null;
}

async function removeLink(fromId: string, toId: string, userEmail = 'System'): Promise<Ticket | null> {
  const fromTicket = await getTicket(fromId);
  if (!fromTicket) return null;

  await getPool().query(
    `DELETE FROM ticket_links
     WHERE (ticket_id = $1 AND linked_ticket_id = $2) OR (ticket_id = $2 AND linked_ticket_id = $1)`,
    [fromId, toId]
  );

  await recordActivity(fromId, userEmail, 'status_change', { message: `Removed link to ticket ${toId}` });
  await recordActivity(toId, userEmail, 'status_change', { message: `Removed link to ticket ${fromId}` });

  return (await getTicket(fromId)) || null;
}

export const ticketsPgRepository = {
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
  removeLink,
};
