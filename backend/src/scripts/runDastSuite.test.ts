import { runScanner, parseScanners } from './runDastSuite';

// Minimal fetch Response stub.
const jsonResponse = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
}) as unknown as Response;

interface Deps {
    baseUrl: string;
    token: string;
    fetchFn: typeof fetch;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
}

const buildDeps = (fetchFn: typeof fetch, nowSeq: number[] = []): Deps => {
    let i = 0;
    return {
        baseUrl: 'https://api.test',
        token: 'tok',
        fetchFn,
        sleep: async () => undefined, // no real waiting in tests
        now: () => (nowSeq.length ? nowSeq[Math.min(i++, nowSeq.length - 1)] : 0),
    };
};

describe('parseScanners', () => {
    it('defaults to all three when unset', () => {
        expect(parseScanners(undefined)).toEqual(['zap', 'nuclei', 'ffuf']);
    });

    it('filters to the requested subset, preserving canonical order', () => {
        expect(parseScanners('ffuf, zap')).toEqual(['zap', 'ffuf']);
    });

    it('throws when nothing valid is requested', () => {
        expect(() => parseScanners('bogus')).toThrow(/matched none/);
    });
});

describe('runScanner', () => {
    it('resolves when the scan reaches completed', async () => {
        const fetchFn = jest.fn()
            .mockResolvedValueOnce(jsonResponse({ scanId: 's1', status: 'started' })) // POST start
            .mockResolvedValueOnce(jsonResponse({ status: 'running' }))                // poll 1
            .mockResolvedValueOnce(jsonResponse({ status: 'completed' }));             // poll 2
        const deps = buildDeps(fetchFn as unknown as typeof fetch);

        await expect(runScanner(deps, 'nuclei', 'https://staging.test')).resolves.toBeUndefined();
        expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('throws when the scan reports failed', async () => {
        const fetchFn = jest.fn()
            .mockResolvedValueOnce(jsonResponse({ scanId: 's1' }))
            .mockResolvedValueOnce(jsonResponse({ status: 'failed' }));
        const deps = buildDeps(fetchFn as unknown as typeof fetch);

        await expect(runScanner(deps, 'zap', 'https://staging.test')).rejects.toThrow(/reported failed/);
    });

    it('throws when the start response has no scanId', async () => {
        const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ status: 'started' }));
        const deps = buildDeps(fetchFn as unknown as typeof fetch);

        await expect(runScanner(deps, 'ffuf', 'https://staging.test')).rejects.toThrow(/no scanId/);
    });

    it('fails closed on a non-ok start response', async () => {
        const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false, 500));
        const deps = buildDeps(fetchFn as unknown as typeof fetch);

        await expect(runScanner(deps, 'zap', 'https://staging.test')).rejects.toThrow(/HTTP 500/);
    });

    it('times out when the deadline passes before completion', async () => {
        // now() sequence: start-deadline calc (0), then a poll tick past the 20-min deadline.
        const fetchFn = jest.fn()
            .mockResolvedValueOnce(jsonResponse({ scanId: 's1' }))
            .mockResolvedValue(jsonResponse({ status: 'running' }));
        const deps = buildDeps(fetchFn as unknown as typeof fetch, [0, 21 * 60 * 1000]);

        await expect(runScanner(deps, 'nuclei', 'https://staging.test')).rejects.toThrow(/timed out/);
    });
});
