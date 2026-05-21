import { useEffect, useState } from 'react';
import { databases, DB_ID, ID, Query, COLLECTIONS, client } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import { 
    Bell, Loader2, Save, Send, ShieldAlert, Slack, 
    MessageSquare, AlertTriangle, AlertCircle, Info, 
    Activity, Zap, PhoneCall
} from 'lucide-react';
import { RealtimeResponseEvent } from 'appwrite';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

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
    const [discordWebhook, setDiscordWebhook] = useState('');
    const [slackWebhook, setSlackWebhook] = useState('');
    const [pagerdutyKey, setPagerdutyKey] = useState('');
    const [opsgenieKey, setOpsgenieKey] = useState('');
    const [isEnabled, setIsEnabled] = useState(true);
    const [activeSeverities, setActiveSeverities] = useState<string[]>(['critical', 'high']);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState<string | null>(null);
    const [docId, setDocId] = useState<string | null>(null);

    // Discord Specific Configurations
    const [discordUsername, setDiscordUsername] = useState('Scorpion Operator');
    const [discordAvatar, setDiscordAvatar] = useState('');
    const [alertCritical, setAlertCritical] = useState(true);
    const [alertPolicy, setAlertPolicy] = useState(true);
    const [alertDeploy, setAlertDeploy] = useState(true);
    const [discordSaving, setDiscordSaving] = useState(false);

    // Feed State
    const [findings, setFindings] = useState<any[]>([]);
    const [feedLoading, setFeedLoading] = useState(false);

    const handleSaveDiscordMesh = async () => {
        if (!discordWebhook) {
            toast.error('Webhook URL is required');
            return;
        }
        setDiscordSaving(true);
        try {
            const token = await getJWT();
            const response = await fetch('/api/mesh/discord/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    webhookUrl: discordWebhook,
                    username: discordUsername,
                    avatarUrl: discordAvatar,
                    alerts: {
                        criticalVulnerabilities: alertCritical,
                        policyBlocks: alertPolicy,
                        deploymentSuccess: alertDeploy
                    }
                })
            });

            if (response.ok) {
                toast.success('Discord Mesh configuration committed successfully.');
            } else {
                toast.error(`Save failed: ${response.status}`);
            }
        } catch (err: any) {
            console.error('Discord config save error:', err);
            toast.error('Failed to commit Discord configuration');
        } finally {
            setDiscordSaving(false);
        }
    };

    useEffect(() => {
        if (!user) return;
        fetchIntegrations();
    }, [user]);

    const fetchIntegrations = async () => {
        try {
            const res = await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS, [
                Query.equal('userId', user!.$id)
            ]);
            if (res.total > 0) {
                const doc = res.documents[0];
                setDocId(doc.$id);
                setDiscordWebhook(doc.discord_webhook || '');
                setSlackWebhook(doc.slack_webhook || '');
                setPagerdutyKey(doc.pagerduty_key || '');
                setOpsgenieKey(doc.opsgenie_key || '');
                setIsEnabled(doc.isEnabled ?? true);
                setActiveSeverities(doc.activeSeverities || ['critical', 'high']);
            }
        } catch (e) {
            console.error('Error fetching integration', e);
        }
    };

    useEffect(() => {
        if (activeTab === 'feed') {
            fetchFeed();
            
            const unsubscribe = client.subscribe(
                `databases.${DB_ID}.collections.${COLLECTIONS.FINDINGS}.documents`,
                (response: RealtimeResponseEvent<any>) => {
                    if (response.events.some(e => e.includes('.create'))) {
                        const newDoc = response.payload;
                        if (activeSeverities.includes(newDoc.severity?.toLowerCase())) {
                            setFindings(prev => [newDoc, ...prev].slice(0, 100));
                        }
                    }
                }
            );

            return () => {
                if (unsubscribe) unsubscribe();
            };
        }
    }, [activeTab, activeSeverities]);

    const fetchFeed = async () => {
        setFeedLoading(true);
        try {
            if (activeSeverities.length === 0) {
                setFindings([]);
                return;
            }
            const res = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [
                Query.orderDesc('$createdAt'),
                Query.limit(50)
            ]);
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
                discord_webhook: discordWebhook,
                slack_webhook: slackWebhook,
                pagerduty_key: pagerdutyKey,
                opsgenie_key: opsgenieKey,
                isEnabled,
                activeSeverities,
                integrationType: 'webhook' // Required by schema enum
            };

            if (docId) {
                await databases.updateDocument(DB_ID, COLLECTIONS.INTEGRATIONS, docId, data);
            } else {
                const res = await databases.createDocument(DB_ID, COLLECTIONS.INTEGRATIONS, ID.unique(), data);
                setDocId(res.$id);
            }
            toast.success(t('alerts.save_success', 'Configuration committed to neural mesh.'));
        } catch (error: any) {
            console.error('Failed to commit integration', error);
            toast.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async (type: string, url: string) => {
        if (!url) return toast.error(`Please provide a key/URL for ${type}`);
        setTesting(type);
        try {
            const token = await getJWT();
            const apiBase = '';
            
            const response = await fetch(`${apiBase}/api/alerts/test`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ url, type })
            });

            if (response.ok) {
                toast.success(`${type} alert dispatched successfully`);
            } else {
                toast.error(`Dispatch failed: ${response.status}`);
            }
        } catch (err: any) {
            toast.error('Payload dispatch failed: ' + err.message);
        } finally {
            setTesting(null);
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
        <div className="min-h-screen bg-[var(--bg-primary)] p-8">
            <div className="max-w-5xl mx-auto space-y-12">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="flex items-center gap-5">
                        <div className="w-16 h-16 bg-[var(--accent-primary)] rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-[var(--accent-primary)]/20">
                            <Bell size={32} />
                        </div>
                        <div>
                            <h1 className="text-4xl font-black tracking-tighter uppercase italic leading-none text-[var(--text-primary)]">Alert Mesh</h1>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-2">Real-time Threat Propagation Control</p>
                        </div>
                    </div>

                    <div className="flex gap-2 p-1 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)]">
                        <button 
                            onClick={() => setActiveTab('config')}
                            className={`px-6 py-3 rounded-xl font-black uppercase italic tracking-widest text-[10px] transition-all
                                ${activeTab === 'config' ? 'bg-[var(--accent-primary)] text-white shadow-lg shadow-[var(--accent-primary)]/20' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                        >
                            Configuration
                        </button>
                        <button 
                            onClick={() => setActiveTab('feed')}
                            className={`px-6 py-3 rounded-xl font-black uppercase italic tracking-widest text-[10px] transition-all flex items-center gap-2
                                ${activeTab === 'feed' ? 'bg-[var(--accent-primary)] text-white shadow-lg shadow-[var(--accent-primary)]/20' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                        >
                            <Activity size={14} /> Neural Feed
                        </button>
                    </div>
                </div>

                {activeTab === 'config' ? (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        
                        {/* Global Logic */}
                        <div className="premium-card p-10">
                            <div className="flex items-center justify-between mb-10 pb-10 border-b border-[var(--border-subtle)]">
                                <div>
                                    <h3 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-[0.2em] italic mb-2">Master Interceptor Switch</h3>
                                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic">Enable or disable all external threat propagation</p>
                                </div>
                                <div 
                                    onClick={() => setIsEnabled(!isEnabled)}
                                    className={`w-16 h-8 rounded-full p-1 cursor-pointer transition-all duration-300 ${isEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'}`}
                                >
                                    <div className={`w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${isEnabled ? 'translate-x-8' : 'translate-x-0'}`} />
                                </div>
                            </div>

                            <div className="space-y-6">
                                <h3 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Severity Filters</h3>
                                <div className="flex flex-wrap gap-4">
                                    {['critical', 'high', 'medium', 'low'].map(sev => (
                                        <button
                                            key={sev}
                                            onClick={() => toggleSeverity(sev)}
                                            className={`px-6 py-3 rounded-2xl border-2 font-black uppercase italic tracking-widest text-[11px] transition-all flex items-center gap-3
                                                ${activeSeverities.includes(sev) ? SEVERITY_COLORS[sev] : 'bg-transparent border-[var(--border-subtle)] text-[var(--text-secondary)] opacity-50'}`}
                                        >
                                            <SeverityIcon severity={sev} /> {sev}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Integration Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Discord Interceptor Detailed Configuration Form */}
                            <div className="premium-card p-8 group flex flex-col justify-between col-span-1 md:col-span-2 border border-[#5865F2]/20 bg-[#5865F2]/[0.01]">
                                <div>
                                    <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 text-[#5865F2] bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 group-hover:scale-105 transition-transform">
                                                <MessageSquare size={24} />
                                            </div>
                                            <div>
                                                <h3 className="text-xs font-black text-[#5865F2] uppercase tracking-[0.2em] italic">Discord Mesh Interceptor</h3>
                                                <p className="text-[9px] text-[var(--text-secondary)] uppercase mt-0.5 font-bold font-mono">Deep Ingress Integration Gateway</p>
                                            </div>
                                        </div>
                                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/20">Active Node</span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                                        <div className="flex flex-col gap-2">
                                            <label className="text-[8px] font-black uppercase tracking-widest text-[var(--text-secondary)] font-mono">Discord Webhook URL</label>
                                            <input 
                                                type="password" 
                                                value={discordWebhook} 
                                                onChange={(e) => setDiscordWebhook(e.target.value)} 
                                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-xs font-black italic text-[var(--text-primary)] outline-none focus:border-[#5865F2]/30 transition-colors"
                                                placeholder="https://discord.com/api/webhooks/..."
                                            />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-[8px] font-black uppercase tracking-widest text-[var(--text-secondary)] font-mono">Bot Username Override</label>
                                            <input 
                                                type="text" 
                                                value={discordUsername} 
                                                onChange={(e) => setDiscordUsername(e.target.value)} 
                                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-xs font-black italic text-[var(--text-primary)] outline-none focus:border-[#5865F2]/30 transition-colors"
                                                placeholder="Scorpion Operator"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-[8px] font-black uppercase tracking-widest text-[var(--text-secondary)] font-mono">Custom Avatar URL</label>
                                            <input 
                                                type="text" 
                                                value={discordAvatar} 
                                                onChange={(e) => setDiscordAvatar(e.target.value)} 
                                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-xs font-black italic text-[var(--text-primary)] outline-none focus:border-[#5865F2]/30 transition-colors"
                                                placeholder="https://path-to-image.png"
                                            />
                                        </div>
                                    </div>

                                    <div className="mb-6">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] block mb-3 font-mono">Alert Trigger Events</span>
                                        <div className="flex flex-wrap gap-6 bg-black/20 p-4 rounded-xl border border-white/5">
                                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                                <input 
                                                    type="checkbox" 
                                                    checked={alertCritical} 
                                                    onChange={(e) => setAlertCritical(e.target.checked)} 
                                                    className="w-4 h-4 rounded border-[var(--border-subtle)] text-[#5865F2] focus:ring-[#5865F2] bg-[var(--bg-primary)]"
                                                />
                                                <span className="text-[10px] font-black uppercase italic text-[var(--text-primary)] pr-2">Critical Vulns</span>
                                            </label>
                                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                                <input 
                                                    type="checkbox" 
                                                    checked={alertPolicy} 
                                                    onChange={(e) => setAlertPolicy(e.target.checked)} 
                                                    className="w-4 h-4 rounded border-[var(--border-subtle)] text-[#5865F2] focus:ring-[#5865F2] bg-[var(--bg-primary)]"
                                                />
                                                <span className="text-[10px] font-black uppercase italic text-[var(--text-primary)] pr-2">Policy Blocks</span>
                                            </label>
                                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                                <input 
                                                    type="checkbox" 
                                                    checked={alertDeploy} 
                                                    onChange={(e) => setAlertDeploy(e.target.checked)} 
                                                    className="w-4 h-4 rounded border-[var(--border-subtle)] text-[#5865F2] focus:ring-[#5865F2] bg-[var(--bg-primary)]"
                                                />
                                                <span className="text-[10px] font-black uppercase italic text-[var(--text-primary)] pr-2">Deployment Success</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-4 border-t border-white/5 pt-4">
                                    <button 
                                        onClick={handleSaveDiscordMesh}
                                        disabled={discordSaving || !discordWebhook}
                                        className="flex-1 py-3.5 bg-[#5865F2] hover:bg-[#4752c4] text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-30 shadow-[0_4px_12px_rgba(88,101,242,0.2)] hover:scale-[1.01]"
                                    >
                                        {discordSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save size={12} />}
                                        Save Discord Configuration
                                    </button>
                                    <button 
                                        onClick={() => handleTest('discord', discordWebhook)}
                                        disabled={testing === 'discord' || !discordWebhook}
                                        className="px-6 py-3.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-[#5865F2] text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-30 text-[var(--text-primary)]"
                                    >
                                        {testing === 'discord' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send size={12} />}
                                        Dispatch Test Payload
                                    </button>
                                </div>
                            </div>
                            <IntegrationCard 
                                icon={<Slack size={24} />} 
                                color="text-[#E01E5A]" 
                                title="Slack Block Kit" 
                                value={slackWebhook} 
                                setValue={setSlackWebhook} 
                                onTest={() => handleTest('slack', slackWebhook)}
                                testing={testing === 'slack'}
                                placeholder="Webhook URL"
                            />
                            <IntegrationCard 
                                icon={<PhoneCall size={24} />} 
                                color="text-[#12AD2B]" 
                                title="PagerDuty V2" 
                                value={pagerdutyKey} 
                                setValue={setPagerdutyKey} 
                                onTest={() => handleTest('pagerduty', pagerdutyKey)}
                                testing={testing === 'pagerduty'}
                                placeholder="Routing Key"
                            />
                            <IntegrationCard 
                                icon={<Zap size={24} />} 
                                color="text-[#FF9900]" 
                                title="OpsGenie Alerts" 
                                value={opsgenieKey} 
                                setValue={setOpsgenieKey} 
                                onTest={() => handleTest('opsgenie', opsgenieKey)}
                                testing={testing === 'opsgenie'}
                                placeholder="GenieKey"
                            />
                        </div>

                        <div className="flex justify-end">
                            <button 
                                onClick={handleSave} 
                                disabled={saving}
                                className="btn-premium px-12 py-5 text-sm"
                            >
                                {saving ? <Loader2 className="animate-spin" /> : <Save size={20} />}
                                {saving ? 'Committing...' : 'Commit Alert Mesh Config'}
                            </button>
                        </div>

                    </div>
                ) : (
                    <div className="premium-card p-10 min-h-[600px] animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Feed Content - Keep existing logic or similar */}
                        <div className="space-y-6">
                            {feedLoading ? (
                                <div className="flex justify-center items-center h-64">
                                    <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin" />
                                </div>
                            ) : findings.map(f => (
                                <div key={f.$id} className="p-6 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl flex items-center justify-between group hover:border-[var(--accent-primary)]/30 transition-all">
                                    <div className="flex items-center gap-6">
                                        <div className={`p-3 rounded-xl border-2 ${SEVERITY_COLORS[f.severity?.toLowerCase() || 'medium']}`}>
                                            <SeverityIcon severity={f.severity || 'medium'} />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tight">{f.title}</h4>
                                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1">{f.repo_name} • {f.type}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase italic">{new Date(f.$createdAt).toLocaleTimeString()}</p>
                                        <span className="text-[8px] font-black text-[var(--accent-primary)] uppercase tracking-widest italic">{f.$id}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function IntegrationCard({ icon, color, title, value, setValue, onTest, testing, placeholder }: any) {
    return (
        <div className="premium-card p-8 group">
            <div className={`w-12 h-12 ${color} bg-white/5 rounded-2xl flex items-center justify-center mb-6 border border-white/10 group-hover:scale-110 transition-transform`}>
                {icon}
            </div>
            <h3 className={`text-xs font-black ${color} uppercase tracking-[0.2em] italic mb-6`}>{title}</h3>
            <div className="space-y-4">
                <input 
                    type="password" 
                    value={value} 
                    onChange={(e) => setValue(e.target.value)} 
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-4 text-xs font-black italic text-[var(--text-primary)] outline-none focus:border-white/30 transition-colors"
                    placeholder={placeholder}
                />
                <button 
                    onClick={onTest} 
                    disabled={testing || !value}
                    className="w-full py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:bg-[var(--accent-primary)] hover:text-white hover:border-[var(--accent-primary)] rounded-xl text-[10px] font-black uppercase italic tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-30"
                >
                    {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send size={12} />}
                    Dispatch Test Payload
                </button>
            </div>
        </div>
    );
}
