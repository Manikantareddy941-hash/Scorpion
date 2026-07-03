import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { resolveToolCommand, validateTools } from '../../utils/toolCheck';
import { logger } from '../logger';

// Safety: 5 minute timeout for any individual tool scan
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;
const isWin = process.platform === 'win32';

export interface ScanResult {
    tool: 'semgrep' | 'gitleaks' | 'trivy' | 'checkov' | 'bandit' | 'hadolint';
    stdout: string;
    stderr: string;
    error?: string;
    status?: number | null;
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
 * Internal helper to run a CLI tool using Docker
 */
const executeTool = async (toolId: string, userArgs: string[], toolName: ScanResult['tool']): Promise<ScanResult> => {
    return new Promise((resolve) => {
        const imageMap: Record<string, string> = {
            semgrep: 'semgrep/semgrep:latest',
            gitleaks: 'zricethezav/gitleaks:latest',
            trivy: 'aquasec/trivy:latest',
            checkov: 'bridgecrew/checkov:latest',
            bandit: 'bandit:latest',
            hadolint: 'hadolint/hadolint:latest'
        };
        const image = imageMap[toolName] ?? toolName;

        // The caller supplies the absolute path to the repository (targetPath). We mount it
        // into the container at /src and rewrite any argument that points to the original path
        // to use the container-internal path. This works because all current scanners accept a
        // filesystem path argument (e.g., "semgrep scan … <path>", "trivy fs … <path>").
        const mountPath = userArgs.find(arg => arg.startsWith('/') || /^[a-zA-Z]:/.test(arg)) ?? '';
        const containerPath = '/src';
        const rewrittenArgs = userArgs.map(arg => (arg === mountPath ? containerPath : arg));

        // Build docker run command
        const dockerArgs = [
            'run', '--rm',
            '-v', `${mountPath}:${containerPath}`,
            '-w', containerPath,
            image,
            ...rewrittenArgs
        ];

        let stdout = '';
        let stderr = '';
        logger.info(`[Orchestrator] Executing Docker: docker ${dockerArgs.join(' ')}`);
        const child = spawn('docker', dockerArgs, { timeout: SCAN_TIMEOUT_MS });

        child.stdout?.on('data', (data) => { stdout += data.toString(); });
        child.stderr?.on('data', (data) => { stderr += data.toString(); });

        child.on('error', (err: any) => {
            logger.error(`[Orchestrator] ${toolName} Docker execution error:`, err.message);
            const emptyOutput = toolName === 'trivy' ? '{"Results":[]}' :
                toolName === 'checkov' ? '{"results":{"failed_checks":[]}}' : '[]';
            resolve({ tool: toolName, stdout: emptyOutput, stderr: err.message, status: null });
        });

        child.on('close', (code) => {
            if (code !== 0 && !stdout) {
                const emptyOutput = toolName === 'trivy' ? '{"Results":[]}' :
                    toolName === 'checkov' ? '{"results":{"failed_checks":[]}}' : '[]';
                resolve({ tool: toolName, stdout: emptyOutput, stderr: `Exit code ${code}`, status: code });
            } else {
                resolve({ tool: toolName, stdout, stderr, status: code });
            }
        });
    });
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
