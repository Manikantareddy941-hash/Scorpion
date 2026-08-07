jest.mock('../logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../cosignService', () => ({ verifyImageSignature: jest.fn() }));

import { verifyImageSignature } from '../cosignService';
import {
    BUILT_AT_LABEL, ScannerImageError, classifyFreshness, resolveScannerImage,
} from './scannerImage';

const verify = verifyImageSignature as jest.Mock;
const REF = 'ghcr.io/acme/scorpion-trivy';
const DIGEST = 'sha256:' + 'a'.repeat(64);
const NOW = new Date('2026-08-02T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

/** Stands in for the registry: token, manifest (with digest header), config blob. */
const registry = (opts: { builtAt?: string | null; manifestStatus?: number } = {}) => {
    const builtAt = opts.builtAt === undefined ? hoursAgo(2).toISOString() : opts.builtAt;
    return jest.fn(async (url: string) => {
        const ok = (body: unknown, headers: Record<string, string> = {}) => ({
            ok: true, status: 200,
            json: async () => body,
            headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
        });
        if (url.includes('/token?')) return ok({ token: 'tok' });
        if (url.includes('/manifests/current')) {
            if (opts.manifestStatus) return { ok: false, status: opts.manifestStatus, json: async () => ({}), headers: { get: () => null } };
            return ok({ config: { digest: 'sha256:cfg' } }, { 'docker-content-digest': DIGEST });
        }
        if (url.includes(`/manifests/${DIGEST}`)) return ok({ config: { digest: 'sha256:cfg' } });
        if (url.includes('/blobs/')) {
            return ok({ config: { Labels: builtAt === null ? {} : { [BUILT_AT_LABEL]: builtAt } } });
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    verify.mockResolvedValue(true);
});

describe('classifyFreshness', () => {
    test('inside a day is fresh', () => {
        expect(classifyFreshness(hoursAgo(6), NOW)).toBe('fresh');
    });

    test('between a day and the ceiling is degraded, not refused', () => {
        // A broken bake must not freeze every pipeline the next day. Signature
        // databases are additive: a two-day gap misses two days of CVEs.
        expect(classifyFreshness(hoursAgo(48), NOW)).toBe('degraded');
    });

    test('past the ceiling is stale', () => {
        expect(classifyFreshness(hoursAgo(96), NOW)).toBe('stale');
    });

    test('a timestamp from the future is stale, not fresh', () => {
        // A wrong clock somewhere. Trusting it is how a database that never
        // refreshes again passes as current forever.
        expect(classifyFreshness(new Date(NOW.getTime() + 86_400_000), NOW)).toBe('stale');
    });

    test('the boundaries are inclusive on the safer side', () => {
        expect(classifyFreshness(hoursAgo(24), NOW)).toBe('fresh');
        expect(classifyFreshness(hoursAgo(72), NOW)).toBe('degraded');
        expect(classifyFreshness(hoursAgo(72.5), NOW)).toBe('stale');
    });
});

describe('resolveScannerImage', () => {
    test('returns the digest-pinned reference, not the tag', async () => {
        // The tag can move between verification and use. The digest cannot.
        global.fetch = registry() as never;

        const image = await resolveScannerImage(REF, NOW);

        expect(image.pinned).toBe(`${REF}@${DIGEST}`);
        expect(image.digest).toBe(DIGEST);
    });

    test('verifies the signature against the digest that will be dispatched', async () => {
        global.fetch = registry() as never;

        await resolveScannerImage(REF, NOW);

        expect(verify).toHaveBeenCalledWith(`${REF}@${DIGEST}`);
    });

    test('reports freshness rather than deciding it', async () => {
        // `degraded` is a warning and `stale` is a refusal; that policy belongs
        // with the caller that can emit telemetry and honour a break-glass.
        global.fetch = registry({ builtAt: hoursAgo(40).toISOString() }) as never;

        const image = await resolveScannerImage(REF, NOW);

        expect(image.freshness).toBe('degraded');
        expect(Math.round(image.ageHours)).toBe(40);
    });

    describe('refusals', () => {
        const reasonOf = async (fetchImpl: unknown): Promise<string> => {
            global.fetch = fetchImpl as never;
            try {
                await resolveScannerImage(REF, NOW);
                return 'no error';
            } catch (err) {
                return (err as ScannerImageError).reason;
            }
        };

        test('a failed signature blocks', async () => {
            verify.mockResolvedValue(false);
            expect(await reasonOf(registry())).toBe('bad_signature');
        });

        test('an unverifiable image blocks — no key, no cosign', async () => {
            // Distinct from a bad signature: this is "we are not in a position
            // to judge". Both block; only one is the image's fault.
            verify.mockRejectedValue(new Error('COSIGN_PUB_KEY_PATH is not configured'));
            expect(await reasonOf(registry())).toBe('unverifiable');
        });

        test('an image with no build stamp blocks — unknown age is not fresh', async () => {
            expect(await reasonOf(registry({ builtAt: null }))).toBe('no_timestamp');
        });

        test('an unparseable build stamp blocks rather than defaulting', async () => {
            expect(await reasonOf(registry({ builtAt: 'last tuesday' }))).toBe('bad_timestamp');
        });

        test('a registry that never answers is its own reason, not "no such image"', async () => {
            // Retried first; a blip must not read as a missing scanner.
            expect(await reasonOf(jest.fn(async () => { throw new Error('ECONNRESET'); }))).toBe('registry_unreachable');
        });

        test('a manifest the registry refuses to serve blocks', async () => {
            expect(await reasonOf(registry({ manifestStatus: 404 }))).toBe('registry_unreachable');
        });

        test('nothing is dispatched when verification could not run', async () => {
            verify.mockRejectedValue(new Error('cosign CLI is not installed'));
            global.fetch = registry() as never;

            await expect(resolveScannerImage(REF, NOW)).rejects.toThrow(ScannerImageError);
        });
    });

    test('retries a transient registry failure instead of blocking on it', async () => {
        let calls = 0;
        const flaky = registry();
        global.fetch = jest.fn(async (url: string) => {
            calls += 1;
            if (calls === 1) throw new Error('ECONNRESET');
            return flaky(url);
        }) as never;

        const image = await resolveScannerImage(REF, NOW);

        expect(image.digest).toBe(DIGEST);
        expect(calls).toBeGreaterThan(1);
    });

    test('descends a multi-arch index to reach the config labels', async () => {
        // docker push can publish an index rather than a plain manifest; the
        // labels live on the per-platform manifest underneath it.
        global.fetch = jest.fn(async (url: string) => {
            const ok = (body: unknown, headers: Record<string, string> = {}) => ({
                ok: true, status: 200, json: async () => body,
                headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
            });
            if (url.includes('/token?')) return ok({ token: 'tok' });
            if (url.includes('/manifests/current')) {
                return ok({ manifests: [{ digest: 'sha256:arm', platform: { os: 'linux', architecture: 'arm64' } },
                                        { digest: 'sha256:amd', platform: { os: 'linux', architecture: 'amd64' } }] },
                          { 'docker-content-digest': DIGEST });
            }
            if (url.includes(`/manifests/${DIGEST}`)) {
                return ok({ manifests: [{ digest: 'sha256:amd', platform: { os: 'linux', architecture: 'amd64' } }] });
            }
            if (url.includes('/manifests/sha256:amd')) return ok({ config: { digest: 'sha256:cfg' } });
            if (url.includes('/blobs/')) return ok({ config: { Labels: { [BUILT_AT_LABEL]: hoursAgo(3).toISOString() } } });
            throw new Error(`unexpected fetch: ${url}`);
        }) as never;

        const image = await resolveScannerImage(REF, NOW);

        expect(image.freshness).toBe('fresh');
    });
});
