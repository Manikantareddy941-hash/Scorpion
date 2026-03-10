import { useState, useEffect } from 'react';
import { X, Sparkles, ThumbsUp, ThumbsDown, CheckCircle, Info, Loader2, Code, GitPullRequest, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react';

interface RemediationPanelProps {
    vulnerabilityId: string;
    onClose: () => void;
}

export default function RemediationPanel({ vulnerabilityId, onClose }: RemediationPanelProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [fix, setFix] = useState<any>(null);
    const [feedbackSent, setFeedbackSent] = useState(false);
    const [prLoading, setPrLoading] = useState(false);
    const [prResult, setPrResult] = useState<{ url: string; branch: string } | null>(null);

    useEffect(() => {
        fetchFix();
    }, [vulnerabilityId]);

    const trackEvent = async (action: 'viewed' | 'accepted' | 'ignored', suggestionId?: string, confidence?: number) => {
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            await fetch(`${apiBase}/api/ai/metrics/event`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    finding_id: vulnerabilityId,
                    suggestion_id: suggestionId,
                    action,
                    confidence_score: confidence
                })
            });
        } catch (err) {
            console.error('Failed to track AI event:', err);
        }
    };

    const fetchFix = async () => {
        setLoading(true);
        setError('');
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const response = await fetch(`${apiBase}/api/vulns/${vulnerabilityId}/remediate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setFix(data);
                // Track Viewed
                trackEvent('viewed', data.id, data.confidence_score);

                // Load existing PR state if available
                if (data.pr_url) {
                    setPrResult({ url: data.pr_url, branch: data.branch_name });
                }
            } else {
                throw new Error('Failed to generate remediation');
            }
        } catch (err: any) {
            console.error('Failed to fetch remediation fix:', err);
            setError(err.message || 'Connection failed');
        } finally {
            setLoading(false);
        }
    };

    const handleFeedback = async (type: 'helpful' | 'ignore') => {
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            await fetch(`${apiBase}/api/vulns/${vulnerabilityId}/feedback`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ feedback: { status: type, timestamp: new Date().toISOString() } })
            });

            // Track Interaction
            trackEvent(type === 'helpful' ? 'accepted' : 'ignored', fix?.id, fix?.confidence_score);

            setFeedbackSent(true);
        } catch (err) {
            console.error('Failed to send feedback:', err);
        }
    };

    const handleCreatePR = async () => {
        if (!fix?.id) return;
        setPrLoading(true);
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const response = await fetch(`${apiBase}/api/fixes/${fix.id}/pr`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setPrResult({ url: data.url, branch: data.branch_name });
            } else {
                alert('Failed to create PR. Please check backend logs.');
            }
        } catch (err) {
            console.error('Failed to create PR:', err);
        } finally {
            setPrLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-300">
            <div className="bg-[var(--bg-secondary)] rounded-[var(--card-radius)] shadow-2xl w-full max-w-2xl overflow-hidden border border-[var(--border-subtle)] transition-all">
                <div className="flex items-center justify-between p-8 border-b border-[var(--border-subtle)] bg-[var(--bg-accent)]/30">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-500/20">
                            <Sparkles className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase italic">Remediation AI</h2>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 italic flex items-center gap-1.5 font-mono">
                                <Code className="w-3 h-3" /> INTELLECTUAL PATTERN MATCHING
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-3 hover:bg-[var(--bg-primary)] rounded-2xl border border-transparent hover:border-[var(--border-subtle)] transition-all text-slate-400 hover:text-slate-900 dark:text-white dark:hover:text-white">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="py-20 flex flex-col items-center justify-center gap-4">
                            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic animate-pulse">Deep scanning resolution vectors...</p>
                        </div>
                    ) : error ? (
                        <div className="py-20 text-center flex flex-col items-center justify-center">
                            <div className="w-16 h-16 bg-rose-50 dark:bg-rose-500/10 rounded-3xl flex items-center justify-center mb-6 border border-rose-100 dark:border-rose-500/20">
                                <AlertCircle className="w-8 h-8 text-rose-500" />
                            </div>
                            <p className="text-slate-900 dark:text-white font-black text-sm uppercase italic tracking-tight">Connection Error</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 italic">{error}</p>
                            <button
                                onClick={fetchFix}
                                className="mt-6 px-6 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-opacity flex items-center gap-2"
                            >
                                <RefreshCw className="w-3 h-3" /> Retry Analysis
                            </button>
                        </div>
                    ) : fix ? (
                        <div className="space-y-10">
                            <section>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-600">
                                        <Info className="w-4 h-4" />
                                    </div>
                                    <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest italic">Technical Analysis</h3>
                                    <div className="ml-auto flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-500 rounded-full border border-emerald-500/20">
                                        <CheckCircle className="w-3.5 h-3.5" />
                                        <span className="text-[9px] font-black uppercase tracking-widest italic">Confidence: {(fix.confidence_score * 100).toFixed(0)}%</span>
                                    </div>
                                </div>
                                <div className="text-slate-600 dark:text-slate-300 dark:text-slate-400 text-sm leading-relaxed font-medium bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 dark:border-slate-800">
                                    {fix.explanation}
                                </div>
                            </section>

                            <section>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-600">
                                        <Code className="w-4 h-4" />
                                    </div>
                                    <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest italic">Remediation Patch</h3>
                                </div>
                                <div className="bg-slate-950 rounded-3xl p-6 overflow-x-auto shadow-2xl border border-slate-800">
                                    <pre className="text-[11px] text-blue-300 font-mono leading-relaxed">
                                        <code>{fix.code_diff}</code>
                                    </pre>
                                </div>
                            </section>

                            <div className="bg-blue-600/5 dark:bg-blue-600/10 rounded-[2rem] p-8 border border-blue-500/10 flex flex-col md:flex-row items-center justify-between gap-8">
                                <div className="flex items-center gap-5">
                                    <div className="w-14 h-14 bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-blue-100 dark:border-slate-800 flex items-center justify-center text-blue-600 shrink-0">
                                        <GitPullRequest className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic mb-1">Automated Resolution</div>
                                        <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase italic tracking-tight">Deploy Fix via Pull Request</h4>
                                    </div>
                                </div>
                                {prResult ? (
                                    <a
                                        href={prResult.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-3 px-8 py-4 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all font-black text-[10px] uppercase tracking-widest shadow-xl shadow-emerald-500/20 italic"
                                    >
                                        Inspect Pull Request <ExternalLink className="w-4 h-4" />
                                    </a>
                                ) : (
                                    <button
                                        onClick={handleCreatePR}
                                        disabled={prLoading}
                                        className="flex items-center gap-3 px-10 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 transition-all font-black text-[10px] uppercase tracking-widest shadow-xl shadow-blue-500/40 italic"
                                    >
                                        {prLoading ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" /> Patching Fleet...
                                            </>
                                        ) : (
                                            <>
                                                <GitPullRequest className="w-4 h-4" /> Open Fix PR
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>

                            <div className="pt-8 border-t border-[var(--border-subtle)] flex items-center justify-between">
                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic">Human Verification</div>
                                <div className="flex gap-4">
                                    {feedbackSent ? (
                                        <div className="flex items-center gap-2 px-6 py-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-2xl border border-emerald-100 dark:border-emerald-500/20">
                                            <ThumbsUp className="w-4 h-4" />
                                            <span className="text-[10px] font-black uppercase tracking-widest italic">Feedback Registered</span>
                                        </div>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => handleFeedback('helpful')}
                                                className="flex items-center gap-3 px-6 py-3 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 dark:text-slate-400 rounded-2xl hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-600 transition-all font-black text-[10px] uppercase tracking-widest border border-slate-200 dark:border-slate-700 dark:border-slate-800"
                                            >
                                                <ThumbsUp className="w-4 h-4" /> Helpful
                                            </button>
                                            <button
                                                onClick={() => handleFeedback('ignore')}
                                                className="flex items-center gap-3 px-6 py-3 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 dark:text-slate-400 rounded-2xl hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 transition-all font-black text-[10px] uppercase tracking-widest border border-slate-200 dark:border-slate-700 dark:border-slate-800"
                                            >
                                                <ThumbsDown className="w-4 h-4" /> Ignore
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="py-20 text-center flex flex-col items-center justify-center">
                            <div className="w-16 h-16 bg-rose-50 dark:bg-rose-500/10 rounded-3xl flex items-center justify-center mb-6 border border-rose-100 dark:border-rose-500/20">
                                <AlertCircle className="w-8 h-8 text-rose-500" />
                            </div>
                            <p className="text-slate-900 dark:text-white font-black text-sm uppercase italic tracking-tight">Intelligence Failure</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 italic">Unable to synthesize remediation vector for this finding.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
