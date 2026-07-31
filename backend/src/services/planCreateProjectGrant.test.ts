jest.mock('./tenancyService', () => ({ canAccessResource: jest.fn() }));
jest.mock('../repositories/planRepository', () => ({
  planRepository: { createProject: jest.fn(), deleteProject: jest.fn(), projectExistsInAppwrite: jest.fn() },
}));
jest.mock('../repositories/projectRepoRepository', () => ({ projectRepoRepository: { listRepoIds: jest.fn() } }));
jest.mock('./threatAiService', () => ({ generateStrideThreats: jest.fn() }));
jest.mock('../authz/backfill', () => ({
  grantAdmin: jest.fn(),
  emptyTally: () => ({ projects: 0, granted: 0, existing: 0, unowned: [] }),
}));
jest.mock('./logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { planService } from './planService';
import { planRepository } from '../repositories/planRepository';
import { grantAdmin } from '../authz/backfill';

const createProject = planRepository.createProject as jest.Mock;
const deleteProject = planRepository.deleteProject as jest.Mock;
const grant = grantAdmin as jest.Mock;
const existsInAppwrite = planRepository.projectExistsInAppwrite as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations, so a rejection queued by one test
  // would otherwise leak into the next.
  grant.mockReset();
  createProject.mockReset();
  createProject.mockResolvedValue({ $id: 'p-new', name: 'Board' });
  deleteProject.mockResolvedValue(true);
  existsInAppwrite.mockResolvedValue(true);
});

test('a new project is granted to its creator, or nobody could open it', async () => {
  // Without this the creator cannot see the project they just made, and cannot
  // delete what they cannot see.
  await planService.createProject({ name: 'Board' }, 'u1', null);

  expect(grant).toHaveBeenCalledWith('p-new', 'user', 'u1', expect.anything(), 'u1');
});

test('a project created under a team is granted to the team as well', async () => {
  await planService.createProject({ name: 'Board' }, 'u1', 't1');

  expect(grant).toHaveBeenCalledWith('p-new', 'team', 't1', expect.anything(), 'u1');
  expect(grant).toHaveBeenCalledTimes(2);
});

test('no team means no team grant', async () => {
  await planService.createProject({ name: 'Board' }, 'u1', null);

  expect(grant).toHaveBeenCalledTimes(1);
});

test('a failed grant rolls the project back rather than leaving it unreachable', async () => {
  grant.mockRejectedValue(new Error('appwrite down'));

  await expect(planService.createProject({ name: 'Board' }, 'u1', null)).rejects.toThrow('access grant failed');
  expect(deleteProject).toHaveBeenCalledWith('p-new');
});

test('a project that only reached the local JSON fallback is kept, not rolled back', async () => {
  // Nothing reached Appwrite, so a grant would have nowhere to point. That path
  // is degraded by definition; failing the request defeats the fallback.
  grant.mockRejectedValue(new Error('no appwrite'));
  existsInAppwrite.mockResolvedValue(false);

  await expect(planService.createProject({ name: 'Board' }, 'u1', null)).resolves.toMatchObject({ $id: 'p-new' });
  expect(deleteProject).not.toHaveBeenCalled();
});

test('a failed rollback still surfaces the original error', async () => {
  // Both writes failing means Appwrite is down; the caller must hear about it
  // rather than receive a project id that will not work.
  grant.mockRejectedValue(new Error('appwrite down'));
  deleteProject.mockRejectedValue(new Error('also down'));

  await expect(planService.createProject({ name: 'Board' }, 'u1', null)).rejects.toThrow('access grant failed');
});
