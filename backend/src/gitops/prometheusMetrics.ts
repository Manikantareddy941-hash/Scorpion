import axios from 'axios';
import { logger, errorContext } from '../services/logger';

/**
 * Canary metric source: queries the Monitor stack's Prometheus for the app's
 * live error rate and p95 latency. Every failure path returns null instead of
 * throwing — the decision core (canaryAnalysis) treats null as a failed check,
 * so an unreachable Prometheus degrades to a fail-secure rollback, never a crash.
 */

export interface CanaryMetrics {
  errorRatePct: number | null;
  p95LatencyMs: number | null;
}

const QUERY_TIMEOUT_MS = 5000;

/** PromQL string-literal escape for label values. */
const escapeLabel = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

interface PromQueryResponse {
  status?: string;
  data?: { result?: { value?: [number, string] }[] };
}

async function queryScalar(baseUrl: string, query: string): Promise<number | null> {
  try {
    const res = await axios.get<PromQueryResponse>(`${baseUrl}/api/v1/query`, {
      params: { query },
      timeout: QUERY_TIMEOUT_MS,
    });
    if (res.data?.status !== 'success') return null;
    const raw = res.data.data?.result?.[0]?.value?.[1];
    if (raw === undefined) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  } catch (err) {
    // `query` only, never `baseUrl` — a Prometheus endpoint can carry basic-auth
    // credentials in its URL, and errorContext already withholds axios transport.
    logger.warn('[PrometheusMetrics] query failed', { event: 'PROM_QUERY_FAILED', query, ...errorContext(err) });
    return null;
  }
}

export async function queryCanaryMetrics(app: string, namespace: string): Promise<CanaryMetrics> {
  const baseUrl = process.env.PROMETHEUS_URL;
  if (!baseUrl) {
    logger.warn('[PrometheusMetrics] PROMETHEUS_URL not configured — canary checks will fail secure');
    return { errorRatePct: null, p95LatencyMs: null };
  }

  const a = escapeLabel(app);
  const n = escapeLabel(namespace);
  const errorRateQuery =
    `100 * sum(rate(http_requests_total{app="${a}",namespace="${n}",status=~"5.."}[5m]))` +
    ` / sum(rate(http_requests_total{app="${a}",namespace="${n}"}[5m]))`;
  const p95Query =
    `1000 * histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{app="${a}",namespace="${n}"}[5m])) by (le))`;

  const [errorRatePct, p95LatencyMs] = await Promise.all([
    queryScalar(baseUrl, errorRateQuery),
    queryScalar(baseUrl, p95Query),
  ]);
  return { errorRatePct, p95LatencyMs };
}
