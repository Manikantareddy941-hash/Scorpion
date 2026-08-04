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

    it('is on only for prod with the flag set', () => {
        process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
        expect(signatureEnforcementActive('prod')).toBe(true);
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
