import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Radar, Download } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import FalcoRuleRow from './falco/FalcoRuleRow';
import {
  csvToArray, emptyRow, rowFromRule,
  type FalcoTemplateId, type TemplateDef, type ManagedFalcoRule, type RowState,
} from './falco/falcoTypes';

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
            const row = rows[id];
            if (!row) return null;
            return (
              <FalcoRuleRow
                key={id}
                def={templates[id]}
                row={row}
                saving={savingId === id}
                onChange={(patch) => updateRow(id, patch)}
                onSave={() => save(id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
