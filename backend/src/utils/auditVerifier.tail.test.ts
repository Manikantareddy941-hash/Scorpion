jest.mock('../lib/appwrite', () => ({
    databases: { listDocuments: jest.fn() },
    DB_ID: 'db',
    Query: {
        orderAsc: (f: string) => `orderAsc(${f})`,
        orderDesc: (f: string) => `orderDesc(${f})`,
        limit: (n: number) => `limit(${n})`,
        offset: (n: number) => `offset(${n})`,
    },
}));

import crypto from 'crypto';
import { verifyAuditTail, payloadFor } from './auditVerifier';
import { databases } from '../lib/appwrite';

const mockList = databases.listDocuments as jest.Mock;

interface Row {
    $id: string; actor: string; action: string; repo_id: string;
    timestamp: string; details: string; tamper_hash: string; sequence?: number;
}

/** Builds a correctly-chained run, so any BROKEN_LINK in a test is the code's doing. */
function chain(count: number, startSeq = 0): Row[] {
    const rows: Row[] = [];
    let previous = 'GENESIS_HASH';

    for (let i = 0; i < count; i++) {
        const row: Row = {
            $id: `rec-${startSeq + i}`,
            actor: 'u1', action: 'TEST', repo_id: 'system',
            timestamp: `2026-08-06T00:00:${String(i).padStart(2, '0')}.000Z`,
            details: '{}', tamper_hash: '', sequence: startSeq + i,
        };
        row.tamper_hash = crypto.createHash('sha256')
            .update(`${previous}|${payloadFor(row)}`).digest('hex');
        previous = row.tamper_hash;
        rows.push(row);
    }
    return rows;
}

/** Appwrite returns newest-first for orderDesc. */
const asPage = (rows: Row[]) => ({ documents: [...rows].reverse() });

beforeEach(() => jest.clearAllMocks());

describe('verifyAuditTail', () => {
    it('seeds from the row before the window instead of assuming GENESIS', async () => {
        // The regression this guards: verifying a mid-ledger slice with the
        // unseeded walk reports its first row as BROKEN_LINK every single time,
        // which would page the security rota on a perfectly healthy chain.
        const rows = chain(11);
        mockList.mockResolvedValue(asPage(rows));

        const report = await verifyAuditTail(10);

        expect(report.errors).toEqual([]);
        expect(report.rowsChecked).toBe(10); // the seed row is not itself verified
    });

    it('fetches one row more than the window', async () => {
        mockList.mockResolvedValue(asPage(chain(11)));

        await verifyAuditTail(10);

        expect(mockList.mock.calls[0][2]).toContain('limit(11)');
    });

    it('reads newest-first and walks oldest-first', async () => {
        mockList.mockResolvedValue(asPage(chain(11)));

        await verifyAuditTail(10);

        expect(mockList.mock.calls[0][2]).toContain('orderDesc($createdAt)');
    });

    it('reports the window bounds it actually covered', async () => {
        mockList.mockResolvedValue(asPage(chain(11)));

        const report = await verifyAuditTail(10);

        expect(report.windowFrom).toBe(1);      // row 0 was the seed
        expect(report.latestSequence).toBe(10);
    });

    it('treats a short page as reaching genesis, verifying every row', async () => {
        // Ledger smaller than the window: there is no predecessor to seed from,
        // and rows[0] really does chain to GENESIS.
        mockList.mockResolvedValue(asPage(chain(4)));

        const report = await verifyAuditTail(10);

        expect(report.errors).toEqual([]);
        expect(report.rowsChecked).toBe(4);
        expect(report.windowFrom).toBe(0);
    });

    it('detects an edited row inside the window', async () => {
        const rows = chain(11);
        rows[5].details = '{"tampered":true}';
        mockList.mockResolvedValue(asPage(rows));

        const report = await verifyAuditTail(10);

        expect(report.errors.some((e) => e.kind === 'BROKEN_LINK')).toBe(true);
    });

    it('is tagged as a tail and exposes no isValid to misread', async () => {
        // A tail cannot speak for the whole ledger: an attacker who rewrote old
        // history and recomputed forward leaves a window that verifies cleanly.
        // The absent boolean is the point of the type.
        mockList.mockResolvedValue(asPage(chain(11)));

        const report = await verifyAuditTail(10);

        expect(report.scope).toBe('tail');
        expect(report).not.toHaveProperty('isValid');
    });
});
