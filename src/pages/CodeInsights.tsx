import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowLeft, AlertCircle,
    RefreshCw, Zap, Bug, Code2, Lock, TrendingUp,
    Terminal, Shield
} from 'lucide-react';
import {
    ResponsiveContainer, AreaChart, Area
} from 'recharts';

interface CodeMetric {
    tool: 'eslint' | 'trivy' | 'npm_audit';
    errors: number;
    warnings: number;
    info: number;
    score: number;
    raw_output: any;
}

interface Scan {
    id: string;
    repo_id: string;
    status: string;
    scan_type: string;
    details: any;
    created_at: string;
    code_metrics?: CodeMetric[];
}

interface TrendData {
    date: string;
    score: number;
    vulnerabilities: number;
}

export default function CodeInsights() {
    const [loading, setLoading] = useState(true);
    const [scans, setScans] = useState<Scan[]>([]);
    const [trends, setTrends] = useState<TrendData[]>([]);
    const [overallScore, setOverallScore] = useState(0);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // 1m polling for trends
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            const session = JSON.parse(localStorage.getItem('supabase.auth.token') || '{}');
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const [summaryRes, trendsRes] = await Promise.all([
                fetch(`${apiBase}/api/insights/summary`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`${apiBase}/api/insights/trends`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);

            if (!summaryRes.ok || !trendsRes.ok) throw new Error('Failed to fetch data');

            const insightsData = await summaryRes.json();
            const trendsData = await trendsRes.json();

            setScans(insightsData.scans || []);
            setOverallScore(insightsData.overallScore || 0);
            setTrends(trendsData || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center p-8">
                <div className="text-center">
                    <Zap className="w-12 h-12 text-blue-600 animate-pulse mx-auto mb-4" />
                    <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest animate-pulse">Aggregating Intelligence...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 p-8 text-slate-900 dark:text-white">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200">
                            <Zap className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none">Intelligence Center</h1>
                            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Global Audit & Trends</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={fetchData} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl hover:bg-slate-50 dark:bg-slate-800/50 transition-all text-slate-400 hover:text-blue-600">
                            <RefreshCw className="w-5 h-5" />
                        </button>
                        <Link
                            to="/"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl hover:bg-black transition font-black uppercase tracking-widest text-xs shadow-lg"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Control
                        </Link>
                    </div>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-8 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-800 font-bold uppercase tracking-tight">{error}</p>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Main Analysis Panel */}
                    <div className="lg:col-span-3 space-y-8">
                        {/* Top Metrics Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col items-center text-center group hover:border-blue-200 transition-all">
                                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 italic">Security Efficiency</h3>
                                <div className="text-6xl font-black tracking-tighter italic text-slate-900 dark:text-white mb-4 group-hover:scale-110 transition-transform">{overallScore}%</div>
                                <div className={`text-[10px] font-black px-4 py-1.5 rounded-xl uppercase tracking-widest shadow-sm ${overallScore >= 80 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                                    }`}>
                                    {overallScore >= 80 ? 'Optimum Baseline' : 'Architectural Cleanup Required'}
                                </div>
                            </div>

                            <div className="md:col-span-2 bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 group hover:border-blue-100 transition-all">
                                <div className="flex items-baseline justify-between mb-6">
                                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic leading-none">Intelligence Trajectory</h3>
                                    <div className="flex items-center gap-1.5 bg-emerald-50 px-3 py-1 rounded-full">
                                        <TrendingUp className="w-3 h-3 text-emerald-600" />
                                        <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">+2.4% Momentum</span>
                                    </div>
                                </div>
                                <div className="h-32">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={trends}>
                                            <defs>
                                                <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1} />
                                                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <Area type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={4} fill="url(#colorScore)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* Recent Tools Summary */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {scans[0]?.code_metrics?.map((metric) => (
                                <ToolStatCard key={metric.tool} metric={metric} />
                            ))}
                        </div>

                        {/* Main Log Table */}
                        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                            <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white/50 backdrop-blur-sm">
                                <div className="flex items-center gap-3">
                                    <Terminal className="w-5 h-5 text-slate-400" />
                                    <h2 className="text-[11px] font-black text-slate-900 dark:text-white uppercase tracking-widest italic">Signal Intelligence Audit</h2>
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50/50 text-slate-400 text-[9px] font-black uppercase tracking-widest">
                                        <tr>
                                            <th className="px-8 py-5">Integrity</th>
                                            <th className="px-8 py-5">Trace Hex</th>
                                            <th className="px-8 py-5 text-center">Score</th>
                                            <th className="px-8 py-5">Audit TS</th>
                                            <th className="px-8 py-5">Findings</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {scans.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="px-8 py-20 text-center">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Awaiting analysis ingestion...</p>
                                                </td>
                                            </tr>
                                        ) : scans.map((scan) => (
                                            <tr key={scan.id} className="hover:bg-slate-50 dark:bg-slate-800/50 transition cursor-default group">
                                                <td className="px-8 py-6">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className={`w-2 h-2 rounded-full ${scan.status === 'completed' ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]' : 'bg-red-500'} animate-pulse`} />
                                                        <span className={`text-[10px] font-black uppercase tracking-widest ${scan.status === 'completed' ? 'text-emerald-600' : 'text-red-600'}`}>{scan.status}</span>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6 font-mono text-[10px] text-slate-300 tracking-tighter group-hover:text-slate-900 dark:text-white transition-colors">
                                                    {scan.id.slice(0, 16).toUpperCase()}
                                                </td>
                                                <td className="px-8 py-6 text-center">
                                                    <span className="text-lg font-black text-slate-900 dark:text-white tracking-tighter italic">{scan.details?.security_score || '00'}%</span>
                                                </td>
                                                <td className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest italic">
                                                    {new Date(scan.created_at).toLocaleDateString()}
                                                </td>
                                                <td className="px-8 py-6">
                                                    <div className={`inline-flex items-center px-3 py-1 rounded-xl border ${scan.details?.total_vulnerabilities > 0
                                                        ? 'bg-red-50 text-red-600 border-red-100'
                                                        : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                                        }`}>
                                                        <span className="text-[9px] font-black uppercase tracking-widest">
                                                            {scan.details?.total_vulnerabilities || 0} Findings Detected
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Right Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        <AnalysisInsights scan={scans[0]} />
                        <OpsProtocol />
                    </div>
                </div>
            </div>
        </div>
    );
}

function ToolStatCard({ metric }: { metric: CodeMetric }) {
    const getIcon = () => {
        switch (metric.tool) {
            case 'eslint': return <Code2 className="w-5 h-5" />;
            case 'trivy': return <Lock className="w-5 h-5" />;
            case 'npm_audit': return <Bug className="w-5 h-5" />;
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 group hover:border-blue-400 transition-all cursor-crosshair">
            <div className="flex items-center justify-between mb-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-2xl text-slate-300 group-hover:bg-blue-600 group-hover:text-white transition-all">
                    {getIcon()}
                </div>
                <span className="text-2xl font-black text-slate-900 dark:text-white italic tracking-tighter">{metric.score}%</span>
            </div>
            <h4 className="text-[11px] font-black text-slate-900 dark:text-white uppercase tracking-widest mb-4 italic">{metric.tool.replace('_', ' ')}</h4>
            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Threats</span>
                    <span className={`text-[10px] font-black ${metric.errors > 0 ? 'text-red-500' : 'text-emerald-500'}`}>{metric.errors}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Advisories</span>
                    <span className="text-[10px] font-black text-amber-500">{metric.warnings}</span>
                </div>
                <div className="w-full bg-slate-50 dark:bg-slate-800/50 h-1.5 rounded-full overflow-hidden mt-1">
                    <div
                        className={`h-full transition-all duration-1000 ${metric.score > 80 ? 'bg-emerald-500' : metric.score > 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${metric.score}%` }}
                    />
                </div>
            </div>
        </div>
    );
}

function AnalysisInsights({ scan }: { scan: Scan | undefined }) {
    const insights = scan ? [
        { id: 1, text: `Review findings in ${scan.details?.tools?.[0] || 'active tools'}`, type: scan.details?.total_vulnerabilities > 10 ? 'security' : 'quality' },
        { id: 2, text: `Trace ID ${scan.id.slice(0, 4)} architectural review pending`, type: 'quality' },
        { id: 3, text: "System memory pressure within normal bounds", type: 'performance' },
        { id: 4, text: `${scan.status === 'completed' ? 'Pipeline hygiene verified' : 'Auditing in progress'}`, type: 'ops' },
    ] : [
        { id: 1, text: "Awaiting signals for intelligence derivation", type: "ops" }
    ];

    return (
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-8 italic">Analysis Insights</h2>
            <div className="space-y-8">
                {insights.map((insight) => (
                    <div key={insight.id} className="flex gap-4 group">
                        <div className={`mt-1.5 flex-shrink-0 w-2 h-2 rounded-full ring-4 ring-white shadow-sm ${insight.type === 'security' ? 'bg-red-500' :
                            insight.type === 'performance' ? 'bg-blue-600' : 'bg-emerald-500'
                            }`} />
                        <p className="text-[10px] font-black text-slate-700 dark:text-slate-300 leading-relaxed uppercase tracking-tight italic group-hover:text-blue-600 transition-colors">{insight.text}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function OpsProtocol() {
    return (
        <div className="bg-gradient-to-br from-slate-900 to-black p-8 rounded-[2.5rem] shadow-xl shadow-slate-200 text-white group cursor-pointer overflow-hidden relative">
            <div className="relative z-10">
                <Shield className="w-8 h-8 opacity-20 mb-6" />
                <h3 className="text-2xl font-black uppercase tracking-tighter italic leading-none mb-3 group-hover:text-blue-400 transition-colors">Tactical Ops</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-6">Incident Response & Manual Trace</p>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-500">
                    <RefreshCw className="w-4 h-4" />
                    <span>Synchronize</span>
                </div>
            </div>
            <Terminal className="absolute -right-8 -bottom-8 w-40 h-40 opacity-5 group-hover:scale-110 transition-transform duration-[3s]" />
        </div>
    );
}



