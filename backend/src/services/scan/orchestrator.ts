import { spawn } from 'child_process';
import * as path from 'path';
import { resolveToolCommand, validateTools } from '../../utils/toolCheck';

// Safety: 5 minute timeout for any individual tool scan
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;
const isWin = process.platform === 'win32';

export interface ScanResult {
    tool: 'semgrep' | 'gitleaks' | 'trivy' | 'checkov' | 'bandit';
    stdout: string;
    stderr: string;
    error?: string;
    status?: number | null;
}

/**
 * Internal helper to run a CLI tool using spawn (No shell:true, DEP0190 compliant unless cmd is wrapped on Windows)
 */
const executeTool = async (toolId: string, userArgs: string[], toolName: ScanResult['tool']): Promise<ScanResult> => {
    const tool = await resolveToolCommand(toolId);
    return new Promise((resolve) => {
        const finalArgs = [...tool.prefixArgs, ...userArgs];
        let stdout = '';
        let stderr = '';
        
        console.log(`[Orchestrator] Executing: ${tool.cmd} ${finalArgs.join(' ')}`);
        
        const options: any = { timeout: SCAN_TIMEOUT_MS };
        if (isWin && tool.cmd === 'cmd') {
            options.shell = true;
        }

        const child = spawn(tool.cmd, finalArgs, options);

        child.stdout?.on('data', (data) => { stdout += data.toString(); });
        child.stderr?.on('data', (data) => { stderr += data.toString(); });

        child.on('error', (err: any) => {
            console.error(`[Orchestrator] ${toolName} execution error:`, err.message);
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
    console.log(`[Orchestrator] Starting parallel scans (Type: ${options.scanType}, Depth: ${options.scanDepth}) for: ${targetPath}`);
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
        const scanners = options.scanType === 'sca' ? 'vuln' : options.scanType === 'secrets' ? 'secret' : 'vuln,secret,misconfig';
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

    const results = await Promise.allSettled(tasks);

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[Orchestrator] Scans finalized in ${duration}s`);

    return results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean) as ScanResult[];
};
