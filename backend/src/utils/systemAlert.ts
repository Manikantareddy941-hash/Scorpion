import axios from 'axios';
import { logger } from '../services/logger';

/**
 * Alerts about the platform itself, not about a customer's findings.
 *
 * WHY NOT sendFindingAlert.
 *
 * That function is shaped entirely around a scan finding — it takes a `userId`,
 * reads that user's integration row, and drops anything below their configured
 * `min_severity`. Every one of those is wrong for a system incident:
 *
 *   - A tampered audit ledger has no owning user and no repository. Synthesising a
 *     FindingDocument to fit would put false values in the payload an operator
 *     reads during an incident.
 *   - Routing through per-user integrations means the alert reaches whoever
 *     happens to have configured a webhook, and nobody if no one has.
 *   - min_severity is a user's preference about THEIR findings. A user who sets it
 *     to 'critical' would silently discard a system warning; one who has no
 *     integration row at all discards everything.
 *
 * So this reads process-level configuration and nothing else. It is deliberately
 * not clever: no filtering, no severity threshold, no database lookup on a path
 * that may be firing precisely because the database is compromised.
 */

export interface SystemAlertPayload {
    level: 'CRITICAL' | 'WARN';
    title: string;
    message: string;
    /** Structured context. Rendered into each sink's custom-details field. */
    details?: Record<string, unknown>;
}

const PAGERDUTY_SEVERITY: Record<SystemAlertPayload['level'], string> = {
    CRITICAL: 'critical',
    WARN: 'warning',
};

/** Bounded so a hung sink cannot stall the worker holding the queue lock. */
const SINK_TIMEOUT_MS = 10_000;

/**
 * One retry, because the caller's cadence is not a substitute for it.
 *
 * The 15-minute tail pass re-detects and re-alerts, so a dropped alert there
 * self-heals. The daily full walk does not — it is the only pass that sees a
 * retroactive rewrite of old history, and one transient failure would bury that
 * finding for 24 hours.
 */
const SINK_ATTEMPTS = 2;
const SINK_RETRY_DELAY_MS = 1_000;

/**
 * Posts with one retry, reporting success rather than throwing.
 *
 * Only `err.message` is ever logged, never the error object. A Slack webhook
 * carries its secret in the URL path, so logging the axios config would write a
 * live credential into the log stream — which, on this deployment, ships to the
 * same Loki that stores the audit anchors. Do not "improve" this to log the whole
 * error.
 */
async function deliver(label: string, send: () => Promise<unknown>): Promise<boolean> {
    for (let attempt = 1; attempt <= SINK_ATTEMPTS; attempt++) {
        try {
            await send();
            return true;
        } catch (err) {
            logger.error(
                `[SystemAlert] ${label} delivery failed (attempt ${attempt}/${SINK_ATTEMPTS}):`,
                err instanceof Error ? err.message : String(err),
            );
            if (attempt < SINK_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, SINK_RETRY_DELAY_MS));
            }
        }
    }
    return false;
}

/**
 * Names of the sinks that are actually configured.
 *
 * NAMES ONLY, never values. A Slack webhook carries its secret in the URL and a
 * PagerDuty routing key is a credential; this is written to the boot log, which
 * on this deployment ships to the same Loki that stores the audit anchors.
 *
 * This is the single place that knows which environment variables map to which
 * sink, so a sink added later cannot appear in delivery while staying invisible
 * at boot — the two would disagree, and the boot log is what an operator trusts.
 */
export function configuredSinks(): string[] {
    return [
        process.env.SYSTEM_ALERT_SLACK_WEBHOOK ? 'Slack' : null,
        process.env.SYSTEM_ALERT_PAGERDUTY_KEY ? 'PagerDuty' : null,
        process.env.SYSTEM_ALERT_WEBHOOK_URL ? 'webhook' : null,
    ].filter((s): s is string => s !== null);
}

/**
 * True when at least one sink is configured.
 *
 * Exported so callers can refuse to report success on a path that would deliver
 * nowhere — "no recipient configured" must never read as "alert sent".
 */
export function systemAlertConfigured(): boolean {
    return configuredSinks().length > 0;
}

/**
 * Delivers to every configured sink. Never throws.
 *
 * Returns the number of sinks that accepted it, so a caller can distinguish
 * "delivered" from "delivered nowhere". A void return would make an unconfigured
 * process indistinguishable from a successful page, which is the failure this
 * whole subsystem exists to stop reproducing.
 *
 * Each sink is attempted independently: one broken webhook must not suppress the
 * others, because the alert being suppressed is the one saying the audit ledger
 * was rewritten.
 */
export async function sendSystemAlert(payload: SystemAlertPayload): Promise<number> {
    const { level, title, message, details } = payload;

    // Always emit locally first. If every sink is down or unset, the record still
    // exists somewhere a human can reach, and it is emitted BEFORE the network
    // calls so a hang cannot lose it.
    const log = level === 'CRITICAL' ? logger.error : logger.warn;
    log(`[SystemAlert] ${level}: ${title} — ${message}`, { event: 'system_alert', level, title, ...details });

    if (!systemAlertConfigured()) {
        logger.error(
            '[SystemAlert] no system alert sink is configured — this alert reached the log and nothing else. ' +
            'Set SYSTEM_ALERT_WEBHOOK_URL, SYSTEM_ALERT_PAGERDUTY_KEY or SYSTEM_ALERT_SLACK_WEBHOOK.',
            { title },
        );
        return 0;
    }

    let delivered = 0;

    const slack = process.env.SYSTEM_ALERT_SLACK_WEBHOOK;
    if (slack && await deliver('Slack', () => axios.post(slack, {
        text: `*[${level}] ${title}*\n${message}`,
        attachments: details ? [{ text: '```' + JSON.stringify(details, null, 2) + '```' }] : undefined,
    }, { timeout: SINK_TIMEOUT_MS }))) {
        delivered += 1;
    }

    const pagerduty = process.env.SYSTEM_ALERT_PAGERDUTY_KEY;
    if (pagerduty && await deliver('PagerDuty', () => axios.post('https://events.pagerduty.com/v2/enqueue', {
        routing_key: pagerduty,
        event_action: 'trigger',
        // Same incident should deduplicate rather than page every 15 minutes for
        // the duration of an outage.
        dedup_key: `scorpion-system-${title}`,
        payload: {
            summary: `[${level}] ${title}`,
            severity: PAGERDUTY_SEVERITY[level],
            source: 'scorpion',
            custom_details: { message, ...details },
        },
    }, { timeout: SINK_TIMEOUT_MS }))) {
        delivered += 1;
    }

    const webhook = process.env.SYSTEM_ALERT_WEBHOOK_URL;
    if (webhook && await deliver('webhook', () => axios.post(webhook, {
        level, title, message, details, source: 'scorpion',
        timestamp: new Date().toISOString(),
    }, { timeout: SINK_TIMEOUT_MS }))) {
        delivered += 1;
    }

    if (delivered === 0) {
        logger.error('[SystemAlert] every configured sink failed — alert was not delivered', { title });
    }
    return delivered;
}
