jest.mock('./auditVerifier', () => ({ verifyAuditChain: jest.fn() }));
jest.mock('./auditAnchorVerifier', () => ({ verifyAnchorIntegrity: jest.fn() }));

import { verifyAuditChain } from './auditVerifier';
import { verifyAnchorIntegrity } from './auditAnchorVerifier';
import { runFullAuditVerification, isTamperSuspected, type FullAuditReport } from './auditOrchestrator';

const mockChain = verifyAuditChain as jest.Mock;
const mockAnchor = verifyAnchorIntegrity as jest.Mock;

const dbReport = (over = {}) => ({
    isValid: true, rowsChecked: 10, latestSequence: 9, legacyRows: 0, errors: [],
    samples: [{ sequence: 9, recordId: 'doc-9', tamperHash: 'h9' }],
    ...over,
});

const anchorReport = (over = {}) => ({
    status: 'MATCH', verified: true, lokiConfigured: true, checked: 1, checks: [], ...over,
});

const full = (db = {}, anchor = {}): FullAuditReport => ({
    db: dbReport(db) as any, anchor: anchorReport(anchor) as any, timestamp: '2026-08-04T00:00:00.000Z',
});

beforeEach(() => jest.clearAllMocks());

describe('runFullAuditVerification', () => {
    it('feeds the chain report into the anchor check', async () => {
        // The anchor verifier consumes the sample points the chain verifier
        // produces, so these cannot run in parallel.
        const db = dbReport();
        mockChain.mockResolvedValue(db);
        mockAnchor.mockResolvedValue(anchorReport());

        const report = await runFullAuditVerification();

        expect(mockAnchor).toHaveBeenCalledWith(db);
        expect(report.db).toBe(db);
        expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('keeps the two verdicts separate rather than merging them', async () => {
        mockChain.mockResolvedValue(dbReport());
        mockAnchor.mockResolvedValue(anchorReport({ status: 'ANCHOR_MISMATCH', verified: false }));

        const report = await runFullAuditVerification();

        // A single boolean cannot express "internally valid but externally refuted",
        // which is the only combination that describes an attack.
        expect(report.db.isValid).toBe(true);
        expect(report.anchor.status).toBe('ANCHOR_MISMATCH');
    });
});

describe('isTamperSuspected', () => {
    it('is false for an intact ledger', () => {
        expect(isTamperSuspected(full())).toBe(false);
    });

    it('is TRUE when the chain is internally valid but contradicts the anchor', () => {
        // The headline case: the attacker rewrote the ledger and recomputed every
        // hash, so db.isValid is true. Only the off-box anchor disagrees.
        expect(isTamperSuspected(full({}, { status: 'ANCHOR_MISMATCH' }))).toBe(true);
    });

    it('is true when the internal chain itself is broken', () => {
        expect(isTamperSuspected(full({ isValid: false }))).toBe(true);
    });

    it('is FALSE for a missing anchor — retention is not an attack', () => {
        // A tamper flag that fires on Loki log rotation gets muted within a week,
        // and takes the real signal with it.
        expect(isTamperSuspected(full({}, { status: 'ANCHOR_MISSING' }))).toBe(false);
    });

    it('is FALSE for an unavailable anchor, which means "not checked", not "attacked"', () => {
        expect(isTamperSuspected(full({}, { status: 'ANCHOR_UNAVAILABLE' }))).toBe(false);
    });

    it('does not treat ANCHOR_UNAVAILABLE as a pass either — that is the caller\'s job', () => {
        // isTamperSuspected answers "is there evidence of an attack", not "is the
        // ledger verified". verified:false on the anchor report carries that, and
        // conflating the two would let an unconfigured Loki read as a clean bill.
        const report = full({}, { status: 'ANCHOR_UNAVAILABLE', verified: false });
        expect(isTamperSuspected(report)).toBe(false);
        expect(report.anchor.verified).toBe(false);
    });
});
