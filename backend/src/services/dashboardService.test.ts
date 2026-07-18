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
