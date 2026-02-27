import { Bug, Terminal, Clock, MessageSquare, ExternalLink, Zap, Sparkles, Loader2 } from 'lucide-react';

interface Finding {
    id: string;
    tool: string;
    severity: string;
    message: string;
    file_path: string;
    line_number?: number;
    status: 'open' | 'resolved' | 'false_positive';
    created_at: string;
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
                <div className="bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 w-20 h-20 rounded-3xl flex items-center justify-center mb-6 border border-slate-100 dark:border-slate-800 dark:border-slate-800">
                    <Zap className="w-10 h-10 text-slate-200 dark:text-slate-700" />
                </div>
                <p className="text-slate-400 font-black uppercase tracking-[0.2em] text-xs italic">No active threats detected. Clean scan.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {findings.map(vuln => (
                <div key={vuln.id} className="premium-card p-8 group hover:border-blue-600/50">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-4 mb-4">
                                <SeverityBadge severity={vuln.severity} />
                                <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
                                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest italic flex items-center gap-1.5">
                                    <Bug className="w-3.5 h-3.5" /> {vuln.tool}
                                </span>
                            </div>
                            <h3 className="text-slate-900 dark:text-white font-black text-xl tracking-tight mb-3 group-hover:text-blue-600 transition-colors uppercase italic leading-tight">{vuln.message}</h3>
                            <div className="flex flex-wrap items-center gap-8 text-[11px] font-bold text-slate-400 uppercase tracking-widest italic">
                                <span className="flex items-center gap-2"><Terminal className="w-4 h-4 text-slate-300 dark:text-slate-600" /> {vuln.file_path}{vuln.line_number ? `:${vuln.line_number}` : ''}</span>
                                <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-slate-300 dark:text-slate-600" /> {new Date(vuln.created_at).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            {vuln.status !== 'resolved' && onRemediate && (
                                <button
                                    onClick={() => onRemediate(vuln.id)}
                                    className="px-8 py-3.5 bg-slate-900 dark:bg-slate-800 text-white rounded-2xl hover:bg-blue-600 dark:hover:bg-blue-600 transition-all font-black text-[10px] uppercase tracking-widest shadow-xl shadow-slate-200 dark:shadow-none flex items-center gap-2.5"
                                >
                                    <Sparkles className="w-4 h-4 text-blue-400" />
                                    Suggest Fix
                                </button>
                            )}
                            {vuln.status !== 'resolved' && onConvert && (
                                <button
                                    onClick={() => onConvert(vuln.id)}
                                    disabled={convertingId === vuln.id}
                                    className="px-8 py-3.5 bg-blue-600 text-white rounded-2xl hover:bg-black transition-all font-black text-[10px] uppercase tracking-widest shadow-xl shadow-blue-500/20 disabled:bg-slate-200 dark:disabled:bg-slate-800 flex items-center gap-2.5"
                                >
                                    {convertingId === vuln.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                                    Convert to Task
                                </button>
                            )}
                            <button className="bg-[var(--bg-primary)] text-slate-400 p-3.5 rounded-2xl border border-[var(--border-subtle)] hover:border-blue-600/50 hover:text-blue-600 transition-all flex items-center justify-center">
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
        critical: { bg: 'bg-rose-600', text: 'text-white', shadow: 'shadow-rose-500/20' },
        high: { bg: 'bg-rose-50 dark:bg-rose-500/10', text: 'text-rose-600', shadow: 'border-rose-100 dark:border-rose-500/20' },
        medium: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-600', shadow: 'border-amber-100 dark:border-amber-500/20' },
        low: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-600', shadow: 'border-emerald-100 dark:border-emerald-500/20' },
        info: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-600', shadow: 'border-blue-100 dark:border-blue-500/20' }
    }[severity] || { bg: 'bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-500/10', text: 'text-slate-600 dark:text-slate-300', shadow: 'border-slate-100 dark:border-slate-800 dark:border-slate-500/20' };

    return (
        <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest italic border flex items-center gap-1.5 ${config.bg} ${config.text} ${config.shadow}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${config.text.replace('text-', 'bg-')}`} />
            {severity}
        </span>
    );
}



