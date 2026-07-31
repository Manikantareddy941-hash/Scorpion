import { NextFunction, Response } from 'express';
import { logger } from '../services/logger';
import { planRepository } from '../repositories/planRepository';
import { assertLegacyProjectAccess } from '../services/planService';
import { AuthenticatedRequest } from '../types/plan.types';
import { AuthzMemo, AuthzResult, createMemo, evaluate } from './authorizationService';
import { PlanPermission } from './roles';

/**
 * Presentation-layer permission gate.
 *
 * The permission a request needs depends on the route — `issue:write` versus
 * `issue:delete` cannot be answered below the transport layer, because that is
 * where the HTTP verb lives. So the route declares what it needs and this
 * middleware asks the authorization service, which stays HTTP-agnostic.
 */

/**
 * Which route param carries the project, and how to get from it to one.
 *
 * Nine endpoints are keyed by a child id and never see a projectId. Resolving
 * that hop is security-critical, so it fails closed: an unresolvable id is a
 * 404 and a failed lookup is a 503, never a pass-through.
 */
export type ProjectSource = 'projectId' | 'issueId' | 'sprintId';

/**
 * Shadow mode (ADR-001 D6).
 *
 * Off by default. While off, the verdict is computed and any disagreement with
 * the legacy union check is logged, but the legacy check is what actually
 * decides. That is what lets the grant table be validated against real traffic
 * before it can lock anyone out. Flip only after verify_rbac_backfill passes.
 */
export const isEnforcing = (): boolean => process.env.RBAC_ENFORCE === 'true';

/** Memo lives on the request object without widening its public type. */
const memos = new WeakMap<object, AuthzMemo>();
const memoFor = (req: object): AuthzMemo => {
  let memo = memos.get(req);
  if (!memo) { memo = createMemo(); memos.set(req, memo); }
  return memo;
};

type Resolution = { projectId: string } | { status: 404 | 503 };

async function resolveProjectId(req: AuthenticatedRequest, from: ProjectSource): Promise<Resolution> {
  if (from === 'projectId') {
    const projectId = req.params.projectId;
    return projectId ? { projectId } : { status: 404 };
  }

  const childId = req.params[from];
  if (!childId) return { status: 404 };

  try {
    const projectId = from === 'issueId'
      ? await planRepository.getIssueProjectId(childId)
      : await planRepository.getSprintProjectId(childId);
    return projectId ? { projectId } : { status: 404 };
  } catch (err) {
    // Cannot tell whether the child exists, so cannot authorize it.
    logger.error('[authz] could not resolve the owning project', {
      event: 'authz_unavailable', stage: 'resolve', from, childId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 503 };
  }
}

function deny(res: Response, result: AuthzResult): Response {
  if (result.reason === 'unavailable') {
    return res.status(503).json({ error: 'Access could not be verified, please retry' });
  }
  if (result.reason === 'not_found') {
    // Never confirm that a project exists to someone holding no grant on it.
    return res.status(404).json({ error: 'Not found' });
  }
  return res.status(403).json({ error: 'You do not have permission to perform this action' });
}

export function requirePermission(permission: PlanPermission, from: ProjectSource = 'projectId') {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const resolution = await resolveProjectId(req, from);
    if ('status' in resolution) {
      if (resolution.status === 404) res.status(404).json({ error: 'Not found' });
      else res.status(503).json({ error: 'Access could not be verified, please retry' });
      return;
    }

    const { projectId } = resolution;
    const userId = req.user?.$id;
    const result = await evaluate(projectId, userId, permission, memoFor(req));

    if (isEnforcing()) {
      if (result.allowed) return next();
      deny(res, result);
      return;
    }

    // Shadow mode: compare, log, then defer to the legacy verdict.
    const legacyAllowed = await assertLegacyProjectAccess(projectId, userId);
    if (legacyAllowed !== result.allowed) {
      logger.warn('[authz] RBAC verdict disagrees with the legacy check', {
        event: 'rbac_divergence', projectId, userId, permission,
        rbac: result.reason, legacyAllowed,
      });
    }
    if (legacyAllowed) return next();
    res.status(403).json({ error: 'You do not have access to this project' });
  };
}
