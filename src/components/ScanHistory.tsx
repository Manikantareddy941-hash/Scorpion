import React from 'react';
import { Clock, CheckCircle, XCircle, RefreshCw, Zap } from 'lucide-react';

interface Scan {
    id: string;
    repo_id: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed';
    details: any;
    created_at: string;
}

interface ScanHistoryProps {
    scans: Scan[];
}

export const ScanHistory: React.FC<ScanHistoryProps> = ({ scans }) => {
    if (scans.length === 0) {
        return (
            <div className="bg-[var(--bg-card)] p-12 text-center rounded-[2rem] border border-[var(--border-subtle)]">
                <Clock className="w-8 h-8 text-[var(--text-secondary)] opacity-20 mx-auto mb-3" />
                <p className="text-[var(--text-secondary)] font-bold uppercase tracking-widest text-[10px]">No scans recorded yet</p>
            </div>
        );
    }

    return (
        <div className="bg-[var(--bg-card)] rounded-[2rem] border border-[var(--border-subtle)] overflow-hidden">
            <div className="divide-y divide-[var(--border-subtle)]">
                {scans.map(scan => (
                    <div key={scan.id} className="p-5 hover:bg-[var(--text-primary)]/5 transition-all flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                            <div className={`p-2 rounded-xl ${scan.status === 'completed' ? 'bg-[var(--status-success)]/10' :
                                scan.status === 'failed' ? 'bg-[var(--status-error)]/10' : 'bg-[var(--accent-primary)]/10 animate-pulse'
                                }`}>
                                {scan.status === 'completed' ? <CheckCircle className="w-4 h-4 text-[var(--status-success)]" /> :
                                    scan.status === 'failed' ? <XCircle className="w-4 h-4 text-[var(--status-error)]" /> :
                                        <RefreshCw className="w-4 h-4 text-[var(--accent-primary)] animate-spin" />}
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="font-black text-xs text-[var(--text-primary)] uppercase tracking-tighter">Audit #{scan.id.slice(0, 6)}</span>
                                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${scan.status === 'completed' ? 'text-[var(--status-success)] bg-[var(--status-success)]/10' :
                                            scan.status === 'failed' ? 'text-[var(--status-error)] bg-[var(--status-error)]/10' : 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                                        }`}>{scan.status}</span>
                                </div>
                                <div className="flex items-center gap-3 text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic">
                                    <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {new Date(scan.created_at).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        {scan.status === 'completed' && (
                            <div className="text-right">
                                <div className="flex items-center gap-1 justify-end">
                                    <Zap className="w-3 h-3 text-[var(--status-warning)] fill-[var(--status-warning)]" />
                                    <span className="text-sm font-black text-[var(--text-primary)] italic tracking-tighter">{scan.details?.security_score || 0}%</span>
                                </div>
                                <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Score</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};



