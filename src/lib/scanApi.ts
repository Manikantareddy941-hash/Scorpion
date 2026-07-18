/**
 * Scan + findings reads for the per-scan detail pages.
 *
 * These pages used to query Appwrite directly, keyed on the scanId in the URL
 * with no ownership check — any scan id in the address bar returned that scan's
 * findings. Both calls here go through the backend, which resolves the repos
 * the caller can reach before returning anything.
 *
 * They also queried `scan_result_id`, a field nothing in the system writes.
 * The ingestion path stamps `scanId` (see backend scanService), so every one of
 * those pages rendered "No Findings Detected" regardless of what a scan found.
 */

type GetJWT = () => Promise<string | null>;

async function authedJson(getJWT: GetJWT, url: string): Promise<any> {
  const token = await getJWT();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

/** Scan summary, or throws if the caller cannot reach the scan's repository. */
export function fetchScan(getJWT: GetJWT, scanId: string): Promise<any> {
  return authedJson(getJWT, `/api/repos/scans/${encodeURIComponent(scanId)}`);
}

export interface ScanFindingFilters {
  tool?: string;
  /** One severity, or several — several matches any of them. */
  severity?: string | string[];
  /** Matches findings whose message starts with this, e.g. '[VULN]'. */
  messagePrefix?: string;
  limit?: number;
}

/** Findings belonging to one scan, scoped server-side to the caller's repos. */
export async function fetchScanFindings(
  getJWT: GetJWT,
  scanId: string,
  filters: ScanFindingFilters = {},
): Promise<any[]> {
  const params = new URLSearchParams({ scanId, limit: String(filters.limit ?? 100) });
  if (filters.tool) params.set('tool', filters.tool);
  if (filters.severity) {
    params.set('severity', Array.isArray(filters.severity) ? filters.severity.join(',') : filters.severity);
  }
  if (filters.messagePrefix) params.set('messagePrefix', filters.messagePrefix);

  const body = await authedJson(getJWT, `/api/issues?${params.toString()}`);
  return body?.documents ?? [];
}
