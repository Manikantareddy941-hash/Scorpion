jest.mock('../lib/appwrite', () => ({
    databases: { listDocuments: jest.fn() },
    DB_ID: 'test-db',
    Query: {
        orderAsc: (f: string) => ({ orderAsc: f }),
        limit: (n: number) => ({ limit: n }),
        offset: (n: number) => ({ offset: n }),
    },
}));

import crypto from 'crypto';
import { databases } from '../lib/appwrite';
import { verifyChain, verifyAuditChain, payloadFor } from './auditVerifier';

const mockList = databases.listDocuments as jest.Mock;

interface Row {
    $id: string; actor: string; action: string; repo_id: string;
    timestamp: string; details: string; tamper_hash: string; sequence?: number;
}

const base = (n: number) => ({
    $id: `doc-${n}`,
    actor: `user-${n}`,
    action: 'ALARM_CLEAR',
    repo_id: 'system',
    timestamp: `2026-08-04T10:0${n}:00.000Z`,
    details: `event ${n}`,
});

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Builds a correctly chained row the way logSecureAuditEvent would have. */
const chain = (predecessor: string, fields: Omit<Row, 'tamper_hash'>): Row => ({
    ...fields,
    tamper_hash: sha(`${predecessor}|${payloadFor({ ...fields, tamper_hash: '' })}`),
});

/** A well-formed sequenced ledger of `n` rows starting at position 0. */
function goodChain(n: number): Row[] {
    const rows: Row[] = [];
    let prev = 'GENESIS_HASH';
    for (let i = 0; i < n; i++) {
        const row = chain(prev, { ...base(i), sequence: i });
        rows.push(row);
        prev = row.tamper_hash;
    }
    return rows;
}

describe('payloadFor — the migration boundary selector', () => {
    it('uses the five-field legacy format when the row has no sequence', () => {
        const r = { ...base(1), tamper_hash: '' } as Row;
        expect(payloadFor(r)).toBe('user-1|ALARM_CLEAR|system|2026-08-04T10:01:00.000Z|event 1');
    });

    it('prefixes the position when the row has one', () => {
        const r = { ...base(1), sequence: 7, tamper_hash: '' } as Row;
        expect(payloadFor(r)).toBe('7|user-1|ALARM_CLEAR|system|2026-08-04T10:01:00.000Z|event 1');
    });

    it('treats sequence 0 as present, not as missing', () => {
        // `if (row.sequence)` instead of a typeof check would silently classify the
        // first sequenced row ever written as legacy, and report it BROKEN_LINK.
        const r = { ...base(1), sequence: 0, tamper_hash: '' } as Row;
        expect(payloadFor(r)).toMatch(/^0\|/);
    });
});

describe('verifyChain', () => {
    it('accepts a well-formed sequenced chain', () => {
        const report = verifyChain(goodChain(5));
        expect(report.isValid).toBe(true);
        expect(report.errors).toEqual([]);
        expect(report.rowsChecked).toBe(5);
        expect(report.latestSequence).toBe(4);
        expect(report.legacyRows).toBe(0);
    });

    it('accepts an all-legacy chain and counts it as legacy, not invalid', () => {
        const rows: Row[] = [];
        let prev = 'GENESIS_HASH';
        for (let i = 0; i < 3; i++) {
            const row = chain(prev, base(i));
            rows.push(row);
            prev = row.tamper_hash;
        }
        const report = verifyChain(rows);
        expect(report.isValid).toBe(true);
        expect(report.legacyRows).toBe(3);
        expect(report.latestSequence).toBeUndefined();
    });

    it('accepts the legacy → sequence-0 migration boundary mid-chain', () => {
        // THE case this verifier is most likely to get wrong. A legacy tip yields
        // sequence 0, so position 0 appears in the middle of the ledger. That is the
        // boundary, not a gap and not a restart.
        const legacy1 = chain('GENESIS_HASH', base(0));
        const legacy2 = chain(legacy1.tamper_hash, base(1));
        const first = chain(legacy2.tamper_hash, { ...base(2), sequence: 0 });
        const second = chain(first.tamper_hash, { ...base(3), sequence: 1 });

        const report = verifyChain([legacy1, legacy2, first, second]);
        expect(report.isValid).toBe(true);
        expect(report.legacyRows).toBe(2);
        expect(report.latestSequence).toBe(1);
    });

    it('detects a tampered row', () => {
        const rows = goodChain(4);
        rows[2] = { ...rows[2], details: 'edited after the fact' };

        const report = verifyChain(rows);
        expect(report.isValid).toBe(false);
        expect(report.errors.filter(e => e.kind === 'BROKEN_LINK').map(e => e.recordId)).toContain('doc-2');
    });

    it('detects a deleted row as a gap AND a broken link', () => {
        const rows = goodChain(5);
        const withHole = [rows[0], rows[1], rows[3], rows[4]]; // position 2 removed

        const report = verifyChain(withHole);
        expect(report.isValid).toBe(false);
        expect(report.errors.some(e => e.kind === 'GAP' && e.sequence === 3)).toBe(true);
        // The hash evidence is independent of the position evidence: removing a row
        // changes what the next row chains to. Both firing is the strong signal.
        expect(report.errors.some(e => e.kind === 'BROKEN_LINK')).toBe(true);
    });

    it('reports the size of a multi-row gap', () => {
        const rows = goodChain(6);
        const report = verifyChain([rows[0], rows[4], rows[5]]);
        expect(report.errors.find(e => e.kind === 'GAP')?.detail).toMatch(/3 row\(s\) are missing/);
    });

    it('detects a fork and does NOT mislabel the second writer as tampering', () => {
        // Two writers read tip at position 0 and both append position 1. Both rows
        // are legitimately chained to the SAME predecessor. A verifier comparing
        // positionally would recompute the second against the first and report
        // BROKEN_LINK — calling a benign race a tamper event.
        const root = chain('GENESIS_HASH', { ...base(0), sequence: 0 });
        const forkA = chain(root.tamper_hash, { ...base(1), sequence: 1 });
        const forkB = chain(root.tamper_hash, { ...base(2), sequence: 1 });

        const report = verifyChain([root, forkA, forkB]);

        expect(report.errors.map(e => e.kind)).toEqual(['FORK']);
        expect(report.errors[0].recordId).toBe('doc-2');
        expect(report.errors.some(e => e.kind === 'BROKEN_LINK')).toBe(false);
    });

    it('handles a three-way fork without cascading false broken links', () => {
        const root = chain('GENESIS_HASH', { ...base(0), sequence: 0 });
        const a = chain(root.tamper_hash, { ...base(1), sequence: 1 });
        const b = chain(root.tamper_hash, { ...base(2), sequence: 1 });
        const c = chain(root.tamper_hash, { ...base(3), sequence: 1 });

        const report = verifyChain([root, a, b, c]);
        expect(report.errors.map(e => e.kind)).toEqual(['FORK', 'FORK']);
    });

    it('flags an unsequenced row appearing after sequencing began', () => {
        const first = chain('GENESIS_HASH', { ...base(0), sequence: 0 });
        const stray = chain(first.tamper_hash, base(1)); // no sequence

        const report = verifyChain([first, stray]);
        expect(report.errors.map(e => e.kind)).toContain('SEQUENCE_REGRESSION');
    });

    it('reports an empty ledger as valid rather than throwing', () => {
        const report = verifyChain([]);
        expect(report).toMatchObject({ isValid: true, rowsChecked: 0, legacyRows: 0, errors: [] });
        expect(report.latestSequence).toBeUndefined();
    });
});

describe('verifyAuditChain paging', () => {
    beforeEach(() => jest.clearAllMocks());

    it('reads every page, not just the first', async () => {
        // A verifier that stopped at page one would report a clean chain having
        // examined a prefix of it — the scan-that-examined-nothing failure.
        const rows = goodChain(250);
        mockList.mockImplementation((_db, _c, queries) => {
            const offset = queries.find((q: any) => 'offset' in q)?.offset ?? 0;
            return Promise.resolve({ documents: rows.slice(offset, offset + 100) });
        });

        const report = await verifyAuditChain();

        expect(mockList).toHaveBeenCalledTimes(3); // 100 + 100 + 50
        expect(report.rowsChecked).toBe(250);
        expect(report.isValid).toBe(true);
    });

    it('stops on a short page', async () => {
        mockList.mockResolvedValueOnce({ documents: goodChain(4) });
        const report = await verifyAuditChain();
        expect(mockList).toHaveBeenCalledTimes(1);
        expect(report.rowsChecked).toBe(4);
    });

    it('walks oldest-first, or the chain cannot be replayed', async () => {
        mockList.mockResolvedValueOnce({ documents: [] });
        await verifyAuditChain();
        expect(mockList.mock.calls[0][2]).toContainEqual({ orderAsc: '$createdAt' });
    });
});
