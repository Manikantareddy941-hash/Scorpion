import { useCallback, useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../contexts/AuthContext';

interface EscapeRecommendation {
  phase: string;
  count: number;
  share: number;
  recommendation: string;
}

interface SlaAttainment {
  severity: string;
  targetHours: number;
  mttrMs: number | null;
  met: number;
  breached: number;
  open: number;
  attainment: number | null;
}

interface RepoMttr {
  repoId: string;
  name: string;
  mttrMs: number | null;
  findingCount: number;
  breached: number;
}

interface FeedbackMetrics {
  mttr: number;
  reopenRate: number;
  byPhase: { phase: string; count: number }[];
  recommendations?: EscapeRecommendation[];
  sla?: SlaAttainment[];
  byRepo?: RepoMttr[];
  /** True when the repo scan hit its cap — the figures describe a subset. */
  truncated?: boolean;
}

function formatMttr(ms: number | null): string {
  if (!ms) return '—';
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// null attainment means nothing has been decided yet — render it as unknown,
// never as 0%, which would show a failing grade invented from no data.
function formatAttainment(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

const SEVERITY_TONE: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#0284c7',
};

export default function FeedbackPanel() {
  const { getJWT } = useAuth();
  const [metrics, setMetrics] = useState<FeedbackMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const token = await getJWT();
      const res = await fetch('/api/monitor/feedback', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setMetrics(await res.json());
        setError(null);
      } else {
        setError('Failed to load feedback metrics');
      }
    } catch {
      setError('Failed to load feedback metrics');
    } finally {
      setLoading(false);
    }
  }, [getJWT]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center gap-3 mb-4">
        <Timer className="w-5 h-5 text-sky-400" />
        <div>
          <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">Feedback Metrics</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
            SLA attainment by severity, mean time to resolve, reopen rate, and escape point by phase
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {metrics?.truncated && (
        <p className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: SEVERITY_TONE.medium }}>
          Showing the first 500 repositories — these figures describe a subset.
        </p>
      )}

      {loading ? (
        <p className="text-xs text-[var(--text-secondary)]">Loading feedback metrics…</p>
      ) : !metrics ? (
        <p className="text-xs text-[var(--text-secondary)] italic">No feedback data yet.</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Mean time to resolve</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--text-primary)] mt-1">{formatMttr(metrics.mttr)}</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Reopen rate</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--text-primary)] mt-1">{Math.round(metrics.reopenRate * 100)}%</p>
            </div>
          </div>

          {metrics.sla && metrics.sla.length > 0 && (
            <div>
              <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">
                SLA attainment by severity
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {metrics.sla.map((row) => (
                  <div key={row.severity} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="text-[9px] font-black uppercase tracking-widest"
                        style={{ color: SEVERITY_TONE[row.severity] ?? 'var(--text-secondary)' }}
                      >
                        {row.severity}
                      </span>
                      <span className="text-[9px] font-mono text-[var(--text-secondary)] tabular-nums">
                        {row.targetHours}h
                      </span>
                    </div>
                    <p className="text-xl font-semibold tabular-nums text-[var(--text-primary)] mt-1">
                      {formatAttainment(row.attainment)}
                    </p>
                    <p className="text-[10px] font-mono text-[var(--text-secondary)] tabular-nums mt-1">
                      {row.breached > 0 ? `${row.breached} breached · ` : ''}
                      {row.open > 0 ? `${row.open} in window · ` : ''}
                      mttr {formatMttr(row.mttrMs)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">Escapes by phase</h3>
            {metrics.byPhase.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] italic">No findings yet.</p>
            ) : (
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.byPhase}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                    <XAxis dataKey="phase" tick={{ fontSize: 10 }} stroke="var(--text-secondary)" />
                    <YAxis hide />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: 'none', borderRadius: '8px', fontSize: '10px' }} />
                    <Bar dataKey="count" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {metrics.byRepo && metrics.byRepo.length > 0 && (
            <div>
              <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">
                Slowest repositories
              </h3>
              <div className="space-y-1.5">
                {metrics.byRepo.slice(0, 8).map((r) => (
                  <div
                    key={r.repoId}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 flex items-center justify-between gap-3"
                  >
                    <span className="text-xs text-[var(--text-primary)] truncate" title={r.name}>{r.name}</span>
                    <span className="flex items-center gap-3 shrink-0 text-[10px] font-mono tabular-nums text-[var(--text-secondary)]">
                      {r.breached > 0 && (
                        <span style={{ color: SEVERITY_TONE.critical }}>{r.breached} overdue</span>
                      )}
                      <span>{r.findingCount} findings</span>
                      <span className="text-[var(--text-primary)] font-semibold">{formatMttr(r.mttrMs)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {metrics.recommendations && metrics.recommendations.length > 0 && (
            <div>
              <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">
                Where to tighten next
              </h3>
              <div className="space-y-2">
                {metrics.recommendations.map((r) => (
                  <div key={r.phase} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 flex items-start gap-3">
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded shrink-0 tabular-nums" style={{ color: 'var(--accent-primary)', background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' }}>
                      {r.phase} · {Math.round(r.share * 100)}%
                    </span>
                    <p className="text-xs text-[var(--text-primary)] leading-relaxed">{r.recommendation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
