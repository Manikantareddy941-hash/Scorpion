import React, { useState, useEffect } from 'react';
import { 
    Rocket, Shield, AlertTriangle, CheckCircle2, 
    XCircle, RefreshCw, ChevronRight, ArrowRight,
    Award, ShieldAlert, Loader2, Database
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

export default function ReleaseGate() {
    const { getJWT } = useAuth();
    const [repos, setRepos] = useState<Repo[]>([]);
    const [selectedRepo, setSelectedRepo] = useState<any | null>(null);
    const [gateResult, setGateResult] = useState<GateResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        console.log('[ReleaseGate] Component mounted');
        fetchRepos();
    }, []);

    const fetchRepos = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/dashboard/security`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            
            const data = await res.json();
            const repoList = data.by_repo || [];
            setRepos(repoList);
            console.log(`[ReleaseGate] Loaded ${repoList.length} repositories for gate check`);
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
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
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
                <Rocket className="w-12 h-12 text-orange-500 animate-pulse mb-4" />
                <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
                    <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.3em] italic">Initializing Release Sequence...</p>
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
                            <div className="w-16 h-16 bg-orange-500 rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-orange-500/20">
                                <Rocket size={32} />
                            </div>
                            <div>
                                <h1 className="text-4xl font-black tracking-tighter uppercase italic leading-none text-[var(--text-primary)]">Release Gate</h1>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-2">Automated Security Policy Enforcement</p>
                            </div>
                        </div>
                    </div>

                    {error ? (
                        <div className="premium-card p-24 text-center border-red-500/20">
                            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-6 opacity-40" />
                            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">Gate Uplink Disrupted</h3>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-2">{error}</p>
                            <button onClick={fetchRepos} className="mt-6 btn-premium bg-orange-600">Reconnect to Fleet</button>
                        </div>
                    ) : !selectedRepo ? (
                        repos.length === 0 ? (
                            <div className="premium-card p-32 text-center border-dashed">
                                <Database size={48} className="mx-auto mb-6 opacity-20 text-[var(--text-secondary)]" />
                                <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">No Secure Repositories Found</h3>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-2">Connect a repository to the Scorpion mesh to enable release gating.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {repos.map((repo, idx) => (
                                    <div key={idx} className="premium-card p-8 group hover:border-orange-500/50 transition-all cursor-pointer" onClick={() => checkGate(repo.repo_id, repo.repo_name)}>
                                        <div className="flex justify-between items-start mb-6">
                                            <div className="w-12 h-12 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-500 border border-orange-500/20 group-hover:bg-orange-500 group-hover:text-white transition-all">
                                                <Shield size={24} />
                                            </div>
                                            <ChevronRight className="text-[var(--text-secondary)] group-hover:translate-x-1 transition-transform" />
                                        </div>
                                        <h3 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tight mb-2">{repo.repo_name}</h3>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                                            <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest">{repo.count} Total Findings</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    ) : (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <button onClick={() => setSelectedRepo(null)} className="text-[10px] font-black text-[var(--text-secondary)] uppercase italic tracking-widest hover:text-orange-500 transition-colors flex items-center gap-2">
                                <RefreshCw size={12} /> Back to Repository Index
                            </button>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                
                                {/* Gate Status Card */}
                                <div className="lg:col-span-2 space-y-6">
                                    <div className={`premium-card p-10 border-2 ${checking ? 'border-[var(--border-subtle)]' : gateResult?.allowed ? 'border-green-500/50' : 'border-red-500/50'}`}>
                                        <div className="flex items-center justify-between mb-10">
                                            <div className="flex items-center gap-5">
                                                <div className={`w-16 h-16 rounded-3xl flex items-center justify-center shadow-2xl transition-all
                                                    ${checking ? 'bg-[var(--bg-primary)] text-[var(--text-secondary)] animate-pulse' : 
                                                      gateResult?.allowed ? 'bg-green-500 text-white shadow-green-500/20' : 'bg-red-500 text-white shadow-red-500/20'}`}>
                                                    {checking ? <RefreshCw className="animate-spin" /> : gateResult?.allowed ? <CheckCircle2 size={32} /> : <ShieldAlert size={32} />}
                                                </div>
                                                <div>
                                                    <h2 className="text-2xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">
                                                        {checking ? 'Analyzing Perimeter...' : gateResult?.allowed ? 'Authorization: CLEAR' : 'Authorization: BLOCKED'}
                                                    </h2>
                                                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1">
                                                        Target: {selectedRepo.name}
                                                    </p>
                                                </div>
                                            </div>

                                            {!checking && gateResult?.allowed && (
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[9px] font-black text-green-500 uppercase tracking-widest italic mb-1">Status: Operational</span>
                                                    <div className="px-4 py-1 bg-green-500/10 text-green-500 rounded-full text-[8px] font-black uppercase">Zero Blockers</div>
                                                </div>
                                            )}
                                        </div>

                                        {!checking && !gateResult?.allowed && (
                                            <div className="space-y-6">
                                                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-4">
                                                    <AlertTriangle className="text-red-500" />
                                                    <p className="text-[10px] font-black text-red-500 uppercase italic">
                                                        Gate restricted: {gateResult?.blocker_count} critical/high severity blockers detected in active mesh.
                                                    </p>
                                                </div>

                                                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-4 custom-scrollbar">
                                                    {gateResult?.blockers.map((blocker) => (
                                                        <div key={blocker.$id} className="p-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl flex items-center justify-between group hover:border-red-500/30 transition-all">
                                                            <div className="flex items-center gap-4">
                                                                <div className="w-8 h-8 bg-red-500/10 rounded-lg flex items-center justify-center text-red-500 text-xs font-black">
                                                                    !
                                                                </div>
                                                                <div>
                                                                    <h4 className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">{blocker.title}</h4>
                                                                    <p className="text-[9px] text-[var(--text-secondary)] uppercase italic">{blocker.type} • {blocker.file_path}</p>
                                                                </div>
                                                            </div>
                                                            <span className="px-3 py-1 bg-red-500/10 text-red-500 rounded-lg text-[8px] font-black uppercase">{blocker.severity}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {!checking && gateResult?.allowed && (
                                            <div className="flex flex-col items-center py-10 space-y-6">
                                                <Award size={64} className="text-green-500 opacity-20" />
                                                <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest text-center max-w-sm">
                                                    All security protocols verified. The repository meets the minimum safety threshold for deployment.
                                                </p>
                                                <button className="btn-premium bg-green-600 shadow-green-500/20 px-12 py-4">Confirm Authorization</button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Info Panel */}
                                <div className="space-y-6">
                                    <div className="premium-card p-8">
                                        <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-6 italic">Gate Protocol Info</h3>
                                        <div className="space-y-6">
                                            <div className="flex gap-4">
                                                <div className="w-1 h-8 bg-orange-500 rounded-full" />
                                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase leading-relaxed italic">
                                                    The release gate is an automated enforcement point that prevents vulnerable code from entering production environments.
                                                </p>
                                            </div>
                                            <div className="space-y-3">
                                                <div className="flex justify-between items-center text-[9px] font-black uppercase italic">
                                                    <span className="text-[var(--text-secondary)]">Blocking Severity</span>
                                                    <span className="text-red-500">Critical / High</span>
                                                </div>
                                                <div className="flex justify-between items-center text-[9px] font-black uppercase italic">
                                                    <span className="text-[var(--text-secondary)]">Exemption Protocol</span>
                                                    <span className="text-[var(--text-primary)]">Security Lead Only</span>
                                                </div>
                                                <div className="flex justify-between items-center text-[9px] font-black uppercase italic">
                                                    <span className="text-[var(--text-secondary)]">Audit Log</span>
                                                    <span className="text-green-500">Enabled</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                            </div>
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
