export interface Finding {
    tool: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    message: string;
    file_path?: string;
    line_number?: number;
}

export const parseSemgrep = (stdout: string): Finding[] => {
    try {
        const data = JSON.parse(stdout);
        return (data.results || []).map((r: any) => ({
            tool: 'semgrep',
            severity: mapSemgrepSeverity(r.extra?.severity),
            message: r.extra?.message || r.check_id,
            file_path: r.path,
            line_number: r.start?.line
        }));
    } catch (e) {
        console.error('[Parser] Semgrep error:', e);
        return [];
    }
};

const mapSemgrepSeverity = (sev: string): Finding['severity'] => {
    switch (sev?.toUpperCase()) {
        case 'ERROR': return 'high';
        case 'WARNING': return 'medium';
        case 'INFO': return 'low';
        default: return 'info';
    }
};

export const parseGitleaks = (stdout: string): Finding[] => {
    try {
        if (!stdout.trim()) return [];
        const data = JSON.parse(stdout);
        return data.map((l: any) => ({
            tool: 'gitleaks',
            severity: 'critical', // Secrets are almost always critical
            message: `Secret detected: ${l.Description} (Rule: ${l.RuleID})`,
            file_path: l.File,
            line_number: l.StartLine
        }));
    } catch (e) {
        console.error('[Parser] Gitleaks error:', e);
        return [];
    }
};

export const parseTrivy = (stdout: string): Finding[] => {
    try {
        const data = JSON.parse(stdout);
        const findings: Finding[] = [];

        (data.Results || []).forEach((res: any) => {
            (res.Vulnerabilities || []).forEach((v: any) => {
                findings.push({
                    tool: 'trivy',
                    severity: mapTrivySeverity(v.Severity),
                    message: `${v.PkgName}: ${v.Title || v.Description}`,
                    file_path: res.Target,
                    line_number: undefined // Trivy for packages usually doesn't have line numbers
                });
            });
        });

        return findings;
    } catch (e) {
        console.error('[Parser] Trivy error:', e);
        return [];
    }
};

const mapTrivySeverity = (sev: string): Finding['severity'] => {
    switch (sev?.toUpperCase()) {
        case 'CRITICAL': return 'critical';
        case 'HIGH': return 'high';
        case 'MEDIUM': return 'medium';
        case 'LOW': return 'low';
        default: return 'info';
    }
};
