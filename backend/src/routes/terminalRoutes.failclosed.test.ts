/**
 * Fail-closed proof for the terminal, run against the REAL tamperAuditLogger.
 *
 * terminalRoutes.test.ts mocks logSecureAuditEvent with mockRejectedValue. That
 * proves the route reacts correctly to a rejecting audit call, and nothing more.
 * When the fail-closed path first shipped, the real logSecureAuditEvent caught
 * everything internally and resolved, so the mock rejected where production never
 * would: the tests were green and the guard was dead code. The mock defined away
 * the exact behaviour under test.
 *
 * Here the only thing stubbed is the Appwrite client — the boundary the audit
 * writer talks to. logSecureAuditEvent itself runs for real, so a regression that
 * reinstates a blanket catch inside it fails these tests rather than passing them.
 */
jest.mock('../lib/appwrite', () => ({
    databases: {
        getCollection: jest.fn().mockResolvedValue({}),
        createCollection: jest.fn(),
        createStringAttribute: jest.fn(),
        listDocuments: jest.fn(),
        createDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    ID: { unique: () => 'doc-1' },
    Query: { orderDesc: (f: string) => ({ orderDesc: f }), limit: (n: number) => ({ limit: n }) },
}));
jest.mock('../middleware/requireRole', () => ({ resolveRole: jest.fn() }));
jest.mock('../middleware/rateLimiters', () => ({
    terminalLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// Deliberately NOT mocked: ../utils/tamperAuditLogger

import express from 'express';
import request from 'supertest';
import terminalRoutes from './terminalRoutes';
import { databases } from '../lib/appwrite';
import { resolveRole } from '../middleware/requireRole';
import { register, __resetRegistryForTests } from '../services/terminal/commands';
import { registerBuiltins, __resetBuiltinsForTests } from '../services/terminal/builtins';

const mockList = databases.listDocuments as jest.Mock;
const mockCreate = databases.createDocument as jest.Mock;
const mockRole = resolveRole as jest.Mock;

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        (req as { user?: unknown }).user = { $id: 'u1', email: 'op@scorpion.local' };
        next();
    });
    app.use('/api/terminal', terminalRoutes);
    return app;
}

/** Ledger chain reads fine; only the write is under test. */
const chainReadOk = () => mockList.mockResolvedValue({ total: 0, documents: [] });

beforeEach(() => {
    jest.clearAllMocks();
    __resetRegistryForTests();
    __resetBuiltinsForTests();
    registerBuiltins();
    mockRole.mockResolvedValue('admin');
    (databases.getCollection as jest.Mock).mockResolvedValue({});
});

describe('mutating verb, real audit writer', () => {
    it('returns 503 and never runs the handler when the ledger write genuinely fails', async () => {
        chainReadOk();
        mockCreate.mockRejectedValue(new Error('appwrite down'));
        const handler = jest.fn().mockResolvedValue(['done']);
        register({ name: 'change', summary: 's', usage: 'change', mutating: true, handler });

        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'change' });

        expect(res.status).toBe(503);
        // The property the mocked suite could not actually establish.
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 503 when the previous ledger block cannot be read', async () => {
        // A required event that cannot be chained has not been recorded; writing it
        // against genesis would fork the ledger.
        mockList.mockRejectedValue(new Error('read failed'));
        mockCreate.mockResolvedValue({ $id: 'doc-1' });
        const handler = jest.fn().mockResolvedValue(['done']);
        register({ name: 'change', summary: 's', usage: 'change', mutating: true, handler });

        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'change' });

        expect(res.status).toBe(503);
        expect(handler).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('runs normally when the ledger is healthy', async () => {
        chainReadOk();
        mockCreate.mockResolvedValue({ $id: 'doc-1' });
        const handler = jest.fn().mockResolvedValue(['done']);
        register({ name: 'change', summary: 's', usage: 'change', mutating: true, handler });

        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'change' });

        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalled();
    });
});

describe('read-only verb, real audit writer', () => {
    it('still succeeds when the ledger write fails — fail-open is intentional here', async () => {
        chainReadOk();
        mockCreate.mockRejectedValue(new Error('appwrite down'));

        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'whoami' });

        // Safe only because a mutating verb can no longer reach its handler on the
        // same failure. If that ever regresses, the tests above fail first.
        expect(res.status).toBe(200);
    });
});
