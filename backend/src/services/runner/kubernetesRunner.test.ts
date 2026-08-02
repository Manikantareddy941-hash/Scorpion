jest.mock('@kubernetes/client-node', () => ({}));
// Both are ESM and unparseable under ts-jest CJS. Reached transitively via
// kubernetesJobRunner, which this adapter imports for its default dispatcher —
// every test here injects a stub instead.
jest.mock('archiver', () => ({ TarArchive: class {} }));
jest.mock('../logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { KubernetesRunner, buildScript, shellQuote, type JobDispatcher } from './kubernetesRunner';
import { WORKSPACE_PATH } from './jobSpec';
import { BEGIN_MARKER, END_MARKER } from './reportFraming';
import { createHash } from 'crypto';

/** Builds the log a compliant workload produces, so tests frame reports the way the shell does. */
const framedLog = (body: string, stderr = ''): string => {
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    return `${stderr}${stderr ? '\n' : ''}${BEGIN_MARKER}\n${body}\n${END_MARKER}:${Buffer.byteLength(body)}:${digest}`;
};

const dispatcher = (outcome: Partial<Awaited<ReturnType<JobDispatcher['run']>>>): JobDispatcher & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return {
        calls,
        run: async (request) => {
            calls.push(request);
            return { exitCode: 0, logs: '', timedOut: false, ...outcome };
        },
    };
};

const RUN = { tool: 'trivy', args: ['fs', '--format', 'json', '/tmp/ws'], workspacePath: '/tmp/ws', timeoutMs: 60000 };

describe('shellQuote', () => {
    test('a quote in an argument cannot close the quoting and append a command', () => {
        // The arguments are assembled into a shell string so stdout can be
        // redirected, which makes this a boundary rather than formatting.
        const hostile = `/tmp/x'; touch /pwned; echo '`;

        expect(shellQuote(hostile)).toBe(`'/tmp/x'\\''; touch /pwned; echo '\\'''`);
        expect(shellQuote(hostile).startsWith("'")).toBe(true);
        expect(shellQuote(hostile).endsWith("'")).toBe(true);
    });

    test('ordinary paths are still quoted, so spaces survive', () => {
        expect(shellQuote('/tmp/my repo')).toBe("'/tmp/my repo'");
    });
});

describe('buildScript', () => {
    test('the tool exit code survives the report emission', () => {
        // The emission always succeeds. Without capturing rc first, every
        // scanner would report exit 0 no matter how it died.
        const script = buildScript('trivy', ['fs']);

        expect(script).toMatch(/rc=\$\?/);
        expect(script).toMatch(/exit \$rc$/);
    });

    test('tool stdout is captured to a file rather than left in the log', () => {
        // Pod logs merge stdout and stderr; keeping the report in a file and
        // re-emitting it framed is what lets them be told apart afterwards.
        const script = buildScript('trivy', ['fs']);

        expect(script).toContain('>/tmp/report.json');
        expect(script.indexOf('>/tmp/report.json')).toBeLessThan(script.indexOf(BEGIN_MARKER));
    });
});

describe('KubernetesRunner', () => {
    test('rewrites the workspace argument to the in-pod mount', async () => {
        const d = dispatcher({ logs: framedLog('{}') });

        await new KubernetesRunner(d).run(RUN);

        const request = d.calls[0] as { args: string[] };
        expect(request.args[0]).toContain(WORKSPACE_PATH);
        expect(request.args[0]).not.toContain("'/tmp/ws'");
    });

    test('returns the framed body as stdout and the rest as stderr', async () => {
        // The whole reason for the frame: these two must not be conflated.
        const d = dispatcher({ logs: framedLog('{"Results":[]}', 'WARN: db is stale') });

        const result = await new KubernetesRunner(d).run(RUN);

        expect(result.stdout).toBe('{"Results":[]}');
        expect(result.stderr).toBe('WARN: db is stale');
    });

    test('a failed scanner keeps its exit code, so the orchestrator can judge it', async () => {
        const d = dispatcher({ exitCode: 1, logs: framedLog('') });

        const result = await new KubernetesRunner(d).run(RUN);

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe('');
    });

    test('a workspace that never arrived throws rather than reporting an empty scan', async () => {
        // This is the whole point of the wiring: transport failure must reach
        // the orchestrator's catch and become `unavailable`, never a clean scan.
        const d = dispatcher({ transportFailed: true, exitCode: 1 });

        await expect(new KubernetesRunner(d).run(RUN)).rejects.toThrow(/no scan was performed/);
    });

    test('a scan killed at its deadline throws rather than returning a fragment', async () => {
        const d = dispatcher({ timedOut: true, exitCode: 1, logs: framedLog('{"partial":true}') });

        await expect(new KubernetesRunner(d).run(RUN)).rejects.toThrow(/no verdict/);
    });

    test('a missing report frame throws — the container died before emitting', async () => {
        // buildScript emits the frame unconditionally, so its absence is a crash
        // or an OOM kill, never a scanner that legitimately found nothing.
        const d = dispatcher({ exitCode: 0, logs: 'Killed' });

        await expect(new KubernetesRunner(d).run(RUN)).rejects.toThrow(/no usable report/);
    });

    test('a truncated report throws instead of being parsed as a short one', async () => {
        const d = dispatcher({ exitCode: 0, logs: `${BEGIN_MARKER}\n{"Results":[` });

        await expect(new KubernetesRunner(d).run(RUN)).rejects.toThrow(/no usable report/);
    });

    test('a tool with no image is unsupported, not attempted', async () => {
        // Reported up front so the orchestrator marks it unavailable, rather
        // than a Job that fails on ImagePullBackOff minutes later.
        const runner = new KubernetesRunner(dispatcher({}));

        expect(runner.supports('zap')).toBe(false);
        expect(runner.supports('falco')).toBe(false);
        expect(runner.supports('trivy')).toBe(true);
    });

    test('the workspace is always streamed in — a scan of an empty tree is not a scan', async () => {
        const d = dispatcher({ logs: framedLog('{}') });

        await new KubernetesRunner(d).run(RUN);

        const request = d.calls[0] as { withWorkspace: boolean; workspacePath: string };
        expect(request.withWorkspace).toBe(true);
        expect(request.workspacePath).toBe('/tmp/ws');
    });
});
