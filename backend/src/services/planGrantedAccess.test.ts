jest.mock('./tenancyService', () => ({ canAccessResource: jest.fn() }));
jest.mock('../repositories/planRepository', () => ({
  planRepository: { getProject: jest.fn() },
}));
jest.mock('../repositories/projectRepoRepository', () => ({ projectRepoRepository: { listRepoIds: jest.fn() } }));
jest.mock('./threatAiService', () => ({ generateStrideThreats: jest.fn() }));
jest.mock('../authz/backfill', () => ({ grantAdmin: jest.fn(), emptyTally: () => ({}) }));
jest.mock('../authz/authorizationService', () => ({ listPermissions: jest.fn() }));
jest.mock('./logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { assertLegacyProjectAccess, assertProjectAccess } from './planService';
import { planRepository } from '../repositories/planRepository';
import { canAccessResource } from './tenancyService';
import { listPermissions } from '../authz/authorizationService';

const getProject = planRepository.getProject as jest.Mock;
const canAccess = canAccessResource as jest.Mock;
const permissions = listPermissions as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getProject.mockReset();
  canAccess.mockReset();
  permissions.mockReset();
  getProject.mockResolvedValue({ $id: 'p1', user_id: 'owner', team_id: null });
  canAccess.mockResolvedValue(false);
  permissions.mockResolvedValue({ permissions: [], reason: 'not_found' });
});

test('a user granted a role reaches the project even though they are neither owner nor teammate', async () => {
  // The gap this closes: the middleware would let them in and the service would
  // then refuse, so every role an admin assigned would silently do nothing.
  permissions.mockResolvedValue({ permissions: ['project:read', 'issue:read'], reason: 'granted' });

  expect(await assertProjectAccess('p1', 'granted-user')).toBe(true);
});

test('the owner is admitted without an RBAC lookup', async () => {
  canAccess.mockResolvedValue(true);

  expect(await assertProjectAccess('p1', 'owner')).toBe(true);
  expect(permissions).not.toHaveBeenCalled();
});

test('a stranger with neither ownership nor a grant is still refused', async () => {
  expect(await assertProjectAccess('p1', 'stranger')).toBe(false);
});

test('an unreadable grant table does not admit anyone', async () => {
  // listPermissions reports unavailable rather than throwing; only an explicit
  // "granted" opens the door.
  permissions.mockResolvedValue({ permissions: [], reason: 'unavailable' });

  expect(await assertProjectAccess('p1', 'someone')).toBe(false);
});

test('the shadow comparator stays pure legacy, so divergence remains measurable', async () => {
  // If this consulted RBAC it would agree with RBAC by construction and the
  // rbac_divergence signal would be worthless.
  permissions.mockResolvedValue({ permissions: ['*'], reason: 'granted' });

  expect(await assertLegacyProjectAccess('p1', 'granted-user')).toBe(false);
  expect(permissions).not.toHaveBeenCalled();
});
