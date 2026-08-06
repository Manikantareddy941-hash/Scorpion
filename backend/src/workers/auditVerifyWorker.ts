import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queues/redisConnection';
import { AUDIT_QUEUE_NAME, type AuditVerifyJobData } from '../queues/auditQueue';
import { verifyAuditTail, type VerificationError } from '../utils/auditVerifier';
import { verifyAnchorIntegrity, type AnchorVerificationReport } from '../utils/auditAnchorVerifier';
import { runFullAuditVerification, isTamperSuspected } from '../utils/auditOrchestrator';
import { sendSystemAlert, type SystemAlert } from '../utils/alertDispatcher';
import { logger } from '../services/logger';

/**
 * Runs ledger verification on a schedule and routes the outcome to whoever needs
 * to act on it.
 *
 * The verb `audit verify` and GET /api/audit/verify both require somebody to ask.
 * Tampering does not announce itself, so a control that only answers when
 * questioned is not a control — it is a report. This worker is what makes the
 * hash chain load-bearing rather than decorative.
 */

/**
 * An unconfigured Loki is a deployment fact, not an incident.
 *
 * ANCHOR_UNAVAILABLE fires both when Loki is unreachable and when it was never
 * configured at all. On a dev or staging box the second is permanent, so alerting
 * on the status alone would page the ops rota forever — and a rota that mutes one
 * alert learns to mute the channel. Stated once, at startup, and then excluded
 * from alerting for the life of the process.
 */
const lokiConfigured = Boolean(process.env.LOKI_QUERY_URL || process.env.LOKI_URL);

if (!lokiConfigured) {
    logger.info(
        '[AuditVerifier] External anchor verification disabled: LOKI_URL not configured. ' +
        'Chain walks will still run, but nothing cross-checks them against off-box anchors, ' +
        'so a rewrite by anyone holding the database credential would go undetected.',
        { event: 'audit_anchor_verification_disabled' },
    );
}

/** Bounded so one pathological run cannot fill the log with the whole ledger. */
const MAX_ERRORS_IN_ALERT = 5;

function describeErrors(errors: readonly VerificationError[]): string {
    const shown = errors.slice(0, MAX_ERRORS_IN_ALERT).map((e) => {
        const at = e.sequence !== undefined ? `seq ${e.sequence}` : 'unsequenced';
        return `${e.kind} at ${at} (${e.recordId})`;
    });
    const rest = errors.length - shown.length;
    return shown.join('; ') + (rest > 0 ? `; and ${rest} more` : '');
}

/**
 * Sends and reports whether anyone actually received it.
 *
 * `configured: 0` means the alert went nowhere. That is worse than a failed
 * delivery, because nothing retries and nothing errors — it is a tamper alarm
 * with the wires cut, and the only way it becomes visible is if someone logs it
 * here.
 */
async function dispatch(alert: SystemAlert): Promise<void> {
    const { delivered, configured } = await sendSystemAlert(alert);

    if (configured === 0) {
        logger.error(
            `[AuditVerifier] ${alert.channel} alert had NO configured destination — nobody was told`,
            {
                event: 'audit_alert_undeliverable',
                channel: alert.channel,
                title: alert.title,
                hint: `set ${alert.channel === 'security' ? 'SECURITY_ALERT' : 'OPS_ALERT'}_SLACK_WEBHOOK or _PAGERDUTY_KEY`,
            },
        );
        return;
    }

    if (delivered === 0) {
        logger.error('[AuditVerifier] every configured destination rejected the alert', {
            event: 'audit_alert_delivery_failed', channel: alert.channel, configured,
        });
    }
}

/** Ops-side notification for "the check could not be performed", never for "the check failed". */
async function reportAnchorGap(anchor: AnchorVerificationReport, tier: string): Promise<void> {
    if (anchor.status !== 'ANCHOR_UNAVAILABLE' || !anchor.lokiConfigured) return;

    await dispatch({
        channel: 'ops',
        title: 'Audit anchor cross-check unavailable',
        detail:
            `The ${tier} verification could not reach the off-box anchors. The chain was walked, but ` +
            'nothing independent confirmed it, so a rewrite by anyone with database write access ' +
            'would not have been visible. Check Loki reachability.',
        // One incident for the outage rather than one per run.
        dedupKey: 'scorpion-audit-anchors-unavailable',
    });
}

async function runTail(): Promise<void> {
    const db = await verifyAuditTail();
    const anchor = await verifyAnchorIntegrity(db);

    // Note what is NOT asserted here: the tail cannot say the ledger is intact,
    // only that this window is self-consistent. There is no isValid to read.
    const tampered = db.errors.length > 0 || anchor.status === 'ANCHOR_MISMATCH';

    logger.info('[AuditVerifier] tail pass complete', {
        event: 'audit_verify_tail',
        rowsChecked: db.rowsChecked,
        windowFrom: db.windowFrom,
        latestSequence: db.latestSequence,
        errors: db.errors.length,
        anchorStatus: anchor.status,
    });

    if (tampered) {
        await dispatch({
            channel: 'security',
            title: 'Audit ledger tamper evidence (recent window)',
            detail:
                `Verified the last ${db.rowsChecked} rows. ` +
                (db.errors.length > 0 ? `Chain problems: ${describeErrors(db.errors)}. ` : '') +
                (anchor.status === 'ANCHOR_MISMATCH'
                    ? 'A sampled position hashes differently in the ledger than in the anchor written when the event occurred — the row changed after the fact. '
                    : '') +
                'This window alone cannot rule out older tampering; the daily full walk covers that.',
            dedupKey: 'scorpion-audit-tamper',
        });
    }

    await reportAnchorGap(anchor, 'tail');
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

    if (isTamperSuspected(report)) {
        await dispatch({
            channel: 'security',
            title: 'Audit ledger tamper evidence (full walk)',
            detail:
                `Walked ${report.db.rowsChecked} rows from genesis. ` +
                (report.db.errors.length > 0 ? `Chain problems: ${describeErrors(report.db.errors)}. ` : '') +
                (report.anchor.status === 'ANCHOR_MISMATCH'
                    ? 'At least one sampled position disagrees with its off-box anchor, which requires database write access to produce. '
                    : '') +
                'Treat the audit trail as untrustworthy until explained.',
            dedupKey: 'scorpion-audit-tamper',
        });
    }

    await reportAnchorGap(report.anchor, 'full');
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
