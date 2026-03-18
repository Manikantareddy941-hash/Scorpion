import { useEffect, useState } from 'react';
import { databases, DB_ID, Query, COLLECTIONS } from '../lib/appwrite';
import {
    Bell, ShieldAlert, CheckCircle, Info, Filter, Calendar,
    Activity, Clock, ShieldCheck, ArrowRight, Share2
} from 'lucide-react';

interface Notification {
    $id: string;
    event_type: string;
    repo_id: string;
    $createdAt: string;
    details: string; // Appwrite might return string if JSON isn't parsed or object
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
            const response = await databases.listDocuments(
                DB_ID,
                COLLECTIONS.NOTIFICATIONS || 'notifications',
                [Query.orderDesc('$createdAt'), Query.limit(50)]
            );

            const data = response.documents as unknown as Notification[];
            
            // Resolve repo names (Optional: could be optimized with a join or cache)
            const repoIds = [...new Set(data.map(n => n.repo_id))].filter(Boolean);
            const reposResponse = await databases.listDocuments(
                DB_ID,
                COLLECTIONS.REPOSITORIES || 'repositories',
                repoIds.length > 0 ? [Query.equal('$id', repoIds)] : []
            );
            
            const repoMap = new Map(reposResponse.documents.map(r => [r.$id, r.name]));

            const formatted = data.map((n) => ({
                ...n,
                repo_name: repoMap.get(n.repo_id) || 'Unknown',
                details: typeof n.details === 'string' ? JSON.parse(n.details) : n.details
            }));

            setNotifications(formatted);
        } catch (error) {
            console.error('Error fetching notifications:', error);
        } finally {
            setLoading(false);
        }
    };

    const getEventIcon = (type: string) => {
        if (type.includes('critical')) return <ShieldAlert className="w-5 h-5 text-[var(--status-error)]" />;
        if (type.includes('completed')) return <CheckCircle className="w-5 h-5 text-[var(--status-success)]" />;
        return <Info className="w-5 h-5 text-[var(--accent-primary)]" />;
    };

    const getEventTagColor = (type: string) => {
        if (type.includes('critical')) return 'bg-[var(--status-error)]/5 text-[var(--status-error)] border-[var(--status-error)]/20';
        if (type.includes('completed')) return 'bg-[var(--status-success)]/5 text-[var(--status-success)] border-[var(--status-success)]/20';
        return 'bg-[var(--accent-primary)]/5 text-[var(--accent-primary)] border-[var(--accent-primary)]/20';
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
                    <Bell className="w-12 h-12 text-[var(--accent-primary)] animate-pulse" />
                    <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic">Interrogating Logs...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] transition-colors duration-300">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
                            <Bell className="w-7 h-7" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tighter uppercase italic">Alerts Center</h1>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">Real-time system health & vector events</p>
                        </div>
                    </div>

                    <div className="flex gap-4 w-full md:w-auto">
                        <div className="relative flex-grow md:flex-grow-0">
                            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
                            <select
                                value={filter}
                                onChange={(e) => setFilter(e.target.value as any)}
                                className="pl-12 pr-10 py-3.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/10 transition-all font-black text-[10px] uppercase tracking-widest italic appearance-none text-[var(--text-primary)]"
                            >
                                <option value="all">Global Matrix</option>
                                <option value="critical">Critical Vectors</option>
                                <option value="completion">Scan Reports</option>
                            </select>
                        </div>
                        <button
                            onClick={fetchNotifications}
                            className="p-3.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl hover:bg-[var(--bg-primary)] transition-all text-[var(--text-secondary)] hover:text-[var(--accent-primary)]"
                        >
                            <Activity className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {filteredAlerts.length === 0 ? (
                    <div className="premium-card p-24 text-center flex flex-col items-center">
                        <div className="w-20 h-20 bg-[var(--bg-secondary)] rounded-[2rem] flex items-center justify-center mb-6 border border-[var(--border-subtle)]">
                            <ShieldCheck className="w-10 h-10 text-[var(--text-secondary)] opacity-20" />
                        </div>
                        <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight mb-2">Systems Nominal</h2>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic">No anomalous patterns detected in current filter range.</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {filteredAlerts.map((n) => (
                            <div
                                key={n.$id}
                                className="premium-card p-8 group hover:border-[var(--accent-primary)]/50 transition-all animate-in slide-in-from-bottom-2 duration-300"
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
                                            <div className="h-3 w-px bg-[var(--border-subtle)]" />
                                            <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic flex items-center gap-1.5">
                                                <Activity className="w-3 h-3" /> {n.repo_name}
                                            </span>
                                        </div>
                                        <h3 className="text-[var(--text-primary)] font-black text-xl mb-4 leading-tight uppercase italic tracking-tight group-hover:text-[var(--accent-primary)] transition-colors">
                                            {(n.details as any)?.message || `Tactical security update for repo: ${n.repo_name}`}
                                        </h3>
                                        <div className="flex flex-wrap items-center gap-8 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="w-3.5 h-3.5 opacity-50" />
                                                {new Date(n.$createdAt).toLocaleDateString()}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Clock className="w-3.5 h-3.5 opacity-50" />
                                                {new Date(n.$createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 w-full md:w-auto mt-4 md:mt-0 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                        <button className="flex-1 md:flex-none px-6 py-3 bg-[var(--bg-secondary)] text-[var(--accent-primary)] border border-[var(--border-subtle)] rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-[var(--accent-primary)] hover:text-white transition-all shadow-lg shadow-[var(--accent-primary)]/5 group/btn flex items-center justify-center gap-2">
                                            Telemetry <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                                        </button>
                                        <button className="p-3 bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] border border-[var(--border-subtle)] rounded-2xl transition-all">
                                            <Share2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="mt-16 text-center">
                    <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.3em] italic">Telemetry Stream End &bull; Secure Protocol Active</p>
                </div>
            </div>
        </div>
    );
}
