import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    Clock, Shield, User as UserIcon, Activity, 
    Filter, Search, ArrowDown, ChevronRight, 
    Loader2, AlertCircle, CheckCircle, FileText, 
    Lock, Terminal, Play, Save, RefreshCw, AlertTriangle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

interface AuditEntry {
    $id: string;
    action: string;
    details: string;
    user_id: string;
    repo_id: string;
    created_at: string;
}

export default function AuditLog() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [logs, setLogs] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterAction, setFilterAction] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        console.log('[AuditLog] Component mounted');
        fetchLogs();
    }, []);

    const fetchLogs = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/audit`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            
            const data = await res.json();
            setLogs(Array.isArray(data) ? data : []);
            console.log(`[AuditLog] Successfully fetched ${data?.length || 0} logs`);
        } catch (err: any) {
            console.error('[AuditLog] Fetch error:', err.message);
            setError(err.message);
            toast.error('Failed to synchronize audit ledger');
        } finally {
            setLoading(false);
        }
    };

    const getActionIcon = (action: string) => {
        switch (action) {
            case 'SCAN_STARTED': return <Play size={16} className="text-blue-500" />;
            case 'SCAN_COMPLETED': return <CheckCircle size={16} className="text-green-500" />;
            case 'GATE_CHECK': return <Shield size={16} className="text-purple-500" />;
            case 'REPORT_EXPORTED': return <FileText size={16} className="text-orange-500" />;
            case 'FINDING_RESOLVED': return <CheckCircle size={16} className="text-emerald-500" />;
            default: return <Activity size={16} className="text-[var(--accent-primary)]" />;
        }
    };

    const getActionBadge = (action: string) => {
        const style = "px-2 py-0.5 rounded text-[8px] font-black uppercase italic border";
        switch (action) {
            case 'SCAN_STARTED': return <span className={`${style} bg-blue-500/10 text-blue-500 border-blue-500/20`}>Scan Init</span>;
            case 'SCAN_COMPLETED': return <span className={`${style} bg-green-500/10 text-green-500 border-green-500/20`}>Scan Done</span>;
            case 'GATE_CHECK': return <span className={`${style} bg-purple-500/10 text-purple-500 border-purple-500/20`}>Gate Probe</span>;
            case 'REPORT_EXPORTED': return <span className={`${style} bg-orange-500/10 text-orange-500 border-orange-500/20`}>Data Export</span>;
            case 'FINDING_RESOLVED': return <span className={`${style} bg-emerald-500/10 text-emerald-500 border-emerald-500/20`}>Remediated</span>;
            default: return <span className={`${style} bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border-[var(--accent-primary)]/20`}>{action}</span>;
        }
    };

    const filteredLogs = logs.filter(log => {
        if (!log) return false;
        if (filterAction !== 'all' && log.action !== filterAction) return false;
        if (searchQuery && !log.details?.toLowerCase().includes(searchQuery.toLowerCase()) && !log.action?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    try {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
                        <div>
                            <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Audit Ledger</h1>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Immutable trace of security orchestration events</p>
                        </div>

                        <div className="flex gap-4">
                            <div className="premium-card px-6 py-3 flex items-center gap-6">
                                <div className="text-center">
                                    <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase italic">Total Events</p>
                                    <p className="text-xl font-black text-[var(--text-primary)] italic">{logs.length}</p>
                                </div>
                                <div className="w-px h-8 bg-[var(--border-subtle)]" />
                                <div className="text-center">
                                    <p className="text-[8px] font-black text-[var(--accent-primary)] uppercase italic">Integrity</p>
                                    <p className="text-xs font-black text-[var(--status-success)] italic uppercase tracking-widest mt-1">Verified</p>
                                </div>
                            </div>
                            <button onClick={fetchLogs} className="p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors">
                                <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="premium-card p-4 mb-8 flex flex-wrap items-center gap-4">
                        <div className="flex-1 min-w-[300px] relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={16} />
                            <input 
                                type="text" 
                                placeholder="Search in ledger details..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-12 pr-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-black italic outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)]"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <Filter size={14} className="text-[var(--text-secondary)]" />
                            <select 
                                value={filterAction}
                                onChange={(e) => setFilterAction(e.target.value)}
                                className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none"
                            >
                                <option value="all">All Actions</option>
                                <option value="SCAN_STARTED">Scan Initiated</option>
                                <option value="SCAN_COMPLETED">Scan Completed</option>
                                <option value="GATE_CHECK">Gate Probe</option>
                                <option value="REPORT_EXPORTED">Data Export</option>
                                <option value="FINDING_RESOLVED">Remediation</option>
                            </select>
                        </div>
                    </div>

                    {/* Log Table */}
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-24">
                            <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
                            <p className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] italic">Accessing Decrypted Ledger...</p>
                        </div>
                    ) : error ? (
                        <div className="premium-card p-24 text-center border-red-500/20">
                            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-6 opacity-40" />
                            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">Ledger Synchronization Failed</h3>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-2">{error}</p>
                            <button onClick={fetchLogs} className="mt-6 btn-premium">Retry Protocol</button>
                        </div>
                    ) : filteredLogs.length === 0 ? (
                        <div className="premium-card p-24 text-center">
                            <Terminal className="w-16 h-16 text-[var(--text-secondary)] mx-auto mb-6 opacity-20" />
                            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">Ledger Empty</h3>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-2">No security events recorded in the current timeframe</p>
                        </div>
                    ) : (
                        <div className="premium-card overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/50">
                                            <th className="px-6 py-4 text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic">Timestamp</th>
                                            <th className="px-6 py-4 text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic">Action Vector</th>
                                            <th className="px-6 py-4 text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic">Event Intelligence</th>
                                            <th className="px-6 py-4 text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic">Resource ID</th>
                                            <th className="px-6 py-4 text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic text-right">Verification</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border-subtle)]">
                                        {filteredLogs.map((log) => (
                                            <tr key={log.$id} className="hover:bg-[var(--bg-secondary)]/50 transition-colors group">
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <span className="text-[11px] font-black text-[var(--text-primary)] italic">
                                                            {log.created_at ? new Date(log.created_at).toLocaleTimeString() : 'N/A'}
                                                        </span>
                                                        <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">
                                                            {log.created_at ? new Date(log.created_at).toLocaleDateString() : 'N/A'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] flex items-center justify-center">
                                                            {getActionIcon(log.action)}
                                                        </div>
                                                        {getActionBadge(log.action)}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <p className="text-[11px] font-black text-[var(--text-primary)] uppercase italic leading-relaxed">
                                                        {log.details || 'No detail available'}
                                                    </p>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2 font-mono text-[9px] text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)] px-2 py-1 rounded-lg w-fit">
                                                        <Lock size={10} className="opacity-40" />
                                                        {log.repo_id ? `${log.repo_id.slice(0, 12)}...` : 'N/A'}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <button className="p-2 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors opacity-0 group-hover:opacity-100">
                                                        <ChevronRight size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    } catch (renderError: any) {
        console.error('[AuditLog] Render crash:', renderError);
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-red-500 font-black uppercase italic p-8 text-center">
                Critical Render Failure in Audit Ledger Module.<br/>Check Console for Trace.
            </div>
        );
    }
}
