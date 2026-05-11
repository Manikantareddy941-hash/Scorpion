import { apiFetch } from '../lib/apiClient';

export const auditService = {
  async log(action: string, resource: string, details?: string, resourceId?: string) {
    try {
      const payload = {
        action,
        resource,
        resourceId,
        details: details || `Performed ${action} on ${resource}`,
        status: 'success'
      };

      return await apiFetch('/api/audit', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('Audit logging failed:', err);
    }
  }
};
