import { useState, useEffect } from 'react';
import { X, Sparkles, ThumbsUp, ThumbsDown, CheckCircle, Loader2, GitPullRequest, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react';

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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[4px] flex items-center justify-center p-6 z-[100] animate-fade-up">
            <div className="bg-white rounded-xl shadow-[0_20px_48px_rgba(0,0,0,0.12)] border border-border w-full max-w-[640px] max-h-[90vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-surface/30">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center text-white shadow-lg shadow-accent/20">
                            <Sparkles className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-[20px] font-serif italic text-text tracking-tight leading-tight">Remediation Intelligence</h2>
                            <p className="text-[11px] text-text-muted font-medium uppercase tracking-[0.15em] mt-0.5">Vector Analysis & Resolution</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-text-muted hover:text-text hover:bg-surface rounded-md transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-8 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="py-24 flex flex-col items-center justify-center gap-6 text-center">
                            <div className="relative">
                                <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full animate-pulse"></div>
                                <Loader2 className="w-12 h-12 text-accent animate-spin relative z-10" />
                            </div>
                            <div>
                                <p className="text-[14px] text-text font-semibold mb-1">Synthesizing Resolution Vectors</p>
                                <p className="text-[12px] text-text-muted">Analyzing pattern matches across established security protocols...</p>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="py-16 text-center">
                            <div className="w-16 h-16 bg-danger-light rounded-full flex items-center justify-center mx-auto mb-6 border border-danger/10">
                                <AlertCircle className="w-8 h-8 text-danger" />
                            </div>
                            <h3 className="text-[16px] font-semibold text-text mb-2">Synthesis Interrupted</h3>
                            <p className="text-[13px] text-text-muted max-w-[320px] mx-auto mb-8">{error}</p>
                            <button
                                onClick={fetchFix}
                                className="btn-primary"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Re-initiate Analysis
                            </button>
                        </div>
                    ) : fix ? (
                        <div className="space-y-10">
                            <section className="animate-fade-up">
                                <div className="flex items-center gap-3 mb-4">
                                    <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wider">Analysis Overview</h3>
                                    <div className="ml-auto flex items-center gap-2 px-3 py-1 bg-success-light text-success rounded-full border border-success/10 text-[11px] font-bold">
                                        <CheckCircle className="w-3.5 h-3.5" />
                                        Confidence: {(fix.confidence_score * 100).toFixed(0)}%
                                    </div>
                                </div>
                                <div className="text-[14px] text-text leading-relaxed bg-surface/50 p-6 rounded-xl border border-border">
                                    {fix.explanation}
                                </div>
                            </section>

                            <section className="animate-fade-up [animation-delay:100ms]">
                                <div className="flex items-center gap-3 mb-4">
                                    <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wider">Suggested Patch</h3>
                                </div>
                                <div className="bg-slate-900 rounded-xl p-6 overflow-x-auto shadow-inner border border-slate-800">
                                    <pre className="text-[12px] font-mono leading-relaxed text-slate-300">
                                        <code>{fix.code_diff}</code>
                                    </pre>
                                </div>
                            </section>

                            <div className="bg-accent/5 rounded-2xl p-8 border border-accent/10 flex flex-col md:flex-row items-center justify-between gap-6 animate-fade-up [animation-delay:200ms]">
                                <div className="flex items-center gap-5 text-center md:text-left">
                                    <div className="w-14 h-14 bg-white rounded-xl shadow-md border border-accent/10 flex items-center justify-center text-accent shrink-0">
                                        <GitPullRequest className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h4 className="text-[15px] font-semibold text-text leading-tight">Automated Deployment</h4>
                                        <p className="text-[12px] text-text-muted mt-1">Apply this fix directly to your asset repository.</p>
                                    </div>
                                </div>
                                {prResult ? (
                                    <a
                                        href={prResult.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn-success !py-3 !px-6 animate-fade-up"
                                    >
                                        Inspect Pull Request <ExternalLink className="w-4 h-4" />
                                    </a>
                                ) : (
                                    <button
                                        onClick={handleCreatePR}
                                        disabled={prLoading}
                                        className="btn-primary !py-3 !px-8 flex-1 md:flex-none justify-center"
                                    >
                                        {prLoading ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" /> Patching Asset...
                                            </>
                                        ) : (
                                            <>
                                                <GitPullRequest className="w-4 h-4" /> Deploy Resolution
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>

                            <div className="pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div className="text-[11px] font-semibold text-text-subtle uppercase tracking-wider">Signal Verification</div>
                                <div className="flex gap-2">
                                    {feedbackSent ? (
                                        <div className="flex items-center gap-2 px-4 py-2 bg-success-light text-success rounded-lg border border-success/10 text-[12px] font-semibold">
                                            <ThumbsUp className="w-4 h-4" />
                                            Signal Registered
                                        </div>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => handleFeedback('helpful')}
                                                className="btn-ghost !text-[12px] !py-2 !px-4"
                                            >
                                                <ThumbsUp className="w-4 h-4" /> Useful
                                            </button>
                                            <button
                                                onClick={() => handleFeedback('ignore')}
                                                className="btn-ghost !text-[12px] !py-2 !px-4 hover:!text-danger hover:!bg-danger-light"
                                            >
                                                <ThumbsDown className="w-4 h-4" /> Inaccurate
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="py-16 text-center">
                            <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-6 border border-border">
                                <AlertCircle className="w-8 h-8 text-text-subtle" />
                            </div>
                            <h3 className="text-[16px] font-semibold text-text mb-2">Synthesis Failed</h3>
                            <p className="text-[13px] text-text-muted">Unable to generate a reliable remediation vector for this finding.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
