import { useState, useEffect } from 'react';
import { 
    Rocket, Shield, AlertTriangle, CheckCircle2, 
    XCircle, ChevronRight, ShieldAlert, Loader2
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

interface Repo {
    repo_id: string;
    repo_name: string;
    count: number;
}

interface Blocker {
    $id: string;
    title: string;
    severity: string;
    type: string;
    file_path: string;
}

interface GateResult {
    allowed: boolean;
    blocker_count: number;
    blockers: Blocker[];
}

const StatusIndicator = ({ type }: { type: 'PASS' | 'FAIL' | 'WARN' }) => {
  if (type === 'PASS') return <span className="text-emerald-500 font-bold font-mono text-xs uppercase tracking-widest flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> PASSED</span>;
  if (type === 'FAIL') return <span className="text-rose-500 font-bold font-mono text-xs uppercase tracking-widest flex items-center gap-1"><XCircle className="w-3 h-3"/> FAILED</span>;
  return <span className="text-amber-500 font-bold font-mono text-xs uppercase tracking-widest flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> WARNING</span>;
};

export default function ReleaseGate() {
    const { getJWT } = useAuth();
    const [repos, setRepos] = useState<Repo[]>([]);
    const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
    const [selectedRepo, setSelectedRepo] = useState<{ id: string; name: string } | null>(null);
    const [gateResult, setGateResult] = useState<GateResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        fetchRepos();
    }, []);

    const fetchRepos = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await getJWT();
            const apiBase = '';
            const res = await fetch(`${apiBase}/api/dashboard/security`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            
            const data = await res.json();
            const repoList = data.by_repo || [];
            setRepos(repoList);
        } catch (err: any) {
            console.error('[ReleaseGate] Failed to load repositories:', err);
            setError(err.message);
            toast.error('Failed to synchronize repository security state');
        } finally {
            setLoading(false);
        }
    };

    const checkGate = async (repoId: string, repoName: string) => {
        setChecking(true);
        setGateResult(null);
        setSelectedRepo({ id: repoId, name: repoName });
        
        try {
            const token = await getJWT();
            const apiBase = '';
            const res = await fetch(`${apiBase}/api/gates/release/${repoId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setGateResult(data);
        } catch (err) {
            console.error('Gate check failed:', err);
            toast.error('Security gate check failed');
        } finally {
            setChecking(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] p-8 flex flex-col items-center justify-center">
                <Rocket className="w-12 h-12 text-[#6db87a] animate-pulse mb-4" />
                <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
                    <p className="text-[13px] text-[var(--text-secondary)]">Loading release gates…</p>
                </div>
            </div>
        );
    }

    try {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] p-8">
                <div className="max-w-7xl mx-auto space-y-12">
                    
                    {/* Header */}
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div className="flex items-center gap-5">
                            <div className="w-16 h-16 bg-[#6db87a] rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-[#6db87a]/20">
                                <Rocket size={32} />
                            </div>
                            <div>
                                <h1 className="text-[22px] font-semibold tracking-tight leading-none text-[var(--text-primary)]">Release gate</h1>
                                <p className="text-[13px] text-[var(--text-secondary)] mt-1.5">Automated security checks that decide whether a release can ship</p>
                            </div>
                        </div>
                    </div>

                    {error ? (
                        <div className="premium-card p-24 text-center border-red-500/20">
                            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-6 opacity-40" />
                            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Couldn't load release gates</h3>
                            <p className="text-[13px] text-[var(--text-secondary)] mt-2">{error}</p>
                            <button onClick={fetchRepos} className="mt-6 btn-premium">Try again</button>
                        </div>
                    ) : repos.length === 0 ? (
                        <div className="premium-card p-24 text-center">
                            <Rocket className="w-16 h-16 text-[var(--text-secondary)] mx-auto mb-6 opacity-20" />
                            <h3 className="text-lg font-semibold text-[var(--text-primary)]">No repositories yet</h3>
                            <p className="text-[13px] text-[var(--text-secondary)] mt-2">Connect a repository to start enforcing release gates.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 w-full">
                            {repos.map((repo) => {
                                const isOpen = activeRepoId === repo.repo_id;
                                const hasResult = isOpen && selectedRepo?.id === repo.repo_id ? gateResult : null;
                                const isChecking = isOpen && checking && selectedRepo?.id === repo.repo_id;
                                const status = hasResult ? (hasResult.allowed ? 'PASSED' : 'BLOCKED') : (repo.count === 0 ? 'PASSED' : 'BLOCKED');
                                const rule = hasResult
                                    ? (hasResult.allowed ? `Passed: ${hasResult.blocker_count} open finding(s) within policy` : `Failed: ${hasResult.blocker_count} open finding(s) blocking release`)
                                    : (repo.count === 0 ? 'No open findings recorded' : `${repo.count} open finding(s) recorded`);

                                return (
                                <div key={repo.repo_id} className="premium-card group hover:border-[var(--border-subtle)] transition-all bg-white/5 hover:bg-white/10 flex flex-col overflow-hidden h-fit">
                                    <div className="p-8 cursor-pointer select-none" onClick={() => {
                                        if (isOpen) {
                                            setActiveRepoId(null);
                                        } else {
                                            setActiveRepoId(repo.repo_id);
                                            checkGate(repo.repo_id, repo.repo_name);
                                        }
                                    }}>
                                        <div className="flex justify-between items-start mb-6">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all ${status === 'PASSED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 group-hover:bg-emerald-500 group-hover:text-white' : 'bg-red-500/10 text-red-500 border-red-500/20 group-hover:bg-red-500 group-hover:text-white'}`}>
                                                <Shield size={24} />
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span
                                                    title={status === 'BLOCKED' ? `Violation: ${rule}` : undefined}
                                                    className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest border cursor-help ${status === 'PASSED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 shadow-[0_0_10px_rgba(109,184,122,0.15)]' : 'bg-red-500/10 text-red-500 border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.15)]'}`}
                                                >
                                                    {status}
                                                </span>
                                                <ChevronRight className={`text-[var(--text-secondary)] transition-transform duration-300 ${isOpen ? 'rotate-90' : 'group-hover:translate-x-1'}`} />
                                            </div>
                                        </div>
                                        <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-2">{repo.repo_name}</h3>

                                        <div className="flex flex-col gap-4 mt-6">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1.5 h-1.5 rounded-full ${status === 'PASSED' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                <span className="text-[12px] font-medium text-[var(--text-secondary)]">{repo.count} total findings</span>
                                            </div>

                                            <div className="p-3 rounded-lg border border-transparent"
                                                 style={{
                                                     background: status === 'PASSED' ? '#f0fff4' : '#fff0f0',
                                                     borderLeft: status === 'PASSED' ? '3px solid #6db87a' : '3px solid #e74c3c',
                                                     borderRadius: '8px'
                                                 }}>
                                                <span className="text-[9px] font-black uppercase tracking-widest block mb-1"
                                                      style={{ color: status === 'PASSED' ? '#1a7a4a' : '#c0392b', opacity: 0.8 }}>
                                                    ENFORCED POLICY:
                                                </span>
                                                <span className="font-mono text-[11px] font-bold"
                                                      style={{ color: status === 'PASSED' ? '#1a7a4a' : '#c0392b' }}>
                                                    {rule}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* AUTOMATED POLICY EVALUATION DRAWER */}
                                    {isOpen && (
                                      <div className="bg-zinc-950/95 border-t border-white/10 p-6 flex flex-col gap-4 animate-in fade-in slide-in-from-top-2">
                                        <p className="text-[10px] font-bold font-mono tracking-wider text-emerald-400 uppercase">
                                          Automated Security Guard Evaluation Matrix
                                        </p>

                                        {isChecking ? (
                                          <div className="flex items-center gap-2 py-6 justify-center">
                                            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Evaluating policy...</span>
                                          </div>
                                        ) : hasResult ? (
                                          <>
                                            <div className={`rounded-xl p-6 flex items-center gap-5 border ${hasResult.allowed ? 'bg-emerald-950/20 border-emerald-500/20' : 'bg-red-950/20 border-red-500/20'}`}>
                                              <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ${hasResult.allowed ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white animate-pulse'}`}>
                                                {hasResult.allowed ? <CheckCircle2 size={28} /> : <XCircle size={28} />}
                                              </div>
                                              <div>
                                                <h3 className={`text-2xl font-black uppercase italic ${hasResult.allowed ? 'text-emerald-400' : 'text-red-400'}`}>
                                                  {hasResult.allowed ? 'Release Allowed' : 'Blocked'}
                                                </h3>
                                                <p className="text-xs text-zinc-400 mt-1">
                                                  {hasResult.allowed
                                                    ? 'No open findings block this release.'
                                                    : `${hasResult.blocker_count} open finding(s) blocking deployment.`}
                                                </p>
                                              </div>
                                            </div>
                                            <div className="flex flex-col gap-3 mt-1">
                                              {hasResult.blockers.length === 0 ? (
                                                <div className="flex flex-col gap-2 bg-black/40 p-4 rounded-xl border border-white/5 font-mono text-xs">
                                                  <StatusIndicator type="PASS" />
                                                  <p className="text-[11px] text-zinc-400 leading-normal mt-1">No open findings blocking this release.</p>
                                                </div>
                                              ) : hasResult.blockers.map((blocker) => (
                                                <div key={blocker.$id} className="flex flex-col gap-2 bg-black/40 p-4 rounded-xl border border-white/5 font-mono text-xs">
                                                  <div className="flex items-start justify-between">
                                                    <div className="flex flex-col gap-1.5">
                                                      <span className="text-white/90 font-semibold">{blocker.title}</span>
                                                      <span className="text-[9px] text-zinc-500 uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded w-fit border border-white/5">{blocker.type} &middot; {blocker.file_path}</span>
                                                    </div>
                                                    <StatusIndicator type={(blocker.severity || '').toLowerCase() === 'critical' || (blocker.severity || '').toLowerCase() === 'high' ? 'FAIL' : 'WARN'} />
                                                  </div>
                                                </div>
                                              ))}
                                            </div>

                                            {!hasResult.allowed && (
                                              <div className="mt-2 p-4 bg-red-950/20 border border-red-500/20 rounded-xl">
                                                <h4 className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                                  <ShieldAlert size={12} /> ENFORCEMENT REASON
                                                </h4>
                                                <div className="space-y-1.5 font-mono text-[10px] text-zinc-300">
                                                  <p><span className="text-zinc-500 font-bold uppercase">Policy Violated:</span> {rule}</p>
                                                  <p><span className="text-zinc-500 font-bold uppercase">Repository:</span> {repo.repo_name}</p>
                                                  <p><span className="text-zinc-500 font-bold uppercase">Timestamp:</span> {new Date().toLocaleString()}</p>
                                                </div>
                                              </div>
                                            )}
                                          </>
                                        ) : (
                                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest py-6 text-center">Gate evaluation unavailable.</p>
                                        )}
                                      </div>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    } catch (renderError: any) {
        console.error('[ReleaseGate] Render crash:', renderError);
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-orange-500 font-black uppercase italic p-8 text-center">
                Critical Render Failure in Release Gate Module.<br/>Check Console for Trace.
            </div>
        );
    }
}
