import { databases, DB_ID, COLLECTIONS, ID } from './appwrite';

export interface AuditLogEntry {
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details: string;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failure';
  timestamp: string;
}

export const auditLogger = {
  async log(entry: Omit<AuditLogEntry, 'timestamp'>) {
    try {
      // Basic IP fetch (client-side only)
      let ip = 'unknown';
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json').catch(() => null);
        const ipData = await ipRes?.json();
        ip = ipData?.ip || 'unknown';
      } catch (e) {
        console.warn('Could not fetch IP for audit log');
      }

      await databases.createDocument(
        DB_ID,
        COLLECTIONS.AUDIT_LOGS,
        ID.unique(),
        {
          ...entry,
          ipAddress: ip,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString()
        }
      );
    } catch (err) {
      console.error('[AuditLogger] Failed to save log:', err);
    }
  }
};
