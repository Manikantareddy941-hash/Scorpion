import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { DEFAULT_RULES, type GateEnv, type GateRule } from '../components/GateRulesDrawer';

interface GateConfig {
  rules: GateRule[];
  env: GateEnv;
}

export interface UseGateRules {
  rules: GateRule[];
  env: GateEnv;
  loading: boolean;
  error: string | null;
  setRules: (next: GateRule[]) => void;
  setEnv: (next: GateEnv) => void;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
}

/**
 * Server-backed gate configuration (replaces the old localStorage store).
 * Reads once on mount; every mutation optimistically updates local state and
 * persists via PUT /api/v1/rules. A persistence failure surfaces through `error`
 * without discarding the user's in-flight edit.
 */
export function useGateRules(): UseGateRules {
  const [rules, setRulesState] = useState<GateRule[]>(DEFAULT_RULES);
  const [env, setEnvState] = useState<GateEnv>('prod');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await apiFetch('/api/v1/rules')) as GateConfig;
        if (cancelled) return;
        setRulesState(data.rules);
        setEnvState(data.env);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load gate rules'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (config: GateConfig) => {
    try {
      await apiFetch('/api/v1/rules', { method: 'PUT', body: JSON.stringify(config), retry: true });
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save gate rules'));
    }
  }, []);

  const setRules = useCallback(
    (next: GateRule[]) => {
      setRulesState(next);
      void persist({ rules: next, env });
    },
    [persist, env]
  );

  const setEnv = useCallback(
    (next: GateEnv) => {
      setEnvState(next);
      void persist({ rules, env: next });
    },
    [persist, rules]
  );

  return { rules, env, loading, error, setRules, setEnv };
}
