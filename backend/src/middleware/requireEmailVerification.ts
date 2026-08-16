import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';

/**
 * Blocks high-risk actions until the caller has confirmed their email address.
 *
 * Verification was already three-quarters built: signup fires
 * account.createVerification, /verify-email exchanges the link, and Appwrite
 * flips user.emailVerification. Nothing anywhere READ the flag, so every user
 * was asked to verify and the answer was discarded. This is the read.
 *
 * Soft enforcement, deliberately. Registration is public, so throwaway accounts
 * are free to create — but a hard gate would lock out self-hosted installs with
 * no SMTP, where createVerification already soft-fails by design and the user
 * therefore CANNOT become verified. So the dashboard stays open and only the
 * actions that are worth abusing are gated: long-lived CI credentials, invites
 * that email real people, outbound webhook sinks, and bulk data export.
 */

/** Set by verifyUser's opt-in local bypass; see middleware/auth.ts. */
const DEV_BYPASS_USER_ID = 'mock-local-developer';

function devBypassActive(): boolean {
    return process.env.ALLOW_DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production';
}

interface MaybeVerifiedUser {
    $id?: string;
    emailVerification?: boolean;
}

export function requireEmailVerification(req: Request, res: Response, next: NextFunction): Response | void {
    const user = (req as Request & { user?: MaybeVerifiedUser }).user;

    if (!user) {
        // Should be unreachable: every route this guards is already mounted behind
        // authenticate/verifyUser. Treated as 401 rather than assumed, because a
        // future remount that loses the auth middleware must fail closed here too.
        return res.status(401).json({ error: 'Authentication required' });
    }

    // Requires the literal `true`, not merely truthiness. verifyUser's dev bypass
    // installs a mock user with no emailVerification field at all, and a `!field`
    // check would read that undefined as "unverified" and 403 every request in
    // local development. Handled by naming the bypass explicitly below rather than
    // by letting undefined pass, which would fail OPEN for any future auth path
    // that forgets to populate the flag.
    if (user.emailVerification === true) return next();

    if (user.$id === DEV_BYPASS_USER_ID && devBypassActive()) {
        // The bypass is opt-in and cannot be enabled in production (see auth.ts),
        // so honouring it here does not widen anything.
        return next();
    }

    logger.warn('blocked an unverified account from a gated action', {
        event: 'EMAIL_VERIFICATION_REQUIRED',
        userId: user.$id ?? null,
        method: req.method,
        path: req.originalUrl,
    });

    return res.status(403).json({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        error: 'Please verify your email address to perform this action.',
    });
}
