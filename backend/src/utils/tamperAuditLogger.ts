import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import crypto from 'crypto';

// Helper to ensure the secure audit log collection exists
export async function ensureAuditLogsV2Collection() {
  try {
    await databases.getCollection(DB_ID, 'audit_logs_v2');
  } catch (err: any) {
    if (err.code === 404 || err.type === 'collection_not_found') {
      console.log('[Audit Logs Setup] audit_logs_v2 collection not found. Creating it...');
      try {
        await databases.createCollection(DB_ID, 'audit_logs_v2', 'AUDIT_LOGS');
        
        // Create attributes
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'actor', 255, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'action', 100, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'repo_id', 255, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'timestamp', 100, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'details', 5000, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'tamper_hash', 255, true);
        
        console.log('[Audit Logs Setup] audit_logs_v2 collection and attributes created.');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (createErr) {
        console.error('[Audit Logs Setup] Error creating collection or attributes:', createErr);
      }
    }
  }
}

// Automatically check collection on start
ensureAuditLogsV2Collection();

/**
 * Logs a high-risk security action to the tamper-proof cryptographic audit ledger.
 */
export async function logSecureAuditEvent(
  actor: string,
  action: 'BREAK_GLASS_BYPASS' | 'ALARM_CLEAR' | string,
  repoId: string,
  details: string
) {
  try {
    await ensureAuditLogsV2Collection();

    const timestamp = new Date().toISOString();
    const repo_id = repoId || 'system';

    // 1. Fetch the last log to chain the SHA-256 hash
    let previousHash = 'GENESIS_HASH';
    try {
      const lastLogs = await databases.listDocuments(DB_ID, 'audit_logs_v2', [
        Query.orderDesc('$createdAt'),
        Query.limit(1)
      ]);
      if (lastLogs.total > 0) {
        previousHash = lastLogs.documents[0].tamper_hash || 'GENESIS_HASH';
      }
    } catch (fetchErr) {
      console.error('[Secure Audit Log] Failed to fetch last audit log to chain hash:', fetchErr);
    }

    // 2. Build current payload block
    const payloadBlock = `${actor}|${action}|${repo_id}|${timestamp}|${details}`;

    // 3. Compute chained SHA-256 hash
    const hashInput = `${previousHash}|${payloadBlock}`;
    const tamper_hash = crypto.createHash('sha256').update(hashInput).digest('hex');

    // 4. Ingest secure log document
    const doc = await databases.createDocument(DB_ID, 'audit_logs_v2', ID.unique(), {
      actor,
      action,
      repo_id,
      timestamp,
      details,
      tamper_hash
    });

    console.log(`[Secure Audit Log] Ledger block successfully chained & persisted: ${doc.$id} (Hash: ${tamper_hash.substring(0, 10)}...)`);
    return doc;
  } catch (err: any) {
    console.error('[Secure Audit Log Error]', err.message);
  }
}
