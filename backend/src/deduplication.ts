// backend/src/deduplication.ts
import crypto from 'crypto';

/**
 * Unified vulnerability shape after normalisation.
 * All scanner normalisers already produce objects that conform to this shape
 * (filePath, line, severity, scanner, ruleId, title, description, code, etc.).
 */
export interface NormalizedVulnerability {
  /** Relative path inside the repository */
  filePath: string;
  /** Starting line number (1‑based) */
  line: number;
  /** Severity as uppercase string (CRITICAL, HIGH, MEDIUM, LOW, INFO) */
  severity: string;
  /** Name of the scanning engine that reported the finding */
  scanner: string;
  /** Rule or signature identifier (e.g., "GITLEAKS_SECRET", "semgrep:python.lang.security.audit.sql-injection") */
  ruleId: string;
  /** Human readable title / short description */
  title: string;
  /** Optional detailed description */
  description?: string;
  /** Code snippet (truncated to 5 KB by the ingest step) */
  code?: string;
  /** Unique hash that can be used for de‑duplication across runs */
  hash: string;
  /** Source scanners that contributed to this merged finding */
  sources: string[];
}

/**
 * Helper – generate a deterministic SHA‑256 hash for a finding.
 * The same filePath, line (or line window), severity and ruleId produce identical hashes.
 */
const generateHash = (filePath: string, line: number, severity: string, ruleId: string): string => {
  const data = `${filePath}|${line}|${severity}|${ruleId}`;
  return crypto.createHash('sha256').update(data).digest('hex');
};

/**
 * Deduplicate an array of raw findings coming from multiple scanners.
 *
 * 1. Normalise each entry to the Minimal shape we need for comparison.
 * 2. Group by `filePath`.
 * 3. Within each file, sort by line number.
 * 4. Walk the sorted list and merge any entry that:
 *      - Lies within ±3 lines of the previous merged entry **and**
 *      - Has the same `severity` (case‑insensitive) **and**
 *      - Has a similar `title`/`ruleId` (contains the word "secret" or "password" for secret scans, otherwise exact rule match).
 *    When merging we:
 *      • Keep the smallest line number as the canonical location.
 *      • Union the `scanner` values into a `sources` array.
 *      • Preserve the first non‑empty description/code.
 *      • Re‑compute a hash based on the canonical location.
 */
export const deduplicateFindings = (rawFindings: any[]): NormalizedVulnerability[] => {
  // Step 1 – map raw findings to a minimal normalised shape.
  const normalised: NormalizedVulnerability[] = rawFindings.map((f) => ({
    filePath: f.filePath || f.file_path || '',
    line: Number(f.line || f.startLine || f.start_line || 0),
    severity: (f.severity || f.level || 'INFO').toString().toUpperCase(),
    scanner: f.scanner || f.tool || 'unknown',
    ruleId: f.ruleId || f.id || f.title || 'unknown',
    title: f.title || f.message || f.description || '',
    description: f.description || '',
    code: f.code || '',
    hash: '', // will be set after potential merge
    sources: [], // will be filled after merge
  }));

  // Step 2 – group by filePath.
  const groups = new Map<string, NormalizedVulnerability[]>();
  for (const n of normalised) {
    const key = n.filePath;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  const mergedResults: NormalizedVulnerability[] = [];

  // Helper to decide if two findings are "similar" enough to merge.
  // The caller only pairs findings already within a ±3 line window.
  const areSimilar = (a: NormalizedVulnerability, b: NormalizedVulnerability): boolean => {
    // Same rule = same finding reported by multiple scanners → merge.
    if (a.ruleId !== 'unknown' && a.ruleId === b.ruleId) return true;
    // Secrets: two scanners flagging the SAME secret land on the same line.
    // Only collapse when the line matches exactly — a ±3 keyword match would
    // fold two DIFFERENT nearby secrets into one and undercount real findings.
    const secretKeywords = ['secret', 'password', 'key', 'token'];
    const aIsSecret = secretKeywords.some((kw) => a.title.toLowerCase().includes(kw));
    const bIsSecret = secretKeywords.some((kw) => b.title.toLowerCase().includes(kw));
    if (aIsSecret && bIsSecret && a.line === b.line) return true;
    return false;
  };

  // Process each file group.
  for (const [, items] of groups) {
    // Sort by line number ascending.
    items.sort((x, y) => x.line - y.line);

    let current: NormalizedVulnerability | null = null;
    for (const item of items) {
      if (!current) {
        current = { ...item, sources: [item.scanner] };
        continue;
      }
      // Within a 3‑line window and similar?
      if (Math.abs(item.line - current.line) <= 3 && areSimilar(current, item)) {
        // Merge sources uniquely
        current.sources = Array.from(new Set([...current.sources, item.scanner]));
        // Upgrade to the highest severity (CRITICAL > HIGH > MEDIUM > LOW > INFO)
        const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
        const curIdx = severityOrder.indexOf(current.severity);
        const itemIdx = severityOrder.indexOf(item.severity);
        if (itemIdx !== -1 && (curIdx === -1 || itemIdx < curIdx)) {
          current.severity = item.severity;
        }
        // Keep the earliest line as canonical location.
        current.line = Math.min(current.line, item.line);
        // Preserve first non‑empty description/code.
        if (!current.description && item.description) current.description = item.description;
        if (!current.code && item.code) current.code = item.code;
        // Title – keep the more specific one (longer string).
        if (item.title.length > current.title.length) current.title = item.title;
        // ruleId – keep the one that is not "unknown" if possible.
        if (current.ruleId === 'unknown' && item.ruleId !== 'unknown') current.ruleId = item.ruleId;
      } else {
        // Finalise previous entry.
        current.hash = generateHash(current.filePath, current.line, current.severity, current.ruleId);
        mergedResults.push(current);
        // Start a new aggregation.
        current = { ...item, sources: [item.scanner] };
      }
    }
    // Flush the last entry for this file.
    if (current) {
      current.hash = generateHash(current.filePath, current.line, current.severity, current.ruleId);
      mergedResults.push(current);
    }
  }

  return mergedResults;
};

/*
 * Exported for unit‑test usage.
 */
export default deduplicateFindings;
