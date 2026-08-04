import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import crypto from 'crypto';
import { logger } from '../services/logger';

// Helper to ensure the secure audit log collection exists
export async function ensureAuditLogsV2Collection() {
  try {
    await databases.getCollection(DB_ID, 'audit_logs_v2');
  } catch (err: any) {
    if (err.code === 404 || err.type === 'collection_not_found') {
      logger.info('[Audit Logs Setup] audit_logs_v2 collection not found. Creating it...');
      try {
        await databases.createCollection(DB_ID, 'audit_logs_v2', 'AUDIT_LOGS');
        
        // Create attributes
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'actor', 255, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'action', 100, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'repo_id', 255, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'timestamp', 100, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'details', 5000, true);
        await databases.createStringAttribute(DB_ID, 'audit_logs_v2', 'tamper_hash', 255, true);
        
        logger.info('[Audit Logs Setup] audit_logs_v2 collection and attributes created.');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (createErr) {
        logger.error('[Audit Logs Setup] Error creating collection or attributes:', createErr);
      }
    }
  }
}

// Automatically check collection on start
ensureAuditLogsV2Collection();

/**
 * Raised only when a caller passed `{ required: true }` and the ledger write could
 * not be completed. Callers that omit the flag never see this.
 */
export class AuditWriteFailedError extends Error {
  constructor(readonly action: string, readonly cause: string) {
    super(`Audit ledger write for '${action}' failed and this event is required: ${cause}`);
    this.name = 'AuditWriteFailedError';
  }
}

export interface AuditOptions {
  /**
   * Set on events that record a SECURITY DECISION — something granted, denied,
   * blocked or overridden. A required write that fails throws, and the caller is
   * expected to refuse the operation rather than perform an unlogged privileged
   * action.
   *
   * Omit it for observability events (scan progress, alarm clears). Those stay
   * best-effort: an unreachable ledger should not halt a DAST run, and it must
   * never halt break-glass, which is the thing you need working during an outage.
   */
  required?: boolean;
}

/**
 * Logs a high-risk security action to the tamper-proof cryptographic audit ledger.
 *
 * FAILURE SEMANTICS — read before adding a call site.
 *
 * This function used to swallow every error and return undefined, with no `throw`
 * anywhere in the file. That made it impossible for any caller to fail closed on a
 * missing audit entry: `deployService`'s `.catch()` and the terminal's `try/catch`
 * were both unreachable code guarding a promise that never rejected. The terminal's
 * instruction to "make this fail-closed the moment a mutating verb is registered"
 * could not have been carried out by editing the caller — the capability did not
 * exist here.
 *
 * It does now, and only when asked for. Default behaviour is unchanged, so the
 * existing best-effort call sites keep their semantics without being touched.
 */
export async function logSecureAuditEvent(
  actor: string,
  action: 'BREAK_GLASS_BYPASS' | 'ALARM_CLEAR' | string,
  repoId: string,
  details: string,
  options: AuditOptions = {}
) {
  const required = options.required === true;
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
      // Falling through to GENESIS_HASH writes a block chained to nothing — a
      // fork in the ledger that is indistinguishable from tampering to anyone
      // verifying it later. Tolerable for a best-effort event; not for one whose
      // whole purpose is to be evidence. A required event that cannot be chained
      // has not been recorded, whatever ends up in the collection.
      if (required) {
        throw new AuditWriteFailedError(
          action,
          `could not read the previous ledger block to chain to (${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)})`,
        );
      }
      logger.error('[Secure Audit Log] Failed to fetch last audit log to chain hash:', fetchErr);
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

    logger.info(`[Secure Audit Log] Ledger block successfully chained & persisted: ${doc.$id} (Hash: ${tamper_hash.substring(0, 10)}...)`);
    return doc;
  } catch (err: any) {
    // Already the right shape (thrown by the chaining branch above) — do not
    // re-wrap it and lose the specific cause.
    if (err instanceof AuditWriteFailedError) throw err;

    logger.error('[Secure Audit Log Error]', err.message);
    if (required) {
      throw new AuditWriteFailedError(action, err instanceof Error ? err.message : String(err));
    }
  }
}
