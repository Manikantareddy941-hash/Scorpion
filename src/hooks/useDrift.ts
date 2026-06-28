import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

export type DriftSeverity = 'critical' | 'high' | 'medium' | 'low';
export type DriftType = 'gate-violation' | 'unscanned-image' | 'out-of-band-update';

export interface DriftRecord {
  id: string;
  driftType: DriftType;
  namespace: string;
  podName: string;
  containerName: string;
  image: string;
  imageDigest: string;
  previousDigest?: string;
  env: string;
  gateStatus: string;
  reason: string;
  severity: DriftSeverity;
  severityRank: number;
  timestamp: string;
}

interface DriftResponse {
  success: boolean;
  data: DriftRecord[];
  meta?: { total: number };
}

export interface UseDrift {
  records: DriftRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
}

const DRIFT_POLL_INTERVAL_MS = 30_000;

/**
 * Active runtime drift anomalies from GET /api/v1/drift (severity- then
 * time-sorted server-side). Reads on mount, then polls every 30s so the table
 * stays live without manual reload, and exposes `refetch` for manual triggers
 * (e.g. after an alert dismissal). Background refreshes do not toggle `loading`,
 * so the table never flickers to a skeleton on each tick. A manual refetch sets
 * `isRefetching`; any background tick that fires while it is in flight bails out
 * without writing state, so the slower poll response can never clobber the
 * fresh manual result. loading/error are tracked strictly so the table never
 * renders ambiguous state.
 */
export function useDrift(limit = 50): UseDrift {
  const [records, setRecords] = useState<DriftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const isRefetchingRef = useRef(false);

  const load = useCallback(
    async (isManual: boolean): Promise<void> => {
      // A background tick must not race a manual refetch: skip it entirely.
      if (!isManual && isRefetchingRef.current) return;
      if (isManual) isRefetchingRef.current = true;
      try {
        const res = (await apiFetch(`/api/v1/drift?limit=${limit}`)) as DriftResponse;
        if (cancelledRef.current) return;
        setRecords(Array.isArray(res?.data) ? res.data : []);
        setError(null);
      } catch (err) {
        if (cancelledRef.current) return;
        setError(errorMessage(err, 'Failed to load drift anomalies'));
      } finally {
        if (isManual) isRefetchingRef.current = false;
        if (!cancelledRef.current) setLoading(false);
      }
    },
    [limit],
  );

  const refetch = useCallback((): Promise<void> => load(true), [load]);

  useEffect(() => {
    cancelledRef.current = false;

    void load(false);
    const intervalId = setInterval(() => void load(false), DRIFT_POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      clearInterval(intervalId);
    };
  }, [load]);

  return { records, loading, error, refetch };
}
