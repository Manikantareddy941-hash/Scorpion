import { useEffect, useState } from 'react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    AreaChart, Area, Cell, PieChart, Pie
} from 'recharts';
import {
    Sparkles, ThumbsUp,
    Clock, Target, Brain, ArrowUpRight, ShieldCheck, ChevronRight, Activity
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function AIAnalytics() {
    const { theme } = useTheme();
    const [summary, setSummary] = useState<any>(null);
    const [trends, setTrends] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const [summaryRes, trendsRes] = await Promise.all([
                fetch(`${apiBase}/api/ai/metrics/summary`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${apiBase}/api/ai/metrics/trends`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            if (summaryRes.ok) setSummary(await summaryRes.json());
            if (trendsRes.ok) setTrends(await trendsRes.json());
        } catch (err) {
            console.error('Failed to fetch AI analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <Brain className="w-12 h-12 text-blue-600 animate-pulse" />
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse italic">Synthesizing Intelligence...</h2>
            </div>
        </div>
    );

    const COLORS = ['#10b981', '#3b82f6', '#f43f5e'];

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <header className="mb-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-500/20">
                            <Brain className="w-7 h-7" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic">Neural Impact</h1>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1 italic font-mono">Measuring Remediation AI Performance Metrics</p>
                        </div>
                    </div>
                </header>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
                    <KPICard
                        title="Acceptance Rate"
                        value={`${(summary?.acceptance_rate || 0).toFixed(1)}%`}
                        icon={<ThumbsUp className="w-5 h-5" />}
                        subtitle="Developer alignment"
                        trend="+4.2%"
                    />
                    <KPICard
                        title="Avg Resolution"
                        value="14.2m"
                        icon={<Clock className="w-5 h-5" />}
                        subtitle="Manual took ~2.4h"
                        trend="-85%"
                        positive={true}
                    />
                    <KPICard
                        title="Trust Index"
                        value={`${(summary?.avg_confidence_accepted * 100 || 0).toFixed(0)}%`}
                        icon={<Target className="w-5 h-5" />}
                        subtitle="Avg suggestion conf."
                        trend="+2.1%"
                    />
                    <KPICard
                        title="Neutralized"
                        value={summary?.accepted || 0}
                        icon={<ShieldCheck className="w-5 h-5" />}
                        subtitle="Total threats remediated"
                        trend={`from ${summary?.viewed || 0} views`}
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 mb-8">
                    {/* Adoption Trend */}
                    <div className="lg:col-span-2 premium-card p-10">
                        <div className="flex items-center justify-between mb-10">
                            <div>
                                <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-[0.2em] italic">Neural Adoption Vector</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 italic">Temporal engagement analysis</p>
                            </div>
                            <Activity className="w-5 h-5 text-slate-300 dark:text-slate-700" />
                        </div>
                        <div className="h-80">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={trends}>
                                    <defs>
                                        <linearGradient id="colorViewed" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorAccepted" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
                                    <XAxis
                                        dataKey="date"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 9, fontWeight: 900 }}
                                        dy={10}
                                    />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 9, fontWeight: 900 }} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '1.5rem', border: '1px solid var(--border-subtle)', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Area type="monotone" dataKey="viewed" stroke="#3b82f6" fillOpacity={1} fill="url(#colorViewed)" strokeWidth={4} />
                                    <Area type="monotone" dataKey="accepted" stroke="#10b981" fillOpacity={1} fill="url(#colorAccepted)" strokeWidth={4} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Action Distribution */}
                    <div className="premium-card p-10 flex flex-col">
                        <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-[0.2em] italic mb-10">Vector Distribution</h3>
                        <div className="h-64 mb-8">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={[
                                            { name: 'Accepted', value: summary?.accepted || 0 },
                                            { name: 'Ignored', value: summary?.ignored || 0 },
                                            { name: 'Pending', value: Math.max(0, (summary?.viewed || 0) - (summary?.accepted || 0) - (summary?.ignored || 0)) }
                                        ]}
                                        innerRadius={70}
                                        outerRadius={95}
                                        paddingAngle={8}
                                        dataKey="value"
                                    >
                                        {COLORS.map((color, index) => (
                                            <Cell key={`cell-${index}`} fill={color} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="space-y-4 flex-grow">
                            <LegendItem label="Accepted" value={summary?.accepted || 0} color="bg-emerald-500" />
                            <LegendItem label="Ignored" value={summary?.ignored || 0} color="bg-blue-500" />
                            <LegendItem label="Pending" value={Math.max(0, (summary?.viewed || 0) - (summary?.accepted || 0) - (summary?.ignored || 0))} color="bg-rose-500" />
                        </div>
                        <div className="mt-8 pt-8 border-t border-[var(--border-subtle)] text-center text-[9px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest italic">
                            Neural Processing Clear &bull; v2.4.0
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function KPICard({ title, value, icon, subtitle, trend, positive = true }: any) {
    return (
        <div className="premium-card p-8 group hover:border-blue-600/30 transition-all duration-500 overflow-hidden relative">
            <div className="flex items-start justify-between relative z-10 mb-6">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 dark:border-slate-800 text-slate-400 group-hover:text-blue-600 group-hover:bg-blue-50 transition-all duration-500">
                    {icon}
                </div>
                <div className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest italic ${positive ? 'text-emerald-500' : 'text-rose-500'}`}>
                    <ArrowUpRight className="w-3.5 h-3.5" /> {trend}
                </div>
            </div>
            <div className="relative z-10">
                <div className="text-4xl font-black tracking-tighter text-slate-900 dark:text-white group-hover:translate-x-1 transition-transform italic">{value}</div>
                <div className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-2 italic">{title}</div>
                <div className="mt-6 flex items-center justify-between">
                    <span className="text-[9px] font-black text-slate-300 dark:text-slate-700 uppercase tracking-widest italic">{subtitle}</span>
                    <ChevronRight className="w-4 h-4 text-slate-100 dark:text-slate-900 group-hover:text-blue-500 transition-colors" />
                </div>
            </div>
            <Sparkles className="absolute -right-4 -bottom-4 w-16 h-16 text-blue-600 opacity-[0.03] group-hover:opacity-10 transition-opacity" />
        </div>
    );
}

function LegendItem({ label, value, color }: any) {
    return (
        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 dark:border-slate-800">
            <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${color} shadow-sm`} />
                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest italic">{label}</span>
            </div>
            <span className="text-xs font-black text-slate-900 dark:text-white italic">{value}</span>
        </div>
    );
}



