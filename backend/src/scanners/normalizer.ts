import fs from 'fs';
import { GitleaksRawMatch } from '../services/leakedKeyResponseService';
import {
  BanditRawOutput,
  CheckovFailedCheck,
  CheckovRawOutput,
  SemgrepRawOutput,
  TrivyRawOutput
} from '../types/scan.types';

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

export function normalizeSemgrep(raw: SemgrepRawOutput, workDir: string): NormalizedIssue[] {
  return (raw.results ?? []).map(r => {
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

export function normalizeTrivy(raw: TrivyRawOutput, _workDir: string): NormalizedIssue[] {
  const issues: NormalizedIssue[] = [];
  for (const result of raw.Results ?? []) {
    for (const vuln of result.Vulnerabilities ?? []) {
      issues.push({
        tool: 'trivy',
        type: 'security',
        severity: vuln.Severity as NormalizedIssue['severity'],
        title: vuln.VulnerabilityID ?? '',
        message: vuln.Description ?? vuln.Title ?? '',
        file: result.Target ?? '',
        line: 0,
        endLine: 0,
        code: `${vuln.PkgName}@${vuln.InstalledVersion} → fix: ${vuln.FixedVersion ?? 'no fix available'}`,
        effort: estimateEffort(vuln.Severity ?? ''),
        category: 'dependency-vulnerability',
        ruleId: vuln.VulnerabilityID ?? ''
      });
    }
  }
  return issues;
}

export function normalizeGitleaks(raw: GitleaksRawMatch[], workDir: string): NormalizedIssue[] {
  return (raw ?? []).map(r => {
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

function estimateEffort(severity?: string): string {
  const map: Record<string, string> = {
    CRITICAL: '30min', HIGH: '15min',
    MEDIUM: '10min', LOW: '5min',
    INFO: '2min', WARNING: '5min', ERROR: '15min'
  };
  return map[severity?.toUpperCase() ?? ''] ?? '5min';
}

function mapSemgrepSeverity(s?: string): NormalizedIssue['severity'] {
  const map: Record<string, NormalizedIssue['severity']> = {
    ERROR: 'HIGH', WARNING: 'MEDIUM', INFO: 'LOW'
  };
  return map[s?.toUpperCase() ?? ''] ?? 'LOW';
}

function classifyType(ruleId?: string): NormalizedIssue['type'] {
  const id = ruleId?.toLowerCase() ?? '';
  if (id.includes('sql') || id.includes('xss') || id.includes('inject') ||
      id.includes('secret') || id.includes('auth')) return 'security';
  if (id.includes('null') || id.includes('error') ||
      id.includes('exception') || id.includes('crash')) return 'reliability';
  return 'maintainability';
}

export function normalizeCheckov(raw: CheckovRawOutput | CheckovRawOutput[], workDir: string): NormalizedIssue[] {
  const results = Array.isArray(raw) ? raw : [raw];
  const issues: NormalizedIssue[] = [];

  results.forEach(result => {
    const failed: CheckovFailedCheck[] = result.results?.failed_checks || [];
    failed.forEach(c => {
      const relativeFile = c.file_path ?? '';
      const fullPath = fs.existsSync(relativeFile) ? relativeFile : (workDir.endsWith('/') || workDir.endsWith('\\') ? workDir + relativeFile : `${workDir}/${relativeFile}`);
      const line = c.file_line_range?.[0] ?? 0;
      const endLine = c.file_line_range?.[1] ?? line;

      issues.push({
        tool: 'checkov',
        type: 'security',
        severity: mapCheckovSeverity(c.severity ?? c.check_severity),
        title: c.check_id ?? 'Misconfiguration',
        message: c.check_name ?? '',
        file: relativeFile,
        line,
        endLine,
        code: extractCodeSnippet(fullPath, line, endLine),
        effort: '10min',
        category: 'iac-misconfig',
        ruleId: c.check_id ?? ''
      });
    });
  });

  return issues;
}

function mapCheckovSeverity(s?: string): NormalizedIssue['severity'] {
  switch (s?.toUpperCase()) {
    case 'CRITICAL': return 'CRITICAL';
    case 'HIGH':     return 'HIGH';
    case 'LOW':      return 'LOW';
    case 'INFO':     return 'INFO';
    default:         return 'MEDIUM';
  }
}

export function normalizeBandit(raw: BanditRawOutput, workDir: string): NormalizedIssue[] {
  return (raw.results ?? []).map(r => {
    const relativeFile = r.filename ?? '';
    const fullPath = fs.existsSync(relativeFile) ? relativeFile : (workDir.endsWith('/') || workDir.endsWith('\\') ? workDir + relativeFile : `${workDir}/${relativeFile}`);
    const line = r.line_number ?? 0;

    return {
      tool: 'bandit',
      type: 'security',
      severity: mapBanditSeverity(r.issue_severity),
      title: r.test_id ?? 'Bandit Issue',
      message: r.issue_text ?? '',
      file: relativeFile,
      line,
      endLine: line,
      code: extractCodeSnippet(fullPath, line, line),
      effort: estimateEffort(r.issue_severity),
      category: r.test_id ?? '',
      ruleId: r.test_id ?? ''
    };
  });
}

function mapBanditSeverity(s?: string): NormalizedIssue['severity'] {
  switch (s?.toUpperCase()) {
    case 'HIGH': return 'HIGH';
    case 'MEDIUM': return 'MEDIUM';
    case 'LOW': return 'LOW';
    default: return 'INFO';
  }
}
