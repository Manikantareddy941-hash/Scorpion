import { apiFetch } from './apiClient';

export interface AuditLogEntry {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details: string;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failure';
  timestamp?: string;
}

export const auditLogger = {
  async log(entry: Omit<AuditLogEntry, 'timestamp' | 'ipAddress' | 'userAgent'>) {
    try {
      await apiFetch('/api/audit', {
        method: 'POST',
        body: JSON.stringify(entry)
      });
    } catch (err) {
      console.error('[AuditLogger] Failed to save log server-side:', err);
    }
  }
};
