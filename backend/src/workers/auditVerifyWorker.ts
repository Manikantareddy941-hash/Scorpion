import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queues/redisConnection';
import { AUDIT_QUEUE_NAME, type AuditVerifyJobData } from '../queues/auditQueue';
import { verifyAuditTail, type VerificationError, type TailVerificationReport } from '../utils/auditVerifier';
import { verifyAnchorIntegrity, type AnchorVerificationReport } from '../utils/auditAnchorVerifier';
import { runFullAuditVerification, isTamperSuspected, type FullAuditReport } from '../utils/auditOrchestrator';
import { sendSystemAlert, type SystemAlertPayload } from '../utils/systemAlert';
import { logger } from '../services/logger';

/**
 * Runs ledger verification on a schedule and pages a human when it fails.
 *
 * WHY THIS EXISTS. Everything before it was passive. verifyAuditChain and
 * `audit verify` both require somebody to ask, and tampering does not announce
 * itself — a control that only answers when questioned is a report, not a
 * control. This is what makes the hash chain load-bearing.
 */

/** Bounded: a badly broken ledger could otherwise put thousands of entries in a pager payload. */
const MAX_DETAIL_ENTRIES = 20;

function summariseErrors(errors: readonly VerificationError[]): string {
    const shown = errors.slice(0, 5).map((e) => {
        const at = e.sequence !== undefined ? `seq ${e.sequence}` : 'unsequenced';
        return `${e.kind} at ${at} (${e.recordId})`;
    });
    const rest = errors.length - shown.length;
    return shown.join('; ') + (rest > 0 ? `; and ${rest} more` : '');
}

/**
 * Ops-side alerting for "the cross-check could not be performed", never for "the
 * cross-check failed".
 *
 * ANCHOR_UNAVAILABLE covers THREE situations and they are not the same incident:
 *
 *   configured but unreachable  -> lokiConfigured true, `checks` POPULATED (one per
 *                                  sample that could not be resolved). Temporary,
 *                                  and worth a WARN.
 *   nothing to check            -> lokiConfigured true, `checks` EMPTY. True of a
 *                                  fresh install and of any ledger still entirely
 *                                  pre-sequencing. Nothing is wrong; alerting here
 *                                  pages every 15 minutes on a new deployment,
 *                                  telling ops to check a Loki that is answering
 *                                  perfectly.
 *   never configured            -> lokiConfigured false. Worse than unreachable in
 *                                  PRODUCTION, because the cross-check has never run
 *                                  and never will. On a dev box it is expected and
 *                                  must not page.
 */
function anchorGapAlerts(anchor: AnchorVerificationReport, rowsChecked: number): SystemAlertPayload[] {
    if (anchor.status !== 'ANCHOR_UNAVAILABLE') return [];

    if (anchor.lokiConfigured) {
        if (anchor.checks.length === 0) return [];
        return [{
            level: 'WARN',
            title: 'Audit Anchor Store Unreachable',
            message:
                'An anchor store is configured but did not answer. Until it does, a rewrite by a holder ' +
                'of the database credential cannot be detected.',
            details: { anchorStatus: anchor.status, rowsChecked, unresolved: anchor.checks.length },
        }];
    }

    // Read at call time, not at module load: a value captured on import cannot be
    // exercised by a test, and an untested production-only branch is one nobody
    // finds out about until production.
    if (process.env.NODE_ENV === 'production') {
        return [{
            level: 'WARN',
            title: 'Audit Anchor Store Not Configured',
            message:
                'No anchor store is configured in production, so the audit ledger has never been ' +
                'cross-checked against anything outside the database it lives in.',
            details: { rowsChecked },
        }];
    }

    return [];
}

/** Alerts for the bounded 15-minute pass. */
function tailAlerts(db: TailVerificationReport, anchor: AnchorVerificationReport): SystemAlertPayload[] {
    const alerts: SystemAlertPayload[] = [];

    // Note what is NOT asserted: a tail cannot say the ledger is intact, only that
    // this window is self-consistent. There is no isValid to read.
    if (db.errors.length > 0 || anchor.status === 'ANCHOR_MISMATCH') {
        alerts.push({
            level: 'CRITICAL',
            title: 'Audit Ledger Tamper Evidence',
            message:
                `Verified the last ${db.rowsChecked} rows. ${summariseErrors(db.errors)}` +
                (anchor.status === 'ANCHOR_MISMATCH'
                    ? ' A sampled position hashes differently in the ledger than in the anchor written when the event occurred.'
                    : '') +
                ' This window alone cannot rule out older tampering; the daily full walk covers that.',
            details: {
                scope: 'tail',
                rowsChecked: db.rowsChecked,
                windowFrom: db.windowFrom,
                latestSequence: db.latestSequence,
                anchorStatus: anchor.status,
                errors: db.errors.slice(0, MAX_DETAIL_ENTRIES),
                mismatches: anchor.checks.filter((c) => c.status === 'ANCHOR_MISMATCH').slice(0, MAX_DETAIL_ENTRIES),
            },
        });
    }

    return [...alerts, ...anchorGapAlerts(anchor, db.rowsChecked)];
}

/** Alerts for the daily walk from genesis. */
function fullAlerts(report: FullAuditReport): SystemAlertPayload[] {
    const alerts: SystemAlertPayload[] = [];

    if (isTamperSuspected(report)) {
        alerts.push({
            level: 'CRITICAL',
            title: 'Audit Ledger Tamper Evidence',
            message:
                `Walked ${report.db.rowsChecked} rows from genesis. ${summariseErrors(report.db.errors)}` +
                (report.anchor.status === 'ANCHOR_MISMATCH'
                    ? ' At least one sampled position disagrees with its off-box anchor, which requires database write access to produce.'
                    : '') +
                ' Treat the audit trail as untrustworthy until explained.',
            details: {
                scope: 'full',
                dbValid: report.db.isValid,
                anchorStatus: report.anchor.status,
                rowsChecked: report.db.rowsChecked,
                latestSequence: report.db.latestSequence,
                errors: report.db.errors.slice(0, MAX_DETAIL_ENTRIES),
                mismatches: report.anchor.checks.filter((c) => c.status === 'ANCHOR_MISMATCH').slice(0, MAX_DETAIL_ENTRIES),
            },
        });
    }

    return [...alerts, ...anchorGapAlerts(report.anchor, report.db.rowsChecked)];
}

/**
 * Sends and records whether anyone actually received it.
 *
 * sendSystemAlert returns a delivered count rather than throwing, and zero means
 * the alert reached the application log and nothing else. Nothing retries past
 * that point and nothing errors, so this line is the only way a tamper alarm with
 * the wires cut becomes visible.
 */
async function dispatch(alerts: readonly SystemAlertPayload[]): Promise<void> {
    for (const alert of alerts) {
        const delivered = await sendSystemAlert(alert);
        if (delivered === 0) {
            logger.error('[AuditVerifier] alert reached no sink', {
                event: 'audit_alert_undeliverable',
                level: alert.level,
                title: alert.title,
            });
        }
    }
}

async function runTail(): Promise<void> {
    const db = await verifyAuditTail();
    const anchor = await verifyAnchorIntegrity(db);

    logger.info('[AuditVerifier] tail pass complete', {
        event: 'audit_verify_tail',
        rowsChecked: db.rowsChecked,
        windowFrom: db.windowFrom,
        latestSequence: db.latestSequence,
        errors: db.errors.length,
        anchorStatus: anchor.status,
    });

    await dispatch(tailAlerts(db, anchor));
}

async function runFull(): Promise<void> {
    const report = await runFullAuditVerification();

    logger.info('[AuditVerifier] full walk complete', {
        event: 'audit_verify_full',
        rowsChecked: report.db.rowsChecked,
        chainValid: report.db.isValid,
        latestSequence: report.db.latestSequence,
        anchorStatus: report.anchor.status,
    });

    await dispatch(fullAlerts(report));
}

export async function processAuditVerification(job: Job<AuditVerifyJobData>): Promise<void> {
    if (job.data.tier === 'full') {
        await runFull();
        return;
    }
    await runTail();
}

let worker: Worker<AuditVerifyJobData> | null = null;

/**
 * Started explicitly from index.ts, matching initScanWorker and the other queue
 * workers. Deliberately NOT constructed at module load: a Worker built on import
 * only runs if something imports the file, and a scheduled integrity check that
 * silently does not exist is worse than none — the schedule would still be in
 * Redis, jobs would still be created, and they would sit unprocessed while the
 * absence of alerts read as a clean ledger.
 *
 * concurrency: 1 — a second verification while the first is still paging the
 * ledger doubles the read load for no extra information, and the full walk can
 * outlive its own 15-minute tick on a large collection. BullMQ holds the next job
 * rather than running it alongside.
 */
export function initAuditVerifyWorker(): Worker<AuditVerifyJobData> {
    if (worker) return worker;

    worker = new Worker<AuditVerifyJobData>(
        AUDIT_QUEUE_NAME,
        processAuditVerification,
        { connection: redisConnection, concurrency: 1 },
    );

    worker.on('failed', (job, err) => {
        // A failed verification is not a clean ledger. Logged at error so an absent
        // "complete" line is never mistaken for silence meaning success.
        logger.error(`[AuditVerifier] ${job?.data.tier ?? 'unknown'} verification failed:`, err?.message ?? err);
    });

    logger.info('[AuditVerifier] worker started (tail + full ledger verification)');
    return worker;
}
