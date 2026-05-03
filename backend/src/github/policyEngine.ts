export interface PolicyConfig {
  blockOn: {
    critical: number;
    high: number;
    secrets: number;
  };
}

export const DEFAULT_POLICY: PolicyConfig = {
  blockOn: {
    critical: 1,    // block if ANY critical CVE found
    high: 5,        // block if 5+ high CVEs found
    secrets: 1      // block if ANY secret detected
  }
};

export interface PolicyResult {
  passed: boolean;
  criticalCount: number;
  highCount: number;
  secretCount: number;
  sastCount: number;
  summary: string;
}

export function evaluatePolicy(scanResults: any, policy: PolicyConfig = DEFAULT_POLICY): PolicyResult {
  const criticalCount = countBySeverity(scanResults.trivy, 'CRITICAL');
  const highCount     = countBySeverity(scanResults.trivy, 'HIGH');
  const secretCount   = Array.isArray(scanResults.gitleaks) ? scanResults.gitleaks.length : 0;
  const sastCount     = scanResults.semgrep?.results?.length ?? 0;

  const passed = (
    criticalCount < policy.blockOn.critical &&
    highCount     < policy.blockOn.high &&
    secretCount   < policy.blockOn.secrets
  );

  return {
    passed,
    criticalCount,
    highCount,
    secretCount,
    sastCount,
    summary: passed
      ? `Clean — ${criticalCount} critical, ${highCount} high, ${secretCount} secrets`
      : `Policy violated`
  };
}

function countBySeverity(trivyResult: any, severity: string): number {
  if (!trivyResult || !trivyResult.Results) return 0;
  let count = 0;
  trivyResult.Results.forEach((res: any) => {
    if (res.Vulnerabilities) {
      count += res.Vulnerabilities.filter((v: any) => v.Severity === severity).length;
    }
  });
  return count;
}
