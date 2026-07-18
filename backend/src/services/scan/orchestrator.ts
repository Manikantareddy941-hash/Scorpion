import * as path from 'path';
import * as fs from 'fs';
import { validateTools } from '../../utils/toolCheck';
import { logger } from '../logger';
import { getRunner } from '../runner';

// Safety: 5 minute timeout for any individual tool scan
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;

export interface ScanResult {
    tool: 'semgrep' | 'gitleaks' | 'trivy' | 'checkov' | 'bandit' | 'hadolint';
    stdout: string;
    stderr: string;
    error?: string;
    status?: number | null;
    /**
     * True when the scanner did not produce a usable verdict — it could not run
     * in this runner mode, failed to start, or emitted nothing on a failure
     * exit. Consumers MUST NOT treat this as a clean result: reporting "0
     * findings" for a scanner that never ran is a security lie.
     */
    unavailable?: boolean;
}

// Dockerfile naming conventions: plain, dotted, and dir/Dockerfile.env variants.
const DOCKERFILE_NAMES = ['Dockerfile', 'dockerfile', 'Dockerfile.dev', 'Dockerfile.prod'];

function findDockerfile(targetPath: string): string | null {
    for (const name of DOCKERFILE_NAMES) {
        const candidate = path.join(targetPath, name);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Runs one scanner through the configured RunnerProvider (containers when a
 * Docker daemon is present, host binaries otherwise).
 *
 * The workspace directory is derived from the arguments: every current scanner
 * takes a filesystem path, and the runner needs it as the mount point / cwd.
 */
const executeTool = async (toolId: string, userArgs: string[], toolName: ScanResult['tool']): Promise<ScanResult> => {
    const workspacePath = userArgs.find(arg => arg.startsWith('/') || /^[a-zA-Z]:/.test(arg)) ?? process.cwd();
    const runner = await getRunner();

    // A scanner this runner mode cannot execute is reported as unavailable, not
    // as a passing scan. Silently returning an empty result would tell the user
    // their code is clean when nothing ever looked at it.
    if (!runner.supports(toolName)) {
        const reason = `${toolName} is not available in ${runner.mode} mode`;
        logger.warn(`[Orchestrator] ${reason}`);
        return { tool: toolName, stdout: '', stderr: reason, error: reason, status: null, unavailable: true };
    }

    try {
        const { stdout, stderr, exitCode } = await runner.run({
            tool: toolId,
            args: userArgs,
            workspacePath,
            timeoutMs: SCAN_TIMEOUT_MS,
        });

        // Most scanners exit non-zero precisely because they found something, so
        // a non-zero code with output is a normal result. A non-zero code with
        // no output at all means the tool did not produce a verdict.
        if (exitCode !== 0 && !stdout) {
            return {
                tool: toolName,
                stdout: '',
                stderr: stderr || `Exit code ${exitCode}`,
                error: `${toolName} produced no output (exit ${exitCode})`,
                status: exitCode,
                unavailable: true,
            };
        }

        return { tool: toolName, stdout, stderr, status: exitCode };
    } catch (err) {
        // Failed to start at all (no daemon, missing binary, timeout).
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[Orchestrator] ${toolName} execution error:`, message);
        return { tool: toolName, stdout: '', stderr: message, error: message, status: null, unavailable: true };
    }
};

export { validateTools };

export interface ScanOptions {
    scanType?: 'full' | 'sast' | 'sca' | 'secrets';
    scanDepth?: 'standard' | 'deep';
}

export const orchestrateScan = async (
    targetPath: string, 
    options: ScanOptions = { scanType: 'full', scanDepth: 'standard' },
    onLog?: (log: string) => void
) => {
    logger.info(`[Orchestrator] Starting parallel scans (Type: ${options.scanType}, Depth: ${options.scanDepth}) for: ${targetPath}`);
    const start = Date.now();

    const runWithLogging = async (tool: string, args: string[], toolName: ScanResult['tool']) => {
        if (onLog) onLog(`[${toolName.toUpperCase()}] Protocol initiated...`);
        const result = await executeTool(tool, args, toolName);
        if (onLog) onLog(`[${toolName.toUpperCase()}] Engine completed.`);
        return result;
    };

    const tasks: Promise<ScanResult>[] = [];

    // 1. SAST (Semgrep)
    if (options.scanType === 'full' || options.scanType === 'sast') {
        tasks.push(runWithLogging('semgrep', ['scan', '--json', '--config', 'auto', targetPath], 'semgrep'));
    }

    // 2. Secrets (Gitleaks)
    if (options.scanType === 'full' || options.scanType === 'secrets') {
        tasks.push(runWithLogging('gitleaks', ['detect', '--source', targetPath, '-f', 'json', '-r', '-'], 'gitleaks'));
    }

    // 3. SCA / Config / Secrets (Trivy)
    if (options.scanType === 'full' || options.scanType === 'sca' || options.scanType === 'secrets') {
        const depth = options.scanDepth === 'deep' ? ['--detection-priority', 'comprehensive'] : [];
        const scanners = options.scanType === 'sca' ? 'vuln,license' : options.scanType === 'secrets' ? 'secret' : 'vuln,secret,misconfig,license';
        tasks.push(runWithLogging('trivy', ['fs', '--format', 'json', ...depth, '--scanners', scanners, '--severity', 'CRITICAL,HIGH,MEDIUM,LOW', targetPath], 'trivy'));
    }

    // 4. Infrastructure (Checkov)
    if (options.scanType === 'full' || options.scanType === 'sca') {
        tasks.push(runWithLogging('checkov', ['-d', targetPath, '--output', 'json', '--quiet'], 'checkov'));
    }

    // 5. Python SAST (Bandit)
    if (options.scanType === 'full' || options.scanType === 'sast') {
        tasks.push(runWithLogging('bandit', ['-r', targetPath, '-f', 'json'], 'bandit'));
    }

    // 6. Dockerfile lint (Hadolint) - only if a Dockerfile is present
    if (options.scanType === 'full' || options.scanType === 'sca') {
        const dockerfile = findDockerfile(targetPath);
        if (dockerfile) {
            tasks.push(runWithLogging('hadolint', ['--format', 'json', dockerfile], 'hadolint'));
        }
    }

    const results = await Promise.allSettled(tasks);

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    logger.info(`[Orchestrator] Scans finalized in ${duration}s`);

    return results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean) as ScanResult[];
};
