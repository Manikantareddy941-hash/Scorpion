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
    COLLECTIONS: { REPOSITORIES: 'repositories', SCANS: 'scans' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        limit: (n: number) => ({ limit: n }),
    },
}));
jest.mock('../services/ingestionService', () => ({
    cleanupWorkspace: jest.fn(),
}));
jest.mock('../queues/scanQueue', () => ({
    enqueueScan: jest.fn(),
}));

import repoRoutes from './repoRoutes';
import { databases } from '../lib/appwrite';
import { cleanupWorkspace } from '../services/ingestionService';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: MockAuthRequest, _res, next) => {
        req.user = { $id: 'user-1', email: 'user1@example.com' };
        next();
    });
    app.use('/api/repos', repoRoutes);
    return app;
};

describe('repoRoutes DELETE /:id', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rejects deleting a repository the caller cannot access at all', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'someone-else' });

        const res = await request(buildApp()).delete('/api/repos/repo-1');

        expect(res.statusCode).toBe(403);
        expect(databases.deleteDocument).not.toHaveBeenCalled();
    });

    it('deletes the repository and cleans up its workspace when the caller owns it', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'user-1', local_path: '/tmp/extract-1' });
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0, documents: [] });
        (databases.deleteDocument as jest.Mock).mockResolvedValue(undefined);

        const res = await request(buildApp()).delete('/api/repos/repo-1');

        expect(res.statusCode).toBe(204);
        expect(databases.deleteDocument).toHaveBeenCalledWith('test-db', 'repositories', 'repo-1');
        expect(cleanupWorkspace).toHaveBeenCalledWith('/tmp/extract-1');
    });

    it('refuses to delete a repository with a scan in progress', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'user-1' });
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 1, documents: [{ $id: 'scan-1' }] });

        const res = await request(buildApp()).delete('/api/repos/repo-1');

        expect(res.statusCode).toBe(409);
        expect(databases.deleteDocument).not.toHaveBeenCalled();
    });
});
