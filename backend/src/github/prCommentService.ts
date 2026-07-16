import { logger } from '../services/logger';

export const PR_COMMENT_MARKER = '<!-- scorpion-security-report -->';

const TOP_FINDINGS = 10;
const COLLAPSED_FINDINGS = 50;
// GitHub rejects issue comments over 65536 chars; leave headroom for the footer.
const MAX_COMMENT_LENGTH = 60000;

interface TrivyVulnerability {
  VulnerabilityID?: string;
  Severity?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Title?: string;
}

interface TrivyReport {
  Results?: Array<{ Target?: string; Vulnerabilities?: TrivyVulnerability[] }>;
}

interface SemgrepReport {
  results?: Array<{
    check_id?: string;
    path?: string;
    start?: { line?: number };
    extra?: { severity?: string; message?: string };
  }>;
}

interface GitleaksFinding {
  RuleID?: string;
  File?: string;
  StartLine?: number;
  Description?: string;
}

export interface PrScanResults {
  trivy: TrivyReport;
  semgrep: SemgrepReport;
  gitleaks: GitleaksFinding[] | unknown;
}

export interface PrGateResult {
  passed: boolean;
  criticalCount: number;
  highCount: number;
  secretCount: number;
  sastCount: number;
  summary: string;
  denyReasons: string[];
}

interface FindingRow {
  severity: string;
  source: string;
  finding: string;
  location: string;
}

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4
};

const SEMGREP_SEVERITY: Record<string, string> = {
  ERROR: 'HIGH',
  WARNING: 'MEDIUM',
  INFO: 'LOW'
};

function collectFindings(results: PrScanResults): FindingRow[] {
  const rows: FindingRow[] = [];

  for (const res of results.trivy?.Results ?? []) {
    for (const v of res.Vulnerabilities ?? []) {
      const fix = v.FixedVersion ? ` → fix: ${v.FixedVersion}` : '';
      rows.push({
        severity: (v.Severity ?? 'UNKNOWN').toUpperCase(),
        source: 'SCA',
        finding: `${v.VulnerabilityID ?? 'unknown'} — ${v.Title ?? v.PkgName ?? ''}`,
        location: `${v.PkgName ?? '?'}@${v.InstalledVersion ?? '?'}${fix}`
      });
    }
  }

  for (const r of results.semgrep?.results ?? []) {
    rows.push({
      severity: SEMGREP_SEVERITY[(r.extra?.severity ?? '').toUpperCase()] ?? 'MEDIUM',
      source: 'SAST',
      finding: r.check_id ?? 'semgrep rule',
      location: `${r.path ?? '?'}:${r.start?.line ?? '?'}`
    });
  }

  const leaks = Array.isArray(results.gitleaks) ? (results.gitleaks as GitleaksFinding[]) : [];
  for (const leak of leaks) {
    rows.push({
      severity: 'CRITICAL',
      source: 'Secret',
      finding: leak.RuleID ?? leak.Description ?? 'secret detected',
      location: `${leak.File ?? '?'}:${leak.StartLine ?? '?'}`
    });
  }

  rows.sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );
  return rows;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 200);
}

function findingsTable(rows: FindingRow[]): string {
  const header = '| Severity | Source | Finding | Location |\n|---|---|---|---|';
  const body = rows
    .map(
      (r) =>
        `| ${r.severity} | ${r.source} | ${escapeCell(r.finding)} | ${escapeCell(r.location)} |`
    )
    .join('\n');
  return `${header}\n${body}`;
}

export function formatPrComment(
  results: PrScanResults,
  gate: PrGateResult,
  dashboardUrl?: string
): string {
  const verdict = gate.passed
    ? '✅ **Passed** — no blocking findings'
    : '❌ **Blocked**';
  const lines: string[] = [
    PR_COMMENT_MARKER,
    `## 🦂 Scorpion Security Report — ${verdict}`,
    ''
  ];

  if (!gate.passed && gate.denyReasons.length > 0) {
    lines.push(...gate.denyReasons.map((r) => `> ${r}`), '');
  }

  lines.push(
    '| Source | Critical | High | Total findings |',
    '|---|---|---|---|',
    `| Dependencies (Trivy) | ${gate.criticalCount} | ${gate.highCount} | ${gate.criticalCount + gate.highCount} |`,
    `| SAST (Semgrep) | — | — | ${gate.sastCount} |`,
    `| Secrets (Gitleaks) | ${gate.secretCount} | — | ${gate.secretCount} |`,
    ''
  );

  const rows = collectFindings(results);
  if (rows.length === 0) {
    lines.push('No findings. 🎉', '');
  } else {
    lines.push(`### Top findings (${Math.min(rows.length, TOP_FINDINGS)} of ${rows.length})`, '');
    lines.push(findingsTable(rows.slice(0, TOP_FINDINGS)), '');

    const remainder = rows.slice(TOP_FINDINGS, TOP_FINDINGS + COLLAPSED_FINDINGS);
    const overflow = rows.length - TOP_FINDINGS - remainder.length;
    if (remainder.length > 0) {
      lines.push(
        '<details>',
        `<summary>All findings (${rows.length - TOP_FINDINGS} more)</summary>`,
        '',
        findingsTable(remainder),
        overflow > 0 ? `\n_+${overflow} more — see full report on the dashboard._` : '',
        '</details>',
        ''
      );
    }
  }

  if (dashboardUrl) {
    lines.push(`[View full report](${dashboardUrl})`);
  }
  lines.push('', '_Updated automatically on every push._');

  const body = lines.join('\n');
  return body.length > MAX_COMMENT_LENGTH
    ? `${body.slice(0, MAX_COMMENT_LENGTH)}\n\n_…truncated — see dashboard for the full report._`
    : body;
}

// Structural subset of Octokit so tests (and any future git provider) don't
// need the real client.
export interface PrCommentClient {
  issues: {
    listComments(params: {
      owner: string;
      repo: string;
      issue_number: number;
      per_page: number;
    }): Promise<{ data: Array<{ id: number; body?: string }> }>;
    updateComment(params: {
      owner: string;
      repo: string;
      comment_id: number;
      body: string;
    }): Promise<unknown>;
    createComment(params: {
      owner: string;
      repo: string;
      issue_number: number;
      body: string;
    }): Promise<unknown>;
  };
}

export interface UpsertPrCommentOptions {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}

export async function upsertPrComment(
  client: PrCommentClient,
  options: UpsertPrCommentOptions
): Promise<void> {
  const { owner, repo, prNumber, body } = options;
  const existing = await client.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100
  });

  const mine = existing.data.find((c) => c.body?.startsWith(PR_COMMENT_MARKER));
  if (mine) {
    await client.issues.updateComment({ owner, repo, comment_id: mine.id, body });
    logger.info(`[PR Comment] Updated report on ${owner}/${repo}#${prNumber}`);
  } else {
    await client.issues.createComment({ owner, repo, issue_number: prNumber, body });
    logger.info(`[PR Comment] Posted report on ${owner}/${repo}#${prNumber}`);
  }
}
