import request from 'supertest';
import express from 'express';

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        createDocument: jest.fn(),
        updateDocument: jest.fn(),
        deleteDocument: jest.fn(),
        getDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    ID: { unique: () => 'generated-id' },
    Query: { equal: (field: string, value: unknown) => ({ field, value }) },
}));
jest.mock('../middleware/auth', () => ({
    verifyUser: (req: any, _res: any, next: any) => {
        req.user = { $id: 'user-1' };
        next();
    },
}));
jest.mock('../services/opaService', () => ({
    evaluatePolicy: jest.fn(),
    isOpaAvailable: jest.fn(),
}));

import policyRoutes from './policyRoutes';
import { databases } from '../lib/appwrite';
import { evaluatePolicy, isOpaAvailable } from '../services/opaService';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/policies', policyRoutes);
    return app;
};

describe('policyRoutes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('GET / scopes the list query to the authenticated user', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [{ $id: 'p1' }] });

        const res = await request(buildApp()).get('/api/policies');

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual([{ $id: 'p1' }]);
        expect(databases.listDocuments).toHaveBeenCalledWith('test-db', 'policies', [
            { field: 'userId', value: 'user-1' },
        ]);
    });

    it('GET / returns 500 if the database call fails', async () => {
        (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('boom'));

        const res = await request(buildApp()).get('/api/policies');

        expect(res.statusCode).toBe(500);
    });

    it('POST / stamps the policy with the authenticated userId', async () => {
        (databases.createDocument as jest.Mock).mockImplementation((_db, _col, _id, data) =>
            Promise.resolve({ $id: 'generated-id', ...data })
        );

        const res = await request(buildApp())
            .post('/api/policies')
            .send({ name: 'No critical CVEs' });

        expect(res.statusCode).toBe(200);
        expect(res.body.userId).toBe('user-1');
        expect(res.body.name).toBe('No critical CVEs');
        expect(databases.createDocument).toHaveBeenCalledWith(
            'test-db',
            'policies',
            'generated-id',
            expect.objectContaining({ name: 'No critical CVEs', userId: 'user-1' })
        );
    });

    it('PATCH /:id updates the given policy when the caller owns it', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'p1', userId: 'user-1' });
        (databases.updateDocument as jest.Mock).mockResolvedValue({ $id: 'p1', name: 'Updated' });

        const res = await request(buildApp())
            .patch('/api/policies/p1')
            .send({ name: 'Updated' });

        expect(res.statusCode).toBe(200);
        expect(databases.updateDocument).toHaveBeenCalledWith('test-db', 'policies', 'p1', { name: 'Updated' });
    });

    it('PATCH /:id rejects updates to a policy owned by another user', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'p1', userId: 'someone-else' });

        const res = await request(buildApp())
            .patch('/api/policies/p1')
            .send({ name: 'Updated' });

        expect(res.statusCode).toBe(403);
        expect(databases.updateDocument).not.toHaveBeenCalled();
    });

    it('PATCH /:id ignores attempts to reassign ownership via the request body', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'p1', userId: 'user-1' });
        (databases.updateDocument as jest.Mock).mockResolvedValue({ $id: 'p1', name: 'Updated' });

        await request(buildApp())
            .patch('/api/policies/p1')
            .send({ name: 'Updated', userId: 'someone-else' });

        expect(databases.updateDocument).toHaveBeenCalledWith('test-db', 'policies', 'p1', { name: 'Updated' });
    });

    it('DELETE /:id removes the given policy when the caller owns it', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'p1', userId: 'user-1' });
        (databases.deleteDocument as jest.Mock).mockResolvedValue(undefined);

        const res = await request(buildApp()).delete('/api/policies/p1');

        expect(res.statusCode).toBe(200);
        expect(databases.deleteDocument).toHaveBeenCalledWith('test-db', 'policies', 'p1');
    });

    it('DELETE /:id rejects deleting a policy owned by another user', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'p1', userId: 'someone-else' });

        const res = await request(buildApp()).delete('/api/policies/p1');

        expect(res.statusCode).toBe(403);
        expect(databases.deleteDocument).not.toHaveBeenCalled();
    });
});

describe('policyRoutes OPA endpoints', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET /opa/status reports whether the opa CLI is available', async () => {
        (isOpaAvailable as jest.Mock).mockResolvedValue(false);

        const res = await request(buildApp()).get('/api/policies/opa/status');

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ available: false });
    });

    it('POST /:id/evaluate rejects evaluating a policy owned by another user', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'p1', userId: 'someone-else' });

        const res = await request(buildApp())
            .post('/api/policies/p1/evaluate')
            .send({ input: { critical_count: 1 } });

        expect(res.statusCode).toBe(403);
        expect(evaluatePolicy).not.toHaveBeenCalled();
    });

    it('POST /:id/evaluate runs the policy\'s regoCode against the given input', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'p1', userId: 'user-1', regoCode: 'package scorpion.gate' });
        (evaluatePolicy as jest.Mock).mockResolvedValue({ allow: false, denyReasons: ['1 critical finding(s) present'] });

        const res = await request(buildApp())
            .post('/api/policies/p1/evaluate')
            .send({ input: { critical_count: 1 } });

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ allow: false, denyReasons: ['1 critical finding(s) present'] });
        expect(evaluatePolicy).toHaveBeenCalledWith(
            { critical_count: 1 },
            { regoCode: 'package scorpion.gate', query: undefined }
        );
    });

    it('POST /:id/evaluate returns 502 when OPA isn\'t installed', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'p1', userId: 'user-1' });
        (evaluatePolicy as jest.Mock).mockRejectedValue(new Error('OPA is not installed on this host.'));

        const res = await request(buildApp())
            .post('/api/policies/p1/evaluate')
            .send({ input: { critical_count: 1 } });

        expect(res.statusCode).toBe(502);
    });

    it('POST /:id/evaluate rejects a request missing input', async () => {
        const res = await request(buildApp()).post('/api/policies/p1/evaluate').send({});

        expect(res.statusCode).toBe(400);
        expect(evaluatePolicy).not.toHaveBeenCalled();
    });
});
