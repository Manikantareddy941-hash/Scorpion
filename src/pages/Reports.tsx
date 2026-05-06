import React, { useState, useEffect } from 'react';
import { 
    FileDown, FileText, Database, Calendar, 
    ArrowRight, Loader2, Shield, Download,
    CheckCircle2, AlertTriangle, Filter
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function Reports() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [repos, setRepos] = useState<any[]>([]);
    const [selectedRepo, setSelectedRepo] = useState<string>('');
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');
    const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        fetchInitialData();
    }, []);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/dashboard/security`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setRepos(data.by_repo || []);
            if (data.by_repo && data.by_repo.length > 0) {
                setSelectedRepo(data.by_repo[0].repo_id);
            }
        } catch (err) {
            console.error('Failed to load repositories:', err);
            toast.error('Failed to load repositories');
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async () => {
        if (!selectedRepo) {
            toast.error('Please select a repository');
            return;
        }

        setExporting(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            
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
            a.download = `scorpion-report-${selectedRepo}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
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

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8">
            <div className="max-w-5xl mx-auto space-y-12">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="flex items-center gap-5">
                        <div className="w-16 h-16 bg-[var(--accent-primary)] rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-[var(--accent-primary)]/20">
                            <FileText size={32} />
                        </div>
                        <div>
                            <h1 className="text-4xl font-black tracking-tighter uppercase italic leading-none text-[var(--text-primary)]">Security Audits</h1>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-2">Enterprise-Grade Evidence Generation</p>
                        </div>
                    </div>
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
                    </div>

                    {/* Report Preview / Info */}
                    <div className="space-y-6">
                        <div className="premium-card p-8">
                            <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-8 italic">Audit Intelligence Specs</h3>
                            
                            <div className="space-y-8">
                                <SpecRow icon={<Shield size={16} className="text-green-500" />} title="Security Summary" desc="Overview of critical, high, and medium risk factors." />
                                <SpecRow icon={<AlertTriangle size={16} className="text-orange-500" />} title="Vulnerability Matrix" desc="Detailed mapping of every detected finding with file paths." />
                                <SpecRow icon={<CheckCircle2 size={16} className="text-blue-500" />} title="Remediation Path" desc="Recommended upgrade paths and CVE identifiers." />
                            </div>

                            <div className="mt-12 pt-8 border-t border-[var(--border-subtle)]">
                                <div className="p-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl italic">
                                    <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase leading-relaxed">
                                        Reports are generated in real-time by analyzing the current findings mesh. Data integrity is verified via Appwrite immutable logs.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-8 rounded-3xl bg-gradient-to-br from-indigo-600 to-purple-700 text-white relative overflow-hidden group">
                            <h3 className="text-lg font-black uppercase italic leading-tight">SOC2 / ISO 27001 <br /> Compliance Ready</h3>
                            <p className="text-[10px] font-bold uppercase text-white/70 mt-4">Evidence generated here meets standard auditor requirements for continuous security monitoring.</p>
                            <Shield className="absolute -right-8 -bottom-8 w-32 h-32 opacity-10 group-hover:scale-110 transition-transform" />
                        </div>
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
