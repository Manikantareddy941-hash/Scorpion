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

const StatusIndicator = ({ type }: { type: 'PASS' | 'FAIL' | 'WARN' }) => {
  if (type === 'PASS') return <span className="text-emerald-500 font-bold font-mono text-xs uppercase tracking-widest flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> PASSED</span>;
  if (type === 'FAIL') return <span className="text-rose-500 font-bold font-mono text-xs uppercase tracking-widest flex items-center gap-1"><XCircle className="w-3 h-3"/> FAILED</span>;
  return <span className="text-amber-500 font-bold font-mono text-xs uppercase tracking-widest flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> WARNING</span>;
};

const releaseGatesData = [
  { 
    id: "fit-track", 
    repo: "FIT_TRACK", 
    findings: 90, 
    status: "BLOCKED", 
    rule: "Failed: Found 1 Critical SAST bug",
    checks: [
      { name: "SAST Code-Level Security Policy", threshold: "0 Critical Allowed", status: "FAIL", detail: "1 Critical finding detected in fit_track/auth.ts" },
      { name: "Open Source Dependency Check (Trivy)", status: "PASS", detail: "All packages conform to baseline SLAs." },
      { name: "Hardcoded Secret Scanner (Gitleaks)", status: "PASS", detail: "Zero plaintext keys found in commit history." }
    ]
  },
  { 
    id: "food-delivery", 
    repo: "FOOD-DELIVERY-APP", 
    findings: 0, 
    status: "PASSED", 
    rule: "Passed: Zero security vulnerabilities",
    checks: [
      { name: "SAST Code-Level Security Policy", threshold: "0 Critical Allowed", status: "PASS", detail: "Zero high or critical alerts." },
      { name: "Open Source Dependency Check (Trivy)", status: "PASS", detail: "No outdated vulnerable packages found." },
      { name: "Hardcoded Secret Scanner (Gitleaks)", status: "PASS", detail: "Zero credentials leaked." }
    ]
  },
  { 
    id: "scorpion-platform", 
    repo: "SCORPION", 
    findings: 149, 
    status: "BLOCKED", 
    rule: "Failed: Open compliance violation (SOC 2)",
    checks: [
      { name: "SAST Code-Level Security Policy", threshold: "0 Critical Allowed", status: "PASS", detail: "Code-level checks secure." },
      { name: "Compliance Baseline Policy (SOC 2)", status: "FAIL", detail: "Missing active Falco runtime monitoring on production K8s cluster." },
      { name: "Hardcoded Secret Scanner (Gitleaks)", status: "PASS", detail: "No plaintext keys found." }
    ]
  },
  { 
    id: "train-ticket", 
    repo: "TRAIN-TICKET-RESERVATION", 
    findings: 75, 
    status: "PASSED", 
    rule: "Passed: All findings below High severity threshold",
    checks: [
      { name: "SAST Code-Level Security Policy", threshold: "0 Critical Allowed", status: "PASS", detail: "Findings present but pass baseline SLA requirements." },
      { name: "Open Source Dependency Check (Trivy)", status: "PASS", detail: "Vulnerable dependencies triaged or snoozed." },
      { name: "Hardcoded Secret Scanner (Gitleaks)", status: "PASS", detail: "Zero secrets detected." }
    ]
  }
];

export default function ReleaseGate() {
    const { getJWT } = useAuth();
    const [repos, setRepos] = useState<Repo[]>([]);
    const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
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
            const apiBase = '';
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
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 w-full">
                            {releaseGatesData.map((gate) => {
                                const isOpen = activeRepoId === gate.id;

                                return (
                                <div key={gate.id} className="premium-card group hover:border-[var(--border-subtle)] transition-all bg-white/5 hover:bg-white/10 flex flex-col overflow-hidden h-fit">
                                    <div className="p-8 cursor-pointer select-none" onClick={() => setActiveRepoId(isOpen ? null : gate.id)}>
                                        <div className="flex justify-between items-start mb-6">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all ${gate.status === 'PASSED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 group-hover:bg-emerald-500 group-hover:text-white' : 'bg-red-500/10 text-red-500 border-red-500/20 group-hover:bg-red-500 group-hover:text-white'}`}>
                                                <Shield size={24} />
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest border ${gate.status === 'PASSED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]' : 'bg-red-500/10 text-red-500 border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.15)]'}`}>
                                                    {gate.status}
                                                </span>
                                                <ChevronRight className={`text-[var(--text-secondary)] transition-transform duration-300 ${isOpen ? 'rotate-90' : 'group-hover:translate-x-1'}`} />
                                            </div>
                                        </div>
                                        <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight mb-2">{gate.repo}</h3>
                                        
                                        <div className="flex flex-col gap-4 mt-6">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full animate-pulse ${gate.status === 'PASSED' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                <span className="text-[11px] font-black text-[var(--text-secondary)] uppercase tracking-widest">{gate.findings} Total Findings</span>
                                            </div>
                                            
                                            <div className="p-3 bg-black/30 rounded-lg border border-white/5">
                                                <span className="text-[9px] font-black text-white/40 uppercase tracking-widest block mb-1">ENFORCED POLICY:</span>
                                                <span className={`font-mono text-[11px] ${gate.status === 'PASSED' ? 'text-emerald-400/80' : 'text-red-400/80'}`}>{gate.rule}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* AUTOMATED POLICY EVALUATION DRAWER */}
                                    {isOpen && (
                                      <div className="bg-zinc-950/95 border-t border-white/10 p-6 flex flex-col gap-4 animate-in fade-in slide-in-from-top-2">
                                        <p className="text-[10px] font-bold font-mono tracking-wider text-emerald-400 uppercase">
                                          Automated Security Guard Evaluation Matrix
                                        </p>
                                        
                                        <div className="flex flex-col gap-3 mt-1">
                                          {gate.checks.map((check: any, index) => (
                                            <div key={index} className="flex flex-col gap-2 bg-black/40 p-4 rounded-xl border border-white/5 font-mono text-xs">
                                              <div className="flex items-start justify-between">
                                                <div className="flex flex-col gap-1.5">
                                                  <span className="text-white/90 font-semibold">{check.name}</span>
                                                  {check.threshold && (
                                                    <span className="text-[9px] text-zinc-500 uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded w-fit border border-white/5">Threshold: {check.threshold}</span>
                                                  )}
                                                </div>
                                                <StatusIndicator type={check.status as any} />
                                              </div>
                                              <p className="text-[11px] text-zinc-400 leading-normal mt-1">{check.detail}</p>
                                            </div>
                                          ))}
                                        </div>
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
