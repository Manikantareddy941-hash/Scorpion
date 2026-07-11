import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link2, EyeOff, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { severityVar, type Severity } from './ui/types';
import { INPUT_CLS, LABEL_CLS } from './falco/falcoTypes';

interface FiredCorrelation {
  ruleId: string;
  title: string;
  severity: Severity;
  correlationKey: string;
  createdAt: string;
}

interface RuleCatalogItem {
  id: string;
  title: string;
  severity: Severity;
  enabled: boolean;
  windowMs: number;
}

type MatchType = 'ruleId' | 'severity' | 'repo' | 'actor';
const MATCH_TYPES: MatchType[] = ['ruleId', 'severity', 'repo', 'actor'];

interface SuppressionRule {
  id: string;
  matchType: MatchType;
  matchValue: string;
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
      style={{ color: severityVar(severity), background: `color-mix(in srgb, ${severityVar(severity)} 15%, transparent)` }}
    >
      {severity}
    </span>
  );
}

export default function CorrelationPanel() {
  const { getJWT } = useAuth();
  const [correlations, setCorrelations] = useState<FiredCorrelation[]>([]);
  const [rules, setRules] = useState<RuleCatalogItem[]>([]);
  const [suppressions, setSuppressions] = useState<SuppressionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [matchType, setMatchType] = useState<MatchType>('ruleId');
  const [matchValue, setMatchValue] = useState('');

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

  const load = useCallback(async () => {
    try {
      const [corrRes, rulesRes, suppRes] = await Promise.all([
        authFetch('/api/monitor/correlations'),
        authFetch('/api/monitor/correlations/rules'),
        authFetch('/api/monitor/suppressions'),
      ]);
      if (!corrRes.ok || !rulesRes.ok || !suppRes.ok) { setError('Failed to load correlation data'); return; }
      setCorrelations(await corrRes.json());
      setRules(await rulesRes.json());
      setSuppressions(await suppRes.json());
      setError(null);
    } catch {
      setError('Failed to load correlation data');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const toggleRule = async (rule: RuleCatalogItem) => {
    setTogglingId(rule.id);
    const nextEnabled = !rule.enabled;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: nextEnabled } : r)));
    try {
      const res = await authFetch(`/api/monitor/correlations/rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      toast.error('Failed to update rule');
    } finally {
      setTogglingId(null);
    }
  };

  const createSuppression = async () => {
    if (!matchValue.trim()) { toast.error('Match value is required'); return; }
    setCreating(true);
    try {
      const res = await authFetch('/api/monitor/suppressions', {
        method: 'POST',
        body: JSON.stringify({ matchType, matchValue: matchValue.trim() }),
      });
      if (!res.ok) throw new Error();
      setMatchValue('');
      toast.success('Suppression rule created');
      await load();
    } catch {
      toast.error('Failed to create suppression rule');
    } finally {
      setCreating(false);
    }
  };

  const deleteSuppression = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await authFetch(`/api/monitor/suppressions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setSuppressions((prev) => prev.filter((s) => s.id !== id));
      toast.success('Suppression rule removed');
    } catch {
      toast.error('Failed to remove suppression rule');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center gap-3 mb-4">
        <Link2 className="w-5 h-5 text-fuchsia-400" />
        <div>
          <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">Correlation & Suppression</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
            Multi-event attack patterns, the 5-rule catalog, and alert suppression
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {loading ? (
        <p className="text-xs text-[var(--text-secondary)]">Loading correlations…</p>
      ) : (
        <div className="space-y-6">
          {/* Fired correlations */}
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">Fired correlations</h3>
            {correlations.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] italic">No correlations fired yet.</p>
            ) : (
              <div className="space-y-2">
                {correlations.map((c, i) => (
                  <div key={`${c.ruleId}-${c.correlationKey}-${i}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <SeverityBadge severity={c.severity} />
                      <span className="text-xs text-[var(--text-primary)] truncate">{c.title}</span>
                      <span className="text-[10px] font-mono text-[var(--text-secondary)] truncate">key: {c.correlationKey}</span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)] shrink-0">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rule catalog */}
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">Rule catalog</h3>
            <div className="space-y-2">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <SeverityBadge severity={rule.severity} />
                    <span className="text-xs text-[var(--text-primary)] truncate">{rule.title}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleRule(rule)}
                    disabled={togglingId === rule.id}
                    className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0 disabled:opacity-50 ${rule.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
                  >
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Suppression rules */}
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
              <EyeOff size={12} /> Suppression rules
            </h3>
            <div className="space-y-2 mb-3">
              {suppressions.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)] italic">No suppression rules configured.</p>
              ) : suppressions.map((s) => (
                <div key={s.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--text-primary)]">
                    <span className="font-mono text-[10px] text-[var(--text-secondary)] uppercase">{s.matchType}</span> = {s.matchValue}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteSuppression(s.id)}
                    disabled={deletingId === s.id}
                    className="text-red-500 hover:text-red-400 disabled:opacity-50 shrink-0"
                    aria-label="Remove suppression rule"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-end gap-2">
              <div>
                <label className={LABEL_CLS}>Match type</label>
                <select className={INPUT_CLS} value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)}>
                  {MATCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className={LABEL_CLS}>Match value</label>
                <input className={INPUT_CLS} value={matchValue} onChange={(e) => setMatchValue(e.target.value)} placeholder="e.g. account-takeover" />
              </div>
              <button type="button" onClick={createSuppression} disabled={creating} className="btn-premium py-2 px-4 text-xs disabled:opacity-50">
                {creating ? 'Adding…' : 'Add rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
