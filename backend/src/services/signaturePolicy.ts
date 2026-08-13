/**
 * The single predicate that decides whether image-signature enforcement is live.
 *
 * This exists because there were two signature gates with different answers.
 * `deployService`'s gate ran unconditionally but let an image with NO recorded
 * signature through ("signing is opt-in, an unsigned build makes no claim").
 * `k8sAdmission.checkImageSignature` blocked that same image — but only when
 * REQUIRE_IMAGE_SIGNATURE was true and the environment was prod.
 *
 * So the gate that always ran was the permissive one, and the strict one lived
 * outside the application, in a webhook that has to be registered in the cluster
 * to do anything at all. Setting the flag looked like enabling enforcement while
 * the deploy path an operator actually calls kept shipping unsigned images.
 *
 * Both gates now import this. If the predicate needs to change, it changes in one
 * place and the two gates cannot drift apart again — which is the failure mode
 * that produced the whole class of bug this module was extracted during.
 *
 * Deliberately a plain function over process.env rather than a cached constant:
 * the test suites for both gates set REQUIRE_IMAGE_SIGNATURE per-case, and a
 * module-load snapshot would make the second test in a file read the first
 * test's environment.
 */

/**
 * Environments where a signature requirement is enforced rather than advisory.
 *
 * BOTH SPELLINGS, and that is the whole point. The two callers of this module do
 * not share a vocabulary:
 *
 *   k8sAdmission   GateEnv          -> 'prod'
 *   deployService  DeployEnvironment -> 'production'
 *
 * The list held only 'prod', so `signatureEnforcementActive('production')` was
 * false unconditionally and the deploy path's signature block — and the
 * provenance gate layered on top of it — never ran. The admission webhook
 * enforced, the deploy path an operator actually calls did not, which is exactly
 * the split this module was extracted to end. It drifted anyway, through the
 * argument's vocabulary rather than the predicate.
 *
 * Compared after normalisation so a config that says 'Production' or ' prod '
 * does not silently disarm the gate either. A gate that fails open on a string
 * mismatch gives no sign it is off.
 */
const ENFORCED_ENVIRONMENTS: readonly string[] = ['prod', 'production'];

/** Trimmed and lower-cased, so casing and stray whitespace cannot disarm a gate. */
function canonicalEnvironment(environment: string): string {
    return environment.trim().toLowerCase();
}

/**
 * True when an unsigned or unverifiable image must be blocked.
 *
 * Opt-in twice over: the operator sets REQUIRE_IMAGE_SIGNATURE, and the target
 * has to be an enforced environment. Default-off means an install that has not
 * adopted signing sees no behaviour change — the same reason `signBlobContent`
 * treats an absent COSIGN_KEY_PATH as opt-out rather than error.
 */
export function signatureEnforcementActive(environment: string): boolean {
    return (
        process.env.REQUIRE_IMAGE_SIGNATURE === 'true' &&
        ENFORCED_ENVIRONMENTS.includes(canonicalEnvironment(environment))
    );
}

/**
 * True when the operator has declared a signature requirement anywhere, ignoring
 * environment.
 *
 * Used by the boot probe, which has no deploy environment in hand but still needs
 * to notice the dangerous combination: enforcement requested while no verification
 * key is configured. That install blocks every production deploy, and before this
 * existed the probe stayed silent about it, because silence was keyed on the cosign
 * key vars alone.
 */
export function signatureEnforcementRequested(): boolean {
    return process.env.REQUIRE_IMAGE_SIGNATURE === 'true';
}
