import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Siren, ShieldCheck, XCircle, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

type SoarActionType = 'capture_evidence' | 'slack_escalate' | 'isolate_pod' | 'kill_pod';
type SoarActionMode = 'auto' | 'approval';
type SoarActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
type FalcoPriority =
  | 'Emergency' | 'Alert' | 'Critical' | 'Error'
  | 'Warning' | 'Notice' | 'Informational' | 'Debug';

interface PlaybookAction { type: SoarActionType; mode: SoarActionMode }
interface Playbook {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { rulePattern?: string; minPriority: FalcoPriority };
  actions: PlaybookAction[];
}
interface SoarActionRecord {
  id: string;
  actionType: SoarActionType;
  playbookName: string;
  status: SoarActionStatus;
  namespace?: string;
  podName?: string;
  falcoRule: string;
  createdAt: string;
}

const PRIORITIES: FalcoPriority[] = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Informational', 'Debug'];
const ACTION_TYPES: SoarActionType[] = ['capture_evidence', 'slack_escalate', 'isolate_pod', 'kill_pod'];
const DESTRUCTIVE = new Set<SoarActionType>(['isolate_pod', 'kill_pod']);
const EMPTY_ACTION_ROW: PlaybookAction = { type: 'capture_evidence', mode: 'auto' };
const POLL_INTERVAL_MS = 15000;

const INPUT_CLS =
  'w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] outline-none';
const LABEL_CLS = 'block text-[9px] font-black uppercase italic text-[var(--text-secondary)] mb-1';

function ageLabel(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function SoarPanel() {
  const { getJWT } = useAuth();
  const [actions, setActions] = useState<SoarActionRecord[]>([]);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [playbooksError, setPlaybooksError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [rulePattern, setRulePattern] = useState('');
  const [minPriority, setMinPriority] = useState<FalcoPriority>('Warning');
  const [actionRows, setActionRows] = useState<PlaybookAction[]>([{ ...EMPTY_ACTION_ROW }]);
  const [creating, setCreating] = useState(false);

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

  const loadActions = useCallback(async () => {
    try {
      const res = await authFetch('/api/soar/actions?status=pending');
      if (res.ok) {
        setActions((await res.json()).actions || []);
        setActionsError(null);
      } else {
        setActionsError('Failed to load pending approvals');
      }
    } catch {
      setActionsError('Failed to load pending approvals');
    }
  }, [authFetch]);

  const loadPlaybooks = useCallback(async () => {
    try {
      const res = await authFetch('/api/soar/playbooks');
      if (res.ok) {
        setPlaybooks((await res.json()).playbooks || []);
        setPlaybooksError(null);
      } else {
        setPlaybooksError('Failed to load playbooks');
      }
    } catch {
      setPlaybooksError('Failed to load playbooks');
    }
  }, [authFetch]);

  useEffect(() => {
    loadActions();
    const interval = setInterval(loadActions, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadActions]);

  useEffect(() => {
    loadPlaybooks();
  }, [loadPlaybooks]);

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
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center gap-3 mb-4">
        <Siren className="w-5 h-5 text-red-400" />
        <div>
          <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">SOAR Response</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
            Falco-triggered playbooks — destructive actions require approval by default
          </p>
        </div>
      </div>

      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] mb-2">Pending approvals</h3>
      {actionsError && <p className="text-xs text-red-500 mb-3">{actionsError}</p>}
      {actions.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)] italic mb-6">No actions awaiting approval.</p>
      ) : (
        <div className="space-y-2 mb-6">
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

      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">Playbooks</h3>
        <button type="button" onClick={() => setShowForm(!showForm)} className="btn-premium flex items-center gap-2 py-1.5 px-3 text-xs">
          <Plus size={12} /> {showForm ? 'Close' : 'New Playbook'}
        </button>
      </div>
      {playbooksError && <p className="text-xs text-red-500 mb-3">{playbooksError}</p>}

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
                <select
                  className={INPUT_CLS}
                  value={row.type}
                  onChange={(e) => updateRow(i, { type: e.target.value as SoarActionType })}
                >
                  {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {DESTRUCTIVE.has(row.type) && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-red-400 flex items-center gap-1 shrink-0">
                    <AlertTriangle size={10} /> destructive
                  </span>
                )}
                <select
                  className={`${INPUT_CLS} max-w-[120px]`}
                  value={row.mode}
                  onChange={(e) => updateRow(i, { mode: e.target.value as SoarActionMode })}
                >
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
