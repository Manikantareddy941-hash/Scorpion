import { Query } from '../lib/appwrite';
import { fetchAllDocuments } from '../lib/paginate';
import { logger } from '../services/logger';
import { listTeamIdsForUser } from '../services/tenancyService';
import { ACCESS_COLLECTION } from './backfill';
import { PlanPermission, WILDCARD, hasPermission } from './roles';

/**
 * Fine-grained authorization for the Plan workspace.
 *
 * Application layer: it knows nothing about HTTP. The middleware maps a verdict
 * onto a status code; this file only decides.
 */

const POLICIES_COLLECTION = 'project_policies';

/**
 * Four outcomes, not a boolean.
 *
 * `unavailable` is the one that matters. The check this replaces ended in
 * `catch { return false }`, which reports a database outage as a permission
 * denial — the operator sees mass 403s and goes hunting for a permissions bug.
 * Separating them lets the caller answer 503 for "could not check" and keeps
 * "denied" meaning denied.
 *
 * `not_found` covers both "no such project" and "you hold no grant on it".
 * Collapsing them is deliberate: a 403 on a project you are not a member of
 * confirms that the project exists, which is free enumeration of other tenants.
 */
export type AuthzReason = 'granted' | 'denied' | 'not_found' | 'unavailable';

export interface AuthzResult {
  allowed: boolean;
  reason: AuthzReason;
}

const GRANTED: AuthzResult = { allowed: true, reason: 'granted' };
const DENIED: AuthzResult = { allowed: false, reason: 'denied' };
const NOT_FOUND: AuthzResult = { allowed: false, reason: 'not_found' };
const UNAVAILABLE: AuthzResult = { allowed: false, reason: 'unavailable' };

/** Effective permissions, or why they could not be determined. */
type Resolved = { kind: 'permissions'; permissions: string[] } | { kind: 'no_grants' } | { kind: 'unavailable' };

/**
 * Request-scoped memo. A single request often checks more than one permission
 * (and the service layer re-checks below the route); without this, each check
 * repeats the same two reads.
 *
 * Deliberately per-request and nothing longer. A cross-request TTL cache would
 * be a window in which a revoked grant still works, and prompt revocation is
 * the point of having grants at all.
 */
export type AuthzMemo = Map<string, Promise<Resolved>>;
export const createMemo = (): AuthzMemo => new Map();

/**
 * Built-in roles are immutable and there are three of them, so they are loaded
 * once per process. A seed change needs a restart to take effect — acceptable
 * while `project_policies` has no write path. v2 custom roles must not use this
 * cache: they are per-project and mutable.
 */
let policyCache: Promise<Map<string, string[]>> | null = null;

async function loadPolicies(): Promise<Map<string, string[]>> {
  if (!policyCache) {
    policyCache = (async () => {
      const page = await fetchAllDocuments(POLICIES_COLLECTION);
      const byRole = new Map<string, string[]>();
      for (const doc of page.items) {
        const policy = doc as unknown as { role_key?: string; permissions?: string[] };
        if (policy.role_key) byRole.set(policy.role_key, policy.permissions ?? []);
      }
      return byRole;
    })().catch((err) => {
      // Do not cache a failure — the next request should retry rather than
      // inherit an empty policy table, which would deny everyone until restart.
      policyCache = null;
      throw err;
    });
  }
  return policyCache;
}

/** Test seam; also lets an operator pick up a re-seed without a redeploy. */
export const resetPolicyCache = (): void => { policyCache = null; };

async function resolvePermissions(projectId: string, userId: string): Promise<Resolved> {
  let subjects: string[];
  try {
    subjects = [userId, ...(await listTeamIdsForUser(userId))];
  } catch (err) {
    logger.error('[authz] could not read team memberships', {
      event: 'authz_unavailable', stage: 'memberships', projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'unavailable' };
  }

  let grants;
  try {
    // One query for the direct grant and every team grant: Query.equal with an
    // array is an OR over the subject.
    grants = await fetchAllDocuments(ACCESS_COLLECTION, [
      Query.equal('projectId', projectId),
      Query.equal('subject_id', subjects),
    ]);
    if (grants.truncated) throw new Error(`grant read truncated at ${grants.items.length}/${grants.total}`);
  } catch (err) {
    logger.error('[authz] could not read grants', {
      event: 'authz_unavailable', stage: 'grants', projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'unavailable' };
  }

  if (grants.items.length === 0) return { kind: 'no_grants' };

  let policies: Map<string, string[]>;
  try {
    policies = await loadPolicies();
  } catch (err) {
    logger.error('[authz] could not read policies', {
      event: 'authz_unavailable', stage: 'policies', projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'unavailable' };
  }

  // Highest-permission-wins: the union across every matching grant (ADR-001 D2).
  // No deny entries exist in v1, so membership is the whole decision.
  const permissions = new Set<string>();
  for (const doc of grants.items) {
    const grant = doc as unknown as { role_key?: string };
    const rolePermissions = grant.role_key ? policies.get(grant.role_key) : undefined;
    if (!rolePermissions) {
      // A grant pointing at a role that does not exist contributes nothing,
      // which is a silent partial lockout — say so rather than quietly skipping.
      logger.warn('[authz] grant references an unknown role', {
        event: 'authz_unknown_role', projectId, roleKey: grant.role_key,
      });
      continue;
    }
    for (const p of rolePermissions) permissions.add(p);
    if (permissions.has(WILDCARD)) break;
  }

  return { kind: 'permissions', permissions: [...permissions] };
}

/**
 * Can `userId` perform `permission` on `projectId`?
 *
 * Fails closed at every step: an unreadable membership list, grant table or
 * policy table returns `unavailable`, never a permissive default.
 */
export async function evaluate(
  projectId: string,
  userId: string | undefined,
  permission: PlanPermission,
  memo?: AuthzMemo,
): Promise<AuthzResult> {
  if (!userId) return DENIED;

  const key = `${projectId}:${userId}`;
  let pending = memo?.get(key);
  if (!pending) {
    pending = resolvePermissions(projectId, userId);
    memo?.set(key, pending);
  }
  const resolved = await pending;

  if (resolved.kind === 'unavailable') return UNAVAILABLE;
  if (resolved.kind === 'no_grants') return NOT_FOUND;
  return hasPermission(resolved.permissions, permission) ? GRANTED : DENIED;
}
