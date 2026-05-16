import React, { useState, useEffect } from 'react';
import { 
    FileDown, FileText, Database, Calendar, 
    ArrowRight, Loader2, Shield, Download,
    CheckCircle2, AlertTriangle, Filter, Zap, RefreshCw,
    Search, Cpu, Activity, Scale
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { useLocation, useNavigate } from 'react-router-dom';

export default function Reports() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { getJWT } = useAuth();
    const [repos, setRepos] = useState<any[]>([]);
    const [selectedRepo, setSelectedRepo] = useState<string>('');
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');
    const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);

    const [recentReports, setRecentReports] = useState<any[]>([]);
    const [aiSummary, setAiSummary] = useState<string>('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'infrastructure' | 'security' | 'ai' | 'compliance'>('security');

    useEffect(() => {
        fetchInitialData();
        fetchRecentReports();
    }, []);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const { databases, DB_ID, COLLECTIONS } = await import('../lib/appwrite');
            const res = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES);
            const mappedRepos = res.documents.map((doc: any) => ({
                repo_id: doc.$id,
                repo_name: doc.name || doc.url?.split('/').pop()?.replace('.git', '') || 'Unknown Repo',
                count: doc.vulnerabilityCount || 0
            }));
            setRepos(mappedRepos);
            if (mappedRepos.length > 0) {
                setSelectedRepo(mappedRepos[0].repo_id);
            }
        } catch (err) {
            console.error('Failed to load repositories:', err);
            toast.error('Failed to load repositories');
        } finally {
            setLoading(false);
        }
    };

    const fetchRecentReports = async () => {
        try {
            const { databases, DB_ID, COLLECTIONS, Query } = await import('../lib/appwrite');
            const res = await databases.listDocuments(DB_ID, COLLECTIONS.REPORTS, [
                Query.limit(5),
                Query.orderDesc('$createdAt')
            ]);
            setRecentReports(res.documents);
        } catch (err) {
            console.error('Failed to fetch recent reports:', err);
        }
    };

    const generateAiSummary = async () => {
        setIsAiLoading(true);
        try {
            const token = await getJWT();
            const response = await fetch('/api/reports/ai-summary?range=24h', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('AI generation failed');
            const data = await response.json();
            setAiSummary(data.summary);
            toast.success('AI Security Briefing generated');
        } catch (err: any) {
            toast.error('Failed to generate AI briefing');
        } finally {
            setIsAiLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'ai' && !aiSummary) {
            generateAiSummary();
        }
    }, [activeTab, aiSummary]);

    const handleExport = async () => {
        if (!selectedRepo) {
            toast.error('Please select a repository');
            return;
        }

        setExporting(true);
        try {
            const token = await getJWT();
            const apiBase = '';
            
            const response = await fetch(`${apiBase}/api/reports/export`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    repo_id: selectedRepo,
                    format,
                    from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
                    to: dateTo ? new Date(dateTo).toISOString() : undefined
                })
            });

            if (!response.ok) throw new Error('Export failed on server');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const repoName = repos.find(r => r.repo_id === selectedRepo)?.repo_name || 'repo';
            a.download = `scorpion-report-${repoName}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            // Record in Appwrite
            const { databases, DB_ID, COLLECTIONS, ID } = await import('../lib/appwrite');
            if (user?.$id) {
                await databases.createDocument(DB_ID, COLLECTIONS.REPORTS, ID.unique(), {
                    userId: user.$id,
                    title: `Security Audit: ${repoName}`,
                    type: format,
                    repositoryId: selectedRepo,
                    status: 'completed',
                    createdAt: new Date().toISOString(),
                    data: JSON.stringify({ range: { from: dateFrom, to: dateTo } })
                });
                fetchRecentReports();
            }

            toast.success('Security report exported successfully');
        } catch (err: any) {
            console.error('Export Error:', err);
            toast.error(`Export failed: ${err.message}`);
        } finally {
            setExporting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] p-8 flex flex-col items-center justify-center">
                <FileText className="w-12 h-12 text-[var(--accent-primary)] animate-pulse mb-4" />
                <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
                    <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.3em] italic">Compiling Security Ledger...</p>
                </div>
            </div>
        );
    }

    const headerDetails = {
        infrastructure: { title: 'Infrastructure', desc: 'System & Architecture Reports', icon: <Activity size={32} /> },
        security: { title: 'Security Audits', desc: 'Enterprise-Grade Evidence Generation', icon: <Shield size={32} /> },
        ai: { title: 'AI Security Briefing', desc: 'Automated Posture Assessment', icon: <Zap size={32} /> },
        compliance: { title: 'Compliance Audit', desc: 'Regulatory & Standard Checks', icon: <Scale size={32} /> }
    };
    
    const currentHeader = headerDetails[activeTab];

    const auditSpecsMap = {
        infrastructure: {
            title: "Infrastructure Topology Specs",
            footer: "Infrastructure maps are generated from active network scans and cloud provider APIs.",
            items: [
                { icon: <Activity size={16} className="text-blue-500" />, title: "Network Architecture", desc: "Detailed mapping of VPCs, subnets, and routing tables." },
                { icon: <Cpu size={16} className="text-emerald-500" />, title: "Compute Resources", desc: "Analysis of EC2, Lambda, and container orchestration." },
                { icon: <Database size={16} className="text-purple-500" />, title: "Data Persistence", desc: "Storage configurations, backups, and encryption status." }
            ]
        },
        security: {
            title: "Audit Intelligence Specs",
            footer: "Reports are generated in real-time by analyzing the current findings mesh. Data integrity is verified via Appwrite immutable logs.",
            items: [
                { icon: <Shield size={16} className="text-green-500" />, title: "Security Summary", desc: "Overview of critical, high, and medium risk factors." },
                { icon: <AlertTriangle size={16} className="text-orange-500" />, title: "Vulnerability Matrix", desc: "Detailed mapping of every detected finding with file paths." },
                { icon: <CheckCircle2 size={16} className="text-blue-500" />, title: "Remediation Path", desc: "Recommended upgrade paths and CVE identifiers." }
            ]
        },
        ai: {
            title: "AI Analysis Parameters",
            footer: "AI summaries are generated dynamically via large language models assessing the security state.",
            items: [
                { icon: <Zap size={16} className="text-yellow-500" />, title: "Threat Modeling", desc: "Predictive analysis of attack vectors and surface area." },
                { icon: <Cpu size={16} className="text-indigo-500" />, title: "Anomaly Detection", desc: "Pattern recognition for unusual commit or build behaviors." },
                { icon: <FileText size={16} className="text-rose-500" />, title: "Executive Summary", desc: "High-level risk communication tailored for stakeholders." }
            ]
        },
        compliance: {
            title: "Compliance Standard Specs",
            footer: "Compliance evidence is mapped against latest SOC2, ISO 27001, and HIPAA frameworks.",
            items: [
                { icon: <Scale size={16} className="text-indigo-500" />, title: "Framework Mapping", desc: "Direct alignment of controls to regulatory requirements." },
                { icon: <CheckCircle2 size={16} className="text-emerald-500" />, title: "Policy Enforcement", desc: "Status of mandatory security policies and guardrails." },
                { icon: <FileDown size={16} className="text-cyan-500" />, title: "Auditor Evidence", desc: "Pre-formatted artifacts ready for external compliance audits." }
            ]
        }
    };
    
    const activeTabSpecs = auditSpecsMap[activeTab];

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="flex items-center gap-5">
                        <div className="w-16 h-16 bg-[var(--accent-primary)] rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-[var(--accent-primary)]/20">
                            {currentHeader.icon}
                        </div>
                        <div>
                            <h1 className="text-4xl font-black tracking-tighter uppercase italic leading-none text-[var(--text-primary)]">{currentHeader.title}</h1>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-2">{currentHeader.desc}</p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex flex-wrap items-center gap-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] p-2 rounded-2xl">
                    <TabButton active={activeTab === 'infrastructure'} onClick={() => setActiveTab('infrastructure')} icon={<Activity size={14} />} label="Infrastructure" />
                    <TabButton active={activeTab === 'security'} onClick={() => setActiveTab('security')} icon={<Shield size={14} />} label="Security Audit" />
                    <TabButton active={activeTab === 'ai'} onClick={() => setActiveTab('ai')} icon={<Zap size={14} />} label="AI Briefing" />
                    <TabButton active={activeTab === 'compliance'} onClick={() => setActiveTab('compliance')} icon={<Scale size={14} />} label="Compliance" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    
                    {/* Selection Controls */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="premium-card p-10 space-y-10">
                            
                            {/* Repo Selection */}
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic flex items-center gap-2">
                                    <Database size={12} /> Target Infrastructure
                                </label>
                                <select 
                                    value={selectedRepo}
                                    onChange={(e) => setSelectedRepo(e.target.value)}
                                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl px-6 py-4 text-sm font-black text-[var(--text-primary)] uppercase italic outline-none focus:border-[var(--accent-primary)] transition-all"
                                >
                                    {repos.map(r => (
                                        <option key={r.repo_id} value={r.repo_id}>{r.repo_name} ({r.count} findings)</option>
                                    ))}
                                </select>
                            </div>

                            {/* Date Range */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic flex items-center gap-2">
                                        <Calendar size={12} /> From Date
                                    </label>
                                    <input 
                                        type="date"
                                        value={dateFrom}
                                        onChange={(e) => setDateFrom(e.target.value)}
                                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl px-6 py-4 text-xs font-black text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all"
                                    />
                                </div>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic flex items-center gap-2">
                                        <Calendar size={12} /> To Date
                                    </label>
                                    <input 
                                        type="date"
                                        value={dateTo}
                                        onChange={(e) => setDateTo(e.target.value)}
                                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl px-6 py-4 text-xs font-black text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all"
                                    />
                                </div>
                            </div>

                            {/* Format Selection */}
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic flex items-center gap-2">
                                    <Filter size={12} /> Intelligence Format
                                </label>
                                <div className="flex gap-4">
                                    <button 
                                        onClick={() => setFormat('pdf')}
                                        className={`flex-1 py-4 rounded-2xl border font-black uppercase italic text-xs transition-all flex items-center justify-center gap-3
                                            ${format === 'pdf' ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)] shadow-lg shadow-[var(--accent-primary)]/20' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50'}`}
                                    >
                                        <FileDown size={16} /> PDF Document
                                    </button>
                                    <button 
                                        onClick={() => setFormat('csv')}
                                        className={`flex-1 py-4 rounded-2xl border font-black uppercase italic text-xs transition-all flex items-center justify-center gap-3
                                            ${format === 'csv' ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)] shadow-lg shadow-[var(--accent-primary)]/20' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50'}`}
                                    >
                                        <Database size={16} /> CSV Spreadsheet
                                    </button>
                                </div>
                            </div>

                            <button 
                                onClick={handleExport}
                                disabled={exporting}
                                className="w-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] text-white py-5 rounded-2xl font-black uppercase tracking-widest italic text-sm flex items-center justify-center gap-4 hover:scale-[1.01] transition-all disabled:opacity-50 shadow-2xl shadow-[var(--accent-primary)]/20"
                            >
                                {exporting ? <Loader2 className="animate-spin" /> : <Download size={20} />}
                                {exporting ? 'Compiling Report...' : 'Generate Intelligence Report'}
                            </button>

                        </div>

                        {/* Recent Reports List */}
                        <div className="premium-card p-10">
                            <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-8 italic">Recently Generated Reports</h3>
                            <div className="space-y-4">
                                {recentReports.length > 0 ? recentReports.map((report) => (
                                    <div key={report.$id} className="flex items-center justify-between p-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl group hover:border-[var(--accent-primary)]/40 transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent-primary)] group-hover:scale-110 transition-transform">
                                                <FileText size={18} />
                                            </div>
                                            <div>
                                                <h4 className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">{report.title}</h4>
                                                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">
                                                    {new Date(report.createdAt || report.$createdAt).toLocaleString()} • {report.type}
                                                </p>
                                            </div>
                                        </div>
                                        <CheckCircle2 size={16} className="text-[var(--status-success)] opacity-40" />
                                    </div>
                                )) : (
                                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic text-center py-4">No recent reports found</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Report Preview / Info / AI Summary */}
                    <div className="space-y-6">
                        {activeTab === 'ai' ? (
                            <div className="premium-card p-10 min-h-[500px] flex flex-col">
                                <div className="flex items-center justify-between mb-10">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-white">
                                            <Zap size={20} />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-black uppercase italic text-[var(--text-primary)]">AI Security Briefing</h3>
                                            <p className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em]">Automated Posture Assessment</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={generateAiSummary}
                                        disabled={isAiLoading}
                                        className="p-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-all disabled:opacity-50"
                                    >
                                        <RefreshCw size={16} className={isAiLoading ? 'animate-spin' : ''} />
                                    </button>
                                </div>

                                {isAiLoading ? (
                                    <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                                        <Loader2 className="animate-spin text-indigo-400" size={32} />
                                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest italic animate-pulse">Echo is analyzing your security mesh...</p>
                                    </div>
                                ) : aiSummary ? (
                                    <div className="prose prose-invert prose-sm max-w-none">
                                        <ReactMarkdown
                                            components={{
                                                h1: ({node, ...props}) => <h1 className="text-xl font-black uppercase italic text-indigo-400 mt-6 mb-4" {...props} />,
                                                h2: ({node, ...props}) => <h2 className="text-lg font-black uppercase italic text-indigo-300 mt-5 mb-3" {...props} />,
                                                h3: ({node, ...props}) => <h3 className="text-md font-black uppercase italic text-indigo-200 mt-4 mb-2" {...props} />,
                                                p: ({node, ...props}) => <p className="text-zinc-400 leading-relaxed mb-4 text-[11px] font-medium" {...props} />,
                                                ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-2" {...props} />,
                                                li: ({node, ...props}) => <li className="text-zinc-300 text-[11px]" {...props} />,
                                                strong: ({node, ...props}) => <strong className="text-indigo-200 font-black uppercase" {...props} />,
                                            }}
                                        >
                                            {aiSummary}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
                                        <Zap size={48} className="text-zinc-700" />
                                        <p className="text-xs font-bold text-zinc-500 uppercase italic">No AI Briefing available for this period. <br /> Click refresh to generate.</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="premium-card p-8">
                                    <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-8 italic">{activeTabSpecs.title}</h3>
                                    
                                    <div className="space-y-8">
                                        {activeTabSpecs.items.map((item, idx) => (
                                            <SpecRow key={idx} icon={item.icon} title={item.title} desc={item.desc} />
                                        ))}
                                    </div>

                                    <div className="mt-12 pt-8 border-t border-[var(--border-subtle)]">
                                        <div className="p-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl italic">
                                            <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase leading-relaxed">
                                                {activeTabSpecs.footer}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-8 rounded-3xl bg-gradient-to-br from-indigo-600 to-purple-700 text-white relative overflow-hidden group cursor-pointer" onClick={() => setActiveTab('ai')}>
                                    <h3 className="text-lg font-black uppercase italic leading-tight">SOC2 / ISO 27001 <br /> Compliance Ready</h3>
                                    <p className="text-[10px] font-bold uppercase text-white/70 mt-4">Evidence generated here meets standard auditor requirements for continuous security monitoring.</p>
                                    <Shield className="absolute -right-8 -bottom-8 w-32 h-32 opacity-10 group-hover:scale-110 transition-transform" />
                                </div>
                            </>
                        )}
                    </div>

                </div>

            </div>
        </div>
    );
}

function SpecRow({ icon, title, desc }: { icon: any, title: string, desc: string }) {
    return (
        <div className="flex gap-5">
            <div className="w-10 h-10 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl flex items-center justify-center shrink-0">
                {icon}
            </div>
            <div>
                <h4 className="text-[11px] font-black text-[var(--text-primary)] uppercase italic tracking-tight">{title}</h4>
                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-1 leading-relaxed">{desc}</p>
            </div>
        </div>
    );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: any, label: string }) {
    return (
        <button 
            onClick={onClick}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all flex-1 justify-center ${
                active ? 'bg-[var(--accent-primary)] text-white shadow-lg shadow-[var(--accent-primary)]/20' : 'text-[var(--text-secondary)] hover:bg-[var(--accent-primary)]/10 hover:text-[var(--text-primary)]'
            }`}
        >
            {icon}
            {label}
        </button>
    );
}

