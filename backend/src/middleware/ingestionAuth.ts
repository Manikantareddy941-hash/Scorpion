import { Request, Response, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { isPostgresEnabled } from '../db/pool';
import { ciTokenRepository } from '../repositories/pg/ciTokenRepository';
import { secretMatches } from '../utils/constantTimeCompare';
import { canAccessResource } from '../services/tenancyService';
import { logger, errorContext } from '../services/logger';

interface AuthedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

/**
 * Authenticates the telemetry ingestion endpoints (POST /api/metrics,
 * POST /api/logs).
 *
 * Both wrote a caller-supplied `repoId` straight into Appwrite with NO
 * authentication of any kind — /api/logs into the audit_logs collection with
 * `action: 'app_log'`. Anyone able to reach the host could forge audit entries
 * against any repository, or poison another tenant's metrics.
 *
 * TWO CALLER KINDS, SO TWO CREDENTIALS
 *
 * These endpoints serve both headless agents (CI jobs, deployed app instances
 * pushing their own telemetry) and the browser. Requiring an Appwrite session
 * would lock out the former; accepting only a machine key would lock out the
 * latter. So the header is tried first and the session is the fallback.
 *
 * WHY THE REPO IS CHECKED AGAINST THE CREDENTIAL, NOT TRUSTED FROM THE BODY
 *
 * `repoId` arrives in the request body, which the caller controls. Proving the
 * credential is *valid* is therefore not enough — a real token for tenant A
 * would otherwise be able to write against tenant B's repository. Both paths
 * resolve the repository document and check it against the identity the
 * credential itself carries, never against anything the body asserts.
 */

/** Resolves the repo document, or null when it does not exist. */
async function loadRepo(repoId: string): Promise<(Models.Document & Record<string, unknown>) | null> {
    try {
        return await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
    } catch {
        return null;
    }
}

function deny(req: Request, res: Response, status: 401 | 403, reason: string): Response {
    // Same shape as ci_ingest_auth_failure in middleware/ciApiKey.ts, so a
    // credential-stuffing sweep across both surfaces is one Loki query.
    logger.warn('ingest auth failure', {
        event: 'INGEST_AUTH_FAILURE',
        reason,
        status,
        repoId: typeof req.body?.repoId === 'string' ? req.body.repoId : null,
        clientIp: req.ip ?? req.socket.remoteAddress ?? 'unknown',
        path: req.originalUrl,
        userAgent: req.headers['user-agent'] ?? null,
    });
    return res.status(status).json({
        error: status === 401 ? 'Authentication required' : 'Access denied',
    });
}

export async function validateIngestionAuth(
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
): Promise<Response | void> {
    const repoId = typeof req.body?.repoId === 'string' ? req.body.repoId : '';
    if (!repoId) return res.status(400).json({ error: 'repoId is required' });

    const apiKey = req.header('x-api-key');

    try {
        // ---- Agent path -------------------------------------------------
        if (apiKey) {
            if (isPostgresEnabled()) {
                const identity = await ciTokenRepository.verify(apiKey, 'ingest');
                if (identity) {
                    const repo = await loadRepo(repoId);
                    if (!repo) return deny(req, res, 403, 'repo_not_found');

                    // The tenant comes from the TOKEN. ciApiKey.ts resolves it the
                    // same way, and for the same reason: a body-supplied tenant is
                    // an assertion, not a credential.
                    const tenant = identity.team_id ?? identity.user_id;
                    const owned = repo.team_id === tenant || repo.user_id === tenant;
                    if (!owned) return deny(req, res, 403, 'token_tenant_repo_mismatch');
                    return next();
                }
            }

            // Legacy global CI_INGEST_API_KEY. It resolves to NO tenant, so there
            // is nothing to check the repo against — this path is exactly as broad
            // as it already is for the scan-ingest endpoint, and is retained only
            // so single-tenant installs keep working. It is not widened here, but
            // it is not narrowed either: a multi-tenant deployment must issue
            // per-repo tokens and leave CI_INGEST_API_KEY unset.
            const expected = process.env.CI_INGEST_API_KEY;
            if (expected && secretMatches(apiKey, expected)) {
                logger.warn('ingest accepted on the legacy global key — no tenant to scope against', {
                    event: 'INGEST_LEGACY_GLOBAL_KEY_USED',
                    repoId,
                    path: req.originalUrl,
                });
                return next();
            }
            return deny(req, res, 401, 'invalid_api_key');
        }

        // ---- Browser path -----------------------------------------------
        const userId = req.user?.$id;
        if (!userId) return deny(req, res, 401, 'no_credential');

        const repo = await loadRepo(repoId);
        if (!repo) return deny(req, res, 403, 'repo_not_found');
        if (!(await canAccessResource(repo, userId))) {
            return deny(req, res, 403, 'user_repo_access_denied');
        }
        return next();
    } catch (err) {
        // Fails CLOSED. A storage outage must not turn an authentication gate
        // into a pass-through — the whole point of this middleware is that the
        // endpoints below it write to audit_logs.
        logger.error('ingest auth check failed — refusing the write', {
            event: 'INGEST_AUTH_CHECK_FAILED',
            repoId,
            path: req.originalUrl,
            ...errorContext(err),
        });
        return res.status(503).json({ error: 'Authentication unavailable' });
    }
}
