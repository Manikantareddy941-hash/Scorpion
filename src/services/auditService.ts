import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';

export const auditService = {
  async log(action: string, resource: string, details?: string, resourceId?: string) {
    try {
      // Get current user if possible (simplifying for now, in a real app you'd get this from context or account)
      const actor = 'System Agent'; // Fallback
      const actorEmail = 'system@scorpion.security';

      const payload = {
        action,
        actor,
        actorEmail,
        resource,
        resourceId,
        details: details || `Performed ${action} on ${resource}`,
        timestamp: new Date().toISOString(),
        ipAddress: '127.0.0.1' // Mock
      };

      return await databases.createDocument(DB_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), payload);
    } catch (err) {
      console.error('Audit logging failed:', err);
    }
  }
};
