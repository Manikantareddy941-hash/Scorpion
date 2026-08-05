jest.mock('../lib/appwrite', () => ({
    databases: {
        getCollection: jest.fn().mockResolvedValue({}),
        createCollection: jest.fn(),
        createStringAttribute: jest.fn(),
        createIntegerAttribute: jest.fn().mockRejectedValue({ code: 409, message: 'attribute already exists' }),
        listDocuments: jest.fn(),
        createDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    ID: { unique: () => 'doc-1' },
    Query: { orderDesc: (f: string) => ({ orderDesc: f }), limit: (n: number) => ({ limit: n }) },
}));
jest.mock('../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { databases } from '../lib/appwrite';
import { anchorLedgerTip } from './auditAnchor';
import {
    logSecureAuditEvent,
    AuditWriteFailedError,
    ensureSequenceAttribute,
    __resetSequenceAttributeMemo,
} from './tamperAuditLogger';

jest.mock('./auditAnchor', () => ({ anchorLedgerTip: jest.fn() }));

const mockList = databases.listDocuments as jest.Mock;
const mockCreate = databases.createDocument as jest.Mock;
const mockIntAttr = databases.createIntegerAttribute as jest.Mock;
const mockAnchor = anchorLedgerTip as jest.Mock;

const chainReadOk = () => mockList.mockResolvedValue({ total: 0, documents: [] });
/** Previous ledger row at a given position, for continuation tests. */
const tipAt = (sequence: number | undefined, tamper_hash = 'prevhash') =>
    mockList.mockResolvedValue({ total: 1, documents: [{ tamper_hash, sequence }] });

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

describe('sequence numbers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        __resetSequenceAttributeMemo();
        mockIntAttr.mockRejectedValue({ code: 409, message: 'attribute already exists' });
        mockCreate.mockResolvedValue({ $id: 'doc-1' });
    });

    it('starts at 0 on an empty ledger', async () => {
        chainReadOk();
        await logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'x');
        expect(mockCreate.mock.calls[0][3].sequence).toBe(0);
    });

    it('continues from the previous entry', async () => {
        tipAt(41);
        await logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'x');
        expect(mockCreate.mock.calls[0][3].sequence).toBe(42);
    });

    it('restarts at 0 after a legacy row that has no sequence', async () => {
        // Rows written before the migration carry no position. Starting at 0 marks
        // the boundary explicitly; the verifier reads a mid-chain 0 as "this is
        // where sequencing began", not as a gap. Back-filling the old rows would
        // mean rewriting an append-only ledger.
        tipAt(undefined);
        await logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'x');
        expect(mockCreate.mock.calls[0][3].sequence).toBe(0);
    });

    it('binds the sequence INTO the hash, so a row cannot be renumbered silently', async () => {
        tipAt(7);
        await logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'payload');
        const hashAt8 = mockCreate.mock.calls[0][3].tamper_hash;

        jest.clearAllMocks();
        mockCreate.mockResolvedValue({ $id: 'doc-2' });
        tipAt(8);
        await logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'payload');
        const hashAt9 = mockCreate.mock.calls[0][3].tamper_hash;

        // Same actor, action, repo and details; only the position differs. If
        // sequence were outside the hash these would collide and an attacker
        // holding APPWRITE_API_KEY could renumber rows freely.
        expect(hashAt8).not.toBe(hashAt9);
    });

    it('lets two concurrent writers both claim the next position (fork is detected, not prevented)', async () => {
        // Both read tip 5 and both write 6. No lock: serialising every append would
        // put break-glass behind a service that may itself be down. The duplicate
        // position is the signal the verifier looks for.
        tipAt(5);
        await Promise.all([
            logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'a'),
            logSecureAuditEvent('u2', 'ALARM_CLEAR', 'system', 'b'),
        ]);
        expect(mockCreate.mock.calls.map(c => c[3].sequence)).toEqual([6, 6]);
    });

    it('anchors the sequence off-box alongside the hash', async () => {
        tipAt(11);
        await logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'x');
        expect(mockAnchor).toHaveBeenCalledWith(expect.objectContaining({ sequence: 12, recordId: 'doc-1' }));
    });

    it('does not anchor when the ledger write failed', async () => {
        chainReadOk();
        mockCreate.mockRejectedValue(new Error('appwrite down'));
        await logSecureAuditEvent('u1', 'ALARM_CLEAR', 'system', 'x');
        // An anchor for a row that never persisted is a phantom the verifier
        // cannot reconcile — a false tamper signal.
        expect(mockAnchor).not.toHaveBeenCalled();
    });
});

describe('ensureSequenceAttribute', () => {
    beforeEach(() => { jest.clearAllMocks(); __resetSequenceAttributeMemo(); });

    it('treats "already exists" as success and stops retrying', async () => {
        mockIntAttr.mockRejectedValue({ code: 409, message: 'attribute already exists' });
        await ensureSequenceAttribute();
        await ensureSequenceAttribute();
        expect(mockIntAttr).toHaveBeenCalledTimes(1);
    });

    it('does NOT memoise a transient failure, so the next write retries', async () => {
        // Latching a failure would disable sequencing for the process lifetime off
        // one bad round trip — the negative-caching bug removed from toolCheck.
        mockIntAttr.mockRejectedValue({ code: 500, message: 'appwrite unavailable' });
        await ensureSequenceAttribute();
        await ensureSequenceAttribute();
        expect(mockIntAttr).toHaveBeenCalledTimes(2);
    });

    it('creates the attribute as optional, never required', async () => {
        // A required attribute would reject every legacy row on read-modify paths
        // and force a back-fill of an append-only ledger.
        mockIntAttr.mockResolvedValue({});
        await ensureSequenceAttribute();
        expect(mockIntAttr).toHaveBeenCalledWith('test-db', 'audit_logs_v2', 'sequence', false);
    });
});
