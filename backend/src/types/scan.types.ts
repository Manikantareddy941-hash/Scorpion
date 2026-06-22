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
  [tool: string]: unknown;
}

/** A repository document carrying the dashboard-fallback fields scanService writes/reads. */
export type RepoWithScanStats = Models.Document & {
  vulnerability_count?: number;
};
