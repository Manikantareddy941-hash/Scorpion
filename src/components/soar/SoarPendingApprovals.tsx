import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { type SoarActionRecord } from './soarTypes';

const POLL_INTERVAL_MS = 15000;

function ageLabel(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function SoarPendingApprovals() {
  const { getJWT } = useAuth();
  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getJWT();
      return fetch(path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
    },
    [getJWT]
  );
  const [actions, setActions] = useState<SoarActionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  const loadActions = useCallback(async () => {
    try {
      const res = await authFetch('/api/soar/actions?status=pending');
      if (res.ok) {
        setActions((await res.json()).actions || []);
        setError(null);
      } else {
        setError('Failed to load pending approvals');
      }
    } catch {
      setError('Failed to load pending approvals');
    }
  }, [authFetch]);

  useEffect(() => {
    loadActions();
    const interval = setInterval(loadActions, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadActions]);

  const resolveAction = async (id: string, target: 'approve' | 'reject') => {
    setInFlight((prev) => new Set(prev).add(id));
    try {
      const res = await authFetch(`/api/soar/actions/${id}/${target}`, { method: 'POST' });
      if (res.ok) toast.success(target === 'approve' ? 'Action approved' : 'Action rejected');
      else if (res.status === 409) toast.error('Action already resolved');
      else toast.error((await res.json().catch(() => ({}))).error || `Failed to ${target} action`);
    } catch {
      toast.error(`Failed to ${target} action`);
    } finally {
      setInFlight((prev) => { const next = new Set(prev); next.delete(id); return next; });
      await loadActions();
    }
  };

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] mb-2">Pending approvals</h3>
      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
      {actions.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)] italic mb-2">No actions awaiting approval.</p>
      ) : (
        <div className="space-y-2">
          {actions.map((a) => (
            <div key={a.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {a.falcoRule} <span className="text-[var(--text-secondary)]">— {a.actionType}</span>
                </p>
                <p className="text-[10px] font-mono text-[var(--text-secondary)]">
                  {a.namespace || 'n/a'}/{a.podName || 'n/a'} · {ageLabel(a.createdAt)} · {a.playbookName}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={inFlight.has(a.id)}
                  onClick={() => resolveAction(a.id, 'approve')}
                  className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 uppercase tracking-widest flex items-center gap-1 disabled:opacity-40"
                >
                  <ShieldCheck className="w-3.5 h-3.5" /> Approve
                </button>
                <button
                  type="button"
                  disabled={inFlight.has(a.id)}
                  onClick={() => resolveAction(a.id, 'reject')}
                  className="text-[10px] font-bold text-red-500 hover:text-red-400 uppercase tracking-widest flex items-center gap-1 disabled:opacity-40"
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
