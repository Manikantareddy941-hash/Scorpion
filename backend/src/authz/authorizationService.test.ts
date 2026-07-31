jest.mock('../lib/paginate', () => ({ fetchAllDocuments: jest.fn() }));
jest.mock('../services/tenancyService', () => ({ listTeamIdsForUser: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { fetchAllDocuments } from '../lib/paginate';
import { listTeamIdsForUser } from '../services/tenancyService';
import { createMemo, evaluate, resetPolicyCache } from './authorizationService';
import { ROLE_ADMIN, ROLE_EDITOR, ROLE_VIEWER, BUILTIN_ROLES } from './roles';

const fetchAll = fetchAllDocuments as jest.Mock;
const teamIds = listTeamIdsForUser as jest.Mock;

const page = (items: unknown[]) => ({ items, total: items.length, truncated: false });
const grant = (roleKey: string, subjectId = 'u1') => ({ role_key: roleKey, subject_id: subjectId });
const policyDocs = BUILTIN_ROLES.map((r) => ({ role_key: r.roleKey, permissions: r.permissions }));

/** Grants come back for project_access, roles for project_policies. */
function wire(grants: unknown[], policies: unknown[] = policyDocs): void {
  fetchAll.mockImplementation(async (collectionId: string) =>
    collectionId === 'project_access' ? page(grants) : page(policies));
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks wipes call records but leaves implementations, and the policy
  // cache survives between tests — both have to be reset explicitly or a later
  // test silently inherits an earlier one's answer.
  fetchAll.mockReset();
  resetPolicyCache();
  teamIds.mockResolvedValue([]);
});

test('a viewer may read but not write', async () => {
  wire([grant(ROLE_VIEWER)]);

  expect(await evaluate('p1', 'u1', 'issue:read')).toEqual({ allowed: true, reason: 'granted' });
  expect(await evaluate('p1', 'u1', 'issue:write')).toEqual({ allowed: false, reason: 'denied' });
});

test('admin holds everything through the wildcard', async () => {
  wire([grant(ROLE_ADMIN)]);

  expect((await evaluate('p1', 'u1', 'access:write')).allowed).toBe(true);
  expect((await evaluate('p1', 'u1', 'project:delete')).allowed).toBe(true);
});

test('a team grant raises a direct grant — highest permission wins', async () => {
  // The user is a viewer in their own right but their team administers the
  // project. Most-specific-wins would silently downgrade them; ADR-001 D2 does not.
  teamIds.mockResolvedValue(['t1']);
  wire([grant(ROLE_VIEWER, 'u1'), grant(ROLE_ADMIN, 't1')]);

  expect((await evaluate('p1', 'u1', 'issue:delete')).allowed).toBe(true);
});

test('permissions union across several team grants', async () => {
  teamIds.mockResolvedValue(['t1', 't2']);
  wire([grant(ROLE_VIEWER, 't1'), grant(ROLE_EDITOR, 't2')]);

  expect((await evaluate('p1', 'u1', 'issue:write')).allowed).toBe(true);
  // ...but neither grant carries automation, so the union does not invent it.
  expect((await evaluate('p1', 'u1', 'automation:write')).allowed).toBe(false);
});

test('holding no grant reads as not_found, never as denied', async () => {
  // A 403 would confirm the project exists to someone with no relationship to
  // it, which is free enumeration of other tenants.
  wire([]);

  expect(await evaluate('p1', 'outsider', 'issue:read')).toEqual({ allowed: false, reason: 'not_found' });
});

test('an unreadable membership list is unavailable, not denied', async () => {
  // The distinction the old `catch { return false }` destroyed: a database
  // outage presented as a permission denial sends the operator hunting for a
  // permissions bug that does not exist.
  teamIds.mockRejectedValue(new Error('appwrite down'));
  wire([grant(ROLE_ADMIN)]);

  expect(await evaluate('p1', 'u1', 'issue:read')).toEqual({ allowed: false, reason: 'unavailable' });
});

test('an unreadable grant table is unavailable', async () => {
  fetchAll.mockRejectedValue(new Error('appwrite down'));

  expect((await evaluate('p1', 'u1', 'issue:read')).reason).toBe('unavailable');
});

test('a truncated grant read is unavailable rather than a partial verdict', async () => {
  // A missing grant row is a missing permission, so a capped read would deny
  // access the user actually holds.
  fetchAll.mockImplementation(async (collectionId: string) =>
    collectionId === 'project_access'
      ? { items: [grant(ROLE_VIEWER)], total: 900, truncated: true }
      : page(policyDocs));

  expect((await evaluate('p1', 'u1', 'issue:read')).reason).toBe('unavailable');
});

test('a grant pointing at a missing role contributes nothing and does not crash', async () => {
  wire([grant('role_that_was_deleted')]);

  expect(await evaluate('p1', 'u1', 'issue:read')).toEqual({ allowed: false, reason: 'denied' });
});

test('an anonymous caller is denied without touching the database', async () => {
  wire([grant(ROLE_ADMIN)]);

  expect(await evaluate('p1', undefined, 'issue:read')).toEqual({ allowed: false, reason: 'denied' });
  expect(fetchAll).not.toHaveBeenCalled();
});

test('the memo collapses repeated checks in one request into a single read', async () => {
  wire([grant(ROLE_EDITOR)]);
  const memo = createMemo();

  await evaluate('p1', 'u1', 'issue:read', memo);
  await evaluate('p1', 'u1', 'issue:write', memo);
  await evaluate('p1', 'u1', 'comment:write', memo);

  expect(teamIds).toHaveBeenCalledTimes(1);
  const grantReads = fetchAll.mock.calls.filter((c) => c[0] === 'project_access');
  expect(grantReads).toHaveLength(1);
});

test('a different project is not served from another project memo entry', async () => {
  fetchAll.mockImplementation(async (collectionId: string, queries?: string[]) => {
    if (collectionId !== 'project_access') return page(policyDocs);
    return page(JSON.stringify(queries).includes('p1') ? [grant(ROLE_ADMIN)] : []);
  });
  const memo = createMemo();

  expect((await evaluate('p1', 'u1', 'issue:delete', memo)).allowed).toBe(true);
  expect((await evaluate('p2', 'u1', 'issue:delete', memo)).reason).toBe('not_found');
});

test('a failed policy read is not cached, so the next request retries', async () => {
  let policyCalls = 0;
  fetchAll.mockImplementation(async (collectionId: string) => {
    if (collectionId === 'project_access') return page([grant(ROLE_ADMIN)]);
    policyCalls += 1;
    if (policyCalls === 1) throw new Error('policy read failed');
    return page(policyDocs);
  });

  expect((await evaluate('p1', 'u1', 'issue:read')).reason).toBe('unavailable');
  // Caching the rejection would deny every user until the process restarted.
  expect((await evaluate('p1', 'u1', 'issue:read')).allowed).toBe(true);
});
