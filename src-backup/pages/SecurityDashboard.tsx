<<<<<<< HEAD
﻿import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom'; // ✅ added useNavigate
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/apiClient';
import {
    Shield, CheckCircle, XCircle,
    RefreshCw, Play, ExternalLink, ArrowLeft,
    Clock, Terminal, Search, Bug, AlertTriangle, ShieldCheck
=======
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import SecurityPulseCard from '../components/SecurityPulseCard';
import {
    Shield, CheckCircle, XCircle,
    RefreshCw, Play, ExternalLink,
    Clock, Terminal, Bug, AlertTriangle
>>>>>>> 98f3544 (ui updates)
} from 'lucide-react';

interface ScanResult {
    $id: string;
    repo_id: string;
    repo_url: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed';
    details: any;
    $createdAt: string;
    repo_name?: string;
}

interface RepoMetric {
    $id: string;
    name: string;
    risk_score: number;
    vulnerability_count: number;
}

export default function SecurityDashboard() {
    const { accessToken } = useAuth();
    const navigate = useNavigate(); // ✅ navigation hook

    const [results, setResults] = useState<ScanResult[]>([]);
    const [repos, setRepos] = useState<RepoMetric[]>([]);
    const [loading, setLoading] = useState(true);
    const [triggering, setTriggering] = useState<string | null>(null);

    useEffect(() => {
        fetchDashboardData();
        const interval = setInterval(fetchDashboardData, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchDashboardData = async () => {
        try {
<<<<<<< HEAD
            const { data: scanData, error: scanErr } = await supabase
                .from('scan_results')
                .select(`*, repositories (name, url)`)
                .order('created_at', { ascending: false });

            if (scanErr) throw scanErr;

            const { data: repoData, error: repoErr } = await supabase
                .from('repositories')
                .select('id, name, risk_score, vulnerability_count');
=======
            // Fetch repositories
            const repoData = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
                Query.limit(100)
            ]);
            const repositories = repoData.documents as unknown as RepoMetric[];
>>>>>>> 98f3544 (ui updates)

            // Fetch scan results
            const scanData = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.orderDesc('$createdAt'),
                Query.limit(50)
            ]);
            
            // Fetch vulnerabilities for stats
            const vulnData = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                Query.limit(1000)
            ]);
            const allVulns = vulnData.documents as any[];

<<<<<<< HEAD
            setResults(scanData.map((item: any) => ({
                ...item,
                repo_name: item.repositories?.name || item.repositories?.url,
                repo_url: item.repositories?.url
            })));

            setRepos(repoData || []);
=======
            setResults(scanData.documents.map((item: any) => {
                const repo = repositories.find(r => r.$id === item.repo_id);
                return {
                    ...item,
                    repo_name: repo?.name || 'Unknown Repo',
                    repo_url: (repo as any)?.url || '#'
                };
            }));

            setRepos(repositories);

            // Calculate aggregate stats
            const totalRepos = repositories.length;
            const totalVulns = repositories.reduce((acc, r) => acc + (r.vulnerability_count || 0), 0);
            const avgRisk = totalRepos > 0
                ? Math.round(repositories.reduce((acc, r) => acc + (r.risk_score || 0), 0) / totalRepos)
                : 0;

            const criticalRisksItems = allVulns.filter(v => v.severity === 'critical' && v.status === 'open').length;
            const resolvedItems = allVulns.filter(v => v.status === 'resolved').length;
            const patchRate = allVulns.length > 0 ? (resolvedItems / allVulns.length) * 100 : 0;

            setStats({
                healthScore: 100 - avgRisk,
                criticalRisks: criticalRisksItems,
                patchRate: Math.round(patchRate),
                avgFixTime: 12,
                totalVulns
            });
>>>>>>> 98f3544 (ui updates)

        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRunScan = async (repoId: string) => {
        setTriggering(repoId);
        try {
<<<<<<< HEAD
            await apiFetch(`/api/repos/${repoId}/scan`, {
                method: 'POST',
                token: accessToken
=======
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const response = await fetch(`${apiBase}/api/repos/${repoId}/scan`, {
                method: 'POST'
>>>>>>> 98f3544 (ui updates)
            });
            fetchDashboardData();
        } catch (err: any) {
            console.error('Error triggering scan:', err);
            alert(err.message || 'Failed to trigger scan');
        } finally {
            setTriggering(null);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 p-8 flex items-center justify-center">
            <div className="text-center">
                <Shield className="w-12 h-12 text-blue-600 animate-pulse mx-auto mb-4" />
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest animate-pulse">
                    Scanning Perimeter...
                </h2>
            </div>
        </div>
    );

    const avgRisk = repos.length > 0
        ? Math.round(repos.reduce((acc, r) => acc + (r.risk_score || 0), 0) / repos.length)
        : 0;

    const healthIndex = 100 - avgRisk;
    const criticalRepos = repos.filter(r => r.risk_score > 70).length;
    const totalVulns = repos.reduce((acc, r) => acc + (r.vulnerability_count || 0), 0);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 p-8 text-slate-900 dark:text-white">
            <div className="max-w-7xl mx-auto">
<<<<<<< HEAD

                {/* Header */}
=======
>>>>>>> 98f3544 (ui updates)
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200">
                            <Shield className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tighter italic uppercase">Fleet Security</h1>
                            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">
                                Real-time Perimeter Defense
                            </p>
                        </div>
                    </div>

                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl hover:bg-black transition font-black uppercase tracking-widest text-xs shadow-lg"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Control Center
                    </Link>
                </div>

<<<<<<< HEAD
                {/* Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <MetricCard label="Fleet Health Index" value={`${healthIndex}%`} icon={<ShieldCheck />} />
                    <MetricCard label="Active Findings" value={totalVulns} icon={<Bug />} />
                    <MetricCard label="High Risk Targets" value={criticalRepos} icon={<AlertTriangle />} />
                    <MetricCard label="Audit Logs" value={results.length} icon={<Terminal />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <div className="lg:col-span-3">
                        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border overflow-hidden">
                            <div className="p-6 border-b flex justify-between items-center">
                                <h2 className="text-sm font-black uppercase tracking-widest">Live Audit Trail</h2>
                                <button onClick={fetchDashboardData}>
                                    <RefreshCw className="w-5 h-5" />
                                </button>
                            </div>

                            {results.length === 0 ? (
                                <div className="p-20 text-center">
                                    <Search className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                                    <p className="text-slate-400 uppercase text-sm">No Audit Logs Found</p>
                                </div>
                            ) : (
                                results.map(scan => (
                                    <ScanItem key={scan.id} scan={scan} onRescan={handleRunScan} isTriggering={triggering === scan.repo_id} />
                                ))
                            )}
=======
                <div className="mb-12">
                    <SecurityPulseCard
                        healthScore={stats.healthScore}
                        criticalRisks={stats.criticalRisks}
                        patchRate={stats.patchRate}
                        avgFixTime={stats.avgFixTime}
                        managedRepos={repos.length}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <MetricCard label="Active Findings" value={stats.totalVulns} icon={<Bug className="text-red-500" />} />
                    <MetricCard label="High Risk Targets" value={repos.filter(r => r.risk_score > 70).length} icon={<AlertTriangle className="text-amber-500" />} />
                    <MetricCard label="Audit Logs" value={results.length} icon={<Terminal className="text-blue-500" />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <div className="lg:col-span-3 space-y-6">
                        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white/50 backdrop-blur-sm">
                                <div className="flex items-center gap-3">
                                    <Clock className="w-5 h-5 text-slate-400" />
                                    <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest italic">Live Audit Trail</h2>
                                </div>
                                <button onClick={fetchDashboardData} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"><RefreshCw className="w-5 h-5" /></button>
                            </div>

                            <div className="divide-y divide-slate-100">
                                {results.length === 0 ? (
                                    <div className="p-20 text-center flex flex-col items-center text-slate-400 uppercase tracking-widest text-sm font-bold">No Audit Logs Found</div>
                                ) : (
                                    results.map((scan: any) => (
                                        <ScanItem key={scan.$id} scan={scan} onRescan={handleRunScan} isTriggering={triggering === scan.repo_id} />
                                    ))
                                )}
                            </div>
>>>>>>> 98f3544 (ui updates)
                        </div>
                    </div>

                    <div className="lg:col-span-1 space-y-6">
                        <RiskDistribution repos={repos} />
                        <DocumentationCard navigate={navigate} /> {/* ✅ clickable */}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---------- COMPONENTS ---------- */

function MetricCard({ label, value, icon }: any) {
    return (
        <div className="bg-white p-6 rounded-3xl border flex justify-between">
            <div>
<<<<<<< HEAD
                <p className="text-xs text-slate-400 uppercase">{label}</p>
                <p className="text-3xl font-bold">{value}</p>
            </div>
            {icon}
=======
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">{label}</p>
                <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter italic">{value}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl group-hover:bg-blue-50 transition-colors">{icon}</div>
>>>>>>> 98f3544 (ui updates)
        </div>
    );
}

function ScanItem({ scan, onRescan, isTriggering }: any) {
    return (
<<<<<<< HEAD
        <div className="p-6 border-b flex justify-between">
            <div>
                <p className="font-bold">{scan.repo_name}</p>
                <p className="text-xs text-slate-400">{scan.status}</p>
            </div>
            <div className="flex gap-2">
                <button onClick={() => onRescan(scan.repo_id)}>
                    {isTriggering ? <RefreshCw className="animate-spin" /> : <Play />}
                </button>
                <Link to={`/projects/${scan.repo_id}`}>
                    <ExternalLink />
                </Link>
=======
        <div className="p-6 hover:bg-slate-50 dark:bg-slate-800/50 transition-all group">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-2xl ${scan.status === 'completed' ? 'bg-green-50' : scan.status === 'failed' ? 'bg-red-50' : 'bg-blue-50 animate-pulse'}`}>
                        {scan.status === 'completed' ? <CheckCircle className="w-6 h-6 text-green-600" /> : scan.status === 'failed' ? <XCircle className="w-6 h-6 text-red-600" /> : <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />}
                    </div>
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <span className="font-black text-lg text-slate-900 dark:text-white tracking-tight leading-none group-hover:text-blue-600 transition-colors uppercase italic">{scan.repo_name}</span>
                            <span className="text-[10px] font-mono text-slate-300 uppercase tracking-widest">#{scan.$id.slice(0, 8)}</span>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400 font-black uppercase tracking-widest italic">
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(scan.$createdAt).toLocaleTimeString()}</span>
                            <span className={scan.status === 'completed' ? 'text-green-500' : scan.status === 'failed' ? 'text-red-500' : 'text-blue-500'}>{scan.status}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => onRescan(scan.repo_id)} disabled={isTriggering || scan.status === 'in_progress'} className="bg-slate-900 text-white p-3 rounded-xl hover:bg-black transition-all shadow-lg">
                        {isTriggering ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                    </button>
                    <Link to={`/projects/${scan.repo_id}`} className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition-all">
                        <ExternalLink className="w-4 h-4" />
                    </Link>
                </div>
>>>>>>> 98f3544 (ui updates)
            </div>
        </div>
    );
}

function RiskDistribution({ repos }: any) {
    return (
        <div className="bg-white p-6 rounded-3xl border">
            <h2 className="text-sm font-bold mb-4">Health Distribution</h2>
            <p>Total Repos: {repos.length}</p>
        </div>
    );
}

/* ✅ CLICKABLE CARD */
function DocumentationCard({ navigate }: any) {
    return (
<<<<<<< HEAD
        <div
            onClick={() => navigate('/compliance')}
            className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-3xl text-white cursor-pointer"
        >
            <Shield className="w-8 h-8 opacity-20 mb-4" />
            <h3 className="text-lg font-bold">Audit Compliance</h3>
            <p className="text-xs text-blue-100 mb-4">
                View security policy & response docs
            </p>
            <div className="flex items-center gap-2 text-xs font-bold">
                Read More →
            </div>
        </div>
    );
}
=======
        <div>
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-1 italic">
                <span>{label}</span>
                <span>{count} REPOS</span>
            </div>
            <div className="h-2 bg-slate-50 dark:bg-slate-800/50 rounded-full overflow-hidden">
                <div className={`h-full ${color} transition-all duration-1000`} style={{ width: `${percentage}%` }} />
            </div>
        </div>
    );
}

function DocumentationCard() {
    return (
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-3xl text-white relative overflow-hidden group">
            <h3 className="text-lg font-black uppercase italic leading-none mb-2">Audit Compliance</h3>
            <p className="text-[10px] font-bold uppercase text-blue-100 mb-4">View security policy docs</p>
            <Shield className="absolute -right-8 -bottom-8 w-32 h-32 opacity-10 group-hover:scale-110 transition-transform" />
        </div>
    );
}
>>>>>>> 98f3544 (ui updates)
