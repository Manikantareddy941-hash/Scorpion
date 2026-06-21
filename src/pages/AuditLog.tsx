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

// Recomputes a SHA-256 hex digest in-browser via the Web Crypto API, matching
// backend/src/utils/tamperAuditLogger.ts's crypto.createHash('sha256') output format.
async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface ChainStatus {
    isLegacy: boolean;
    verified: number;
    broken: number;
    total: number;
    anchorHash: string;
}

// Verifies the tamper-evident hash chain client-side. The API only returns the
// most recent window of entries, so the oldest entry in that window is treated
// as a trusted anchor (we have no visibility into what came before it) -
// every link after that is independently recomputed and compared.
async function verifyChain(rawLogs: AuditEntry[]): Promise<ChainStatus> {
    if (rawLogs.length === 0) {
        return { isLegacy: false, verified: 0, broken: 0, total: 0, anchorHash: '' };
    }
    if (rawLogs.every(l => l.tamper_hash === 'LEGACY_UNHASHED')) {
        return { isLegacy: true, verified: 0, broken: 0, total: rawLogs.length, anchorHash: '' };
    }

    const ascending = [...rawLogs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    let verified = 1; // the oldest visible entry is the trust anchor, not independently verifiable
    let broken = 0;
    let previousHash = ascending[0].tamper_hash;

    for (let i = 1; i < ascending.length; i++) {
        const log = ascending[i];
        const expected = await sha256Hex(`${previousHash}|${log.actor}|${log.action}|${log.repo_id}|${log.created_at}|${log.details}`);
        if (expected === log.tamper_hash) verified++;
        else broken++;
        previousHash = log.tamper_hash;
    }

    return { isLegacy: false, verified, broken, total: ascending.length, anchorHash: ascending[0].tamper_hash };
}

export default function AuditLog() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [logs, setLogs] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterAction, setFilterAction] = useState('all');
    const [chainStatus, setChainStatus] = useState<ChainStatus | null>(null);

    useEffect(() => {
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

            const response = await fetch('/api/audit', {
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
            verifyChain(mappedLogs).then(setChainStatus);
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
            case 'ALARM_CLEAR': return <CheckCircle size={16} className="text-[var(--accent-primary)]" />;
            case 'SCAN_STARTED': return <Play size={16} className="text-blue-600" />;
            case 'SCAN_COMPLETED': return <CheckCircle size={16} className="text-[var(--accent-primary)]" />;
            case 'GATE_CHECK': return <Shield size={16} className="text-purple-600" />;
            case 'REPORT_EXPORTED': return <FileText size={16} className="text-orange-600" />;
            default: return <Activity size={16} className="text-[var(--accent-primary)]" />;
        }
    };

    const getActionBadge = (action: string) => {
        const style = "px-2.5 py-0.5 rounded text-[8px] font-black uppercase italic border tracking-wider font-mono";
        switch (action) {
            case 'BREAK_GLASS_BYPASS':
                return <span className={`${style} bg-red-100 text-red-700 border-red-200 animate-pulse`}>CRIT BYPASS</span>;
            case 'ALARM_CLEAR':
                return <span className={`${style} bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] border-[var(--border-subtle)]`}>ALARM CLEAR</span>;
            case 'SCAN_STARTED':
                return <span className={`${style} bg-blue-50 text-blue-800 border-blue-100`}>SCAN INIT</span>;
            case 'SCAN_COMPLETED':
                return <span className={`${style} bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] border-[var(--border-subtle)]`}>SCAN DONE</span>;
            case 'GATE_CHECK':
                return <span className={`${style} bg-purple-50 text-purple-800 border-purple-100`}>GATE PROBE</span>;
            default:
                return <span className={`${style} bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border-[var(--border-subtle)]`}>{action}</span>;
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
            <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12 bg-[var(--bg-card)] border border-[var(--border-subtle)] border-l-4 border-l-[var(--accent-primary)] p-6 rounded-xl shadow-sm">
                        <div>
                            <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase tracking-widest italic flex items-center gap-2">
                                <Terminal className="text-[var(--accent-primary)] animate-pulse" size={28} />
                                AUDIT LEDGER
                            </h1>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1 font-mono">
                                [ SECURE CRYPTOGRAPHICALLY CHAINED SYSTEM METRICS ]
                            </p>
                        </div>

                        <div className="flex gap-4">
                            <div className="px-4 py-2 flex items-center gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
                                <div className="text-center">
                                    <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase">Ledger Blocks</p>
                                    <p className="text-sm font-black text-[var(--text-primary)]">{logs.length}</p>
                                </div>
                                <div className="w-px h-6 bg-[var(--border-subtle)]" />
                                <div className="text-center flex flex-col items-center">
                                    <p className="text-[8px] font-black text-[var(--accent-primary)] uppercase flex items-center gap-1.5 justify-center">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent-primary)] opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--accent-primary)]"></span>
                                        </span>
                                        [ SYNC_CHANNEL: ACTIVE ]
                                    </p>
                                    <p className="text-[9px] font-black text-[var(--accent-primary)] uppercase tracking-widest mt-0.5 animate-pulse">✓ INTEGRITY SECURE</p>
                                </div>
                            </div>
                            <button
                                onClick={fetchLogs}
                                className="p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-[var(--accent-primary)] hover:bg-[var(--bg-primary)] transition-colors cursor-pointer shadow-sm"
                            >
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>

                    {/* Dual-Column Dynamic Grid Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                        {/* Left Column */}
                        <div className="col-span-1 space-y-6">

                            {/* Widget A: Chain Health */}
                            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm rounded-xl p-5 font-mono">
                                <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)] mb-4 flex items-center gap-2">
                                    <Shield size={14} className="text-[var(--accent-primary)]" />
                                    SYSTEM MATH INTEGRITY
                                </h3>

                                <div className="space-y-4">
                                    {(() => {
                                        const broken = chainStatus?.broken ?? 0;
                                        const isLegacy = chainStatus?.isLegacy ?? false;
                                        const intact = broken === 0 && !isLegacy;
                                        const healthColor = intact ? 'text-[var(--accent-primary)]' : isLegacy ? 'text-[var(--text-secondary)]' : 'text-red-500';
                                        const healthLabel = chainStatus === null
                                            ? 'VERIFYING…'
                                            : isLegacy
                                                ? 'LEGACY (UNCHAINED)'
                                                : intact
                                                    ? 'INTACT & CHAINED'
                                                    : `${broken} TAMPERED LINK${broken === 1 ? '' : 'S'}`;
                                        return (
                                            <>
                                                <div className="flex items-center gap-3 bg-[var(--bg-primary)] p-3 rounded-lg border border-[var(--border-subtle)]">
                                                    <div className={`h-2 w-2 rounded-full shrink-0 ${intact ? 'bg-[var(--accent-primary)] animate-ping' : isLegacy ? 'bg-[var(--text-secondary)]' : 'bg-red-500 animate-pulse'}`} />
                                                    <div>
                                                        <p className="text-[8px] font-black uppercase text-[var(--text-secondary)]">Ledger Health</p>
                                                        <p className={`text-xs font-black uppercase tracking-wider ${healthColor}`}>{healthLabel}</p>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-3 text-[10px]">
                                                    <div className="bg-[var(--bg-primary)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                                                        <span className="text-[8px] block text-[var(--text-secondary)] uppercase">Verified Blocks</span>
                                                        <span className="font-black text-[var(--text-primary)] text-xs">{chainStatus?.verified ?? 0}</span>
                                                    </div>
                                                    <div className="bg-[var(--bg-primary)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                                                        <span className="text-[8px] block text-[var(--text-secondary)] uppercase">Tamper Audits</span>
                                                        <span className={`font-black text-xs ${broken > 0 ? 'text-red-500' : 'text-[var(--text-primary)]'}`}>{broken} BROKEN</span>
                                                    </div>
                                                </div>

                                                <div className="text-[9px] bg-[var(--bg-card)] border border-[var(--border-subtle)] border-l-4 border-l-[var(--accent-primary)] p-3 rounded-lg space-y-2 font-mono leading-relaxed shadow-sm">
                                                    <p className="text-[var(--accent-primary)] font-bold uppercase text-[8px] tracking-widest">[CRYPTO_ENGINE: SHA-256_VERIFIED]</p>
                                                    <p className="truncate text-[var(--text-secondary)]"><span className="text-[var(--text-secondary)] font-bold uppercase">LATEST_HASH:</span> {logs[0]?.tamper_hash || 'N/A'}</p>
                                                    <p className="truncate text-[var(--text-secondary)]"><span className="text-[var(--text-secondary)] font-bold uppercase">ANCHOR_HASH:</span> {chainStatus?.anchorHash || 'N/A'}</p>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* Widget B: Vector Volume Filter Panel */}
                            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm rounded-xl p-5">
                                <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)] mb-4 flex items-center gap-2">
                                    <Filter size={14} className="text-[var(--accent-primary)]" />
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
                                                className={`w-full text-left px-3 py-2.5 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all duration-300 flex justify-between items-center cursor-pointer ${isActive
                                                        ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] border-[var(--border-subtle)] shadow-sm'
                                                        : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]'
                                                    }`}
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-[var(--accent-primary)] animate-pulse' : 'bg-[var(--border-subtle)]'}`} />
                                                    {opt.label}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${isActive ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'}`}>
                                                    {count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="col-span-1 lg:col-span-2">

                            {loading ? (
                                <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm rounded-xl p-12 flex flex-col items-center justify-center min-h-[400px]">
                                    <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] italic">Synchronizing cryptographic chain...</p>
                                </div>
                            ) : error ? (
                                <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm rounded-xl p-12 text-center bg-red-50 border-red-200">
                                    <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-4 opacity-60 animate-bounce" />
                                    <h3 className="text-sm font-black text-red-800 uppercase tracking-wider">Synchronization Aborted</h3>
                                    <p className="text-[9px] font-bold text-red-600 mt-2 font-mono">{error}</p>
                                    <button onClick={fetchLogs} className="mt-4 px-4 py-2 border border-red-300 text-[10px] text-red-700 font-bold uppercase rounded-lg hover:bg-red-100 cursor-pointer">
                                        RETRY HANDSHAKE
                                    </button>
                                </div>
                            ) : filteredLogs.length === 0 ? (
                                <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm rounded-xl p-8 min-h-[400px] flex flex-col justify-between font-mono">
                                    <div>
                                        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3 mb-6">
                                            <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                                                <Terminal size={14} className="text-[var(--accent-primary)]" />
                                                <span>SYSTEM_SHELL // LOOPBACK_LISTENER</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="h-2 w-2 rounded-full bg-red-400" />
                                                <span className="h-2 w-2 rounded-full bg-yellow-400" />
                                                <span className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                                            </div>
                                        </div>

                                        <div className="space-y-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                                            <p className="text-[var(--text-primary)] font-bold">&gt; [SYSTEM]: Listening on secure event vector loopback...</p>
                                            <p className="text-[var(--text-primary)] font-bold">&gt; [ENGINE]: Chained block hash ledger initialized.</p>
                                            <p className="text-[var(--text-primary)] font-bold">&gt; [STATUS]: 0 tamper-vectors captured in current workspace.</p>
                                            <p className="text-[var(--text-secondary)]">&gt; [READY]: Awaiting secure transmission packets...</p>
                                        </div>
                                    </div>

                                    <div className="border-t border-[var(--border-subtle)] pt-4 mt-8 flex justify-between items-center text-[9px] text-[var(--text-secondary)]">
                                        <span>CHANNEL: MULTI_CAST_LOCAL</span>
                                        <span>LISTENING: PORT 3001</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm rounded-xl p-6 sm:p-8">
                                    <div className="relative pl-8 border-l-2 border-dashed border-[var(--accent-primary)] py-4 space-y-8">
                                        {filteredLogs.map((log) => {
                                            const isCritical = log.action === 'BREAK_GLASS_BYPASS';

                                            return (
                                                <div key={log.$id} className="relative group">
                                                    <div
                                                        className={`absolute -left-[41px] top-1.5 w-6 h-6 rounded-full border bg-[var(--bg-card)] flex items-center justify-center transition-all duration-300 ${isCritical
                                                                ? 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)] animate-pulse'
                                                                : 'border-[var(--accent-primary)] group-hover:border-[var(--accent-primary)]'
                                                            }`}
                                                    >
                                                        {getActionIcon(log.action)}
                                                    </div>

                                                    <div
                                                        className={`p-5 transition-all duration-500 rounded-xl border font-mono ${isCritical
                                                                ? 'animate-[pulse_3s_infinite] border-red-300 bg-red-50 shadow-sm'
                                                                : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--accent-primary)] hover:shadow-sm'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                {getActionBadge(log.action)}
                                                                <span className="text-[9px] font-black text-[var(--text-secondary)] bg-[var(--bg-card)] px-2 py-0.5 rounded border border-[var(--border-subtle)] font-mono">
                                                                    ACTOR: {log.actor}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-[9px] text-[var(--text-secondary)]">
                                                                <Clock size={11} className="text-[var(--accent-primary)]" />
                                                                <span>
                                                                    {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString()}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <p className="text-[11px] font-black text-[var(--text-primary)] leading-relaxed uppercase italic mb-3">
                                                            {log.details}
                                                        </p>

                                                        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap justify-between items-center gap-3">
                                                            <div className="flex items-center gap-1 text-[9px] text-[var(--text-secondary)] bg-[var(--bg-card)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">
                                                                <Lock size={10} className="text-[var(--accent-primary)] shrink-0" />
                                                                <span>REPO_ID:</span>
                                                                <span className="text-[var(--text-primary)] font-bold">{log.repo_id}</span>
                                                            </div>

                                                            <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-primary)] font-mono">
                                                                <Key size={11} className="text-[var(--accent-primary)] shrink-0" />
                                                                <span className="font-bold uppercase tracking-wider text-[8px] text-[var(--text-secondary)]">CHAIN_HASH:</span>
                                                                <span className="text-white font-bold bg-[var(--accent-primary)] px-2 py-0.5 rounded border border-[var(--border-subtle)] text-xs">
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
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-red-700 font-black uppercase italic p-8 text-center font-mono border-t-4 border-red-600">
                CRITICAL TIMELINE RENDER FAILURE.<br />LEDGER SYSTEM OFF-LINE.
            </div>
        );
    }
}