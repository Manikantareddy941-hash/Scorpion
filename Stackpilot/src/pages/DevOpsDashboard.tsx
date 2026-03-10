import { useEffect, useState } from 'react';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip
} from 'recharts';
import {
    AlertTriangle, Activity, Layout, Github, Shield,
    BarChart3, Clock, Database, Mail, RefreshCw, Zap
} from 'lucide-react';

interface DashboardStats {
    avgRiskScore: number;
    totalVulns: number;
    totalRepos: number;
    openTasks: number;
    highPriorityTasks: number;
}

interface HealthStatus {
    status: string;
    services: {
        database: string;
        email: string;
        gateway: string;
    };
}

interface ActivityItem {
    id: string;
    text: string;
    time: string;
    type: 'info' | 'success' | 'warning' | 'error';
}

export default function DevOpsDashboard() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [health, setHealth] = useState<HealthStatus | null>(null);
    const [activities, setActivities] = useState<ActivityItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAllData();
        const interval = setInterval(fetchAllData, 30000); // 30s polling
        return () => clearInterval(interval);
    }, []);

    const fetchAllData = async () => {
        try {
            const session = JSON.parse(localStorage.getItem('supabase.auth.token') || '{}');
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const headers = { 'Authorization': `Bearer ${token}` };

            const [statsRes, healthRes, activitiesRes] = await Promise.all([
                fetch(`${apiBase}/api/dashboard/stats`, { headers }),
                fetch(`${apiBase}/health`),
                fetch(`${apiBase}/api/dashboard/activities`, { headers })
            ]);

            const statsData = await statsRes.json();
            const healthData = await healthRes.json();
            const activitiesData = await activitiesRes.json();

            setStats(statsData);
            setHealth(healthData);
            setActivities(activitiesData);
        } catch (err) {
            console.error('Error fetching dashboard data:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center p-8">
            <div className="text-center">
                <Activity className="w-12 h-12 text-blue-600 animate-pulse mx-auto mb-4" />
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest animate-pulse">Initializing Control Center...</h2>
            </div>
        </div>
    );

    const chartData = [
        { name: 'Risk Score', value: stats?.avgRiskScore || 0 },
        { name: 'Healthy', value: 100 - (stats?.avgRiskScore || 0) }
    ];

    const COLORS = ['#ef4444', '#22c55e'];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 p-8 text-slate-900 dark:text-white">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-100">
                            <Activity className="w-8 h-8 text-white" />
                        </div>
                        <h1 className="text-3xl font-black tracking-tighter italic uppercase">DevOps Control Center</h1>
                    </div>
                    <button onClick={fetchAllData} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl hover:bg-slate-50 dark:bg-slate-800/50 transition-all text-slate-400 hover:text-blue-600">
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatCard
                        title="Avg Risk Score"
                        value={`${stats?.avgRiskScore || 0}%`}
                        icon={<Shield className="w-5 h-5" />}
                        color="text-red-600"
                    />
                    <StatCard
                        title="Vulnerabilities"
                        value={stats?.totalVulns || 0}
                        icon={<AlertTriangle className="w-5 h-5" />}
                        color="text-amber-600"
                    />
                    <StatCard
                        title="Open Tasks"
                        value={stats?.openTasks || 0}
                        icon={<Layout className="w-5 h-5" />}
                        color="text-blue-600"
                    />
                    <StatCard
                        title="Protected Repos"
                        value={stats?.totalRepos || 0}
                        icon={<Github className="w-5 h-5" />}
                        color="text-emerald-600"
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Main Content Areas */}
                    <div className="lg:col-span-3 space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Risk Distribution */}
                            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 group hover:border-blue-200 transition-all">
                                <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-6 italic">Risk Profile</h2>
                                <div className="h-64 relative">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={chartData}
                                                innerRadius={70}
                                                outerRadius={90}
                                                paddingAngle={5}
                                                dataKey="value"
                                                stroke="none"
                                            >
                                                {chartData.map((_entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                        <span className="text-5xl font-black tracking-tighter italic text-slate-900 dark:text-white">{stats?.avgRiskScore}%</span>
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Aggregate</span>
                                    </div>
                                </div>
                                <div className="mt-8 pt-6 border-t border-slate-50 flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-red-500" />
                                        <span className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">At Risk</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                        <span className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">Hardened</span>
                                    </div>
                                </div>
                            </div>

                            {/* Placeholder for Scan Trends */}
                            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center text-slate-300 min-h-[350px] group hover:border-blue-200 transition-all">
                                <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-auto w-full italic">Scan Ingestion</h2>
                                <div className="flex flex-col items-center justify-center flex-1">
                                    <div className="relative mb-6">
                                        <BarChart3 className="w-20 h-20 opacity-10 group-hover:scale-110 transition-transform duration-500" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Zap className="w-8 h-8 text-blue-100 animate-pulse" />
                                        </div>
                                    </div>
                                    <span className="font-black uppercase tracking-widest text-[10px] text-slate-400 italic">Streaming Intelligence...</span>
                                </div>
                            </div>
                        </div>

                        {/* Summary Card */}
                        <div className="bg-white dark:bg-slate-900 p-10 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden group">
                            <h2 className="text-sm font-black uppercase tracking-widest mb-6 italic text-slate-400">Intelligence Narrative</h2>
                            <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-bold text-lg tracking-tight relative z-10">
                                Global systems report an average risk posture of <span className="text-red-600">{stats?.avgRiskScore}%</span>.
                                Secure deployment protocol is <span className="text-emerald-600">Active</span> across {stats?.totalRepos} endpoints.
                                <span className="text-blue-600"> {stats?.openTasks} remediation tasks</span> are currently queued for architectural review.
                            </p>
                            <Shield className="absolute -right-12 -bottom-12 w-64 h-64 text-slate-50 opacity-50 group-hover:scale-110 transition-transform duration-[2s]" />
                        </div>
                    </div>

                    {/* Right Side Panel */}
                    <div className="lg:col-span-1 space-y-8">
                        <SystemStatus health={health} />
                        <ActivityFeed activities={activities} />
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value, icon, color }: { title: string, value: any, icon: any, color: string }) {
    return (
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-700 hover:border-blue-200 transition-all group">
            <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">{title}</span>
                <div className={`${color} bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl group-hover:bg-blue-50 transition-colors`}>{icon}</div>
            </div>
            <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter italic">{value}</div>
        </div>
    );
}

function SystemStatus({ health }: { health: HealthStatus | null }) {
    const services = [
        { label: "API Gateway", status: health?.services?.gateway || "Connecting", icon: <Activity className="w-4 h-4" /> },
        { label: "Database", status: health?.services?.database || "Connecting", icon: <Database className="w-4 h-4" /> },
        { label: "Email Engine", status: health?.services?.email || "Connecting", icon: <Mail className="w-4 h-4" /> },
    ];

    const getStatusStyles = (status: string) => {
        switch (status.toLowerCase()) {
            case 'healthy':
            case 'active':
                return 'text-emerald-500';
            case 'disconnected':
            case 'error':
                return 'text-red-500';
            default:
                return 'text-blue-500';
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-8 italic">Internal Health</h2>
            <div className="space-y-6">
                {services.map((item) => (
                    <div key={item.label} className="flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                            <div className="text-slate-200 group-hover:text-blue-600 transition-colors">{item.icon}</div>
                            <span className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">{item.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black uppercase tracking-widest ${getStatusStyles(item.status)}`}>{item.status}</span>
                            <div className={`w-1.5 h-1.5 rounded-full ${getStatusStyles(item.status).replace('text-', 'bg-')} animate-pulse`} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ActivityFeed({ activities }: { activities: ActivityItem[] }) {
    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        const now = new Date();
        const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diffSeconds < 60) return 'Just Now';
        if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
        if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden relative">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-8 italic">Intelligence Log</h2>
            <div className="space-y-8 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar relative">
                {activities.length === 0 ? (
                    <div className="text-center py-10">
                        <Clock className="w-8 h-8 text-slate-100 mx-auto mb-2" />
                        <p className="text-[10px] font-black text-slate-400 uppercase italic">Awaiting signals...</p>
                    </div>
                ) : (
                    activities.map((activity, idx) => (
                        <div key={activity.id} className="flex gap-5 relative group">
                            {idx !== activities.length - 1 && (
                                <div className="absolute left-2.5 top-8 bottom-[-2rem] w-px bg-slate-50 dark:bg-slate-800/50" />
                            )}
                            <div className="relative z-10 mt-1">
                                <div className={`w-5 h-5 rounded-full border-4 border-white shadow-sm transition-colors ${activity.type === 'success' ? 'bg-emerald-500' :
                                    activity.type === 'warning' ? 'bg-amber-500' :
                                        activity.type === 'error' ? 'bg-red-500' : 'bg-blue-600'
                                    }`} />
                            </div>
                            <div className="flex-1">
                                <p className="text-[11px] font-black text-slate-800 leading-normal uppercase tracking-tight group-hover:text-blue-600 transition-colors italic">{activity.text}</p>
                                <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-1.5 inline-block opacity-70">{formatTime(activity.time)}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}



