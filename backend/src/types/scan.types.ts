import { Models } from 'node-appwrite';

/**
 * Loose shape accepted by ingestVulnerabilitiesDelta. Two genuinely different
 * concrete shapes flow through it at runtime - scanService's deduplicated
 * NormalizedVulnerability (filePath/title/severity/hash/sources) and
 * zapWorker's ad-hoc DAST finding (filePath/severity/title/cveId, no
 * hash/sources) - so this only pins down the handful of fields the delta
 * hashing/merge logic actually reads, and lets everything else through.
 */
export interface IngestableIssue {
  filePath?: string;
  file_path?: string;
  cveId?: string;
  title?: string;
  severity?: string;
  code?: string;
}

/**
 * Options accepted by scanService.triggerScan. Deliberately wider than
 * scan/orchestrator.ts's own ScanOptions (whose scanType/scanDepth are
 * narrow literal unions) - callers across the queue worker, GitHub scanner
 * job, and pipeline service pass scanType values from different vocabularies
 * (e.g. repo.types.ts's 'full' | 'incremental' | 'quick'), so this models
 * what's actually passed in, not an aspirational shared enum.
 */
export interface ScanTriggerOptions {
  scanType?: string;
  scanDepth?: string;
  branch?: string;
}

/** Raw JSON.parse() output per scanner tool - genuinely dynamic third-party shapes. */
export interface ScanRawResults {
  semgrep?: unknown;
  trivy?: unknown;
  gitleaks?: unknown;
  checkov?: unknown;
  bandit?: unknown;
  hadolint?: unknown;
  [tool: string]: unknown;
}

/** A repository document carrying the dashboard-fallback fields scanService writes/reads. */
export type RepoWithScanStats = Models.Document & {
  vulnerability_count?: number;
};

// --- Raw per-tool scanner output shapes (scanners/normalizer.ts) ---
// Each scanner's CLI emits its own JSON schema; these only pin down the
// fields normalizer.ts actually reads, not the full third-party schema.

export interface SemgrepRawResult {
  path?: string;
  start?: { line?: number };
  end?: { line?: number };
  check_id?: string;
  extra?: { severity?: string; message?: string };
}

export interface SemgrepRawOutput {
  results?: SemgrepRawResult[];
}

export interface TrivyRawVulnerability {
  Severity?: string;
  VulnerabilityID?: string;
  Description?: string;
  Title?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
}

export interface TrivyRawLicense {
  Severity?: string;
  PkgName?: string;
  Name?: string;
  Category?: string;
}

export interface TrivyRawResult {
  Target?: string;
  Vulnerabilities?: TrivyRawVulnerability[];
  Licenses?: TrivyRawLicense[];
}

export interface TrivyRawOutput {
  Results?: TrivyRawResult[];
}

export interface CheckovFailedCheck {
  file_path?: string;
  file_line_range?: [number, number];
  severity?: string;
  check_severity?: string;
  check_id?: string;
  check_name?: string;
}

export interface CheckovRawOutput {
  results?: { failed_checks?: CheckovFailedCheck[] };
}

export interface BanditRawResult {
  filename?: string;
  line_number?: number;
  issue_severity?: string;
  test_id?: string;
  issue_text?: string;
}

export interface BanditRawOutput {
  results?: BanditRawResult[];
}

export interface HadolintRawResult {
  file?: string;
  line?: number;
  code?: string;
  message?: string;
  level?: string;
}

/** Hadolint emits a bare JSON array, not an object with a results field. */
export type HadolintRawOutput = HadolintRawResult[];
