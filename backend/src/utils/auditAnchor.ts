import { logger } from '../services/logger';

/**
 * Off-box anchor for the tamper-evident audit ledger.
 *
 * WHY THIS EXISTS — the chain does not detect tampering without it.
 *
 * audit_logs_v2 is written with APPWRITE_API_KEY, the same credential the rest of
 * the application holds. Anyone with that key can delete a ledger row and then
 * recompute every subsequent tamper_hash, and the chain re-verifies perfectly.
 * Hash chaining only detects mutation when a verifier holds a copy of some earlier
 * hash that the attacker could not reach. Until this module existed, nothing ever
 * left the database, so the ledger's actual guarantee was "an attacker who cannot
 * write the database cannot forge the log" — which is equally true of an unhashed
 * table.
 *
 * The anchor goes to Loki: a different system, reached over a different protocol,
 * with a different credential (LOKI_URL). Compromising Appwrite no longer lets you
 * rewrite history silently, because the rewritten hashes will not match what was
 * already shipped off-box.
 *
 * WHAT THIS DOES NOT DO
 *
 * Anchoring is a detection aid, not a gate. It cannot stop a rewrite; it makes one
 * discoverable. And it is only worth anything once something COMPARES the two —
 * that is the verifier, and until it lands this module is itself a write-only path,
 * the exact anti-pattern it was written to fix. Step 1 of three; not a deliverable
 * on its own.
 *
 * Loki is production-only (see services/logger: LOKI_URL && NODE_ENV=production),
 * so in dev this emits to console and anchors nothing. That is fine — dev ledgers
 * are not evidence.
 */

/** Stable marker so the anchor stream is queryable regardless of label support. */
export const AUDIT_ANCHOR_EVENT = 'audit_ledger_anchor';

export interface LedgerAnchor {
    /** Appwrite document id of the ledger row this hash belongs to. */
    recordId: string;
    /** The chained SHA-256 written to that row. */
    tamperHash: string;
    /** Action name, so an anchor is legible without joining back to the ledger. */
    action: string;
    /** ISO timestamp recorded IN the ledger row, not the time we logged it. */
    timestamp: string;
    /**
     * Monotonic position in the chain. Optional because sequence numbers land in a
     * later change; anchors written before then simply carry no position, and the
     * verifier treats that as "cannot check for gaps here" rather than "no gap".
     */
    sequence?: number;
}

/**
 * Ships one ledger tip off-box. Never throws.
 *
 * Deliberately called AFTER the ledger write succeeds: this anchors a hash that
 * exists. An anchor for a row that was never persisted would create a phantom
 * entry the verifier could not reconcile, which is a false tamper signal — and a
 * verifier that cries wolf gets muted, taking the real signal with it.
 *
 * Failure here does not fail the audit write. The write already landed; refusing
 * it afterwards is not possible and pretending otherwise would be dishonest about
 * what happened. A missing anchor is itself detectable: the verifier sees a ledger
 * row with no counterpart in Loki, and a run of them means either Loki was down or
 * someone wanted it to be.
 */
export function anchorLedgerTip(anchor: LedgerAnchor): void {
    try {
        logger.info('[Audit Anchor] ledger tip', {
            event: AUDIT_ANCHOR_EVENT,
            recordId: anchor.recordId,
            tamperHash: anchor.tamperHash,
            action: anchor.action,
            timestamp: anchor.timestamp,
            ...(anchor.sequence !== undefined ? { sequence: anchor.sequence } : {}),
            // Per-message label so the anchors form their own Loki stream and can be
            // queried without scanning every application log line.
            labels: { stream: 'audit_anchor' },
        });
    } catch (err) {
        // Swallowing is correct here and nowhere else in this subsystem: the ledger
        // row is already durable, and an anchor is a copy. Losing the copy degrades
        // detection; throwing would corrupt the caller's control flow over a
        // best-effort side channel.
        try {
            logger.error('[Audit Anchor] failed to emit ledger anchor — tamper detection degraded for this entry', {
                recordId: anchor.recordId,
                error: err instanceof Error ? err.message : String(err),
            });
        } catch {
            // Logging the logging failure failed. Nothing further is available.
        }
    }
}
