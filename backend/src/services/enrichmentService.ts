import { logger, errorContext } from './logger';
import { IngestableIssue } from '../types/scan.types';

/**
 * Threat-intel enrichment: EPSS exploit-probability scores (FIRST.org) and
 * CISA KEV (Known Exploited Vulnerabilities) membership, combined into a
 * single 0-100 risk_score so findings rank by real-world exploitability
 * instead of raw CVSS severity alone. Everything here is best-effort: feed
 * failures degrade to severity-only scoring, never block ingestion.
 */

const EPSS_API = 'https://api.first.org/data/v1/epss';
const KEV_FEED =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const EPSS_BATCH_SIZE = 100;
const FETCH_TIMEOUT_MS = 8000;
const KEV_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface EpssScore {
  score: number;
  percentile: number;
}

export interface EnrichedIssue extends IngestableIssue {
  epss_score?: number;
  epss_percentile?: number;
  kev: boolean;
  risk_score: number;
}

let kevCache: { cveIds: Set<string>; fetchedAt: number } | null = null;

export function __resetEnrichmentCaches(): void {
  kevCache = null;
}

export async function fetchEpssScores(cveIds: string[]): Promise<Map<string, EpssScore>> {
  const scores = new Map<string, EpssScore>();
  const unique = [...new Set(cveIds)];

  for (let i = 0; i < unique.length; i += EPSS_BATCH_SIZE) {
    const batch = unique.slice(i, i + EPSS_BATCH_SIZE);
    try {
      const res = await fetch(`${EPSS_API}?cve=${batch.join(',')}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!res.ok) throw new Error(`EPSS API responded ${res.status}`);
      const body = (await res.json()) as {
        data?: Array<{ cve?: string; epss?: string; percentile?: string }>;
      };
      for (const row of body.data ?? []) {
        if (!row.cve) continue;
        scores.set(row.cve, {
          score: Number(row.epss) || 0,
          percentile: Number(row.percentile) || 0
        });
      }
    } catch (err) {
      logger.warn('[Enrichment] EPSS fetch failed, findings in this batch stay unscored', errorContext(err));
    }
  }
  return scores;
}

export async function loadKevCatalog(): Promise<Set<string>> {
  if (kevCache && Date.now() - kevCache.fetchedAt < KEV_CACHE_TTL_MS) {
    return kevCache.cveIds;
  }
  try {
    const res = await fetch(KEV_FEED, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`KEV feed responded ${res.status}`);
    const body = (await res.json()) as {
      vulnerabilities?: Array<{ cveID?: string }>;
    };
    const cveIds = new Set(
      (body.vulnerabilities ?? []).map((v) => v.cveID).filter((id): id is string => !!id)
    );
    kevCache = { cveIds, fetchedAt: Date.now() };
    return cveIds;
  } catch (err) {
    logger.warn('[Enrichment] KEV feed fetch failed, serving stale/empty catalog', errorContext(err));
    return kevCache?.cveIds ?? new Set();
  }
}

const SEVERITY_BASE: Record<string, number> = {
  critical: 50,
  high: 35,
  medium: 20,
  low: 10
};

/**
 * 0-100 exploit-likelihood-weighted risk: severity base + EPSS probability
 * (up to +40) + KEV membership (+25, actively exploited in the wild).
 * A KEV'd or high-EPSS medium deliberately outranks a plain high.
 */
export function computeRiskScore(
  severity: string | undefined,
  epssScore: number | undefined,
  kev: boolean
): number {
  const base = SEVERITY_BASE[(severity ?? '').toLowerCase()] ?? 5;
  const epss = (epssScore ?? 0) * 40;
  const kevBoost = kev ? 25 : 0;
  return Math.min(100, Math.round(base + epss + kevBoost));
}

export async function enrichIssues(issues: IngestableIssue[]): Promise<EnrichedIssue[]> {
  const cveIds = issues.map((i) => i.cveId).filter((id): id is string => !!id);
  const [epssScores, kevCatalog] = await Promise.all([
    cveIds.length > 0 ? fetchEpssScores(cveIds) : Promise.resolve(new Map<string, EpssScore>()),
    cveIds.length > 0 ? loadKevCatalog() : Promise.resolve(new Set<string>())
  ]);

  return issues.map((issue) => {
    const epss = issue.cveId ? epssScores.get(issue.cveId) : undefined;
    const kev = issue.cveId ? kevCatalog.has(issue.cveId) : false;
    return {
      ...issue,
      ...(epss ? { epss_score: epss.score, epss_percentile: epss.percentile } : {}),
      kev,
      risk_score: computeRiskScore(issue.severity, epss?.score, kev)
    };
  });
}
