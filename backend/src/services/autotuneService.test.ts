jest.mock('../lib/paginate', () => ({ fetchAllDocuments: jest.fn() }));
jest.mock('../lib/appwrite', () => ({
  COLLECTIONS: { REPOSITORIES: 'repositories', FINDINGS: 'findings' },
  Query: { equal: (f: string, v: unknown) => ({ f, v }) },
}));
jest.mock('../repositories/gateRulesRepository', () => ({
  gateRulesRepository: { get: jest.fn(), save: jest.fn() },
}));
jest.mock('../repositories/autotuneProposalRepository', () => ({
  autotuneProposalRepository: { getOwned: jest.fn(), close: jest.fn(), create: jest.fn(), listForUser: jest.fn() },
}));
jest.mock('./logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('./logger'),
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { autotuneService } from './autotuneService';
import { fetchAllDocuments } from '../lib/paginate';
import { gateRulesRepository } from '../repositories/gateRulesRepository';
import { autotuneProposalRepository } from '../repositories/autotuneProposalRepository';

const fetchAll = fetchAllDocuments as jest.Mock;
const gateGet = gateRulesRepository.get as jest.Mock;
const gateSave = gateRulesRepository.save as jest.Mock;
const repo = autotuneProposalRepository as unknown as Record<string, jest.Mock>;

const NOW = Date.parse('2026-08-01T00:00:00.000Z');
const DAY = 86_400_000;
const USER = 'u1';

/** checkov -> deploy phase. */
const findingDocs = (n: number, scanner = 'checkov', severity = 'high', ageDays = 1) =>
  Array.from({ length: n }, (_, i) => ({
    $id: `f${i}`, $createdAt: new Date(NOW - ageDays * DAY).toISOString(),
    severity, scanner, status: 'open',
  }));

const proposal = (over: Record<string, unknown> = {}) => ({
  $id: 'p1', user_id: USER, status: 'open',
  target_kind: 'gate_rule', target_id: 'seed-high', field: 'threshold',
  current_value: '5', proposed_value: '4',
  rationale: 'because', metric_key: 'escape_share:deploy',
  metric_value: 0.8, metric_threshold: 0.4,
  evidence_query: JSON.stringify({ kind: 'escape_share', phase: 'deploy', severity: 'high', windowDays: 30, minSample: 10 }),
  created_at: new Date(NOW - DAY).toISOString(),
  expires_at: new Date(NOW + 13 * DAY).toISOString(),
  ...over,
});

const config = (threshold = 5) => ({
  env: 'prod', rules: [{ id: 'seed-high', severity: 'high', threshold, action: 'warn', enabled: true }],
});

/** repositories read, then findings read. */
function wireFindings(docs: unknown[], truncated = false) {
  fetchAll.mockImplementation(async (collection: string) =>
    collection === 'repositories'
      ? { items: [{ $id: 'r1' }], total: 1, truncated: false }
      : { items: docs, total: docs.length, truncated });
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchAll.mockReset();
  gateGet.mockReset();
  gateSave.mockReset();
  for (const fn of Object.values(repo)) fn.mockReset();
  gateGet.mockResolvedValue(config());
  gateSave.mockResolvedValue(undefined);
  repo.close.mockImplementation(async (id: string, status: string) => ({ ...proposal(), $id: id, status }));
  wireFindings(findingDocs(12));
});

describe('ownership', () => {
  test('a proposal belonging to someone else is not found, not forbidden', async () => {
    // A proposal names a security control and its evidence; confirming one
    // exists is disclosure even without acting on it.
    repo.getOwned.mockResolvedValue(null);

    expect(await autotuneService.decide('p1', 'intruder', 'approve', '', NOW)).toEqual({ outcome: 'not_found' });
    expect(gateSave).not.toHaveBeenCalled();
  });
});

describe('approve', () => {
  test('applies the rule and records the metric the approver actually saw', async () => {
    repo.getOwned.mockResolvedValue(proposal());

    const result = await autotuneService.decide('p1', USER, 'approve', 'looks right', NOW);

    expect(result.outcome).toBe('applied');
    expect(gateSave).toHaveBeenCalledWith(USER, expect.objectContaining({
      rules: [expect.objectContaining({ id: 'seed-high', threshold: 4 })],
    }));
    expect(repo.close).toHaveBeenCalledWith('p1', 'applied', USER, expect.any(String), 1);
  });

  test('refuses and marks stale when the spike has resolved', async () => {
    // The proposal said 80% of escapes were at deploy. Now they are not, so the
    // change it argued for is no longer justified.
    repo.getOwned.mockResolvedValue(proposal());
    wireFindings([...findingDocs(2, 'checkov'), ...findingDocs(10, 'semgrep')]);

    const result = await autotuneService.decide('p1', USER, 'approve', '', NOW);

    expect(result.outcome).toBe('stale');
    expect(gateSave).not.toHaveBeenCalled();
    expect(repo.close).toHaveBeenCalledWith('p1', 'stale', USER, expect.stringContaining('now 17%'), expect.any(Number));
  });

  test('the stale note carries the delta, so the reviewer sees what changed', async () => {
    repo.getOwned.mockResolvedValue(proposal());
    wireFindings([...findingDocs(2, 'checkov'), ...findingDocs(10, 'semgrep')]);

    const result = await autotuneService.decide('p1', USER, 'approve', '', NOW) as { detail: string };

    expect(result.detail).toMatch(/was 80% of escapes when proposed, now 17%/);
  });

  test('refuses when the sample has fallen below the minimum', async () => {
    wireFindings(findingDocs(4));
    repo.getOwned.mockResolvedValue(proposal());

    const result = await autotuneService.decide('p1', USER, 'approve', '', NOW) as { outcome: string; detail: string };

    expect(result.outcome).toBe('stale');
    expect(result.detail).toMatch(/need 10/);
  });

  test('refuses when the rule was hand-tightened past the proposal', async () => {
    // Proposal: 5 -> 4. Rule is now 2. Applying it would move the control
    // BACKWARDS, which is exactly what tighten-only exists to prevent.
    repo.getOwned.mockResolvedValue(proposal());
    gateGet.mockResolvedValue(config(2));

    const result = await autotuneService.decide('p1', USER, 'approve', '', NOW) as { outcome: string; detail: string };

    expect(result.outcome).toBe('stale');
    expect(result.detail).toMatch(/no longer a tightening change/);
    expect(gateSave).not.toHaveBeenCalled();
  });

  test('refuses when the target rule has been deleted', async () => {
    repo.getOwned.mockResolvedValue(proposal());
    gateGet.mockResolvedValue({ env: 'prod', rules: [] });

    const result = await autotuneService.decide('p1', USER, 'approve', '', NOW) as { outcome: string; detail: string };

    expect(result.outcome).toBe('stale');
    expect(result.detail).toMatch(/no longer exists/);
  });

  test('an expired proposal is closed rather than applied', async () => {
    repo.getOwned.mockResolvedValue(proposal({ expires_at: new Date(NOW - DAY).toISOString() }));

    expect((await autotuneService.decide('p1', USER, 'approve', '', NOW)).outcome).toBe('expired');
    expect(gateSave).not.toHaveBeenCalled();
  });

  test('an unreadable evidence source refuses the apply and leaves the proposal open', async () => {
    // An outage is not a reason to discard a valid proposal, nor to apply one
    // whose justification could not be verified.
    repo.getOwned.mockResolvedValue(proposal());
    fetchAll.mockRejectedValue(new Error('appwrite down'));

    const result = await autotuneService.decide('p1', USER, 'approve', '', NOW);

    expect(result.outcome).toBe('unavailable');
    expect(gateSave).not.toHaveBeenCalled();
    expect(repo.close).not.toHaveBeenCalled();
  });

  test('a truncated findings read is treated as unverifiable, not as a smaller sample', async () => {
    // A share computed over a truncated set has the wrong denominator.
    repo.getOwned.mockResolvedValue(proposal());
    wireFindings(findingDocs(12), true);

    expect((await autotuneService.decide('p1', USER, 'approve', '', NOW)).outcome).toBe('unavailable');
  });

  test('a proposal already decided cannot be decided again', async () => {
    repo.getOwned.mockResolvedValue(proposal({ status: 'applied' }));

    expect(await autotuneService.decide('p1', USER, 'approve', '', NOW)).toEqual({ outcome: 'not_open', status: 'applied' });
  });
});

describe('reject', () => {
  test('closes without touching the gate or re-reading evidence', async () => {
    repo.getOwned.mockResolvedValue(proposal());

    expect((await autotuneService.decide('p1', USER, 'reject', 'not now', NOW)).outcome).toBe('rejected');
    expect(gateSave).not.toHaveBeenCalled();
    expect(fetchAll).not.toHaveBeenCalled();
  });
});

describe('scan', () => {
  test('persists a proposal when a phase dominates', async () => {
    repo.listForUser.mockResolvedValue([]);
    repo.create.mockImplementation(async (_u: string, d: Record<string, unknown>) => ({ $id: 'new', ...d }));

    const result = await autotuneService.scan(USER, NOW);

    expect(result.created).toHaveLength(1);
    expect(repo.create).toHaveBeenCalledWith(USER, expect.objectContaining({ targetId: 'seed-high' }), NOW);
  });

  test('does not re-queue a proposal that is already open', async () => {
    repo.listForUser.mockResolvedValue([{ target_id: 'seed-high', field: 'threshold' }]);

    const result = await autotuneService.scan(USER, NOW);

    expect(result.created).toEqual([]);
    expect(result.skipped).toBeGreaterThan(0);
  });
});

describe('the severity half of the evidence', () => {
  test('refuses when the phase still dominates but that severity has evaporated', async () => {
    // The proposal argued about HIGH findings at the deploy phase. Deploy is
    // still 100% of escapes, but almost all of it is medium now — the change it
    // asked for is no longer the change the data supports.
    repo.getOwned.mockResolvedValue(proposal());
    wireFindings([...findingDocs(3, 'checkov', 'high'), ...findingDocs(20, 'checkov', 'medium')]);

    const result = await autotuneService.decide('p1', USER, 'approve', '', NOW) as { outcome: string; detail: string };

    expect(result.outcome).toBe('stale');
    expect(result.detail).toMatch(/only 3 high findings remain there/);
    expect(gateSave).not.toHaveBeenCalled();
  });

  test('applies when both the share and the severity count still hold', async () => {
    repo.getOwned.mockResolvedValue(proposal());
    wireFindings(findingDocs(20, 'checkov', 'high'));

    expect((await autotuneService.decide('p1', USER, 'approve', '', NOW)).outcome).toBe('applied');
  });

  test('a proposal written before the severity check is share-only, not broken', async () => {
    // An older row carries no severity, so it is judged on the share alone
    // rather than refused outright.
    repo.getOwned.mockResolvedValue(proposal({
      evidence_query: JSON.stringify({ kind: 'escape_share', phase: 'deploy', windowDays: 30, minSample: 10 }),
    }));
    wireFindings(findingDocs(20, 'checkov', 'medium'));

    expect((await autotuneService.decide('p1', USER, 'approve', '', NOW)).outcome).toBe('applied');
  });
});
