import request from 'supertest';
import express from 'express';

jest.mock('../gitops/argocdHandler', () => ({
    handleArgoCDSync: jest.fn().mockResolvedValue(undefined),
}));

import gitopsRoutes from './gitopsRoutes';
import { handleArgoCDSync } from '../gitops/argocdHandler';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/gitops', gitopsRoutes);
    return app;
};

describe('gitopsRoutes POST /sync', () => {
    const originalSecret = process.env.SCORPION_WEBHOOK_SECRET;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.SCORPION_WEBHOOK_SECRET = 'correct-secret';
    });

    afterAll(() => {
        process.env.SCORPION_WEBHOOK_SECRET = originalSecret;
    });

    it('rejects requests without the shared secret header', async () => {
        const res = await request(buildApp())
            .post('/api/gitops/sync')
            .send({ app: 'demo' });

        expect(res.statusCode).toBe(401);
        expect(handleArgoCDSync).not.toHaveBeenCalled();
    });

    it('rejects requests with the wrong shared secret', async () => {
        const res = await request(buildApp())
            .post('/api/gitops/sync')
            .set('x-scorpion-secret', 'wrong-secret')
            .send({ app: 'demo' });

        expect(res.statusCode).toBe(401);
        expect(handleArgoCDSync).not.toHaveBeenCalled();
    });

    it('accepts and queues a background sync when the secret matches', async () => {
        const res = await request(buildApp())
            .post('/api/gitops/sync')
            .set('x-scorpion-secret', 'correct-secret')
            .send({ app: 'demo', image: 'demo:latest', revision: 'abc123', repo: 'org/demo', namespace: 'prod' });

        expect(res.statusCode).toBe(202);
        expect(res.body.status).toBe('accepted');
    });
});
