jest.mock('../services/logger', () => ({
    ...jest.requireActual('../services/logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type { Request, Response, NextFunction } from 'express';
import { requireEmailVerification } from './requireEmailVerification';

function ctx(user?: Record<string, unknown>) {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn().mockReturnThis();
    const req = { user, method: 'POST', originalUrl: '/api/ci-tokens' } as unknown as Request;
    return { req, res: { status, json } as unknown as Response, next: jest.fn() as NextFunction, status, json };
}

describe('requireEmailVerification', () => {
    const env = process.env;
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...env };
        delete process.env.ALLOW_DEV_AUTH_BYPASS;
    });
    afterAll(() => { process.env = env; });

    it('admits a verified user', () => {
        const c = ctx({ $id: 'u1', emailVerification: true });
        requireEmailVerification(c.req, c.res, c.next);
        expect(c.next).toHaveBeenCalled();
    });

    it('blocks an unverified user with a machine-readable code', () => {
        const c = ctx({ $id: 'u1', emailVerification: false });

        requireEmailVerification(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(403);
        // The frontend keys its modal off `code`, not the prose.
        expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_VERIFICATION_REQUIRED' }));
    });

    it('401s when no user was attached at all', () => {
        const c = ctx(undefined);
        requireEmailVerification(c.req, c.res, c.next);
        expect(c.status).toHaveBeenCalledWith(401);
        expect(c.next).not.toHaveBeenCalled();
    });

    // The trap this middleware is written around. verifyUser's opt-in local
    // bypass installs a mock user with NO emailVerification field, so a plain
    // `!user.emailVerification` check reads undefined as unverified and 403s
    // every request in local development.
    it('admits the dev-bypass identity when the bypass is actually enabled', () => {
        process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
        process.env.NODE_ENV = 'test';
        const c = ctx({ $id: 'mock-local-developer', email: 'dev@scorpion.local' });

        requireEmailVerification(c.req, c.res, c.next);

        expect(c.next).toHaveBeenCalled();
    });

    // ...but the identity alone must not be a skeleton key.
    it('blocks the dev-bypass identity when the bypass is NOT enabled', () => {
        const c = ctx({ $id: 'mock-local-developer', email: 'dev@scorpion.local' });

        requireEmailVerification(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(403);
    });

    it('blocks the dev-bypass identity in production even if the flag is set', () => {
        process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
        process.env.NODE_ENV = 'production';
        const c = ctx({ $id: 'mock-local-developer' });

        requireEmailVerification(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(403);
    });

    // Fails CLOSED on a missing flag rather than treating absence as verified —
    // a future auth path that forgets to populate it must not silently open the
    // gate for every caller.
    it('blocks an ordinary user whose emailVerification field is absent', () => {
        const c = ctx({ $id: 'u1' });

        requireEmailVerification(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(403);
    });

    it('does not accept a truthy non-boolean as verified', () => {
        const c = ctx({ $id: 'u1', emailVerification: 'yes' });

        requireEmailVerification(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(403);
    });
});
