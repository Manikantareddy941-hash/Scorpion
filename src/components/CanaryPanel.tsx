import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bird, Plus, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface CanaryCheck {
  at: string;
  errorRatePct: number | null;
  p95LatencyMs: number | null;
  passed: boolean;
  reason: string;
}

interface Canary {
  $id: string;
  app: string;
  namespace: string;
  image: string;
  status: 'running' | 'promoted' | 'rolled_back' | 'aborted';
  passedChecks: number;
  requiredChecks: number;
  consecutiveFailures: number;
  maxFailures: number;
  thresholds: { maxErrorRatePct: number; maxP95LatencyMs?: number };
  checks: CanaryCheck[];
}

interface CanaryForm {
  app: string;
  namespace: string;
  image: string;
  repo: string;
  stableRevision: string;
  canaryRevision: string;
  maxErrorRatePct: string;
  maxP95LatencyMs: string;
  intervalSec: string;
  maxFailures: string;
  requiredChecks: string;
}

const EMPTY_FORM: CanaryForm = {
  app: '', namespace: 'production', image: '', repo: '',
  stableRevision: '', canaryRevision: '',
  maxErrorRatePct: '2', maxP95LatencyMs: '', intervalSec: '60',
  maxFailures: '3', requiredChecks: '5',
};

const INPUT_CLS =
  'w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] outline-none';
const LABEL_CLS = 'block text-[9px] font-black uppercase italic text-[var(--text-secondary)] mb-1';

const STATUS_BADGES: Record<Canary['status'], string> = {
  running: 'bg-amber-500/15 text-amber-400 animate-pulse',
  promoted: 'bg-emerald-500/15 text-emerald-400',
  rolled_back: 'bg-red-500/15 text-red-400',
  aborted: 'bg-[var(--bg-primary)] text-[var(--text-secondary)]',
};

const POLL_INTERVAL_MS = 10000;

export default function CanaryPanel() {
  const { getJWT } = useAuth();
  const [canaries, setCanaries] = useState<Canary[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CanaryForm>(EMPTY_FORM);
  const [starting, setStarting] = useState(false);

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

  const loadCanaries = useCallback(async () => {
    try {
      const res = await authFetch('/api/canary');
      if (res.ok) {
        const data = await res.json();
        setCanaries(data.canaries || []);
      }
    } catch {
      // polling — stay quiet, next tick retries
    }
  }, [authFetch]);

  useEffect(() => {
    loadCanaries();
    const interval = setInterval(loadCanaries, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadCanaries]);

  const startCanary = async () => {
    setStarting(true);
    try {
      const body = {
        app: form.app.trim(),
        namespace: form.namespace.trim(),
        image: form.image.trim(),
        repo: form.repo.trim(),
        stableRevision: form.stableRevision.trim(),
        canaryRevision: form.canaryRevision.trim(),
        thresholds: {
          maxErrorRatePct: Number(form.maxErrorRatePct),
          ...(form.maxP95LatencyMs.trim() ? { maxP95LatencyMs: Number(form.maxP95LatencyMs) } : {}),
        },
        intervalSec: Number(form.intervalSec),
        maxFailures: Number(form.maxFailures),
        requiredChecks: Number(form.requiredChecks),
      };
      const res = await authFetch('/api/canary', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) {
        toast.success('Canary analysis started');
        setForm(EMPTY_FORM);
        setShowForm(false);
        await loadCanaries();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to start canary');
      }
    } catch {
      toast.error('Failed to start canary');
    } finally {
      setStarting(false);
    }
  };

  const abort = async (id: string) => {
    if (!window.confirm('Abort this canary analysis? (No rollback PR will be opened.)')) return;
    try {
      const res = await authFetch(`/api/canary/${id}/abort`, { method: 'POST' });
      if (res.ok) {
        toast.success('Canary aborted');
        await loadCanaries();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to abort canary');
      }
    } catch {
      toast.error('Failed to abort canary');
    }
  };

  const formFields: { key: keyof CanaryForm; label: string; placeholder: string }[] = [
    { key: 'app', label: 'App', placeholder: 'checkout-service' },
    { key: 'namespace', label: 'Namespace', placeholder: 'production' },
    { key: 'image', label: 'Image', placeholder: 'registry/app@sha256:…' },
    { key: 'repo', label: 'Deployment repo URL', placeholder: 'https://github.com/org/deploy-repo' },
    { key: 'stableRevision', label: 'Stable revision', placeholder: 'abc1234' },
    { key: 'canaryRevision', label: 'Canary revision', placeholder: 'def5678' },
    { key: 'maxErrorRatePct', label: 'Max error rate %', placeholder: '2' },
    { key: 'maxP95LatencyMs', label: 'Max p95 latency ms (optional)', placeholder: '500' },
    { key: 'intervalSec', label: 'Check interval (s)', placeholder: '60' },
    { key: 'maxFailures', label: 'Max consecutive failures', placeholder: '3' },
    { key: 'requiredChecks', label: 'Checks to promote', placeholder: '5' },
  ];

  return (
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Bird className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">
              Canary Analysis
            </h2>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
              Progressive delivery — Prometheus-driven checks, auto-rollback on sustained failure
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="btn-premium flex items-center gap-2 py-2 px-4"
        >
          <Plus size={14} /> {showForm ? 'Close' : 'Start Canary'}
        </button>
      </div>

      {showForm && (
        <div className="border border-[var(--border-subtle)] rounded-xl p-4 mb-6 bg-[var(--bg-primary)]/40">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {formFields.map((f) => (
              <div key={f.key}>
                <label className={LABEL_CLS}>{f.label}</label>
                <input
                  className={INPUT_CLS}
                  value={form[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={startCanary}
            disabled={starting}
            className="btn-premium mt-4 py-2 px-4 disabled:opacity-50"
          >
            {starting ? 'Starting…' : 'Launch Canary Analysis'}
          </button>
        </div>
      )}

      {canaries.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)] italic">
          No canary analyses yet. Start one to watch a release under live traffic.
        </p>
      ) : (
        <div className="space-y-3">
          {canaries.map((c) => (
            <div
              key={c.$id}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${STATUS_BADGES[c.status]}`}>
                    {c.status.replace('_', ' ')}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {c.app} <span className="text-[var(--text-secondary)]">/ {c.namespace}</span>
                    </p>
                    <p className="text-[10px] font-mono text-[var(--text-secondary)] truncate max-w-[320px]">{c.image}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-mono text-[var(--text-secondary)]">
                    {c.passedChecks}/{c.requiredChecks} checks · ≤{c.thresholds.maxErrorRatePct}% err
                  </span>
                  <div className="flex gap-1" aria-label="check timeline">
                    {c.checks.slice(-20).map((check, i) => (
                      <span
                        key={i}
                        title={`${new Date(check.at).toLocaleTimeString()} — ${check.reason}`}
                        className={`w-2.5 h-2.5 rounded-full ${check.passed ? 'bg-emerald-500' : 'bg-red-500'}`}
                      />
                    ))}
                  </div>
                  {c.status === 'running' && (
                    <button
                      type="button"
                      onClick={() => abort(c.$id)}
                      className="text-[10px] font-bold text-red-500 hover:text-red-400 uppercase tracking-widest flex items-center gap-1"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Abort
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
