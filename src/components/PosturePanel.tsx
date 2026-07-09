import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ChevronDown, ChevronUp, Network } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { severityVar, SEVERITY_ORDER, type Severity } from './ui/types';

type PostureSeverity = 'critical' | 'high' | 'medium' | 'low';

interface PostureFinding {
  checkId: string;
  severity: PostureSeverity;
  namespace: string;
  resource: string;
  reason: string;
}

interface NamespaceSnapshot {
  namespace: string;
  score: number;
  findings: PostureFinding[];
  updatedAt: string;
}

interface PosturePanelProps {
  onGeneratePolicies: (namespace: string) => void;
}

function scoreColor(score: number): string {
  if (score >= 90) return 'var(--status-success)';
  if (score >= 70) return 'var(--status-warning)';
  return 'var(--status-error)';
}

function sortFindings(findings: PostureFinding[]): PostureFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );
}

export default function PosturePanel({ onGeneratePolicies }: PosturePanelProps) {
  const { getJWT } = useAuth();
  const [snapshots, setSnapshots] = useState<NamespaceSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const token = await getJWT();
      const res = await fetch('/api/posture', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setSnapshots((await res.json()).data || []);
        setError(null);
      } else {
        setError('Failed to load posture snapshots');
      }
    } catch {
      setError('Failed to load posture snapshots');
    } finally {
      setLoading(false);
    }
  }, [getJWT]);

  useEffect(() => { load(); }, [load]);

  const toggleExpanded = (namespace: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(namespace)) next.delete(namespace); else next.add(namespace);
      return next;
    });
  };

  return (
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className="w-5 h-5 text-emerald-400" />
        <div>
          <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">Cluster Posture</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
            Read-only CIS-flavored checks — per-namespace score, refreshed on scan
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {loading ? (
        <p className="text-xs text-[var(--text-secondary)]">Loading posture…</p>
      ) : snapshots.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)] italic">No posture snapshots yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {snapshots.map((snap) => {
            const isOpen = expanded.has(snap.namespace);
            const findings = sortFindings(snap.findings);
            return (
              <div key={snap.namespace} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleExpanded(snap.namespace)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{snap.namespace}</p>
                    <p className="text-[10px] font-mono text-[var(--text-secondary)]">
                      {findings.length} finding{findings.length === 1 ? '' : 's'} · updated {new Date(snap.updatedAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="text-sm font-bold tabular-nums px-2.5 py-1 rounded-full"
                      style={{ color: scoreColor(snap.score), background: `color-mix(in srgb, ${scoreColor(snap.score)} 12%, transparent)` }}
                    >
                      {snap.score}
                    </span>
                    {isOpen ? <ChevronUp size={14} className="text-[var(--text-secondary)]" /> : <ChevronDown size={14} className="text-[var(--text-secondary)]" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                    {findings.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-[var(--text-secondary)] italic">No findings — clean namespace.</p>
                    ) : findings.map((f, i) => (
                      <div key={`${f.checkId}-${i}`} className="px-4 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span
                              className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
                              style={{ color: severityVar(f.severity as Severity), background: `color-mix(in srgb, ${severityVar(f.severity as Severity)} 15%, transparent)` }}
                            >
                              {f.severity}
                            </span>
                            <span className="text-[10px] font-mono text-[var(--text-secondary)] truncate">{f.checkId}</span>
                          </div>
                          <p className="text-xs text-[var(--text-primary)] truncate">{f.resource}</p>
                          <p className="text-[10px] text-[var(--text-secondary)]">{f.reason}</p>
                        </div>
                        {f.checkId === 'namespace-without-networkpolicy' && (
                          <button
                            type="button"
                            onClick={() => onGeneratePolicies(snap.namespace)}
                            className="text-[10px] font-bold text-[var(--accent-primary)] uppercase tracking-widest flex items-center gap-1 shrink-0"
                          >
                            <Network size={12} /> Generate policies
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
