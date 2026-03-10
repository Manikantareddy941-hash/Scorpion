import React, { useEffect, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, PieChart, Pie, Cell
} from 'recharts';
import {
    Shield, TrendingUp, AlertCircle,
    Filter, ChevronRight, Activity, Loader2, Download
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function Reports() {
    const { theme } = useTheme();
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [stats, setStats] = useState<any>(null);
    const [trend, setTrend] = useState<any[]>([]);
    const [scope, setScope] = useState<'global' | 'team' | 'project'>('global');
    const scopeId = '';

    useEffect(() => {
        fetchStats();
    }, [scope, scopeId]);

    const fetchStats = async () => {
        setLoading(true);
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const url = new URL(`${apiBase}/api/reports/stats`);
            url.searchParams.append('scope', scope);
            if (scopeId) url.searchParams.append('id', scopeId);

            const response = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setStats(data.stats);
                setTrend(data.trend);
            }
        } catch (err) {
            console.error('Error fetching reporting stats:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async () => {
        setGenerating(true);
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const response = await fetch(`${apiBase}/api/reports/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    scope,
                    id: scopeId,
                    title: `Executive Security Report - ${new Date().toLocaleDateString()}`
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `StackPilot_Report_${scope}.pdf`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        } catch (err) {
            console.error('Export failed:', err);
        } finally {
            setGenerating(false);
        }
    };

    const SEVERITY_COLORS = {
        critical: '#e11d48',
        high: '#f59e0b',
        medium: '#3b82f6',
        low: '#10b981'
    };

    const severityData = stats ? [
        { name: 'Critical', value: stats.severity_breakdown.critical, color: SEVERITY_COLORS.critical },
        { name: 'High', value: stats.severity_breakdown.high, color: SEVERITY_COLORS.high },
        { name: 'Medium', value: stats.severity_breakdown.medium, color: SEVERITY_COLORS.medium },
        { name: 'Low', value: stats.severity_breakdown.low, color: SEVERITY_COLORS.low },
    ] : [];

    const owaspData = stats ? Object.entries(stats.owasp_breakdown || {}).map(([name, value]) => ({
        name: name.split(':')[0],
        fullName: name,
        value: value as number
    })) : [];

    if (loading && !stats) return (
        <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <TrendingUp className="w-12 h-12 text-blue-600 animate-pulse" />
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse italic">Synthesizing Posture Data...</h2>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-500/20">
                            <TrendingUp className="w-7 h-7" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic">Executive Intelligence</h1>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1 italic font-mono">Strategic vulnerability clusters & trend vectors</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className="relative flex-grow md:flex-grow-0">
                            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <select
                                value={scope}
                                onChange={(e) => setScope(e.target.value as any)}
                                className="pl-12 pr-10 py-3.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl outline-none focus:ring-4 focus:ring-blue-600/10 transition-all font-black text-[10px] uppercase tracking-widest italic appearance-none"
                            >
                                <option value="global">Organization Matrix</option>
                                <option value="team">Cluster Isolation</option>
                                <option value="project">Unit Resolution</option>
                            </select>
                        </div>

                        <button
                            onClick={handleExport}
                            disabled={generating}
                            className="btn-premium flex items-center gap-3 disabled:opacity-50"
                        >
                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            Export Intelligence
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
                    <StatCard
                        label="Avg Risk Score"
                        value={`${stats?.avg_risk_score}%`}
                        trend="SECURE-PROTOCOL"
                        icon={<Shield className="w-6 h-6 text-blue-600" />}
                        color="blue"
                    />
                    <StatCard
                        label="Active Threats"
                        value={stats?.total_findings}
                        trend="LIVE-FEED"
                        icon={<AlertCircle className="w-6 h-6 text-rose-600" />}
                        color="rose"
                    />
                    <StatCard
                        label="Policy Integrity"
                        value="84.2%"
                        trend="VERIFIED"
                        icon={<Activity className="w-6 h-6 text-emerald-600" />}
                        color="emerald"
                    />
                    <StatCard
                        label="Fleet Units"
                        value={stats?.total_repos}
                        trend="MANAGED"
                        icon={<TrendingUp className="w-6 h-6 text-indigo-600" />}
                        color="indigo"
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-12">
                    <div className="premium-card p-10">
                        <h3 className="text-xs font-black text-slate-900 dark:text-white mb-10 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse" />
                            Severity Spectrum Distribution
                        </h3>
                        <div className="h-80">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={severityData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 900 }} dy={10} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 900 }} />
                                    <Tooltip
                                        cursor={{ fill: theme === 'dark' ? '#1e293b' : '#f8fafc' }}
                                        contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '1.5rem', border: '1px solid var(--border-subtle)', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                                        labelClassName="hidden"
                                    />
                                    <Bar dataKey="value" radius={[12, 12, 0, 0]} barSize={60}>
                                        {severityData.map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={severityData[index].color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="premium-card p-10">
                        <h3 className="text-xs font-black text-slate-900 dark:text-white mb-10 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse" />
                            Threat Vector Index Trend
                        </h3>
                        <div className="h-80">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={trend}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
                                    <XAxis
                                        dataKey="date"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 9, fontWeight: 900 }}
                                        tickFormatter={(val) => new Date(val).toLocaleDateString()}
                                        dy={10}
                                    />
                                    <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 900 }} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '1.5rem', border: '1px solid var(--border-subtle)', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="score"
                                        stroke="#3b82f6"
                                        strokeWidth={4}
                                        dot={{ r: 5, fill: '#3b82f6', strokeWidth: 3, stroke: theme === 'dark' ? '#1e293b' : '#fff' }}
                                        activeDot={{ r: 8, strokeWidth: 0 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                    <div className="lg:col-span-1 premium-card p-10">
                        <h3 className="text-xs font-black text-slate-900 dark:text-white mb-10 uppercase tracking-[0.2em] italic">OWASP Cluster Mapping</h3>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={owaspData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={70}
                                        outerRadius={95}
                                        paddingAngle={8}
                                        dataKey="value"
                                    >
                                        {owaspData.map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e'][index % 5]} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="mt-10 space-y-4">
                            {owaspData.slice(0, 4).map((d, i) => (
                                <div key={i} className="flex items-center justify-between text-[10px] font-black uppercase italic tracking-widest">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${['bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500'][i % 4]}`} />
                                        <span className="text-slate-400 dark:text-slate-500">{d.fullName}</span>
                                    </div>
                                    <span className="text-slate-900 dark:text-white">{d.value} UNIT</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="lg:col-span-2 bg-gradient-to-br from-slate-900 to-blue-950 p-12 rounded-[3.5rem] text-white overflow-hidden relative border border-slate-800 shadow-2xl group">
                        <Shield className="absolute -right-20 -bottom-20 w-80 h-80 text-white opacity-[0.03] rotate-12 group-hover:rotate-45 transition-transform duration-1000" />
                        <div className="relative z-10 h-full flex flex-col justify-between">
                            <div>
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-500 rounded-full border border-emerald-500/20 text-[9px] font-black uppercase tracking-widest italic mb-6">
                                    <Activity className="w-3 h-3" /> Real-time Compliance Verified
                                </div>
                                <h3 className="text-4xl font-black mb-6 uppercase italic tracking-tighter leading-none">Security Posture: <span className="text-emerald-500">OPTIMIZED</span></h3>
                                <p className="text-slate-400 text-sm font-medium max-w-md leading-relaxed mb-10 italic uppercase tracking-tight">
                                    Strategic analysis confirms a 42% reduction in reconnaissance-phase vulnerabilities. Fleet integrity remains within operational tolerances.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-5">
                                <button className="px-10 py-4 bg-white/5 hover:bg-white/10 rounded-2xl transition-all font-black text-[10px] uppercase tracking-widest border border-white/10 backdrop-blur-md">
                                    Review Patch Vector
                                </button>
                                <button className="px-10 py-4 bg-blue-600 hover:bg-blue-700 rounded-2xl transition-all font-black text-[10px] uppercase tracking-widest shadow-xl shadow-blue-500/20">
                                    Configure Neural Alerts
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ label, value, trend, icon }: { label: string, value: any, trend: string, icon: React.ReactNode, color: string }) {
    return (
        <div className="premium-card p-8 group hover:border-blue-600/30 transition-all duration-500">
            <div className="flex justify-between items-start mb-6">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 dark:border-slate-800 text-slate-400 group-hover:text-blue-600 group-hover:bg-blue-50 transition-all duration-500">
                    {icon}
                </div>
                <ChevronRight className="w-4 h-4 text-slate-200 dark:text-slate-800 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 italic">{label}</p>
            <h4 className="text-3xl font-black text-slate-900 dark:text-white mb-2 italic tracking-tighter">{value}</h4>
            <div className="flex items-center gap-2 text-[9px] font-black text-slate-300 dark:text-slate-700 uppercase tracking-widest italic">
                <div className="w-1.5 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full" />
                {trend}
            </div>
        </div>
    );
}



