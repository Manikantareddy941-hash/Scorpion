import request from 'supertest';
import express, { Request } from 'express';

type MockAuthRequest = Request & { user?: { $id: string; email?: string } };

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        getDocument: jest.fn(),
        deleteDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { INCIDENTS: 'incidents', REPOSITORIES: 'repositories' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        orderDesc: (field: string) => ({ orderDesc: field }),
        limit: (n: number) => ({ limit: n }),
        or: (queries: unknown[]) => ({ or: queries }),
    },
}));
jest.mock('../services/incidentService', () => ({
    updateIncidentStatus: jest.fn(),
}));

import incidentRoutes from './incidentRoutes';
import { databases } from '../lib/appwrite';
import { updateIncidentStatus } from '../services/incidentService';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: MockAuthRequest, _res, next) => {
        req.user = { $id: 'user-1' };
        next();
    });
    app.use('/api/incidents', incidentRoutes);
    return app;
};

describe('incidentRoutes', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET / returns repo-scoped and tenant-scoped incidents (union owner)', async () => {
        (databases.listDocuments as jest.Mock)
            .mockResolvedValueOnce({ documents: [{ $id: 'repo-1' }, { $id: 'repo-2' }] }) // caller's repos
            .mockResolvedValueOnce({ documents: [{ $id: 'inc-1' }] });                    // incidents

        const res = await request(buildApp()).get('/api/incidents');

        expect(res.statusCode).toBe(200);
        // 1) the caller's repositories are resolved by ownership scope
        expect(databases.listDocuments).toHaveBeenNthCalledWith(1, 'test-db', 'repositories', [
            { equal: ['user_id', 'user-1'] },
            { limit: 500 },
        ]);
        // 2) incidents filtered by (repo_id IN my repos) OR (user_id == me)
        expect(databases.listDocuments).toHaveBeenNthCalledWith(2, 'test-db', 'incidents', [
            { or: [{ equal: ['repo_id', ['repo-1', 'repo-2']] }, { equal: ['user_id', 'user-1'] }] },
            { orderDesc: '$createdAt' },
            { limit: 100 },
        ]);
    });

    it('GET / falls back to user-only scope when the caller owns no repos', async () => {
        (databases.listDocuments as jest.Mock)
            .mockResolvedValueOnce({ documents: [] })                  // no repos
            .mockResolvedValueOnce({ documents: [{ $id: 'inc-1' }] }); // tenant-scoped incidents

        const res = await request(buildApp()).get('/api/incidents');

        expect(res.statusCode).toBe(200);
        expect(databases.listDocuments).toHaveBeenNthCalledWith(2, 'test-db', 'incidents', [
            { equal: ['user_id', 'user-1'] },
            { orderDesc: '$createdAt' },
            { limit: 100 },
        ]);
    });

    it('PATCH /:id/status updates the incident when the caller owns it', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'inc-1', user_id: 'user-1' });
        (updateIncidentStatus as jest.Mock).mockResolvedValue({ $id: 'inc-1', status: 'resolved' });

        const res = await request(buildApp())
            .patch('/api/incidents/inc-1/status')
            .send({ status: 'resolved' });

        expect(res.statusCode).toBe(200);
        expect(updateIncidentStatus).toHaveBeenCalledWith('inc-1', 'resolved', undefined);
    });

    it('PATCH /:id/status rejects an incident owned by another user', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'inc-1', user_id: 'someone-else' });

        const res = await request(buildApp())
            .patch('/api/incidents/inc-1/status')
            .send({ status: 'resolved' });

        expect(res.statusCode).toBe(403);
        expect(updateIncidentStatus).not.toHaveBeenCalled();
    });

    it('DELETE /:id removes the incident when the caller owns it', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'inc-1', user_id: 'user-1' });
        (databases.deleteDocument as jest.Mock).mockResolvedValue(undefined);

        const res = await request(buildApp()).delete('/api/incidents/inc-1');

        expect(res.statusCode).toBe(200);
        expect(databases.deleteDocument).toHaveBeenCalledWith('test-db', 'incidents', 'inc-1');
    });

    it('DELETE /:id rejects deleting an incident owned by another user', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'inc-1', user_id: 'someone-else' });

        const res = await request(buildApp()).delete('/api/incidents/inc-1');

        expect(res.statusCode).toBe(403);
        expect(databases.deleteDocument).not.toHaveBeenCalled();
    });

    it('PATCH /:id/status grants access to a repo member on a repo-scoped incident', async () => {
        (databases.getDocument as jest.Mock).mockImplementation((_db: string, col: string, id: string) =>
            col === 'incidents'
                ? Promise.resolve({ $id: id, repo_id: 'repo-1' }) // no user_id — repo-owned
                : Promise.resolve({ $id: 'repo-1', user_id: 'user-1' }), // caller owns the repo
        );
        (updateIncidentStatus as jest.Mock).mockResolvedValue({ $id: 'inc-1', status: 'resolved' });

        const res = await request(buildApp())
            .patch('/api/incidents/inc-1/status')
            .send({ status: 'resolved' });

        expect(res.statusCode).toBe(200);
        expect(updateIncidentStatus).toHaveBeenCalledWith('inc-1', 'resolved', undefined);
    });

    it('PATCH /:id/status rejects a repo-scoped incident the caller cannot access', async () => {
        (databases.getDocument as jest.Mock).mockImplementation((_db: string, col: string, id: string) =>
            col === 'incidents'
                ? Promise.resolve({ $id: id, repo_id: 'repo-9' })
                : Promise.resolve({ $id: 'repo-9', user_id: 'someone-else' }), // caller is not the owner, no team
        );

        const res = await request(buildApp())
            .patch('/api/incidents/inc-1/status')
            .send({ status: 'resolved' });

        expect(res.statusCode).toBe(403);
        expect(updateIncidentStatus).not.toHaveBeenCalled();
    });
});
