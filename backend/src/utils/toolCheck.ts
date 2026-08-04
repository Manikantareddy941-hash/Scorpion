import { spawnSync } from "child_process";
import { logger } from '../services/logger';

const isWin = process.platform === 'win32';

export interface ResolvedCommand {
    cmd: string;
    prefixArgs: string[];
    status: 'installed' | 'missing';
    version?: string;
}

const cache = new Map<string, ResolvedCommand>();

const getVersionFlag = (toolName: string): string => {
    if (toolName === 'gitleaks' || toolName === 'opa' || toolName === 'cosign') {
        return 'version';
    }
    return '--version';
};

const performResolution = async (toolName: string): Promise<ResolvedCommand> => {
    const versionFlag = getVersionFlag(toolName);

    if (!isWin) {
        // Unix-like system resolution
        try {
            const checkWhich = spawnSync('which', [toolName]);
            if (checkWhich.status === 0) {
                const versionCheck = spawnSync(toolName, [versionFlag]);
                const version = versionCheck.status === 0 ? versionCheck.stdout.toString().trim().split('\n')[0] : undefined;
                return {
                    cmd: toolName,
                    prefixArgs: [],
                    status: 'installed',
                    version
                };
            }
        } catch {
            // Ignore
        }
        return {
            cmd: toolName,
            prefixArgs: [],
            status: 'missing'
        };
    }

    // Windows candidates to try in order:
    // 1. toolName
    // 2. toolName.exe
    // 3. python -m toolName
    // 4. cmd /c toolName
    const candidates = [
        { cmd: toolName, prefixArgs: [], checkName: toolName },
        { cmd: `${toolName}.exe`, prefixArgs: [], checkName: `${toolName}.exe` },
        { cmd: 'python', prefixArgs: ['-m', toolName], checkName: 'python' },
        { cmd: 'cmd', prefixArgs: ['/c', toolName], checkName: 'cmd' }
    ];

    for (const cand of candidates) {
        try {
            // 1. Check if the binary exists in PATH using where
            const checkWhere = spawnSync('where', [cand.checkName]);
            if (checkWhere.status === 0) {
                // 2. Verify that running it with the version flag actually succeeds (status === 0)
                const checkRun = spawnSync(cand.cmd, [...cand.prefixArgs, versionFlag]);
                if (checkRun.status === 0) {
                    const version = checkRun.stdout.toString().trim().split('\n')[0] || undefined;
                    return {
                        cmd: cand.cmd,
                        prefixArgs: cand.prefixArgs,
                        status: 'installed',
                        version
                    };
                }
            }
        } catch {
            // Ignore and try next
        }
    }

    // Fallback if none resolved successfully
    return {
        cmd: toolName === 'checkov' ? 'cmd' : `${toolName}.exe`,
        prefixArgs: toolName === 'checkov' ? ['/c', 'checkov'] : [],
        status: 'missing'
    };
};

export const resolveToolCommand = async (toolName: string): Promise<ResolvedCommand> => {
    const cached = cache.get(toolName);
    // Only a successful resolution is remembered. A 'missing' result is
    // deliberately not cached: this map has no TTL, so one failed lookup — a
    // slow PATH at boot, a sidecar that mounts its tools late — would pin the
    // answer to "missing" for the life of the process. That was survivable while
    // an unresolvable tool merely skipped a check. Now that an unresolvable
    // cosign blocks every deploy of a signed image (deployService 5b), a cached
    // negative is an outage that outlives its cause and clears only on restart.
    //
    // The cost is re-probing a genuinely absent tool on each call: two spawnSync
    // calls, on a path that is about to fail anyway.
    if (cached?.status === 'installed') {
        return cached;
    }

    const resolved = await performResolution(toolName);
    if (resolved.status === 'installed') {
        cache.set(toolName, resolved);
    }
    return resolved;
};

export const checkTool = (cmd: string): boolean => {
    if (cache.has(cmd)) {
        return cache.get(cmd)!.status === 'installed';
    }
    
    // Synchronous fallback
    const versionFlag = getVersionFlag(cmd);
    if (!isWin) {
        try {
            const check = spawnSync('which', [cmd]);
            return check.status === 0;
        } catch {
            return false;
        }
    }
    
    const candidates = [
        { cmd, prefixArgs: [] },
        { cmd: `${cmd}.exe`, prefixArgs: [] },
        { cmd: 'python', prefixArgs: ['-m', cmd] },
        { cmd: 'cmd', prefixArgs: ['/c', cmd] }
    ];
    for (const cand of candidates) {
        try {
            const check = spawnSync(cand.cmd, [...cand.prefixArgs, versionFlag]);
            if (check.status === 0) {
                return true;
            }
        } catch {
            // Ignore
        }
    }
    return false;
};

export const initToolCache = async (): Promise<void> => {
    const tools = ['semgrep', 'gitleaks', 'trivy', 'checkov', 'bandit', 'opa'];
    for (const tool of tools) {
        await resolveToolCommand(tool);
    }
};

export const validateTools = async (): Promise<{ tool: string, status: 'installed' | 'missing', version?: string }[]> => {
    const tools = ['semgrep', 'gitleaks', 'trivy', 'checkov', 'bandit', 'opa'];
    
    const results = await Promise.all(tools.map(async (name) => {
        const resolved = await resolveToolCommand(name);
        if (resolved.status === 'installed') {
            logger.info(`[Tools] ✅ ${name} found`);
            return { tool: name, status: 'installed' as const, version: resolved.version };
        } else {
            logger.error(`[Tools] ❌ ${name} NOT INSTALLED — ${name === 'opa' ? 'policy-as-code evaluation will be unavailable' : 'findings for this engine will be empty'}`);
            return { tool: name, status: 'missing' as const };
        }
    }));

    return results;
};

