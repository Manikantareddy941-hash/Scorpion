import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ShieldCheck, RefreshCw, Check, Ban, RotateCcw, AlertTriangle, FileText, Send, Ticket } from 'lucide-react';
import toast from 'react-hot-toast';

// Plan-phase Security Requirements workspace (feature 2a). Configure a project
// profile, generate the traceable requirement set, and mark each satisfied or
// waived (with justification — the audit trail).

const APP_TYPES = ['web', 'api', 'mobile', 'service'] as const;
const STACKS = ['node', 'python', 'java', 'go', 'dotnet', 'ruby'] as const;
const DATA_TYPES = ['card', 'health', 'pii', 'none'] as const;
const DEPLOYMENTS = ['cloud', 'on-prem', 'hybrid'] as const;
const AUTH_MODELS = ['none', 'session', 'oauth', 'mtls'] as const;
const FRAMEWORKS = ['PCI DSS', 'NIST 800-53', 'SOC 2', 'ISO 27001', 'HIPAA', 'GDPR'] as const;

interface Project { $id: string; name: string }
interface Repo { $id: string; url: string; name?: string }

interface Profile {
  appType: string;
  stack: string[];
  dataTypes: string[];
  deployment: string;
  authModel: string;
  frameworks: string[];
}

interface Requirement {
  $id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  frameworks: string[];
  controlIds: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'required' | 'recommended';
  lifecycleStatus: 'open' | 'satisfied' | 'waived' | 'obsolete';
  justification?: string;
  updatedBy?: string;
  remediation: string;
  ticketId?: string;
  jiraKey?: string;
}

interface Correlation {
  requirement: { $id: string };
  status: 'violated' | 'attested' | 'unverified';
  matchedFindings: unknown[];
  contradictsAttestation: boolean;
}

// Per-requirement scan verdict, keyed by requirement $id.
type CorrEntry = { status: string; count: number; contradicts: boolean };

const defaultProfile: Profile = {
  appType: 'api', stack: ['node'], dataTypes: ['none'],
  deployment: 'cloud', authModel: 'session', frameworks: [],
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

const LIFECYCLE_STYLES: Record<string, string> = {
  open: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  satisfied: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  waived: 'bg-stone-500/15 text-stone-300 border-stone-500/40',
  obsolete: 'bg-slate-700/40 text-slate-500 border-slate-600/30 line-through',
};

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-sm border transition ${
        active
          ? 'bg-indigo-500/20 text-indigo-200 border-indigo-400/40'
          : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'
      }`}
    >
      {label}
    </button>
  );
}

export default function RequirementsWorkspace() {
  const { getJWT } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [corr, setCorr] = useState<Record<string, CorrEntry>>({});
  const [repos, setRepos] = useState<Repo[]>([]);
  const [boundRepoIds, setBoundRepoIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [waiveTarget, setWaiveTarget] = useState<Requirement | null>(null);
  const [justification, setJustification] = useState('');

  const authHeaders = useCallback(async (json = false): Promise<Record<string, string>> => {
    const token = await getJWT();
    const base: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (json) base['Content-Type'] = 'application/json';
    return base;
  }, [getJWT]);

  // Load projects once.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/plan/projects', { headers: await authHeaders() });
        if (!res.ok) return;
        const projs: Project[] = await res.json();
        setProjects(projs);
        if (projs.length > 0) setProjectId(projs[0].$id);
      } catch { toast.error('Failed to load projects'); }
    })();
  }, [authHeaders]);

  const loadForProject = useCallback(async (pid: string) => {
    try {
      const headers = await authHeaders();
      const [profRes, reqRes, reposRes, boundRes] = await Promise.all([
        fetch(`/api/plan/projects/${pid}/profile`, { headers }),
        fetch(`/api/plan/projects/${pid}/requirements`, { headers }),
        fetch('/api/repos', { headers }),
        fetch(`/api/plan/projects/${pid}/repos`, { headers }),
      ]);
      if (profRes.ok) {
        const p = await profRes.json();
        setProfile(p ? { ...defaultProfile, ...p } : defaultProfile);
      }
      if (reqRes.ok) setRequirements(await reqRes.json());
      if (reposRes.ok) {
        const data = await reposRes.json();
        setRepos(Array.isArray(data) ? data : data.documents ?? []);
      }
      if (boundRes.ok) {
        const bound: { repoId: string }[] = await boundRes.json();
        setBoundRepoIds(bound.map((b) => b.repoId));
      }
    } catch { toast.error('Failed to load requirements'); }
  }, [authHeaders]);

  // Scan correlation is a best-effort UI signal — a fetch failure just leaves
  // requirements unbadged, it never blocks the workspace.
  const loadCorrelation = useCallback(async (pid: string) => {
    try {
      const res = await fetch(`/api/plan/projects/${pid}/requirements/correlation`, { headers: await authHeaders() });
      if (!res.ok) return;
      const rows: Correlation[] = await res.json();
      const map: Record<string, CorrEntry> = {};
      for (const row of rows) {
        map[row.requirement.$id] = { status: row.status, count: row.matchedFindings.length, contradicts: row.contradictsAttestation };
      }
      setCorr(map);
    } catch { /* leave requirements unbadged */ }
  }, [authHeaders]);

  useEffect(() => { if (projectId) { loadForProject(projectId); loadCorrelation(projectId); } }, [projectId, loadForProject, loadCorrelation]);

  const toggle = (key: 'stack' | 'dataTypes' | 'frameworks', value: string) => {
    setProfile((prev) => {
      const has = prev[key].includes(value);
      return { ...prev, [key]: has ? prev[key].filter((v) => v !== value) : [...prev[key], value] };
    });
  };

  const toggleRepo = (id: string) =>
    setBoundRepoIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const saveRepos = async () => {
    try {
      const res = await fetch(`/api/plan/projects/${projectId}/repos`, {
        method: 'PUT', headers: await authHeaders(true), body: JSON.stringify({ repoIds: boundRepoIds }),
      });
      if (!res.ok) { toast.error('Failed to bind repositories'); return; }
      const bound: { repoId: string }[] = await res.json();
      setBoundRepoIds(bound.map((b) => b.repoId)); // server drops any repo you can't access
      loadCorrelation(projectId); // scope changed — refresh the scan verdicts
      toast.success('Repositories bound');
    } catch { toast.error('Failed to bind repositories'); }
  };

  const saveProfile = async () => {
    try {
      const res = await fetch(`/api/plan/projects/${projectId}/profile`, {
        method: 'PUT', headers: await authHeaders(true), body: JSON.stringify(profile),
      });
      if (res.ok) toast.success('Profile saved');
      else toast.error('Invalid profile');
    } catch { toast.error('Failed to save profile'); }
  };

  const generate = async () => {
    if (profile.frameworks.length === 0) { toast.error('Select at least one framework first'); return; }
    setGenerating(true);
    try {
      await saveProfile();
      const res = await fetch(`/api/plan/projects/${projectId}/requirements/generate`, {
        method: 'POST', headers: await authHeaders(),
      });
      if (res.ok) { setRequirements(await res.json()); loadCorrelation(projectId); toast.success('Requirements generated'); }
      else { const e = await res.json(); toast.error(e.error || 'Generation failed'); }
    } catch { toast.error('Generation failed'); }
    finally { setGenerating(false); }
  };

  const setLifecycle = async (req: Requirement, lifecycleStatus: string, just?: string) => {
    try {
      const res = await fetch(`/api/plan/requirements/${req.$id}`, {
        method: 'PATCH', headers: await authHeaders(true),
        body: JSON.stringify({ lifecycleStatus, justification: just }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRequirements((prev) => prev.map((r) => (r.$id === req.$id ? updated : r)));
        loadCorrelation(projectId); // attestation change can flip the scan verdict
      } else toast.error('Update failed');
    } catch { toast.error('Update failed'); }
  };

  const confirmWaive = async () => {
    if (!waiveTarget) return;
    if (!justification.trim()) { toast.error('Justification is required to waive'); return; }
    await setLifecycle(waiveTarget, 'waived', justification.trim());
    setWaiveTarget(null); setJustification('');
  };

  const pushToJira = async (req: Requirement) => {
    try {
      const res = await fetch(`/api/plan/requirements/${req.$id}/ticket`, { method: 'POST', headers: await authHeaders() });
      if (!res.ok) { toast.error('Push to Jira failed'); return; }
      const result = await res.json();
      setRequirements((prev) => prev.map((r) => (r.$id === req.$id ? { ...r, ticketId: result.ticketId, jiraKey: result.jiraKey } : r)));
      toast.success(result.jiraKey ? `Pushed to Jira (${result.jiraKey})` : 'Ticket created (configure Jira to sync)');
    } catch { toast.error('Push to Jira failed'); }
  };

  const active = requirements.filter((r) => r.lifecycleStatus !== 'obsolete');
  const byFramework = FRAMEWORKS
    .map((fw) => ({ fw, items: active.filter((r) => r.frameworks.includes(fw)) }))
    .filter((g) => g.items.length > 0);
  const satisfiedCount = active.filter((r) => r.lifecycleStatus === 'satisfied').length;
  const violatedCount = active.filter((r) => corr[r.$id]?.status === 'violated').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-indigo-400" size={28} />
          <div>
            <h1 className="text-2xl font-semibold">Security Requirements</h1>
            <p className="text-sm text-slate-400">Shift-left requirements generated from the project profile</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p.$id} value={p.$id}>{p.name}</option>)}
          </select>
          <button
            type="button"
            onClick={generate}
            disabled={!projectId || generating}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <RefreshCw size={16} className={generating ? 'animate-spin' : ''} /> Generate
          </button>
        </div>
      </header>

      {/* Profile */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wide">Project profile</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Application type">
            <div className="flex flex-wrap gap-2">
              {APP_TYPES.map((t) => <Chip key={t} label={t} active={profile.appType === t} onClick={() => setProfile((p) => ({ ...p, appType: t }))} />)}
            </div>
          </Field>
          <Field label="Deployment">
            <div className="flex flex-wrap gap-2">
              {DEPLOYMENTS.map((d) => <Chip key={d} label={d} active={profile.deployment === d} onClick={() => setProfile((p) => ({ ...p, deployment: d }))} />)}
            </div>
          </Field>
          <Field label="Tech stack">
            <div className="flex flex-wrap gap-2">
              {STACKS.map((s) => <Chip key={s} label={s} active={profile.stack.includes(s)} onClick={() => toggle('stack', s)} />)}
            </div>
          </Field>
          <Field label="Auth model">
            <div className="flex flex-wrap gap-2">
              {AUTH_MODELS.map((a) => <Chip key={a} label={a} active={profile.authModel === a} onClick={() => setProfile((p) => ({ ...p, authModel: a }))} />)}
            </div>
          </Field>
          <Field label="Sensitive data handled">
            <div className="flex flex-wrap gap-2">
              {DATA_TYPES.map((d) => <Chip key={d} label={d} active={profile.dataTypes.includes(d)} onClick={() => toggle('dataTypes', d)} />)}
            </div>
          </Field>
          <Field label="Compliance frameworks">
            <div className="flex flex-wrap gap-2">
              {FRAMEWORKS.map((f) => <Chip key={f} label={f} active={profile.frameworks.includes(f)} onClick={() => toggle('frameworks', f)} />)}
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={saveProfile} disabled={!projectId} className="text-sm px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-500 disabled:opacity-50">
            Save profile
          </button>
        </div>
      </section>

      {/* Bound repositories — the scope correlation pulls findings from */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-1 uppercase tracking-wide">Bound repositories</h2>
        <p className="text-xs text-slate-500 mb-4">
          Correlation pulls scanner findings only from the repositories bound here. An unbound project correlates against nothing —
          this keeps one project&apos;s findings from bleeding into another&apos;s compliance view.
        </p>
        {repos.length === 0 ? (
          <p className="text-sm text-slate-500">No connected repositories. Add one from the dashboard first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {repos.map((r) => (
              <Chip key={r.$id} label={r.name || r.url} active={boundRepoIds.includes(r.$id)} onClick={() => toggleRepo(r.$id)} />
            ))}
          </div>
        )}
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={saveRepos} disabled={!projectId} className="text-sm px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-500 disabled:opacity-50">
            Save repositories
          </button>
        </div>
      </section>

      {/* Requirements */}
      {active.length > 0 && (
        <div className="flex items-center gap-4 mb-4 text-sm text-slate-400">
          <span><span className="text-slate-100 font-semibold">{active.length}</span> requirements</span>
          <span><span className="text-emerald-300 font-semibold">{satisfiedCount}</span> satisfied</span>
          {violatedCount > 0 && <span><span className="text-red-400 font-semibold">{violatedCount}</span> violated by scan</span>}
        </div>
      )}

      {active.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <FileText size={40} className="mx-auto mb-3 opacity-50" />
          <p>No requirements yet. Configure the profile and click Generate.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {byFramework.map(({ fw, items }) => (
            <section key={fw}>
              <h3 className="text-sm font-semibold text-indigo-300 mb-2">{fw} <span className="text-slate-500">({items.length})</span></h3>
              <div className="space-y-2">
                {items.map((r) => (
                  <article key={r.$id} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded border ${SEVERITY_STYLES[r.severity]}`}>{r.severity}</span>
                          {r.status === 'required' ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-indigo-600 text-white font-semibold tracking-wide">REQUIRED</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded border border-slate-600 text-slate-400">recommended</span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded border ${LIFECYCLE_STYLES[r.lifecycleStatus]}`}>{r.lifecycleStatus}</span>
                          {corr[r.$id]?.status === 'violated' && (
                            <span title={`${corr[r.$id].count} live scan finding(s) contradict this requirement`}
                              className="text-xs px-2 py-0.5 rounded bg-red-600 text-white font-semibold tracking-wide flex items-center gap-1">
                              <AlertTriangle size={11} />
                              {corr[r.$id].contradicts ? `ATTESTED BUT VIOLATED · ${corr[r.$id].count}` : `VIOLATED · ${corr[r.$id].count}`}
                            </span>
                          )}
                          <span className="text-xs text-slate-500 font-mono">{r.controlIds.join(', ')}</span>
                        </div>
                        <h4 className="font-medium text-slate-100">{r.title}</h4>
                        <p className="text-sm text-slate-400 mt-1">{r.description}</p>
                        {r.lifecycleStatus === 'waived' && r.justification && (
                          <p className="text-xs text-amber-300/80 mt-2 flex items-center gap-1">
                            <AlertTriangle size={12} /> Waived by {r.updatedBy || 'unknown'}: {r.justification}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {r.jiraKey ? (
                          <span title="Synced to Jira" className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-indigo-500/30 text-indigo-300 bg-indigo-500/10 font-mono">
                            <Ticket size={13} /> {r.jiraKey}
                          </span>
                        ) : r.ticketId ? (
                          <span title="Local ticket created; configure Jira to sync" className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-600 text-slate-400">
                            <Ticket size={13} /> ticket
                          </span>
                        ) : (
                          <button type="button" onClick={() => pushToJira(r)} title="Push to Jira as a sprint ticket"
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10">
                            <Send size={13} /> Push to Jira
                          </button>
                        )}
                        {r.lifecycleStatus !== 'satisfied' && (
                          <button type="button" onClick={() => setLifecycle(r, 'satisfied')} title="Mark satisfied"
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10">
                            <Check size={13} /> Satisfy
                          </button>
                        )}
                        {r.lifecycleStatus !== 'waived' && (
                          <button type="button" onClick={() => { setWaiveTarget(r); setJustification(''); }} title="Waive with justification"
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10">
                            <Ban size={13} /> Waive
                          </button>
                        )}
                        {r.lifecycleStatus !== 'open' && (
                          <button type="button" onClick={() => setLifecycle(r, 'open')} title="Reopen"
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-600 text-slate-400 hover:bg-slate-700/40">
                            <RotateCcw size={13} /> Reopen
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Waive justification modal */}
      {waiveTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setWaiveTarget(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">Waive requirement</h3>
            <p className="text-sm text-slate-400 mb-3">{waiveTarget.title}</p>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Justification (required — recorded with your identity for audit)"
              rows={4}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm mb-3"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setWaiveTarget(null)} className="text-sm px-3 py-1.5 rounded-lg border border-slate-700">Cancel</button>
              <button type="button" onClick={confirmWaive} className="text-sm px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-medium">Waive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-2">{label}</label>
      {children}
    </div>
  );
}
