import { spawnSync } from "child_process";

const isWin = process.platform === 'win32';
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

export const checkTool = (cmd: string): boolean => {
    const tool = resolveTool(cmd);
    const versionFlag = cmd === "gitleaks" ? "version" : "--version";
    try {
        const res = spawnSync(tool.cmd, [...tool.prefixArgs, versionFlag], { stdio: "ignore" });
        return res.status === 0;
    } catch {
        return false;
    }
};
