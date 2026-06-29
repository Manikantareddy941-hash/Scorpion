import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { logger } from '../services/logger';

/**
 * Authenticates CI runners hitting the scan-ingest endpoint via a shared API key
 * (header `x-api-key`). Separate from verifyUser (Appwrite user sessions): CI has
 * no user, only a machine credential.
 *
 * Fails closed: if CI_INGEST_API_KEY is unset the route is unreachable, never open.
 * Constant-time compare so a wrong key can't be recovered by timing.
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

export const requireCiApiKey = (req: Request, res: Response, next: NextFunction): Response | void => {
  const expected = process.env.CI_INGEST_API_KEY;
  if (!expected) {
    logger.error('ci-ingest rejected: CI_INGEST_API_KEY not configured', { event: 'ci_ingest_misconfigured', clientIp: clientIp(req) });
    return res.status(503).json({ error: 'Ingest endpoint not configured' });
  }

  const provided = req.header('x-api-key');
  if (!provided) return reject(req, res, 'missing_api_key');
  if (!keysMatch(provided, expected)) return reject(req, res, 'invalid_api_key');

  next();
};
