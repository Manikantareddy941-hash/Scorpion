import { Save } from 'lucide-react';
import { PRIORITIES, INPUT_CLS, LABEL_CLS, type TemplateDef, type RowState, type FalcoPriority } from './falcoTypes';

interface FalcoRuleRowProps {
  def: TemplateDef;
  row: RowState;
  saving: boolean;
  onChange: (patch: Partial<RowState>) => void;
  onSave: () => void;
}

export default function FalcoRuleRow({ def, row, saving, onChange, onSave }: FalcoRuleRowProps) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{def.falcoRuleName}</p>
          <p className="text-[10px] text-[var(--text-secondary)] font-mono">{def.description} · base priority {def.priority}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onChange({ enabled: !row.enabled })}
            className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${row.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
          >
            {row.enabled ? 'Enabled' : 'Disabled'}
          </button>
          <button
            type="button"
            onClick={() => onChange({ suppressed: !row.suppressed })}
            className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${row.suppressed ? 'bg-amber-500/15 text-amber-400' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
          >
            {row.suppressed ? 'Suppressed' : 'Active'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label className={LABEL_CLS}>App scope (image prefix, optional)</label>
          <input className={INPUT_CLS} value={row.appScope} onChange={(e) => onChange({ appScope: e.target.value })} placeholder="registry/my-app" />
        </div>
        <div>
          <label className={LABEL_CLS}>Severity override</label>
          <select className={INPUT_CLS} value={row.severityOverride} onChange={(e) => onChange({ severityOverride: e.target.value as FalcoPriority | '' })}>
            <option value="">Use template default ({def.priority})</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className={LABEL_CLS}>Allowed processes (comma-separated)</label>
          <input className={INPUT_CLS} value={row.allowedProcs} onChange={(e) => onChange({ allowedProcs: e.target.value })} placeholder="bash, sh" />
        </div>
        <div>
          <label className={LABEL_CLS}>Allowed domains (comma-separated)</label>
          <input className={INPUT_CLS} value={row.allowedDomains} onChange={(e) => onChange({ allowedDomains: e.target.value })} placeholder="api.internal.com" />
        </div>
        <div>
          <label className={LABEL_CLS}>Watched paths (comma-separated)</label>
          <input className={INPUT_CLS} value={row.watchedPaths} onChange={(e) => onChange({ watchedPaths: e.target.value })} placeholder="/etc/passwd" />
        </div>
      </div>

      <button type="button" onClick={onSave} disabled={saving} className="btn-premium flex items-center gap-2 py-1.5 px-3 text-xs disabled:opacity-50">
        <Save size={12} /> {saving ? 'Saving…' : row.id ? 'Save changes' : 'Create rule'}
      </button>
    </div>
  );
}
