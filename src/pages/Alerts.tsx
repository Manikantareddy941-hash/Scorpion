import { useEffect, useState } from 'react';
import { databases, DB_ID, ID, Query, COLLECTIONS, client } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import { Bell, Loader2, Save, Send, ShieldAlert, Slack, MessageSquare, AlertTriangle, AlertCircle, Info, Activity } from 'lucide-react';
import { RealtimeResponseEvent } from 'appwrite';
import { useTranslation } from 'react-i18next';

const SEVERITY_COLORS: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-500 border-red-500/50',
    high: 'bg-orange-500/20 text-orange-500 border-orange-500/50',
    medium: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50',
    low: 'bg-green-500/20 text-green-500 border-green-500/50',
};

export default function Alerts() {
    const { t } = useTranslation();
    const { user, getJWT } = useAuth();
    
    // Config State
    const [activeTab, setActiveTab] = useState<'config' | 'feed'>('config');
    const [webhookUrl, setWebhookUrl] = useState(''); // Discord
    const [slackWebhookUrl, setSlackWebhookUrl] = useState(''); // Slack
    const [isEnabled, setIsEnabled] = useState(true);
    const [activeSeverities, setActiveSeverities] = useState<string[]>(['critical', 'high']);
    const [saving, setSaving] = useState(false);
    const [testingDiscord, setTestingDiscord] = useState(false);
    const [testingSlack, setTestingSlack] = useState(false);
    const [docId, setDocId] = useState<string | null>(null);

    // Feed State
    const [findings, setFindings] = useState<any[]>([]);
    const [feedLoading, setFeedLoading] = useState(false);

    useEffect(() => {
        if (!user) return;
        const fetchIntegrations = async () => {
            try {
                const res = await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS, [
                    Query.equal('userId', user.$id)
                ]);
                if (res.total > 0) {
                    const doc = res.documents[0];
                    setDocId(doc.$id);
                    setWebhookUrl(doc.webhookUrl || '');
                    setSlackWebhookUrl(doc.slackWebhookUrl || '');
                    setIsEnabled(doc.isEnabled ?? true);
                    setActiveSeverities(doc.activeSeverities || ['critical', 'high']);
                }
            } catch (e) {
                console.error('Error fetching integration', e);
            }
        };
        fetchIntegrations();
    }, [user]);

    useEffect(() => {
        if (activeTab === 'feed') {
            fetchFeed();
            
            const unsubscribe = client.subscribe(
                `databases.${DB_ID}.collections.${COLLECTIONS.FINDINGS}.documents`,
                (response: RealtimeResponseEvent<any>) => {
                    if (response.events.includes('databases.*.collections.*.documents.*.create')) {
                        const newDoc = response.payload;
                        if (activeSeverities.includes(newDoc.severity?.toLowerCase())) {
                            setFindings(prev => [newDoc, ...prev].slice(0, 100)); // Keep last 100
                        }
                    }
                }
            );

            return () => unsubscribe();
        }
    }, [activeTab, activeSeverities]);

    const fetchFeed = async () => {
        setFeedLoading(true);
        try {
            if (activeSeverities.length === 0) {
                setFindings([]);
                return;
            }
            
            // Limit to 50 recent findings that match severity
            const queries = [
                Query.orderDesc('$createdAt'),
                Query.limit(50)
            ];
            
            const res = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, queries);
            const filtered = res.documents.filter(doc => activeSeverities.includes(doc.severity?.toLowerCase()));
            setFindings(filtered);
        } catch (e) {
            console.error('Error fetching feed', e);
        } finally {
            setFeedLoading(false);
        }
    };

    const handleSave = async () => {
        if (!user) return;
        setSaving(true);
        try {
            const data = {
                userId: user.$id,
                webhookUrl,
                slackWebhookUrl,
                isEnabled,
                activeSeverities
            };

            if (docId) {
                await databases.updateDocument(DB_ID, COLLECTIONS.INTEGRATIONS, docId, data);
            } else {
                const res = await databases.createDocument(DB_ID, COLLECTIONS.INTEGRATIONS, ID.unique(), data);
                setDocId(res.$id);
            }
            alert(t('alerts.save_success'));
        } catch (error) {
            console.error('Failed to commit integration', error);
            alert(t('alerts.save_error'));
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async (type: 'discord' | 'slack') => {
        const url = type === 'discord' ? webhookUrl : slackWebhookUrl;
        if (!url) return alert(t('alerts.invalid_url', { type: type === 'discord' ? 'Discord' : 'Slack' }));
        
        type === 'discord' ? setTestingDiscord(true) : setTestingSlack(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            
            const response = await fetch(`${apiBase}/api/alerts/test`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ webhookUrl: url, type })
            });

            if (response.ok) {
                alert(t('alerts.test_success', { type }));
            } else {
                alert(t('alerts.test_fail', { status: response.status }));
            }
        } catch (err: any) {
            alert('Test payload dispatch failed: ' + err.message);
        } finally {
            type === 'discord' ? setTestingDiscord(false) : setTestingSlack(false);
        }
    };

    const toggleSeverity = (severity: string) => {
        setActiveSeverities(prev => 
            prev.includes(severity) 
                ? prev.filter(s => s !== severity)
                : [...prev, severity]
        );
    };

    const SeverityIcon = ({ severity }: { severity: string }) => {
        switch (severity.toLowerCase()) {
            case 'critical': return <ShieldAlert className="w-4 h-4" />;
            case 'high': return <AlertTriangle className="w-4 h-4" />;
            case 'medium': return <AlertCircle className="w-4 h-4" />;
            default: return <Info className="w-4 h-4" />;
        }
    };

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
            <div className="max-w-5xl mx-auto">
                <div className="mb-12">
                    <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none">{t('alerts.title')}</h1>
                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">
                        {t('alerts.subtitle')}
                    </p>
                </div>

                <div className="flex gap-4 mb-8">
                    <button 
                        onClick={() => setActiveTab('config')}
                        className={`px-6 py-3 rounded-xl font-black uppercase italic tracking-widest text-[11px] transition-all
                            ${activeTab === 'config' ? 'bg-[var(--accent-primary)] text-black shadow-lg shadow-[var(--accent-primary)]/20' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]'}`}
                    >
                        {t('alerts.configuration')}
                    </button>
                    <button 
                        onClick={() => setActiveTab('feed')}
                        className={`px-6 py-3 rounded-xl font-black uppercase italic tracking-widest text-[11px] transition-all flex items-center gap-2
                            ${activeTab === 'feed' ? 'bg-[var(--accent-primary)] text-black shadow-lg shadow-[var(--accent-primary)]/20' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]'}`}
                    >
                        <Activity className="w-4 h-4" /> {t('alerts.live_feed')}
                    </button>
                </div>

                {activeTab === 'config' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Master Toggle & Severities */}
                        <div className="premium-card p-8">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 pb-8 border-b border-[var(--border-subtle)]">
                                <div>
                                    <h3 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-[0.2em] italic mb-2">{t('alerts.master_switch')}</h3>
                                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic">{t('alerts.master_desc')}</p>
                                </div>
                                <label className="flex items-center gap-3 cursor-pointer w-fit opacity-80 hover:opacity-100 transition-opacity">
                                    <input 
                                        type="checkbox" 
                                        checked={isEnabled} 
                                        onChange={(e) => setIsEnabled(e.target.checked)} 
                                        className="accent-[var(--accent-primary)] w-5 h-5"
                                    />
                                    <span className="text-xs font-black uppercase italic tracking-widest">{isEnabled ? t('alerts.system_armed') : t('alerts.system_standby')}</span>
                                </label>
                            </div>

                            <div className="mb-4">
                                <h3 className="text-xs font-black text-[var(--text-primary)] mb-4 uppercase tracking-[0.2em] italic">{t('alerts.event_triggers')}</h3>
                                <div className="flex flex-wrap gap-4">
                                    {['critical', 'high', 'medium', 'low'].map(sev => (
                                        <button
                                            key={sev}
                                            onClick={() => toggleSeverity(sev)}
                                            className={`px-5 py-2.5 rounded-xl border-2 font-black uppercase italic tracking-widest text-[10px] transition-all flex items-center gap-2
                                                ${activeSeverities.includes(sev) ? SEVERITY_COLORS[sev] : 'bg-transparent border-[var(--border-subtle)] text-[var(--text-secondary)] opacity-50 hover:opacity-100'}`}
                                        >
                                            <SeverityIcon severity={sev} /> {sev}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Discord Config */}
                        <div className="premium-card p-8">
                            <h3 className="text-xs font-black text-[#5865F2] mb-6 uppercase tracking-[0.2em] italic flex items-center gap-3">
                                <MessageSquare className="w-5 h-5" /> {t('alerts.discord_interceptor')}
                            </h3>
                            <div className="flex flex-col md:flex-row gap-4 items-center">
                                <input 
                                    type="text" 
                                    value={webhookUrl} 
                                    onChange={(e) => setWebhookUrl(e.target.value)} 
                                    className="flex-1 w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-4 text-xs font-black italic tracking-widest text-[var(--text-primary)] outline-none focus:border-[#5865F2]/50 transition-colors"
                                    placeholder="https://discord.com/api/webhooks/..."
                                />
                                <button 
                                    onClick={() => handleTest('discord')} 
                                    disabled={testingDiscord || !webhookUrl || !isEnabled}
                                    className="w-full md:w-auto px-6 py-4 bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/30 hover:bg-[#5865F2] hover:text-white rounded-xl font-black uppercase italic tracking-widest text-[11px] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                                >
                                    {testingDiscord ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    {t('alerts.test')}
                                </button>
                            </div>
                        </div>

                        {/* Slack Config */}
                        <div className="premium-card p-8">
                            <h3 className="text-xs font-black text-[#E01E5A] mb-6 uppercase tracking-[0.2em] italic flex items-center gap-3">
                                <Slack className="w-5 h-5" /> {t('alerts.slack_block_kit')}
                            </h3>
                            <div className="flex flex-col md:flex-row gap-4 items-center">
                                <input 
                                    type="text" 
                                    value={slackWebhookUrl} 
                                    onChange={(e) => setSlackWebhookUrl(e.target.value)} 
                                    className="flex-1 w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-4 text-xs font-black italic tracking-widest text-[var(--text-primary)] outline-none focus:border-[#E01E5A]/50 transition-colors"
                                    placeholder="https://hooks.slack.com/services/..."
                                />
                                <button 
                                    onClick={() => handleTest('slack')} 
                                    disabled={testingSlack || !slackWebhookUrl || !isEnabled}
                                    className="w-full md:w-auto px-6 py-4 bg-[#E01E5A]/10 text-[#E01E5A] border border-[#E01E5A]/30 hover:bg-[#E01E5A] hover:text-white rounded-xl font-black uppercase italic tracking-widest text-[11px] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                                >
                                    {testingSlack ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    {t('alerts.test')}
                                </button>
                            </div>
                        </div>

                        {/* Save Action */}
                        <div className="flex justify-end mt-8">
                            <button 
                                onClick={handleSave} 
                                disabled={saving}
                                className="btn-premium flex items-center justify-center gap-3 px-10 py-4 disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                {t('alerts.commit_config')}
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'feed' && (
                    <div className="premium-card p-8 min-h-[500px] animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="flex justify-between items-center mb-8 border-b border-[var(--border-subtle)] pb-6">
                            <div>
                                <h3 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-[0.2em] italic flex items-center gap-3">
                                    <Bell className="w-4 h-4 text-[var(--accent-secondary)]" /> {t('alerts.neural_feed')}
                                </h3>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1">{t('alerts.feed_desc')}</p>
                            </div>
                            <div className="flex gap-2">
                                {activeSeverities.map(sev => (
                                    <span key={sev} className={`px-3 py-1 rounded-md border text-[9px] font-black uppercase italic ${SEVERITY_COLORS[sev]}`}>
                                        {sev}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {feedLoading ? (
                            <div className="flex justify-center items-center h-48">
                                <Loader2 className="w-8 h-8 text-[var(--accent-primary)] animate-spin" />
                            </div>
                        ) : findings.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 opacity-50">
                                <ShieldAlert className="w-12 h-12 mb-4 text-[var(--text-secondary)]" />
                                <p className="text-xs font-black uppercase tracking-widest italic text-[var(--text-secondary)]">{t('alerts.no_findings')}</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {findings.map(finding => (
                                    <div key={finding.$id} className="p-5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl flex gap-4 hover:border-[var(--accent-primary)]/30 transition-colors">
                                        <div className="mt-1">
                                            <div className={`p-2 rounded-lg border ${SEVERITY_COLORS[finding.severity?.toLowerCase() || 'medium']}`}>
                                                <SeverityIcon severity={finding.severity || 'medium'} />
                                            </div>
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="text-sm font-black text-[var(--text-primary)] tracking-wide">{finding.vulnerability_id || finding.rule_id}</h4>
                                                <span className="text-[9px] font-mono text-[var(--text-secondary)]">{new Date(finding.$createdAt).toLocaleString()}</span>
                                            </div>
                                            <p className="text-[11px] font-bold text-[var(--text-secondary)] italic mb-2">
                                                {finding.package_name && <span className="mr-3">PKG: {finding.package_name}</span>}
                                                {finding.fixed_version && <span>FIX: {finding.fixed_version}</span>}
                                            </p>
                                            {finding.description && (
                                                <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed opacity-80">
                                                    {finding.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
