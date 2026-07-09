import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Radar, Download, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

type FalcoTemplateId =
  | 'terminal-shell-in-container' | 'outbound-unknown-domain' | 'write-below-etc'
  | 'sensitive-file-read' | 'spawn-package-manager';
type FalcoPriority =
  | 'Emergency' | 'Alert' | 'Critical' | 'Error'
  | 'Warning' | 'Notice' | 'Informational' | 'Debug';

interface TemplateDef { falcoRuleName: string; description: string; priority: FalcoPriority }
interface ManagedFalcoRule {
  id: string;
  template: FalcoTemplateId;
  params: { allowedProcs?: string[]; allowedDomains?: string[]; watchedPaths?: string[] };
  appScope?: string;
  severityOverride?: FalcoPriority;
  suppressed: boolean;
  enabled: boolean;
}

interface RowState {
  id?: string;
  appScope: string;
  severityOverride: FalcoPriority | '';
  suppressed: boolean;
  enabled: boolean;
  allowedProcs: string;
  allowedDomains: string;
  watchedPaths: string;
}

const PRIORITIES: FalcoPriority[] = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Informational', 'Debug'];

const INPUT_CLS =
  'w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] outline-none';
const LABEL_CLS = 'block text-[9px] font-black uppercase italic text-[var(--text-secondary)] mb-1';

const csvToArray = (text: string): string[] => text.split(',').map((s) => s.trim()).filter(Boolean);

const emptyRow = (): RowState => ({
  appScope: '', severityOverride: '', suppressed: false, enabled: true,
  allowedProcs: '', allowedDomains: '', watchedPaths: '',
});

function rowFromRule(rule: ManagedFalcoRule): RowState {
  return {
    id: rule.id,
    appScope: rule.appScope || '',
    severityOverride: rule.severityOverride || '',
    suppressed: rule.suppressed,
    enabled: rule.enabled,
    allowedProcs: (rule.params.allowedProcs || []).join(', '),
    allowedDomains: (rule.params.allowedDomains || []).join(', '),
    watchedPaths: (rule.params.watchedPaths || []).join(', '),
  };
}

export default function FalcoRulesPanel() {
  const { getJWT } = useAuth();
  const [templates, setTemplates] = useState<Record<FalcoTemplateId, TemplateDef> | null>(null);
  const [rows, setRows] = useState<Partial<Record<FalcoTemplateId, RowState>>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<FalcoTemplateId | null>(null);
  const [exporting, setExporting] = useState(false);

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
      const res = await authFetch('/api/falco-rules');
      if (!res.ok) { setError('Failed to load Falco rules'); return; }
      const data: { rules: ManagedFalcoRule[]; templates: Record<FalcoTemplateId, TemplateDef> } = await res.json();
      setTemplates(data.templates);
      const next: Partial<Record<FalcoTemplateId, RowState>> = {};
      (Object.keys(data.templates) as FalcoTemplateId[]).forEach((id) => {
        const existing = data.rules.find((r) => r.template === id);
        next[id] = existing ? rowFromRule(existing) : emptyRow();
      });
      setRows(next);
      setError(null);
    } catch {
      setError('Failed to load Falco rules');
    }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const updateRow = (id: FalcoTemplateId, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] as RowState), ...patch } }));
  };

  const save = async (id: FalcoTemplateId) => {
    const row = rows[id];
    if (!row) return;
    setSavingId(id);
    try {
      const body = {
        template: id,
        params: {
          allowedProcs: csvToArray(row.allowedProcs),
          allowedDomains: csvToArray(row.allowedDomains),
          watchedPaths: csvToArray(row.watchedPaths),
        },
        appScope: row.appScope.trim() || undefined,
        severityOverride: row.severityOverride || undefined,
        suppressed: row.suppressed,
        enabled: row.enabled,
      };
      const res = row.id
        ? await authFetch(`/api/falco-rules/${row.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await authFetch('/api/falco-rules', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) {
        toast.success('Rule saved');
        await load();
      } else {
        toast.error((await res.json().catch(() => ({}))).error || 'Failed to save rule');
      }
    } catch {
      toast.error('Failed to save rule');
    } finally {
      setSavingId(null);
    }
  };

  const exportYaml = async () => {
    setExporting(true);
    try {
      const res = await authFetch('/api/falco-rules/export');
      if (!res.ok) { toast.error('Failed to export rules'); return; }
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'falco_rules.local.yaml';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to export rules');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Radar className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">Falco Rules</h2>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
              Runtime detection catalog — exported as a ConfigMap, never pushed live
            </p>
          </div>
        </div>
        <button type="button" onClick={exportYaml} disabled={exporting} className="btn-premium flex items-center gap-2 py-2 px-4 disabled:opacity-50">
          <Download size={14} /> {exporting ? 'Exporting…' : 'Export YAML'}
        </button>
      </div>

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {!templates ? (
        <p className="text-xs text-[var(--text-secondary)]">Loading rules…</p>
      ) : (
        <div className="space-y-3">
          {(Object.keys(templates) as FalcoTemplateId[]).map((id) => {
            const def = templates[id];
            const row = rows[id];
            if (!row) return null;
            return (
              <div key={id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{def.falcoRuleName}</p>
                    <p className="text-[10px] text-[var(--text-secondary)] font-mono">{def.description} · base priority {def.priority}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => updateRow(id, { enabled: !row.enabled })}
                      className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${row.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
                    >
                      {row.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRow(id, { suppressed: !row.suppressed })}
                      className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${row.suppressed ? 'bg-amber-500/15 text-amber-400' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
                    >
                      {row.suppressed ? 'Suppressed' : 'Active'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className={LABEL_CLS}>App scope (image prefix, optional)</label>
                    <input className={INPUT_CLS} value={row.appScope} onChange={(e) => updateRow(id, { appScope: e.target.value })} placeholder="registry/my-app" />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Severity override</label>
                    <select className={INPUT_CLS} value={row.severityOverride} onChange={(e) => updateRow(id, { severityOverride: e.target.value as FalcoPriority | '' })}>
                      <option value="">Use template default ({def.priority})</option>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className={LABEL_CLS}>Allowed processes (comma-separated)</label>
                    <input className={INPUT_CLS} value={row.allowedProcs} onChange={(e) => updateRow(id, { allowedProcs: e.target.value })} placeholder="bash, sh" />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Allowed domains (comma-separated)</label>
                    <input className={INPUT_CLS} value={row.allowedDomains} onChange={(e) => updateRow(id, { allowedDomains: e.target.value })} placeholder="api.internal.com" />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Watched paths (comma-separated)</label>
                    <input className={INPUT_CLS} value={row.watchedPaths} onChange={(e) => updateRow(id, { watchedPaths: e.target.value })} placeholder="/etc/passwd" />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => save(id)}
                  disabled={savingId === id}
                  className="btn-premium flex items-center gap-2 py-1.5 px-3 text-xs disabled:opacity-50"
                >
                  <Save size={12} /> {savingId === id ? 'Saving…' : row.id ? 'Save changes' : 'Create rule'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
