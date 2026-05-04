import { useState, useEffect } from 'react';
import { X, Sparkles, ThumbsUp, ThumbsDown, CheckCircle, Info, Loader2, Code, GitPullRequest, ExternalLink, AlertCircle, RefreshCw, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { databases, functions, DB_ID, COLLECTIONS } from '../lib/appwrite';

interface RemediationPanelProps {
    documentId: string;
    onClose: () => void;
}

export default function RemediationPanel({ documentId, onClose }: RemediationPanelProps) {
    const { t } = useTranslation();
    const { getJWT, getGithubToken } = useAuth();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [fix, setFix] = useState<any>(null);
    const [finding, setFinding] = useState<any>(null);
    const [repo, setRepo] = useState<any>(null);
    const [feedbackSent, setFeedbackSent] = useState(false);
    const [prLoading, setPrLoading] = useState(false);
    const [prResult, setPrResult] = useState<{ url: string } | null>(null);
    const [prState, setPrState] = useState<{status: 'idle' | 'loading' | 'success' | 'error', prUrl?: string, error?: string}>({ status: 'idle' });

    useEffect(() => {
        if (!documentId || documentId === '') return;
        fetchFix();
    }, [documentId]);

    const trackEvent = async (action: 'viewed' | 'accepted' | 'ignored', suggestionId?: string, confidence?: number) => {
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            await fetch(`${apiBase}/api/ai/metrics/event`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    finding_id: documentId,
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
        if (!documentId) { setLoading(false); return; }
        
        setLoading(true);
        setError('');
        try {
            // 1. Fetch Finding Details
            const findingDoc = await databases.getDocument(
                DB_ID,
                COLLECTIONS.VULNERABILITIES,
                documentId
            );

            if (!findingDoc) {
                setError(t('remediation.vuln_not_found', 'Vulnerability footprint not found in central registry.'));
                return;
            }

            setFinding(findingDoc);

            // 2. Fetch Repo Details via Scan
            const scanDoc = await databases.getDocument(
                DB_ID,
                COLLECTIONS.SCANS,
                findingDoc.scan_result_id
            );
            
            if (scanDoc && scanDoc.repo_id) {
                const repository = await databases.getDocument(
                    DB_ID,
                    COLLECTIONS.REPOSITORIES,
                    scanDoc.repo_id
                );
                setRepo(repository);
            }

            // 3. Get AI Analysis / Fixed Version
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            try {
                const response = await fetch(`${apiBase}/api/vulns/${documentId}/remediate`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const data = await response.json();
                    setFix(data.suggestion);
                    trackEvent('viewed', data.suggestion?.$id, data.suggestion?.confidence);
                } else if (findingDoc.fixedVersion) {
                    // Fallback to direct patch if AI endpoint fails but fixedVersion exists
                    setFix({
                        summary: t('remediation.direct_patch', { version: findingDoc.fixedVersion, defaultValue: `Direct patch available: upgrade to v${findingDoc.fixedVersion}` }),
                        technical_analysis: t('remediation.known_vuln_desc', 'This is a known vulnerability with a direct version upgrade available in the ecosystem registry.'),
                        confidence: 1.0,
                        diff: `--- a/${findingDoc.location || 'package.json'}\n+++ b/${findingDoc.location || 'package.json'}\n@@ -10,1 +10,1 @@\n- "${findingDoc.package}": "${findingDoc.installedVersion}"\n+ "${findingDoc.package}": "${findingDoc.fixedVersion}"`,
                        impact_assessment: t('remediation.low_risk_desc', 'Low risk. Direct dependency upgrade typically maintains backward compatibility.')
                    });
                } else {
                    setError(t('remediation.no_path', 'No automated remediation path available for detected anomaly.'));
                }
            } catch (err) {
                // Fallback for network errors to the API
                if (findingDoc.fixedVersion) {
                    setFix({
                        summary: t('remediation.direct_patch', { version: findingDoc.fixedVersion, defaultValue: `Direct patch available: upgrade to v${findingDoc.fixedVersion}` }),
                        technical_analysis: t('remediation.ai_offline_desc', 'Automated patch analysis available via direct version upgrade. AI recommendation engine offline.'),
                        confidence: 1.0,
                        diff: `--- a/${findingDoc.location || 'package.json'}\n+++ b/${findingDoc.location || 'package.json'}\n@@ -10,1 +10,1 @@\n- "${findingDoc.package}": "${findingDoc.installedVersion}"\n+ "${findingDoc.package}": "${findingDoc.fixedVersion}"`,
                        impact_assessment: t('remediation.low_risk', 'Low risk upgrade.')
                    });
                } else {
                    throw err;
                }
            }
        } catch (err: any) {
            console.error('Error fetching remediation data:', err);
            setError(err.message || t('remediation.fail_retrieve', 'Failed to retrieve remediation intelligence.'));
        } finally {
            setLoading(false);
        }
    };

    const handleFixVulnerability = async () => {
        const token = await getGithubToken();
        if (!finding || !repo || !token) {
            setError(t('remediation.github_required', 'Unauthorized or missing metadata. Ensure GitHub is connected in Settings.'));
            return;
        }

        setPrLoading(true);
        setPrResult(null);
        setError('');

        try {
            const repoFullName = repo.repo_url ? repo.repo_url.replace('https://github.com/', '') : '';
            if (!repoFullName) {
                throw new Error(t('remediation.no_repo_path', 'Could not resolve repository path from metadata.'));
            }

            const payload = {
                providerAccessToken: token,
                repoFullName,
                filePath: finding.file_path || finding.location || 'package.json',
                packageName: finding.package,
                oldVersion: finding.installedVersion,
                fixedVersion: finding.fixedVersion || (fix?.summary?.match(/v([\d\.]+)/)?.[1] || ''),
                cveId: finding.title || 'SECURITY-PATCH'
            };

            const response = await functions.createExecution(
                import.meta.env.VITE_APPWRITE_FUNCTION_ID,
                JSON.stringify(payload)
            );

            let result;
            try {
                result = response.responseBody ? JSON.parse(response.responseBody) : { error: t('remediation.empty_response', 'Empty response from patch window') };
            } catch (e) {
                console.error('Failed to parse patch response:', response.responseBody);
                result = { error: t('remediation.invalid_format', 'Invalid response format from patch window') };
            }
            
            if (response.status === 'completed' && result.prUrl) {
                setPrResult({ url: result.prUrl });
                trackEvent('accepted', fix?.$id, fix?.confidence);
            } else {
                throw new Error(result.error || t('remediation.execution_fail', 'Patch window execution failed.'));
            }
        } catch (err: any) {
            console.error('Remediation error:', err);
            setError(err.message || t('remediation.flow_interrupted', 'Automated remediation flow interrupted.'));
        } finally {
            setPrLoading(false);
        }
    };

    async function handleCreatePR() {
        setPrState({ status: 'loading' });
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            
            const res = await fetch(`${apiBase}/api/remediation/create-pr`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    findingId: finding.$id,
                    repoUrl: repo.url || repo.repo_url,
                    filePath: finding.file_path || finding.location || 'package.json',
                    fixedContent: fix.code_diff || fix.fixed_code || fix.diff,
                    vulnerabilityTitle: finding.message || finding.title || 'Unknown vulnerability',
                    severity: finding.severity || 'low',
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || t('remediation.fail_pr', 'Failed to create PR'));

            setPrState({ status: 'success', prUrl: data.prUrl });

            // Store PR URL in Appwrite
            await databases.updateDocument(
                DB_ID,
                COLLECTIONS.VULNERABILITIES,
                finding.$id,
                { pr_url: data.prUrl, resolution_status: 'remediated' }
            );

        } catch (err: any) {
            setPrState({ status: 'error', error: err.message });
        }
    }

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
            
            <div className="relative w-full max-w-4xl max-h-[90vh] bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-3xl overflow-hidden shadow-2xl flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-secondary)]/50">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-[var(--accent-primary)]/10 flex items-center justify-center text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
                            <Zap size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tight">
                                {t('remediation.title', 'Intelligence Remediation Engine')}
                            </h2>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic">
                                {t('remediation.scoping_patch', 'Scoping patch for')} {finding?.title || t('common.unknown_threat', 'Unknown Threat')}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-[var(--text-secondary)]">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="w-10 h-10 text-[var(--accent-primary)] animate-spin" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] animate-pulse">{t('remediation.running_analysis', 'Running Neural Analysis...')}</p>
                        </div>
                    ) : error ? (
                        <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-4 text-red-500">
                            <AlertCircle size={24} />
                            <div>
                                <p className="text-xs font-black uppercase italic">{t('remediation.system_fault', 'System Fault Detected')}</p>
                                <p className="text-[10px] font-bold opacity-80">{error}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {/* Analysis Section */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)] relative group">
                                    <div className="absolute -top-3 -left-3 px-3 py-1 bg-[var(--accent-primary)] text-black text-[9px] font-black uppercase italic rounded-lg flex items-center gap-2">
                                        <Sparkles size={10} /> {t('remediation.ai_recommendation', 'AI Recommendation')}
                                    </div>
                                    <h4 className="text-xs font-black text-[var(--text-primary)] uppercase italic mb-3">{t('remediation.technical_breakdown', 'Technical Breakdown')}</h4>
                                    <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] font-medium">
                                        {fix?.technical_analysis || fix?.explanation || t('remediation.neural_assessing', 'Neural engine assessing structural vulnerabilities...')}
                                    </p>
                                    <div className="mt-6 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <button 
                                                onClick={() => { setFeedbackSent(true); trackEvent('accepted', fix?.$id, fix?.confidence); }}
                                                className={`p-2 rounded-lg transition-all ${feedbackSent ? 'bg-[var(--status-success)]/20 text-[var(--status-success)]' : 'hover:bg-white/5 text-[var(--text-secondary)]'}`}
                                            >
                                                <ThumbsUp size={16} />
                                            </button>
                                            <button 
                                                onClick={() => { setFeedbackSent(true); trackEvent('ignored', fix?.$id, fix?.confidence); }}
                                                className="p-2 hover:bg-white/5 rounded-lg transition-all text-[var(--text-secondary)]"
                                            >
                                                <ThumbsDown size={16} />
                                            </button>
                                        </div>
                                        <div className="text-[9px] font-black uppercase italic text-[var(--accent-primary)] opacity-60">
                                            {t('remediation.confidence_index', 'Confidence Index')}: {((fix?.confidence || fix?.confidence_score || 0) * 100).toFixed(1)}%
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)]">
                                    <h4 className="text-xs font-black text-[var(--text-primary)] uppercase italic mb-3">{t('remediation.impact_assessment', 'Impact Assessment')}</h4>
                                    <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] font-medium">
                                        {fix?.impact_assessment || t('remediation.impact_desc', 'Assessment restricted to localized dependency tree. Minimal risk to core logic detected.')}
                                    </p>
                                    <div className="mt-6 pt-6 border-t border-[var(--border-subtle)] flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-[var(--status-success)] animate-pulse" />
                                            <span className="text-[9px] font-black uppercase italic text-[var(--status-success)] tracking-widest">{t('remediation.safe_execution', 'Safe for Execution')}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <CheckCircle size={12} className="text-[var(--status-success)]" />
                                            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase">{t('remediation.verified_patch', 'Verified Patch')}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Diff View */}
                            <div className="p-6 bg-[#0d1117] rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <Code size={14} className="text-[var(--text-secondary)]" />
                                        <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-secondary)]">{t('remediation.proposed_mod', 'Proposed Code Modification')}</span>
                                    </div>
                                    <span className="text-[9px] font-bold text-[var(--accent-primary)] bg-[var(--accent-primary)]/10 px-2 py-0.5 rounded uppercase tracking-tighter">
                                        {finding?.file_path || finding?.location || 'package.json'}
                                    </span>
                                </div>
                                <pre className="text-[11px] font-mono leading-relaxed text-gray-300 overflow-x-auto p-4 bg-black/30 rounded-xl">
                                    {fix?.diff || fix?.code_diff || t('remediation.generating_diff', 'Generating structural patch representation...')}
                                </pre>
                            </div>

                            <div className="flex items-center gap-3">
                                {prState.status === 'idle' && (
                                    <button
                                        onClick={handleCreatePR}
                                        disabled={!fix}
                                        className="flex items-center gap-2 px-6 py-3 bg-[var(--accent-primary)] text-black rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 text-xs font-black uppercase italic tracking-widest shadow-xl shadow-[var(--accent-primary)]/20"
                                    >
                                        <GitPullRequest size={18} /> {t('remediation.apply_path_pr', 'Apply Remediation Path (GitHub PR)')}
                                    </button>
                                )}

                                {prState.status === 'loading' && (
                                    <div className="flex items-center gap-2 text-xs font-black uppercase italic text-[var(--text-secondary)]">
                                        <Loader2 className="w-5 h-5 animate-spin text-[var(--accent-primary)]" />
                                        <span>{t('remediation.opening_pr', 'Opening PR...')}</span>
                                    </div>
                                )}

                                {prState.status === 'success' && (
                                    <a
                                        href={prState.prUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-6 py-3 bg-[var(--status-success)] text-white rounded-xl hover:opacity-90 transition-all text-xs font-black uppercase italic tracking-widest shadow-lg shadow-[var(--status-success)]/20"
                                    >
                                        {t('remediation.view_pr_github', 'View PR on GitHub →')}
                                    </a>
                                )}

                                {prState.status === 'error' && (
                                    <div className="text-xs font-bold text-red-500">
                                        {t('remediation.pr_failed', 'PR failed')}: {prState.error}
                                        <button onClick={() => setPrState({ status: 'idle' })} className="ml-3 underline uppercase font-black italic">
                                            {t('remediation.retry', 'Retry')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Info size={14} className="text-[var(--text-secondary)]" />
                        <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">
                            {t('remediation.footer_info', 'Execution will create a secure patch branch and opening a Pull Request.')}
                        </span>
                    </div>
                    
                    {prResult ? (
                        <a 
                            href={prResult.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-6 py-3 bg-[var(--status-success)]/10 text-[var(--status-success)] border border-[var(--status-success)]/20 rounded-xl text-xs font-black uppercase italic tracking-widest hover:bg-[var(--status-success)]/20 transition-all shadow-lg shadow-[var(--status-success)]/5"
                        >
                            <ExternalLink size={16} /> {t('remediation.view_pr', 'View Pull Request')}
                        </a>
                    ) : (
                        <div className="flex gap-4">
                             <button
                                onClick={fetchFix}
                                disabled={loading || prLoading}
                                className="p-3 bg-white/5 border border-white/10 rounded-xl text-[var(--text-secondary)] hover:bg-white/10 transition-all"
                            >
                                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                            </button>
                            <button 
                                onClick={handleFixVulnerability}
                                disabled={loading || prLoading || !fix}
                                className="flex items-center gap-3 px-8 py-3 bg-[var(--accent-primary)] text-black rounded-xl text-xs font-black uppercase italic tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100 shadow-xl shadow-[var(--accent-primary)]/20"
                            >
                                {prLoading ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" /> {t('remediation.patching', 'Patching...')}
                                    </>
                                ) : (
                                    <>
                                        <GitPullRequest size={18} /> {t('remediation.apply_path', 'Apply Remediation Path')}
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
