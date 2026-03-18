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
import { useAuth } from '../contexts/AuthContext';

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
    const { getJWT } = useAuth();
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
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const headers = { 'Authorization': `Bearer ${token}` };

            const [summaryRes, trendsRes] = await Promise.all([
                fetch(`${apiBase}/api/insights/summary`, { headers }),
                fetch(`${apiBase}/api/insights/trends`, { headers })
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
            <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-8">
                <div className="text-center">
                    <Zap className="w-12 h-12 text-[var(--accent-primary)] animate-pulse mx-auto mb-4" />
                    <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic">Aggregating Intelligence...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-[var(--accent-primary)] p-3 rounded-2xl shadow-lg shadow-[var(--accent-primary)]/20">
                            <Zap className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none text-[var(--text-primary)]">Intelligence Center</h1>
                            <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-widest mt-1 italic">Global Audit & Trends</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={fetchData} className="p-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl hover:bg-[var(--bg-primary)] transition-all text-[var(--text-secondary)] hover:text-[var(--accent-primary)]">
                            <RefreshCw className="w-5 h-5" />
                        </button>
                        <Link
                            to="/"
                            className="btn-premium flex items-center gap-2"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Control
                        </Link>
                    </div>
                </div>

                {error && (
                    <div className="bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-2xl p-4 mb-8 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-[var(--status-error)] flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] font-bold text-[var(--status-error)] uppercase tracking-tight italic">{error}</p>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Main Analysis Panel */}
                    <div className="lg:col-span-3 space-y-8">
                        {/* Top Metrics Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="premium-card p-8 flex flex-col items-center text-center group">
                                <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-4 italic">Security Efficiency</h3>
                                <div className="text-6xl font-black tracking-tighter italic text-[var(--text-primary)] mb-4 group-hover:scale-110 transition-transform">{overallScore}%</div>
                                <div className={`text-[10px] font-black px-4 py-1.5 rounded-xl uppercase tracking-widest shadow-sm ${overallScore >= 80 ? 'bg-[var(--status-success)]/10 text-[var(--status-success)]' : 'bg-[var(--status-warning)]/10 text-[var(--status-warning)]'
                                    }`}>
                                    {overallScore >= 80 ? 'Optimum Baseline' : 'Architectural Cleanup Required'}
                                </div>
                            </div>

                            <div className="md:col-span-2 premium-card p-8 group">
                                <div className="flex items-baseline justify-between mb-6">
                                    <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic leading-none">Intelligence Trajectory</h3>
                                    <div className="flex items-center gap-1.5 bg-[var(--status-success)]/10 px-3 py-1 rounded-full">
                                        <TrendingUp className="w-3 h-3 text-[var(--status-success)]" />
                                        <span className="text-[9px] font-black text-[var(--status-success)] uppercase tracking-widest">+2.4% Momentum</span>
                                    </div>
                                </div>
                                <div className="h-32">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={trends}>
                                            <defs>
                                                <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.1} />
                                                    <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <Area type="monotone" dataKey="score" stroke="var(--accent-primary)" strokeWidth={4} fill="url(#colorScore)" />
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
                        <div className="premium-card overflow-hidden">
                            <div className="p-8 border-b border-[var(--border-subtle)] flex justify-between items-center bg-[var(--text-primary)]/5">
                                <div className="flex items-center gap-3">
                                    <Terminal className="w-5 h-5 text-[var(--accent-primary)]" />
                                    <h2 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">Signal Intelligence Audit</h2>
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-[9px] font-black uppercase tracking-widest border-b border-[var(--border-subtle)]">
                                        <tr>
                                            <th className="px-8 py-5">Integrity</th>
                                            <th className="px-8 py-5">Trace Hex</th>
                                            <th className="px-8 py-5 text-center">Score</th>
                                            <th className="px-8 py-5">Audit TS</th>
                                            <th className="px-8 py-5">Findings</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border-subtle)]">
                                        {scans.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="px-8 py-20 text-center">
                                                    <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Awaiting analysis ingestion...</p>
                                                </td>
                                            </tr>
                                        ) : scans.map((scan) => (
                                            <tr key={scan.id} className="hover:bg-[var(--text-primary)]/5 transition cursor-default group">
                                                <td className="px-8 py-6">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className={`w-2 h-2 rounded-full ${scan.status === 'completed' ? 'bg-[var(--status-success)] shadow-[0_0_12px_var(--status-success)]' : 'bg-[var(--status-error)]'} animate-pulse`} />
                                                        <span className={`text-[10px] font-black uppercase tracking-widest italic ${scan.status === 'completed' ? 'text-[var(--status-success)]' : 'text-[var(--status-error)]'}`}>{scan.status}</span>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6 font-mono text-[10px] text-[var(--text-secondary)] tracking-tighter group-hover:text-[var(--text-primary)] transition-colors">
                                                    {scan.id.slice(0, 16).toUpperCase()}
                                                </td>
                                                <td className="px-8 py-6 text-center">
                                                    <span className="text-lg font-black text-[var(--text-primary)] tracking-tighter italic">{scan.details?.security_score || '00'}%</span>
                                                </td>
                                                <td className="px-8 py-6 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic font-mono">
                                                    {new Date(scan.created_at).toLocaleDateString()}
                                                </td>
                                                <td className="px-8 py-6">
                                                    <div className={`inline-flex items-center px-3 py-1 rounded-xl border ${scan.details?.total_vulnerabilities > 0
                                                        ? 'bg-[var(--status-error)]/10 text-[var(--status-error)] border-[var(--status-error)]/20'
                                                        : 'bg-[var(--status-success)]/10 text-[var(--status-success)] border-[var(--status-success)]/20'
                                                        }`}>
                                                        <span className="text-[9px] font-black uppercase tracking-widest italic">
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
        <div className="premium-card p-6 group hover:border-[var(--accent-primary)]/50 transition-all cursor-crosshair">
            <div className="flex items-center justify-between mb-4">
                <div className="bg-[var(--bg-secondary)] p-2.5 rounded-2xl text-[var(--text-secondary)] group-hover:bg-[var(--accent-primary)] group-hover:text-white transition-all border border-[var(--border-subtle)]">
                    {getIcon()}
                </div>
                <span className="text-2xl font-black text-[var(--text-primary)] italic tracking-tighter">{metric.score}%</span>
            </div>
            <h4 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest mb-4 italic leading-none">{metric.tool.replace('_', ' ')}</h4>
            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Threats</span>
                    <span className={`text-[10px] font-black italic ${metric.errors > 0 ? 'text-[var(--status-error)]' : 'text-[var(--status-success)]'}`}>{metric.errors}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Advisories</span>
                    <span className="text-[10px] font-black text-[var(--status-warning)] italic">{metric.warnings}</span>
                </div>
                <div className="w-full bg-[var(--bg-secondary)] h-1.5 rounded-full overflow-hidden mt-1 border border-[var(--border-subtle)]">
                    <div
                        className={`h-full transition-all duration-1000 ${metric.score > 80 ? 'bg-[var(--status-success)]' : metric.score > 50 ? 'bg-[var(--status-warning)]' : 'bg-[var(--status-error)]'}`}
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
        <div className="premium-card p-8">
            <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest mb-8 italic">Analysis Insights</h2>
            <div className="space-y-8">
                {insights.map((insight) => (
                    <div key={insight.id} className="flex gap-4 group">
                        <div className={`mt-1.5 flex-shrink-0 w-2 h-2 rounded-full ring-4 ring-[var(--bg-card)] shadow-sm ${insight.type === 'security' ? 'bg-[var(--status-error)]' :
                            insight.type === 'performance' ? 'bg-[var(--accent-primary)]' : 'bg-[var(--status-success)]'
                            }`} />
                        <p className="text-[10px] font-black text-[var(--text-secondary)] leading-relaxed uppercase tracking-tight italic group-hover:text-[var(--accent-primary)] transition-colors">{insight.text}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function OpsProtocol() {
    return (
        <div className="bg-gradient-to-br from-slate-900 to-black p-8 rounded-[2.5rem] shadow-xl shadow-[var(--accent-primary)]/5 text-white group cursor-pointer overflow-hidden relative border border-white/5">
            <div className="relative z-10">
                <Shield className="w-8 h-8 opacity-20 mb-6" />
                <h3 className="text-2xl font-black uppercase tracking-tighter italic leading-none mb-3 group-hover:text-[var(--accent-primary)] transition-colors">Tactical Ops</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-6 italic">Incident Response & Manual Trace</p>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--accent-primary)] italic">
                    <RefreshCw className="w-4 h-4" />
                    <span>Synchronize</span>
                </div>
            </div>
            <Terminal className="absolute -right-8 -bottom-8 w-40 h-40 opacity-5 group-hover:scale-110 transition-transform duration-[3s]" />
        </div>
    );
}
