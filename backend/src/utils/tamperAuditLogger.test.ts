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
jest.mock('../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { databases } from '../lib/appwrite';
import { logSecureAuditEvent, AuditWriteFailedError } from './tamperAuditLogger';

const mockList = databases.listDocuments as jest.Mock;
const mockCreate = databases.createDocument as jest.Mock;

const chainReadOk = () => mockList.mockResolvedValue({ total: 0, documents: [] });

/**
 * These exist because the previous version of this module contained no `throw` at
 * all. That made every caller's error handling unreachable: deployService's
 * `.catch()` and the terminal's `try/catch` were guarding a promise that could not
 * reject, and the terminal's instruction to "make this fail-closed when a mutating
 * verb is added" was not achievable by editing the caller.
 *
 * If someone later reinstates a blanket catch here, the `required` tests below are
 * what fails. Do not "fix" them by removing the flag.
 */
describe('logSecureAuditEvent failure semantics', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('default (best-effort) — unchanged behaviour for observability events', () => {
        it('resolves rather than throwing when the ledger write fails', async () => {
            chainReadOk();
            mockCreate.mockRejectedValue(new Error('appwrite down'));

            await expect(logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'x')).resolves.toBeUndefined();
        });

        it('resolves when the previous block cannot be read, falling back to genesis', async () => {
            mockList.mockRejectedValue(new Error('read failed'));
            mockCreate.mockResolvedValue({ $id: 'doc-1' });

            await expect(logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'x')).resolves.toBeDefined();
        });
    });

    describe('required: true — security decisions that grant', () => {
        it('THROWS when the ledger write fails', async () => {
            chainReadOk();
            mockCreate.mockRejectedValue(new Error('appwrite down'));

            await expect(
                logSecureAuditEvent('u1', 'BREAK_GLASS_BYPASS', 'r1', 'x', { required: true }),
            ).rejects.toThrow(AuditWriteFailedError);
        });

        it('THROWS when the previous block cannot be read, instead of chaining to genesis', async () => {
            // Writing a block chained to genesis forks the ledger, and a fork is
            // indistinguishable from tampering to anything verifying it later. A
            // required event that cannot be chained has not been recorded.
            mockList.mockRejectedValue(new Error('read failed'));
            mockCreate.mockResolvedValue({ $id: 'doc-1' });

            await expect(
                logSecureAuditEvent('u1', 'BREAK_GLASS_BYPASS', 'r1', 'x', { required: true }),
            ).rejects.toThrow(/could not read the previous ledger block/);
            expect(mockCreate).not.toHaveBeenCalled();
        });

        it('carries the action name so an operator knows what went unrecorded', async () => {
            chainReadOk();
            mockCreate.mockRejectedValue(new Error('appwrite down'));

            await expect(
                logSecureAuditEvent('u1', 'BREAK_GLASS_BYPASS', 'r1', 'x', { required: true }),
            ).rejects.toThrow(/BREAK_GLASS_BYPASS/);
        });

        it('still resolves normally on the happy path', async () => {
            chainReadOk();
            mockCreate.mockResolvedValue({ $id: 'doc-1' });

            await expect(
                logSecureAuditEvent('u1', 'BREAK_GLASS_BYPASS', 'r1', 'x', { required: true }),
            ).resolves.toBeDefined();
        });
    });
});
