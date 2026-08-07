// Both are constructed at import time and would open Redis connections: the
// Worker in this module, the Queue in ../queues/auditQueue that it imports.
jest.mock('bullmq', () => ({
    Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
    Queue: jest.fn().mockImplementation(() => ({ upsertJobScheduler: jest.fn() })),
}));
jest.mock('../queues/redisConnection', () => ({ redisConnection: {} }));
jest.mock('../utils/auditVerifier', () => ({ verifyAuditTail: jest.fn() }));
jest.mock('../utils/auditAnchorVerifier', () => ({ verifyAnchorIntegrity: jest.fn() }));
// isTamperSuspected stays REAL: it decides the verdict these tests assert on, and
// a mocked predicate would be the test agreeing with itself.
jest.mock('../utils/auditOrchestrator', () => ({
    ...jest.requireActual('../utils/auditOrchestrator'),
    runFullAuditVerification: jest.fn(),
}));
jest.mock('../utils/systemAlert', () => ({ sendSystemAlert: jest.fn() }));
jest.mock('../services/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { Job } from 'bullmq';
import { processAuditVerification } from './auditVerifyWorker';
import { verifyAuditTail } from '../utils/auditVerifier';
import { verifyAnchorIntegrity } from '../utils/auditAnchorVerifier';
import { runFullAuditVerification } from '../utils/auditOrchestrator';
import { sendSystemAlert } from '../utils/systemAlert';
import { logger } from '../services/logger';
import type { AuditVerifyJobData } from '../queues/auditQueue';

const mockTail = verifyAuditTail as jest.Mock;
const mockAnchorCheck = verifyAnchorIntegrity as jest.Mock;
const mockFull = runFullAuditVerification as jest.Mock;
const mockAlert = sendSystemAlert as jest.Mock;
const mockError = logger.error as jest.Mock;

const job = (tier: 'tail' | 'full') => ({ data: { tier } }) as Job<AuditVerifyJobData>;

const cleanTail = {
    scope: 'tail', rowsChecked: 1000, windowFrom: 1, latestSequence: 1000,
    legacyRows: 0, errors: [], samples: [],
};
const matchedAnchors = { status: 'MATCH', verified: true, lokiConfigured: true, checked: 5, checks: [] };

const titles = () => mockAlert.mock.calls.map((c) => c[0].title);
const levels = () => mockAlert.mock.calls.map((c) => c[0].level);

const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = originalEnv;
    mockAlert.mockResolvedValue(1);
    mockTail.mockResolvedValue(cleanTail);
    mockAnchorCheck.mockResolvedValue(matchedAnchors);
    mockFull.mockResolvedValue({
        db: { isValid: true, rowsChecked: 50_000, latestSequence: 49_999, legacyRows: 0, errors: [], samples: [] },
        anchor: matchedAnchors,
        timestamp: '2026-08-06T02:00:00.000Z',
    });
});
afterAll(() => { process.env.NODE_ENV = originalEnv; });

describe('tier routing', () => {
    it('runs the bounded tail walk for a tail job, never the full one', async () => {
        await processAuditVerification(job('tail'));

        expect(mockTail).toHaveBeenCalled();
        expect(mockFull).not.toHaveBeenCalled();
    });

    it('runs the full walk for a full job, never the tail', async () => {
        await processAuditVerification(job('full'));

        expect(mockFull).toHaveBeenCalled();
        expect(mockTail).not.toHaveBeenCalled();
    });
});

describe('a clean ledger', () => {
    it('alerts nobody', async () => {
        await processAuditVerification(job('tail'));
        await processAuditVerification(job('full'));

        expect(mockAlert).not.toHaveBeenCalled();
    });
});

describe('tamper evidence', () => {
    it('raises CRITICAL when the tail window has chain errors', async () => {
        mockTail.mockResolvedValue({
            ...cleanTail,
            errors: [{ kind: 'BROKEN_LINK', recordId: 'rec-900', sequence: 900, detail: 'edited' }],
        });

        await processAuditVerification(job('tail'));

        expect(levels()).toEqual(['CRITICAL']);
        expect(titles()).toEqual(['Audit Ledger Tamper Evidence']);
        expect(mockAlert.mock.calls[0][0].message).toContain('BROKEN_LINK at seq 900');
    });

    it('fires on an anchor mismatch even when the chain itself verifies', async () => {
        // The attack the anchors exist for: rewrite the ledger, recompute forward,
        // and the walk reports no errors at all.
        mockAnchorCheck.mockResolvedValue({ ...matchedAnchors, status: 'ANCHOR_MISMATCH', verified: false });

        await processAuditVerification(job('tail'));

        expect(levels()).toEqual(['CRITICAL']);
    });

    it('fires on the full walk when the real isTamperSuspected says so', async () => {
        mockFull.mockResolvedValue({
            db: {
                isValid: false, rowsChecked: 10, latestSequence: 9, legacyRows: 0,
                errors: [{ kind: 'GAP', recordId: 'r', sequence: 4, detail: 'missing' }], samples: [],
            },
            anchor: matchedAnchors,
            timestamp: 't',
        });

        await processAuditVerification(job('full'));

        expect(levels()).toEqual(['CRITICAL']);
        expect(mockAlert.mock.calls[0][0].details.scope).toBe('full');
    });

    it('says plainly that a clean tail does not clear older history', async () => {
        mockTail.mockResolvedValue({
            ...cleanTail,
            errors: [{ kind: 'BROKEN_LINK', recordId: 'r', sequence: 1, detail: 'x' }],
        });

        await processAuditVerification(job('tail'));

        expect(mockAlert.mock.calls[0][0].message).toMatch(/cannot rule out older tampering/);
    });

    it('bounds the details payload so a broken ledger cannot flood a pager', async () => {
        const many = Array.from({ length: 100 }, (_, i) => ({
            kind: 'BROKEN_LINK', recordId: `r${i}`, sequence: i, detail: 'x',
        }));
        mockTail.mockResolvedValue({ ...cleanTail, errors: many });

        await processAuditVerification(job('tail'));

        expect(mockAlert.mock.calls[0][0].details.errors).toHaveLength(20);
    });
});

describe('anchor gap', () => {
    it('warns when the anchor store is configured but unreachable', async () => {
        // Unreachable Loki still produces one check per sample — that populated
        // list is what distinguishes an outage from having nothing to check.
        mockAnchorCheck.mockResolvedValue({
            status: 'ANCHOR_UNAVAILABLE', verified: false, lokiConfigured: true, checked: 0,
            checks: [
                { status: 'ANCHOR_UNAVAILABLE', sequence: 998, recordId: 'r1', dbHash: 'a', detail: 'Loki query failed' },
                { status: 'ANCHOR_UNAVAILABLE', sequence: 999, recordId: 'r2', dbHash: 'b', detail: 'Loki query failed' },
            ],
        });

        await processAuditVerification(job('tail'));

        expect(levels()).toEqual(['WARN']);
        expect(titles()).toEqual(['Audit Anchor Store Unreachable']);
    });

    it('stays silent when there were simply no sequenced rows to check', async () => {
        // A fresh install, or a ledger still entirely pre-sequencing, yields
        // ANCHOR_UNAVAILABLE with lokiConfigured true and an EMPTY checks list.
        // Nothing is wrong. Alerting here would page every 15 minutes on a
        // brand-new deployment about a Loki that is answering perfectly.
        mockAnchorCheck.mockResolvedValue({
            status: 'ANCHOR_UNAVAILABLE', verified: false, lokiConfigured: true, checked: 0, checks: [],
        });

        await processAuditVerification(job('tail'));

        expect(mockAlert).not.toHaveBeenCalled();
    });

    it('stays silent outside production when no anchor store is configured', async () => {
        // Expected on a dev box. Paging here teaches the rota to mute the channel.
        process.env.NODE_ENV = 'development';
        mockAnchorCheck.mockResolvedValue({
            status: 'ANCHOR_UNAVAILABLE', verified: false, lokiConfigured: false, checked: 0, checks: [],
        });

        await processAuditVerification(job('tail'));

        expect(mockAlert).not.toHaveBeenCalled();
    });

    it('warns IN production when no anchor store is configured', async () => {
        // Worse than unreachable: the cross-check has never run and never will,
        // so the ledger has only ever been checked against itself.
        process.env.NODE_ENV = 'production';
        mockAnchorCheck.mockResolvedValue({
            status: 'ANCHOR_UNAVAILABLE', verified: false, lokiConfigured: false, checked: 0, checks: [],
        });

        await processAuditVerification(job('tail'));

        expect(titles()).toEqual(['Audit Anchor Store Not Configured']);
    });

    it('does not treat a missing anchor as an outage', async () => {
        // ANCHOR_MISSING is usually Loki retention, not an incident.
        mockAnchorCheck.mockResolvedValue({
            status: 'ANCHOR_MISSING', verified: false, lokiConfigured: true, checked: 3, checks: [],
        });

        await processAuditVerification(job('tail'));

        expect(mockAlert).not.toHaveBeenCalled();
    });

    it('reports tamper AND the anchor gap when both apply', async () => {
        mockTail.mockResolvedValue({
            ...cleanTail,
            errors: [{ kind: 'BROKEN_LINK', recordId: 'r', sequence: 1, detail: 'x' }],
        });
        mockAnchorCheck.mockResolvedValue({
            status: 'ANCHOR_UNAVAILABLE', verified: false, lokiConfigured: true, checked: 0,
            checks: [{ status: 'ANCHOR_UNAVAILABLE', sequence: 1, recordId: 'r', dbHash: 'a', detail: 'down' }],
        });

        await processAuditVerification(job('tail'));

        expect(levels()).toEqual(['CRITICAL', 'WARN']);
    });
});

describe('undeliverable alerts', () => {
    it('logs loudly when an alert reached no sink', async () => {
        // An alarm with the wires cut. Nothing retries past this point and nothing
        // throws, so this log line is the only way it is ever visible.
        mockAlert.mockResolvedValue(0);
        mockTail.mockResolvedValue({
            ...cleanTail,
            errors: [{ kind: 'BROKEN_LINK', recordId: 'r', sequence: 1, detail: 'x' }],
        });

        await processAuditVerification(job('tail'));

        const events = mockError.mock.calls.map((c) => c[1]?.event);
        expect(events).toContain('audit_alert_undeliverable');
    });

    it('stays quiet when the alert was delivered', async () => {
        mockAlert.mockResolvedValue(2);
        mockTail.mockResolvedValue({
            ...cleanTail,
            errors: [{ kind: 'BROKEN_LINK', recordId: 'r', sequence: 1, detail: 'x' }],
        });

        await processAuditVerification(job('tail'));

        const events = mockError.mock.calls.map((c) => c[1]?.event);
        expect(events).not.toContain('audit_alert_undeliverable');
    });
});
