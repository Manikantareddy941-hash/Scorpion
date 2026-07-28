jest.mock('./tenancyService', () => ({ canAccessResource: jest.fn() }));
jest.mock('../repositories/planRepository', () => ({
  planRepository: { getProject: jest.fn(), listVulnerabilitiesForRepos: jest.fn() },
}));
jest.mock('../repositories/projectRepoRepository', () => ({
  projectRepoRepository: { listRepoIds: jest.fn() },
}));
jest.mock('./threatAiService', () => ({ generateStrideThreats: jest.fn() }));

import { planService } from './planService';
import { planRepository } from '../repositories/planRepository';
import { projectRepoRepository } from '../repositories/projectRepoRepository';
import { canAccessResource } from './tenancyService';

const getProject = planRepository.getProject as jest.Mock;
const listVulns = planRepository.listVulnerabilitiesForRepos as jest.Mock;
const listRepoIds = projectRepoRepository.listRepoIds as jest.Mock;
const canAccess = canAccessResource as jest.Mock;

const finding = (over: Record<string, unknown>) => ({
  $id: 'f1', ruleId: 'CVE-2021-44228', severity: 'critical', status: 'open', repo_id: 'r1', ...over,
});

beforeEach(() => {
  getProject.mockReset().mockResolvedValue({ $id: 'p1', user_id: 'u1', team_id: null });
  canAccess.mockReset().mockResolvedValue(true);
  listRepoIds.mockReset().mockResolvedValue(['r1', 'r2']);
  listVulns.mockReset().mockResolvedValue({ items: [], degraded: false });
});

test('denies a caller who cannot access the project', async () => {
  canAccess.mockResolvedValue(false);

  expect(await planService.listCveClusters('p1', 'intruder')).toBeNull();
  // The guard runs before any finding is read.
  expect(listVulns).not.toHaveBeenCalled();
});

test('clusters only across the repositories bound to the project', async () => {
  listVulns.mockResolvedValue({
    items: [finding({ $id: 'a', repo_id: 'r1' }), finding({ $id: 'b', repo_id: 'r2' })],
    degraded: false,
  });

  const res = await planService.listCveClusters('p1', 'u1');

  // Scope comes from the project's bindings, never the owner's whole repo set.
  expect(listVulns).toHaveBeenCalledWith(['r1', 'r2']);
  expect(res!.clusters).toHaveLength(1);
  expect(res!.clusters[0].findingCount).toBe(2);
});

test('propagates a degraded read rather than reporting no shared advisories', async () => {
  // An unreadable findings store yields an empty cluster list. Without this
  // flag "nothing shared" is indistinguishable from "could not look" — the
  // same lie fixed on the gate (#162) and the plan picker (#163).
  listVulns.mockResolvedValue({ items: [], degraded: true });

  const res = await planService.listCveClusters('p1', 'u1');

  expect(res!.clusters).toEqual([]);
  expect(res!.degraded).toBe(true);
});

test('a healthy empty result is not marked degraded', async () => {
  const res = await planService.listCveClusters('p1', 'u1');

  expect(res!.clusters).toEqual([]);
  expect(res!.degraded).toBe(false);
});

test('a project with no bound repositories yields no clusters', async () => {
  listRepoIds.mockResolvedValue([]);
  listVulns.mockResolvedValue({ items: [], degraded: false });

  const res = await planService.listCveClusters('p1', 'u1');

  expect(res!.clusters).toEqual([]);
});
