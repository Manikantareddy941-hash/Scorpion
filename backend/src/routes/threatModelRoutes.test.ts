import request from 'supertest';
import express from 'express';

jest.mock('../middleware/auth', () => ({
    verifyUser: (req: any, _res: any, next: any) => {
        req.user = { $id: 'user-1', email: 'user1@example.com' };
        next();
    },
}));
jest.mock('../services/threatModelService', () => ({
    createThreatModel: jest.fn(),
    getThreatModel: jest.fn(),
    listThreatModels: jest.fn(),
    updateThreatModel: jest.fn(),
    deleteThreatModel: jest.fn(),
    updateThreats: jest.fn(),
}));
jest.mock('../services/threatAiService', () => ({
    generateStrideThreats: jest.fn(),
}));

import threatModelRoutes from './threatModelRoutes';
import {
    getThreatModel,
    updateThreatModel,
    deleteThreatModel,
} from '../services/threatModelService';
import { generateStrideThreats } from '../services/threatAiService';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/threat-models', threatModelRoutes);
    return app;
};

describe('threatModelRoutes ownership checks', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET /:id rejects a threat model owned by another user', async () => {
        (getThreatModel as jest.Mock).mockResolvedValue({ $id: 'tm-1', createdBy: 'someone-else' });

        const res = await request(buildApp()).get('/api/threat-models/tm-1');

        expect(res.statusCode).toBe(403);
    });

    it('GET /:id returns the model when the caller is the creator', async () => {
        (getThreatModel as jest.Mock).mockResolvedValue({ $id: 'tm-1', createdBy: 'user-1' });

        const res = await request(buildApp()).get('/api/threat-models/tm-1');

        expect(res.statusCode).toBe(200);
        expect(res.body.$id).toBe('tm-1');
    });

    it('PUT /:id rejects updating a threat model owned by another user', async () => {
        (getThreatModel as jest.Mock).mockResolvedValue({ $id: 'tm-1', createdBy: 'someone-else' });

        const res = await request(buildApp()).put('/api/threat-models/tm-1').send({ name: 'Updated' });

        expect(res.statusCode).toBe(403);
        expect(updateThreatModel).not.toHaveBeenCalled();
    });

    it('DELETE /:id rejects deleting a threat model owned by another user', async () => {
        (getThreatModel as jest.Mock).mockResolvedValue({ $id: 'tm-1', createdBy: 'someone-else' });

        const res = await request(buildApp()).delete('/api/threat-models/tm-1');

        expect(res.statusCode).toBe(403);
        expect(deleteThreatModel).not.toHaveBeenCalled();
    });

    it('POST /:id/analyze rejects analyzing a threat model owned by another user', async () => {
        (getThreatModel as jest.Mock).mockResolvedValue({ $id: 'tm-1', createdBy: 'someone-else' });

        const res = await request(buildApp()).post('/api/threat-models/tm-1/analyze');

        expect(res.statusCode).toBe(403);
        expect(generateStrideThreats).not.toHaveBeenCalled();
    });

    it('GET /:id returns 404 for a nonexistent threat model', async () => {
        (getThreatModel as jest.Mock).mockResolvedValue(null);

        const res = await request(buildApp()).get('/api/threat-models/missing');

        expect(res.statusCode).toBe(404);
    });
});
