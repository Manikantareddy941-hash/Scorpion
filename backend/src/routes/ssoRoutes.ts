import { Router, Request, Response } from 'express';
import {
    isSsoConfigured,
    buildLoginRedirect,
    completeLogin,
    provisionSsoUser,
    issueSessionToken
} from '../services/oidcService';
import { logger, errorContext } from '../services/logger';

/**
 * Enterprise SSO (generic OIDC). GET /login sends the browser to the IdP;
 * GET /callback finishes the code+PKCE exchange and hands the frontend an
 * Appwrite custom token (in the URL fragment, which never reaches server
 * logs) to exchange for a normal session.
 */

const router = Router();

const COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
const STATE_COOKIE = 'sso_state';
const NONCE_COOKIE = 'sso_nonce';
const VERIFIER_COOKIE = 'sso_verifier';

const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/auth/sso'
};

function redirectUri(req: Request): string {
    return process.env.OIDC_REDIRECT_URL || `${req.protocol}://${req.get('host')}/auth/sso/callback`;
}

function parseCookies(req: Request): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pair of (req.headers.cookie || '').split(';')) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
    return out;
}

router.get('/login', async (req: Request, res: Response) => {
    if (!isSsoConfigured()) {
        return res.status(503).json({ error: 'SSO is not configured on this deployment' });
    }
    try {
        const { url, state, nonce, codeVerifier } = await buildLoginRedirect(redirectUri(req));
        res.cookie(STATE_COOKIE, state, cookieOptions);
        res.cookie(NONCE_COOKIE, nonce, cookieOptions);
        res.cookie(VERIFIER_COOKIE, codeVerifier, cookieOptions);
        res.redirect(url);
    } catch (err) {
        logger.error('[SSO] Failed to start login', errorContext(err));
        res.status(502).json({ error: 'Failed to reach the identity provider' });
    }
});

router.get('/callback', async (req: Request, res: Response) => {
    const frontend = process.env.FRONTEND_URL || '';
    if (!isSsoConfigured()) {
        return res.status(503).json({ error: 'SSO is not configured on this deployment' });
    }

    const cookies = parseCookies(req);
    const state = cookies[STATE_COOKIE];
    const nonce = cookies[NONCE_COOKIE];
    const codeVerifier = cookies[VERIFIER_COOKIE];

    res.clearCookie(STATE_COOKIE, { path: cookieOptions.path });
    res.clearCookie(NONCE_COOKIE, { path: cookieOptions.path });
    res.clearCookie(VERIFIER_COOKIE, { path: cookieOptions.path });

    if (!state || !nonce || !codeVerifier) {
        logger.warn('[SSO] Callback without login cookies (expired or forged)');
        return res.redirect(`${frontend}/login?error=sso_expired`);
    }

    try {
        const callbackUrl = new URL(req.originalUrl, redirectUri(req));
        const identity = await completeLogin(callbackUrl, { state, nonce, codeVerifier });
        const userId = await provisionSsoUser(identity);
        const token = await issueSessionToken(userId);
        logger.info(`[SSO] Login completed for ${identity.email}`);
        // Reuses the existing /auth/callback page (same userId+secret exchange
        // as the Appwrite OAuth flow). Token is single-use and short-lived.
        res.redirect(`${frontend}/auth/callback?userId=${encodeURIComponent(token.userId)}&secret=${encodeURIComponent(token.secret)}`);
    } catch (err) {
        logger.error('[SSO] Callback failed', errorContext(err));
        res.redirect(`${frontend}/login?error=sso_failed`);
    }
});

export default router;
