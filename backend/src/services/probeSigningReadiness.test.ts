jest.mock('../utils/toolCheck', () => ({ resolveToolCommand: jest.fn() }));
jest.mock('fs/promises', () => ({ access: jest.fn() }));
jest.mock('./logger', () => ({
    ...jest.requireActual('./logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import fs from 'fs/promises';
import { resolveToolCommand } from '../utils/toolCheck';
import { logger } from './logger';
import { probeSigningReadiness } from './cosignService';

const mockedResolve = resolveToolCommand as jest.Mock;
const mockedAccess = fs.access as unknown as jest.Mock;

/**
 * probeSigningReadiness is the boot-time safety net the cosign rollout sequence
 * in OPERATIONS_RUNBOOK.md depends on, and it had no tests at all — the file sat
 * at 26% branch coverage with lines 60-122 entirely uncovered.
 *
 * These pin the states the runbook makes claims about, so the document and the
 * code cannot drift apart silently.
 */
describe('probeSigningReadiness', () => {
    const env = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...env };
        delete process.env.COSIGN_KEY_PATH;
        delete process.env.COSIGN_PUB_KEY_PATH;
        delete process.env.REQUIRE_IMAGE_SIGNATURE;
        // isCosignAvailable checks `resolved.status === 'installed'`, so the mock
        // must carry that field — returning a bare { cmd } reads as unavailable.
        mockedResolve.mockResolvedValue({ status: 'installed', cmd: 'cosign', prefixArgs: [] });
        mockedAccess.mockResolvedValue(undefined);
    });
    afterAll(() => { process.env = env; });

    // THE PRODUCTION-OUTAGE CASE. Enforcement resolves true for 'production'
    // since the environment-vocabulary fix, so turning it on before mounting the
    // public key blocks every deploy. This branch is the only thing that surfaces
    // it at boot rather than mid-release.
    it('reports degraded and logs an error when enforcement is on with no verification key', async () => {
        process.env.REQUIRE_IMAGE_SIGNATURE = 'true';

        await expect(probeSigningReadiness()).resolves.toBe('degraded');

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('REQUIRE_IMAGE_SIGNATURE is set but COSIGN_PUB_KEY_PATH is not'),
        );
    });

    // The confirmation signal step 2 of the runbook tells operators to watch for:
    // this line disappearing is how they know the key mount landed.
    it('reports not-configured, quietly, when neither key is set', async () => {
        await expect(probeSigningReadiness()).resolves.toBe('not-configured');

        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('No signing keys configured'));
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('reports ready when cosign resolves and both key paths are readable', async () => {
        process.env.COSIGN_KEY_PATH = '/keys/cosign.key';
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';

        await expect(probeSigningReadiness()).resolves.toBe('ready');

        expect(logger.error).not.toHaveBeenCalled();
    });

    // Verification-only is the deliberately safe half of the rollout: it declares
    // intent without arming enforcement, so it must NOT report degraded.
    it('reports ready with only the public key mounted', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';

        await expect(probeSigningReadiness()).resolves.toBe('ready');
    });

    // The asymmetric case the implementation calls out as highest-value: a host
    // that signs what it cannot verify produces images blocked at every deploy,
    // while neither config looks wrong on its own.
    it('reports degraded when it can sign but not verify', async () => {
        process.env.COSIGN_KEY_PATH = '/keys/cosign.key';

        await expect(probeSigningReadiness()).resolves.toBe('degraded');

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('signs builds it cannot verify'),
        );
    });

    // Readability, not existence — the process uid is what usually differs
    // between a working image and a broken deployment.
    it('reports degraded when a configured key path is not readable', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
        mockedAccess.mockRejectedValue(new Error('EACCES'));

        await expect(probeSigningReadiness()).resolves.toBe('degraded');

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('not readable by this process'),
        );
    });

    it('reports degraded when cosign is not on PATH', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
        mockedResolve.mockResolvedValue({ status: 'missing' });

        await expect(probeSigningReadiness()).resolves.toBe('degraded');

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('cosign CLI could not be resolved'),
        );
    });

    // Silence is the contract for installs that never opted in. A probe that
    // warns on every unconfigured deployment is one operators learn to scroll
    // past, which costs exactly the cases above.
    it('says nothing at error level when signing was never configured', async () => {
        await probeSigningReadiness();

        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
