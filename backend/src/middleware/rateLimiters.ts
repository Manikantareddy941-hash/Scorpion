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
