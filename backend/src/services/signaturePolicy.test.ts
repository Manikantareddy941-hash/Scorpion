import { signatureEnforcementActive, signatureEnforcementRequested } from './signaturePolicy';

/**
 * The point of these is the LAST case: deployService and k8sAdmission must agree.
 * They previously did not, and the gate that always ran was the permissive one.
 */
describe('signaturePolicy', () => {
    const original = process.env.REQUIRE_IMAGE_SIGNATURE;
    afterEach(() => {
        if (original === undefined) delete process.env.REQUIRE_IMAGE_SIGNATURE;
        else process.env.REQUIRE_IMAGE_SIGNATURE = original;
    });

    it('is off when the flag is unset, in every environment', () => {
        delete process.env.REQUIRE_IMAGE_SIGNATURE;
        expect(signatureEnforcementActive('prod')).toBe(false);
        expect(signatureEnforcementActive('staging')).toBe(false);
        expect(signatureEnforcementActive('dev')).toBe(false);
    });

    it('is off in non-production even when the flag is set', () => {
        process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
        expect(signatureEnforcementActive('staging')).toBe(false);
        expect(signatureEnforcementActive('dev')).toBe(false);
    });

    it('is off when the flag is unset, for deployService\'s spelling too', () => {
        delete process.env.REQUIRE_IMAGE_SIGNATURE;
        expect(signatureEnforcementActive('production')).toBe(false);
    });

    it('is on only for prod with the flag set', () => {
        process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
        expect(signatureEnforcementActive('prod')).toBe(true);
    });

    /**
     * The case this file's own header claimed to cover and did not. Every test
     * above passes 'prod', which is k8sAdmission's GateEnv vocabulary;
     * deployService's DeployEnvironment says 'production', and nothing here ever
     * passed it. So the suite validated one caller and was structurally blind to
     * the other — while the header asserted the opposite.
     *
     * With ENFORCED_ENVIRONMENTS holding only 'prod', this test fails: the
     * deploy path's signature block and the provenance gate built on it were
     * both dead in production.
     */
    it('is on for BOTH callers\' spelling of production', () => {
        process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
        expect(signatureEnforcementActive('prod')).toBe(true);        // k8sAdmission
        expect(signatureEnforcementActive('production')).toBe(true);  // deployService
    });

    /** A gate that fails open on casing or whitespace gives no sign it is off. */
    it('normalises casing and surrounding whitespace', () => {
        process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
        for (const v of ['Production', 'PROD', ' production ', 'Prod']) {
            expect(signatureEnforcementActive(v)).toBe(true);
        }
    });

    /** Normalisation must not widen the set to environments that are advisory. */
    it('still refuses to enforce for non-production spellings', () => {
        process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
        for (const v of ['staging', 'STAGING', 'dev', 'preprod', 'prod-canary', '']) {
            expect(signatureEnforcementActive(v)).toBe(false);
        }
    });

    it('treats any value other than the exact string "true" as off', () => {
        for (const v of ['1', 'yes', 'TRUE', 'True', '']) {
            process.env.REQUIRE_IMAGE_SIGNATURE = v;
            expect(signatureEnforcementActive('prod')).toBe(false);
        }
    });

    it('reports a requirement independently of environment, for the boot probe', () => {
        process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
        expect(signatureEnforcementRequested()).toBe(true);
        delete process.env.REQUIRE_IMAGE_SIGNATURE;
        expect(signatureEnforcementRequested()).toBe(false);
    });

    it('re-reads the environment on every call (no module-load snapshot)', () => {
        delete process.env.REQUIRE_IMAGE_SIGNATURE;
        expect(signatureEnforcementActive('prod')).toBe(false);
        process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
        // A cached constant would still return false here, and would make the
        // second test in any suite read the first test's environment.
        expect(signatureEnforcementActive('prod')).toBe(true);
    });
});
