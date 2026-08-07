import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

/**
 * Scheduled verification of the tamper-evident audit ledger.
 *
 * TWO TIERS, BECAUSE ONE DOES NOT WORK
 *
 * `tail` runs often and reads a bounded window, so its cost does not grow with
 * the ledger. It catches tampering promptly and cross-checks fresh positions
 * against the Loki anchors while they are still inside retention.
 *
 * `full` runs once a day off-peak and walks the whole chain from genesis. It is
 * the only pass that can see a retroactive rewrite of old history — precisely the
 * edit nobody would notice, because nobody reads year-old audit rows.
 *
 * Running only the tail would miss that. Running only the full walk means an O(N)
 * scan against a collection that only grows, on a timer.
 */

export type AuditVerificationTier = 'tail' | 'full';

export interface AuditVerifyJobData {
    tier: AuditVerificationTier;
}

export const AUDIT_QUEUE_NAME = 'audit-verification';

export const auditQueue = new Queue<AuditVerifyJobData>(AUDIT_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        // Deliberately 1: a verification that fails because Appwrite or Loki was
        // briefly unreachable should wait for its next scheduled run, not retry
        // into a database it has just been unable to read. The next tick is 15
        // minutes away — sooner than any backoff worth configuring.
        attempts: 1,
        // Kept long enough to answer "when did this last come back clean?" from
        // the queue itself, without another store to consult.
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
    },
});
