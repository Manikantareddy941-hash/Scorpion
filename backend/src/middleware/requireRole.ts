import { Request, Response, NextFunction } from 'express';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { logger } from '../services/logger';

/**
 * Role-verification (RBAC) middleware.
 *
 * Must run AFTER an authentication middleware that populates `req.user.$id`
 * (e.g. the `authenticate` gate applied at the route's mount point). It looks
 * up the caller's role in the ROLES collection and allows the request only
 * when that role is one of `allowed`. Callers with no role document default to
 * 'user' and are therefore denied for privileged routes.
 *
 * Fail-closed: any lookup failure rejects the request rather than letting it
 * through unauthorized.
 */
/**
 * Resolves a user's role, defaulting to 'user' when they have no role document.
 *
 * Throws on lookup failure rather than returning the default — a caller that
 * cannot reach the ROLES collection must fail closed, never silently downgrade
 * to 'user' (or, worse, be treated as privileged by a caller that expected a
 * throw). Both `requireRole` below and the terminal command surface depend on
 * that contract.
 */
export const resolveRole = async (userId: string): Promise<string> => {
  const roleRes = await databases.listDocuments(DB_ID, COLLECTIONS.ROLES, [
    Query.equal('userId', userId),
    Query.limit(1),
  ]);
  return (roleRes.documents[0]?.role as string | undefined) ?? 'user';
};

export const requireRole = (...allowed: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as { user?: { $id?: string } }).user?.$id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const role = await resolveRole(userId);

      if (!allowed.includes(role)) {
        logger.warn(
          `[RBAC] Denied ${req.method} ${req.originalUrl} for ${userId} (role '${role}', requires ${allowed.join('/')})`
        );
        return res.status(403).json({ error: 'Forbidden: insufficient role' });
      }

      next();
    } catch (err) {
      logger.error('[RBAC] Role lookup failed:', err);
      return res.status(500).json({ error: 'Role verification failed' });
    }
  };
};
