// The Plan surface authorized with strict owner equality:
//   assertProjectAccess -> getProjectOwner(projectId) === userId
// so a team member could not open a teammate's project, epics, sprints or
// issues, even though repositories and incidents moved to the union model in
// #151/#161. This brings Plan onto the same boundary: owner OR team member.
jest.mock('../repositories/planRepository', () => ({
  planRepository: { getProject: jest.fn(), getProjectOwner: jest.fn() },
}));
jest.mock('./tenancyService', () => ({ canAccessResource: jest.fn() }));

import { assertProjectAccess } from './planService';
import { planRepository } from '../repositories/planRepository';
import { canAccessResource } from './tenancyService';

const getProject = planRepository.getProject as jest.Mock;
const canAccess = canAccessResource as jest.Mock;

beforeEach(() => {
  getProject.mockReset();
  canAccess.mockReset();
});

test('the project owner keeps access', async () => {
  getProject.mockResolvedValue({ $id: 'p1', user_id: 'u1', team_id: null });
  canAccess.mockResolvedValue(true);

  expect(await assertProjectAccess('p1', 'u1')).toBe(true);
});

test('a member of the owning team gains access', async () => {
  // The behaviour that did not exist before: team_id is consulted, so a
  // teammate can open the project rather than being refused as a stranger.
  getProject.mockResolvedValue({ $id: 'p1', user_id: 'someone-else', team_id: 'team-9' });
  canAccess.mockResolvedValue(true);

  expect(await assertProjectAccess('p1', 'u2')).toBe(true);
  expect(canAccess).toHaveBeenCalledWith(
    expect.objectContaining({ user_id: 'someone-else', team_id: 'team-9' }),
    'u2',
  );
});

test('an unrelated user is still refused', async () => {
  getProject.mockResolvedValue({ $id: 'p1', user_id: 'someone-else', team_id: 'team-9' });
  canAccess.mockResolvedValue(false);

  expect(await assertProjectAccess('p1', 'stranger')).toBe(false);
});

test('no session is refused without touching the database', async () => {
  expect(await assertProjectAccess('p1', undefined)).toBe(false);
  expect(getProject).not.toHaveBeenCalled();
});

test('a missing project is refused rather than treated as unowned', async () => {
  getProject.mockResolvedValue(null);

  expect(await assertProjectAccess('gone', 'u1')).toBe(false);
  expect(canAccess).not.toHaveBeenCalled();
});

test('a project predating the team_id attribute behaves exactly as before', async () => {
  // Until the migration runs, team_id is simply absent. canAccessResource then
  // falls back to owner equality, so this change cannot widen access on an
  // un-migrated database — it degrades to today's behaviour.
  getProject.mockResolvedValue({ $id: 'p1', user_id: 'u1' });
  canAccess.mockResolvedValue(true);

  expect(await assertProjectAccess('p1', 'u1')).toBe(true);
});

test('a read failure denies rather than opening the project', async () => {
  getProject.mockRejectedValue(new Error('appwrite down'));

  // Fail closed: an unreadable ownership record is not permission to proceed.
  expect(await assertProjectAccess('p1', 'u1')).toBe(false);
});
