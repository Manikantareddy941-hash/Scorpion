/**
 * What a scan verdict was produced BY.
 *
 * "Clean" is not a durable statement. It means "clean against the signatures
 * this scanner held at that moment", and without recording which scanner and
 * which signatures, no past verdict can ever be re-interpreted — you cannot
 * answer "was that release scanned against CVE-2026-X?" for a scan that already
 * ran.
 *
 * That question is the whole reason this exists. The freshness gate stops a
 * badly stale database from producing a verdict at all; this records what the
 * verdict was actually made with, for the ones that do run.
 */

export interface ToolProvenance {
  tool: string;
  /** Digest-pinned image reference. Empty for tools that run unpinned upstream. */
  image: string;
  digest: string;
  /** ISO timestamp of the baked database, absent for tools that carry none. */
  dbBuiltAt?: string;
  freshness: 'fresh' | 'degraded' | 'stale';
}

/** Serialised size ceiling, matching the Appwrite attribute. */
export const PROVENANCE_MAX_BYTES = 4096;

/**
 * The scalar worth filtering and sorting on.
 *
 * The OLDEST database across the scanners that had one, because a verdict is
 * only as current as its weakest contributor. Reporting the newest would let
 * one freshly-baked scanner vouch for another running months behind.
 *
 * Undefined when no tool carried a database — gitleaks and hadolint compile
 * their rules in, and there is nothing to be stale about.
 */
export function oldestDatabase(entries: readonly ToolProvenance[]): string | undefined {
  const dated = entries.map(e => e.dbBuiltAt).filter((d): d is string => Boolean(d)).sort();
  return dated[0];
}

/**
 * Serialises for storage, dropping entries rather than exceeding the column.
 *
 * A write that fails on size would fail the whole scan record, losing the
 * findings to save the metadata about them. Truncation is annotated so a reader
 * can see the record is partial instead of assuming those tools never ran.
 */
export function serializeProvenance(entries: readonly ToolProvenance[]): string {
  const full = JSON.stringify(entries);
  if (full.length <= PROVENANCE_MAX_BYTES) return full;

  const kept: ToolProvenance[] = [];
  for (const entry of entries) {
    const candidate = JSON.stringify([...kept, entry, { tool: '_truncated', image: '', digest: '', freshness: 'fresh' }]);
    if (candidate.length > PROVENANCE_MAX_BYTES) break;
    kept.push(entry);
  }
  return JSON.stringify([
    ...kept,
    { tool: '_truncated', image: '', digest: '', freshness: 'fresh' as const },
  ]);
}
