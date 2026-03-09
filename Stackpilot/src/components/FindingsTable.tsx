import { Terminal, Clock, ExternalLink, Sparkles, Loader2, Plus } from 'lucide-react';

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
            <div className="card p-24 text-center">
                <div className="logo-mark !w-12 !h-12 mx-auto mb-6 !text-xl opacity-20">SP</div>
                <p className="text-[13px] text-text-muted font-medium italic">No security vulnerabilities detected in the current fleet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {findings.map(vuln => (
                <div key={vuln.$id} className="card group hover:border-accent/30 transition-all">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-3">
                                <SeverityBadge severity={vuln.severity} />
                                <span className="text-[11px] font-semibold text-text-subtle uppercase tracking-wider flex items-center gap-1.5">
                                    <Terminal className="w-3.5 h-3.5" /> {vuln.tool}
                                </span>
                            </div>
                            <h3 className="text-[17px] font-semibold text-text mb-2 group-hover:text-accent transition-colors leading-snug">
                                {vuln.message}
                            </h3>
                            <div className="flex items-center gap-6 text-[12px] font-medium text-text-muted">
                                <span className="flex items-center gap-1.5 border-b border-border/50 pb-0.5">
                                    {vuln.file_path}{vuln.line_number ? `:${vuln.line_number}` : ''}
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <Clock className="w-3.5 h-3.5 opacity-60" />
                                    {new Date(vuln.$createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {vuln.status !== 'resolved' && onRemediate && (
                                <button
                                    onClick={() => onRemediate(vuln.$id)}
                                    className="btn-ghost !text-[12px] !py-1.5 !px-3 font-semibold"
                                >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Explain Fix
                                </button>
                            )}
                            {vuln.status !== 'resolved' && onConvert && (
                                <button
                                    onClick={() => onConvert(vuln.$id)}
                                    disabled={convertingId === vuln.$id}
                                    className="btn-primary !text-[12px] !py-1.5 !px-4 font-semibold"
                                >
                                    {convertingId === vuln.$id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                    Convert to Task
                                </button>
                            )}
                            <button className="p-2 text-text-subtle hover:text-text hover:bg-surface rounded transition-colors border border-transparent hover:border-border">
                                <ExternalLink className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

function SeverityBadge({ severity }: { severity: string }) {
    const badgeClass = {
        critical: 'badge-danger',
        high: 'badge-danger',
        medium: 'badge-warning',
        low: 'badge-success',
        info: 'badge-neutral'
    }[severity.toLowerCase()] || 'badge-neutral';

    return (
        <span className={`badge ${badgeClass}`}>
            {severity}
        </span>
    );
}



