export interface Finding {
    tool: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    message: string;
    file_path?: string;
    line_number?: number;
    package?: string;
    version?: string;
    fixVersion?: string;
    cvss_score?: number;
}

export const parseSemgrep = (stdout: string): Finding[] => {
    try {
        const data = JSON.parse(stdout);
        return (data.results || []).map((r: any) => ({
            tool: 'semgrep',
            severity: mapSemgrepSeverity(r.extra?.severity),
            message: r.extra?.message || r.check_id,
            file_path: r.path,
            line_number: r.start?.line,
            package: undefined,
            version: undefined,
            fixVersion: undefined
        }));
    } catch (e) {
        console.error('[Parser] Semgrep error:', e);
        return [];
    }
};

const mapSemgrepSeverity = (sev: string): Finding['severity'] => {
    switch (sev?.toUpperCase()) {
        case 'CRITICAL': return 'critical';
        case 'ERROR': return 'high';
        case 'WARNING': return 'medium';
        case 'INFO': return 'info';
        default: return 'info';
    }
};

export const parseGitleaks = (stdout: string): Finding[] => {
    try {
        if (!stdout || !stdout.trim() || stdout.trim() === 'null') return [];
        const data = JSON.parse(stdout);
        return data.map((l: any) => ({
            tool: 'gitleaks',
            severity: 'critical', // Secrets are almost always critical
            message: `Secret detected: ${l.Description} (Rule: ${l.RuleID})`,
            file_path: l.File,
            line_number: l.StartLine,
            package: undefined,
            version: undefined,
            fixVersion: undefined
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
            // 1. Vulnerabilities (CVEs)
            (res.Vulnerabilities || []).forEach((v: any) => {
                findings.push({
                    tool: 'trivy',
                    severity: mapTrivySeverity(v.Severity),
                    message: `[VULN] ${v.PkgName}: ${v.Title || v.Description}${v.FixedVersion ? ` (Fix available in ${v.FixedVersion})` : ' (No fix available)'}`,
                    file_path: res.Target,
                    line_number: undefined, 
                    package: v.PkgName || undefined,
                    version: v.InstalledVersion || undefined,
                    fixVersion: v.FixedVersion || undefined,
                    cvss_score: v.CVSS?.nvd?.V3Score || v.CVSS?.redhat?.V3Score || v.CVSS?.ghsa?.V3Score
                });
            });

            // 2. Misconfigurations (IaC, Config)
            (res.Misconfigurations || []).forEach((m: any) => {
                findings.push({
                    tool: 'trivy',
                    severity: mapTrivySeverity(m.Severity),
                    message: `[CONFIG] ${m.ID}: ${m.Title || m.Message}`,
                    file_path: res.Target || m.PrimaryURL,
                    line_number: m.CauseMetadata?.StartLine ?? undefined,
                });
            });

            // 3. Secrets (Hardcoded keys, tokens)
            (res.Secrets || []).forEach((s: any) => {
                findings.push({
                    tool: 'trivy',
                    severity: mapTrivySeverity(s.Severity),
                    message: `[SECRET] ${s.Title}: ${s.Match || 'Credential detected'}`,
                    file_path: res.Target,
                    line_number: s.StartLine
                });
            });
        });

        return findings;
    } catch (e) {
        console.error('[Parser] Trivy error:', e);
        return [];
    }
};

// Checkov parser - IaC misconfigurations
export const parseCheckov = (stdout: string): Finding[] => {
    try {
        const data = JSON.parse(stdout);
        const results = Array.isArray(data) ? data : [data];
        const findings: Finding[] = [];

        results.forEach((result: any) => {
            const failed = result.results?.failed_checks || [];
            failed.forEach((c: any) => {
                findings.push({
                    tool: 'checkov',
                    severity: mapCheckovSeverity(c.severity ?? c.check_severity),
                    message: `[IaC] ${c.check_id}: ${c.check_name}`,
                    file_path: c.file_path,
                    line_number: c.file_line_range?.[0],
                });
            });
        });

        return findings;
    } catch (e) {
        console.error('[Parser] Checkov error:', e);
        return [];
    }
};

const mapCheckovSeverity = (sev?: string): Finding['severity'] => {
    switch (sev?.toUpperCase()) {
        case 'CRITICAL': return 'critical';
        case 'HIGH':     return 'high';
        case 'LOW':      return 'low';
        case 'INFO':     return 'info';
        default:         return 'medium';
    }
};

// Bandit parser - Python SAST
export const parseBandit = (stdout: string): Finding[] => {
    try {
        const data = JSON.parse(stdout);
        return (data.results || []).map((r: any) => ({
            tool: 'bandit',
            severity: mapBanditSeverity(r.issue_severity),
            message: `[SAST] ${r.test_id}: ${r.issue_text}`,
            file_path: r.filename,
            line_number: r.line_number,
        }));
    } catch (e) {
        console.error('[Parser] Bandit error:', e);
        return [];
    }
};

const mapBanditSeverity = (sev: string): Finding['severity'] => {
    switch (sev?.toUpperCase()) {
        case 'HIGH': return 'high';
        case 'MEDIUM': return 'medium';
        case 'LOW': return 'low';
        default: return 'info';
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
