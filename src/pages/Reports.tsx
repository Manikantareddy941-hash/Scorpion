import React, { useEffect, useState } from 'react';
import {
    TrendingUp,
    Filter, Loader2, Download,
    Database, Clock, ChevronDown, ChevronUp, Package, Hash, Zap
} from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

export default function Reports() {
    const { getJWT } = useAuth();
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [stats, setStats] = useState<any>(null);
    const [scans, setScans] = useState<any[]>([]);
    const [repos, setRepos] = useState<Record<string, any>>({});
    const [scope, setScope] = useState<'global' | 'team' | 'project'>('global');
    const [expandedScans, setExpandedScans] = useState<Set<string>>(new Set());
    const [findingsByScan, setFindingsByScan] = useState<Record<string, any[]>>({});
    const [loadingFindings, setLoadingFindings] = useState<Set<string>>(new Set());
    const scopeId = '';

    useEffect(() => {
        fetchData();
    }, [scope, scopeId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            // Fetch Stats
            const url = new URL(`${apiBase}/api/reports/stats`);
            url.searchParams.append('scope', scope);
            if (scopeId) url.searchParams.append('id', scopeId);

            const statsRes = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (statsRes.ok) {
                const data = await statsRes.json();
                setStats(data.stats);
            }

            // Fetch Repositories for mapping names
            const repoList = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES);
            const repoMap: Record<string, any> = {};
            repoList.documents.forEach(r => {
                repoMap[r.$id] = r;
            });
            setRepos(repoMap);

            // Fetch Scans
            const scanList = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.orderDesc('$createdAt'),
                Query.limit(50)
            ]);
            setScans(scanList.documents);

        } catch (err) {
            console.error('Error fetching reporting data:', err);
        } finally {
            setLoading(false);
        }
    };

    const toggleScanExpansion = async (scanId: string) => {
        const newExpanded = new Set(expandedScans);
        if (newExpanded.has(scanId)) {
            newExpanded.delete(scanId);
            setExpandedScans(newExpanded);
            return;
        }

        newExpanded.add(scanId);
        setExpandedScans(newExpanded);

        if (!findingsByScan[scanId]) {
            setLoadingFindings(prev => new Set(prev).add(scanId));
            try {
                const response = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [
                    Query.equal('scanId', scanId),
                    Query.limit(100)
                ]);
                setFindingsByScan(prev => ({ ...prev, [scanId]: response.documents }));
            } catch (err) {
                console.error('Failed to fetch findings:', err);
            } finally {
                setLoadingFindings(prev => {
                    const next = new Set(prev);
                    next.delete(scanId);
                    return next;
                });
            }
        }
    };

    const handleExport = async () => {
        setGenerating(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const response = await fetch(`${apiBase}/api/reports/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    scope,
                    id: scopeId,
                    title: `Executive Security Report - ${new Date().toLocaleDateString()}`
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Scorpion_Report_${scope}.pdf`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        } catch (err) {
            console.error('Export failed:', err);
        } finally {
            setGenerating(false);
        }
    };

    if (loading && !stats) return (
        <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <TrendingUp className="w-12 h-12 text-[var(--accent-primary)] animate-pulse" />
                <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic">Synthesizing Posture Data...</h2>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
                            <TrendingUp className="w-7 h-7" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tighter uppercase italic">Executive Intelligence</h1>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">Strategic vulnerability clusters & scan history</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className="relative flex-grow md:flex-grow-0">
                            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
                            <select
                                value={scope}
                                onChange={(e) => setScope(e.target.value as any)}
                                className="pl-12 pr-10 py-3.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/10 transition-all font-black text-[10px] uppercase tracking-widest italic appearance-none text-[var(--text-primary)]"
                            >
                                <option value="global">Organization Matrix</option>
                                <option value="team">Cluster Isolation</option>
                                <option value="project">Unit Resolution</option>
                            </select>
                        </div>

                        <button
                            onClick={handleExport}
                            disabled={generating}
                            className="btn-premium flex items-center gap-3 disabled:opacity-50"
                        >
                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            Export Intelligence
                        </button>
                    </div>
                </div>



                {/* Scan History Section */}
                <div className="premium-card overflow-hidden">
                    <div className="p-8 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--text-primary)]/5">
                        <div className="flex items-center gap-3">
                            <Database className="w-5 h-5 text-[var(--accent-primary)]" />
                            <h2 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">Fleet Scan History</h2>
                        </div>
                        <div className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">{scans.length} Cycles Ingested</div>
                    </div>
                    
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-[9px] font-black uppercase tracking-widest border-b border-[var(--border-subtle)]">
                                <tr>
                                    <th className="px-8 py-5 w-10"></th>
                                    <th className="px-8 py-5">Repository</th>
                                    <th className="px-8 py-5 text-center">Language</th>
                                    <th className="px-8 py-5">Scan Date</th>
                                    <th className="px-8 py-5 text-center">Vulnerabilities</th>
                                    <th className="px-8 py-5 text-center">Bugs</th>
                                    <th className="px-8 py-5 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border-subtle)]">
                                {scans.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-8 py-20 text-center text-[var(--text-secondary)] uppercase italic font-black text-[10px] tracking-widest">
                                            No scan telemetry detected in current matrix
                                        </td>
                                    </tr>
                                ) : scans.map((scan) => {
                                    const repo = repos[scan.repo_id] || {};
                                    const isExpanded = expandedScans.has(scan.$id);
                                    const findings = findingsByScan[scan.$id] || [];
                                    const isLoading = loadingFindings.has(scan.$id);

                                    return (
                                        <React.Fragment key={scan.$id}>
                                            <tr 
                                                className={`hover:bg-[var(--text-primary)]/5 transition-colors group cursor-pointer ${isExpanded ? 'bg-[var(--text-primary)]/5' : ''}`}
                                                onClick={() => toggleScanExpansion(scan.$id)}
                                            >
                                                <td className="px-8 py-6 text-center">
                                                    {isExpanded ? <ChevronUp className="w-4 h-4 text-[var(--accent-primary)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]" />}
                                                </td>
                                                <td className="px-8 py-6">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-black text-[var(--text-primary)] uppercase italic tracking-tight">{repo.name || 'Unknown Unit'}</span>
                                                    <span className="text-[9px] text-[var(--text-secondary)] font-mono mt-0.5">{scan.repo_id}</span>
                                                </div>
                                            </td>
                                            <td className="px-8 py-6 text-center">
                                                <span className="px-3 py-1 bg-[var(--bg-secondary)] rounded-lg text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">
                                                    {repo.language || 'Hybrid'}
                                                </span>
                                            </td>
                                            <td className="px-8 py-6">
                                                <div className="flex items-center gap-2 text-[10px] font-black text-[var(--text-secondary)] uppercase italic tracking-tighter">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    {new Date(scan.$createdAt).toLocaleDateString()} {new Date(scan.$createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </td>
                                            <td className="px-8 py-6 text-center">
                                                <span className={`text-sm font-black italic ${(scan.details?.total_vulnerabilities || 0) > 0 ? 'text-[var(--status-error)]' : 'text-[var(--status-success)]'}`}>
                                                    {scan.details?.total_vulnerabilities || 0}
                                                </span>
                                            </td>
                                            <td className="px-8 py-6 text-center">
                                                <span className="text-sm font-black italic text-[var(--text-secondary)]">
                                                    {scan.details?.tools?.find((t: any) => t.name === 'eslint')?.findings || 0}
                                                </span>
                                            </td>
                                            <td className="px-8 py-6 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${scan.status === 'completed' ? 'bg-[var(--status-success)]' : scan.status === 'failed' ? 'bg-[var(--status-error)]' : 'bg-[var(--accent-primary)] animate-pulse'}`} />
                                                    <span className={`text-[9px] font-black uppercase tracking-widest italic ${scan.status === 'completed' ? 'text-[var(--status-success)]' : scan.status === 'failed' ? 'text-[var(--status-error)]' : 'text-[var(--accent-primary)]'}`}>
                                                        {scan.status}
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <tr>
                                                <td colSpan={7} className="px-8 py-0 bg-[var(--bg-secondary)]/30">
                                                    <div className="py-8 animate-in fade-in slide-in-from-top-2 duration-300">
                                                        <div className="flex flex-wrap items-center gap-4 mb-6 pb-6 border-b border-[var(--border-subtle)]/50">
                                                            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl">
                                                                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Tool:</span>
                                                                <span className="text-[10px] font-black text-[var(--accent-primary)] uppercase italic">Trivy v0.69.3</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl">
                                                                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Scanner Version:</span>
                                                                <span className="text-[10px] font-black text-[var(--text-primary)] uppercase italic">{scan.scannerVersion || 'v0.69.3'}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl">
                                                                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Duration:</span>
                                                                <span className="text-[10px] font-black text-[var(--status-warning)] uppercase italic">
                                                                    {(() => {
                                                                        const diff = new Date(scan.$updatedAt).getTime() - new Date(scan.$createdAt).getTime();
                                                                        const seconds = Math.floor(diff / 1000);
                                                                        if (seconds < 60) return `${seconds}s`;
                                                                        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
                                                                    })()}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl">
                                                                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Findings:</span>
                                                                <span className="text-[10px] font-black text-[var(--status-error)] uppercase italic">{findings.length} Elements</span>
                                                            </div>
                                                        </div>
                                                        {isLoading ? (
                                                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                                                <Loader2 className="w-8 h-8 text-[var(--accent-primary)] animate-spin" />
                                                                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] italic">Decrypting scan findings...</span>
                                                            </div>
                                                        ) : findings.length === 0 ? (
                                                            <div className="text-center py-12">
                                                                <Zap className="w-10 h-10 text-[var(--status-success)] opacity-20 mx-auto mb-4" />
                                                                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] italic">No critical anomalies detected in this cycle</p>
                                                            </div>
                                                        ) : (
                                                            <div className="grid grid-cols-1 gap-4">
                                                                {findings.map((finding) => (
                                                                    <div key={finding.$id} className="p-6 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl group/finding hover:border-[var(--accent-primary)]/30 transition-all">
                                                                        <div className="flex items-start justify-between gap-6">
                                                                            <div className="flex-1">
                                                                                <div className="flex items-center gap-3 mb-3">
                                                                                    <span className={`px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest italic border
                                                                                        ${finding.severity.toLowerCase() === 'critical' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 
                                                                                          finding.severity.toLowerCase() === 'high' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' : 
                                                                                          finding.severity.toLowerCase() === 'medium' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 
                                                                                          'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>
                                                                                        {finding.severity}
                                                                                    </span>
                                                                                    <h4 className="text-xs font-black text-[var(--text-primary)] uppercase italic tracking-tight">{finding.title}</h4>
                                                                                </div>
                                                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <Package className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                                                                                        <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider italic">Package:</span>
                                                                                        <span className="text-[10px] font-black text-[var(--text-primary)] font-mono">{finding.package}</span>
                                                                                    </div>
                                                                                    <div className="flex items-center gap-2">
                                                                                        <Hash className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                                                                                        <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider italic">Version:</span>
                                                                                        <span className="text-[10px] font-black text-[var(--text-primary)] font-mono">{finding.installedVersion}</span>
                                                                                    </div>
                                                                                    {finding.fixedVersion && (
                                                                                        <div className="flex items-center gap-2">
                                                                                            <Zap className="w-3.5 h-3.5 text-[var(--status-success)]" />
                                                                                            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider italic">Fixed In:</span>
                                                                                            <span className="text-[10px] font-black text-[var(--status-success)] font-mono">{finding.fixedVersion}</span>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                                <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed bg-[var(--text-primary)]/5 p-4 rounded-xl border border-[var(--border-subtle)]/50 italic font-medium">
                                                                                    {finding.description}
                                                                                </p>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="mt-12 text-center">
                    <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.4em] italic">
                        Scorpion Governance Intelligence Flow &bull; Real-time Verification Online
                    </p>
                </div>
            </div>
        </div>
    );
}


