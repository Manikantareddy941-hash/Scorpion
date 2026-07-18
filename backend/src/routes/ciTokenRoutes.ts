import { Router, Request, Response, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { verifyUser } from '../middleware/auth';
import { isPostgresEnabled } from '../db/pool';
import { ciTokenRepository, type TokenScope } from '../repositories/pg/ciTokenRepository';
import { resolveCreationOwnership, TenantAccessError } from '../services/tenancyService';
import { logger } from '../services/logger';

/**
 * Self-service management of the per-tenant CI/admission tokens.
 *
 * Without this the tokens exist but can only be created by hand in psql, which
 * means the safe multi-tenant path is unusable and every customer stays on the
 * shared legacy key — the exact configuration the tokens were built to retire.
 */

interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: Models.User<Models.Preferences>;
}

const router = Router();
router.use(verifyUser);

const VALID_SCOPES: TokenScope[] = ['ingest', 'admission'];
const MAX_NAME_LENGTH = 100;

/** Tokens live in Postgres; on the legacy storage path there is nothing to manage. */
function requirePostgres(_req: Request, res: Response, next: NextFunction) {
  if (!isPostgresEnabled()) {
    return res.status(503).json({ error: 'CI tokens require the Postgres storage backend' });
  }
  next();
}
router.use(requirePostgres);

const asyncHandler = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthenticatedRequest, res).catch(next);
  };

/**
 * POST /api/ci-tokens — issue a token.
 *
 * The plaintext is in this response and nowhere else, ever: only its hash is
 * stored. A caller that loses it must issue a new one.
 */
router.post('/', asyncHandler(async (req, res) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: `name is required and must be 1-${MAX_NAME_LENGTH} characters` });
  }

  const scope = (req.body?.scope ?? 'ingest') as TokenScope;
  if (!VALID_SCOPES.includes(scope)) {
    return res.status(400).json({ error: `scope must be one of: ${VALID_SCOPES.join(', ')}` });
  }

  let ownership;
  try {
    // Ownership comes from the session, never the body — otherwise a caller
    // could mint a token acting as another tenant.
    ownership = await resolveCreationOwnership(req, userId);
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return res.status(403).json({ error: 'Not a member of the requested team' });
    }
    throw err;
  }

  const { token, summary } = await ciTokenRepository.create(ownership, name, scope);
  logger.info('[ciTokens] issued', { tokenId: summary.id, scope, userId });

  res.status(201).json({
    token,
    warning: 'Store this now — it cannot be retrieved again.',
    ...summary,
  });
}));

/** GET /api/ci-tokens — list this tenant's tokens. Never includes a secret. */
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  res.json(await ciTokenRepository.listForOwner(userId));
}));

/**
 * DELETE /api/ci-tokens/:id — revoke immediately.
 *
 * Ownership is enforced inside the repository's WHERE clause, so a caller
 * cannot revoke another tenant's token by guessing an id. A miss returns 404
 * rather than 403 so the response cannot be used to probe for valid ids.
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const revoked = await ciTokenRepository.revoke(req.params.id, userId);
  if (!revoked) return res.status(404).json({ error: 'Token not found' });

  logger.info('[ciTokens] revoked', { tokenId: req.params.id, userId });
  res.status(204).end();
}));

export default router;
