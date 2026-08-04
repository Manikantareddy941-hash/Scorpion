// Container image signing/verification via cosign, scoped to what's actually
// runnable in this codebase today: there is no container registry anywhere
// in the build/deploy flow (buildService.ts only runs `docker build` locally,
// never pushes), so registry-based OCI image signing (cosign sign <image>)
// isn't viable here. Instead this signs/verifies the built image's content
// digest as a blob (cosign sign-blob/verify-blob) - this is a fully local,
// key-based primitive that doesn't need a registry, Fulcio, or Rekor, and it
// proves the same thing a registry signature would: that this exact image
// artifact was produced and attested by this build pipeline, not substituted
// afterward.
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { resolveToolCommand } from '../utils/toolCheck';
import { logger } from './logger';

const execFileAsync = promisify(execFile);
const COSIGN_TIMEOUT_MS = 30_000;

// Imported for the boot probe only — the enforcement predicate itself lives in
// signaturePolicy so deployService and k8sAdmission share one answer.
import { signatureEnforcementRequested } from './signaturePolicy';

export const isCosignAvailable = async (): Promise<boolean> => {
    const resolved = await resolveToolCommand('cosign');
    return resolved.status === 'installed';
};

/** Is a signing key configured? Without one, signing is skipped (not an error) - see signImageDigest. */
export const isSigningConfigured = (): boolean => !!process.env.COSIGN_KEY_PATH;

export type SigningReadiness =
    | 'not-configured'   // nobody asked for signing; nothing to report
    | 'ready'            // intent declared and every prerequisite is in place
    | 'degraded';        // intent declared, something is missing, deploys will block

/**
 * Boot-time readiness check for the signature path.
 *
 * Silent when nothing about signing is configured. Most installs never sign, and
 * a warning that fires on every one of them is a warning operators learn to
 * scroll past — which costs exactly the case this probe exists for. So it speaks
 * only when the deployment has DECLARED an intent (COSIGN_KEY_PATH or
 * COSIGN_PUB_KEY_PATH is set) and something about that intent is unmet.
 *
 * This warns; it never exits. A backend that refuses to boot cannot serve the
 * API an operator needs to fix the misconfiguration, and refusing to boot is not
 * where the security value is — deployService's gate blocks on its own, per
 * deploy, with an incident and an audit entry. The probe only moves the
 * discovery earlier, from mid-release to startup.
 *
 * The highest-value case is the asymmetric one: a build host that signs while
 * the deploy host cannot verify. Every image that build produces will now be
 * blocked at deploy, and nothing about the two configs is wrong on its own.
 */
export const probeSigningReadiness = async (): Promise<SigningReadiness> => {
    const signKey = process.env.COSIGN_KEY_PATH;
    const pubKey = process.env.COSIGN_PUB_KEY_PATH;

    // REQUIRE_IMAGE_SIGNATURE is a third way to declare intent, and the most
    // dangerous one to leave unspoken: enforcement on with no verification key
    // blocks every production deploy, and keying silence on the cosign vars alone
    // meant this install got no boot signal at all. It is not a misconfiguration
    // of signing — nothing about the key vars is wrong — which is exactly why it
    // needs saying out loud.
    if (signatureEnforcementRequested() && !pubKey) {
        logger.error(
            '[Cosign] REQUIRE_IMAGE_SIGNATURE is set but COSIGN_PUB_KEY_PATH is not. ' +
            'Every production deploy will be BLOCKED: enforcement demands a signature claim ' +
            'and there is no key to verify one with. Set COSIGN_PUB_KEY_PATH or unset ' +
            'REQUIRE_IMAGE_SIGNATURE.',
        );
        return 'degraded';
    }

    if (!signKey && !pubKey) {
        logger.info('[Cosign] No signing keys configured — builds will not be signed and the deploy signature gate has nothing to check.');
        return 'not-configured';
    }

    const problems: string[] = [];

    if (!(await isCosignAvailable())) {
        problems.push('the cosign CLI could not be resolved on PATH');
    }

    // Read the key files rather than stat them: an unreadable key fails at verify
    // time just as hard as an absent one, and the process uid is the thing that
    // usually differs between a working image and a broken deployment.
    for (const [name, value] of [['COSIGN_KEY_PATH', signKey], ['COSIGN_PUB_KEY_PATH', pubKey]] as const) {
        if (!value) continue;
        try {
            await fs.access(value);
        } catch {
            problems.push(`${name} is set to ${value} but that path is not readable by this process`);
        }
    }

    if (signKey && !pubKey) {
        problems.push(
            'COSIGN_KEY_PATH is set but COSIGN_PUB_KEY_PATH is not — this host signs builds it cannot verify, ' +
            'and any deploy of a signed image will be blocked as unverifiable',
        );
    }

    if (problems.length === 0) {
        logger.info('[Cosign] Signing configured and verifiable: cosign resolved and key paths readable.');
        return 'ready';
    }

    // error, not warn: with signing configured, every build this process runs
    // will now fail outright, and a warn-level line is not what an operator
    // greps for when the pipeline goes red.
    logger.error(
        `[Cosign] Signing/verification is configured but not usable — ${problems.join('; ')}. ` +
        'Builds that attempt to sign will FAIL, and deploys of already-signed images will be BLOCKED ' +
        '(neither is silently allowed through). Builds on installs that never configured signing are unaffected.',
    );
    return 'degraded';
};

/**
 * Returns the docker-daemon image's content digest (sha256:...), independent
 * of its tag - this is what actually gets signed, so a re-tagged or
 * re-pushed copy of the same bytes still verifies.
 */
export const getImageDigest = async (imageTag: string): Promise<string> => {
    const { stdout } = await execFileAsync('docker', ['inspect', '--format', '{{.Id}}', imageTag], { timeout: 10_000 });
    return stdout.trim();
};

/**
 * Thrown when signing was asked for and could not be delivered. Distinct from a
 * null return, which means signing was never asked for at all.
 */
export class CosignSigningError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CosignSigningError';
    }
}

/**
 * Signs arbitrary blob content with the key at COSIGN_KEY_PATH.
 *
 * Returns null in exactly one case: COSIGN_KEY_PATH is unset, so nobody asked
 * for a signature. Signing is opt-in infrastructure and an install that never
 * configured it is not in an error state.
 *
 * Everything else throws CosignSigningError. This used to return null too, which
 * conflated "nobody asked" with "asked and failed" — and downstream those are
 * opposites. A build whose signer broke records no signature, and deployService's
 * gate correctly waves unsigned builds through as making no claim, so a null
 * here turned a sabotaged signer into a complete bypass of the deploy signature
 * gate. Breaking the tool must not be cheaper than defeating the crypto.
 *
 * Shared primitive: image digests (signImageDigest) and SLSA provenance
 * statements (provenanceService) both sign through here, so both inherit this.
 */
export const signBlobContent = async (content: string): Promise<{ signature: string; publicKeyPath?: string } | null> => {
    if (!isSigningConfigured()) {
        logger.info('[Cosign] COSIGN_KEY_PATH not set, skipping blob signing');
        return null;
    }
    const resolved = await resolveToolCommand('cosign');
    if (resolved.status !== 'installed') {
        // Configured to sign but the signer is absent. That is a broken host, not
        // an opt-out — the operator already declared intent by setting the key.
        throw new CosignSigningError('COSIGN_KEY_PATH is set but the cosign CLI could not be resolved on PATH');
    }

    const runId = randomBytes(6).toString('hex');
    const blobFile = path.join(os.tmpdir(), `cosign-blob-${runId}.txt`);

    try {
        await fs.writeFile(blobFile, content, 'utf8');
        const { stdout } = await execFileAsync(
            resolved.cmd,
            [...resolved.prefixArgs, 'sign-blob', '--key', process.env.COSIGN_KEY_PATH!, '--yes', '--output-signature', '-', blobFile],
            { timeout: COSIGN_TIMEOUT_MS }
        );
        return { signature: stdout.trim(), publicKeyPath: process.env.COSIGN_PUB_KEY_PATH };
    } catch (err: any) {
        // Bad key, wrong passphrase, timeout, unwritable tmpdir. The signature
        // the caller asked for does not exist, and saying so quietly produced an
        // unsigned artifact indistinguishable from one nobody meant to sign.
        logger.error('[Cosign] Failed to sign blob:', err.message);
        throw new CosignSigningError(`cosign sign-blob failed: ${err?.message ?? String(err)}`);
    } finally {
        await fs.unlink(blobFile).catch(() => {});
    }
};

/** Signs an image's content digest. See signBlobContent for skip semantics. */
export const signImageDigest = (digest: string): Promise<{ signature: string; publicKeyPath?: string } | null> =>
    signBlobContent(digest);

/**
 * Verifies previously-signed blob content against COSIGN_PUB_KEY_PATH.
 * Returns true only on a confirmed-valid signature; throws on any other
 * outcome (missing key, cosign missing) so the caller can distinguish
 * "verification failed" from "couldn't even attempt it" -
 * deployService.ts treats those differently (block vs. skip).
 */
export const verifyBlobContent = async (content: string, signature: string): Promise<boolean> => {
    const pubKeyPath = process.env.COSIGN_PUB_KEY_PATH;
    if (!pubKeyPath) {
        throw new Error('COSIGN_PUB_KEY_PATH is not configured');
    }
    const resolved = await resolveToolCommand('cosign');
    if (resolved.status !== 'installed') {
        throw new Error('cosign CLI is not installed');
    }

    const runId = randomBytes(6).toString('hex');
    const blobFile = path.join(os.tmpdir(), `cosign-verify-blob-${runId}.txt`);
    const sigFile = path.join(os.tmpdir(), `cosign-verify-sig-${runId}.sig`);

    try {
        await fs.writeFile(blobFile, content, 'utf8');
        await fs.writeFile(sigFile, signature, 'utf8');
        await execFileAsync(
            resolved.cmd,
            [...resolved.prefixArgs, 'verify-blob', '--key', pubKeyPath, '--signature', sigFile, blobFile],
            { timeout: COSIGN_TIMEOUT_MS }
        );
        return true;
    } catch (err: any) {
        logger.error('[Cosign] Blob signature verification failed:', err.message);
        return false;
    } finally {
        await fs.unlink(blobFile).catch(() => {});
        await fs.unlink(sigFile).catch(() => {});
    }
};

/** Verifies a signed image digest. See verifyBlobContent for throw semantics. */
export const verifyImageDigest = (digest: string, signature: string): Promise<boolean> =>
    verifyBlobContent(digest, signature);

/**
 * Verifies a signature stored in the REGISTRY alongside the image, rather than
 * a detached blob signature we transported ourselves.
 *
 * Distinct from verifyImageDigest on purpose. That one is for content we sign
 * and carry (provenance statements, CI-ingested digests), and it needs the
 * signature kept somewhere until it is checked — which is exactly why it cannot
 * be used for scanner images: the only store available is a one-hour cache, and
 * these images live for a day.
 *
 * `cosign sign` publishes the signature as a `.sig` tag in the registry, so
 * there is nothing to store and nothing to expire. Trust comes from the public
 * key, not from us having kept the signature safe.
 *
 * Throws (rather than returning false) when verification could not be attempted
 * at all — no key, no cosign — so the caller can distinguish "this image is
 * untrustworthy" from "we are not in a position to judge". Both block; only one
 * is the image's fault.
 */
export const verifyImageSignature = async (imageRef: string): Promise<boolean> => {
    const pubKeyPath = process.env.COSIGN_PUB_KEY_PATH;
    if (!pubKeyPath) {
        throw new Error('COSIGN_PUB_KEY_PATH is not configured');
    }
    const resolved = await resolveToolCommand('cosign');
    if (resolved.status !== 'installed') {
        throw new Error('cosign CLI is not installed');
    }

    try {
        await execFileAsync(
            resolved.cmd,
            [...resolved.prefixArgs, 'verify', '--key', pubKeyPath, imageRef],
            { timeout: COSIGN_TIMEOUT_MS }
        );
        return true;
    } catch (err: any) {
        logger.error('[Cosign] Image signature verification failed:', err.message);
        return false;
    }
};
