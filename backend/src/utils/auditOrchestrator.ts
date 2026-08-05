import { verifyAuditChain, type VerificationReport } from './auditVerifier';
import { verifyAnchorIntegrity, type AnchorVerificationReport } from './auditAnchorVerifier';

/**
 * Runs both halves of the ledger check and returns them together.
 *
 * They are deliberately not merged into one verdict. The internal chain check and
 * the off-box anchor check answer different questions, and collapsing them would
 * lose the distinction that matters most:
 *
 *   db.isValid = true, anchor = MATCH              → the ledger is intact
 *   db.isValid = true, anchor = ANCHOR_MISMATCH    → the chain was REWRITTEN by
 *                                                    someone with database write
 *                                                    access. Internal validity is
 *                                                    a property the attacker
 *                                                    controls; the anchor is not.
 *   db.isValid = false, anchor = MATCH             → corruption or a benign fork,
 *                                                    not a rewrite
 *   anchor = ANCHOR_UNAVAILABLE                    → nothing was cross-checked.
 *                                                    NOT a pass.
 *
 * A single boolean cannot express the second row, which is the only one that
 * describes an attack.
 */
export interface FullAuditReport {
    db: VerificationReport;
    anchor: AnchorVerificationReport;
    /** When the verification ran, not when the ledger was written. */
    timestamp: string;
}

/**
 * True when the evidence points at deliberate modification rather than at an
 * outage or a race.
 *
 * `ANCHOR_MISSING` is excluded on purpose: an absent anchor is far more often Loki
 * retention than an attacker, and a tamper flag that fires on log rotation gets
 * muted within a week — taking the real signal with it. Same reasoning that split
 * the anchor statuses in the first place.
 */
export function isTamperSuspected(report: FullAuditReport): boolean {
    return !report.db.isValid || report.anchor.status === 'ANCHOR_MISMATCH';
}

export async function runFullAuditVerification(): Promise<FullAuditReport> {
    // Sequential, not Promise.all: the anchor check consumes the sample points the
    // chain check produces. There is nothing to parallelise.
    const db = await verifyAuditChain();
    const anchor = await verifyAnchorIntegrity(db);

    return { db, anchor, timestamp: new Date().toISOString() };
}
