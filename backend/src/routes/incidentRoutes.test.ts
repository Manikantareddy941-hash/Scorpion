import request from 'supertest';
import express from 'express';

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        getDocument: jest.fn(),
        deleteDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { INCIDENTS: 'incidents' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        orderDesc: (field: string) => ({ orderDesc: field }),
        limit: (n: number) => ({ limit: n }),
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
    app.use((req: any, _res, next) => {
        req.user = { $id: 'user-1' };
        next();
    });
    app.use('/api/incidents', incidentRoutes);
    return app;
};

describe('incidentRoutes', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET / scopes the list to the authenticated user', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [{ $id: 'inc-1' }] });

        const res = await request(buildApp()).get('/api/incidents');

        expect(res.statusCode).toBe(200);
        expect(databases.listDocuments).toHaveBeenCalledWith('test-db', 'incidents', [
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
});
