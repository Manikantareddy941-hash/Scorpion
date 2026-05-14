import { spawn } from 'child_process';
import * as path from 'path';

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
 * Resolves tool name to executable and args for Windows compatibility (DEP0190 compliant)
 */
const resolveTool = (name: string): { cmd: string, prefixArgs: string[] } => {
    if (!isWin) return { cmd: name, prefixArgs: [] };
    
    if (name === 'checkov') {
        // Windows limitation: .cmd files require a shell. 
        // Calling 'cmd /c checkov' satisfies DEP0190 as args are passed via array.
        return { cmd: 'cmd', prefixArgs: ['/c', 'checkov'] };
    }
    
    const mapping: Record<string, string> = {
        'semgrep': 'semgrep.exe',
        'bandit': 'bandit.exe',
        'gitleaks': 'gitleaks.exe',
        'trivy': 'trivy.exe'
    };
    
    return { cmd: mapping[name] || name, prefixArgs: [] };
};

/**
 * Internal helper to run a CLI tool using spawn (No shell:true, DEP0190 compliant)
 */
const executeTool = async (toolId: string, userArgs: string[], toolName: ScanResult['tool']): Promise<ScanResult> => {
    return new Promise((resolve) => {
        const tool = resolveTool(toolId);
        const finalArgs = [...tool.prefixArgs, ...userArgs];
        let stdout = '';
        let stderr = '';
        
        console.log(`[Orchestrator] Executing: ${tool.cmd} ${finalArgs.join(' ')}`);
        
        const child = spawn(tool.cmd, finalArgs, { timeout: SCAN_TIMEOUT_MS });

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

/**
 * Verifies that required security CLI tools are installed and accessible.
 */
export const validateTools = async (): Promise<{ tool: string, status: 'installed' | 'missing', version?: string }[]> => {
    const tools = ['semgrep', 'gitleaks', 'trivy', 'checkov', 'bandit'];

    const results = await Promise.all(tools.map(async (name) => {
        try {
            const res = await executeTool(name, ['--version'], name as any);
            if (res.stdout || res.status === 0) {
                console.log(`[Tools] ✅ ${name} found`);
                return { tool: name, status: 'installed' as const, version: res.stdout.trim().split('\n')[0] };
            }
            throw new Error('Not found');
        } catch (err) {
            console.error(`[Tools] ❌ ${name} NOT INSTALLED — findings for this engine will be empty`);
            return { tool: name, status: 'missing' as const };
        }
    }));

    return results;
};

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
