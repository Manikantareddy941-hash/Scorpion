import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
    Bell, ShieldAlert, CheckCircle, Info, Filter, Calendar,
    Activity, Clock, ShieldCheck, ArrowRight, Share2
} from 'lucide-react';

interface Notification {
    id: string;
    event_type: string;
    repo_id: string;
    created_at: string;
    details: any;
    repo_name?: string;
}

export default function Alerts() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'critical' | 'completion'>('all');

    useEffect(() => {
        fetchNotifications();
    }, []);

    const fetchNotifications = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('notifications')
                .select('*, repositories(name)')
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;

            const formatted = data.map((n: any) => ({
                ...n,
                repo_name: n.repositories?.name || 'Unknown'
            }));

            setNotifications(formatted);
        } catch (error) {
            console.error('Error fetching notifications:', error);
        } finally {
            setLoading(false);
        }
    };

    const getEventIcon = (type: string) => {
        if (type.includes('critical')) return <ShieldAlert className="w-5 h-5 text-rose-500" />;
        if (type.includes('completed')) return <CheckCircle className="w-5 h-5 text-emerald-500" />;
        return <Info className="w-5 h-5 text-blue-500" />;
    };

    const getEventTagColor = (type: string) => {
        if (type.includes('critical')) return 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 border-rose-100 dark:border-rose-500/20';
        if (type.includes('completed')) return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 border-emerald-100 dark:border-emerald-500/20';
        return 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 border-blue-100 dark:border-blue-500/20';
    };

    const filteredAlerts = notifications.filter(n => {
        if (filter === 'all') return true;
        if (filter === 'critical') return n.event_type.includes('critical');
        if (filter === 'completion') return n.event_type.includes('completed');
        return true;
    });

    if (loading && notifications.length === 0) {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Bell className="w-12 h-12 text-blue-600 animate-pulse" />
                    <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse italic">Interrogating Logs...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] transition-colors duration-300">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-500/20">
                            <Bell className="w-7 h-7" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic">Alerts Center</h1>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1 italic font-mono">Real-time system health & vector events</p>
                        </div>
                    </div>

                    <div className="flex gap-4 w-full md:w-auto">
                        <div className="relative flex-grow md:flex-grow-0">
                            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <select
                                value={filter}
                                onChange={(e) => setFilter(e.target.value as any)}
                                className="pl-12 pr-10 py-3.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl outline-none focus:ring-4 focus:ring-blue-600/10 transition-all font-black text-[10px] uppercase tracking-widest italic appearance-none"
                            >
                                <option value="all">Global Matrix</option>
                                <option value="critical">Critical Vectors</option>
                                <option value="completion">Scan Reports</option>
                            </select>
                        </div>
                        <button
                            onClick={fetchNotifications}
                            className="p-3.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl hover:bg-[var(--bg-primary)] transition-all text-slate-400 hover:text-blue-600"
                        >
                            <Activity className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {filteredAlerts.length === 0 ? (
                    <div className="premium-card p-24 text-center flex flex-col items-center">
                        <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 rounded-[2rem] flex items-center justify-center mb-6 border border-slate-100 dark:border-slate-800 dark:border-slate-800">
                            <ShieldCheck className="w-10 h-10 text-slate-200 dark:text-slate-700" />
                        </div>
                        <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase italic tracking-tight mb-2">Systems Nominal</h2>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">No anomalous patterns detected in current filter range.</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {filteredAlerts.map((n) => (
                            <div
                                key={n.id}
                                className="premium-card p-8 group hover:border-blue-600/50 transition-all animate-in slide-in-from-bottom-2 duration-300"
                            >
                                <div className="flex flex-col md:flex-row items-start gap-8">
                                    <div className={`p-4 rounded-2xl border transition-transform group-hover:scale-110 shadow-sm ${getEventTagColor(n.event_type)}`}>
                                        {getEventIcon(n.event_type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-3 mb-4">
                                            <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-[0.15em] italic border ${getEventTagColor(n.event_type)}`}>
                                                {n.event_type.replace(/_/g, ' ')}
                                            </span>
                                            <div className="h-3 w-px bg-slate-200 dark:bg-slate-800" />
                                            <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest italic flex items-center gap-1.5">
                                                <Activity className="w-3 h-3" /> {n.repo_name}
                                            </span>
                                        </div>
                                        <h3 className="text-slate-900 dark:text-white font-black text-xl mb-4 leading-tight uppercase italic tracking-tight group-hover:text-blue-600 transition-colors">
                                            {n.details?.message || `Tactical security update for repo: ${n.repo_name}`}
                                        </h3>
                                        <div className="flex flex-wrap items-center gap-8 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest italic">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="w-3.5 h-3.5 text-slate-300 dark:text-slate-700" />
                                                {new Date(n.created_at).toLocaleDateString()}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Clock className="w-3.5 h-3.5 text-slate-300 dark:text-slate-700" />
                                                {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 w-full md:w-auto mt-4 md:mt-0 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                        <button className="flex-1 md:flex-none px-6 py-3 bg-[var(--bg-secondary)] text-blue-600 border border-blue-200 dark:border-slate-800 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all shadow-lg shadow-blue-500/5 group/btn flex items-center justify-center gap-2">
                                            Telemetry <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                                        </button>
                                        <button className="p-3 bg-[var(--bg-secondary)] text-slate-400 hover:text-blue-600 border border-[var(--border-subtle)] rounded-2xl hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 transition-all">
                                            <Share2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="mt-16 text-center">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] italic">Telemetry Stream End &bull; Secure Protocol Active</p>
                </div>
            </div>
        </div>
    );
}



