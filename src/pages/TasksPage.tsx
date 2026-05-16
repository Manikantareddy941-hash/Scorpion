import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    CheckCircle2, AlertTriangle, Bug, Activity, Shield, Cpu, Globe, 
    Filter, ArrowUpDown, Clock, LayoutGrid, List, ChevronRight,
    CheckCircle, XCircle, Loader2, RefreshCw, Sparkles, Github, X
} from 'lucide-react';
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
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [findings, setFindings] = useState<Finding[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterSeverity, setFilterSeverity] = useState('all');
    const [filterType, setFilterType] = useState('all');
    const [filterStatus, setFilterStatus] = useState('open');
    const [sortBy, setSortBy] = useState('date');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
    const [aiModalOpen, setAiModalOpen] = useState(false);
    const [aiBlueprintContent, setAiBlueprintContent] = useState('');
    const [aiBlueprintLoading, setAiBlueprintLoading] = useState(false);

    useEffect(() => {
        fetchFindings();
    }, []);

    const fetchFindings = async () => {
        setLoading(true);
        try {
            const { databases, DB_ID, COLLECTIONS, Query } = await import('../lib/appwrite');
            const res = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [
                Query.limit(100),
                Query.orderDesc('$createdAt')
            ]);
            
            const mappedFindings = res.documents.map((doc: any) => ({
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
            toast.error('Failed to fetch findings');
        } finally {
            setLoading(false);
        }
    };

    const handleResolve = async (id: string) => {
        try {
            const { databases, DB_ID, COLLECTIONS } = await import('../lib/appwrite');
            await databases.updateDocument(DB_ID, COLLECTIONS.FINDINGS, id, {
                status: 'resolved'
            });
            
            setFindings(prev => prev.map(f => f.$id === id ? { ...f, status: 'resolved' } : f));
            toast.success('Issue marked as resolved');
        } catch (err) {
            console.error('Resolve error:', err);
            toast.error('Failed to update status');
        }
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedTasks);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedTasks(newSet);
    };

    const handleBulkAcknowledge = async () => {
        const toastId = toast.loading(`Acknowledging ${selectedTasks.size} tasks...`);
        try {
            const { databases, DB_ID, COLLECTIONS } = await import('../lib/appwrite');
            await Promise.all(Array.from(selectedTasks).map(id => 
                databases.updateDocument(DB_ID, COLLECTIONS.FINDINGS, id, { status: 'resolved' })
            ));
            setFindings(prev => prev.map(f => selectedTasks.has(f.$id) ? { ...f, status: 'resolved' } : f));
            toast.success(`Bulk acknowledged ${selectedTasks.size} tasks`, { id: toastId });
            setSelectedTasks(new Set());
        } catch (err) {
            console.error('Bulk acknowledge error:', err);
            toast.error('Failed to acknowledge tasks', { id: toastId });
        }
    };

    const handleBulkDismiss = async () => {
        const toastId = toast.loading(`Dismissing ${selectedTasks.size} tasks...`);
        try {
            const { databases, DB_ID, COLLECTIONS } = await import('../lib/appwrite');
            await Promise.all(Array.from(selectedTasks).map(id => 
                databases.updateDocument(DB_ID, COLLECTIONS.FINDINGS, id, { status: 'dismissed' })
            ));
            setFindings(prev => prev.map(f => selectedTasks.has(f.$id) ? { ...f, status: 'dismissed' } : f));
            toast.success(`Bulk dismissed ${selectedTasks.size} tasks`, { id: toastId });
            setSelectedTasks(new Set());
        } catch (err) {
            console.error('Bulk dismiss error:', err);
            toast.error('Failed to dismiss tasks', { id: toastId });
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
            if (res.ok) {
                setAiBlueprintContent(data.blueprint);
            } else {
                setAiBlueprintContent(`Error: ${data.error || 'Failed to generate blueprint'}`);
                toast.error('Failed to generate AI Blueprint');
            }
        } catch (err) {
            console.error('AI Blueprint error:', err);
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
            if (res.ok) {
                toast.success('Synced to GitHub successfully', { id: toastId });
                if (data.url) {
                    window.open(data.url, '_blank');
                }
            } else {
                toast.error(data.error || 'Failed to sync with GitHub', { id: toastId });
            }
        } catch (err) {
            console.error('GitHub sync error:', err);
            toast.error('Error syncing to GitHub', { id: toastId });
        }
    };

    const getSLA = (createdAt: string, severity: string) => {
        const created = new Date(createdAt).getTime();
        let hoursAllowed = 30 * 24; 
        if (severity.toLowerCase() === 'critical') hoursAllowed = 24;
        else if (severity.toLowerCase() === 'high') hoursAllowed = 7 * 24;
        else if (severity.toLowerCase() === 'medium') hoursAllowed = 14 * 24;
        
        const deadline = created + (hoursAllowed * 60 * 60 * 1000);
        const now = Date.now();
        const remainingHours = (deadline - now) / (1000 * 60 * 60);
        
        return remainingHours;
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
                const weight: any = { critical: 4, high: 3, medium: 2, low: 1 };
                return weight[b.severity.toLowerCase()] - weight[a.severity.toLowerCase()];
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

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                {/* Header & Stats */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
                    <div>
                        <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Security Tasks</h1>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Remediation pipeline & finding lifecycle</p>
                    </div>

                    <div className="flex gap-4">
                        <div className="premium-card px-6 py-3 flex items-center gap-4">
                            <div className="text-center">
                                <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase italic">Open Issues</p>
                                <p className="text-xl font-black text-[var(--text-primary)] italic">{stats.open}</p>
                            </div>
                            <div className="w-px h-8 bg-[var(--border-subtle)]" />
                            <div className="text-center">
                                <p className="text-[8px] font-black text-red-500 uppercase italic">Critical</p>
                                <p className="text-xl font-black text-red-500 italic">{stats.critical}</p>
                            </div>
                            <div className="w-px h-8 bg-[var(--border-subtle)]" />
                            <div className="text-center">
                                <p className="text-[8px] font-black text-[var(--status-success)] uppercase italic">Resolved</p>
                                <p className="text-xl font-black text-[var(--status-success)] italic">{stats.resolved}</p>
                            </div>
                        </div>
                        <button onClick={fetchFindings} className="p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors">
                            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Filters Bar */}
                <div className="premium-card p-4 mb-8 flex flex-wrap items-center gap-4">

                    <div className="flex items-center gap-2">
                        <Filter size={14} className="text-[var(--text-secondary)]" />
                        <select 
                            value={filterSeverity}
                            onChange={(e) => setFilterSeverity(e.target.value)}
                            className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none"
                        >
                            <option value="all">All Severities</option>
                            <option value="critical">Critical</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>

                        <select 
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none"
                        >
                            <option value="all">All Types</option>
                            <option value="secret">Secret</option>
                            <option value="dependency">Dependency</option>
                            <option value="sast">SAST</option>
                            <option value="iac">IaC</option>
                            <option value="dast">DAST</option>
                        </select>

                        <select 
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none"
                        >
                            <option value="all">All Status</option>
                            <option value="open">Open</option>
                            <option value="resolved">Resolved</option>
                        </select>

                        <select 
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none"
                        >
                            <option value="date">Sort: Recent</option>
                            <option value="severity">Sort: Severity</option>
                            <option value="repo">Sort: Repo</option>
                        </select>
                    </div>

                    <div className="flex bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-1">
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                        >
                            <List size={16} />
                        </button>
                        <button 
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                        >
                            <LayoutGrid size={16} />
                        </button>
                    </div>
                </div>

                {/* Tasks List/Grid */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24">
                        <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] italic">Scanning Task Matrix...</p>
                    </div>
                ) : filteredFindings.length === 0 ? (
                    <div className="premium-card p-24 text-center">
                        <CheckCircle2 className="w-16 h-16 text-[var(--status-success)] mx-auto mb-6 opacity-20" />
                        <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">No Tasks Detected</h3>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-2">The security perimeter is currently clear</p>
                    </div>
                ) : (
                    <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' : 'space-y-4'}>
                        {filteredFindings.map((finding) => {
                            const remainingHours = getSLA(finding.created_at, finding.severity);
                            const isEmergency = remainingHours > 0 && remainingHours < 6;
                            const isOverdue = remainingHours <= 0;

                            return (
                            <div key={finding.$id} className="premium-card group hover:border-[var(--accent-primary)]/40 transition-all relative">
                                <div className={`p-6 ${viewMode === 'list' ? 'flex items-center gap-6' : 'flex flex-col gap-4'}`}>
                                    
                                    <div className="flex items-center gap-3">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedTasks.has(finding.$id)} 
                                            onChange={() => toggleSelection(finding.$id)}
                                            className="w-4 h-4 rounded border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--accent-primary)] focus:ring-[var(--accent-primary)] cursor-pointer"
                                        />
                                    </div>

                                    {/* Action Box */}
                                    <button 
                                        title="Resolve"
                                        onClick={() => finding.status === 'open' && handleResolve(finding.$id)}
                                        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0
                                            ${finding.status === 'resolved' 
                                                ? 'bg-[var(--status-success)]/10 text-[var(--status-success)] cursor-default' 
                                                : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--status-success)] hover:text-[var(--status-success)] hover:bg-[var(--status-success)]/5'}`}
                                    >
                                        {finding.status === 'resolved' ? <CheckCircle size={20} /> : <div className="w-5 h-5 rounded-full border-2 border-current" />}
                                    </button>

                                    <button 
                                        title="AI Blueprint"
                                        className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-yellow-500 hover:border-yellow-500 hover:bg-yellow-500/10 transition-all flex-shrink-0"
                                        onClick={() => handleAIBlueprint(finding.$id)}
                                    >
                                        <Sparkles size={16} />
                                    </button>

                                    <button 
                                        title="Export to GitHub"
                                        className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-white hover:text-white hover:bg-white/10 transition-all flex-shrink-0"
                                        onClick={() => handleGithubSync(finding.$id)}
                                    >
                                        <Github size={16} />
                                    </button>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-1">
                                            <SeverityBadge severity={finding.severity} />
                                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase italic border ${
                                                isOverdue ? 'bg-red-500/20 text-red-500 border-red-500 animate-pulse' :
                                                isEmergency ? 'bg-orange-500/20 text-orange-500 border-orange-500 animate-pulse' :
                                                'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                                            }`}>
                                                {isOverdue ? 'SLA Overdue' : `${Math.floor(remainingHours)}h Remaining`}
                                            </span>
                                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded text-[9px] font-black uppercase italic text-[var(--text-secondary)]">
                                                <TypeIcon type={finding.type} />
                                                {finding.type}
                                            </div>
                                            <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase ml-auto font-mono flex items-center gap-1">
                                                <Clock size={10} />
                                                {new Date(finding.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <h4 className={`text-sm font-black uppercase italic truncate ${finding.status === 'resolved' ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--text-primary)]'}`}>
                                            {finding.title}
                                        </h4>
                                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1 flex items-center gap-2">
                                            <Globe size={12} className="text-[var(--accent-primary)]" />
                                            {finding.repo_name}
                                            <span className="opacity-30">•</span>
                                            <span className="truncate">{finding.file_path}</span>
                                        </p>
                                    </div>

                                    {viewMode === 'list' && (
                                        <div className="flex items-center gap-2">
                                            <button className="p-2 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors">
                                                <ChevronRight size={20} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            );
                        })}
                    </div>
                )}

                {/* Floating Bottom Bar for Bulk Actions */}
                {selectedTasks.size > 0 && (
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[var(--bg-secondary)]/90 backdrop-blur-md border border-[var(--border-color)] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-6 z-50 animate-in slide-in-from-bottom-10">
                        <span className="text-xs font-black uppercase text-[var(--text-primary)] italic">
                            {selectedTasks.size} Selected
                        </span>
                        <div className="flex gap-3">
                            <button onClick={handleBulkAcknowledge} className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-opacity-90 text-white text-[10px] font-black uppercase rounded-lg italic transition-all">Bulk Acknowledge</button>
                            <button onClick={handleBulkDismiss} className="px-4 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white text-[10px] font-black uppercase rounded-lg italic transition-all">Bulk Dismiss</button>
                        </div>
                    </div>
                )}
                {/* AI Blueprint Modal */}
                {aiModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
                                <div className="flex items-center gap-2 text-yellow-500">
                                    <Sparkles size={18} />
                                    <h3 className="font-black uppercase italic tracking-wide">AI Remediation Blueprint</h3>
                                </div>
                                <button onClick={() => setAiModalOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                                {aiBlueprintLoading ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Loader2 className="w-8 h-8 text-yellow-500 animate-spin mb-4" />
                                        <p className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] italic">Analyzing Task Parameters...</p>
                                    </div>
                                ) : (
                                    <div className="prose prose-invert prose-sm max-w-none">
                                        <pre className="whitespace-pre-wrap font-mono text-[11px] text-[var(--text-primary)] bg-[var(--bg-primary)] p-4 rounded-xl border border-[var(--border-subtle)] overflow-x-auto custom-scrollbar">
                                            {aiBlueprintContent}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
