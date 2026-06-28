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
export const requireRole = (...allowed: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as { user?: { $id?: string } }).user?.$id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const roleRes = await databases.listDocuments(DB_ID, COLLECTIONS.ROLES, [
        Query.equal('userId', userId),
        Query.limit(1),
      ]);

      const role = (roleRes.documents[0]?.role as string | undefined) ?? 'user';

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
