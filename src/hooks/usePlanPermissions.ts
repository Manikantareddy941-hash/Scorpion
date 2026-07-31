import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

/**
 * The signed-in user's permissions on a Plan project.
 *
 * This drives what gets rendered, never what is allowed. Every endpoint
 * authorizes independently — hiding a button is a courtesy to the user, not a
 * security control, and a client that stops asking is not a client that cannot.
 */

export interface PlanPermissionsState {
  /** True if the user holds `permission` on this project. */
  can: (permission: string) => boolean;
  /** Whether the backend is applying RBAC or still shadowing it. */
  enforcing: boolean;
  loading: boolean;
  /** Set when permissions could not be read at all. */
  error: string | null;
  refresh: () => void;
}

const WILDCARD = '*';

export function usePlanPermissions(projectId: string | null | undefined): PlanPermissionsState {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [enforcing, setEnforcing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!projectId) { setPermissions([]); return; }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/plan/projects/${projectId}/permissions/me`);
        if (!res.ok) throw new Error(`permissions request failed (${res.status})`);
        const body = await res.json();
        if (cancelled) return;
        setPermissions(Array.isArray(body.permissions) ? body.permissions : []);
        setEnforcing(Boolean(body.enforcing));
      } catch (err) {
        if (cancelled) return;
        // Fail OPEN here, deliberately. This is the data plane: a read blip must
        // not grey out a working board, and the server refuses the action anyway
        // if the user genuinely lacks the permission. The control plane (the
        // backend gate) is the half that fails closed.
        setError(err instanceof Error ? err.message : 'Could not read permissions');
        setEnforcing(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, nonce]);

  const can = useCallback((permission: string): boolean => {
    // While the backend is in shadow mode the permission list is computed but
    // not applied, and it is empty for anyone the backfill has not reached.
    // Honouring it would hide every control from users who still have full
    // access through the legacy check.
    if (!enforcing) return true;
    return permissions.includes(WILDCARD) || permissions.includes(permission);
  }, [enforcing, permissions]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { can, enforcing, loading, error, refresh };
}
