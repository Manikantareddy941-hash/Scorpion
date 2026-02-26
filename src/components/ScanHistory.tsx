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
            <div className="bg-white dark:bg-slate-900 p-12 text-center rounded-[2rem] border border-slate-200 dark:border-slate-700">
                <Clock className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">No scans recorded yet</p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="divide-y divide-slate-100">
                {scans.map(scan => (
                    <div key={scan.id} className="p-5 hover:bg-slate-50 dark:bg-slate-800/50 transition-all flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                            <div className={`p-2 rounded-xl ${scan.status === 'completed' ? 'bg-green-50' :
                                scan.status === 'failed' ? 'bg-red-50' : 'bg-blue-50 animate-pulse'
                                }`}>
                                {scan.status === 'completed' ? <CheckCircle className="w-4 h-4 text-green-600" /> :
                                    scan.status === 'failed' ? <XCircle className="w-4 h-4 text-red-600" /> :
                                        <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />}
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="font-black text-xs text-slate-900 dark:text-white uppercase tracking-tighter">Audit #{scan.id.slice(0, 6)}</span>
                                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${scan.status === 'completed' ? 'text-green-600 bg-green-50' :
                                            scan.status === 'failed' ? 'text-red-600 bg-red-50' : 'text-blue-600 bg-blue-50'
                                        }`}>{scan.status}</span>
                                </div>
                                <div className="flex items-center gap-3 text-[9px] font-bold text-slate-400 uppercase tracking-widest italic">
                                    <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {new Date(scan.created_at).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        {scan.status === 'completed' && (
                            <div className="text-right">
                                <div className="flex items-center gap-1 justify-end">
                                    <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                                    <span className="text-sm font-black text-slate-900 dark:text-white italic tracking-tighter">{scan.details?.security_score || 0}%</span>
                                </div>
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Score</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};



