import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { ticketsPgRepository as repo } from './ticketsPgRepository';
import type { Ticket } from '../../../../shared/types';

/**
 * Tenant isolation for tickets.
 *
 * Tickets carried no owner at all before this: listTickets returned every
 * tenant's rows and getTicket fetched any id. Since a ticket holds the title,
 * description and severity of a vulnerability, that exposed one customer's
 * security posture to another.
 */

const base = (over: Partial<Ticket> = {}): Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'> => ({
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

describeDb('tickets tenant isolation', () => {
  beforeEach(() => truncateAll(['ticket_links', 'ticket_comments', 'ticket_activity', 'tickets']));
  afterAll(() => closePool());

  it('persists the owner on create', async () => {
    const t = await repo.createTicket(base(ALICE));
    expect((await repo.getTicket(t.id))?.user_id).toBe('user-alice');
  });

  it("a tenant's list contains only their own tickets", async () => {
    await repo.createTicket(base(ALICE));
    await repo.createTicket(base({ ...BOB, title: "bob's secret vulnerability" }));

    const aliceList = await repo.listTickets({}, { field: 'user_id', value: 'user-alice' });
    expect(aliceList.total).toBe(1);
    expect(aliceList.data[0].title).toBe('SQL injection in login');
  });

  it('the total reflects the scoped count, not the global one', async () => {
    // Pagination computed from an unscoped total leaks how many tickets other
    // tenants hold even when the rows themselves are filtered out.
    await repo.createTicket(base(ALICE));
    await repo.createTicket(base(BOB));
    await repo.createTicket(base(BOB));

    const aliceList = await repo.listTickets({}, { field: 'user_id', value: 'user-alice' });
    expect(aliceList.total).toBe(1);
    expect(aliceList.totalPages).toBe(1);
  });

  it('scoping survives alongside other filters', async () => {
    await repo.createTicket(base({ ...ALICE, status: 'todo' }));
    await repo.createTicket(base({ ...BOB, status: 'todo' }));

    const scoped = await repo.listTickets({ status: 'todo' }, { field: 'user_id', value: 'user-alice' });
    expect(scoped.total).toBe(1);
    expect(scoped.data[0].user_id).toBe('user-alice');
  });

  it('a search cannot reach across tenants', async () => {
    await repo.createTicket(base({ ...BOB, title: 'bob confidential breach' }));
    const found = await repo.listTickets(
      { search: 'confidential' },
      { field: 'user_id', value: 'user-alice' }
    );
    expect(found.total).toBe(0);
  });

  it('stats aggregate only the caller tenant', async () => {
    await repo.createTicket(base(ALICE));
    await repo.createTicket(base(BOB));
    await repo.createTicket(base(BOB));

    const stats = await repo.getStats({ field: 'user_id', value: 'user-alice' });
    expect(stats.total).toBe(1);
    expect(stats.open).toBe(1);
  });

  it('team-scoped tickets are visible to the team, not to an outsider', async () => {
    await repo.createTicket(base({ user_id: 'user-alice', team_id: 'team-acme' }));

    const byTeam = await repo.listTickets({}, { field: 'team_id', value: 'team-acme' });
    expect(byTeam.total).toBe(1);

    const otherTeam = await repo.listTickets({}, { field: 'team_id', value: 'team-other' });
    expect(otherTeam.total).toBe(0);
  });

  it('an unscoped list still returns everything — scope is the caller\'s job', async () => {
    // Documents the contract deliberately: the repository does not invent a
    // default tenant. The route layer must always pass a scope, which is why
    // the guard lives in middleware rather than being optional per handler.
    await repo.createTicket(base(ALICE));
    await repo.createTicket(base(BOB));
    expect((await repo.listTickets({})).total).toBe(2);
  });
});
