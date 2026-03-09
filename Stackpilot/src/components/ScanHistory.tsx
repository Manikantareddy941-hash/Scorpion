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
            <div className="card p-12 text-center">
                <Clock className="w-8 h-8 text-text-subtle opacity-20 mx-auto mb-4" />
                <p className="text-[13px] text-text-muted font-medium italic">No scan history available for this asset.</p>
            </div>
        );
    }

    return (
        <div className="card !p-0 overflow-hidden divide-y divide-border">
            {scans.map(scan => (
                <div key={scan.id} className="p-4 hover:bg-surface/50 transition-colors flex items-center justify-between group">
                    <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${scan.status === 'completed' ? 'bg-success-light text-success' :
                            scan.status === 'failed' ? 'bg-danger-light text-danger' : 'bg-accent-light text-accent animate-pulse'
                            }`}>
                            {scan.status === 'completed' ? <CheckCircle className="w-4 h-4" /> :
                                scan.status === 'failed' ? <XCircle className="w-4 h-4" /> :
                                    <RefreshCw className="w-4 h-4 animate-spin" />}
                        </div>
                        <div>
                            <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-[13px] font-semibold text-text">Audit #{scan.id.slice(0, 6)}</span>
                                <span className={`badge !py-0 !px-1.5 !text-[9px] ${scan.status === 'completed' ? 'badge-success' :
                                    scan.status === 'failed' ? 'badge-danger' : 'badge-neutral'
                                    }`}>{scan.status}</span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] font-medium text-text-muted">
                                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 opacity-60" /> {new Date(scan.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        </div>
                    </div>

                    {scan.status === 'completed' && (
                        <div className="text-right">
                            <div className="flex items-center gap-1.5 justify-end">
                                <Zap className="w-3.5 h-3.5 text-warning fill-warning/20" />
                                <span className="text-[15px] font-bold text-text italic tracking-tight">{scan.details?.security_score || 0}%</span>
                            </div>
                            <p className="text-[10px] font-semibold text-text-subtle uppercase tracking-wider">Health Score</p>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};



