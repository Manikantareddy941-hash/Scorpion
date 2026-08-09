import { Request, Response, NextFunction } from 'express';
import { Client, Account } from 'node-appwrite';
import { logger, errorContext } from '../services/logger';

/**
 * Middleware to verify an Appwrite session JWT.
 *
 * Appwrite JWTs are opaque to us (signed with a secret only Appwrite holds), so the only
 * way to confirm one is genuine is to present it back to Appwrite via account.get() and see
 * if it resolves to a real session. Do not switch this back to jwt.decode()-only: decode()
 * never checks the signature, so any caller could forge a token with an arbitrary userId
 * claim and impersonate any user.
 */
export const verifyUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token = '';
    const header = req.headers.authorization;
    if (header) {
      token = header.split(" ")[1];
    } else if (req.query.token) {
      token = req.query.token as string;
    }

    const ip = req.ip || req.socket.remoteAddress || '';

    // The local-developer bypass is now strictly opt-in: it only activates when
    // ALLOW_DEV_AUTH_BYPASS is explicitly set AND we're not in production. The old
    // behaviour (bypass whenever NODE_ENV !== 'production', or whenever the request
    // looked local) was unsafe: a deploy that simply forgot to set NODE_ENV, or any
    // setup where the app sits behind a same-host proxy that makes req.ip look local,
    // would silently disable authentication.
    const devBypassAllowed =
      process.env.ALLOW_DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production';

    if (!token) {
      if (devBypassAllowed) {
        logger.warn(`[Auth] DEV AUTH BYPASS active for ${req.method} ${req.path} from ${ip} — never set ALLOW_DEV_AUTH_BYPASS in production`);
        (req as any).user = {
          $id: 'mock-local-developer',
          userId: 'mock-local-developer',
          email: 'dev@scorpion.local'
        };
        return next();
      }
      logger.warn(`[Auth] Rejected unauthenticated request to ${req.method} ${req.path} from ${ip}`);
      return res.status(401).json({ error: "No token provided" });
    }

    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
      .setProject(process.env.APPWRITE_PROJECT_ID || '')
      .setJWT(token);

    const account = new Account(client);
    const user = await account.get();

    if (!user || !user.$id) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    (req as any).user = {
      ...user,
      $id: user.$id,
      userId: user.$id,
    };

    next();

  } catch (err) {
    logger.error('[Auth] token verification failed', {
      event: 'AUTH_VERIFY_FAILED',
      ...errorContext(err),
    });
    return res.status(401).json({ error: "Unauthorized" });
  }
};
