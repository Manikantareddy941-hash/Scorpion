import { SEMGREP_RULES_PATH, TRIVY_CACHE_PATH, bakedImageRef, isBaked, offlineProfile } from './offline';

describe('semgrep', () => {
    const rewrite = (args: string[]) => offlineProfile('semgrep').rewrite(args);

    test('replaces --config auto rather than adding a second config', () => {
        // `auto` resolves the ruleset from semgrep.dev. Appending another
        // --config would leave that network call in place, and under the
        // runner's egress policy the scan fails instead of degrading.
        const out = rewrite(['scan', '--config', 'auto', '--json', '/workspace']);

        expect(out).toEqual(['scan', '--config', SEMGREP_RULES_PATH, '--json', '/workspace', '--metrics=off']);
        expect(out).not.toContain('auto');
        expect(out.filter(a => a === '--config')).toHaveLength(1);
    });

    test('adds a config when the caller supplied none', () => {
        expect(rewrite(['scan', '/workspace'])).toContain(SEMGREP_RULES_PATH);
    });

    test('turns metrics off — reporting them is a network call too', () => {
        expect(rewrite(['scan', '--config', 'auto'])).toContain('--metrics=off');
    });

    test('is idempotent, so a second pass cannot duplicate flags', () => {
        const once = rewrite(['scan', '--config', 'auto']);

        expect(rewrite(once)).toEqual(once);
    });

    test('needs no scratch volume — its rules are read-only', () => {
        expect(offlineProfile('semgrep').scratch).toBeUndefined();
    });
});

describe('trivy', () => {
    const profile = offlineProfile('trivy');

    test('stages the database out of the image layer before scanning', () => {
        // It opens its BoltDB read-write, so the baked copy cannot be read in
        // place from a read-only root filesystem.
        expect(profile.prelude).toContain('/opt/trivy-db');
        expect(profile.prelude).toContain(TRIVY_CACHE_PATH);
    });

    test('asks for a scratch volume with headroom over the database', () => {
        // A copy that runs out of space yields a partial database, and a partial
        // database silently misses whatever it did not receive.
        expect(profile.scratch).toEqual({ mountPath: TRIVY_CACHE_PATH, sizeLimit: '3Gi' });
    });

    test('suppresses both downloads, including the java database', () => {
        // The java database is deliberately not baked; without the flag trivy
        // attempts a fetch the NetworkPolicy blocks.
        const out = profile.rewrite(['fs', '/workspace']);

        expect(out).toContain('--skip-db-update');
        expect(out).toContain('--skip-java-db-update');
        expect(out.slice(0, 2)).toEqual(['fs', '/workspace']);
    });
});

describe('tools with nothing to download', () => {
    test('are left exactly as the orchestrator built them', () => {
        // gitleaks, bandit and hadolint compile their rules in.
        const args = ['detect', '--source', '/workspace', '-f', 'json'];

        expect(offlineProfile('gitleaks').rewrite(args)).toEqual(args);
        expect(offlineProfile('bandit').rewrite(args)).toEqual(args);
    });

    test('are not baked, so nothing puts them through the freshness gate', () => {
        expect(isBaked('gitleaks')).toBe(false);
        expect(isBaked('checkov')).toBe(false);
        expect(isBaked('trivy')).toBe(true);
        expect(isBaked('semgrep')).toBe(true);
    });
});

describe('bakedImageRef', () => {
    afterEach(() => { delete process.env.SCANNER_IMAGE_REPO; });

    test('builds the registry path from the configured repository', () => {
        process.env.SCANNER_IMAGE_REPO = 'ghcr.io/acme';

        expect(bakedImageRef('trivy')).toBe('ghcr.io/acme/scorpion-trivy');
    });

    test('tolerates a trailing slash rather than producing a double one', () => {
        process.env.SCANNER_IMAGE_REPO = 'ghcr.io/acme/';

        expect(bakedImageRef('semgrep')).toBe('ghcr.io/acme/scorpion-semgrep');
    });

    test('refuses to fall back to the upstream image when unconfigured', () => {
        // An upstream trivy cannot reach its database under the egress policy
        // anyway, and it would fail deep inside the scanner with an error
        // nobody traces back to a missing environment variable.
        expect(() => bakedImageRef('trivy')).toThrow(/SCANNER_IMAGE_REPO/);
    });
});
