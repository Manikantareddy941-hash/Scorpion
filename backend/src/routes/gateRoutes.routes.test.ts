/**
 * gateRoutes HTTP surface: access guard, deployable/blocked mapping,
 * break-glass override, legacy release endpoints and 500 ladders.
 * gateService fully mocked (gateRoutes.test.ts covers the real gate logic).
 */
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

type MockAuthRequest = Request & { user?: { $id: string } };

jest.mock('../middleware/auth', () => ({
    verifyUser: (req: MockAuthRequest, _res: Response, next: NextFunction) => {
        req.user = { $id: 'user-1' };
        next();
    },
}));
jest.mock('../middleware/iamMiddleware', () => ({
    checkPermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../services/gateService', () => ({
    gateService: {
        assertRepoAccess: jest.fn(),
        evaluate: jest.fn(),
        checkDeployable: jest.fn(),
        override: jest.fn(),
        getState: jest.fn(),
        legacyRelease: jest.fn(),
        getSummary: jest.fn(),
    },
    checkReleaseGate: jest.fn(),
}));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import gateRoutes from './gateRoutes';
import { gateService, checkReleaseGate } from '../services/gateService';

const svc = gateService as jest.Mocked<typeof gateService>;

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/gates', gateRoutes);
    return app;
};

beforeEach(() => {
    jest.clearAllMocks();
    svc.assertRepoAccess.mockResolvedValue(true);
});

describe('POST /evaluate', () => {
    it('validates the body', async () => {
        expect((await request(buildApp()).post('/api/gates/evaluate').send({})).statusCode).toBe(400);
    });

    it('denies inaccessible repos', async () => {
        svc.assertRepoAccess.mockResolvedValue(false);
        expect((await request(buildApp()).post('/api/gates/evaluate').send({ repo_id: 'r1' })).statusCode).toBe(403);
        expect(svc.evaluate).not.toHaveBeenCalled();
    });

    it('returns the evaluation and maps failures to 500', async () => {
        svc.evaluate.mockResolvedValue({ allowed: true, score: 90 } as never);
        const ok = await request(buildApp()).post('/api/gates/evaluate').send({ repo_id: 'r1' });
        expect(ok.body).toMatchObject({ allowed: true, score: 90 });

        svc.evaluate.mockRejectedValue(new Error('boom'));
        expect((await request(buildApp()).post('/api/gates/evaluate').send({ repo_id: 'r1' })).statusCode).toBe(500);
    });
});

describe('POST /deploy', () => {
    it('rejects blocked deployments with the gate detail', async () => {
        svc.checkDeployable.mockResolvedValue({
            deployable: false, minSecurityScore: 70, score: 40,
            blockers: [{ severity: 'critical', title: 'RCE' }],
        } as never);

        const res = await request(buildApp()).post('/api/gates/deploy').send({ repo_id: 'r1' });

        expect(res.statusCode).toBe(403);
        expect(res.body.error).toContain('BLOCKED');
        expect(res.body.blockers).toHaveLength(1);
    });

    it('confirms deployable repos', async () => {
        svc.checkDeployable.mockResolvedValue({ deployable: true } as never);
        const res = await request(buildApp()).post('/api/gates/deploy').send({ repo_id: 'r1' });
        expect(res.body.status).toBe('success');
    });

    it('maps service failures to 500', async () => {
        svc.checkDeployable.mockRejectedValue(new Error('down'));
        expect((await request(buildApp()).post('/api/gates/deploy').send({ repo_id: 'r1' })).statusCode).toBe(500);
    });
});

describe('POST /override', () => {
    it('activates break-glass for authorized users on accessible repos', async () => {
        svc.override.mockResolvedValue(undefined as never);
        const res = await request(buildApp()).post('/api/gates/override').send({ repo_id: 'r1' });
        expect(res.body.success).toBe(true);
        expect(svc.override).toHaveBeenCalledWith('r1', 'user-1');
    });

    it('denies inaccessible repos and maps failures to 500', async () => {
        svc.assertRepoAccess.mockResolvedValue(false);
        expect((await request(buildApp()).post('/api/gates/override').send({ repo_id: 'r1' })).statusCode).toBe(403);

        svc.assertRepoAccess.mockResolvedValue(true);
        svc.override.mockRejectedValue(new Error('nope'));
        expect((await request(buildApp()).post('/api/gates/override').send({ repo_id: 'r1' })).statusCode).toBe(500);
    });
});

describe('GET /state and /summary', () => {
    it('returns state and summary, mapping failures to 500', async () => {
        svc.getState.mockResolvedValue({ locked: false } as never);
        expect((await request(buildApp()).get('/api/gates/state')).body).toEqual({ locked: false });

        svc.getState.mockRejectedValue(new Error('x'));
        expect((await request(buildApp()).get('/api/gates/state')).statusCode).toBe(500);

        svc.getSummary.mockResolvedValue({ repos: 3 } as never);
        expect((await request(buildApp()).get('/api/gates/summary')).body).toEqual({ repos: 3 });

        svc.getSummary.mockRejectedValue(new Error('x'));
        expect((await request(buildApp()).get('/api/gates/summary')).statusCode).toBe(500);
    });
});

describe('legacy release endpoints', () => {
    it('POST /release delegates to legacyRelease with the caller id', async () => {
        svc.legacyRelease.mockResolvedValue({ ok: true } as never);
        const res = await request(buildApp()).post('/api/gates/release').send({ repo_id: 'r1' });
        expect(res.body).toEqual({ ok: true });
        expect(svc.legacyRelease).toHaveBeenCalledWith('r1', 'user-1');

        svc.legacyRelease.mockRejectedValue(new Error('x'));
        expect((await request(buildApp()).post('/api/gates/release').send({ repo_id: 'r1' })).statusCode).toBe(500);
    });

    it('GET /release/:repo_id checks access then evaluates the gate', async () => {
        (checkReleaseGate as jest.Mock).mockResolvedValue({ allowed: true, score: 88 });
        const ok = await request(buildApp()).get('/api/gates/release/r1');
        expect(ok.body).toMatchObject({ allowed: true });

        svc.assertRepoAccess.mockResolvedValue(false);
        expect((await request(buildApp()).get('/api/gates/release/r1')).statusCode).toBe(403);

        svc.assertRepoAccess.mockResolvedValue(true);
        (checkReleaseGate as jest.Mock).mockRejectedValue(new Error('x'));
        expect((await request(buildApp()).get('/api/gates/release/r1')).statusCode).toBe(500);
    });
});
