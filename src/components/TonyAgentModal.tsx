import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    Cpu, Loader2, X, Terminal, Check, 
    ShieldCheck, AlertTriangle, Play 
} from 'lucide-react';
import toast from 'react-hot-toast';

interface TonyAgentModalProps {
    isOpen: boolean;
    onClose: () => void;
    vulnerabilityId: string;
    onSuccess: () => void;
}

export default function TonyAgentModal({ isOpen, onClose, vulnerabilityId, onSuccess }: TonyAgentModalProps) {
    const { getJWT } = useAuth();
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [diff, setDiff] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<string | null>(null);
    const [impact, setImpact] = useState<string | null>(null);
    const [confidence, setConfidence] = useState<number | null>(null);

    useEffect(() => {
        if (isOpen && vulnerabilityId) {
            generatePatch();
        } else {
            // Reset state on close
            setDiff(null);
            setAnalysis(null);
            setImpact(null);
            setConfidence(null);
        }
    }, [isOpen, vulnerabilityId]);

    const generatePatch = async () => {
        setLoading(true);
        try {
            const token = await getJWT();
            const res = await fetch('/api/remediate/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ vulnerability_id: vulnerabilityId })
            });

            if (!res.ok) throw new Error('Failed to generate fix');
            const data = await res.json();
            
            setDiff(data.diff);
            setAnalysis(data.technical_analysis);
            setImpact(data.impact_assessment);
            setConfidence(data.confidence);
        } catch (err: any) {
            console.error('[TONY Agent Error]', err.message);
            toast.error('Failed to trigger TONY Remediation core');
            onClose();
        } finally {
            setLoading(false);
        }
    };

    const applyPatch = async () => {
        if (!diff) return;
        setApplying(true);
        try {
            const token = await getJWT();
            const res = await fetch('/api/remediate/apply', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    vulnerability_id: vulnerabilityId,
                    diff: diff
                })
            });

            if (!res.ok) throw new Error('Failed to apply patch');
            toast.success('🔓 Patch applied & vulnerability marked as remediated.');
            onSuccess();
            onClose();
        } catch (err: any) {
            console.error('[TONY Apply Error]', err.message);
            toast.error('Failed to commit TONY patch');
        } finally {
            setApplying(false);
        }
    };

    if (!isOpen) return null;

    // Helper to color diff lines nicely
    const renderDiffLine = (line: string, index: number) => {
        let colorClass = "text-zinc-300";
        if (line.startsWith('+') && !line.startsWith('+++')) {
            colorClass = "text-emerald-400 bg-emerald-950/20 px-1 py-0.5 rounded";
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            colorClass = "text-red-400 bg-red-950/20 px-1 py-0.5 rounded";
        } else if (line.startsWith('@@') || line.startsWith('diff') || line.startsWith('---') || line.startsWith('+++')) {
            colorClass = "text-[#00f0ff] opacity-80";
        }
        return (
            <div key={index} className={`font-mono text-[10px] whitespace-pre-wrap leading-relaxed py-0.5 ${colorClass}`}>
                {line}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            {/* Modal Box */}
            <div 
                className={`relative w-full max-w-2xl overflow-hidden rounded-2xl border transition-all duration-500 ease-in-out ${
                    loading ? 'animate-pulse shadow-[0_0_35px_rgba(0,240,255,0.4)] border-[#00f0ff]/50' : 'border-[rgba(255,255,255,0.1)] shadow-[0_15px_50px_rgba(0,0,0,0.6)]'
                }`}
                style={{
                    background: 'rgba(18, 18, 18, 0.9)',
                    backdropFilter: 'blur(32px)',
                    WebkitBackdropFilter: 'blur(32px)',
                }}
            >
                {/* Accent white-and-teal neon top bar ring */}
                <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-teal-400 via-white to-teal-400 animate-pulse" />

                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-[rgba(255,255,255,0.06)]">
                    <div className="flex items-center gap-2">
                        <Cpu className={`text-[#00f0ff] ${loading ? 'animate-spin' : 'animate-pulse'}`} size={18} />
                        <h2 className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)] font-mono">
                            TONY Security Agent
                        </h2>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="text-var(--text-secondary) hover:text-[var(--text-primary)] transition-colors p-1"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="w-10 h-10 text-[#00f0ff] animate-spin mb-4" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-[#00f0ff] animate-pulse font-mono">
                                TONY is scanning codebase & assembling patch...
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Analysis card */}
                            {analysis && (
                                <div className="p-4 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)]">
                                    <h3 className="text-[9px] font-black uppercase tracking-widest text-[#00f0ff] mb-2 font-mono flex items-center gap-1.5">
                                        <Terminal size={12} /> TONY Agent Technical Analysis
                                    </h3>
                                    <p className="text-[10px] text-zinc-300 leading-relaxed font-mono uppercase">
                                        {analysis}
                                    </p>
                                </div>
                            )}

                            {/* Monospace Diff Viewer */}
                            {diff && (
                                <div>
                                    <h3 className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mb-2 font-mono">
                                        Proposed Git Patch Diff
                                    </h3>
                                    <div className="p-4 rounded-lg bg-black border border-[rgba(255,255,255,0.08)] max-h-[250px] overflow-y-auto shadow-inner">
                                        {diff.split('\n').map((line, idx) => renderDiffLine(line, idx))}
                                    </div>
                                </div>
                            )}

                            {/* Confidence and Impact */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {impact && (
                                    <div className="p-3.5 rounded bg-[rgba(255,255,255,0.01)] border border-[rgba(255,255,255,0.04)]">
                                        <h4 className="text-[8px] font-black text-zinc-400 uppercase mb-1 font-mono">Impact Assessment</h4>
                                        <p className="text-[9px] text-zinc-400 leading-relaxed uppercase font-mono">{impact}</p>
                                    </div>
                                )}
                                {confidence !== null && (
                                    <div className="p-3.5 rounded bg-[rgba(255,255,255,0.01)] border border-[rgba(255,255,255,0.04)] flex flex-col justify-between">
                                        <div>
                                            <h4 className="text-[8px] font-black text-zinc-400 uppercase mb-1 font-mono">Confidence rating</h4>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-xl font-black text-emerald-400 font-mono">{(confidence * 100).toFixed(0)}%</span>
                                                <span className="text-[8px] text-zinc-400 font-mono uppercase">Assured</span>
                                            </div>
                                        </div>
                                        <div className="w-full bg-[rgba(255,255,255,0.05)] h-1 rounded-full overflow-hidden mt-2">
                                            <div className="bg-emerald-400 h-full" style={{ width: `${confidence * 100}%` }} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Actions Footer */}
                {!loading && (
                    <div className="px-6 py-4 border-t border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.2)] flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-white border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.02)] transition-colors font-mono"
                        >
                            Decline patch
                        </button>
                        <button
                            disabled={applying || !diff}
                            onClick={applyPatch}
                            className="px-5 py-2.5 rounded text-[9px] font-black uppercase tracking-widest italic flex items-center gap-1.5 text-black hover:scale-[1.02] active:scale-95 transition-all duration-300 font-mono"
                            style={{
                                background: applying ? '#6b7280' : 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
                                boxShadow: applying ? 'none' : '0 4px 15px rgba(20, 184, 166, 0.4)'
                            }}
                        >
                            {applying ? (
                                <>
                                    <Loader2 size={13} className="animate-spin" /> Committing...
                                </>
                            ) : (
                                <>
                                    <ShieldCheck size={13} /> Apply & Commit Patch
                                </>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
