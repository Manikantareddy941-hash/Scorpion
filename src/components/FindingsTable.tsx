import { Bug, Terminal, Clock, MessageSquare, ExternalLink, Zap, Sparkles, Loader2 } from 'lucide-react';

interface Finding {
    $id: string;
    tool: string;
    severity: string;
    message: string;
    file_path: string;
    line_number?: number;
    status: 'open' | 'resolved' | 'false_positive';
    $createdAt: string;
}

interface FindingsTableProps {
    findings: Finding[];
    onConvert?: (id: string) => void;
    onRemediate?: (id: string) => void;
    convertingId?: string | null;
}

export const FindingsTable: React.FC<FindingsTableProps> = ({ findings, onConvert, onRemediate, convertingId }) => {
    if (findings.length === 0) {
        return (
            <div className="premium-card p-20 text-center flex flex-col items-center justify-center">
                <div className="bg-[var(--bg-secondary)] w-20 h-20 rounded-3xl flex items-center justify-center mb-6 border border-[var(--border-subtle)]">
                    <Zap className="w-10 h-10 text-[var(--text-secondary)] opacity-30" />
                </div>
                <p className="text-[var(--text-secondary)] font-black uppercase tracking-[0.2em] text-xs italic">No active threats detected. Clean scan.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {findings.map(vuln => (
                <div key={vuln.$id} className="premium-card p-8 group hover:border-[var(--accent-primary)]/50">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-4 mb-4">
                                <SeverityBadge severity={vuln.severity} />
                                <div className="h-4 w-px bg-[var(--border-subtle)]" />
                                <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic flex items-center gap-1.5">
                                    <Bug className="w-3.5 h-3.5" /> {vuln.tool}
                                </span>
                            </div>
                            <h3 className="text-[var(--text-primary)] font-black text-xl tracking-tight mb-3 group-hover:text-[var(--accent-primary)] transition-colors uppercase italic leading-tight">{vuln.message}</h3>
                            <div className="flex flex-wrap items-center gap-8 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic">
                                <span className="flex items-center gap-2"><Terminal className="w-4 h-4 text-[var(--text-secondary)]/50" /> {vuln.file_path}{vuln.line_number ? `:${vuln.line_number}` : ''}</span>
                                <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-[var(--text-secondary)]/50" /> {new Date(vuln.$createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            {vuln.status !== 'resolved' && onRemediate && (
                                <button
                                    onClick={() => onRemediate(vuln.$id)}
                                    className="px-8 py-3.5 bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-2xl hover:bg-[var(--accent-primary)] hover:text-white transition-all font-black text-[10px] uppercase tracking-widest shadow-xl flex items-center gap-2.5"
                                >
                                    <Sparkles className="w-4 h-4 text-[var(--accent-primary)] group-hover:text-white" />
                                    Suggest Fix
                                </button>
                            )}
                            {vuln.status !== 'resolved' && onConvert && (
                                <button
                                    onClick={() => onConvert(vuln.$id)}
                                    disabled={convertingId === vuln.$id}
                                    className="px-8 py-3.5 bg-[var(--accent-primary)] text-white rounded-2xl hover:bg-[var(--accent-secondary)] transition-all font-black text-[10px] uppercase tracking-widest shadow-xl shadow-[var(--accent-primary)]/20 disabled:bg-[var(--bg-secondary)] flex items-center gap-2.5"
                                >
                                    {convertingId === vuln.$id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                                    Convert to Task
                                </button>
                            )}
                            <button className="bg-[var(--bg-primary)] text-[var(--text-secondary)] p-3.5 rounded-2xl border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50 hover:text-[var(--accent-primary)] transition-all flex items-center justify-center">
                                <ExternalLink className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

function SeverityBadge({ severity }: { severity: string }) {
    const config = {
        critical: { bg: 'bg-[var(--severity-critical)]/10', text: 'text-[var(--severity-critical)]', border: 'border-[var(--severity-critical)]/20' },
        high: { bg: 'bg-[var(--severity-high)]/10', text: 'text-[var(--severity-high)]', border: 'border-[var(--severity-high)]/20' },
        medium: { bg: 'bg-[var(--severity-medium)]/10', text: 'text-[var(--severity-medium)]', border: 'border-[var(--severity-medium)]/20' },
        low: { bg: 'bg-[var(--severity-low)]/10', text: 'text-[var(--severity-low)]', border: 'border-[var(--severity-low)]/20' },
        info: { bg: 'bg-[var(--severity-info)]/10', text: 'text-[var(--severity-info)]', border: 'border-[var(--severity-info)]/20' }
    }[severity] || { bg: 'bg-[var(--text-secondary)]/10', text: 'text-[var(--text-secondary)]', border: 'border-[var(--text-secondary)]/20' };

    return (
        <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest italic border flex items-center gap-1.5 ${config.bg} ${config.text} ${config.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${config.text.replace('text-', 'bg-')}`} />
            {severity}
        </span>
    );
}
