import request from 'supertest';
import express, { Request } from 'express';

type MockAuthRequest = Request & { user?: { $id: string; email?: string } };

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        createDocument: jest.fn(),
        getDocument: jest.fn(),
        deleteDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { API_KEYS: 'api_keys' },
    ID: { unique: () => 'generated-id' },
    Query: { equal: (field: string, value: unknown) => ({ field, value }), orderDesc: (field: string) => ({ orderDesc: field }) },
}));

import keyRoutes from './keyRoutes';
import { databases } from '../lib/appwrite';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: MockAuthRequest, _res, next) => {
        req.user = { $id: 'user-1' };
        next();
    });
    app.use('/api/keys', keyRoutes);
    return app;
};

describe('keyRoutes DELETE /:id', () => {
    beforeEach(() => jest.clearAllMocks());

    it('revokes the key when the caller owns it', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'key-1', user_id: 'user-1' });
        (databases.deleteDocument as jest.Mock).mockResolvedValue(undefined);

        const res = await request(buildApp()).delete('/api/keys/key-1');

        expect(res.statusCode).toBe(200);
        expect(databases.deleteDocument).toHaveBeenCalledWith('test-db', 'api_keys', 'key-1');
    });

    it('rejects revoking a key owned by another user', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'key-1', user_id: 'someone-else' });

        const res = await request(buildApp()).delete('/api/keys/key-1');

        expect(res.statusCode).toBe(403);
        expect(databases.deleteDocument).not.toHaveBeenCalled();
    });
});

describe('keyRoutes GET /', () => {
    beforeEach(() => jest.clearAllMocks());

    it('scopes the list query to the authenticated user', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [{ $id: 'key-1' }] });

        const res = await request(buildApp()).get('/api/keys');

        expect(res.statusCode).toBe(200);
        expect(databases.listDocuments).toHaveBeenCalledWith('test-db', 'api_keys', [
            { field: 'user_id', value: 'user-1' },
            { orderDesc: '$createdAt' },
        ]);
    });
});

describe('keyRoutes POST /', () => {
    beforeEach(() => jest.clearAllMocks());

    it('stamps the new key with the authenticated user and returns the raw key once', async () => {
        (databases.createDocument as jest.Mock).mockImplementation((_db, _col, _id, data) =>
            Promise.resolve({ $id: 'generated-id', ...data })
        );

        const res = await request(buildApp()).post('/api/keys').send({ name: 'CI Key' });

        expect(res.statusCode).toBe(200);
        expect(res.body.user_id).toBe('user-1');
        expect(res.body.api_key).toMatch(/^sp_/);
        expect(databases.createDocument).toHaveBeenCalledWith(
            'test-db',
            'api_keys',
            expect.any(String),
            expect.objectContaining({ user_id: 'user-1', name: 'CI Key' })
        );
    });

    it('rejects a missing key name', async () => {
        const res = await request(buildApp()).post('/api/keys').send({});
        expect(res.statusCode).toBe(400);
    });
});
