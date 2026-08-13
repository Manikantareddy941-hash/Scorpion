import { logger, errorContext } from '../logger';
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
        // One key across all six parsers, discriminated by `tool`. Six separate
        // keys for "the parser threw" would fragment the query that actually
        // matters — how often parsing drops findings — across six names.
        logger.error('[Parser] Semgrep error:', { event: 'SCAN_PARSE_FAILED', tool: 'semgrep', ...errorContext(e) });
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
        logger.error('[Parser] Gitleaks error:', { event: 'SCAN_PARSE_FAILED', tool: 'gitleaks', ...errorContext(e) });
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
                    // Never persist the actual matched secret value - storing it
                    // in plaintext findings turns a DB breach into a secrets leak too.
                    message: `[SECRET] ${s.Title || 'Credential detected'}`,
                    file_path: res.Target,
                    line_number: s.StartLine
                });
            });
        });

        return findings;
    } catch (e) {
        logger.error('[Parser] Trivy error:', { event: 'SCAN_PARSE_FAILED', tool: 'trivy', ...errorContext(e) });
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
        logger.error('[Parser] Checkov error:', { event: 'SCAN_PARSE_FAILED', tool: 'checkov', ...errorContext(e) });
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
        logger.error('[Parser] Bandit error:', { event: 'SCAN_PARSE_FAILED', tool: 'bandit', ...errorContext(e) });
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

// Hadolint parser - Dockerfile lint
export const parseHadolint = (stdout: string): Finding[] => {
    try {
        if (!stdout || !stdout.trim()) return [];
        const data = JSON.parse(stdout);
        return (Array.isArray(data) ? data : []).map((h: any) => ({
            tool: 'hadolint',
            severity: mapHadolintSeverity(h.level),
            message: `[DOCKERFILE] ${h.code}: ${h.message}`,
            file_path: h.file,
            line_number: h.line,
        }));
    } catch (e) {
        logger.error('[Parser] Hadolint error:', { event: 'SCAN_PARSE_FAILED', tool: 'hadolint', ...errorContext(e) });
        return [];
    }
};

const mapHadolintSeverity = (level: string): Finding['severity'] => {
    switch (level?.toLowerCase()) {
        case 'error': return 'high';
        case 'warning': return 'medium';
        case 'info': return 'low';
        case 'style': return 'info';
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
