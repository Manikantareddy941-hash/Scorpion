import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    TrendingUp,
    Filter, Loader2, FileDown,
    Database, Clock, ChevronDown, ChevronUp, Package, Hash, Zap, ExternalLink, ArrowLeft, X
} from 'lucide-react';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } from 'docx';

import { useAuth } from '../contexts/AuthContext';
import { databases, DB_ID, COLLECTIONS, Query, functions } from '../lib/appwrite';
import RemediationPanel from '../components/RemediationPanel';
import logoImg from '../assets/pre-final_logo-removebg-preview.png';

const getRepoName = (url?: string) => {
    if (!url) return 'Unknown Repository';
    try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) return `${parts[0]}/${parts[1].replace('.git', '')}`;
        if (parts.length === 1) return parts[0].replace('.git', '');
        return url;
    } catch {
        return url;
    }
};

export default function Reports() {
    const navigate = useNavigate();
    const { getJWT } = useAuth();
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [stats, setStats] = useState<any>(null);
    const [scans, setScans] = useState<any[]>([]);
    const [repos, setRepos] = useState<Record<string, any>>({});
    const [scope, setScope] = useState<'global' | 'team' | 'project'>('global');
    const [expandedScans, setExpandedScans] = useState<Set<string>>(new Set<string>());
    const [findingsByScan, setFindingsByScan] = useState<Record<string, any[]>>({});
    const [loadingFindings, setLoadingFindings] = useState<Set<string>>(new Set());
    const [fixingFindings, setFixingFindings] = useState<Record<string, { loading: boolean, prUrl?: string, error?: string }>>({});
    const [selectedVulnId, setSelectedVulnId] = useState<string | null>(null);
    const [printableFindings, setPrintableFindings] = useState<any[]>([]);
    const [printableVulnerabilities, setPrintableVulnerabilities] = useState<any[]>([]);
    const [printablePolicies, setPrintablePolicies] = useState<any[]>([]);
    const [printableScan, setPrintableScan] = useState<any>(null);
    const [printableComplianceScore, setPrintableComplianceScore] = useState(100);
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportStep, setExportStep] = useState<'select-scan' | 'select-format'>('select-scan');
    const [selectedExportScanId, setSelectedExportScanId] = useState<string | null>(null);
    const [pdfColorMode, setPdfColorMode] = useState(true);
    const { getGithubToken } = useAuth();
    const scopeId = '';

    useEffect(() => {
        fetchData();
    }, [scope, scopeId]);

    useEffect(() => {
        console.log('[DEBUG] selectedVulnId changed to:', selectedVulnId);
    }, [selectedVulnId]);

    const fetchData = async () => {
        setLoading(true);
        const token = await getJWT();
        const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

        // Fetch Stats
        try {
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
        } catch (err) {
            console.error('Error fetching reporting stats:', err);
            // Default stats if backend goes down
            setStats({ totalVulns: 0, criticalVulns: 0, activeRepos: 0, scannedToday: 0 });
        }

        // Fetch Repositories for mapping names
        try {
            console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.REPOSITORIES}`);
            if (!COLLECTIONS.REPOSITORIES) throw new Error("collectionId is undefined");
            const repoList = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES);
            const repoMap: Record<string, any> = {};
            repoList.documents.forEach(r => {
                repoMap[r.$id] = r;
            });
            setRepos(repoMap);
        } catch (err) {
            console.error('Error fetching repositories:', err);
        }

        // Fetch Scans
        try {
            console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
            if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
            const scanList = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.orderDesc('startedAt'),
                Query.limit(50)
            ]);
            console.log('Fetched scans in Reports:', scanList.documents);
            setScans(scanList.documents);
        } catch (err) {
            console.error('Error fetching scans:', err);
        }

        setLoading(false);
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
                console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
                if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
                const response = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
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

    const handleExport = async (colorMode: boolean = true) => {
        if (!selectedExportScanId) return;
        setPdfColorMode(colorMode);
        setShowExportModal(false);
        setGenerating(true);
        try {
            // 1. Fetch the specific scan record
            console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
            if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
            const scanDoc = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, selectedExportScanId);
            setPrintableScan({
                ...scanDoc,
                details: typeof scanDoc.details === 'string' ? JSON.parse(scanDoc.details) : scanDoc.details
            });

            // 2. Fetch Vulnerabilities 
            console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
            if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
            const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                Query.equal('scanId', selectedExportScanId),
                Query.limit(500)
            ]);
            setPrintableFindings(vulnsRes.documents);
            setPrintableVulnerabilities(vulnsRes.documents);

            // 3. Fetch Policy Evaluations

            // 4. Fetch Policy Evaluations (for compliance section)
            try {
                console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.POLICY_EVALUATIONS}`);
                if (!COLLECTIONS.POLICY_EVALUATIONS) throw new Error("collectionId is undefined");
                const policiesRes = await databases.listDocuments(DB_ID, COLLECTIONS.POLICY_EVALUATIONS, [
                    Query.equal('scan_id', selectedExportScanId),
                    Query.limit(100)
                ]);
                setPrintablePolicies(policiesRes.documents);
            } catch (err) {
                console.warn('Failed to fetch policy evaluations:', err);
                setPrintablePolicies([]);
            }

            // Calculate compliance score
            const failedScans = new Set(vulnsRes.documents.filter(f => f.tool === 'policy_violation').map(f => f.scanId));
            setPrintableComplianceScore(Math.max(0, Math.round(((1) / 1) * 100))); // Simplified since it's 1 scan
            if (failedScans.size > 0) setPrintableComplianceScore(0);

            // Wait for React to render the hidden container
            await new Promise(r => setTimeout(r, 1000));

            const element = document.getElementById('audit-report-container');
            if (element) {
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
        }
    };

    const handleExportDocx = async () => {
        if (!selectedExportScanId) return;
        setShowExportModal(false);
        setGenerating(true);
        try {
            // 1. Fetch detailed data
            console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
            if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
            const scanDoc = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, selectedExportScanId);
            const details = typeof scanDoc.details === 'string' ? JSON.parse(scanDoc.details) : scanDoc.details;

            console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
            if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
            const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                Query.equal('scanId', selectedExportScanId),
                Query.limit(500)
            ]);
            const allFindings = vulnsRes.documents;
            const vulnerabilities = vulnsRes.documents;

            console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.POLICY_EVALUATIONS}`);
            if (!COLLECTIONS.POLICY_EVALUATIONS) throw new Error("collectionId is undefined");
            const policiesRes = await databases.listDocuments(DB_ID, COLLECTIONS.POLICY_EVALUATIONS, [
                Query.equal('scan_id', selectedExportScanId),
                Query.limit(100)
            ]);
            const policies = policiesRes.documents;

            // Compliance Grade
            const failedPolicyFindings = allFindings.filter(f => f.tool === 'policy_violation');
            const score = failedPolicyFindings.length > 0 ? 0 : 100;

            const docElements = [];

            // Header
            docElements.push(new Paragraph({
                children: [
                    new TextRun({ text: "SCORPION SECURITY AUDIT", bold: true, size: 36, color: "06b6d4" })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 }
            }));

            // 1. Scan Metadata
            docElements.push(new Paragraph({ text: "SCAN METADATA", heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
            const metadataTable = new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Repository:", bold: true })] })] }),
                            new TableCell({ children: [new Paragraph({ text: getRepoName(scanDoc.repoUrl) })] }),
                        ]
                    }),
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Scan Date:", bold: true })] })] }),
                            new TableCell({ children: [new Paragraph({ text: scanDoc.startedAt ? new Date(scanDoc.startedAt).toLocaleString() : new Date().toLocaleString() })] }),
                        ]
                    }),
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Tools Used:", bold: true })] })] }),
                            new TableCell({ children: [new Paragraph({ text: details?.tools?.join(', ').toUpperCase() || "TRIVY, SEMGREP, GITLEAKS" })] }),
                        ]
                    }),
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Scan Duration:", bold: true })] })] }),
                            new TableCell({ children: [new Paragraph({ text: (details?.completed_at && scanDoc.startedAt) ? `${Math.round((new Date(details.completed_at).getTime() - new Date(scanDoc.startedAt).getTime()) / 1000)}s` : "N/A" })] }),
                        ]
                    }),
                ]
            });
            docElements.push(metadataTable);
            docElements.push(new Paragraph({ text: "" }));

            // 2. Codebase Analysis
            docElements.push(new Paragraph({ text: "CODEBASE ANALYSIS", heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
            docElements.push(new Paragraph({
                children: [
                    new TextRun({ text: "Files Scanned: ", bold: true }),
                    new TextRun({ text: `${details?.total_files || 'N/A'}` }),
                    new TextRun({ text: " | ", bold: false }),
                    new TextRun({ text: "Lines Analyzed: ", bold: true }),
                    new TextRun({ text: `${details?.total_lines?.toLocaleString() || 'N/A'}` }),
                ]
            }));
            docElements.push(new Paragraph({ text: "" }));

            // 3. Summary Statistics
            docElements.push(new Paragraph({ text: "SUMMARY STATISTICS", heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
            const statsTable = new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Severity", bold: true })] })], shading: { fill: "f1f5f9" } }),
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Count", bold: true })] })], shading: { fill: "f1f5f9" } }),
                        ]
                    }),
                    ...['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(sev => new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph({ text: sev })] }),
                            new TableCell({ children: [new Paragraph({ text: `${allFindings.filter(f => f.severity === sev).length}` })] }),
                        ]
                    }))
                ]
            });
            docElements.push(statsTable);
            docElements.push(new Paragraph({ text: "" }));

            // 4. Compliance Health
            docElements.push(new Paragraph({ text: "COMPLIANCE HEALTH", heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
            docElements.push(new Paragraph({
                children: [
                    new TextRun({ text: `Grade: ${score}% PASS`, bold: true, color: score >= 90 ? "10b981" : "ef4444", size: 24 })
                ]
            }));
            docElements.push(new Paragraph({ text: `Active Guardrails Validated: ${policies.length || 0}` }));
            policies.forEach(p => {
                docElements.push(new Paragraph({
                    text: `• [${p.result.toUpperCase()}] ${p.policy_name}`,
                    bullet: { level: 0 }
                }));
            });
            docElements.push(new Paragraph({ text: "" }));

            // 5. Vulnerability Matrix
            docElements.push(new Paragraph({ text: "DETAILED VULNERABILITY MATRIX", heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));

            if (vulnerabilities.length === 0) {
                docElements.push(new Paragraph({ text: "No findings detected. Environment is fully secure." }));
            } else {
                vulnerabilities.forEach(v => {
                    const finding = allFindings.find(f => f.title === v.title || f.package === v.file_path);
                    docElements.push(new Paragraph({ children: [new TextRun({ text: `[${v.severity.toUpperCase()}] ${v.title || v.message.split(':')[0]}`, bold: true, color: v.severity === 'critical' ? 'ef4444' : v.severity === 'high' ? 'f97316' : 'eab308' })], spacing: { before: 150 } }));
                    docElements.push(new Paragraph({ children: [new TextRun({ text: "File: ", bold: true }), new TextRun({ text: v.file_path || 'N/A' })] }));
                    docElements.push(new Paragraph({ children: [new TextRun({ text: "Line: ", bold: true }), new TextRun({ text: `${v.line_number || 'N/A'}` })] }));
                    docElements.push(new Paragraph({ text: v.message || finding?.description || 'No description provided.' }));
                    if (finding?.fixedVersion || v.fix_version) {
                        docElements.push(new Paragraph({ children: [new TextRun({ text: "Remediation: ", bold: true, color: "10b981" }), new TextRun({ text: `Upgrade to ${finding?.fixedVersion || v.fix_version}` })] }));
                    }
                    docElements.push(new Paragraph({ children: [new TextRun({ text: "------------------------------------------------------------", color: "cbd5e1" })] }));
                });
            }

            const doc = new Document({
                sections: [{ properties: {}, children: docElements }]
            });

            const blob = await Packer.toBlob(doc);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `SCORPION_Audit_${scanDoc.$createdAt ? new Date(scanDoc.$createdAt).toISOString().split('T')[0] : 'Report'}.docx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error('Docx Export failed:', err);
            alert(`Export Failed: ${err.message || 'An unexpected error occurred during generation.'}`);
        } finally {
            setGenerating(false);
        }
    };

    const handleExportSBOM = async (format: 'json' | 'csv') => {
        if (!selectedExportScanId) return;
        setShowExportModal(false);
        setGenerating(true);
        try {
            const scan = scans.find(s => s.$id === selectedExportScanId);
            const repo = repos[scan?.repo_id] || {};
            const repoUrl = repo.repo_url || repo.url || '';

            console.log('[SBOM Debug]', { repoUrl, repo, scan });

            if (!repoUrl) throw new Error('Repository URL not found for this scan.');

            const params = new URLSearchParams({ format });
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const res = await fetch(`${apiBase}/api/sbom/${scan.repo_id}?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Server error ${res.status}`);
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sbom-${repo.name || scan.repo_id}-${Date.now()}.${format}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err: any) {
            alert(`SBOM Export Failed: ${err.message}`);
        } finally {
            setGenerating(false);
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

                    <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
                        <div className="relative w-full md:w-auto">
                            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
                            <select
                                value={scope}
                                onChange={(e) => setScope(e.target.value as any)}
                                className="pl-12 pr-10 py-3.5 w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/10 transition-all font-black text-[10px] uppercase tracking-widest italic appearance-none text-[var(--text-primary)]"
                            >
                                <option value="global">Organization Matrix</option>
                                <option value="team">Cluster Isolation</option>
                                <option value="project">Unit Resolution</option>
                            </select>
                        </div>

                        <div className="flex gap-3 w-full md:w-auto">
                            <button
                                onClick={() => {
                                    setSelectedExportScanId(null);
                                    setExportStep('select-scan');
                                    setShowExportModal(true);
                                }}
                                disabled={generating}
                                className="w-full md:w-auto px-6 py-3 bg-[var(--accent-primary)] hover:bg-[var(--accent-secondary)] text-white border-2 border-[var(--accent-primary)] hover:border-[var(--accent-secondary)] rounded-xl font-black uppercase italic tracking-widest text-[11px] transition-all flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(56,189,248,0.2)] disabled:opacity-80"
                            >
                                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                                {generating ? 'GENERATING...' : 'EXPORT RESULTS'}
                            </button>
                        </div>
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

                                    if (isExpanded) {
                                        console.log(`Scan details for ${scan.$id}:`, { findings, isLoading });
                                    }

                                    return (
                                        <React.Fragment key={scan.$id}>
                                            <tr
                                                className={`hover:bg-[var(--text-primary)]/5 transition-colors group cursor-pointer ${isExpanded ? 'bg-[var(--text-primary)]/5' : ''}`}
                                                onClick={(e) => {
                                                    console.log('[DEBUG] Parent Scan Row Clicked:', scan.$id);
                                                    toggleScanExpansion(scan.$id);
                                                }}
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
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                console.log('[DEBUG] Opening Remediation for Finding ID:', finding.$id);
                                                                                if (!finding.$id) {
                                                                                    console.error('[ERROR] Finding ID is missing from document:', finding);
                                                                                }
                                                                                if (finding.$id) {
                                                                                    setSelectedVulnId(finding.$id);
                                                                                } else {
                                                                                    console.error('[ERROR] Cannot open remediation: Finding ID is null/empty');
                                                                                }
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
                    key={selectedVulnId}
                    documentId={selectedVulnId}
                    onClose={() => {
                        console.log('[DEBUG] RemediationPanel onClose triggered');
                        setSelectedVulnId(null);
                    }}
                />
            )}

            {/* Export Modal */}
            {showExportModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
                    <div className="w-full max-w-3xl bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl p-8 shadow-2xl shadow-black/50 relative flex flex-col max-h-[90vh]">
                        <button
                            onClick={() => setShowExportModal(false)}
                            className="absolute top-6 right-6 p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/10 rounded-lg transition-colors z-10"
                        >
                            <X size={24} />
                        </button>

                        <div className="mb-6 flex-shrink-0">
                            <h2 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-widest mb-2 flex items-center gap-3">
                                <FileDown className="w-8 h-8 text-[var(--accent-primary)]" />
                                {exportStep === 'select-scan' ? 'Select Scan to Export' : 'Select Export Format'}
                            </h2>
                            <p className="text-sm font-medium text-[var(--text-secondary)]">
                                {exportStep === 'select-scan' ? 'Choose a completed scan report from the list below.' : 'Select format to package the Scorpion Security Audit.'}
                            </p>
                        </div>

                        {exportStep === 'select-scan' ? (
                            <>
                                <div className="space-y-3 overflow-y-auto flex-grow pr-2 fancy-scrollbar">
                                    {scans.filter(s => s.status.toLowerCase() === 'completed' || s.status.toLowerCase() === 'success' || s.status.toLowerCase() === 'finished').length === 0 ? (
                                        <div className="text-center py-10 text-[var(--text-secondary)] italic">No completed scans available to export.</div>
                                    ) : scans.filter(s => s.status.toLowerCase() === 'completed' || s.status.toLowerCase() === 'success' || s.status.toLowerCase() === 'finished').map(scan => (
                                        <div
                                            key={scan.$id}
                                            onClick={() => setSelectedExportScanId(scan.$id)}
                                            className={`p-4 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${selectedExportScanId === scan.$id
                                                ? 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)] shadow-[0_0_15px_rgba(56,189,248,0.15)] ring-1 ring-[var(--accent-primary)]'
                                                : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50'
                                                }`}
                                        >
                                            <div className="flex flex-col gap-1">
                                                <div className="text-[12px] font-black text-[var(--text-primary)] uppercase tracking-wide">
                                                    {getRepoName(scan.repoUrl)}
                                                </div>
                                                <div className="text-[10px] text-[var(--text-secondary)] flex items-center gap-2 font-mono">
                                                    <span>{new Date(scan.$createdAt).toLocaleString()}</span>
                                                    <span>•</span>
                                                    <span className="bg-[var(--text-primary)]/5 px-2 py-0.5 rounded">{scan.language || 'UNKNOWN'}</span>
                                                    <span className="text-[var(--status-success)]">{scan.status}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4 text-[10px] font-bold">
                                                <div className="flex items-center gap-1.5 min-w-[60px] justify-center px-2 py-1 rounded bg-[var(--text-primary)]/5">
                                                    <Zap className="w-3.5 h-3.5 text-red-500" />
                                                    <span>{scan.finding_count || 0}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 min-w-[60px] justify-center px-2 py-1 rounded bg-[var(--text-primary)]/5">
                                                    <Hash className="w-3.5 h-3.5 text-orange-500" />
                                                    <span>{scan.bugCount || 0}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-6 flex justify-end flex-shrink-0 pt-4 border-t border-[var(--border-subtle)]">
                                    <button
                                        onClick={() => setExportStep('select-format')}
                                        disabled={!selectedExportScanId}
                                        className="px-8 py-3 bg-[var(--accent-primary)] hover:bg-[var(--accent-secondary)] text-white rounded-xl font-black uppercase italic tracking-widest text-[11px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Next Step
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-shrink-0">
                                    <button
                                        onClick={() => handleExport(true)}
                                        className="flex flex-col items-center text-center p-8 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)] rounded-xl transition-all group hover:bg-[var(--accent-primary)]/5"
                                    >
                                        <div className="w-16 h-16 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                            <FileDown className="w-8 h-8" />
                                        </div>
                                        <h3 className="text-[14px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2">PDF Color</h3>
                                        <p className="text-[11px] text-[var(--text-secondary)] font-medium leading-relaxed">Preserves the dashboard's cyan accents and severity badge coloring.</p>
                                    </button>

                                    <button
                                        onClick={() => handleExport(false)}
                                        className="flex flex-col items-center text-center p-8 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--text-primary)]/50 rounded-xl transition-all group hover:bg-[var(--text-primary)]/5"
                                    >
                                        <div className="w-16 h-16 bg-[var(--text-primary)]/10 text-[var(--text-primary)] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                            <FileDown className="w-8 h-8" />
                                        </div>
                                        <h3 className="text-[14px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2">PDF B&W</h3>
                                        <p className="text-[11px] text-[var(--text-secondary)] font-medium leading-relaxed">Clean, printer-friendly grayscale layout.</p>
                                    </button>

                                    <button
                                        onClick={handleExportDocx}
                                        className="flex flex-col items-center text-center p-8 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[#60a5fa] rounded-xl transition-all group hover:bg-[#60a5fa]/5"
                                    >
                                        <div className="w-16 h-16 bg-[#60a5fa]/10 text-[#60a5fa] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                            <FileDown className="w-8 h-8" />
                                        </div>
                                        <h3 className="text-[14px] font-black text-[#60a5fa] uppercase tracking-widest italic mb-2">Word (.docx)</h3>
                                        <p className="text-[11px] text-[var(--text-secondary)] font-medium leading-relaxed">Editable Microsoft Word document.</p>
                                    </button>

                                    {/* SBOM Export */}
                                    <div className="flex flex-col items-center text-center p-8 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[#4ade80] rounded-xl transition-all group hover:bg-[#4ade80]/5">
                                        <div className="w-16 h-16 bg-[#4ade80]/10 text-[#4ade80] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                            <Package className="w-8 h-8" />
                                        </div>
                                        <h3 className="text-[14px] font-black text-[#4ade80] uppercase tracking-widest italic mb-2">SBOM</h3>
                                        <p className="text-[11px] text-[var(--text-secondary)] font-medium leading-relaxed mb-4">CycloneDX bill of materials for all dependencies.</p>
                                        <div className="flex gap-2 mt-auto">
                                            <button
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExportSBOM('json'); }}
                                                className="px-4 py-2 bg-[#4ade80]/10 border border-[#4ade80]/30 rounded-lg text-[10px] font-black uppercase tracking-widest text-[#4ade80] hover:bg-[#4ade80] hover:text-black transition-all"
                                            >
                                                JSON
                                            </button>
                                            <button
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExportSBOM('csv'); }}
                                                className="px-4 py-2 bg-[#4ade80]/10 border border-[#4ade80]/30 rounded-lg text-[10px] font-black uppercase tracking-widest text-[#4ade80] hover:bg-[#4ade80] hover:text-black transition-all"
                                            >
                                                CSV
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-6 flex justify-start flex-shrink-0 pt-4">
                                    <button
                                        onClick={() => setExportStep('select-scan')}
                                        className="px-6 py-2 bg-transparent hover:bg-[var(--text-primary)]/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl font-black uppercase italic tracking-widest text-[10px] transition-all flex items-center gap-2"
                                    >
                                        <ArrowLeft className="w-3 h-3" /> Back
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Hidden Printable Container for PDF Export */}
            <div
                id="audit-report-container"
                style={{
                    position: 'absolute',
                    left: '-9999px',
                    top: 0,
                    opacity: 1,
                    zIndex: -1,
                    width: '210mm',
                    minHeight: '297mm',
                    background: pdfColorMode ? '#0B1121' : '#ffffff',
                    color: pdfColorMode ? '#e2e8f0' : '#000000',
                    padding: '60px',
                    fontFamily: 'monospace',
                    printColorAdjust: 'exact',
                    WebkitPrintColorAdjust: 'exact',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #06b6d4', paddingBottom: '30px', marginBottom: '30px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <img src={logoImg} style={{ width: '45px', height: '45px' }} />
                        <div>
                            <h1 style={{ margin: 0, textTransform: 'uppercase', fontStyle: 'italic', fontWeight: 900, fontSize: '28px', letterSpacing: '3px', color: '#06b6d4' }}>SCORPION</h1>
                            <p style={{ margin: 0, fontSize: '10px', fontWeight: 'bold', color: '#94a3b8', letterSpacing: '4px', textTransform: 'uppercase' }}>Security Audit Intelligence</p>
                        </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#06b6d4' }}>REPORT ID: {printableScan?.$id?.slice(-8).toUpperCase()}</div>
                        <div style={{ fontSize: '10px', color: '#64748b' }}>GENERATED: {new Date().toLocaleString()}</div>
                    </div>
                </div>

                {/* 1. COVER SECTION / METADATA */}
                <div style={{ marginBottom: '40px' }}>
                    <h2 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#06b6d4', marginBottom: '15px', borderLeft: '4px solid #06b6d4', paddingLeft: '10px' }}>Scan Metadata</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px', fontSize: '12px', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px' }}>
                        <div><strong style={{ color: '#94a3b8' }}>REPOSITORY:</strong> <span style={{ color: '#fff' }}>{printableScan ? getRepoName(printableScan.repoUrl) : 'N/A'}</span></div>
                        <div><strong style={{ color: '#94a3b8' }}>SCAN DATE:</strong> <span style={{ color: '#fff' }}>{printableScan ? new Date(printableScan.$createdAt).toLocaleString() : 'N/A'}</span></div>
                        <div><strong style={{ color: '#94a3b8' }}>LANGUAGE:</strong> <span style={{ color: '#fff' }}>{printableScan?.details?.language || printableScan?.language || 'HYBRID'}</span></div>
                        <div><strong style={{ color: '#94a3b8' }}>STATUS:</strong> <span style={{ color: '#4ade80', fontWeight: 'bold' }}>{printableScan?.status?.toUpperCase() || 'COMPLETED'}</span></div>
                        <div><strong style={{ color: '#94a3b8' }}>TOOLS USED:</strong> <span style={{ color: '#fff' }}>{printableScan?.details?.tools?.join(', ').toUpperCase() || 'TRIVY, SEMGREP, GITLEAKS'}</span></div>
                        <div><strong style={{ color: '#94a3b8' }}>SCAN DURATION:</strong> <span style={{ color: '#fff' }}>
                            {printableScan?.details?.completed_at ?
                                `${Math.round((new Date(printableScan.details.completed_at).getTime() - new Date(printableScan.$createdAt).getTime()) / 1000)}s`
                                : '34s'}
                        </span></div>
                    </div>
                </div>

                {/* 2. CODE DETAILS */}
                <div style={{ marginBottom: '40px' }}>
                    <h2 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#06b6d4', marginBottom: '15px', borderLeft: '4px solid #06b6d4', paddingLeft: '10px' }}>Codebase Analysis</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px', fontSize: '12px', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px' }}>
                        <div><strong style={{ color: '#94a3b8' }}>FILES SCANNED:</strong> <span style={{ color: '#fff' }}>{printableScan?.details?.total_files || 'N/A'}</span></div>
                        <div><strong style={{ color: '#94a3b8' }}>LINES ANALYZED:</strong> <span style={{ color: '#fff' }}>{printableScan?.details?.total_lines?.toLocaleString() || 'N/A'}</span></div>
                    </div>
                </div>

                {/* 3. SUMMARY STATISTICS */}
                <div style={{ marginBottom: '40px' }}>
                    <h2 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#06b6d4', marginBottom: '15px', borderLeft: '4px solid #06b6d4', paddingLeft: '10px' }}>Summary Statistics</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                        {[
                            { label: 'CRITICAL', count: printableFindings.filter(f => f.severity === 'CRITICAL').length, color: '#f87171' },
                            { label: 'HIGH', count: printableFindings.filter(f => f.severity === 'HIGH').length, color: '#fb923c' },
                            { label: 'MEDIUM', count: printableFindings.filter(f => f.severity === 'MEDIUM').length, color: '#fbbf24' },
                            { label: 'LOW', count: printableFindings.filter(f => f.severity === 'LOW').length, color: '#4ade80' }
                        ].map(stat => (
                            <div key={stat.label} style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${stat.color}33`, padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 'black', marginBottom: '5px' }}>{stat.label}</div>
                                <div style={{ fontSize: '24px', fontWeight: 900, color: stat.color }}>{stat.count}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 4. COMPLIANCE SECTION */}
                <div style={{ marginBottom: '40px', padding: '25px', backgroundColor: 'rgba(6, 182, 212, 0.05)', border: '1px solid rgba(6, 182, 212, 0.2)', borderRadius: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '20px' }}>
                        <h2 style={{ color: '#06b6d4', fontSize: '18px', textTransform: 'uppercase', margin: 0 }}>Compliance Health</h2>
                        <div style={{ fontSize: '32px', fontWeight: 900, color: printableComplianceScore >= 90 ? '#4ade80' : '#f87171' }}>{printableComplianceScore}% GRADE</div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
                        Policy validation engine executed {printablePolicies.length || 0} active guardrails.
                        Overall posture: <strong style={{ color: '#fff' }}>{printableComplianceScore >= 90 ? 'SATISFACTORY' : 'IMMEDIATE ATTENTION REQUIRED'}</strong>.
                    </div>
                    {printablePolicies.length > 0 && (
                        <div style={{ marginTop: '15px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {printablePolicies.map(p => (
                                <span key={p.$id} style={{ fontSize: '9px', padding: '3px 8px', borderRadius: '4px', background: p.result === 'pass' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: p.result === 'pass' ? '#4ade80' : '#f87171', border: `1px solid ${p.result === 'pass' ? '#4ade8033' : '#f8717133'}` }}>
                                    {p.policy_name} ({p.result.toUpperCase()})
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* 5. VULNERABILITY MATRIX */}
                <h2 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#06b6d4', marginBottom: '15px', borderLeft: '4px solid #06b6d4', paddingLeft: '10px' }}>Detailed Vulnerability Matrix</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {printableVulnerabilities.length === 0 ? (
                        <div style={{ color: '#4ade80', fontSize: '13px', background: 'rgba(74,222,128,0.05)', padding: '20px', borderRadius: '12px', border: '1px dashed #4ade8033' }}>
                            Zero deep-level vulnerabilities detected. Repository structure maintains high security integrity.
                        </div>
                    ) : printableVulnerabilities.map(v => {
                        const finding = printableFindings.find(f => f.title === v.title || f.package === v.file_path);
                        return (
                            <div key={v.$id} style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '20px', borderRadius: '12px', background: 'rgba(255,255,255,0.02)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{
                                            backgroundColor: v.severity === 'critical' ? 'rgba(248,113,113,0.15)' : v.severity === 'high' ? 'rgba(251,146,60,0.15)' : v.severity === 'medium' ? 'rgba(251,191,36,0.15)' : 'rgba(74,222,128,0.15)',
                                            color: v.severity === 'critical' ? '#f87171' : v.severity === 'high' ? '#fb923c' : v.severity === 'medium' ? '#fbbf24' : '#4ade80',
                                            padding: '4px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 'black', textTransform: 'uppercase'
                                        }}>
                                            {v.severity}
                                        </span>
                                        <strong style={{ color: '#fff', fontSize: '13px' }}>{v.title || v.message.split(':')[0]}</strong>
                                    </div>
                                    <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>TOOL: {v.tool?.toUpperCase()}</span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px' }}>
                                    <div>
                                        <div style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '2px' }}>File Path</div>
                                        <div style={{ fontSize: '11px', color: '#38bdf8' }}>{v.file_path || 'N/A'}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '2px' }}>Line Number</div>
                                        <div style={{ fontSize: '11px', color: '#38bdf8' }}>{v.line_number || 'N/A'}</div>
                                    </div>
                                </div>

                                <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '12px', lineHeight: 1.5 }}>
                                    {v.message || finding?.description}
                                </div>

                                {(finding?.fixedVersion || v.fix_version) && (
                                    <div style={{ fontSize: '10px', color: '#4ade80', background: 'rgba(74,222,128,0.05)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(74,222,128,0.1)' }}>
                                        <strong style={{ textTransform: 'uppercase' }}>Remediation:</strong> Upgrade to version {finding?.fixedVersion || v.fix_version} or apply structural patch.
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}


