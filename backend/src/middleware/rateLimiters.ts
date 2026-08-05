import rateLimit from 'express-rate-limit';

const makeLimiter = (windowMs: number, max: number) =>
    rateLimit({
        windowMs,
        max,
        message: 'Too many requests, please try again later.',
        standardHeaders: true,
        legacyHeaders: false,
    });

/** For endpoints that kick off a scan/clone/heavy child-process job. */
export const scanTriggerLimiter = makeLimiter(60 * 1000, 5);

/** For endpoints that call out to the AI provider (cost + latency sensitive). */
export const aiLimiter = makeLimiter(60 * 1000, 10);

/** For ZIP upload + extraction. */
export const uploadLimiter = makeLimiter(60 * 1000, 10);

/**
 * For the Scorpion Terminal command surface. Generous enough for interactive typing,
 * tight enough that the endpoint can't be used to enumerate the verb table or to
 * flood the hash-chained audit ledger (every command writes one entry).
 */
export const terminalLimiter = makeLimiter(60 * 1000, 60);

/**
 * For GET /api/audit/verify.
 *
 * Far tighter than anything else here because one request pages the ENTIRE audit
 * ledger out of Appwrite and then issues a Loki query — the cost per call grows
 * with the ledger and is unbounded. Admin-only auth already limits who can reach
 * it, but a compromised or careless admin session should not be able to turn a
 * verification endpoint into a database amplifier.
 *
 * Five per fifteen minutes is ample: this is an on-demand investigation tool, not
 * something a dashboard polls. If it ever needs to run on a schedule, that belongs
 * in a worker calling runFullAuditVerification() directly, not in HTTP traffic.
 */
export const auditVerifyLimiter = makeLimiter(15 * 60 * 1000, 5);
