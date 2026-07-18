import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { setFindingStatus, setFindingStatuses } from '../lib/findingsApi';
import {
    CheckCircle2, Bug, Activity, Shield, Cpu, Globe,
    Filter, Clock, LayoutGrid, List, ChevronRight,
    CheckCircle, XCircle, Loader2, RefreshCw, Sparkles, X
} from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

interface Finding {
    $id: string;
    title: string;
    repo_name: string;
    type: string;
    severity: string;
    file_path: string;
    created_at: string;
    status: string;
}

export default function TasksPage() {
    const {} = useTranslation();
    const { getJWT } = useAuth();
    const [findings, setFindings] = useState<Finding[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [filterSeverity, setFilterSeverity] = useState('all');
    const [filterType, setFilterType] = useState('all');
    const [filterStatus, setFilterStatus] = useState('open');
    const [sortBy, setSortBy] = useState('date');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
    const [aiModalOpen, setAiModalOpen] = useState(false);
    const [aiBlueprintContent, setAiBlueprintContent] = useState('');
    const [aiBlueprintLoading, setAiBlueprintLoading] = useState(false);

    const fetchFindings = useCallback(async () => {
        setLoading(true);
        setHasError(false);
        try {
            // Was an unscoped query over the whole findings collection — every
            // tenant's findings, newest first. /api/issues resolves the repos
            // this caller can reach before querying.
            const token = await getJWT();
            const res = await fetch('/api/issues?limit=100', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`findings fetch failed: ${res.status}`);
            const documents: any[] = (await res.json())?.documents ?? [];
            const mappedFindings = documents.map((doc: any) => ({
                $id: doc.$id,
                title: doc.title || doc.name || 'Untitled Finding',
                repo_name: doc.repositoryName || doc.repo_name || 'Unknown Repository',
                type: doc.type || 'sast',
                severity: doc.severity || 'low',
                file_path: doc.filePath || doc.file_path || 'unknown',
                created_at: doc.created_at || doc.$createdAt,
                status: doc.status || 'open'
            }));
            setFindings(mappedFindings);
        } catch (err: any) {
            console.error('Fetch findings error:', err);
            setHasError(true);
            toast.error('Failed to fetch findings');
        } finally {
            setLoading(false);
        }
    }, [getJWT]);

    useEffect(() => { fetchFindings(); }, [fetchFindings]);

    const handleResolve = async (id: string) => {
        try {
            // resolvedAt is stamped server-side; the browser no longer writes
            // to the findings collection directly.
            await setFindingStatus(getJWT, id, 'resolved');
            setFindings(prev => prev.map(f => f.$id === id ? { ...f, status: 'resolved' } : f));
            toast.success('Issue marked as resolved');
        } catch (err) {
            toast.error('Failed to update status');
        }
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedTasks);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedTasks(newSet);
    };

    const handleBulkStatusChange = async (status: 'resolved' | 'dismissed') => {
        const verb = status === 'resolved' ? 'Acknowledging' : 'Dismissing';
        const verbPast = status === 'resolved' ? 'acknowledged' : 'dismissed';
        const toastId = toast.loading(`${verb} ${selectedTasks.size} tasks...`);
        try {
            const ids = Array.from(selectedTasks);
            const { succeeded, failed } = await setFindingStatuses(getJWT, ids, status);

            // Only mark the ones that actually landed. Previously a single
            // rejection threw, and every row kept its old status on screen even
            // where the write had succeeded.
            const failedSet = new Set(failed);
            setFindings(prev => prev.map(f =>
                selectedTasks.has(f.$id) && !failedSet.has(f.$id) ? { ...f, status } : f
            ));
            setSelectedTasks(new Set(failed));

            if (failed.length === 0) {
                toast.success(`Bulk ${verbPast} ${succeeded} tasks`, { id: toastId });
            } else if (succeeded === 0) {
                toast.error(`Failed to ${status === 'resolved' ? 'acknowledge' : 'dismiss'} tasks`, { id: toastId });
            } else {
                toast.error(`${verbPast} ${succeeded}, but ${failed.length} failed — still selected`, { id: toastId });
            }
        } catch (err) {
            toast.error(`Failed to ${status === 'resolved' ? 'acknowledge' : 'dismiss'} tasks`, { id: toastId });
        }
    };

    const handleAIBlueprint = async (id: string) => {
        setAiModalOpen(true);
        setAiBlueprintLoading(true);
        setAiBlueprintContent('');
        try {
            const token = await getJWT();
            const res = await fetch(`/api/dashboard/tasks/${id}/ai-blueprint`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) setAiBlueprintContent(data.blueprint);
            else { setAiBlueprintContent(`Error: ${data.error || 'Failed to generate blueprint'}`); toast.error('Failed to generate AI Blueprint'); }
        } catch (err) {
            setAiBlueprintContent('Error: Could not connect to AI service.');
            toast.error('Failed to generate AI Blueprint');
        } finally {
            setAiBlueprintLoading(false);
        }
    };

    const handleGithubSync = async (id: string) => {
        const toastId = toast.loading('Syncing issue with GitHub...');
        try {
            const token = await getJWT();
            const res = await fetch(`/api/dashboard/tasks/${id}/github-sync`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) { toast.success('Synced to GitHub successfully', { id: toastId }); if (data.url) window.open(data.url, '_blank'); }
            else toast.error(data.error || 'Failed to sync with GitHub', { id: toastId });
        } catch (err) {
            toast.error('Error syncing to GitHub', { id: toastId });
        }
    };

    const getSLA = (createdAt: string, severity: string) => {
        const created = new Date(createdAt).getTime();
        let hoursAllowed = 30 * 24;
        if (severity.toLowerCase() === 'critical') hoursAllowed = 24;
        else if (severity.toLowerCase() === 'high') hoursAllowed = 7 * 24;
        else if (severity.toLowerCase() === 'medium') hoursAllowed = 14 * 24;
        return (created + hoursAllowed * 3600000 - Date.now()) / 3600000;
    };

    const filteredFindings = findings
        .filter(f => {
            if (filterSeverity !== 'all' && f.severity.toLowerCase() !== filterSeverity) return false;
            if (filterType !== 'all' && f.type.toLowerCase() !== filterType) return false;
            if (filterStatus !== 'all' && f.status.toLowerCase() !== filterStatus) return false;
            return true;
        })
        .sort((a, b) => {
            if (sortBy === 'date') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            if (sortBy === 'severity') {
                const w: any = { critical: 4, high: 3, medium: 2, low: 1 };
                return w[b.severity.toLowerCase()] - w[a.severity.toLowerCase()];
            }
            return a.repo_name.localeCompare(b.repo_name);
        });

    const stats = {
        open: findings.filter(f => f.status === 'open').length,
        critical: findings.filter(f => f.severity.toLowerCase() === 'critical' && f.status === 'open').length,
        resolved: findings.filter(f => f.status === 'resolved').length
    };

    const SeverityBadge = ({ severity }: { severity: string }) => {
        const colors: any = {
            critical: 'bg-red-500/10 text-red-500 border-red-500/20',
            high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
            medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
            low: 'bg-green-500/10 text-green-500 border-green-500/20'
        };
        return (
            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase italic border ${colors[severity.toLowerCase()] || colors.low}`}>
                {severity}
            </span>
        );
    };

    const TypeIcon = ({ type }: { type: string }) => {
        switch (type.toLowerCase()) {
            case 'secret': return <Bug size={14} className="text-yellow-500" />;
            case 'dependency': return <Activity size={14} className="text-blue-500" />;
            case 'sast': return <Shield size={14} className="text-purple-500" />;
            case 'iac': return <Cpu size={14} className="text-indigo-500" />;
            case 'dast': return <Globe size={14} className="text-rose-500" />;
            default: return <Activity size={14} />;
        }
    };

    // ── Grid Card: compact, info-dense, no vertical button stack ──────────────
    const GridCard = ({ finding }: { finding: Finding }) => {
        const remainingHours = getSLA(finding.created_at, finding.severity);
        const isOverdue = remainingHours <= 0;
        const isEmergency = remainingHours > 0 && remainingHours < 6;
        const isResolved = finding.status === 'resolved';

        const severityAccent: any = {
            critical: 'border-l-red-500',
            high: 'border-l-orange-400',
            medium: 'border-l-yellow-400',
            low: 'border-l-green-500' };
        const accent = severityAccent[finding.severity.toLowerCase()] || 'border-l-slate-300';

        return (
            <div className={`premium-card group border-l-4 ${accent} hover:border-[var(--accent-primary)]/40 transition-all flex flex-col`}>
                {/* ── Top row: checkbox + badges + date ── */}
                <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            type="checkbox"
                            checked={selectedTasks.has(finding.$id)}
                            onChange={() => toggleSelection(finding.$id)}
                            className="w-3.5 h-3.5 rounded border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--accent-primary)] focus:ring-[var(--accent-primary)] cursor-pointer shrink-0"
                        />
                        <SeverityBadge severity={finding.severity} />
                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase italic border ${isOverdue ? 'bg-red-500/20 text-red-500 border-red-500 animate-pulse' :
                                isEmergency ? 'bg-orange-500/20 text-orange-400 border-orange-400 animate-pulse' :
                                    'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                            }`}>
                            {isOverdue ? 'SLA Overdue' : `${Math.floor(remainingHours)}h`}
                        </span>
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded text-[8px] font-black uppercase italic text-[var(--text-secondary)]">
                            <TypeIcon type={finding.type} />
                            {finding.type}
                        </span>
                    </div>
                    <span className="text-[8px] font-bold text-[var(--text-secondary)] font-mono shrink-0 mt-0.5">
                        {new Date(finding.created_at).toLocaleDateString()}
                    </span>
                </div>

                {/* ── Title ── */}
                <div className="px-4 pb-2 flex-1">
                    <h4 className={`text-[13px] font-semibold leading-tight ${isResolved ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--text-primary)]'
                        }`}>
                        {finding.title}
                    </h4>
                </div>

                {/* ── Repo + file path ── */}
                <div className="px-4 pb-3">
                    <p className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1.5 truncate font-mono">
                        <Globe size={10} className="text-[var(--accent-primary)] shrink-0" />
                        <span className="truncate">{finding.repo_name}</span>
                        <span className="opacity-30 shrink-0">·</span>
                        <span className="truncate opacity-60">{finding.file_path}</span>
                    </p>
                </div>

                {/* ── Bottom action bar — horizontal, always at bottom ── */}
                <div className="border-t border-[var(--border-subtle)] px-4 py-2.5 flex items-center justify-between bg-[var(--bg-primary)]/40 rounded-b-2xl">
                    {/* Resolve toggle */}
                    <button
                        title={isResolved ? 'Resolved' : 'Mark Resolved'}
                        onClick={() => !isResolved && handleResolve(finding.$id)}
                        className={`flex items-center gap-1.5 text-[8px] font-black uppercase italic transition-all ${isResolved
                                ? 'text-[var(--status-success)] cursor-default'
                                : 'text-[var(--text-secondary)] hover:text-[var(--status-success)] cursor-pointer'
                            }`}
                    >
                        {isResolved
                            ? <><CheckCircle size={14} /> Resolved</>
                            : <><div className="w-3.5 h-3.5 rounded-full border-2 border-current" /> Resolve</>
                        }
                    </button>

                    {/* Right-side icon actions */}
                    <div className="flex items-center gap-1">
                        <button
                            title="AI Blueprint"
                            onClick={() => handleAIBlueprint(finding.$id)}
                            className="p-1.5 rounded-lg text-yellow-500 hover:bg-yellow-500/10 border border-transparent hover:border-yellow-500/30 transition-all cursor-pointer"
                        >
                            <Sparkles size={13} />
                        </button>
                        <button
                            title="Export to GitHub"
                            onClick={() => handleGithubSync(finding.$id)}
                            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-white hover:bg-white/10 border border-transparent hover:border-white/20 transition-all cursor-pointer"
                        >
                            <SiGithub size={13} />
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ── List Row: original horizontal layout ──────────────────────────────────
    const ListRow = ({ finding }: { finding: Finding }) => {
        const remainingHours = getSLA(finding.created_at, finding.severity);
        const isOverdue = remainingHours <= 0;
        const isEmergency = remainingHours > 0 && remainingHours < 6;
        const isResolved = finding.status === 'resolved';

        return (
            <div className="premium-card group hover:border-[var(--accent-primary)]/40 transition-all">
                <div className="p-5 flex items-center gap-4">
                    <input
                        type="checkbox"
                        checked={selectedTasks.has(finding.$id)}
                        onChange={() => toggleSelection(finding.$id)}
                        className="w-4 h-4 rounded border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--accent-primary)] cursor-pointer shrink-0"
                    />
                    <button
                        title="Resolve"
                        onClick={() => !isResolved && handleResolve(finding.$id)}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0 ${isResolved
                                ? 'bg-[var(--status-success)]/10 text-[var(--status-success)] cursor-default'
                                : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--status-success)] hover:text-[var(--status-success)] hover:bg-[var(--status-success)]/5 cursor-pointer'
                            }`}
                    >
                        {isResolved ? <CheckCircle size={18} /> : <div className="w-4 h-4 rounded-full border-2 border-current" />}
                    </button>
                    <button
                        title="AI Blueprint"
                        className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-yellow-500 hover:border-yellow-500 hover:bg-yellow-500/10 transition-all shrink-0 cursor-pointer"
                        onClick={() => handleAIBlueprint(finding.$id)}
                    >
                        <Sparkles size={15} />
                    </button>
                    <button
                        title="Export to GitHub"
                        className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-white hover:text-white hover:bg-white/10 transition-all shrink-0 cursor-pointer"
                        onClick={() => handleGithubSync(finding.$id)}
                    >
                        <SiGithub size={15} />
                    </button>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <SeverityBadge severity={finding.severity} />
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase italic border ${isOverdue ? 'bg-red-500/20 text-red-500 border-red-500 animate-pulse' :
                                    isEmergency ? 'bg-orange-500/20 text-orange-500 border-orange-500 animate-pulse' :
                                        'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                                }`}>
                                {isOverdue ? 'SLA Overdue' : `${Math.floor(remainingHours)}h Remaining`}
                            </span>
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded text-[9px] font-black uppercase italic text-[var(--text-secondary)]">
                                <TypeIcon type={finding.type} />
                                {finding.type}
                            </span>
                            <span className="text-[8px] font-bold text-[var(--text-secondary)] ml-auto font-mono flex items-center gap-1">
                                <Clock size={9} />
                                {new Date(finding.created_at).toLocaleDateString()}
                            </span>
                        </div>
                        <h4 className={`text-[14px] font-semibold truncate ${isResolved ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--text-primary)]'}`}>
    {finding.title}
                        </h4>
                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-1 flex items-center gap-2">
                            <Globe size={10} className="text-[var(--accent-primary)]" />
                            {finding.repo_name}
                            <span className="opacity-30">•</span>
                            <span className="truncate">{finding.file_path}</span>
                        </p>
                    </div>

                    <ChevronRight size={18} className="text-[var(--text-secondary)] group-hover:text-[var(--accent-primary)] transition-colors shrink-0" />
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                {/* Header & Stats */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
                    <div>
                        <h1 className="text-[22px] font-semibold text-[var(--text-primary)] tracking-tight">Tasks</h1>
                        <p className="text-[13px] text-[var(--text-secondary)] mt-1">Track and resolve security findings through remediation</p>
                    </div>
                    <div className="flex gap-4">
                        <div className="premium-card px-6 py-3 flex items-center gap-4">
                            <div className="text-center">
                                <p className="text-[11px] font-medium text-[var(--text-secondary)]">Open</p>
                                <p className="text-xl font-semibold tabular-nums text-[var(--text-primary)]">{stats.open}</p>
                            </div>
                            <div className="w-px h-8 bg-[var(--border-subtle)]" />
                            <div className="text-center">
                                <p className="text-[11px] font-medium text-red-500">Critical</p>
                                <p className="text-xl font-semibold tabular-nums text-red-500">{stats.critical}</p>
                            </div>
                            <div className="w-px h-8 bg-[var(--border-subtle)]" />
                            <div className="text-center">
                                <p className="text-[11px] font-medium text-[var(--status-success)]">Resolved</p>
                                <p className="text-xl font-semibold tabular-nums text-[var(--status-success)]">{stats.resolved}</p>
                            </div>
                        </div>
                        <button onClick={fetchFindings} className="p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors">
                            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Filters Bar */}
                <div className="premium-card p-4 mb-8 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Filter size={14} className="text-[var(--text-secondary)]" />
                        {[
                            { value: filterSeverity, onChange: setFilterSeverity, options: [['all', 'All Severities'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] },
                            { value: filterType, onChange: setFilterType, options: [['all', 'All Types'], ['secret', 'Secret'], ['dependency', 'Dependency'], ['sast', 'SAST'], ['iac', 'IaC'], ['dast', 'DAST']] },
                            { value: filterStatus, onChange: setFilterStatus, options: [['all', 'All Status'], ['open', 'Open'], ['resolved', 'Resolved']] },
                            { value: sortBy, onChange: setSortBy, options: [['date', 'Sort: Recent'], ['severity', 'Sort: Severity'], ['repo', 'Sort: Repo']] },
                        ].map((sel, i) => (
                            <select key={i} value={sel.value} onChange={e => sel.onChange(e.target.value)}
                                className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none cursor-pointer">
                                {sel.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        ))}
                    </div>
                    <div className="flex bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-1 ml-auto">
                        <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                            <List size={16} />
                        </button>
                        <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                            <LayoutGrid size={16} />
                        </button>
                    </div>
                </div>

                {/* Tasks */}
                {hasError ? (
                    <div className="premium-card p-16 text-center border-red-500/20 max-w-xl mx-auto my-12">
                        <XCircle className="w-16 h-16 text-red-500 mx-auto mb-6 animate-pulse" />
                        <h3 className="text-lg font-semibold text-red-500">Couldn't load findings</h3>
                        <p className="text-[13px] text-[var(--text-secondary)] mt-2">Check your connection or scanner configuration.</p>
                        <button onClick={fetchFindings} className="mt-6 px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 text-[13px] font-semibold rounded-lg transition-all cursor-pointer">Try again</button>
                    </div>
                ) : loading ? (
                    <div className="flex flex-col items-center justify-center py-24">
                        <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
                        <p className="text-[13px] text-[var(--text-secondary)]">Loading tasks…</p>
                    </div>
                ) : filteredFindings.length === 0 ? (
                    <div className="premium-card p-24 text-center">
                        <CheckCircle2 className="w-16 h-16 text-[var(--status-success)] mx-auto mb-6 opacity-20" />
                        <h3 className="text-lg font-semibold text-[var(--text-primary)]">All clear</h3>
                        <p className="text-[13px] text-[var(--text-secondary)] mt-2">No open tasks right now.</p>
                    </div>
                ) : viewMode === 'grid' ? (
                    // Grid: 3 cols, compact cards with left severity border accent
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredFindings.map(f => <GridCard key={f.$id} finding={f} />)}
                    </div>
                ) : (
                    // List: original horizontal rows
                    <div className="space-y-3">
                        {filteredFindings.map(f => <ListRow key={f.$id} finding={f} />)}
                    </div>
                )}

                {/* Bulk Action Bar */}
                {selectedTasks.size > 0 && (
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[var(--bg-secondary)]/90 backdrop-blur-md border border-[var(--border-color)] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-6 z-50">
                        <span className="text-xs font-black uppercase text-[var(--text-primary)] italic">{selectedTasks.size} Selected</span>
                        <div className="flex gap-3">
                            <button onClick={() => handleBulkStatusChange('resolved')} className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-opacity-90 text-white text-[10px] font-black uppercase rounded-lg italic transition-all">Bulk Acknowledge</button>
                            <button onClick={() => handleBulkStatusChange('dismissed')} className="px-4 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white text-[10px] font-black uppercase rounded-lg italic transition-all">Bulk Dismiss</button>
                        </div>
                    </div>
                )}

                {/* AI Blueprint Modal */}
                {aiModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
                                <div className="flex items-center gap-2 text-yellow-500">
                                    <Sparkles size={18} />
                                    <h3 className="font-black uppercase italic tracking-wide">AI Remediation Blueprint</h3>
                                </div>
                                <button onClick={() => setAiModalOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-6 overflow-y-auto flex-1">
                                {aiBlueprintLoading ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Loader2 className="w-8 h-8 text-yellow-500 animate-spin mb-4" />
                                        <p className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] italic">Analyzing Task Parameters...</p>
                                    </div>
                                ) : (
                                    <pre className="whitespace-pre-wrap font-mono text-[11px] text-[var(--text-primary)] bg-[var(--bg-primary)] p-4 rounded-xl border border-[var(--border-subtle)] overflow-x-auto">
                                        {aiBlueprintContent}
                                    </pre>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}