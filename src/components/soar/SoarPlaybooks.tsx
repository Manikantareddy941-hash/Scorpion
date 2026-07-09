import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  PRIORITIES, ACTION_TYPES, DESTRUCTIVE, INPUT_CLS, LABEL_CLS,
  type Playbook, type PlaybookAction, type FalcoPriority, type SoarActionType, type SoarActionMode,
} from './soarTypes';

const EMPTY_ACTION_ROW: PlaybookAction = { type: 'capture_evidence', mode: 'auto' };

export default function SoarPlaybooks() {
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
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [rulePattern, setRulePattern] = useState('');
  const [minPriority, setMinPriority] = useState<FalcoPriority>('Warning');
  const [actionRows, setActionRows] = useState<PlaybookAction[]>([{ ...EMPTY_ACTION_ROW }]);
  const [creating, setCreating] = useState(false);

  const loadPlaybooks = useCallback(async () => {
    try {
      const res = await authFetch('/api/soar/playbooks');
      if (res.ok) {
        setPlaybooks((await res.json()).playbooks || []);
        setError(null);
      } else {
        setError('Failed to load playbooks');
      }
    } catch {
      setError('Failed to load playbooks');
    }
  }, [authFetch]);

  useEffect(() => { loadPlaybooks(); }, [loadPlaybooks]);

  const toggleEnabled = async (pb: Playbook) => {
    try {
      const res = await authFetch(`/api/soar/playbooks/${pb.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !pb.enabled }),
      });
      if (res.ok) toast.success('Playbook updated');
      else toast.error('Failed to update playbook');
    } catch {
      toast.error('Failed to update playbook');
    } finally {
      await loadPlaybooks();
    }
  };

  const updateRow = (i: number, patch: Partial<PlaybookAction>) => {
    setActionRows((rows) => rows.map((r, idx) => {
      if (idx !== i) return r;
      const next = { ...r, ...patch };
      if (patch.type && DESTRUCTIVE.has(patch.type)) next.mode = 'approval';
      return next;
    }));
  };

  const createPlaybook = async () => {
    if (!name.trim() || actionRows.length === 0) {
      toast.error('Name and at least one action are required');
      return;
    }
    setCreating(true);
    try {
      const body = {
        name: name.trim(),
        enabled: true,
        trigger: { minPriority, ...(rulePattern.trim() ? { rulePattern: rulePattern.trim() } : {}) },
        actions: actionRows,
      };
      const res = await authFetch('/api/soar/playbooks', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) {
        toast.success('Playbook created');
        setName(''); setRulePattern(''); setMinPriority('Warning'); setActionRows([{ ...EMPTY_ACTION_ROW }]);
        setShowForm(false);
        await loadPlaybooks();
      } else {
        toast.error((await res.json().catch(() => ({}))).error || 'Failed to create playbook');
      }
    } catch {
      toast.error('Failed to create playbook');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">Playbooks</h3>
        <button type="button" onClick={() => setShowForm(!showForm)} className="btn-premium flex items-center gap-2 py-1.5 px-3 text-xs">
          <Plus size={12} /> {showForm ? 'Close' : 'New Playbook'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {showForm && (
        <div className="border border-[var(--border-subtle)] rounded-xl p-4 mb-4 bg-[var(--bg-primary)]/40">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className={LABEL_CLS}>Name</label>
              <input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} placeholder="Isolate on shell exec" />
            </div>
            <div>
              <label className={LABEL_CLS}>Rule pattern (optional)</label>
              <input className={INPUT_CLS} value={rulePattern} onChange={(e) => setRulePattern(e.target.value)} placeholder="Terminal shell*" />
            </div>
            <div>
              <label className={LABEL_CLS}>Min priority</label>
              <select className={INPUT_CLS} value={minPriority} onChange={(e) => setMinPriority(e.target.value as FalcoPriority)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <label className={LABEL_CLS}>Actions</label>
          <div className="space-y-2 mb-3">
            {actionRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className={INPUT_CLS} value={row.type} onChange={(e) => updateRow(i, { type: e.target.value as SoarActionType })}>
                  {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {DESTRUCTIVE.has(row.type) && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-red-400 flex items-center gap-1 shrink-0">
                    <AlertTriangle size={10} /> destructive
                  </span>
                )}
                <select className={`${INPUT_CLS} max-w-[120px]`} value={row.mode} onChange={(e) => updateRow(i, { mode: e.target.value as SoarActionMode })}>
                  <option value="auto">auto</option>
                  <option value="approval">approval</option>
                </select>
                <button
                  type="button"
                  onClick={() => setActionRows((rows) => rows.filter((_, idx) => idx !== i))}
                  disabled={actionRows.length === 1}
                  className="text-red-500 hover:text-red-400 disabled:opacity-30 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setActionRows((rows) => [...rows, { ...EMPTY_ACTION_ROW }])}
            className="text-[10px] font-bold text-[var(--accent-primary)] uppercase tracking-widest flex items-center gap-1 mb-4"
          >
            <Plus size={12} /> Add action
          </button>

          <button type="button" onClick={createPlaybook} disabled={creating} className="btn-premium py-2 px-4 disabled:opacity-50 block">
            {creating ? 'Creating…' : 'Create Playbook'}
          </button>
        </div>
      )}

      {playbooks.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)] italic">No playbooks configured yet.</p>
      ) : (
        <div className="space-y-2">
          {playbooks.map((pb) => (
            <div key={pb.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{pb.name}</p>
                <p className="text-[10px] font-mono text-[var(--text-secondary)]">
                  {pb.trigger.rulePattern || 'any rule'} · ≥{pb.trigger.minPriority} · {pb.actions.map((a) => a.type).join(', ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleEnabled(pb)}
                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full transition-colors ${
                  pb.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                }`}
              >
                {pb.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
