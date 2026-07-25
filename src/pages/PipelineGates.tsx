import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronRight, GitCommit, Ticket, FileText, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

// Pipeline Gates panel: the ledger of every compliance-gate evaluation for a
// project's bound repos. Turns the CI's raw 403 into an actionable, traceable
// security event — each blocked run maps its violated controls to the Jira
// ticket (3a bridge) and the exact findings (correlation) behind the block.

interface Project { $id: string; name: string }
interface ViolationFinding { id?: string; title?: string; tool?: string; severity?: string; file?: string }
interface Violation {
  projectId: string; code: string; title: string; frameworks: string[];
  severity: string; findingCount: number; jiraKey?: string; findings: ViolationFinding[];
}
interface GateRun {
  $id?: string; repoId: string; source?: 'ci' | 'deploy'; environment?: string; actor?: string;
  commitSha?: string; branch?: string;
  status: 'passed' | 'blocked' | 'overridden'; violations: Violation[]; createdAt: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function PipelineGates() {
  const { getJWT } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [runs, setRuns] = useState<GateRun[]>([]);
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    return { Authorization: `Bearer ${await getJWT()}` };
  }, [getJWT]);

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

  const loadRuns = useCallback(async (pid: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/plan/projects/${pid}/gate-runs`, { headers: await authHeaders() });
      if (res.ok) setRuns(await res.json());
    } catch { toast.error('Failed to load gate runs'); }
    finally { setLoading(false); }
  }, [authHeaders]);

  useEffect(() => { if (projectId) loadRuns(projectId); }, [projectId, loadRuns]);

  const visible = blockedOnly ? runs.filter((r) => r.status !== 'passed') : runs;
  const blockedCount = runs.filter((r) => r.status === 'blocked').length;
  const overriddenCount = runs.filter((r) => r.status === 'overridden').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-indigo-400" size={28} />
          <div>
            <h1 className="text-2xl font-semibold">Pipeline Gates</h1>
            <p className="text-sm text-slate-400">Compliance-gate enforcement ledger for this project&apos;s repositories</p>
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
          <button type="button" onClick={() => projectId && loadRuns(projectId)} className="p-2 rounded-lg border border-slate-700 hover:border-slate-500" title="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <div className="flex items-center gap-4 mb-4 text-sm text-slate-400">
        <span><span className="text-slate-100 font-semibold">{runs.length}</span> runs</span>
        <span><span className="text-red-400 font-semibold">{blockedCount}</span> blocked</span>
        <span><span className="text-amber-400 font-semibold">{overriddenCount}</span> overridden</span>
        <label className="flex items-center gap-2 ml-auto cursor-pointer">
          <input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} className="accent-red-500" />
          Issues only
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <FileText size={40} className="mx-auto mb-3 opacity-50" />
          <p>No gate runs yet. They appear here once your CI calls <code className="text-slate-400">POST /api/gates/compliance</code>.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((run) => {
            const id = run.$id || run.createdAt;
            const isBlocked = run.status === 'blocked';
            const isOverridden = run.status === 'overridden';
            const hasIssue = isBlocked || isOverridden;
            const isOpen = expanded === id;
            const pill = isBlocked
              ? { cls: 'bg-red-600 text-white', label: 'BLOCKED' }
              : isOverridden
                ? { cls: 'bg-amber-500/20 text-amber-200 border border-amber-500/40', label: 'OVERRIDDEN' }
                : { cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30', label: 'PASSED' };
            const border = isBlocked ? 'border-red-500/30' : isOverridden ? 'border-amber-500/30' : 'border-slate-800';
            return (
              <article key={id} className={`bg-slate-900 border rounded-lg ${border}`}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : id)}
                  className="w-full flex items-center gap-3 p-4 text-left"
                  disabled={!hasIssue}
                >
                  {hasIssue ? (
                    isOpen ? <ChevronDown size={16} className="text-slate-500 shrink-0" /> : <ChevronRight size={16} className="text-slate-500 shrink-0" />
                  ) : <span className="w-4 shrink-0" />}
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold tracking-wide flex items-center gap-1 ${pill.cls}`}>
                    {hasIssue ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
                    {pill.label}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 uppercase tracking-wide">
                    {run.source === 'deploy' ? 'deploy' : 'ci'}
                  </span>
                  {run.source === 'deploy' && run.environment && <span className="text-xs text-slate-400">{run.environment}</span>}
                  <span className="flex items-center gap-1 text-xs text-slate-400 font-mono">
                    <GitCommit size={13} /> {run.commitSha ? run.commitSha.slice(0, 7) : '—'}
                  </span>
                  {run.branch && <span className="text-xs text-slate-500">{run.branch}</span>}
                  {run.actor && <span className="text-xs text-slate-500">by {run.actor}</span>}
                  {hasIssue && <span className={`text-xs ${isBlocked ? 'text-red-300' : 'text-amber-300'}`}>{run.violations.length} control(s) {isOverridden ? 'bypassed' : 'violated'}</span>}
                  <span className="ml-auto text-xs text-slate-500">{relativeTime(run.createdAt)}</span>
                </button>

                {hasIssue && isOpen && (
                  <div className="border-t border-slate-800 p-4 space-y-3">
                    {run.violations.map((v) => (
                      <div key={v.code} className="bg-slate-950/50 border border-slate-800 rounded-lg p-3">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded border ${SEVERITY_STYLES[v.severity] ?? SEVERITY_STYLES.low}`}>{v.severity}</span>
                          <span className="text-xs font-mono text-slate-300">{v.code}</span>
                          {v.frameworks.map((f) => <span key={f} className="text-xs text-indigo-300">{f}</span>)}
                          {v.jiraKey && (
                            <span title="Tracked in Jira" className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-indigo-500/30 text-indigo-300 bg-indigo-500/10 font-mono ml-auto">
                              <Ticket size={12} /> {v.jiraKey}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-200">{v.title}</p>
                        {v.findings.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {v.findings.map((f, i) => (
                              <li key={f.id || i} className="text-xs text-slate-400 flex items-center gap-2">
                                <span className="text-slate-600">•</span>
                                <span className="text-slate-300">{f.title || f.tool || 'finding'}</span>
                                {f.tool && <span className="text-slate-500">[{f.tool}]</span>}
                                {f.file && <span className="font-mono text-slate-500">{f.file}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
