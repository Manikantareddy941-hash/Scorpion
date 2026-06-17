import request from 'supertest';
import express from 'express';

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        createDocument: jest.fn(),
        updateDocument: jest.fn(),
        deleteDocument: jest.fn(),
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

import policyRoutes from './policyRoutes';
import { databases } from '../lib/appwrite';

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

    it('PATCH /:id updates the given policy', async () => {
        (databases.updateDocument as jest.Mock).mockResolvedValue({ $id: 'p1', name: 'Updated' });

        const res = await request(buildApp())
            .patch('/api/policies/p1')
            .send({ name: 'Updated' });

        expect(res.statusCode).toBe(200);
        expect(databases.updateDocument).toHaveBeenCalledWith('test-db', 'policies', 'p1', { name: 'Updated' });
    });

    it('DELETE /:id removes the given policy', async () => {
        (databases.deleteDocument as jest.Mock).mockResolvedValue(undefined);

        const res = await request(buildApp()).delete('/api/policies/p1');

        expect(res.statusCode).toBe(200);
        expect(databases.deleteDocument).toHaveBeenCalledWith('test-db', 'policies', 'p1');
    });
});
