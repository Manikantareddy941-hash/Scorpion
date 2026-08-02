import { createCanary, requiresCanary, scrubCanary } from './canary';

describe('createCanary', () => {
    test('the payload carries a credential a secret scanner will match', () => {
        const canary = createCanary();

        expect(canary.files).toHaveLength(1);
        expect(canary.files[0].content).toMatch(/AKIA[A-Z0-9]{16}/);
    });

    test('the marker appears in the injected path, which is what the scrub keys on', () => {
        // Keyed on the path rather than the key material: a scanner is free to
        // mask or truncate the matched secret in its output, but the file path
        // it reports comes back untouched.
        const canary = createCanary();

        expect(canary.files[0].name).toContain(canary.marker);
        expect(canary.files[0].name.startsWith('.scorpion-canary-')).toBe(true);
    });

    test('every canary is unique, so there is nothing stable to special-case', () => {
        // A fixed payload is one an attacker can detect and preserve while
        // suppressing everything real.
        const a = createCanary();
        const b = createCanary();

        expect(a.marker).not.toBe(b.marker);
        expect(a.files[0].content).not.toBe(b.files[0].content);
    });

    test('the key is generated rather than the documented AWS example', () => {
        // A well-known example value may sit in a scanner's allowlist, which
        // would make the canary silently never fire and fail every scan closed.
        const canaries = Array.from({ length: 5 }, () => createCanary());

        for (const c of canaries) expect(c.files[0].content).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });
});

describe('requiresCanary', () => {
    test('gitleaks is covered — offline regex detection, identical under zero egress', () => {
        expect(requiresCanary('gitleaks')).toBe(true);
    });

    test('tools with no payload they could detect are not required to report one', () => {
        // Requiring a canary a tool cannot detect would fail every scan. semgrep
        // needs a rule match, trivy a vulnerable manifest, checkov a
        // misconfiguration.
        expect(requiresCanary('semgrep')).toBe(false);
        expect(requiresCanary('trivy')).toBe(false);
        expect(requiresCanary('checkov')).toBe(false);
    });
});

describe('scrubCanary', () => {
    const MARKER = 'abc123def456';
    const canaryFinding = { File: `.scorpion-canary-${MARKER}/credentials`, RuleID: 'aws-access-token' };
    const realFinding = { File: 'src/config.ts', RuleID: 'generic-api-key' };

    test('removes the canary finding and reports it was seen', () => {
        const { cleaned, hits, leaked } = scrubCanary([realFinding, canaryFinding], MARKER);

        expect(cleaned).toEqual([realFinding]);
        expect(hits).toBe(1);
        expect(leaked).toBe(false);
    });

    test('real findings are untouched', () => {
        // The scrub must not become a way to lose genuine results.
        const { cleaned } = scrubCanary([realFinding], MARKER);

        expect(cleaned).toEqual([realFinding]);
    });

    test('hits is zero when the scanner never reported the canary', () => {
        // The signal that a scanner's detection was suppressed or broken.
        const { hits } = scrubCanary([realFinding], MARKER);

        expect(hits).toBe(0);
    });

    test('finds canary findings nested inside a scanner-specific shape', () => {
        // trivy nests under Results[].Secrets[], semgrep under results[]. The
        // scrub drops array elements rather than knowing any one schema.
        const trivy = {
            Results: [
                { Target: 'repo', Secrets: [canaryFinding, realFinding] },
                { Target: 'other', Secrets: [realFinding] },
            ],
        };

        const { cleaned, hits, leaked } = scrubCanary(trivy, MARKER);

        expect(hits).toBe(1);
        expect(leaked).toBe(false);
        expect((cleaned as typeof trivy).Results[0].Secrets).toEqual([realFinding]);
    });

    test('a marker outside any array is reported as leaked rather than silently kept', () => {
        // There is no entry to drop, so the scrub cannot remove it. Forwarding
        // the report would put a synthetic credential on a customer dashboard.
        const { hits, leaked } = scrubCanary({ scannedPath: `/workspace/.scorpion-canary-${MARKER}` }, MARKER);

        expect(hits).toBe(0);
        expect(leaked).toBe(true);
    });

    test('a canary reported with the secret masked is still removed', () => {
        // Scanners often truncate the matched value. Keying on the path is what
        // makes that irrelevant.
        const masked = { File: `.scorpion-canary-${MARKER}/credentials`, Match: 'AKIA****************' };

        const { cleaned, hits } = scrubCanary([masked], MARKER);

        expect(hits).toBe(1);
        expect(cleaned).toEqual([]);
    });

    test('an empty report scrubs to an empty report with no hits', () => {
        expect(scrubCanary([], MARKER)).toEqual({ cleaned: [], hits: 0, leaked: false });
    });
});
