import { Request, Response, NextFunction } from 'express';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { Query } from 'node-appwrite';

export type Role = 'admin' | 'analyst' | 'viewer';

const PERMISSIONS: Record<Role, string[]> = {
  admin:   ['*'],
  analyst: ['scan.read', 'scan.create', 'incident.read', 'incident.update', 'compliance.read'],
  viewer:  ['scan.read', 'incident.read', 'compliance.read', 'audit.read']
};

export function requireRole(...roles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.headers['x-user-id'] as string;
    const tenantId = req.headers['x-tenant-id'] as string;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const result = await databases.listDocuments(DB_ID, COLLECTIONS.ROLES, [
        Query.equal('userId', userId),
        Query.equal('tenantId', tenantId ?? 'default')
      ]);

      if (result.documents.length === 0) {
        return res.status(403).json({ error: 'No role assigned' });
      }

      const userRole = result.documents[0].role as Role;

      const isAdmin = userRole === 'admin';
      const hasRole = roles.includes(userRole);

      if (!isAdmin && !hasRole) {
        return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
      }

      (req as any).userRole = userRole;
      (req as any).userId = userId;
      (req as any).tenantId = tenantId ?? 'default';
      next();

    } catch (err) {
      res.status(500).json({ error: 'Role check failed' });
    }
  };
}
