/**
 * Tenancy coverage ratchet: every route file that talks to the database must
 * visibly scope by tenant (user_id/team_id query, assertRepoAccess,
 * canAccessResource, resolveOwnershipScope, hasRequiredRole, requireRole) or
 * be on the allowlist below with a reason. Adding a new unscoped route fails
 * this test — decide: scope it, or allowlist it with a documented reason.
 */
import fs from 'fs';
import path from 'path';

const ROUTES_DIR = path.join(__dirname, '..', 'routes');

const SCOPING_MARKER =
  /user_id|team_id|assertRepoAccess|canAccessResource|resolveOwnershipScope|hasRequiredRole|requireRole/;

// file -> why it is safe without a tenant-scoping marker
const ALLOWLIST: Record<string, string> = {
  'authRoutes.ts':
    'Pre-auth password-reset flow; PASSWORD_RESETS docs are keyed by email+OTP, no tenant data readable',
  'healthRoutes.ts': 'Liveness probe; reads no tenant collections',
  'userRoutes.ts':
    "Self-scoped: queries ROLES/profile by the caller's own userId only",
  'complianceRoutes.ts':
    "Scoped by scopeId = caller's userId on every COMPLIANCE_CONTROLS query",
  'auditRoutes.ts':
    "Scoped by actor = caller's userId; one tenant cannot read another's audit trail",
  'policyRoutes.ts':
    "Self-scoped: list filters userId, mutations check existing.userId === caller before writing",
  'ideRoutes.ts':
    'Localhost-only IDE integration (req.ip gate); scan runs on a local path, not tenant data'
};

test('every DB-touching route file scopes by tenant or is allowlisted with a reason', () => {
  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  expect(files.length).toBeGreaterThan(30); // sanity: right directory

  const violations: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    if (!src.includes('databases.')) continue; // no direct DB access
    if (SCOPING_MARKER.test(src)) continue;
    if (ALLOWLIST[file]) continue;
    violations.push(file);
  }

  expect(violations).toEqual([]);
});

test('allowlist carries no stale entries', () => {
  for (const file of Object.keys(ALLOWLIST)) {
    expect(fs.existsSync(path.join(ROUTES_DIR, file))).toBe(true);
  }
});
