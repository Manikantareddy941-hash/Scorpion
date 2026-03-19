import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    TrendingUp,
    Filter, Loader2, FileDown,
    Database, Clock, ChevronDown, ChevronUp, Package, Hash, Zap, ExternalLink, ArrowLeft, X
} from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { databases, DB_ID, COLLECTIONS, Query, functions } from '../lib/appwrite';
import RemediationPanel from '../components/RemediationPanel';
import logoImg from '../assets/scorpionlegs-removebg-preview.png';

export default function Reports() {
    const navigate = useNavigate();
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
    const [fixingFindings, setFixingFindings] = useState<Record<string, { loading: boolean, prUrl?: string, error?: string }>>({});
    const [selectedVulnId, setSelectedVulnId] = useState<string | null>(null);
    const [printableFindings, setPrintableFindings] = useState<any[]>([]);
    const [printableComplianceScore, setPrintableComplianceScore] = useState(100);
    const [showAuditOverlay, setShowAuditOverlay] = useState(false);
    const { getGithubToken } = useAuth();
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
            // First, fetch ALL findings for the current scans list so they are in the printed DOM
            const scanIds = scans.map(s => s.$id);
            if (scanIds.length > 0) {
                const chunkSize = 100;
                let allFindings: any[] = [];
                for (let i = 0; i < scanIds.length; i += chunkSize) {
                    const chunk = scanIds.slice(i, i + chunkSize);
                    const res = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [
                        Query.equal('scanId', chunk),
                        Query.limit(500)
                    ]);
                    allFindings.push(...res.documents);
                }
                setPrintableFindings(allFindings);
                // Also compute the gauge score
                const failedScans = new Set(allFindings.filter(f => f.type === 'policy_violation').map(f => f.scanId));
                setPrintableComplianceScore(Math.max(0, Math.round(((scanIds.length - failedScans.size) / scanIds.length) * 100)));
            }
            
            // Wait for React to render the hidden container with the specific details
            await new Promise(r => setTimeout(r, 500));
            
            const element = document.getElementById('audit-report-container');
            if (element) {
                console.log("PDF Capture Started");
                
                // Trigger Visibility State
                setShowAuditOverlay(true);

                // Allow DOM to update and trigger native print layout
                setTimeout(() => {
                    window.print();
                    setGenerating(false);
                }, 500);
            }
        } catch (err: any) {
            console.error('PDF Export failed:', err);
            if (err.code === 403 || err.message?.toLowerCase().includes('permission') || err.message?.toLowerCase().includes('unauthorized')) {
                alert('Permission Denied: You do not have the required access to generate this export.');
            } else {
                alert(`Export Failed: ${err.message || 'An unexpected error occurred during generation.'}`);
            }
            setGenerating(false);
            setShowAuditOverlay(false);
        }
    };

    const handleFixVulnerability = async (finding: any, scan: any) => {
        const token = await getGithubToken();
        if (!token) {
            alert('GitHub connection required to automate remediation.');
            return;
        }

        const repo = repos[scan.repo_id];
        if (!repo) {
            setFixingFindings((prev: any) => ({ ...prev, [finding.$id]: { loading: false, error: 'Repository information missing' } }));
            return;
        }

        setFixingFindings((prev: any) => ({ ...prev, [finding.$id]: { loading: true } }));
        
        try {
            // Extract repo full name from URL if not direct
            let repoFullName = repo.fullName || repo.name;
            if (repo.repo_url && repo.repo_url.includes('github.com')) {
                const parts = repo.repo_url.split('github.com/')[1].split('/');
                repoFullName = `${parts[0]}/${parts[1]}`.replace('.git', '');
            }

            const payload = {
                providerAccessToken: token,
                repoFullName,
                filePath: finding.location || 'package.json',
                packageName: finding.package,
                oldVersion: finding.installedVersion,
                fixedVersion: finding.fixedVersion,
                cveId: finding.title
            };

            const execution = await functions.createExecution('github-remediator', JSON.stringify(payload));
            let result;
            try {
                result = execution.responseBody ? JSON.parse(execution.responseBody) : { error: 'Empty response from remediation engine' };
            } catch (e) {
                console.error('Failed to parse remediation response:', execution.responseBody);
                result = { error: 'Invalid response format from remediation engine' };
            }

            if (result.prUrl) {
                setFixingFindings((prev: any) => ({ ...prev, [finding.$id]: { loading: false, prUrl: result.prUrl } }));
            } else {
                setFixingFindings((prev: any) => ({ ...prev, [finding.$id]: { loading: false, error: result.error || 'Remediation failed' } }));
            }
        } catch (err: any) {
            setFixingFindings((prev: any) => ({ ...prev, [finding.$id]: { loading: false, error: err.message } }));
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
                <button onClick={() => navigate('/')} className="mb-6 px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)]/50 transition-all flex items-center gap-2 group/btn w-fit">
                    <ArrowLeft className="w-3.5 h-3.5 group-hover/btn:-translate-x-1 transition-transform" />
                    Back to Dashboard
                </button>
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
                            className="px-6 py-3 bg-[var(--accent-primary)] hover:bg-[var(--accent-secondary)] text-white border-2 border-[var(--accent-primary)] hover:border-[var(--accent-secondary)] rounded-xl font-black uppercase italic tracking-widest text-[11px] transition-all flex items-center gap-3 shadow-[0_0_20px_rgba(56,189,248,0.2)] disabled:opacity-80"
                        >
                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                            {generating ? 'Generating PDF...' : 'Export Compliance Audit'}
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
                                    let findings = findingsByScan[scan.$id] || [];
                                    const isLoading = loadingFindings.has(scan.$id);

                                    // DEV: Inject mock finding if none exist
                                    if (import.meta.env.DEV && findings.length === 0 && !isLoading) {
                                        findings = [{
                                            $id: `mock-id-${scan.$id}`,
                                            title: 'CVE-2024-TEST-MOCK',
                                            severity: 'CRITICAL',
                                            package: 'lodash',
                                            installedVersion: '4.17.20',
                                            fixedVersion: '4.17.21',
                                            location: 'package.json',
                                            description: 'Mock vulnerability for remediation testing.'
                                        }];
                                    }

                                    if (isExpanded) {
                                        console.log(`Scan details for ${scan.$id}:`, { findings, isLoading });
                                    }

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
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 pb-8 border-b border-[var(--border-subtle)]/50">
                                                            {/* Column 1: Identity & Status */}
                                                            <div className="space-y-4">
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic opacity-50">Unit Identity</span>
                                                                    <span className="text-xs font-black text-[var(--accent-primary)] uppercase italic tracking-tighter">{repo.name || 'Unknown Unit'}</span>
                                                                </div>
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic opacity-50">Resource Locator</span>
                                                                    <span className="text-[10px] font-mono text-[var(--text-primary)] truncate block opacity-80">{repo.repo_url || repo.url || 'Internal Resource'}</span>
                                                                </div>
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic opacity-50">Active Status</span>
                                                                    <div className="flex items-center gap-2 mt-1">
                                                                        <div className={`w-2 h-2 rounded-full ${scan.status === 'completed' ? 'bg-[var(--status-success)]' : 'bg-[var(--accent-primary)] animate-pulse'}`} />
                                                                        <span className="text-[11px] font-black uppercase italic tracking-widest text-[var(--text-primary)]">{scan.status}</span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Column 2: Technical Breakdown */}
                                                            <div className="space-y-4">
                                                                <div className="flex flex-col gap-2">
                                                                    <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic opacity-50">Anomaly Distribution</span>
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {[
                                                                            { label: 'Crit', count: scan.criticalCount || 0, color: 'bg-red-500/10 text-red-500 border-red-500/20' },
                                                                            { label: 'High', count: scan.highCount || 0, color: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
                                                                            { label: 'Med', count: scan.mediumCount || 0, color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
                                                                            { label: 'Low', count: scan.lowCount || 0, color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' }
                                                                        ].map(sev => (
                                                                            <div key={sev.label} className={`px-2 py-1 border rounded-lg flex items-center gap-2 ${sev.color}`}>
                                                                                <span className="text-[8px] font-black uppercase tracking-widest">{sev.label}</span>
                                                                                <span className="text-[10px] font-black">{sev.count}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-4">
                                                                    <div className="flex flex-col gap-1">
                                                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic opacity-50">Analysis Core</span>
                                                                        <span className="text-[10px] font-black text-[var(--accent-primary)] uppercase italic">Trivy v0.69.3</span>
                                                                    </div>
                                                                    <div className="flex flex-col gap-1">
                                                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic opacity-50">Cycle Duration</span>
                                                                        <span className="text-[10px] font-black text-[var(--status-warning)] uppercase italic">
                                                                            {(() => {
                                                                                const diff = new Date(scan.$updatedAt).getTime() - new Date(scan.$createdAt).getTime();
                                                                                const seconds = Math.floor(diff / 1000);
                                                                                if (seconds < 60) return `${seconds}s`;
                                                                                return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
                                                                            })()}
                                                                        </span>
                                                                    </div>
                                                                </div>
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
                                                                {findings.map((finding: any) => (
                                                                    <div 
                                                                        key={finding.$id} 
                                                                        onClick={() => {
                                                                            setSelectedVulnId(finding.$id);
                                                                            window.dispatchEvent(new CustomEvent('ai_prompt', { detail: `I need help fixing a ${finding.severity.toUpperCase()} finding in ${finding.package}. The title is: ${finding.title}` }));
                                                                        }}
                                                                        className="p-6 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl group/finding hover:border-[var(--accent-primary)]/30 transition-all cursor-pointer relative overflow-hidden"
                                                                    >
                                                                        <div className="flex items-start justify-between gap-6">
                                                                            <div className="flex-1">
                                                                                <div className="flex items-center justify-between mb-3">
                                                                                    <div className="flex items-center gap-3">
                                                                                        <span className={`px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest italic border
                                                                                            ${finding.severity.toLowerCase() === 'critical' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 
                                                                                            finding.severity.toLowerCase() === 'high' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' : 
                                                                                            finding.severity.toLowerCase() === 'medium' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 
                                                                                            'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>
                                                                                            {finding.severity}
                                                                                        </span>
                                                                                        <h4 className="text-xs font-black text-[var(--text-primary)] uppercase italic tracking-tight">{finding.title}</h4>
                                                                                    </div>
                                                                                    
                                                                                    {finding.fixedVersion && (
                                                                                        <div className="flex items-center gap-3">
                                                                                            {fixingFindings[finding.$id]?.error && (
                                                                                                <span className="text-[9px] font-bold text-[var(--status-error)] uppercase italic animate-in fade-in transition-all">
                                                                                                    {fixingFindings[finding.$id].error}
                                                                                                </span>
                                                                                            )}
                                                                                            {fixingFindings[finding.$id]?.prUrl ? (
                                                                                                <a 
                                                                                                    href={fixingFindings[finding.$id].prUrl}
                                                                                                    target="_blank"
                                                                                                    rel="noopener noreferrer"
                                                                                                    className="flex items-center gap-2 px-4 py-2 bg-[var(--status-success)]/10 text-[var(--status-success)] border border-[var(--status-success)]/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-[var(--status-success)] transition-all animate-in zoom-in duration-300 shadow-lg shadow-[var(--status-success)]/10"
                                                                                                >
                                                                                                    View PR <ExternalLink size={12} />
                                                                                                </a>
                                                                                            ) : (
                                                                                                <button
                                                                                                    onClick={(e) => { e.stopPropagation(); handleFixVulnerability(finding, scan); }}
                                                                                                    disabled={fixingFindings[finding.$id]?.loading}
                                                                                                    className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-[var(--accent-primary)] hover:text-white transition-all disabled:opacity-50"
                                                                                                >
                                                                                                    {fixingFindings[finding.$id]?.loading ? (
                                                                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                                                                    ) : <Zap size={12} />}
                                                                                                    Fix This
                                                                                                </button>
                                                                                            )}
                                                                                        </div>
                                                                                    )}
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

            {selectedVulnId && (
                <RemediationPanel 
                    vulnerabilityId={selectedVulnId} 
                    onClose={() => setSelectedVulnId(null)} 
                />
            )}

            {/* Hidden Printable Container for PDF Export */}
            <div 
                id="audit-report-container" 
                style={{ 
                    position: showAuditOverlay ? 'fixed' : 'absolute', 
                    left: showAuditOverlay ? 0 : '-9999px', 
                    top: 0, 
                    opacity: showAuditOverlay ? 1 : 0,
                    zIndex: showAuditOverlay ? 9999 : -1,
                    width: '210mm', 
                    minHeight: '297mm', 
                    background: '#0B1121', 
                    color: '#38bdf8', 
                    padding: '40px', 
                    fontFamily: 'monospace',
                    overflowY: showAuditOverlay ? 'auto' : 'hidden',
                    height: showAuditOverlay ? '100vh' : 'auto'
                }}
            >
                {showAuditOverlay && (
                    <button 
                        onClick={() => setShowAuditOverlay(false)} 
                        title="Close Audit Report"
                        style={{ position: 'fixed', top: '20px', right: '30px', zIndex: 10000, background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid #f87171', borderRadius: '50%', padding: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        className="hover:scale-110 hover:bg-red-500/20 transition-all shadow-[0_0_20px_rgba(248,113,113,0.3)]"
                    >
                        <X size={20} />
                    </button>
                )}
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid #38bdf8', paddingBottom: '20px', marginBottom: '20px' }}>
                    <img src={logoImg} style={{ width: '40px', height: '40px' }} />
                    <h1 style={{ margin: 0, textTransform: 'uppercase', fontStyle: 'italic', fontWeight: 900, fontSize: '24px', letterSpacing: '2px', color: '#fff' }}>SCORPION Security Audit</h1>
                </div>
                
                <div style={{ marginBottom: '40px', padding: '20px', backgroundColor: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '10px' }}>
                    <h2 style={{ color: '#fff', fontSize: '18px', textTransform: 'uppercase', marginTop: 0, borderBottom: '1px solid rgba(56,189,248,0.2)', paddingBottom: '10px' }}>Compliance Health</h2>
                    <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '15px' }}>This environment is <strong style={{color: '#fff'}}>{printableComplianceScore}%</strong> compliant based on {printableFindings.filter(f => f.type === 'policy_violation').length || 0} active guardrails.</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px', fontSize: '48px', fontWeight: 900, color: printableComplianceScore >= 90 ? '#4ade80' : printableComplianceScore >= 70 ? '#fbbf24' : '#f87171' }}>
                        {printableComplianceScore}% PASS
                    </div>
                </div>
                
                <h2 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', fontSize: '16px', textTransform: 'uppercase', color: '#fff' }}>Vulnerability Matrix</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
                    {printableFindings.length === 0 ? (
                        <div style={{ color: '#4ade80', fontSize: '14px' }}>No findings detected in recent scan coverage. Environment is fully secure.</div>
                    ) : printableFindings.map(f => (
                        <div key={f.$id} style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '15px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <strong style={{ color: f.severity === 'CRITICAL' ? '#f87171' : f.severity === 'HIGH' ? '#fb923c' : f.severity === 'MEDIUM' ? '#fbbf24' : '#60a5fa' }}>
                                    [{f.severity}] {f.title}
                                </strong>
                                <span style={{ fontSize: '10px', color: '#94a3b8' }}>{f.package} ({f.installedVersion})</span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{f.description}</div>
                            {f.fixedVersion && <div style={{ fontSize: '11px', color: '#4ade80', fontWeight: 'bold' }}>Remediation Action Available: Upgrade {f.package} to {f.fixedVersion}</div>}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}


