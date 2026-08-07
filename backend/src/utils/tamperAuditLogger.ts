import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import crypto from 'crypto';
import { logger, errorContext, errorMessage } from '../services/logger';
import { anchorLedgerTip } from './auditAnchor';
import { classifyAttributeFailure } from '../scripts/lib/migrationErrors';

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

/**
 * `sequence` was added after audit_logs_v2 already existed in deployed
 * environments, so it cannot live only in the collection-creation path above —
 * that branch never runs again once the collection exists. Appwrite rejects a
 * createDocument carrying an attribute the collection does not declare, and with
 * `{ required: true }` that rejection becomes a REFUSED break-glass. So the
 * attribute is ensured separately, idempotently, and before the first write.
 *
 * Memoised per process rather than per call: ensureAuditLogsV2Collection already
 * costs one API round trip on every audit write, and this would double it.
 * The flag is only set on success, so a transient failure is retried on the next
 * write instead of being latched for the process lifetime — the same reasoning
 * that removed the negative caching from toolCheck.resolveToolCommand.
 */
let sequenceAttributeEnsured = false;

export async function ensureSequenceAttribute(): Promise<void> {
  if (sequenceAttributeEnsured) return;
  try {
    // Optional (required=false): rows written before this migration have no
    // sequence, and back-filling them would rewrite history in an append-only
    // ledger — which is precisely the thing the ledger exists to make visible.
    await databases.createIntegerAttribute(DB_ID, 'audit_logs_v2', 'sequence', false);
    logger.info('[Audit Logs Setup] added `sequence` attribute to audit_logs_v2 — waiting for it to become available.');
    await new Promise(resolve => setTimeout(resolve, 3000));
  } catch (err) {
    // Do NOT pattern-match the error text. scripts/lib/migrationErrors documents
    // why, from having hit it: Appwrite validates the collection's row-size budget
    // BEFORE checking whether the attribute already exists, so a re-create can
    // report "maximum number or size of attributes has been reached" instead of a
    // conflict. A message/code check treats that as a real failure, never memoises,
    // and re-issues createIntegerAttribute on EVERY audit write thereafter.
    //
    // classifyAttributeFailure resolves the question against reality instead: if
    // the attribute is present afterwards, the create was redundant. That is the
    // only form of this check that cannot be defeated by an error message we did
    // not anticipate.
    //
    // classifyAttributeFailure THROWS when it cannot tell — Appwrite unreachable,
    // or a collection too wide to read in one page. That must not escape into the
    // audit write path: this runs on the way to logSecureAuditEvent, and with
    // `{ required: true }` a throw here would refuse the caller's command. A
    // verification we could not perform is a reason to retry, not to refuse.
    let verdict: 'skip' | 'error';
    try {
      verdict = await classifyAttributeFailure(databases, DB_ID, 'audit_logs_v2', 'sequence', err);
    } catch (probeErr) {
      logger.error(
        '[Audit Logs Setup] could not verify whether `sequence` exists after a failed create',
        errorContext(probeErr),
      );
      return; // unmemoised — retried on the next write, once Appwrite answers again
    }

    if (verdict === 'error') {
      logger.error('[Audit Logs Setup] could not ensure `sequence` attribute on audit_logs_v2', {
        event: 'AUDIT_SEQUENCE_ATTRIBUTE_UNAVAILABLE',
        ...errorContext(err),
      });
      return; // leave unmemoised so the next write retries
    }
  }
  sequenceAttributeEnsured = true;
}

/** Test seam — the memo is process-global and would leak between suites. */
export function __resetSequenceAttributeMemo(): void {
  sequenceAttributeEnsured = false;
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
    await ensureSequenceAttribute();

    const timestamp = new Date().toISOString();
    const repo_id = repoId || 'system';

    // 1. Fetch the last log to chain the SHA-256 hash and continue the sequence.
    //
    // NO LOCK, DELIBERATELY. Two concurrent writes can both read tip N and both
    // write N+1. That fork is not prevented — it is made DETECTABLE: the verifier
    // sees two rows claiming the same position and flags it. Prevention would mean
    // serialising every append behind Redis, which puts break-glass — the thing
    // you reach for during an outage — behind a service that may be part of the
    // outage. Detectability is the actual requirement of an audit log; exclusivity
    // is not.
    let previousHash = 'GENESIS_HASH';
    let previousSequence: number | undefined;
    try {
      const lastLogs = await databases.listDocuments(DB_ID, 'audit_logs_v2', [
        Query.orderDesc('$createdAt'),
        Query.limit(1)
      ]);
      if (lastLogs.total > 0) {
        previousHash = lastLogs.documents[0].tamper_hash || 'GENESIS_HASH';
        const raw = lastLogs.documents[0].sequence;
        previousSequence = typeof raw === 'number' ? raw : undefined;
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

    // 2. Position in the chain. A legacy row (written before this attribute
    //    existed) yields undefined, so the first sequenced entry after the
    //    migration boundary starts at 0. The verifier sees position 0 appearing
    //    mid-chain and reads it as exactly that boundary — not as a gap.
    const sequence = (previousSequence ?? -1) + 1;

    // 3. Build current payload block.
    //
    //    `sequence` is INSIDE the hash. Outside it, an attacker holding
    //    APPWRITE_API_KEY could renumber rows at will and every hash would still
    //    verify, which would make the fork and gap detection this change exists
    //    for purely decorative. Being inside the hash also means the payload
    //    format differs across the migration boundary — the verifier selects the
    //    format by whether the row carries a sequence, and rows on either side
    //    still chain to each other correctly because previousHash is unaffected.
    const payloadBlock = `${sequence}|${actor}|${action}|${repo_id}|${timestamp}|${details}`;

    // 4. Compute chained SHA-256 hash
    const hashInput = `${previousHash}|${payloadBlock}`;
    const tamper_hash = crypto.createHash('sha256').update(hashInput).digest('hex');

    // 5. Ingest secure log document
    const doc = await databases.createDocument(DB_ID, 'audit_logs_v2', ID.unique(), {
      actor,
      action,
      repo_id,
      timestamp,
      details,
      tamper_hash,
      sequence
    });

    logger.info(`[Secure Audit Log] Ledger block successfully chained & persisted: ${doc.$id} (Hash: ${tamper_hash.substring(0, 10)}...)`);

    // Ship the tip off-box, AFTER the row is durable. Without this the chain is
    // self-referential: anyone holding APPWRITE_API_KEY can delete a row and
    // recompute every hash after it, and the result verifies cleanly. See
    // utils/auditAnchor for why Loki specifically, and for what this still does
    // not give you until the verifier exists.
    anchorLedgerTip({ recordId: doc.$id, tamperHash: tamper_hash, action, timestamp, sequence });

    return doc;
  } catch (err) {
    // Already the right shape (thrown by the chaining branch above) — do not
    // re-wrap it and lose the specific cause.
    if (err instanceof AuditWriteFailedError) throw err;

    logger.error('[Secure Audit Log] write failed', {
        event: 'SECURE_AUDIT_LOG_WRITE_FAILED',
        ...errorContext(err),
    });
    if (required) {
      throw new AuditWriteFailedError(action, errorMessage(err));
    }
  }
}
