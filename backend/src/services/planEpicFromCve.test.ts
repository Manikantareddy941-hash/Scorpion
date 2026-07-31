jest.mock('./tenancyService', () => ({ canAccessResource: jest.fn() }));
jest.mock('../repositories/planRepository', () => ({
  planRepository: {
    getProject: jest.fn(), listVulnerabilitiesForRepos: jest.fn(),
    findEpicByCve: jest.fn(), createEpic: jest.fn(),
    listIssues: jest.fn(), createIssue: jest.fn(), updateIssue: jest.fn(),
  },
}));
jest.mock('../repositories/projectRepoRepository', () => ({
  projectRepoRepository: { listRepoIds: jest.fn() },
}));
jest.mock('./threatAiService', () => ({ generateStrideThreats: jest.fn() }));

import { planService } from './planService';
import { planRepository } from '../repositories/planRepository';
import { projectRepoRepository } from '../repositories/projectRepoRepository';
import { canAccessResource } from './tenancyService';

const r = planRepository as unknown as Record<string, jest.Mock>;
const listRepoIds = projectRepoRepository.listRepoIds as jest.Mock;
const canAccess = canAccessResource as jest.Mock;

const CVE = 'CVE-2021-44228';
const finding = (id: string, repo = 'r1') => ({
  $id: id, ruleId: CVE, severity: 'critical', status: 'open', repo_id: repo, title: 'Log4Shell',
});

beforeEach(() => {
  jest.clearAllMocks();
  r.getProject.mockResolvedValue({ $id: 'p1', user_id: 'u1', team_id: null });
  canAccess.mockResolvedValue(true);
  listRepoIds.mockResolvedValue(['r1', 'r2']);
  r.listVulnerabilitiesForRepos.mockResolvedValue({
    items: [finding('f1', 'r1'), finding('f2', 'r2')], degraded: false,
  });
  r.findEpicByCve.mockResolvedValue(null);
  r.createEpic.mockResolvedValue({ $id: 'epic-1', cveId: CVE });
  r.listIssues.mockResolvedValue([]);
  r.createIssue.mockImplementation(async (i: Record<string, unknown>) => ({ ...i, $id: `issue-${i.vulnId}` }));
  r.updateIssue.mockImplementation(async (id: string) => ({ $id: id }));
});

test('denies a caller who cannot access the project, before creating anything', async () => {
  canAccess.mockResolvedValue(false);

  expect(await planService.createEpicFromCve('p1', CVE, 'intruder')).toBeNull();
  expect(r.createEpic).not.toHaveBeenCalled();
});

test('fails closed when the cveId attribute has not been provisioned', async () => {
  // Without cveId an epic cannot be matched to its advisory, so a repeat call
  // would silently mint duplicates. Refuse rather than litter the database.
  r.findEpicByCve.mockResolvedValue('unavailable');

  expect(await planService.createEpicFromCve('p1', CVE, 'u1')).toBe('not_migrated');
  expect(r.createEpic).not.toHaveBeenCalled();
  expect(r.createIssue).not.toHaveBeenCalled();
});

test('creates the epic and one issue per finding', async () => {
  const res = await planService.createEpicFromCve('p1', CVE, 'u1');

  expect(res).toMatchObject({ epicId: 'epic-1' });
  expect(r.createEpic).toHaveBeenCalledWith('p1', expect.objectContaining({ cveId: CVE }));
  // One issue per finding keeps per-repo remediation traceable: the same CVE is
  // patched at different times by different people.
  expect((res as { created: unknown[] }).created).toHaveLength(2);
  expect(r.createIssue).toHaveBeenCalledTimes(2);
});

test('adopts an existing unparented issue instead of duplicating it', async () => {
  // The user already filed this one by hand. Creating a second issue for the
  // same finding produces exactly the duplicate this feature exists to remove,
  // and would strand their assignee, comments and logged time on the orphan.
  r.listIssues.mockResolvedValue([{ $id: 'i-manual', vulnId: 'f1', epicId: null }]);

  const res = await planService.createEpicFromCve('p1', CVE, 'u1') as {
    created: unknown[]; adopted: { issueId: string }[]; skipped: unknown[];
  };

  expect(res.adopted).toEqual([{ findingId: 'f1', issueId: 'i-manual' }]);
  expect(r.updateIssue).toHaveBeenCalledWith('i-manual', { epicId: 'epic-1' });
  expect(res.created).toHaveLength(1); // only f2
});

test('skips an issue that already belongs to another epic, and says why', async () => {
  // Re-parenting would quietly remove it from a deliberate grouping.
  r.listIssues.mockResolvedValue([{ $id: 'i-other', vulnId: 'f1', epicId: 'epic-99' }]);

  const res = await planService.createEpicFromCve('p1', CVE, 'u1') as {
    skipped: { findingId: string; issueId: string; reason: string }[];
  };

  expect(res.skipped).toEqual([
    { findingId: 'f1', issueId: 'i-other', reason: 'already in epic-99' },
  ]);
  expect(r.updateIssue).not.toHaveBeenCalled();
});

test('an issue already in THIS epic is left alone, so re-running is a no-op', async () => {
  r.findEpicByCve.mockResolvedValue({ $id: 'epic-1', cveId: CVE });
  r.listIssues.mockResolvedValue([
    { $id: 'i1', vulnId: 'f1', epicId: 'epic-1' },
    { $id: 'i2', vulnId: 'f2', epicId: 'epic-1' },
  ]);

  const res = await planService.createEpicFromCve('p1', CVE, 'u1') as {
    created: unknown[]; adopted: unknown[]; skipped: unknown[];
  };

  expect(res.created).toEqual([]);
  expect(res.adopted).toEqual([]);
  expect(res.skipped).toEqual([]);
  expect(r.createEpic).not.toHaveBeenCalled();
});

test('reuses the existing epic for the advisory rather than minting another', async () => {
  r.findEpicByCve.mockResolvedValue({ $id: 'epic-existing', cveId: CVE });

  const res = await planService.createEpicFromCve('p1', CVE, 'u1');

  expect(res).toMatchObject({ epicId: 'epic-existing' });
  expect(r.createEpic).not.toHaveBeenCalled();
});

test('refuses an advisory with no outstanding findings', async () => {
  r.listVulnerabilitiesForRepos.mockResolvedValue({ items: [], degraded: false });

  expect(await planService.createEpicFromCve('p1', CVE, 'u1')).toBe('no_findings');
  expect(r.createEpic).not.toHaveBeenCalled();
});

test('refuses to group on a degraded read', async () => {
  // The cluster would be built from an unknown subset, so the epic would be
  // missing findings nobody could see were missing.
  r.listVulnerabilitiesForRepos.mockResolvedValue({ items: [finding('f1')], degraded: true });

  expect(await planService.createEpicFromCve('p1', CVE, 'u1')).toBe('degraded');
  expect(r.createEpic).not.toHaveBeenCalled();
});
