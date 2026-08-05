jest.mock('../services/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { logger } from '../services/logger';
import { anchorLedgerTip, AUDIT_ANCHOR_EVENT } from './auditAnchor';

const mockInfo = logger.info as jest.Mock;
const mockError = logger.error as jest.Mock;

const tip = {
    recordId: 'doc-1',
    tamperHash: 'a'.repeat(64),
    action: 'BREAK_GLASS_BYPASS',
    timestamp: '2026-08-04T10:00:00.000Z',
};

describe('anchorLedgerTip', () => {
    beforeEach(() => jest.clearAllMocks());

    it('emits the hash, record id, action and ledger timestamp', () => {
        anchorLedgerTip(tip);

        expect(mockInfo).toHaveBeenCalledTimes(1);
        const payload = mockInfo.mock.calls[0][1];
        expect(payload).toMatchObject({
            event: AUDIT_ANCHOR_EVENT,
            recordId: 'doc-1',
            tamperHash: 'a'.repeat(64),
            action: 'BREAK_GLASS_BYPASS',
            timestamp: '2026-08-04T10:00:00.000Z',
        });
    });

    it('tags a dedicated Loki stream so anchors are queryable without scanning app logs', () => {
        anchorLedgerTip(tip);
        expect(mockInfo.mock.calls[0][1].labels).toEqual({ stream: 'audit_anchor' });
    });

    it('carries the ledger timestamp, not the time of logging', () => {
        // The anchor has to describe the row. Using Date.now() here would make an
        // anchor unreconcilable with its ledger entry the moment the two clocks or
        // the write latency diverge, which reads as tampering.
        anchorLedgerTip(tip);
        expect(mockInfo.mock.calls[0][1].timestamp).toBe(tip.timestamp);
    });

    it('omits sequence entirely when absent, rather than emitting a placeholder', () => {
        // A verifier must be able to tell "this anchor predates sequence numbers"
        // from "this entry claims position 0". null or 0 would conflate them.
        anchorLedgerTip(tip);
        expect(mockInfo.mock.calls[0][1]).not.toHaveProperty('sequence');
    });

    it('includes sequence when supplied', () => {
        anchorLedgerTip({ ...tip, sequence: 42 });
        expect(mockInfo.mock.calls[0][1].sequence).toBe(42);
    });

    it('NEVER throws when the logger fails — the ledger row is already durable', () => {
        mockInfo.mockImplementation(() => { throw new Error('loki unreachable'); });

        // The audit write has already committed by the time this runs. Throwing
        // here would corrupt the caller's control flow over a best-effort copy,
        // and there is nothing left to fail closed about.
        expect(() => anchorLedgerTip(tip)).not.toThrow();
    });

    it('reports degraded detection when the anchor cannot be emitted', () => {
        mockInfo.mockImplementation(() => { throw new Error('loki unreachable'); });

        anchorLedgerTip(tip);

        expect(mockError).toHaveBeenCalled();
        expect(mockError.mock.calls[0][0]).toMatch(/tamper detection degraded/);
    });

    it('survives the logger failing on BOTH paths', () => {
        mockInfo.mockImplementation(() => { throw new Error('loki unreachable'); });
        mockError.mockImplementation(() => { throw new Error('console gone too'); });

        expect(() => anchorLedgerTip(tip)).not.toThrow();
    });
});
