import { databases, DB_ID, ID } from '../lib/appwrite';

/**
 * Logs a security event to the audit trail
 * @param action The event type (e.g., SCAN_STARTED, LOGIN)
 * @param details Human readable description
 * @param userId The ID of the actor (user or system)
 * @param resourceId Optional ID of the related resource (e.g., repo ID)
 * @param actorEmail Optional email of the actor
 */
export async function logAuditEvent(
    action: string, 
    details: string, 
    userId: string, 
    resourceId?: string,
    actorEmail?: string
) {
    try {
        await databases.createDocument(
            DB_ID,
            'audit_logs',
            ID.unique(),
            {
                action,
                details,
                actor: userId,
                actorEmail: actorEmail || 'system@scorpion.mesh',
                resource: resourceId ? 'repository' : 'system',
                resourceId: resourceId || 'system',
                ipAddress: '0.0.0.0', // Could be added if req is passed
                timestamp: new Date().toISOString()
            }
        );
    } catch (err: any) {
        console.error('[Audit Log Error]', err.message);
    }
}
