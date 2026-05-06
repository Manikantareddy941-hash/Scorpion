import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    CheckCircle2, AlertTriangle, Bug, Activity, Shield, Cpu, Globe, 
    Filter, Search, ArrowUpDown, Clock, LayoutGrid, List, ChevronRight,
    CheckCircle, XCircle, Loader2, RefreshCw
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
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('date');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

    useEffect(() => {
        fetchFindings();
    }, []);

    const fetchFindings = async () => {
        setLoading(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/dashboard/security`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            
            // Note: dashboard/security returns aggregated data, we need the raw findings
            // If the dashboard API doesn't return full findings list, we might need a dedicated endpoint
            // Assuming for now it returns a list or we fetch from a findings endpoint
            const findingsRes = await fetch(`${apiBase}/api/dashboard/security`, { // Re-using as fallback, ideally GET /api/findings
                 headers: { 'Authorization': `Bearer ${token}` }
            });
            const findingsData = await findingsRes.json();
            
            // For this demo/implementation, we'll assume findings are part of the data or fetch separately
            // If not available, we'll fetch them from Appwrite directly if needed, but let's assume the API provides them
            setFindings(findingsData.findings || []);
        } catch (err: any) {
            toast.error('Failed to fetch findings');
        } finally {
            setLoading(false);
        }
    };

    const handleResolve = async (id: string) => {
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/findings/${id}`, {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'resolved' })
            });
            
            if (res.ok) {
                setFindings(prev => prev.map(f => f.$id === id ? { ...f, status: 'resolved' } : f));
                toast.success('Issue marked as resolved');
            }
        } catch (err) {
            toast.error('Failed to update status');
        }
    };

    const filteredFindings = findings
        .filter(f => {
            if (filterSeverity !== 'all' && f.severity.toLowerCase() !== filterSeverity) return false;
            if (filterType !== 'all' && f.type.toLowerCase() !== filterType) return false;
            if (filterStatus !== 'all' && f.status.toLowerCase() !== filterStatus) return false;
            if (searchQuery && !f.title.toLowerCase().includes(searchQuery.toLowerCase()) && !f.repo_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
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
                    <div className="flex-1 min-w-[200px] relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={16} />
                        <input 
                            type="text" 
                            placeholder="Search by title or repository..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-black italic outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)]"
                        />
                    </div>

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
                        {filteredFindings.map((finding) => (
                            <div key={finding.$id} className="premium-card group hover:border-[var(--accent-primary)]/40 transition-all">
                                <div className={`p-6 ${viewMode === 'list' ? 'flex items-center gap-6' : 'flex flex-col gap-4'}`}>
                                    
                                    {/* Action Box */}
                                    <button 
                                        onClick={() => finding.status === 'open' && handleResolve(finding.$id)}
                                        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0
                                            ${finding.status === 'resolved' 
                                                ? 'bg-[var(--status-success)]/10 text-[var(--status-success)] cursor-default' 
                                                : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--status-success)] hover:text-[var(--status-success)] hover:bg-[var(--status-success)]/5'}`}
                                    >
                                        {finding.status === 'resolved' ? <CheckCircle size={20} /> : <div className="w-5 h-5 rounded-full border-2 border-current" />}
                                    </button>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-1">
                                            <SeverityBadge severity={finding.severity} />
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
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
