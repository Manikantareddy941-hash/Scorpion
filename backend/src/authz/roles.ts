/**
 * Permission vocabulary and built-in roles for the Plan workspace.
 *
 * Single source of truth on purpose: the migration seeds `project_policies`
 * from BUILTIN_ROLES and the authorization layer resolves against the same
 * constants. A seed that drifts from the resolver is an access-control bug that
 * only shows up in production, where the database says one thing and the code
 * expects another.
 *
 * v1 ships built-in roles ONLY. There is no write path to `project_policies`,
 * which is what makes them immutable — a stronger guarantee than a boolean
 * flag, because there is no code that could ignore it. Project-scoped custom
 * roles are v2 and will need the `projectId` scope to be honoured on every
 * policy read; a globally shared, mutable policy table would let an admin of
 * one project escalate inside another.
 */

/** Every permission a route may require. Adding a route means adding one here. */
export const PLAN_PERMISSIONS = [
  'project:read', 'project:write', 'project:delete',
  'epic:read', 'epic:write', 'epic:delete',
  'sprint:read', 'sprint:write', 'sprint:delete',
  'issue:read', 'issue:write', 'issue:delete',
  'comment:read', 'comment:write', 'comment:delete',
  'worklog:read', 'worklog:write',
  'automation:read', 'automation:write', 'automation:delete',
  'threat:read', 'threat:write', 'threat:delete',
  // Grant management. Admin-only in every built-in role: whoever holds
  // access:write can promote themselves, so it is the escalation surface.
  'access:read', 'access:write',
] as const;

export type PlanPermission = (typeof PLAN_PERMISSIONS)[number];

/** Held only by project_admin. Matches every permission, present and future. */
export const WILDCARD = '*';

export const ROLE_ADMIN = 'project_admin';
export const ROLE_EDITOR = 'project_editor';
export const ROLE_VIEWER = 'project_viewer';

export interface BuiltinRole {
  roleKey: string;
  name: string;
  permissions: string[];
}

const READ_ONLY: PlanPermission[] = PLAN_PERMISSIONS.filter(
  (p): p is PlanPermission => p.endsWith(':read') && !p.startsWith('access:'),
);

/**
 * Editor covers day-to-day delivery: create and edit the work, close an issue
 * filed by mistake, log time, record a threat.
 *
 * Deliberately withheld — these are the segregation of duties the whole feature
 * exists to create, so they stay with admin:
 *   epic:delete / sprint:delete  destroy a container of other people's work
 *   automation:*                 project configuration, fires on everyone's issues
 *   threat:delete                erases a security record
 *   comment:delete               moderation
 *   project:write / project:delete
 *   access:*                     grant management
 */
const EDITOR_WRITES: PlanPermission[] = [
  'epic:write', 'sprint:write', 'issue:write', 'issue:delete',
  'comment:write', 'worklog:write', 'threat:write',
];

export const BUILTIN_ROLES: BuiltinRole[] = [
  {
    roleKey: ROLE_ADMIN,
    name: 'Project Admin',
    // Wildcard rather than an enumerated list: a new permission added in a
    // later release must not silently leave existing admins unable to use it.
    permissions: [WILDCARD],
  },
  { roleKey: ROLE_EDITOR, name: 'Project Editor', permissions: [...READ_ONLY, ...EDITOR_WRITES] },
  { roleKey: ROLE_VIEWER, name: 'Project Viewer', permissions: [...READ_ONLY] },
];

/**
 * True if `granted` satisfies `required`.
 *
 * `granted` is the UNION of every permission from every matching grant —
 * highest-permission-wins (ADR-001 D2). There are no deny entries in v1, so
 * membership is the whole decision.
 */
export function hasPermission(granted: readonly string[], required: PlanPermission): boolean {
  return granted.includes(WILDCARD) || granted.includes(required);
}
