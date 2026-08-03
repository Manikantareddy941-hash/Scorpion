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
