jest.mock('../repositories/dashboardRepository', () => ({
  dashboardRepository: {
    getUserTeamIds: jest.fn(),
    listUserRepos: jest.fn(),
    listScansForRepos: jest.fn(),
    listFindingsForReposOrScans: jest.fn(),
  },
}));

import { dashboardService } from './dashboardService';
import { dashboardRepository } from '../repositories/dashboardRepository';

const repo = dashboardRepository as jest.Mocked<typeof dashboardRepository>;

const iso = (d: Date) => d.toISOString();
const todayAt = (hour: number) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
};
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** A finding as the dashboard repository returns it. */
const finding = (over: Record<string, unknown> = {}) => ({
  $id: 'f1',
  $createdAt: iso(daysAgo(5)),
  $updatedAt: iso(daysAgo(5)),
  status: 'open',
  severity: 'high',
  type: 'sast',
  repo_id: 'r1',
  ...over,
});

function withFindings(findings: unknown[]) {
  repo.getUserTeamIds.mockResolvedValue([]);
  repo.listUserRepos.mockResolvedValue({
    total: 1, documents: [{ $id: 'r1', name: 'app', url: 'https://x/1' }],
  } as never);
  repo.listScansForRepos.mockResolvedValue({ total: 0, documents: [] } as never);
  repo.listFindingsForReposOrScans.mockResolvedValue({
    total: findings.length, documents: findings,
  } as never);
}

beforeEach(() => jest.clearAllMocks());

describe('getSecurityDashboard — remediated_today', () => {
  it('counts a finding resolved today', async () => {
    withFindings([
      finding({ status: 'resolved', $createdAt: iso(daysAgo(3)), $updatedAt: iso(todayAt(9)) }),
    ]);
    const stats = await dashboardService.getSecurityDashboard('user-alice');
    expect(stats.remediated_today).toBe(1);
    expect(stats.resolved_count).toBe(1);
  });

  it('excludes one resolved before midnight', async () => {
    withFindings([
      finding({ status: 'resolved', $createdAt: iso(daysAgo(9)), $updatedAt: iso(daysAgo(2)) }),
    ]);
    const stats = await dashboardService.getSecurityDashboard('user-bob');
    expect(stats.remediated_today).toBe(0);
    expect(stats.resolved_count).toBe(1); // still resolved, just not today
  });

  it('does not count an open finding', async () => {
    withFindings([finding({ status: 'open', $updatedAt: iso(todayAt(10)) })]);
    const stats = await dashboardService.getSecurityDashboard('user-carol');
    expect(stats.remediated_today).toBe(0);
    expect(stats.open_count).toBe(1);
  });

  it('counts remediated as well as resolved', async () => {
    withFindings([
      finding({ $id: 'a', status: 'remediated', $createdAt: iso(daysAgo(1)), $updatedAt: iso(todayAt(8)) }),
      finding({ $id: 'b', status: 'resolved', $createdAt: iso(daysAgo(1)), $updatedAt: iso(todayAt(11)) }),
    ]);
    expect((await dashboardService.getSecurityDashboard('user-dave')).remediated_today).toBe(2);
  });

  it('reports zero for a tenant with no repositories', async () => {
    repo.getUserTeamIds.mockResolvedValue([]);
    repo.listUserRepos.mockResolvedValue({ total: 0, documents: [] } as never);
    const stats = await dashboardService.getSecurityDashboard('user-empty');
    expect(stats.remediated_today).toBe(0);
    // The early return must carry every field, or the client reads undefined.
    expect(stats.open_count).toBe(0);
    expect(stats.mttr_days).toBeNull();
  });

  it('scopes the repository lookup to the calling user', async () => {
    // A fresh id per test: the service caches per user, so reusing one from an
    // earlier test would be served from cache and never hit the repository.
    withFindings([]);
    await dashboardService.getSecurityDashboard('user-scope-check');
    expect(repo.listUserRepos).toHaveBeenCalledWith('user-scope-check', []);
  });

  it('caches per user, so one tenant cannot be served another stats', async () => {
    withFindings([finding({ status: 'resolved', $updatedAt: iso(todayAt(9)) })]);
    await dashboardService.getSecurityDashboard('user-cache-a');
    repo.listUserRepos.mockClear();
    // Different user → must not hit the cache populated above.
    await dashboardService.getSecurityDashboard('user-cache-b');
    expect(repo.listUserRepos).toHaveBeenCalledWith('user-cache-b', []);
  });
});

describe('getSecurityDashboard — sla', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

  it('counts an open critical past its 24h window as breached', async () => {
    withFindings([finding({ severity: 'critical', $createdAt: iso(hoursAgo(30)) })]);
    const { sla } = await dashboardService.getSecurityDashboard('sla-a');
    expect(sla.breached).toBe(1);
    expect(sla.breachedCritical).toBe(1);
  });

  it('counts a high inside 24h of its 72h window as due soon', async () => {
    withFindings([finding({ severity: 'high', $createdAt: iso(hoursAgo(60)) })]);
    const { sla } = await dashboardService.getSecurityDashboard('sla-b');
    expect(sla.dueSoon).toBe(1);
    expect(sla.breached).toBe(0);
  });

  it('reports the soonest upcoming breach in nextHours', async () => {
    withFindings([
      finding({ $id: 'a', severity: 'high', $createdAt: iso(hoursAgo(60)) }),  // ~12h left
      finding({ $id: 'b', severity: 'low', $createdAt: iso(hoursAgo(1)) }),    // ~719h left
    ]);
    const { sla } = await dashboardService.getSecurityDashboard('sla-c');
    expect(sla.nextHours).toBeGreaterThan(11);
    expect(sla.nextHours).toBeLessThan(13);
  });

  it('ignores resolved findings — an SLA only applies to open work', async () => {
    withFindings([
      finding({ status: 'resolved', severity: 'critical', $createdAt: iso(hoursAgo(500)) }),
    ]);
    expect((await dashboardService.getSecurityDashboard('sla-d')).sla.breached).toBe(0);
  });

  it('falls back to the medium window for an unknown severity', async () => {
    // Matches the frontend's previous `?? 168` default, so the displayed
    // numbers do not move as part of this migration.
    withFindings([finding({ severity: 'bogus', $createdAt: iso(hoursAgo(200)) })]);
    expect((await dashboardService.getSecurityDashboard('sla-e')).sla.breached).toBe(1);
  });

  it('leaves nextHours null when every open finding is already breached', async () => {
    withFindings([finding({ severity: 'critical', $createdAt: iso(hoursAgo(99)) })]);
    expect((await dashboardService.getSecurityDashboard('sla-f')).sla.nextHours).toBeNull();
  });

  it('reports an empty summary for a tenant with no repositories', async () => {
    repo.getUserTeamIds.mockResolvedValue([]);
    repo.listUserRepos.mockResolvedValue({ total: 0, documents: [] } as never);
    const { sla } = await dashboardService.getSecurityDashboard('sla-empty');
    expect(sla).toEqual({ breached: 0, dueSoon: 0, breachedCritical: 0, nextHours: null });
  });
});

describe('getSecurityDashboard — recent_findings', () => {
  it('surfaces the highest-risk of the recent findings', async () => {
    withFindings([
      finding({ $id: 'low', risk_score: 10 }),
      finding({ $id: 'high', risk_score: 90 }),
      finding({ $id: 'mid', risk_score: 50 }),
    ]);
    const { recent_findings } = await dashboardService.getSecurityDashboard('rf-a');
    expect(recent_findings.map(f => f.$id)).toEqual(['high', 'mid', 'low']);
  });

  it('treats a missing risk_score as zero rather than dropping the finding', async () => {
    // risk_score is absent on documents written before it existed; those must
    // still appear, ranked last.
    withFindings([finding({ $id: 'scored', risk_score: 5 }), finding({ $id: 'unscored' })]);
    const { recent_findings } = await dashboardService.getSecurityDashboard('rf-b');
    expect(recent_findings.map(f => f.$id)).toEqual(['scored', 'unscored']);
  });

  it('returns at most five', async () => {
    withFindings(Array.from({ length: 12 }, (_, i) => finding({ $id: `f${i}`, risk_score: i })));
    expect((await dashboardService.getSecurityDashboard('rf-c')).recent_findings).toHaveLength(5);
  });

  it('ranks by risk only within the recent window, not across all history', async () => {
    // An old high-risk finding must not displace recent ones: the panel is
    // "latest findings", ordered by risk among those.
    const recent = Array.from({ length: 50 }, (_, i) =>
      finding({ $id: `new${i}`, risk_score: 1, $createdAt: iso(daysAgo(1)) }));
    withFindings([...recent, finding({ $id: 'ancient', risk_score: 99, $createdAt: iso(daysAgo(400)) })]);
    const { recent_findings } = await dashboardService.getSecurityDashboard('rf-d');
    expect(recent_findings.map(f => f.$id)).not.toContain('ancient');
  });

  it('is empty for a tenant with no repositories', async () => {
    repo.getUserTeamIds.mockResolvedValue([]);
    repo.listUserRepos.mockResolvedValue({ total: 0, documents: [] } as never);
    expect((await dashboardService.getSecurityDashboard('rf-empty')).recent_findings).toEqual([]);
  });
});

describe('getSecurityDashboard — latest_scan', () => {
  it('returns the head of the scan list, which the repository orders newest-first', async () => {
    withFindings([]);
    repo.listScansForRepos.mockResolvedValue({
      total: 2,
      documents: [
        { $id: 's-new', gateStatus: 'failed', score: 61 },
        { $id: 's-old', gateStatus: 'passed', score: 98 },
      ],
    } as never);
    const { latest_scan } = await dashboardService.getSecurityDashboard('ls-a');
    expect(latest_scan?.$id).toBe('s-new');
    expect(latest_scan?.gateStatus).toBe('failed');
  });

  it('is null when the tenant has never scanned', async () => {
    // Not the same as a passing gate: the client must render "no scan yet"
    // rather than defaulting to passed/100.
    withFindings([]);
    expect((await dashboardService.getSecurityDashboard('ls-b')).latest_scan).toBeNull();
  });

  it('is null for a tenant with no repositories', async () => {
    repo.getUserTeamIds.mockResolvedValue([]);
    repo.listUserRepos.mockResolvedValue({ total: 0, documents: [] } as never);
    expect((await dashboardService.getSecurityDashboard('ls-empty')).latest_scan).toBeNull();
  });
});
