import { Grant, projectAccessRepository } from '../repositories/projectAccessRepository';
import { BUILTIN_ROLES, ROLE_ADMIN } from '../authz/roles';
import { logger } from './logger';

/**
 * Grant management for the Plan workspace.
 *
 * Every entry point here is reached only through requirePermission('access:*'),
 * which is admin-only in all three built-in roles. This layer adds the rules
 * that authorization alone cannot express: valid roles, and never leaving a
 * project without an administrator.
 */

export type AccessError =
  | 'invalid_role'
  | 'invalid_subject_type'
  | 'already_granted'
  | 'not_found'
  | 'ambiguous_subject'
  | 'last_admin';

const VALID_ROLES = new Set(BUILTIN_ROLES.map((r) => r.roleKey));

const isAccessError = (v: unknown): v is AccessError =>
  typeof v === 'string' && ['invalid_role', 'invalid_subject_type', 'already_granted',
    'not_found', 'ambiguous_subject', 'last_admin'].includes(v);

const conflict = (err: unknown): boolean => {
  const e = err as { code?: number; type?: string };
  return e.code === 409 || Boolean(e.type?.includes('already_exists'));
};

/**
 * Resolves a subject id to its single grant on a project.
 *
 * subject_id is not unique on its own, so an ambiguous match is reported rather
 * than resolved by guessing — picking one would silently modify or revoke the
 * wrong subject.
 */
async function resolveGrant(projectId: string, subjectId: string): Promise<Grant | AccessError> {
  const matches = await projectAccessRepository.findBySubject(projectId, subjectId);
  if (matches.length === 0) return 'not_found';
  if (matches.length > 1) return 'ambiguous_subject';
  return matches[0];
}

/**
 * True when this grant is the only thing keeping the project administrable.
 *
 * Without it an admin can demote or revoke themselves and leave a project that
 * nobody can ever grant access to again — recoverable only by an operator with
 * database credentials.
 */
async function isLastAdmin(projectId: string, grant: Grant): Promise<boolean> {
  if (grant.role_key !== ROLE_ADMIN) return false;
  const all = await projectAccessRepository.listForProject(projectId);
  return all.filter((g) => g.role_key === ROLE_ADMIN).length <= 1;
}

export const projectAccessService = {
  async list(projectId: string): Promise<Grant[]> {
    return projectAccessRepository.listForProject(projectId);
  },

  /**
   * `projectId` comes from the authorized route path, never from the body — a
   * body-supplied project would let an admin of one project write a grant into
   * another.
   */
  async grant(
    projectId: string,
    input: { subjectType: string; subjectId: string; roleKey: string },
    grantedBy: string,
  ): Promise<Grant | AccessError> {
    if (input.subjectType !== 'user' && input.subjectType !== 'team') return 'invalid_subject_type';
    if (!VALID_ROLES.has(input.roleKey)) return 'invalid_role';
    if (!input.subjectId) return 'not_found';

    try {
      const created = await projectAccessRepository.create({
        projectId,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        role_key: input.roleKey,
        granted_by: grantedBy,
        granted_at: new Date().toISOString(),
      });
      logger.info('[access] granted', {
        event: 'access_granted', projectId, subjectId: input.subjectId,
        subjectType: input.subjectType, roleKey: input.roleKey, grantedBy,
      });
      return created;
    } catch (err) {
      // The unique index. The subject already has a role here; changing it is
      // PATCH, so that a re-POST cannot quietly overwrite an existing decision.
      if (conflict(err)) return 'already_granted';
      throw err;
    }
  },

  async changeRole(
    projectId: string, subjectId: string, roleKey: string, grantedBy: string,
  ): Promise<Grant | AccessError> {
    if (!VALID_ROLES.has(roleKey)) return 'invalid_role';

    const grant = await resolveGrant(projectId, subjectId);
    if (isAccessError(grant)) return grant;
    if (grant.role_key === roleKey) return grant; // no-op, so retries are safe

    if (await isLastAdmin(projectId, grant)) return 'last_admin';

    const updated = await projectAccessRepository.updateRole(grant.$id, roleKey, grantedBy);
    logger.info('[access] role changed', {
      event: 'access_role_changed', projectId, subjectId,
      from: grant.role_key, to: roleKey, grantedBy,
    });
    return updated;
  },

  async revoke(projectId: string, subjectId: string, revokedBy: string): Promise<'ok' | AccessError> {
    const grant = await resolveGrant(projectId, subjectId);
    if (isAccessError(grant)) return grant;

    if (await isLastAdmin(projectId, grant)) return 'last_admin';

    await projectAccessRepository.remove(grant.$id);
    logger.info('[access] revoked', {
      event: 'access_revoked', projectId, subjectId,
      roleKey: grant.role_key, revokedBy,
    });
    return 'ok';
  },
};
