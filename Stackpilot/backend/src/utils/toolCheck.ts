import { execSync } from "child_process";
import path from "path";

// Paths to local portable binaries (relative to project root)
// Backend runs from project/backend/, so we step up one level to reach project/tools/
const toolPaths: Record<string, string> = {
    semgrep: "semgrep",
    gitleaks: path.resolve(__dirname, "../../../tools/gitleaks/gitleaks.exe"),
    trivy: path.resolve(__dirname, "../../../tools/trivy/trivy.exe"),
};

export const checkTool = (cmd: string): boolean => {
    const resolvedCmd = toolPaths[cmd] ?? cmd;
    const versionFlag = cmd === "gitleaks" ? "version" : "--version";
    try {
        execSync(`"${resolvedCmd}" ${versionFlag}`, { stdio: "ignore" });
        return true;
    } catch {
        // Fallback: try the raw system command (in case it is on PATH)
        try {
            execSync(`${cmd} ${versionFlag}`, { stdio: "ignore" });
            return true;
        } catch {
            return false;
        }
    }
};
