import fs from 'fs';

export interface NormalizedIssue {
  tool: string;
  type: 'security' | 'reliability' | 'maintainability';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  message: string;
  file: string;
  line: number;
  endLine: number;
  code: string;        // actual code snippet
  effort: string;      // "5min", "2min" etc
  category: string;    // unused-import, sql-injection etc
  ruleId: string;
}

export function normalizeSemgrep(raw: any, workDir: string): NormalizedIssue[] {
  return (raw.results ?? []).map((r: any) => {
    const relativeFile = r.path ?? '';
    const fullPath = fs.existsSync(relativeFile) ? relativeFile : (workDir.endsWith('/') || workDir.endsWith('\\') ? workDir + relativeFile : `${workDir}/${relativeFile}`);
    const line = r.start?.line ?? 0;
    const endLine = r.end?.line ?? line;

    return {
      tool: 'semgrep',
      type: classifyType(r.check_id),
      severity: mapSemgrepSeverity(r.extra?.severity),
      title: r.check_id?.split('.').pop() ?? 'Issue',
      message: r.extra?.message ?? '',
      file: relativeFile,
      line,
      endLine,
      code: extractCodeSnippet(fullPath, line, endLine),
      effort: estimateEffort(r.extra?.severity),
      category: r.check_id ?? '',
      ruleId: r.check_id ?? ''
    };
  });
}

export function normalizeTrivy(raw: any, workDir: string): NormalizedIssue[] {
  const issues: NormalizedIssue[] = [];
  for (const result of raw.Results ?? []) {
    for (const vuln of result.Vulnerabilities ?? []) {
      issues.push({
        tool: 'trivy',
        type: 'security',
        severity: vuln.Severity as any,
        title: vuln.VulnerabilityID,
        message: vuln.Description ?? vuln.Title ?? '',
        file: result.Target ?? '',
        line: 0,
        endLine: 0,
        code: `${vuln.PkgName}@${vuln.InstalledVersion} → fix: ${vuln.FixedVersion ?? 'no fix available'}`,
        effort: estimateEffort(vuln.Severity),
        category: 'dependency-vulnerability',
        ruleId: vuln.VulnerabilityID
      });
    }
  }
  return issues;
}

export function normalizeGitleaks(raw: any[], workDir: string): NormalizedIssue[] {
  return (raw ?? []).map((r: any) => {
    const relativeFile = r.File ?? '';
    const fullPath = fs.existsSync(relativeFile) ? relativeFile : (workDir.endsWith('/') || workDir.endsWith('\\') ? workDir + relativeFile : `${workDir}/${relativeFile}`);
    
    return {
      tool: 'gitleaks',
      type: 'security',
      severity: 'CRITICAL',
      title: r.RuleID ?? 'Secret detected',
      message: `${r.Description ?? 'Hardcoded secret'} found in ${r.File}`,
      file: relativeFile,
      line: r.StartLine ?? 0,
      endLine: r.EndLine ?? r.StartLine ?? 0,
      code: r.Match ? r.Match.replace(/./g, '*').slice(0, 20) + '...' : extractCodeSnippet(fullPath, r.StartLine || 0, r.EndLine || r.StartLine || 0),
      effort: '2min',
      category: 'secret-exposure',
      ruleId: r.RuleID ?? ''
    };
  });
}

function extractCodeSnippet(filePath: string, line: number, endLine: number): string {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const start = Math.max(0, line - 2);
    const end = Math.min(lines.length, endLine + 2);
    return lines.slice(start, end)
      .map((l, i) => `${start + i + 1} | ${l}`)
      .join('\n');
  } catch { return ''; }
}

function estimateEffort(severity: string): string {
  const map: Record<string, string> = {
    CRITICAL: '30min', HIGH: '15min',
    MEDIUM: '10min', LOW: '5min',
    INFO: '2min', WARNING: '5min', ERROR: '15min'
  };
  return map[severity?.toUpperCase()] ?? '5min';
}

function mapSemgrepSeverity(s: string): NormalizedIssue['severity'] {
  const map: Record<string, NormalizedIssue['severity']> = {
    ERROR: 'HIGH', WARNING: 'MEDIUM', INFO: 'LOW'
  };
  return map[s?.toUpperCase()] ?? 'LOW';
}

function classifyType(ruleId: string): NormalizedIssue['type'] {
  const id = ruleId?.toLowerCase() ?? '';
  if (id.includes('sql') || id.includes('xss') || id.includes('inject') ||
      id.includes('secret') || id.includes('auth')) return 'security';
  if (id.includes('null') || id.includes('error') ||
      id.includes('exception') || id.includes('crash')) return 'reliability';
  return 'maintainability';
}
