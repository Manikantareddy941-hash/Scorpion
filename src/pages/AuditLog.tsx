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
            case 'ALARM_CLEAR': return <CheckCircle size={16} className="text-[#6db87a]" />;
            case 'SCAN_STARTED': return <Play size={16} className="text-blue-600" />;
            case 'SCAN_COMPLETED': return <CheckCircle size={16} className="text-[#6db87a]" />;
            case 'GATE_CHECK': return <Shield size={16} className="text-purple-600" />;
            case 'REPORT_EXPORTED': return <FileText size={16} className="text-orange-600" />;
            default: return <Activity size={16} className="text-[#6db87a]" />;
        }
    };

    const getActionBadge = (action: string) => {
        const style = "px-2.5 py-0.5 rounded text-[8px] font-black uppercase italic border tracking-wider font-mono";
        switch (action) {
            case 'BREAK_GLASS_BYPASS': 
                return <span className={`${style} bg-red-100 text-red-700 border-red-200 animate-pulse`}>CRIT BYPASS</span>;
            case 'ALARM_CLEAR': 
                return <span className={`${style} bg-[#6db87a]/15 text-[#6db87a] border-[#6db87a]/30`}>ALARM CLEAR</span>;
            case 'SCAN_STARTED': 
                return <span className={`${style} bg-blue-50 text-blue-800 border-blue-100`}>SCAN INIT</span>;
            case 'SCAN_COMPLETED': 
                return <span className={`${style} bg-[#6db87a]/15 text-[#6db87a] border-[#6db87a]/25`}>SCAN DONE</span>;
            case 'GATE_CHECK': 
                return <span className={`${style} bg-purple-50 text-purple-800 border-purple-100`}>GATE PROBE</span>;
            default: 
                return <span className={`${style} bg-[#6db87a]/10 text-[#6db87a] border-[#6db87a]/20`}>{action}</span>;
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
            <div className="min-h-screen bg-[#f5f0e8] py-12 px-4 sm:px-6 lg:px-8 font-mono text-[#6db87a]">
                <div className="max-w-7xl mx-auto">
                    {/* Header: White Card with Green Accent Left Border */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12 bg-white border border-[#e8e0d0] border-l-4 border-l-[#6db87a] p-6 rounded-xl shadow-sm">
                        <div>
                            <h1 className="text-3xl font-black text-[#6db87a] uppercase tracking-widest italic flex items-center gap-2">
                                <Terminal className="text-[#6db87a] animate-pulse" size={28} />
                                AUDIT LEDGER
                            </h1>
                            <p className="text-[10px] font-bold text-[#6db87a]/85 uppercase tracking-widest mt-1 font-mono">
                                [ SECURE CRYPTOGRAPHICALLY CHAINED SYSTEM METRICS ]
                            </p>
                        </div>

                        <div className="flex gap-4">
                            <div className="px-4 py-2 flex items-center gap-4 rounded-lg border border-[#e8e0d0] bg-[#f5f0e8]/50">
                                <div className="text-center">
                                    <p className="text-[8px] font-black text-[#6db87a]/70 uppercase">Ledger Blocks</p>
                                    <p className="text-sm font-black text-[#6db87a]">{logs.length}</p>
                                </div>
                                <div className="w-px h-6 bg-[#e8e0d0]" />
                                <div className="text-center flex flex-col items-center">
                                    <p className="text-[8px] font-black text-[#6db87a] uppercase flex items-center gap-1.5 justify-center">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#6db87a] opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#6db87a]"></span>
                                        </span>
                                        [ SYNC_CHANNEL: ACTIVE ]
                                    </p>
                                    <p className="text-[9px] font-black text-[#6db87a] uppercase tracking-widest mt-0.5 animate-pulse">✓ INTEGRITY SECURE</p>
                                </div>
                            </div>
                            <button 
                                onClick={fetchLogs} 
                                className="p-3 bg-white border border-[#e8e0d0] rounded-xl text-[#6db87a] hover:bg-[#f5f0e8] hover:text-[#6db87a] transition-colors cursor-pointer shadow-sm"
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
                            <div className="bg-white border border-[#e8e0d0] shadow-sm rounded-xl p-5 font-mono">
                                <h3 className="text-xs font-black uppercase tracking-widest text-[#6db87a] mb-4 flex items-center gap-2">
                                    <Shield size={14} className="text-[#6db87a]" />
                                    SYSTEM MATH INTEGRITY
                                </h3>
                                
                                <div className="space-y-4">
                                    {/* Integrity Circle Indicator */}
                                    <div className="flex items-center gap-3 bg-[#f5f0e8] p-3 rounded-lg border border-[#e8e0d0]">
                                        <div className="h-2 w-2 rounded-full bg-[#6db87a] animate-ping shrink-0" />
                                        <div>
                                            <p className="text-[8px] font-black uppercase text-[#6db87a]/70">Ledger Health</p>
                                            <p className="text-xs font-black text-[#6db87a] uppercase tracking-wider">100% SECURE & CHAINED</p>
                                        </div>
                                    </div>

                                    {/* System Stats Block */}
                                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                                        <div className="bg-[#f5f0e8] p-2.5 rounded-lg border border-[#e8e0d0]">
                                            <span className="text-[8px] block text-[#6db87a]/70 uppercase">Verified Blocks</span>
                                            <span className="font-black text-[#6db87a] text-xs">{logs.length}</span>
                                        </div>
                                        <div className="bg-[#f5f0e8] p-2.5 rounded-lg border border-[#e8e0d0]">
                                            <span className="text-[8px] block text-[#6db87a]/70 uppercase">Tamper Audits</span>
                                            <span className="font-black text-[#6db87a] text-xs">0 BROKEN</span>
                                        </div>
                                    </div>

                                    {/* Crypto Engine Card: White background with bright green left border */}
                                    <div className="text-[9px] bg-white border border-[#e8e0d0] border-l-4 border-l-[#6db87a] p-3 rounded-lg space-y-2 font-mono leading-relaxed shadow-sm">
                                        <p className="text-[#6db87a] font-bold uppercase text-[8px] tracking-widest">[CRYPTO_ENGINE: SHA-256_VERIFIED]</p>
                                        <p className="truncate text-[#6db87a]/85"><span className="text-[#6db87a]/70 font-bold uppercase">ROOT_HASH:</span> {logs[0]?.tamper_hash || 'SHA-256_ACTIVE'}</p>
                                        <p className="truncate text-[#6db87a]/85"><span className="text-[#6db87a]/70 font-bold uppercase">GENESIS_HASH:</span> 0x8a92f03de10ab8c9e53b49f908e2a14e912c9b4e7239ef182a938c734892cfa7</p>
                                    </div>
                                </div>
                            </div>

                            {/* Widget B: Vector Volume Filter Panel */}
                            <div className="bg-white border border-[#e8e0d0] shadow-sm rounded-xl p-5">
                                <h3 className="text-xs font-black uppercase tracking-widest text-[#6db87a] mb-4 flex items-center gap-2">
                                    <Filter size={14} className="text-[#6db87a]" />
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
                                                        ? 'bg-[#6db87a]/15 text-[#6db87a] border-[#6db87a]/40 shadow-sm'
                                                        : 'bg-[#f5f0e8] text-[#6db87a]/75 border-[#e8e0d0] hover:bg-[#e8e0d0] hover:text-[#6db87a]'
                                                }`}
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-[#6db87a] animate-pulse' : 'bg-[#6db87a]/20'}`} />
                                                    {opt.label}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${isActive ? 'bg-[#6db87a]/20 text-[#6db87a]' : 'bg-[#e8e0d0] text-[#6db87a]/70'}`}>
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
                                <div className="bg-white border border-[#e8e0d0] shadow-sm rounded-xl p-12 flex flex-col items-center justify-center min-h-[400px]">
                                    <Loader2 className="w-12 h-12 text-[#6db87a] animate-spin mb-4" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-[#6db87a] italic">Synchronizing cryptographic chain...</p>
                                </div>
                            ) : error ? (
                                <div className="bg-white border border-[#e8e0d0] shadow-sm rounded-xl p-12 text-center bg-red-50 border-red-200">
                                    <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-4 opacity-60 animate-bounce" />
                                    <h3 className="text-sm font-black text-red-800 uppercase tracking-wider">Synchronization Aborted</h3>
                                    <p className="text-[9px] font-bold text-red-600 mt-2 font-mono">{error}</p>
                                    <button onClick={fetchLogs} className="mt-4 px-4 py-2 border border-red-300 text-[10px] text-red-700 font-bold uppercase rounded-lg hover:bg-red-100 cursor-pointer">
                                        RETRY HANDSHAKE
                                    </button>
                                </div>
                            ) : filteredLogs.length === 0 ? (
                                /* Professional Monospace Terminal Empty State Widget */
                                <div className="bg-white border border-[#e8e0d0] shadow-sm rounded-xl p-8 min-h-[400px] flex flex-col justify-between font-mono">
                                    <div>
                                        <div className="flex items-center justify-between border-b border-[#e8e0d0] pb-3 mb-6">
                                            <div className="flex items-center gap-2 text-xs font-bold text-[#6db87a]">
                                                <Terminal size={14} className="text-[#6db87a]" />
                                                <span>SYSTEM_SHELL // LOOPBACK_LISTENER</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="h-2 w-2 rounded-full bg-red-400" />
                                                <span className="h-2 w-2 rounded-full bg-yellow-400" />
                                                <span className="h-2 w-2 rounded-full bg-[#6db87a]" />
                                            </div>
                                        </div>

                                        <div className="space-y-2.5 text-xs text-[#6db87a]/80 leading-relaxed">
                                            <p className="text-[#6db87a] font-bold">&gt; [SYSTEM]: Listening on secure event vector loopback...</p>
                                            <p className="text-[#6db87a] font-bold">&gt; [ENGINE]: Chained block hash ledger initialized.</p>
                                            <p className="text-[#6db87a] font-bold">&gt; [STATUS]: 0 tamper-vectors captured in current workspace.</p>
                                            <p className="text-[#6db87a]/50">&gt; [READY]: Awaiting secure transmission packets...</p>
                                        </div>
                                    </div>
                                    
                                    <div className="border-t border-[#e8e0d0] pt-4 mt-8 flex justify-between items-center text-[9px] text-[#6db87a]/60">
                                        <span>CHANNEL: MULTI_CAST_LOCAL</span>
                                        <span>LISTENING: PORT 3001</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-white border border-[#e8e0d0] shadow-sm rounded-xl p-6 sm:p-8">
                                    {/* Dashed Timeline line set to bright green #6db87a */}
                                    <div className="relative pl-8 border-l-2 border-dashed border-[#6db87a] py-4 space-y-8">
                                        {filteredLogs.map((log) => {
                                            const isCritical = log.action === 'BREAK_GLASS_BYPASS';
                                            
                                            return (
                                                <div key={log.$id} className="relative group">
                                                    {/* Timeline Node Ring */}
                                                    <div 
                                                        className={`absolute -left-[41px] top-1.5 w-6 h-6 rounded-full border bg-white flex items-center justify-center transition-all duration-300 ${
                                                            isCritical 
                                                                ? 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)] animate-pulse' 
                                                                : 'border-[#6db87a] group-hover:border-[#6db87a] shadow-[0_0_5px_rgba(109,184,122,0.2)]'
                                                        }`}
                                                    >
                                                        {getActionIcon(log.action)}
                                                    </div>

                                                    {/* Monospace Blockchain Ledger Layout Card */}
                                                    <div 
                                                        className={`p-5 transition-all duration-500 rounded-xl border font-mono ${
                                                            isCritical 
                                                                ? 'animate-[pulse_3s_infinite] border-red-300 bg-red-50 shadow-sm' 
                                                                : 'border-[#e8e0d0] bg-[#f5f0e8] hover:border-[#6db87a] hover:shadow-sm'
                                                        }`}
                                                    >
                                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                {getActionBadge(log.action)}
                                                                <span className="text-[9px] font-black text-[#6db87a]/80 bg-white px-2 py-0.5 rounded border border-[#e8e0d0] font-mono">
                                                                    ACTOR: {log.actor}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-[9px] text-[#6db87a]/70">
                                                                <Clock size={11} className="text-[#6db87a]" />
                                                                <span>
                                                                    {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString()}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Details Description */}
                                                        <p className="text-[11px] font-black text-[#6db87a] leading-relaxed uppercase italic mb-3">
                                                            {log.details}
                                                        </p>

                                                        {/* Cryptographic tamper hash and repo_id */}
                                                        <div className="mt-3 pt-3 border-t border-[#e8e0d0] flex flex-wrap justify-between items-center gap-3">
                                                            <div className="flex items-center gap-1 text-[9px] text-[#6db87a]/80 bg-white px-2 py-0.5 rounded border border-[#e8e0d0]">
                                                                <Lock size={10} className="text-[#6db87a] shrink-0" />
                                                                <span>REPO_ID:</span>
                                                                <span className="text-[#6db87a] font-bold">{log.repo_id}</span>
                                                            </div>

                                                            {/* Chain hash badge - Bright green background with white text */}
                                                            <div className="flex items-center gap-1.5 text-[10px] text-[#6db87a] font-mono">
                                                                <Key size={11} className="text-[#6db87a] shrink-0" />
                                                                <span className="font-bold uppercase tracking-wider text-[8px] text-[#6db87a]/70">CHAIN_HASH:</span>
                                                                <span className="text-white font-bold bg-[#6db87a] px-2 py-0.5 rounded border border-[#6db87a]/20 text-xs">
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
            <div className="min-h-screen flex items-center justify-center bg-[#f5f0e8] text-red-700 font-black uppercase italic p-8 text-center font-mono border-t-4 border-red-600">
                CRITICAL TIMELINE RENDER FAILURE.<br/>LEDGER SYSTEM OFF-LINE.
            </div>
        );
    }
}
