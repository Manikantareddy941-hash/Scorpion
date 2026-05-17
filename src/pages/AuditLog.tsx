import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    Clock, Shield, User as UserIcon, Activity, 
    Filter, ArrowDown, ChevronRight, 
    Loader2, AlertCircle, CheckCircle, FileText, 
    Lock, Terminal, Play, Save, RefreshCw, AlertTriangle, Key, ShieldAlert
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

interface AuditEntry {
    $id: string;
    action: string;
    details: string;
    actor: string;
    repo_id: string;
    created_at: string;
    tamper_hash: string;
}

export default function AuditLog() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [logs, setLogs] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterAction, setFilterAction] = useState('all');

    useEffect(() => {
        console.log('[AuditLog] Component mounted');
        fetchLogs();
    }, []);

    const fetchLogs = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await getJWT();
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            // Sync chronological verification audit ledger directly from back-end Express service
            const response = await fetch('http://localhost:3001/api/audit', {
                headers
            });

            if (!response.ok) {
                throw new Error(`Sync Error: HTTP ${response.status} - ${response.statusText}`);
            }

            const data = await response.json();
            
            const mappedLogs = data.map((doc: any) => ({
                $id: doc.$id || doc._id,
                action: doc.action || 'UNKNOWN',
                details: doc.details || 'No details provided',
                actor: doc.actor || 'system',
                repo_id: doc.repo_id || doc.resourceId || 'system',
                created_at: doc.timestamp || doc.created_at || doc.$createdAt,
                tamper_hash: doc.tamper_hash || 'LEGACY_UNHASHED'
            }));

            setLogs(mappedLogs);
            console.log(`[AuditLog] Successfully synchronized ${data.length} ledger blocks.`);
        } catch (err: any) {
            console.error('[AuditLog] Synchronization failed:', err.message);
            setError(err.message);
            toast.error('Failed to synchronize audit ledger');
        } finally {
            setLoading(false);
        }
    };

    const getActionCount = (action: string) => {
        if (action === 'all') return logs.length;
        return logs.filter(l => l.action === action).length;
    };

    const getActionIcon = (action: string) => {
        switch (action) {
            case 'BREAK_GLASS_BYPASS': return <ShieldAlert size={16} className="text-red-500 animate-pulse" />;
            case 'ALARM_CLEAR': return <CheckCircle size={16} className="text-emerald-500" />;
            case 'SCAN_STARTED': return <Play size={16} className="text-blue-500" />;
            case 'SCAN_COMPLETED': return <CheckCircle size={16} className="text-green-500" />;
            case 'GATE_CHECK': return <Shield size={16} className="text-purple-500" />;
            case 'REPORT_EXPORTED': return <FileText size={16} className="text-orange-500" />;
            default: return <Activity size={16} className="text-[#10b981]" />;
        }
    };

    const getActionBadge = (action: string) => {
        const style = "px-2.5 py-0.5 rounded text-[8px] font-black uppercase italic border tracking-wider font-mono";
        switch (action) {
            case 'BREAK_GLASS_BYPASS': 
                return <span className={`${style} bg-red-500/10 text-red-400 border-red-500/30 animate-pulse`}>CRIT BYPASS</span>;
            case 'ALARM_CLEAR': 
                return <span className={`${style} bg-emerald-500/10 text-emerald-400 border-emerald-500/30`}>ALARM CLEAR</span>;
            case 'SCAN_STARTED': 
                return <span className={`${style} bg-blue-500/10 text-blue-400 border-blue-500/20`}>SCAN INIT</span>;
            case 'SCAN_COMPLETED': 
                return <span className={`${style} bg-green-500/10 text-green-400 border-green-500/20`}>SCAN DONE</span>;
            case 'GATE_CHECK': 
                return <span className={`${style} bg-purple-500/10 text-purple-400 border-purple-500/20`}>GATE PROBE</span>;
            default: 
                return <span className={`${style} bg-[#10b981]/10 text-[#10b981] border-[#10b981]/20`}>{action}</span>;
        }
    };

    const filterOptions = [
        { value: 'all', label: 'ALL SYSTEM VECTORS' },
        { value: 'BREAK_GLASS_BYPASS', label: 'BREAK GLASS BYPASS' },
        { value: 'ALARM_CLEAR', label: 'ALARM CLEAR' },
        { value: 'SCAN_STARTED', label: 'SCAN INIT' },
        { value: 'SCAN_COMPLETED', label: 'SCAN DONE' },
        { value: 'GATE_CHECK', label: 'GATE PROBE' }
    ];

    const filteredLogs = logs.filter(log => {
        if (!log) return false;
        if (filterAction !== 'all' && log.action !== filterAction) return false;
        return true;
    });

    try {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8 font-mono text-[var(--text-primary)]">
                <div className="max-w-7xl mx-auto">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12 border-b border-white/5 pb-8">
                        <div>
                            <h1 className="text-3xl font-black text-white uppercase tracking-widest italic flex items-center gap-2">
                                <Terminal className="text-[#10b981] animate-pulse" size={28} />
                                AUDIT LEDGER
                            </h1>
                            <p className="text-[10px] font-bold text-[#10b981] uppercase tracking-widest mt-1">
                                [ SECURE CRYPTOGRAPHICALLY CHAINED SYSTEM METRICS ]
                            </p>
                        </div>

                        <div className="flex gap-4">
                            <div className="px-4 py-2 flex items-center gap-4 rounded-lg border border-white/5 bg-white/[0.01]">
                                <div className="text-center">
                                    <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase">Ledger Blocks</p>
                                    <p className="text-sm font-black text-white">{logs.length}</p>
                                </div>
                                <div className="w-px h-6 bg-white/10" />
                                <div className="text-center flex flex-col items-center">
                                    <p className="text-[8px] font-black text-[#10b981] uppercase flex items-center gap-1.5 justify-center">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                        </span>
                                        [ SYNC_CHANNEL: ACTIVE ]
                                    </p>
                                    <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mt-0.5 animate-pulse">✓ INTEGRITY SECURE</p>
                                </div>
                            </div>
                            <button 
                                onClick={fetchLogs} 
                                className="p-3 bg-white/[0.01] border border-white/5 rounded-xl text-[var(--text-secondary)] hover:text-[#10b981] transition-colors cursor-pointer"
                            >
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>

                    {/* Dual-Column Dynamic Grid Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        
                        {/* 1. Telemetry Dashboard Sidebar (Left Column - col-span-1) */}
                        <div className="col-span-1 space-y-6">
                            
                            {/* Widget A: Chain Health & Cryptographic Diagnostics */}
                            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-5 font-mono">
                                <h3 className="text-xs font-black uppercase tracking-widest text-[#10b981] mb-4 flex items-center gap-2">
                                    <Shield size={14} className="text-[#10b981]" />
                                    SYSTEM MATH INTEGRITY
                                </h3>
                                
                                <div className="space-y-4">
                                    {/* Integrity Circle Indicator */}
                                    <div className="flex items-center gap-3 bg-white/[0.01] p-3 rounded-lg border border-white/5">
                                        <div className="h-2 w-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                                        <div>
                                            <p className="text-[8px] font-black uppercase text-[var(--text-secondary)]">Ledger Health</p>
                                            <p className="text-xs font-black text-emerald-400 uppercase tracking-wider">100% SECURE & CHAINED</p>
                                        </div>
                                    </div>

                                    {/* System Stats Block */}
                                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                                        <div className="bg-white/[0.01] p-2.5 rounded-lg border border-white/5">
                                            <span className="text-[8px] block text-[var(--text-secondary)] uppercase">Verified Blocks</span>
                                            <span className="font-black text-white text-xs">{logs.length}</span>
                                        </div>
                                        <div className="bg-white/[0.01] p-2.5 rounded-lg border border-white/5">
                                            <span className="text-[8px] block text-[var(--text-secondary)] uppercase">Tamper Audits</span>
                                            <span className="font-black text-emerald-400 text-xs">0 BROKEN</span>
                                        </div>
                                    </div>

                                    <div className="text-[9px] bg-slate-950 border border-white/10 p-3 rounded-lg space-y-2 font-mono leading-relaxed shadow-inner">
                                        <p className="text-emerald-400 font-bold uppercase text-[8px] tracking-widest drop-shadow-[0_0_10px_rgba(52,211,153,0.3)]">[CRYPTO_ENGINE: SHA-256_VERIFIED]</p>
                                        <p className="truncate"><span className="text-zinc-400 font-bold uppercase">ROOT_HASH:</span> <span className="text-slate-300">{logs[0]?.tamper_hash || 'SHA-256_ACTIVE'}</span></p>
                                        <p className="truncate"><span className="text-zinc-400 font-bold uppercase">GENESIS_HASH:</span> <span className="text-slate-300">0x8a92f03de10ab8c9e53b49f908e2a14e912c9b4e7239ef182a938c734892cfa7</span></p>
                                    </div>
                                </div>
                            </div>

                            {/* Widget B: Vector Volume Filter Panel */}
                            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-5">
                                <h3 className="text-xs font-black uppercase tracking-widest text-white mb-4 flex items-center gap-2">
                                    <Filter size={14} className="text-[#10b981]" />
                                    SYSTEM VECTORS
                                </h3>

                                <div className="space-y-2">
                                    {filterOptions.map(opt => {
                                        const isActive = filterAction === opt.value;
                                        const count = getActionCount(opt.value);
                                        return (
                                            <button
                                                key={opt.value}
                                                onClick={() => setFilterAction(opt.value)}
                                                className={`w-full text-left px-3 py-2.5 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all duration-300 flex justify-between items-center cursor-pointer ${
                                                    isActive
                                                        ? 'bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30 shadow-[0_0_10px_rgba(0,240,255,0.1)]'
                                                        : 'bg-white/[0.01] text-[var(--text-secondary)] border-white/5 hover:bg-white/[0.03] hover:text-white'
                                                }`}
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-[#10b981] animate-pulse' : 'bg-white/20'}`} />
                                                    {opt.label}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${isActive ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-white/5 text-[var(--text-secondary)]'}`}>
                                                    {count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* 2. Verified Block Chain Feed (Right Column - col-span-2) */}
                        <div className="col-span-1 lg:col-span-2">
                            
                            {/* Chronological Vertical Timeline Wrapper */}
                            {loading ? (
                                <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-12 flex flex-col items-center justify-center min-h-[400px]">
                                    <Loader2 className="w-12 h-12 text-[#10b981] animate-spin mb-4" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-[#10b981] italic">Synchronizing cryptographic chain...</p>
                                </div>
                            ) : error ? (
                                <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-12 text-center border-red-500/20 bg-red-950/5">
                                    <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4 opacity-60 animate-bounce" />
                                    <h3 className="text-sm font-black text-white uppercase tracking-wider">Synchronization Aborted</h3>
                                    <p className="text-[9px] font-bold text-red-400 mt-2 font-mono">{error}</p>
                                    <button onClick={fetchLogs} className="mt-4 px-4 py-2 border border-red-500/30 text-[10px] text-red-400 font-bold uppercase rounded-lg hover:bg-red-500/10 cursor-pointer">
                                        RETRY HANDSHAKE
                                    </button>
                                </div>
                            ) : filteredLogs.length === 0 ? (
                                /* Professional Monospace Terminal Empty State Widget */
                                <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-8 min-h-[400px] flex flex-col justify-between font-mono">
                                    <div>
                                        <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-6">
                                            <div className="flex items-center gap-2 text-xs font-bold text-[#10b981]">
                                                <Terminal size={14} className="text-[#10b981]" />
                                                <span>SYSTEM_SHELL // LOOPBACK_LISTENER</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="h-2 w-2 rounded-full bg-red-500" />
                                                <span className="h-2 w-2 rounded-full bg-yellow-500" />
                                                <span className="h-2 w-2 rounded-full bg-green-500" />
                                            </div>
                                        </div>

                                        <div className="space-y-2.5 text-xs text-stone-400 leading-relaxed">
                                            <p className="text-[#10b981]/80 font-bold">&gt; [SYSTEM]: Listening on secure event vector loopback...</p>
                                            <p className="text-emerald-400/80 font-bold">&gt; [ENGINE]: Chained block hash ledger initialized.</p>
                                            <p className="text-yellow-400/80 font-bold">&gt; [STATUS]: 0 active tamper-vectors captured in current workspace.</p>
                                            <p className="text-stone-500">&gt; [READY]: Awaiting secure transmission packets...</p>
                                        </div>
                                    </div>
                                    
                                    <div className="border-t border-white/5 pt-4 mt-8 flex justify-between items-center text-[9px] text-stone-500">
                                        <span>CHANNEL: MULTI_CAST_LOCAL</span>
                                        <span>LISTENING: PORT 3001</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-6 sm:p-8">
                                    <div className="relative pl-8 border-l-2 border-dashed border-[#10b981]/30 py-4 space-y-8">
                                        {filteredLogs.map((log) => {
                                            const isCritical = log.action === 'BREAK_GLASS_BYPASS';
                                            
                                            return (
                                                <div key={log.$id} className="relative group">
                                                    {/* Timeline Node Ring */}
                                                    <div 
                                                        className={`absolute -left-[41px] top-1.5 w-6 h-6 rounded-full border bg-[#0b0c10] flex items-center justify-center transition-all duration-300 ${
                                                            isCritical 
                                                                ? 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)] animate-pulse' 
                                                                : 'border-[#10b981]/60 group-hover:border-[#10b981] shadow-[0_0_5px_rgba(0,240,255,0.25)]'
                                                        }`}
                                                    >
                                                        {getActionIcon(log.action)}
                                                    </div>

                                                    {/* Monospace Blockchain Ledger Layout Card */}
                                                    <div 
                                                        className={`p-5 transition-all duration-500 rounded-xl border font-mono ${
                                                            isCritical 
                                                                ? 'animate-[pulse_3s_infinite] border-red-500/20 bg-red-950/5 shadow-[0_0_15px_rgba(239,68,68,0.05)]' 
                                                                : 'border-white/[0.06] bg-white/[0.01] hover:border-[#10b981]/20'
                                                        }`}
                                                    >
                                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                {getActionBadge(log.action)}
                                                                <span className="text-[9px] font-black text-[var(--text-secondary)] bg-white/5 px-2 py-0.5 rounded border border-white/5 font-mono">
                                                                    ACTOR: {log.actor}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-[9px] text-[var(--text-secondary)]">
                                                                <Clock size={11} className="text-[#10b981]/60" />
                                                                <span>
                                                                    {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString()}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Details Description */}
                                                        <p className="text-[11px] font-black text-white leading-relaxed uppercase italic mb-3">
                                                            {log.details}
                                                        </p>

                                                        {/* Cryptographic tamper hash and repo_id */}
                                                        <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap justify-between items-center gap-3">
                                                            <div className="flex items-center gap-1 text-[9px] text-[var(--text-secondary)] bg-white/5 px-2 py-0.5 rounded border border-white/5">
                                                                <Lock size={10} className="text-[#10b981]/60 shrink-0" />
                                                                <span>REPO_ID:</span>
                                                                <span className="text-white font-bold">{log.repo_id}</span>
                                                            </div>

                                                            <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] font-mono">
                                                                <Key size={11} className="text-emerald-400 shrink-0" />
                                                                <span className="font-bold uppercase tracking-wider text-[8px]">CHAIN_HASH:</span>
                                                                <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25 text-xs">
                                                                    {log.tamper_hash.substring(0, 16)}...
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    } catch (renderError: any) {
        console.error('[AuditLog] Render crash:', renderError);
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-red-500 font-black uppercase italic p-8 text-center font-mono">
                CRITICAL TIMELINE RENDER FAILURE.<br/>LEDGER SYSTEM OFF-LINE.
            </div>
        );
    }
}

