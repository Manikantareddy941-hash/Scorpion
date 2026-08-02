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

    test('stderr is captured and replayed onto stdout ahead of the frame', () => {
        // stdout and stderr are separate pipes merged by the kubelet with no
        // ordering guarantee, so diagnostics left on stderr can surface BETWEEN
        // the markers and corrupt the report. Replaying them onto the one
        // stream puts the shell in charge of the order.
        const script = buildScript('trivy', ['fs']);

        expect(script).toContain('2>/tmp/stderr.log');
        expect(script).toContain('cat /tmp/stderr.log');
        expect(script.indexOf('cat /tmp/stderr.log')).toBeLessThan(script.indexOf(BEGIN_MARKER));
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

    describe('the canary', () => {
        const canaryOf = (d: { calls: unknown[] }) =>
            (d.calls[0] as { extraFiles?: { name: string; content: string }[] }).extraFiles!;
        const GITLEAKS = { ...RUN, tool: 'gitleaks', args: ['detect', '--source', '/tmp/ws'] };

        test('is injected for gitleaks and required back in its report', async () => {
            // Two-phase: read the planted marker, then answer with a report
            // that mentions it, the way a working scanner would.
            const runner = new KubernetesRunner({
                run: async (request) => {
                    const marker = (request.extraFiles ?? [])[0].name.match(/\.scorpion-canary-(\w+)/)![1];
                    return { exitCode: 0, timedOut: false, logs: framedLog(JSON.stringify([
                        { File: `.scorpion-canary-${marker}/credentials`, RuleID: 'aws-access-token' },
                        { File: 'src/app.ts', RuleID: 'generic-api-key' },
                    ])) };
                },
            });

            const result = await runner.run(GITLEAKS);

            expect(JSON.parse(result.stdout)).toEqual([{ File: 'src/app.ts', RuleID: 'generic-api-key' }]);
        });

        test('never reaches the caller — a synthetic credential on a dashboard is its own incident', async () => {
            const runner = new KubernetesRunner({
                run: async (request) => {
                    const marker = (request.extraFiles ?? [])[0].name.match(/\.scorpion-canary-(\w+)/)![1];
                    return { exitCode: 0, timedOut: false, logs: framedLog(JSON.stringify([
                        { File: `.scorpion-canary-${marker}/credentials`, Match: 'AKIAEXAMPLEEXAMPLE00' },
                    ])) };
                },
            });

            const result = await runner.run(GITLEAKS);

            expect(result.stdout).not.toMatch(/scorpion-canary/);
            expect(result.stdout).not.toMatch(/AKIA/);
        });

        test('a report without the canary is refused — detection was suppressed or broken', async () => {
            // The scanner ran and answered. It just did not find a secret
            // planted directly in its path, so its "clean" verdict is
            // unsupported.
            const d = dispatcher({ logs: framedLog('[]') });

            await expect(new KubernetesRunner(d).run(GITLEAKS)).rejects.toThrow(/canary was not detected/);
        });

        test('a report that cannot be parsed is refused, not forwarded', async () => {
            // Unparseable means unscrubbable, and forwarding it would leak the
            // planted credential.
            const d = dispatcher({ logs: framedLog('not json at all') });

            await expect(new KubernetesRunner(d).run(GITLEAKS)).rejects.toThrow(/could not be verified or removed/);
        });

        test('an empty report is left to the orchestrator rather than blamed on the canary', async () => {
            // A crashed scanner produces nothing; the existing `exitCode !== 0
            // && !stdout` rule already marks that unavailable. Demanding a
            // canary here would report a crash as a trust failure.
            const d = dispatcher({ exitCode: 2, logs: framedLog('') });

            const result = await new KubernetesRunner(d).run(GITLEAKS);

            expect(result.stdout).toBe('');
            expect(result.exitCode).toBe(2);
        });

        test('is not planted for tools that could not detect it', async () => {
            const d = dispatcher({ logs: framedLog('{}') });

            await new KubernetesRunner(d).run(RUN);

            expect(canaryOf(d)).toBeUndefined();
        });
    });

    test('the workspace is always streamed in — a scan of an empty tree is not a scan', async () => {
        const d = dispatcher({ logs: framedLog('{}') });

        await new KubernetesRunner(d).run(RUN);

        const request = d.calls[0] as { withWorkspace: boolean; workspacePath: string };
        expect(request.withWorkspace).toBe(true);
        expect(request.workspacePath).toBe('/tmp/ws');
    });
});
