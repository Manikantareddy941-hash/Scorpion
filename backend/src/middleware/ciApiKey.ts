import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { logger } from '../services/logger';
import { isPostgresEnabled } from '../db/pool';
import { ciTokenRepository, type TokenScope } from '../repositories/pg/ciTokenRepository';

/** Tenant resolved from the presented credential; null = legacy global key. */
declare module 'express-serve-static-core' {
  interface Request {
    ciTenant?: string | null;
  }
}

/**
 * Authenticates CI runners hitting the scan-ingest endpoint via a shared API key
 * (header `x-api-key`). Separate from verifyUser (Appwrite user sessions): CI has
 * no user, only a machine credential.
 *
 * Two credential kinds are accepted, checked in this order:
 *
 * 1. A per-tenant token (ci_tokens). Resolves to the owning tenant, which is
 *    then used to namespace the scan cache. This is the only safe mode for a
 *    multi-tenant deployment.
 * 2. The legacy global CI_INGEST_API_KEY, which resolves to no tenant and so
 *    reads/writes the shared namespace. Retained so existing single-tenant
 *    installs keep working, but it CANNOT be used safely with more than one
 *    customer: every holder can write any image digest, and the admission
 *    webhook trusts what it finds. Multi-tenant deployments must issue tokens
 *    and leave CI_INGEST_API_KEY unset.
 *
 * Fails closed: with neither a valid token nor a configured key, the route is
 * unreachable, never open. Constant-time compare so a wrong key can't be
 * recovered by timing.
 */
const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

const reject = (req: Request, res: Response, reason: string): Response => {
  logger.warn('ci-ingest auth failure', {
    event: 'ci_ingest_auth_failure',
    reason,
    clientIp: clientIp(req),
    method: req.method,
    path: req.originalUrl,
    userAgent: req.headers['user-agent'] ?? null,
  });
  return res.status(401).json({ error: 'Unauthorized' });
};

const keysMatch = (provided: string, expected: string): boolean => {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; length itself isn't secret.
  return a.length === b.length && timingSafeEqual(a, b);
};

export const requireCiToken = (scope: TokenScope) =>
  async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const provided = req.header('x-api-key');
    if (!provided) return reject(req, res, 'missing_api_key');

    // Per-tenant token first. Only available once Postgres is the store; the
    // legacy path below covers installs that have not migrated.
    if (isPostgresEnabled()) {
      const identity = await ciTokenRepository.verify(provided, scope);
      if (identity) {
        // Tenant comes from the token, never from the request body or a header.
        req.ciTenant = identity.team_id ?? identity.user_id;
        return next();
      }
    }

    const expected = process.env.CI_INGEST_API_KEY;
    if (!expected) {
      // No token matched and no legacy key configured — nothing can authenticate.
      logger.error('ci-ingest rejected: no valid token and CI_INGEST_API_KEY not configured', {
        event: 'ci_ingest_misconfigured',
        clientIp: clientIp(req),
      });
      return res.status(503).json({ error: 'Ingest endpoint not configured' });
    }
    if (!keysMatch(provided, expected)) return reject(req, res, 'invalid_api_key');

    // Legacy shared key: no tenant, so the shared namespace is used.
    req.ciTenant = null;
    next();
  };

/** Back-compat alias for the ingest route's original middleware name. */
export const requireCiApiKey = requireCiToken('ingest');
