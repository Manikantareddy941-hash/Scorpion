import { verifyAnchorIntegrity } from './auditAnchorVerifier';
import { AUDIT_ANCHOR_EVENT } from './auditAnchor';
import type { VerificationReport, ChainSample } from './auditVerifier';

const NOW = 1_785_000_000_000;

const report = (samples: ChainSample[], over: Partial<VerificationReport> = {}): VerificationReport => ({
    isValid: true,
    rowsChecked: samples.length,
    latestSequence: samples.length ? samples[samples.length - 1].sequence : undefined,
    legacyRows: 0,
    errors: [],
    samples,
    ...over,
});

const sample = (sequence: number, tamperHash: string): ChainSample => ({
    sequence, tamperHash, recordId: `doc-${sequence}`,
});

/**
 * Shapes a Loki query_range response.
 *
 * `atMs` is explicit and the array is emitted NEWEST-FIRST, because that is what
 * `direction=backward` actually returns. An earlier version of this helper listed
 * entries in array order and let the code's "first seen wins" rule look correct
 * when it was not — the fixture modelled the intended behaviour instead of Loki's.
 */
const lokiWith = (anchors: Array<{ sequence: number; tamperHash: string; atMs?: number }>) => {
    const withTimes = anchors.map((a, i) => ({ ...a, atMs: a.atMs ?? NOW - i * 1000 }));
    const newestFirst = [...withTimes].sort((a, b) => b.atMs - a.atMs);
    return {
        ok: true,
        json: async () => ({
            data: {
                result: [{
                    values: newestFirst.map((a) => [
                        // ms → ns as a string: the product exceeds Number.MAX_SAFE_INTEGER,
                        // and tsconfig targets es2016 so BigInt literals are unavailable here.
                        `${a.atMs}000000`,
                        JSON.stringify({ event: AUDIT_ANCHOR_EVENT, sequence: a.sequence, tamperHash: a.tamperHash }),
                    ]),
                }],
            },
        }),
    };
};

const originalEnv = { ...process.env };

beforeEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv, LOKI_QUERY_URL: 'http://loki.test' };
});
afterAll(() => { process.env = originalEnv; });

const mockFetch = (impl: any) => {
    global.fetch = jest.fn(impl) as unknown as typeof fetch;
};

describe('MATCH', () => {
    it('verifies when every sampled position matches its anchor', async () => {
        mockFetch(async () => lokiWith([{ sequence: 1, tamperHash: 'aaa' }, { sequence: 2, tamperHash: 'bbb' }]));

        const r = await verifyAnchorIntegrity(report([sample(1, 'aaa'), sample(2, 'bbb')]), NOW);

        expect(r.status).toBe('MATCH');
        expect(r.verified).toBe(true);
        expect(r.checked).toBe(2);
    });
});

describe('ANCHOR_MISMATCH — the attack the internal verifier cannot see', () => {
    it('fails a ledger that is internally valid but disagrees with the anchor', async () => {
        // This is the whole point. dbReport.isValid is TRUE: the attacker deleted a row
        // and recomputed every subsequent hash, so the chain verifies against itself.
        // The anchor was written before the rewrite and cannot be edited through Appwrite.
        mockFetch(async () => lokiWith([{ sequence: 7, tamperHash: 'original-hash' }]));

        const r = await verifyAnchorIntegrity(report([sample(7, 'recomputed-hash')], { isValid: true }), NOW);

        expect(r.status).toBe('ANCHOR_MISMATCH');
        expect(r.verified).toBe(false);
        expect(r.checks[0].anchorHash).toBe('original-hash');
        expect(r.checks[0].dbHash).toBe('recomputed-hash');
        expect(r.checks[0].detail).toMatch(/requires database write access/);
    });

    it('reports MISMATCH as more serious than a MISSING anchor elsewhere', async () => {
        mockFetch(async () => lokiWith([{ sequence: 1, tamperHash: 'wrong' }]));

        const r = await verifyAnchorIntegrity(report([sample(1, 'right'), sample(2, 'unanchored')]), NOW);

        expect(r.checks.map(c => c.status)).toEqual(['ANCHOR_MISMATCH', 'ANCHOR_MISSING']);
        expect(r.status).toBe('ANCHOR_MISMATCH');
    });
});

describe('ANCHOR_MISSING', () => {
    it('reports a sampled position with no anchor, and names the benign causes first', async () => {
        mockFetch(async () => lokiWith([]));

        const r = await verifyAnchorIntegrity(report([sample(3, 'ccc')]), NOW);

        expect(r.status).toBe('ANCHOR_MISSING');
        expect(r.verified).toBe(false);
        expect(r.checks[0].detail).toMatch(/retention/);
    });

    it('does not confuse a missing anchor with a deleted row', async () => {
        // A deleted ledger row shows up as a GAP in the internal report, not here.
        // Conflating them would send an operator hunting for tampering over an
        // expired log line.
        mockFetch(async () => lokiWith([]));
        const r = await verifyAnchorIntegrity(report([sample(3, 'ccc')]), NOW);
        expect(r.checks[0].detail).toMatch(/does not produce this/);
    });
});

describe('ANCHOR_UNAVAILABLE', () => {
    it('reports a network failure rather than silently passing', async () => {
        mockFetch(async () => { throw new Error('ECONNREFUSED'); });

        const r = await verifyAnchorIntegrity(report([sample(1, 'aaa')]), NOW);

        expect(r.status).toBe('ANCHOR_UNAVAILABLE');
        expect(r.verified).toBe(false);
        expect(r.checks[0].detail).toMatch(/ECONNREFUSED/);
    });

    it('treats a 5xx as unavailable, not as a missing anchor', async () => {
        mockFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));

        const r = await verifyAnchorIntegrity(report([sample(1, 'aaa')]), NOW);

        expect(r.status).toBe('ANCHOR_UNAVAILABLE');
        expect(r.checks[0].detail).toMatch(/503/);
    });

    it('reports UNAVAILABLE — never MATCH — when Loki is not configured at all', async () => {
        // The single most important case. Returning MATCH here would mean a dev or
        // misconfigured production environment reports "ledger verified" having
        // compared against nothing. Silence is not agreement.
        delete process.env.LOKI_QUERY_URL;
        delete process.env.LOKI_URL;
        mockFetch(async () => { throw new Error('should not be called'); });

        const r = await verifyAnchorIntegrity(report([sample(1, 'aaa')]), NOW);

        expect(r.status).toBe('ANCHOR_UNAVAILABLE');
        expect(r.lokiConfigured).toBe(false);
        expect(r.verified).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not report verified for a ledger with nothing to sample', async () => {
        mockFetch(async () => lokiWith([]));
        const r = await verifyAnchorIntegrity(report([]), NOW);
        expect(r.verified).toBe(false);
        expect(r.checked).toBe(0);
    });
});

describe('query construction', () => {
    it('falls back to LOKI_URL when LOKI_QUERY_URL is unset', async () => {
        delete process.env.LOKI_QUERY_URL;
        process.env.LOKI_URL = 'http://push.test/';
        mockFetch(async () => lokiWith([{ sequence: 1, tamperHash: 'aaa' }]));

        await verifyAnchorIntegrity(report([sample(1, 'aaa')]), NOW);

        const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
        expect(url).toMatch(/^http:\/\/push\.test\/loki\/api\/v1\/query_range\?/); // trailing slash trimmed
    });

    it('sends a bearer token when LOKI_QUERY_TOKEN is set', async () => {
        process.env.LOKI_QUERY_TOKEN = 'secret-token';
        mockFetch(async () => lokiWith([{ sequence: 1, tamperHash: 'aaa' }]));

        await verifyAnchorIntegrity(report([sample(1, 'aaa')]), NOW);

        const init = (global.fetch as jest.Mock).mock.calls[0][1];
        expect(init.headers.Authorization).toBe('Bearer secret-token');
    });

    it('ignores log lines that are not anchors, and unparseable ones', async () => {
        mockFetch(async () => ({
            ok: true,
            json: async () => ({
                data: { result: [{ values: [
                    ['1', 'not json at all'],
                    ['2', JSON.stringify({ event: 'something_else', sequence: 1, tamperHash: 'decoy' })],
                    ['3', JSON.stringify({ event: AUDIT_ANCHOR_EVENT, sequence: 1, tamperHash: 'real' })],
                ] }] },
            }),
        }));

        const r = await verifyAnchorIntegrity(report([sample(1, 'real')]), NOW);
        expect(r.status).toBe('MATCH');
    });

    it('keeps the OLDEST anchor for a position even though Loki returns newest first', async () => {
        // The regression this pins: the query runs direction=backward, so the forged
        // re-emission arrives FIRST in the response. Code that kept "the first entry
        // seen" would adopt the forgery and report MATCH, letting an attacker who can
        // write logs paper over a rewritten ledger row. Selection is by timestamp, so
        // response order cannot decide it.
        mockFetch(async () => lokiWith([
            { sequence: 5, tamperHash: 'original', atMs: NOW - 60_000 },
            { sequence: 5, tamperHash: 'forged-later', atMs: NOW - 1_000 },
        ]));

        const r = await verifyAnchorIntegrity(report([sample(5, 'forged-later')]), NOW);
        expect(r.status).toBe('ANCHOR_MISMATCH');
        expect(r.checks[0].anchorHash).toBe('original');
    });

    it('still picks the oldest when the forgery is listed last in the response', async () => {
        // Same assertion with the fixture ordered the other way. Both orderings must
        // give the same verdict, or the test is measuring the fixture.
        mockFetch(async () => lokiWith([
            { sequence: 5, tamperHash: 'forged-later', atMs: NOW - 1_000 },
            { sequence: 5, tamperHash: 'original', atMs: NOW - 60_000 },
        ]));

        const r = await verifyAnchorIntegrity(report([sample(5, 'forged-later')]), NOW);
        expect(r.checks[0].anchorHash).toBe('original');
    });
});
