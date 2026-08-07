import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { ticketsPgRepository as repo } from './ticketsPgRepository';
import type { Ticket } from '../../../../shared/types';

const base: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'> = {
  title: 'Fix SQL injection in login',
  description: 'Parameterize the query',
  status: 'todo',
  priority: 'critical',
  type: 'vulnerability',
  severity: 9,
  assignee: 'alice',
  reporter: 'bob',
  tags: ['security'],
  linkedFindings: ['finding-1'],
};

describeDb('ticketsPgRepository', () => {
  // ticket_links/comments/activity cascade from tickets, but truncate all four
  // so a failed test cannot leak rows into the next one.
  beforeEach(() => truncateAll(['ticket_links', 'ticket_comments', 'ticket_activity', 'tickets']));
  afterAll(() => closePool());

  it('creates and reads back a ticket', async () => {
    const created = await repo.createTicket(base);
    const found = await repo.getTicket(created.id);
    expect(found?.title).toBe(base.title);
    expect(found?.severity).toBe(9);
    expect(found?.tags).toEqual(['security']);
    expect(found?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns undefined for an unknown ticket', async () => {
    expect(await repo.getTicket('nope')).toBeUndefined();
  });

  it('derives an SLA deadline from priority when none is given', async () => {
    const created = await repo.createTicket(base); // critical → 24h
    const deadline = new Date(created.slaDeadline!).getTime();
    const expected = Date.now() + 24 * 60 * 60 * 1000;
    expect(Math.abs(deadline - expected)).toBeLessThan(60_000);
  });

  it('prefers an explicit dueDate over the priority-derived SLA', async () => {
    const created = await repo.createTicket({ ...base, dueDate: '2030-01-01T00:00:00.000Z' });
    expect(created.slaDeadline).toBe('2030-01-01T00:00:00.000Z');
  });

  // The bug this migration exists to fix: these three survived only in process
  // memory before, so a restart silently discarded them.
  describe('comments, activity and links persist', () => {
    it('stores and returns comments in order', async () => {
      const t = await repo.createTicket(base);
      await repo.addComment(t.id, 'first', 'alice');
      await repo.addComment(t.id, 'second', 'bob');
      const comments = await repo.getComments(t.id);
      expect(comments.map(c => c.body)).toEqual(['first', 'second']);
      expect(comments[0].author).toBe('alice');
    });

    it('logs creation activity, and a comment adds another entry', async () => {
      const t = await repo.createTicket(base);
      expect((await repo.getActivity(t.id)).map(a => a.type)).toEqual(['created']);
      await repo.addComment(t.id, 'looking into it', 'alice');
      expect((await repo.getActivity(t.id)).map(a => a.type)).toEqual(['created', 'comment_added']);
    });

    it('records the old and new value on a status change', async () => {
      const t = await repo.createTicket(base);
      await repo.updateTicket(t.id, { status: 'in_progress' }, 'alice');
      const change = (await repo.getActivity(t.id)).find(a => a.type === 'status_change');
      expect(change?.details).toMatchObject({ oldValue: 'todo', newValue: 'in_progress' });
    });
  });

  describe('links', () => {
    it('addLink writes both directions with the inverse type', async () => {
      const a = await repo.createTicket(base);
      const b = await repo.createTicket({ ...base, title: 'other' });
      await repo.addLink(a.id, b.id, 'blocks');
      expect((await repo.getTicket(a.id))?.links).toEqual([{ ticketId: b.id, type: 'blocks' }]);
      expect((await repo.getTicket(b.id))?.links).toEqual([{ ticketId: a.id, type: 'blocked_by' }]);
    });

    it('addLink is idempotent for the same pair and type', async () => {
      const a = await repo.createTicket(base);
      const b = await repo.createTicket({ ...base, title: 'other' });
      await repo.addLink(a.id, b.id, 'relates_to');
      await repo.addLink(a.id, b.id, 'relates_to');
      expect((await repo.getTicket(a.id))?.links).toHaveLength(1);
    });

    it('addLink returns null when either ticket is missing', async () => {
      const a = await repo.createTicket(base);
      expect(await repo.addLink(a.id, 'ghost', 'blocks')).toBeNull();
    });

    it('removeLink clears both directions', async () => {
      const a = await repo.createTicket(base);
      const b = await repo.createTicket({ ...base, title: 'other' });
      await repo.addLink(a.id, b.id, 'blocks');
      await repo.removeLink(a.id, b.id);
      expect((await repo.getTicket(a.id))?.links).toEqual([]);
      expect((await repo.getTicket(b.id))?.links).toEqual([]);
    });

    it('deleting a ticket removes links pointing at it', async () => {
      // The legacy path cleared the comment and activity Maps but forgot the
      // link Map, leaving the surviving ticket linked to a ticket that is gone.
      const a = await repo.createTicket(base);
      const b = await repo.createTicket({ ...base, title: 'other' });
      await repo.addLink(a.id, b.id, 'blocks');
      await repo.deleteTicket(b.id);
      expect((await repo.getTicket(a.id))?.links).toEqual([]);
    });

    it('deleting a ticket removes its comments and activity', async () => {
      const t = await repo.createTicket(base);
      await repo.addComment(t.id, 'gone soon', 'alice');
      expect(await repo.deleteTicket(t.id)).toBe(true);
      expect(await repo.getComments(t.id)).toEqual([]);
      expect(await repo.getActivity(t.id)).toEqual([]);
    });

    it('deleteTicket reports false for an unknown id', async () => {
      expect(await repo.deleteTicket('nope')).toBe(false);
    });
  });

  describe('updateTicket', () => {
    it('sets resolvedAt on entering a terminal status and clears it on reopen', async () => {
      const t = await repo.createTicket(base);
      const done = await repo.updateTicket(t.id, { status: 'done' }, 'alice');
      expect(done?.resolvedAt).toBeTruthy();
      const reopened = await repo.updateTicket(t.id, { status: 'todo' }, 'alice');
      expect(reopened?.resolvedAt).toBeNull();
    });

    it('merges the patch instead of replacing the document', async () => {
      const t = await repo.createTicket(base);
      const updated = await repo.updateTicket(t.id, { assignee: 'carol' }, 'bob');
      expect(updated?.assignee).toBe('carol');
      expect(updated?.title).toBe(base.title); // untouched
    });

    it('returns undefined for an unknown ticket', async () => {
      expect(await repo.updateTicket('nope', { status: 'done' }, 'alice')).toBeUndefined();
    });
  });

  describe('queries', () => {
    it('findByLinkedFinding matches on array membership', async () => {
      const t = await repo.createTicket(base);
      expect((await repo.findByLinkedFinding('finding-1'))?.id).toBe(t.id);
      expect(await repo.findByLinkedFinding('finding-absent')).toBeUndefined();
    });

    it('listTickets filters by status and paginates', async () => {
      await repo.createTicket(base);
      await repo.createTicket({ ...base, status: 'done' });
      const open = await repo.listTickets({ status: 'todo' });
      expect(open.total).toBe(1);
      const paged = await repo.listTickets({ limit: 1 });
      expect(paged.data).toHaveLength(1);
      expect(paged.total).toBe(2);
      expect(paged.totalPages).toBe(2);
    });

    it('listTickets searches title and description', async () => {
      await repo.createTicket(base);
      await repo.createTicket({ ...base, title: 'unrelated', description: 'nothing' });
      expect((await repo.listTickets({ search: 'injection' })).total).toBe(1);
    });

    it('marks a past-deadline open ticket overdue but never a closed one', async () => {
      await repo.createTicket({ ...base, dueDate: '2000-01-01T00:00:00.000Z' });
      await repo.createTicket({ ...base, status: 'done', dueDate: '2000-01-01T00:00:00.000Z' });
      const overdue = await repo.listTickets({ overdue: true });
      expect(overdue.total).toBe(1);
      expect(overdue.data[0].status).toBe('todo');
    });

    it('getUnsyncedTickets returns tickets never synced or errored', async () => {
      await repo.createTicket(base); // no jiraKey
      const synced = await repo.createTicket({ ...base, title: 'synced' });
      await repo.updateTicket(synced.id, { jiraKey: 'SEC-1', jiraSyncStatus: 'synced' }, 'sys');
      const unsynced = await repo.getUnsyncedTickets();
      expect(unsynced).toHaveLength(1);
      expect(unsynced[0].title).toBe(base.title);
    });

    it('getStats counts by status, priority and overdue', async () => {
      await repo.createTicket(base);
      await repo.createTicket({ ...base, status: 'done', priority: 'low' });
      await repo.createTicket({ ...base, dueDate: '2000-01-01T00:00:00.000Z' });
      const stats = await repo.getStats();
      expect(stats.total).toBe(3);
      expect(stats.open).toBe(2);
      expect(stats.resolved).toBe(1);
      expect(stats.critical).toBe(2);
      expect(stats.countsByStatus.done).toBe(1);
      expect(stats.overdue).toBe(1);
      expect(stats.agingTickets.length).toBeLessThanOrEqual(5);
    });
  });

// Tenant isolation lives in this file rather than its own so both suites share a
// jest worker. Separate files run in parallel workers, and both TRUNCATE the
// tickets table — one suite would wipe rows mid-test in the other.

const owned = (over: Partial<Ticket> = {}): Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'> => ({
  title: 'SQL injection in login',
  description: 'Parameterize the query',
  status: 'todo',
  priority: 'critical',
  type: 'vulnerability',
  severity: 9,
  assignee: '',
  reporter: 'alice@acme.test',
  tags: [],
  linkedFindings: [],
  ...over,
});

const ALICE = { user_id: 'user-alice', team_id: null };
const BOB = { user_id: 'user-bob', team_id: null };

describe('tenant isolation', () => {
  it('persists the owner on create', async () => {
    const t = await repo.createTicket(owned(ALICE));
    expect((await repo.getTicket(t.id))?.user_id).toBe('user-alice');
  });

  it("a tenant's list contains only their own tickets", async () => {
    await repo.createTicket(owned(ALICE));
    await repo.createTicket(owned({ ...BOB, title: "bob's secret vulnerability" }));

    const aliceList = await repo.listTickets({}, { field: 'user_id', value: 'user-alice' });
    expect(aliceList.total).toBe(1);
    expect(aliceList.data[0].title).toBe('SQL injection in login');
  });

  it('the total reflects the scoped count, not the global one', async () => {
    // Pagination computed from an unscoped total leaks how many tickets other
    // tenants hold even when the rows themselves are filtered out.
    await repo.createTicket(owned(ALICE));
    await repo.createTicket(owned(BOB));
    await repo.createTicket(owned(BOB));

    const aliceList = await repo.listTickets({}, { field: 'user_id', value: 'user-alice' });
    expect(aliceList.total).toBe(1);
    expect(aliceList.totalPages).toBe(1);
  });

  it('scoping survives alongside other filters', async () => {
    await repo.createTicket(owned({ ...ALICE, status: 'todo' }));
    await repo.createTicket(owned({ ...BOB, status: 'todo' }));

    const scoped = await repo.listTickets({ status: 'todo' }, { field: 'user_id', value: 'user-alice' });
    expect(scoped.total).toBe(1);
    expect(scoped.data[0].user_id).toBe('user-alice');
  });

  it('a search cannot reach across tenants', async () => {
    await repo.createTicket(owned({ ...BOB, title: 'bob confidential breach' }));
    const found = await repo.listTickets(
      { search: 'confidential' },
      { field: 'user_id', value: 'user-alice' }
    );
    expect(found.total).toBe(0);
  });

  it('stats aggregate only the caller tenant', async () => {
    await repo.createTicket(owned(ALICE));
    await repo.createTicket(owned(BOB));
    await repo.createTicket(owned(BOB));

    const stats = await repo.getStats({ field: 'user_id', value: 'user-alice' });
    expect(stats.total).toBe(1);
    expect(stats.open).toBe(1);
  });

  it('team-scoped tickets are visible to the team, not to an outsider', async () => {
    await repo.createTicket(owned({ user_id: 'user-alice', team_id: 'team-acme' }));

    const byTeam = await repo.listTickets({}, { field: 'team_id', value: 'team-acme' });
    expect(byTeam.total).toBe(1);

    const otherTeam = await repo.listTickets({}, { field: 'team_id', value: 'team-other' });
    expect(otherTeam.total).toBe(0);
  });

  it('an unscoped list still returns everything — scope is the caller\'s job', async () => {
    // Documents the contract deliberately: the repository does not invent a
    // default tenant. The route layer must always pass a scope, which is why
    // the guard lives in middleware rather than being optional per handler.
    await repo.createTicket(owned(ALICE));
    await repo.createTicket(owned(BOB));
    expect((await repo.listTickets({})).total).toBe(2);
  });
});
});
