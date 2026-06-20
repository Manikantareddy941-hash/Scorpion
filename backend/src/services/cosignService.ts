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

export const isCosignAvailable = async (): Promise<boolean> => {
    const resolved = await resolveToolCommand('cosign');
    return resolved.status === 'installed';
};

/** Is a signing key configured? Without one, signing is skipped (not an error) - see signImageDigest. */
export const isSigningConfigured = (): boolean => !!process.env.COSIGN_KEY_PATH;

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
 * Signs an image's digest with the key at COSIGN_KEY_PATH. Returns null
 * (not an error) if cosign isn't installed or no key is configured -
 * signing is opt-in infrastructure, not a hard requirement to build.
 */
export const signImageDigest = async (digest: string): Promise<{ signature: string; publicKeyPath?: string } | null> => {
    if (!isSigningConfigured()) {
        logger.info('[Cosign] COSIGN_KEY_PATH not set, skipping image signing');
        return null;
    }
    const resolved = await resolveToolCommand('cosign');
    if (resolved.status !== 'installed') {
        logger.warn('[Cosign] cosign CLI not found, skipping image signing');
        return null;
    }

    const runId = randomBytes(6).toString('hex');
    const digestFile = path.join(os.tmpdir(), `cosign-digest-${runId}.txt`);

    try {
        await fs.writeFile(digestFile, digest, 'utf8');
        const { stdout } = await execFileAsync(
            resolved.cmd,
            [...resolved.prefixArgs, 'sign-blob', '--key', process.env.COSIGN_KEY_PATH!, '--yes', '--output-signature', '-', digestFile],
            { timeout: COSIGN_TIMEOUT_MS }
        );
        return { signature: stdout.trim(), publicKeyPath: process.env.COSIGN_PUB_KEY_PATH };
    } catch (err: any) {
        logger.error('[Cosign] Failed to sign image digest:', err.message);
        return null;
    } finally {
        await fs.unlink(digestFile).catch(() => {});
    }
};

/**
 * Verifies a previously-signed digest against COSIGN_PUB_KEY_PATH. Returns
 * true only on a confirmed-valid signature; throws on any other outcome
 * (verification error, missing key, cosign missing) so the caller can
 * distinguish "verification failed" from "couldn't even attempt it" -
 * deployService.ts treats those differently (block vs. skip).
 */
export const verifyImageDigest = async (digest: string, signature: string): Promise<boolean> => {
    const pubKeyPath = process.env.COSIGN_PUB_KEY_PATH;
    if (!pubKeyPath) {
        throw new Error('COSIGN_PUB_KEY_PATH is not configured');
    }
    const resolved = await resolveToolCommand('cosign');
    if (resolved.status !== 'installed') {
        throw new Error('cosign CLI is not installed');
    }

    const runId = randomBytes(6).toString('hex');
    const digestFile = path.join(os.tmpdir(), `cosign-verify-digest-${runId}.txt`);
    const sigFile = path.join(os.tmpdir(), `cosign-verify-sig-${runId}.sig`);

    try {
        await fs.writeFile(digestFile, digest, 'utf8');
        await fs.writeFile(sigFile, signature, 'utf8');
        await execFileAsync(
            resolved.cmd,
            [...resolved.prefixArgs, 'verify-blob', '--key', pubKeyPath, '--signature', sigFile, digestFile],
            { timeout: COSIGN_TIMEOUT_MS }
        );
        return true;
    } catch (err: any) {
        logger.error(`[Cosign] Signature verification failed for digest ${digest}:`, err.message);
        return false;
    } finally {
        await fs.unlink(digestFile).catch(() => {});
        await fs.unlink(sigFile).catch(() => {});
    }
};
