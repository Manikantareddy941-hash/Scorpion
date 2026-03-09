import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom'; // ✅ added useNavigate
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/apiClient';
import {
    Shield, CheckCircle, XCircle,
    RefreshCw, Play, ExternalLink, ArrowLeft,
    Clock, Terminal, Search, Bug, AlertTriangle, ShieldCheck
} from 'lucide-react';

interface ScanResult {
    id: string;
    repo_id: string;
    repo_url: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed';
    details: any;
    created_at: string;
    repo_name?: string;
}

interface RepoMetric {
    id: string;
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
            const { data: scanData, error: scanErr } = await supabase
                .from('scan_results')
                .select(`*, repositories (name, url)`)
                .order('created_at', { ascending: false });

            if (scanErr) throw scanErr;

            const { data: repoData, error: repoErr } = await supabase
                .from('repositories')
                .select('id, name, risk_score, vulnerability_count');

            if (repoErr) throw repoErr;

            setResults(scanData.map((item: any) => ({
                ...item,
                repo_name: item.repositories?.name || item.repositories?.url,
                repo_url: item.repositories?.url
            })));

            setRepos(repoData || []);

        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRunScan = async (repoId: string) => {
        setTriggering(repoId);
        try {
            await apiFetch(`/api/repos/${repoId}/scan`, {
                method: 'POST',
                token: accessToken
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

                {/* Header */}
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
                <p className="text-xs text-slate-400 uppercase">{label}</p>
                <p className="text-3xl font-bold">{value}</p>
            </div>
            {icon}
        </div>
    );
}

function ScanItem({ scan, onRescan, isTriggering }: any) {
    return (
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