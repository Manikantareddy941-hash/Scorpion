// requireActual so anything else the module pulls from logger stays real.
jest.mock('../logger', () => ({
    ...jest.requireActual('../logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The concrete runners reach Docker, Kubernetes and archiver at construction.
// Selection is what is under test, not the providers themselves.
jest.mock('./binaryRunner', () => ({ BinaryRunner: class { } }));
jest.mock('./dockerRunner', () => ({ DockerRunner: class { } }));
jest.mock('./kubernetesRunner', () => ({ KubernetesRunner: class { } }));

jest.mock('child_process', () => ({ execFile: jest.fn() }));

import { logger } from '../logger';
import { getRunner, resetRunner } from './index';
import { execFile } from 'child_process';

const mockedExecFile = execFile as unknown as jest.Mock;

/**
 * `docker version` succeeding is what the auto-probe treats as "daemon present".
 * The real call passes an options object, so the callback is the LAST argument
 * rather than the third — taking it positionally leaves the promise unresolved
 * and the test times out instead of failing usefully.
 */
function dockerDaemon(present: boolean) {
    mockedExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (e: Error | null) => void;
        cb(present ? null : new Error('docker not found'));
    });
}

function selectionEvent() {
    const call = (logger.info as jest.Mock).mock.calls.find(
        ([, meta]) => meta?.event === 'RUNNER_MODE_SELECTED',
    );
    return call?.[1];
}

describe('runner mode selection telemetry', () => {
    const env = process.env;
    beforeEach(() => {
        jest.clearAllMocks();
        resetRunner();
        process.env = { ...env };
        delete process.env.RUNNER_MODE;
    });
    afterAll(() => { process.env = env; });

    // The winston contract: the object must be the SECOND argument. Passed first
    // it becomes the message and the string is parked on a splat symbol that this
    // logger never serialises — the failure this event exists to avoid.
    it('emits the payload as logger metadata, not as the message', async () => {
        process.env.RUNNER_MODE = 'kubernetes';

        await getRunner();

        const [message, meta] = (logger.info as jest.Mock).mock.calls[0];
        expect(typeof message).toBe('string');
        expect(meta).toEqual(expect.objectContaining({ event: 'RUNNER_MODE_SELECTED' }));
    });

    it('reports kubernetes as configured, isolated and not a fallback', async () => {
        process.env.RUNNER_MODE = 'kubernetes';

        await getRunner();

        expect(selectionEvent()).toEqual(expect.objectContaining({
            mode: 'kubernetes',
            configuredMode: 'kubernetes',
            isFallback: false,
            isolated: true,
            zapAvailable: true,
            falcoAvailable: true,
        }));
    });

    // The silent drift this event exists to surface: nothing configured, a daemon
    // present, so scans run in docker — successfully — and outside isolation.
    it('flags the auto-probed docker path as an un-isolated fallback', async () => {
        dockerDaemon(true);

        await getRunner();

        expect(selectionEvent()).toEqual(expect.objectContaining({
            mode: 'docker',
            configuredMode: null,
            isFallback: true,
            isolated: false,
        }));
    });

    it('records that binary mode has no ZAP or Falco', async () => {
        dockerDaemon(false);

        await getRunner();

        expect(selectionEvent()).toEqual(expect.objectContaining({
            mode: 'binary',
            isolated: false,
            zapAvailable: false,
            falcoAvailable: false,
        }));
    });

    // An unrecognised value must not be treated as configured — it falls through
    // to the probe, and the event has to say so rather than echoing the garbage.
    it('treats an invalid RUNNER_MODE as a fallback', async () => {
        process.env.RUNNER_MODE = 'k8s';
        dockerDaemon(true);

        await getRunner();

        expect(selectionEvent()).toEqual(expect.objectContaining({
            mode: 'docker',
            configuredMode: 'k8s',
            isFallback: true,
            isolated: false,
        }));
    });
});
