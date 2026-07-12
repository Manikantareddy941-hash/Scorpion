import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Boxes, Plus, Play, Trash2, KeyRound, ShieldAlert, ShieldCheck,
  Loader2, CheckCircle2, XCircle, Rocket, ChevronDown, ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { apiFetch } from '../lib/apiClient';

interface Workspace {
  id: string;
  name: string;
  credentialProfileId?: string | null;
  createdAt: string;
}

interface GateFinding {
  message: string;
  severity: string;
  file_path?: string;
  line_number?: number;
}

interface IacRun {
  id: string;
  workspaceId: string;
  destroy: boolean;
  status: 'running' | 'blocked' | 'planned' | 'applying' | 'applied' | 'failed';
  gate?: { passed: boolean; overridden: boolean; findings: GateFinding[] };
  summary?: { create: number; update: number; delete: number; replace: number; changes: { address: string; actions: string[] }[] };
  logs: string[];
  createdAt: string;
}

interface Profile {
  id: string;
  name: string;
  provider: string;
  envKeys: string[];
}

const STATUS_STYLE: Record<IacRun['status'], string> = {
  running: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
  applying: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
  blocked: 'text-red-500 border-red-500/30 bg-red-500/10',
  failed: 'text-red-500 border-red-500/30 bg-red-500/10',
  planned: 'text-blue-500 border-blue-500/30 bg-blue-500/10',
  applied: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10',
};

const STARTER_CONFIG = `# Terraform / OpenTofu configuration (HCL)
# Example: an S3 bucket
# resource "aws_s3_bucket" "example" {
#   bucket = "my-unique-bucket-name"
# }
`;

function StatusChip({ status }: { status: IacRun['status'] }) {
  const busy = status === 'running' || status === 'applying';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status]}`}>
      {busy && <Loader2 className="w-3 h-3 animate-spin" />}
      {status}
    </span>
  );
}

export default function IacConsole() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [config, setConfig] = useState('');
  const [configDirty, setConfigDirty] = useState(false);
  const [runs, setRuns] = useState<IacRun[]>([]);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [newName, setNewName] = useState('');
  const [profileForm, setProfileForm] = useState({ name: '', provider: 'aws', env: 'AWS_ACCESS_KEY_ID=\nAWS_SECRET_ACCESS_KEY=\nAWS_DEFAULT_REGION=us-east-1' });
  const pollRef = useRef<number | null>(null);

  const selected = workspaces.find(w => w.id === selectedId) ?? null;
  const openRun = runs.find(r => r.id === openRunId) ?? null;

  const loadWorkspaces = useCallback(async () => {
    try {
      const list: Workspace[] = await apiFetch('/api/iac/workspaces');
      setWorkspaces(list);
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || 'Could not load workspaces');
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      setProfiles(await apiFetch('/api/iac/credentials'));
    } catch { /* credentials are optional until IAC_CRED_KEY is configured */ }
  }, []);

  const loadRuns = useCallback(async (wsId: string) => {
    try {
      const list: IacRun[] = await apiFetch(`/api/iac/workspaces/${wsId}/runs`);
      setRuns(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
    loadProfiles();
  }, [loadWorkspaces, loadProfiles]);

  // Poll runs while any run on the open workspace is still working
  useEffect(() => {
    if (!selectedId) return;
    const tick = async () => {
      const list = await loadRuns(selectedId);
      const active = list.some(r => r.status === 'running' || r.status === 'applying');
      if (active) pollRef.current = window.setTimeout(tick, 3000);
    };
    tick();
    return () => { if (pollRef.current) window.clearTimeout(pollRef.current); };
  }, [selectedId, loadRuns]);

  const selectWorkspace = async (ws: Workspace) => {
    setSelectedId(ws.id);
    setOpenRunId(null);
    setShowLogs(false);
    setConfigDirty(false);
    try {
      const detail = await apiFetch(`/api/iac/workspaces/${ws.id}`);
      setConfig(detail.config ?? '');
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || 'Could not load configuration');
    }
  };

  const createNewWorkspace = async () => {
    if (!newName.trim()) return toast.error('Workspace needs a name');
    try {
      const ws: Workspace = await apiFetch('/api/iac/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), config: STARTER_CONFIG }),
      });
      setShowNewWorkspace(false);
      setNewName('');
      await loadWorkspaces();
      await selectWorkspace(ws);
      toast.success(`Workspace "${ws.name}" created`);
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || 'Could not create workspace');
    }
  };

  const saveConfig = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/api/iac/workspaces/${selected.id}/config`, { method: 'PUT', body: JSON.stringify({ config }) });
      setConfigDirty(false);
      toast.success('Configuration saved');
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || 'Could not save configuration');
    }
  };

  const startRun = async (destroy: boolean, force = false) => {
    if (!selected) return;
    if (configDirty) await saveConfig();
    try {
      const run: IacRun = await apiFetch(`/api/iac/workspaces/${selected.id}/plan`, {
        method: 'POST',
        body: JSON.stringify({ destroy, force }),
      });
      toast.success(destroy ? 'Destroy plan started' : force ? 'Plan restarted with gate override' : 'Plan started — security gate first');
      setOpenRunId(run.id);
      await loadRuns(selected.id);
      // re-arm polling
      setSelectedId(id => id);
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || 'Could not start plan');
    }
  };

  const applyRun = async (run: IacRun) => {
    if (!selected) return;
    const target = run.destroy ? 'destroy the planned resources' : 'apply this plan to your cloud';
    if (!window.confirm(`Approve and ${target}? This changes real infrastructure.`)) return;
    try {
      await apiFetch(`/api/iac/workspaces/${selected.id}/runs/${run.id}/apply`, { method: 'POST' });
      toast.success('Approved — applying now');
      await loadRuns(selected.id);
      setSelectedId(id => id);
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || 'Could not apply the plan');
    }
  };

  const linkProfile = async (profileId: string) => {
    if (!selected) return;
    try {
      await apiFetch(`/api/iac/workspaces/${selected.id}/credential`, {
        method: 'PUT',
        body: JSON.stringify({ profileId: profileId || null }),
      });
      await loadWorkspaces();
      toast.success(profileId ? 'Credential profile linked' : 'Credential profile unlinked');
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || 'Could not update credentials');
    }
  };

  const createNewProfile = async () => {
    const env: Record<string, string> = {};
    for (const line of profileForm.env.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0 && line.slice(idx + 1).trim()) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    if (!profileForm.name.trim() || Object.keys(env).length === 0) {
      return toast.error('Profile needs a name and at least one KEY=value line');
    }
    try {
      await apiFetch('/api/iac/credentials', {
        method: 'POST',
        body: JSON.stringify({ name: profileForm.name.trim(), provider: profileForm.provider, env }),
      });
      setShowNewProfile(false);
      setProfileForm({ name: '', provider: 'aws', env: '' });
      await loadProfiles();
      toast.success('Credential profile created — values are encrypted and never shown again');
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || 'Could not create profile');
    }
  };

  const deleteExistingProfile = async (p: Profile) => {
    if (!window.confirm(`Delete credential profile "${p.name}"? Workspaces using it will fail until relinked.`)) return;
    try {
      await apiFetch(`/api/iac/credentials/${p.id}`, { method: 'DELETE' });
      await loadProfiles();
      toast.success('Profile deleted');
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || 'Could not delete profile');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center gap-5 mb-10">
        <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-600/20">
          <Boxes className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-[22px] font-semibold text-[var(--text-primary)] tracking-tight">Infrastructure as Code</h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-1">
            Write Terraform, pass the security gate, approve the plan — Scorpion applies it to your cloud
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left rail: workspaces + credentials */}
        <div className="space-y-6">
          <div className="premium-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">Workspaces</h2>
              <button
                onClick={() => setShowNewWorkspace(v => !v)}
                className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-500/10 transition-colors"
                aria-label="New workspace"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {showNewWorkspace && (
              <div className="mb-3 space-y-2">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createNewWorkspace()}
                  placeholder="Workspace name"
                  className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--border-color)] text-[13px] text-[var(--text-primary)] outline-none focus:border-indigo-500"
                />
                <button onClick={createNewWorkspace} className="w-full py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-500 transition-colors">
                  Create workspace
                </button>
              </div>
            )}
            {workspaces.length === 0 && !showNewWorkspace && (
              <p className="text-[12px] text-[var(--text-secondary)]">No workspaces yet. Create one to describe your infrastructure in code.</p>
            )}
            <ul className="space-y-1">
              {workspaces.map(ws => (
                <li key={ws.id}>
                  <button
                    onClick={() => selectWorkspace(ws)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-colors ${
                      ws.id === selectedId
                        ? 'bg-indigo-500/10 text-indigo-500 font-medium'
                        : 'text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {ws.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="premium-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wide flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> Cloud credentials
              </h2>
              <button
                onClick={() => setShowNewProfile(v => !v)}
                className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-500/10 transition-colors"
                aria-label="New credential profile"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {showNewProfile && (
              <div className="mb-3 space-y-2">
                <input
                  value={profileForm.name}
                  onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Profile name (e.g. prod-aws)"
                  className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--border-color)] text-[13px] text-[var(--text-primary)] outline-none focus:border-indigo-500"
                />
                <select
                  value={profileForm.provider}
                  onChange={e => setProfileForm(f => ({ ...f, provider: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--border-color)] text-[13px] text-[var(--text-primary)] outline-none"
                >
                  <option value="aws">AWS</option>
                  <option value="azure">Azure</option>
                  <option value="gcp">Google Cloud</option>
                  <option value="other">Other</option>
                </select>
                <textarea
                  value={profileForm.env}
                  onChange={e => setProfileForm(f => ({ ...f, env: e.target.value }))}
                  rows={4}
                  spellCheck={false}
                  placeholder={'AWS_ACCESS_KEY_ID=...\nAWS_SECRET_ACCESS_KEY=...'}
                  className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--border-color)] text-[12px] font-mono text-[var(--text-primary)] outline-none focus:border-indigo-500"
                />
                <button onClick={createNewProfile} className="w-full py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-500 transition-colors">
                  Save encrypted profile
                </button>
              </div>
            )}
            {profiles.length === 0 && !showNewProfile && (
              <p className="text-[12px] text-[var(--text-secondary)]">No profiles yet. Add cloud keys once — they are encrypted and only used at run time.</p>
            )}
            <ul className="space-y-1">
              {profiles.map(p => (
                <li key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-[13px] text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5">
                  <span>
                    {p.name} <span className="text-[11px] text-[var(--text-secondary)] uppercase">{p.provider}</span>
                  </span>
                  <button onClick={() => deleteExistingProfile(p)} className="p-1 rounded text-red-500/70 hover:text-red-500" aria-label={`Delete ${p.name}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Main: editor + runs */}
        {!selected ? (
          <div className="premium-card p-12 flex flex-col items-center justify-center text-center min-h-[400px]">
            <Boxes className="w-12 h-12 text-[var(--text-secondary)] opacity-40 mb-4" />
            <p className="text-[14px] text-[var(--text-primary)] font-medium">Select or create a workspace</p>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1 max-w-sm">
              A workspace holds one Terraform configuration and its full run history — every plan, every approval, every apply.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="premium-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">{selected.name}</h2>
                <div className="flex items-center gap-2">
                  <select
                    value={selected.credentialProfileId ?? ''}
                    onChange={e => linkProfile(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--border-color)] text-[12px] text-[var(--text-primary)] outline-none"
                    aria-label="Credential profile"
                  >
                    <option value="">Backend default credentials</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <textarea
                value={config}
                onChange={e => { setConfig(e.target.value); setConfigDirty(true); }}
                rows={14}
                spellCheck={false}
                className="w-full px-4 py-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--border-color)] text-[13px] font-mono leading-relaxed text-[var(--text-primary)] outline-none focus:border-indigo-500 resize-y"
                aria-label="Terraform configuration"
              />
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button
                  onClick={saveConfig}
                  disabled={!configDirty}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 transition-colors"
                >
                  Save changes
                </button>
                <button
                  onClick={() => startRun(false)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-500 transition-colors"
                >
                  <Play className="w-4 h-4" /> Plan
                </button>
                <button
                  onClick={() => startRun(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/40 text-red-500 text-[13px] font-medium hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Plan destroy
                </button>
                <span className="text-[12px] text-[var(--text-secondary)]">
                  Every plan runs the Checkov security gate before it can be approved.
                </span>
              </div>
            </div>

            <div className="premium-card p-6">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-4">Runs</h3>
              {runs.length === 0 && <p className="text-[13px] text-[var(--text-secondary)]">No runs yet. Start with a plan.</p>}
              <ul className="space-y-2">
                {runs.map(run => (
                  <li key={run.id} className="border border-[var(--border-color)] rounded-xl overflow-hidden">
                    <button
                      onClick={() => { setOpenRunId(openRunId === run.id ? null : run.id); setShowLogs(false); }}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <StatusChip status={run.status} />
                        <span className="text-[13px] text-[var(--text-primary)]">
                          {run.destroy ? 'Destroy plan' : 'Plan'} · {new Date(run.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {openRunId === run.id ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />}
                    </button>

                    {openRunId === run.id && openRun && (
                      <div className="px-4 pb-4 space-y-4 border-t border-[var(--border-color)] pt-4">
                        {/* Security gate verdict */}
                        {openRun.gate && (
                          <div className={`rounded-xl border p-4 ${openRun.gate.passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              {openRun.gate.passed
                                ? <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                : <ShieldAlert className="w-4 h-4 text-red-500" />}
                              <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                                Security gate {openRun.gate.passed ? 'passed' : `found ${openRun.gate.findings.length} issue${openRun.gate.findings.length === 1 ? '' : 's'}`}
                                {openRun.gate.overridden && <span className="ml-2 text-[11px] font-semibold uppercase text-amber-500">override on record</span>}
                              </span>
                            </div>
                            {!openRun.gate.passed && (
                              <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                                {openRun.gate.findings.map((f, i) => (
                                  <li key={i} className="text-[12px] text-[var(--text-secondary)] font-mono">
                                    {f.message}{f.line_number ? ` (line ${f.line_number})` : ''}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {openRun.status === 'blocked' && (
                              <button
                                onClick={() => startRun(openRun.destroy, true)}
                                className="mt-3 px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-500 text-[12px] font-medium hover:bg-amber-500/10 transition-colors"
                              >
                                Fix the config, or force past the gate (recorded)
                              </button>
                            )}
                          </div>
                        )}

                        {/* Plan verdict strip */}
                        {openRun.summary && (
                          <div>
                            <div className="flex items-center gap-4 text-[13px] font-mono mb-2">
                              <span className="text-emerald-500">+{openRun.summary.create} create</span>
                              <span className="text-amber-500">~{openRun.summary.update} update</span>
                              <span className="text-red-500">-{openRun.summary.delete} destroy</span>
                              {openRun.summary.replace > 0 && <span className="text-purple-500">±{openRun.summary.replace} replace</span>}
                            </div>
                            <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                              {openRun.summary.changes.map((c, i) => (
                                <li key={i} className="text-[12px] font-mono text-[var(--text-secondary)]">
                                  <span className={c.actions.includes('delete') ? 'text-red-500' : c.actions.includes('create') ? 'text-emerald-500' : 'text-amber-500'}>
                                    {c.actions.join('+')}
                                  </span>{' '}{c.address}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Outcome + actions */}
                        <div className="flex flex-wrap items-center gap-3">
                          {openRun.status === 'planned' && (
                            <button
                              onClick={() => applyRun(openRun)}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-medium hover:bg-emerald-500 transition-colors"
                            >
                              <Rocket className="w-4 h-4" /> Approve &amp; apply
                            </button>
                          )}
                          {openRun.status === 'applied' && (
                            <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-500"><CheckCircle2 className="w-4 h-4" /> Applied to your cloud</span>
                          )}
                          {openRun.status === 'failed' && (
                            <span className="inline-flex items-center gap-1.5 text-[13px] text-red-500"><XCircle className="w-4 h-4" /> Run failed — check the logs</span>
                          )}
                          <button
                            onClick={() => setShowLogs(v => !v)}
                            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[12px] text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            {showLogs ? 'Hide logs' : 'Show logs'}
                          </button>
                        </div>
                        {showLogs && (
                          <pre className="rounded-xl bg-black/80 text-emerald-300/90 text-[11px] leading-relaxed p-4 max-h-72 overflow-auto font-mono">
                            {openRun.logs.length ? openRun.logs.join('\n') : 'No output yet.'}
                          </pre>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
