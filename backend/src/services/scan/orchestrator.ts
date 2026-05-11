import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

// Safety: 5 minute timeout for any individual tool scan
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;

export interface ScanResult {
    tool: 'semgrep' | 'gitleaks' | 'trivy' | 'checkov' | 'bandit';
    stdout: string;
    stderr: string;
    error?: string;
}

/**
 * Verifies that required security CLI tools are installed and accessible.
 */
export const validateTools = async (): Promise<{ tool: string, status: 'installed' | 'missing', version?: string }[]> => {
    const tools = [
        { name: 'semgrep', cmd: 'semgrep --version' },
        { name: 'gitleaks', cmd: 'gitleaks version' },
        { name: 'trivy', cmd: 'trivy --version' },
        { name: 'checkov', cmd: 'checkov --version' },
        { name: 'bandit', cmd: 'bandit --version' }
    ];

    const results = await Promise.all(tools.map(async (t) => {
        try {
            const { stdout } = await execAsync(t.cmd, { timeout: 10000 });
            console.log(`[Tools] ✅ ${t.name} found`);
            return { tool: t.name, status: 'installed' as const, version: stdout.trim().split('\n')[0] };
        } catch (err) {
            console.error(`[Tools] ❌ ${t.name} NOT INSTALLED — findings for this engine will be empty`);
            return { tool: t.name, status: 'missing' as const };
        }
    }));

    return results;
};

export interface ScanOptions {
    scanType?: 'full' | 'sast' | 'sca' | 'secrets';
    scanDepth?: 'standard' | 'deep';
}

/**
 * Helper to run a tool with graceful fallback if missing
 */
const runTool = async (cmd: string, toolName: ScanResult['tool']): Promise<ScanResult> => {
    try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: SCAN_TIMEOUT_MS });
        return { tool: toolName, stdout, stderr };
    } catch (error: any) {
        // Exit code 1 from security tools often just means findings were found, which is not a failure
        if (error.stdout) {
            return { tool: toolName, stdout: error.stdout, stderr: error.stderr || '' };
        }
        
        if (error.killed) {
            console.error(`[Orchestrator] ${toolName} scan TIMED OUT`);
            return { tool: toolName, stdout: '', stderr: 'Scan timed out', error: 'TIMEOUT' };
        }

        console.error(`[Orchestrator] ${toolName} failed or not installed:`, error.message);
        // Graceful fallback: return empty JSON structure so parsers don't crash
        const emptyOutput = toolName === 'trivy' ? '{"Results":[]}' : 
                            toolName === 'checkov' ? '{"results":{"failed_checks":[]}}' : '[]';
        return { tool: toolName, stdout: emptyOutput, stderr: error.message };
    }
};

export const orchestrateScan = async (targetPath: string, options: ScanOptions = { scanType: 'full', scanDepth: 'standard' }) => {
    console.log(`[Orchestrator] Starting parallel scans (Type: ${options.scanType}, Depth: ${options.scanDepth}) for: ${targetPath}`);
    const start = Date.now();

    const tasks: Promise<ScanResult>[] = [];

    // 1. SAST (Semgrep) - Always run for full/sast
    if (options.scanType === 'full' || options.scanType === 'sast') {
        tasks.push(runTool(`semgrep scan --json --config auto "${targetPath}"`, 'semgrep'));
    }

    // 2. Secrets (Gitleaks)
    if (options.scanType === 'full' || options.scanType === 'secrets') {
        tasks.push(runTool(`gitleaks detect --source "${targetPath}" --format json --report-path -`, 'gitleaks'));
    }

    // 3. SCA / Config / Secrets (Trivy)
    if (options.scanType === 'full' || options.scanType === 'sca' || options.scanType === 'secrets') {
        const depth = options.scanDepth === 'deep' ? '--detection-priority comprehensive' : '';
        const scanners = options.scanType === 'sca' ? 'vuln' : options.scanType === 'secrets' ? 'secret' : 'vuln,secret,misconfig';
        tasks.push(runTool(`trivy fs --format json ${depth} --scanners ${scanners} --severity CRITICAL,HIGH,MEDIUM,LOW "${targetPath}"`, 'trivy'));
    }

    // 4. Infrastructure (Checkov)
    if (options.scanType === 'full' || options.scanType === 'sca') {
        tasks.push(runTool(`checkov -d "${targetPath}" --output json --quiet`, 'checkov'));
    }

    // 5. Python SAST (Bandit)
    if (options.scanType === 'full' || options.scanType === 'sast') {
        // We could add a check for .py files here, but runTool handles missing files/failures gracefully
        tasks.push(runTool(`bandit -r "${targetPath}" -f json`, 'bandit'));
    }

    const results = await Promise.allSettled(tasks);

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[Orchestrator] Scans finalized in ${duration}s`);

    return results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean) as ScanResult[];
};
