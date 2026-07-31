import {
  BUILTIN_ROLES, PLAN_PERMISSIONS, ROLE_ADMIN, ROLE_EDITOR, ROLE_VIEWER,
  WILDCARD, hasPermission, PlanPermission,
} from './roles';

const roleFor = (key: string): string[] =>
  BUILTIN_ROLES.find((r) => r.roleKey === key)?.permissions ?? [];

const vocabulary = new Set<string>(PLAN_PERMISSIONS);

test('every seeded permission exists in the vocabulary', () => {
  // A typo here is not a test failure in production — it is a route that
  // returns 403 forever, because the grant never matches what the route asks for.
  for (const role of BUILTIN_ROLES) {
    for (const p of role.permissions) {
      if (p === WILDCARD) continue;
      expect(vocabulary.has(p)).toBe(true);
    }
  }
});

test('admin satisfies every permission, including ones added later', () => {
  const admin = roleFor(ROLE_ADMIN);
  for (const p of PLAN_PERMISSIONS) expect(hasPermission(admin, p)).toBe(true);
  expect(hasPermission(admin, 'a:permission:invented:later' as PlanPermission)).toBe(true);
});

test('viewer is read-only and cannot see the grant table', () => {
  const viewer = roleFor(ROLE_VIEWER);
  expect(viewer.every((p) => p.endsWith(':read'))).toBe(true);
  expect(hasPermission(viewer, 'issue:write')).toBe(false);
  // Membership of a project is tenant information; v1 keeps it with admin.
  expect(hasPermission(viewer, 'access:read')).toBe(false);
});

test('editor is a strict superset of viewer', () => {
  const editor = roleFor(ROLE_EDITOR);
  for (const p of roleFor(ROLE_VIEWER)) expect(editor).toContain(p);
});

test('editor is held back from exactly the segregation-of-duties permissions', () => {
  // The point of the feature: an editor delivers work but cannot destroy a
  // container of someone else's, reconfigure automation, or grant themselves more.
  const editor = roleFor(ROLE_EDITOR);
  const withheld: PlanPermission[] = [
    'epic:delete', 'sprint:delete', 'comment:delete', 'threat:delete',
    'automation:write', 'automation:delete',
    'project:write', 'project:delete', 'access:read', 'access:write',
  ];
  for (const p of withheld) expect(hasPermission(editor, p)).toBe(false);
  // ...while still able to run a sprint.
  for (const p of ['issue:write', 'issue:delete', 'epic:write', 'worklog:write'] as PlanPermission[]) {
    expect(hasPermission(editor, p)).toBe(true);
  }
});

test('no role key is defined twice', () => {
  const keys = BUILTIN_ROLES.map((r) => r.roleKey);
  expect(new Set(keys).size).toBe(keys.length);
});

test('only admin holds the wildcard', () => {
  for (const role of BUILTIN_ROLES) {
    expect(role.permissions.includes(WILDCARD)).toBe(role.roleKey === ROLE_ADMIN);
  }
});
