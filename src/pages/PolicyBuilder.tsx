import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Save, Play, ShieldCheck, FileCode } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface Policy {
  $id: string;
  name?: string;
  minSecurityScore?: number;
  blockOnCritical?: boolean;
  allowedSnoozeDays?: number;
  blockedFalcoRules?: string[];
  regoCode?: string;
}

interface PolicyForm {
  name: string;
  minSecurityScore: number;
  blockOnCritical: boolean;
  allowedSnoozeDays: number;
  blockedFalcoRules: string; // newline-separated in the form
  regoCode: string;
}

interface EvalResult {
  allow: boolean;
  denyReasons: string[];
}

const INPUT_CLS =
  'w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none';
const LABEL_CLS = 'block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5';

const EMPTY_FORM: PolicyForm = {
  name: '',
  minSecurityScore: 80,
  blockOnCritical: true,
  allowedSnoozeDays: 14,
  blockedFalcoRules: '',
  regoCode: '',
};

function toForm(p: Policy): PolicyForm {
  return {
    name: p.name ?? '',
    minSecurityScore: p.minSecurityScore ?? 80,
    blockOnCritical: p.blockOnCritical ?? true,
    allowedSnoozeDays: p.allowedSnoozeDays ?? 14,
    blockedFalcoRules: (p.blockedFalcoRules ?? []).join('\n'),
    regoCode: p.regoCode ?? '',
  };
}

function fromForm(f: PolicyForm) {
  return {
    name: f.name.trim() || 'Untitled policy',
    minSecurityScore: Number(f.minSecurityScore),
    blockOnCritical: f.blockOnCritical,
    allowedSnoozeDays: Number(f.allowedSnoozeDays),
    blockedFalcoRules: f.blockedFalcoRules.split('\n').map((l) => l.trim()).filter(Boolean),
    regoCode: f.regoCode.trim() || undefined,
  };
}

export default function PolicyBuilder() {
  const { getJWT } = useAuth();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(EMPTY_FORM);
  const [opaAvailable, setOpaAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [sample, setSample] = useState({ critical_count: 1, high_count: 3, security_score: 72, environment: 'production' });

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

  const loadPolicies = useCallback(async () => {
    try {
      const res = await authFetch('/api/policies');
      if (res.ok) setPolicies(await res.json());
    } catch {
      toast.error('Failed to load policies');
    }
  }, [authFetch]);

  useEffect(() => {
    loadPolicies();
    authFetch('/api/policies/opa/status')
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => setOpaAvailable(!!d.available))
      .catch(() => setOpaAvailable(false));
  }, [loadPolicies, authFetch]);

  const selectPolicy = (p: Policy) => {
    setSelectedId(p.$id);
    setForm(toForm(p));
    setEvalResult(null);
  };

  const newPolicy = () => {
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setEvalResult(null);
  };

  const savePolicy = async () => {
    setSaving(true);
    try {
      const body = JSON.stringify(fromForm(form));
      const res = selectedId
        ? await authFetch(`/api/policies/${selectedId}`, { method: 'PATCH', body })
        : await authFetch('/api/policies', { method: 'POST', body });
      if (res.ok) {
        const saved: Policy = await res.json();
        setSelectedId(saved.$id);
        await loadPolicies();
        toast.success('Policy saved');
      } else {
        toast.error('Failed to save policy');
      }
    } catch {
      toast.error('Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const deletePolicy = async (id: string) => {
    if (!window.confirm('Delete this policy?')) return;
    try {
      const res = await authFetch(`/api/policies/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedId === id) newPolicy();
        await loadPolicies();
        toast.success('Policy deleted');
      }
    } catch {
      toast.error('Failed to delete policy');
    }
  };

  const evaluate = async () => {
    if (!selectedId) {
      toast.error('Save the policy first, then test it');
      return;
    }
    setEvaluating(true);
    setEvalResult(null);
    try {
      const res = await authFetch(`/api/policies/${selectedId}/evaluate`, {
        method: 'POST',
        body: JSON.stringify({
          input: {
            critical_count: Number(sample.critical_count),
            high_count: Number(sample.high_count),
            security_score: Number(sample.security_score),
            environment: sample.environment,
            blocked_falco_rules_matched: [],
          },
        }),
      });
      if (res.ok) {
        setEvalResult(await res.json());
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.details || 'Evaluation failed');
      }
    } catch {
      toast.error('Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="premium-card p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight text-[var(--text-primary)]">
            Policy builder
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-1">
            Write release-gate policies as code — thresholds plus optional OPA/Rego.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${
              opaAvailable === null
                ? 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                : opaAvailable
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-amber-500/15 text-amber-400'
            }`}
          >
            <ShieldCheck size={11} className="inline mr-1" />
            OPA {opaAvailable === null ? '…' : opaAvailable ? 'available' : 'not installed'}
          </span>
          <button type="button" onClick={newPolicy} className="btn-premium flex items-center gap-2 py-2 px-4">
            <Plus size={14} /> New Policy
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Policy list */}
        <div className="premium-card p-4 space-y-2">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)] mb-2">Policies</h2>
          {policies.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)]">No policies yet. Create one to gate releases.</p>
          )}
          {policies.map((p) => (
            <div
              key={p.$id}
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 cursor-pointer ${
                selectedId === p.$id ? 'bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-primary)]'
              }`}
              onClick={() => selectPolicy(p)}
            >
              <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {p.name || 'Untitled policy'}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deletePolicy(p.$id);
                }}
                className="text-[var(--text-secondary)] hover:text-red-400"
                title="Delete policy"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div className="premium-card p-5 space-y-4 lg:col-span-2">
          <div>
            <label className={LABEL_CLS}>Name</label>
            <input
              className={INPUT_CLS}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Production release gate"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLS}>Min security score</label>
              <input
                type="number"
                min={0}
                max={100}
                aria-label="Minimum security score"
                className={INPUT_CLS}
                value={form.minSecurityScore}
                onChange={(e) => setForm({ ...form, minSecurityScore: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Allowed snooze days</label>
              <input
                type="number"
                min={0}
                aria-label="Allowed snooze days"
                className={INPUT_CLS}
                value={form.allowedSnoozeDays}
                onChange={(e) => setForm({ ...form, allowedSnoozeDays: Number(e.target.value) })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.blockOnCritical}
              onChange={(e) => setForm({ ...form, blockOnCritical: e.target.checked })}
            />
            <span className="text-sm font-semibold text-[var(--text-primary)]">Block release on any CRITICAL finding</span>
          </label>

          <div>
            <label className={LABEL_CLS}>Blocked Falco rules (one per line)</label>
            <textarea
              className={`${INPUT_CLS} font-mono`}
              rows={3}
              value={form.blockedFalcoRules}
              onChange={(e) => setForm({ ...form, blockedFalcoRules: e.target.value })}
              placeholder={'Terminal shell opened in container\nWrite below etc'}
            />
          </div>

          <div>
            <label className={`${LABEL_CLS} flex items-center gap-1`}>
              <FileCode size={12} /> Custom OPA / Rego (optional — additive to thresholds)
            </label>
            <textarea
              className={`${INPUT_CLS} font-mono`}
              rows={8}
              value={form.regoCode}
              onChange={(e) => setForm({ ...form, regoCode: e.target.value })}
              placeholder={'package scorpion\n\ndefault allow = false\n\nallow {\n  input.security_score >= 80\n  input.critical_count == 0\n}'}
            />
          </div>

          <button type="button" onClick={savePolicy} disabled={saving} className="btn-premium flex items-center gap-2 py-2 px-4 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Saving…' : 'Save Policy'}
          </button>

          {/* Test / evaluate */}
          <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">Test this policy</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className={LABEL_CLS}>Critical</label>
                <input type="number" min={0} aria-label="Critical finding count" className={INPUT_CLS} value={sample.critical_count}
                  onChange={(e) => setSample({ ...sample, critical_count: Number(e.target.value) })} />
              </div>
              <div>
                <label className={LABEL_CLS}>High</label>
                <input type="number" min={0} aria-label="High finding count" className={INPUT_CLS} value={sample.high_count}
                  onChange={(e) => setSample({ ...sample, high_count: Number(e.target.value) })} />
              </div>
              <div>
                <label className={LABEL_CLS}>Score</label>
                <input type="number" min={0} max={100} aria-label="Security score" className={INPUT_CLS} value={sample.security_score}
                  onChange={(e) => setSample({ ...sample, security_score: Number(e.target.value) })} />
              </div>
              <div>
                <label className={LABEL_CLS}>Environment</label>
                <input aria-label="Environment" className={INPUT_CLS} value={sample.environment}
                  onChange={(e) => setSample({ ...sample, environment: e.target.value })} />
              </div>
            </div>
            <button type="button" onClick={evaluate} disabled={evaluating} className="btn-ghost flex items-center gap-2 py-2 px-4 disabled:opacity-50">
              <Play size={14} /> {evaluating ? 'Evaluating…' : 'Run Evaluation'}
            </button>

            {evalResult && (
              <div className={`rounded-lg p-3 ${evalResult.allow ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <p className={`text-sm font-black uppercase tracking-wider ${evalResult.allow ? 'text-emerald-400' : 'text-red-400'}`}>
                  {evalResult.allow ? 'ALLOW — release would pass' : 'DENY — release blocked'}
                </p>
                {evalResult.denyReasons.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {evalResult.denyReasons.map((r, i) => (
                      <li key={i} className="text-xs text-[var(--text-primary)]">• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
