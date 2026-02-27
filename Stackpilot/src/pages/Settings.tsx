import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
    ArrowLeft, Settings as SettingsIcon, Bell, ScanSearch, Save,
    Plus, AlertCircle, Loader2, User, Globe, Github, Slack, Key, CheckCircle2,
    Terminal, Zap, Cpu, Copy, Trash2, Code, Info
} from 'lucide-react';

interface NotificationPreferences {
    sns_topic_arn: string;
    email_notifications: boolean;
    slack_webhook: string;
}

export default function SettingsPage() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'profile' | 'scan' | 'notifications' | 'integrations' | 'developer'>('profile');

    // Profile state
    const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name || '');
    const [updatingProfile, setUpdatingProfile] = useState(false);

    // Scan state
    const [repoUrl, setRepoUrl] = useState('');
    const [scanning, setScanning] = useState(false);
    const [scanMessage, setScanMessage] = useState('');
    const [scanError, setScanError] = useState('');

    // Notification prefs state
    const [prefs, setPrefs] = useState<NotificationPreferences>({
        sns_topic_arn: '',
        email_notifications: true,
        slack_webhook: '',
    });
    const [saving, setSaving] = useState(false);

    // API Keys state
    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [generatingKey, setGeneratingKey] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

    useEffect(() => {
        fetchNotificationPrefs();
        fetchApiKeys();
    }, []);

    const fetchApiKeys = async () => {
        try {
            const session = JSON.parse(localStorage.getItem('supabase.auth.token') || '{}');
            const token = session?.currentSession?.access_token;
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/keys`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            setApiKeys(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching API keys:', err);
        }
    };

    const handleGenerateKey = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newKeyName.trim()) return;
        setGeneratingKey(true);
        try {
            const session = JSON.parse(localStorage.getItem('supabase.auth.token') || '{}');
            const token = session?.currentSession?.access_token;
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/keys`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: newKeyName })
            });
            const data = await response.json();
            if (data.api_key) {
                setNewlyCreatedKey(data.api_key);
                setApiKeys([data, ...apiKeys]);
                setNewKeyName('');
            }
        } catch (err) {
            console.error('Error generating key:', err);
        } finally {
            setGeneratingKey(false);
        }
    };

    const handleRevokeKey = async (id: string) => {
        if (!confirm('Are you sure you want to revoke this API key? Pipelines using it will fail.')) return;
        try {
            const session = JSON.parse(localStorage.getItem('supabase.auth.token') || '{}');
            const token = session?.currentSession?.access_token;
            await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/keys/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setApiKeys(apiKeys.filter(k => k.id !== id));
        } catch (err) {
            console.error('Error revoking key:', err);
        }
    };

    const fetchNotificationPrefs = async () => {
        try {
            const { data, error } = await supabase
                .from('notification_preferences')
                .select('*')
                .eq('user_id', user?.id)
                .single();

            if (data && !error) {
                setPrefs({
                    sns_topic_arn: data.sns_topic_arn || '',
                    email_notifications: data.email_notifications ?? true,
                    slack_webhook: data.slack_webhook || '',
                });
            }
        } catch (err) {
            // No prefs yet
        }
    };

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setUpdatingProfile(true);
        try {
            const session = JSON.parse(localStorage.getItem('supabase.auth.token') || '{}');
            const token = session?.currentSession?.access_token;

            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/user/profile`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ displayName })
            });

            if (response.ok) {
                alert('Profile updated successfully!');
            }
        } catch (err) {
            console.error(err);
        } finally {
            setUpdatingProfile(false);
        }
    };

    const handleScanCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setScanMessage('');
        setScanError('');
        if (!repoUrl.trim()) return;
        setScanning(true);
        try {
            const { data: repo, error: repoError } = await supabase
                .from('repositories')
                .upsert(
                    { user_id: user?.id, url: repoUrl, name: repoUrl.split('/').pop() },
                    { onConflict: 'user_id,url' }
                )
                .select().single();
            if (repoError) throw repoError;

            const session = JSON.parse(localStorage.getItem('supabase.auth.token') || '{}');
            const token = session?.currentSession?.access_token;
            await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/repos/${repo.id}/scan`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            setScanMessage(`Scan triggered for ${repoUrl}! Check Control Center for results.`);
            setRepoUrl('');
        } catch (err: any) {
            setScanError(err.message);
        } finally {
            setScanning(false);
        }
    };

    const handleSavePrefs = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await supabase.from('notification_preferences').upsert({
                user_id: user?.id,
                sns_topic_arn: prefs.sns_topic_arn,
                email_notifications: prefs.email_notifications,
                slack_webhook: prefs.slack_webhook,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });
            alert('Preferences saved!');
        } catch (err: any) {
            alert(err.message);
        } finally {
            setSaving(false);
        }
    };

    const tabs = [
        { id: 'profile' as const, label: 'Identity', icon: <User className="w-4 h-4" /> },
        { id: 'scan' as const, label: 'Ingestion', icon: <ScanSearch className="w-4 h-4" /> },
        { id: 'notifications' as const, label: 'Alert Core', icon: <Bell className="w-4 h-4" /> },
        { id: 'integrations' as const, label: 'Protocols', icon: <Globe className="w-4 h-4" /> },
        { id: 'developer' as const, label: 'Dev Tools', icon: <Code className="w-4 h-4" /> },
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 p-8 text-slate-900 dark:text-white">
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-slate-900 p-3 rounded-2xl shadow-lg">
                            <SettingsIcon className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none">Intelligence Config</h1>
                            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Platform Orchestration</p>
                        </div>
                    </div>
                    <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl hover:bg-slate-50 dark:bg-slate-800/50 transition font-black uppercase tracking-widest text-xs border border-slate-200 dark:border-slate-700 shadow-sm">
                        <ArrowLeft className="w-4 h-4" />
                        Dashboard
                    </Link>
                </div>

                {/* Tab Navigation */}
                <div className="flex bg-slate-200/50 p-1.5 rounded-[2rem] mb-12 max-w-2xl mx-auto">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 flex items-center justify-center gap-2.5 py-4 px-6 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab.id
                                ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-sm'
                                : 'text-slate-400 hover:text-slate-600 dark:text-slate-300'
                                }`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                {/* Profile View */}
                {activeTab === 'profile' && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                        <div className="md:col-span-1">
                            <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 text-center relative overflow-hidden group">
                                <div className="relative z-10">
                                    <div className="w-24 h-24 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl mx-auto mb-6 flex items-center justify-center text-white text-3xl font-black shadow-2xl shadow-blue-100 group-hover:scale-110 transition-transform">
                                        {displayName.charAt(0) || user?.email?.charAt(0) || 'U'}
                                    </div>
                                    <h3 className="font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">{displayName || 'Architect'}</h3>
                                    <p className="text-[10px] text-slate-400 font-bold mb-6 tracking-tight italic">{user?.email}</p>
                                    <div className="px-4 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-[9px] font-black uppercase tracking-widest border border-blue-100">Senior DevOps Lead</div>
                                </div>
                                <Zap className="absolute -right-6 -bottom-6 w-24 h-24 text-slate-50 opacity-50" />
                            </div>
                        </div>
                        <div className="md:col-span-3 bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 p-10">
                            <h2 className="text-sm font-black text-slate-900 dark:text-white mb-8 uppercase tracking-widest italic border-b border-slate-100 dark:border-slate-800 pb-4">Personal Metadata</h2>
                            <form onSubmit={handleUpdateProfile} className="space-y-8">
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 italic">Display Name</label>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-none rounded-2xl focus:ring-4 focus:ring-blue-50 focus:bg-white dark:bg-slate-900 transition-all font-black text-slate-900 dark:text-white tracking-tight"
                                        placeholder="Enter Identity..."
                                    />
                                </div>
                                <button type="submit" disabled={updatingProfile} className="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-2xl transition shadow-xl shadow-slate-200 flex items-center justify-center gap-2 uppercase tracking-widest text-xs">
                                    {updatingProfile ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                    Synchronize Profile
                                </button>
                            </form>
                        </div>
                    </div>
                )}

                {/* Ingestion View */}
                {activeTab === 'scan' && (
                    <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 p-10 max-w-2xl mx-auto">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="bg-blue-50 p-2.5 rounded-xl">
                                <ScanSearch className="w-6 h-6 text-blue-600" />
                            </div>
                            <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest italic">Manual Code Ingestion</h2>
                        </div>
                        <form onSubmit={handleScanCode} className="space-y-8">
                            {scanError && (
                                <div className="bg-red-50 border border-red-100 rounded-2xl p-5 flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-red-600" />
                                    <p className="text-[10px] text-red-800 font-black uppercase tracking-tight">{scanError}</p>
                                </div>
                            )}
                            {scanMessage && (
                                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 flex items-start gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                    <p className="text-[10px] text-emerald-800 font-black uppercase tracking-tight">{scanMessage}</p>
                                </div>
                            )}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 italic">Source Code Origin (Git)</label>
                                <input
                                    type="url"
                                    value={repoUrl}
                                    onChange={(e) => setRepoUrl(e.target.value)}
                                    className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-none rounded-2xl focus:ring-4 focus:ring-blue-50 focus:bg-white dark:bg-slate-900 transition-all font-mono text-sm font-bold text-slate-900 dark:text-white"
                                    placeholder="https://github.com/..."
                                />
                            </div>
                            <button type="submit" disabled={scanning} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl transition shadow-xl shadow-blue-100 flex items-center justify-center gap-2 uppercase tracking-widest text-xs">
                                {scanning ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                                Begin Security Audit
                            </button>
                        </form>
                    </div>
                )}

                {/* Notifications View */}
                {activeTab === 'notifications' && (
                    <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 p-10 max-w-2xl mx-auto">
                        <h2 className="text-sm font-black text-slate-900 dark:text-white mb-8 uppercase tracking-widest italic border-b border-slate-100 dark:border-slate-800 pb-4">Alert Core Protocols</h2>
                        <form onSubmit={handleSavePrefs} className="space-y-8">
                            <div className="flex items-center justify-between p-8 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800 group">
                                <div>
                                    <p className="font-black text-slate-900 dark:text-white text-sm uppercase tracking-tight">Realtime Email Sync</p>
                                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">Status: {prefs.email_notifications ? 'Active' : 'Standby'}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPrefs({ ...prefs, email_notifications: !prefs.email_notifications })}
                                    className={`relative w-16 h-8 rounded-full transition-all duration-300 ${prefs.email_notifications ? 'bg-blue-600 shadow-lg shadow-blue-100' : 'bg-slate-300'}`}
                                >
                                    <div className={`absolute top-1 left-1 w-6 h-6 bg-white dark:bg-slate-900 rounded-full shadow-sm transition-transform duration-300 ${prefs.email_notifications ? 'translate-x-8' : 'translate-x-0'}`} />
                                </button>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 italic">AWS SNS Pub/Sub Signature</label>
                                <input
                                    type="text"
                                    value={prefs.sns_topic_arn}
                                    onChange={(e) => setPrefs({ ...prefs, sns_topic_arn: e.target.value })}
                                    className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-none rounded-2xl focus:ring-4 focus:ring-blue-50 font-mono text-xs font-bold text-slate-900 dark:text-white"
                                    placeholder="arn:aws:sns:..."
                                />
                            </div>
                            <button type="submit" disabled={saving} className="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-2xl transition shadow-xl shadow-slate-200 flex items-center justify-center gap-2 uppercase tracking-widest text-xs">
                                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                Commit Alert Logic
                            </button>
                        </form>
                    </div>
                )}

                {/* Integrations View */}
                {activeTab === 'integrations' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {[
                            { name: 'GitHub Enterprise', icon: <Github className="w-8 h-8" />, desc: 'Primary Source Bridge', status: 'Connected', color: 'text-slate-900 dark:text-white' },
                            { name: 'Slack Protocols', icon: <Slack className="w-8 h-8" />, desc: 'Intelligence Webhooks', status: 'Standby', color: 'text-slate-400' },
                            { name: 'AWS Infrastructure', icon: <Cpu className="w-8 h-8" />, desc: 'Telemetry Sink', status: 'Awaiting ARN', color: 'text-slate-400' },
                            { name: 'HashiCorp Custodian', icon: <Key className="w-8 h-8" />, desc: 'Secret Management', status: 'Encrypted', color: 'text-slate-900 dark:text-white' }
                        ].map((item) => (
                            <div key={item.name} className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 group hover:border-blue-500 transition-all cursor-not-allowed relative overflow-hidden">
                                <div className="flex items-start justify-between mb-6 relative z-10">
                                    <div className={`p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl ${item.color} group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors`}>
                                        {item.icon}
                                    </div>
                                    <span className="px-3 py-1 bg-slate-50 dark:bg-slate-800/50 text-slate-400 rounded-lg text-[8px] font-black uppercase tracking-widest group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm">
                                        {item.status}
                                    </span>
                                </div>
                                <h3 className="font-black text-slate-900 dark:text-white mb-2 uppercase tracking-tighter italic">{item.name}</h3>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{item.desc}</p>
                                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                    {item.icon}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Developer Tools View */}
                {activeTab === 'developer' && (
                    <div className="space-y-8 max-w-4xl mx-auto">
                        {/* API Keys Management */}
                        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 p-10">
                            <div className="flex items-center justify-between mb-8 border-b border-slate-100 dark:border-slate-800 pb-6">
                                <div className="flex items-center gap-4">
                                    <div className="bg-slate-900 p-3 rounded-2xl">
                                        <Key className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest italic">Signal Tokens (API Keys)</h2>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Authenticate external audit pipelines</p>
                                    </div>
                                </div>
                            </div>

                            {newlyCreatedKey && (
                                <div className="mb-8 bg-blue-600 p-8 rounded-3xl text-white relative overflow-hidden group">
                                    <div className="relative z-10">
                                        <p className="text-[10px] font-black uppercase tracking-widest mb-2 opacity-80">New Key Generated (Save it safely now!)</p>
                                        <div className="flex items-center justify-between bg-white/10 p-4 rounded-2xl backdrop-blur-md border border-white/20">
                                            <code className="font-mono text-sm font-bold tracking-wider">{newlyCreatedKey}</code>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(newlyCreatedKey);
                                                    alert('Key copied to clipboard!');
                                                }}
                                                className="p-2 hover:bg-white/20 rounded-xl transition-all"
                                            >
                                                <Copy className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => setNewlyCreatedKey(null)}
                                            className="mt-4 text-[9px] font-black uppercase tracking-widest bg-white dark:bg-slate-900 text-blue-600 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors"
                                        >
                                            I've saved it securely
                                        </button>
                                    </div>
                                    <Zap className="absolute -right-8 -bottom-8 w-32 h-32 opacity-10 rotate-12" />
                                </div>
                            )}

                            <form onSubmit={handleGenerateKey} className="flex gap-4 mb-10">
                                <input
                                    type="text"
                                    value={newKeyName}
                                    onChange={(e) => setNewKeyName(e.target.value)}
                                    placeholder="Enter identifier (e.g. GitHub Action)..."
                                    className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-none rounded-2xl focus:ring-4 focus:ring-blue-50 focus:bg-white dark:bg-slate-900 transition-all font-black text-slate-900 dark:text-white text-xs tracking-tight uppercase"
                                />
                                <button
                                    type="submit"
                                    disabled={generatingKey || !newKeyName}
                                    className="px-8 bg-slate-900 text-white rounded-2xl hover:bg-black transition font-black uppercase tracking-widest text-[10px] shadow-lg disabled:opacity-50"
                                >
                                    {generatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate Token'}
                                </button>
                            </form>

                            <div className="space-y-4">
                                {apiKeys.map((key) => (
                                    <div key={key.id} className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-[1.5rem] border border-slate-100 dark:border-slate-800 group">
                                        <div className="flex items-center gap-4">
                                            <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                                                <Terminal className="w-5 h-5 text-slate-400" />
                                            </div>
                                            <div>
                                                <p className="font-black text-slate-900 dark:text-white text-xs uppercase tracking-tight">{key.name}</p>
                                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Created on {new Date(key.created_at).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleRevokeKey(key.id)}
                                            className="p-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                                {apiKeys.length === 0 && (
                                    <div className="text-center py-10">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">No active tokens detected</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* GitHub Action Template */}
                        <div className="bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-800 p-10 text-white relative overflow-hidden">
                            <div className="relative z-10">
                                <div className="flex items-center gap-4 mb-8">
                                    <div className="bg-blue-600 p-3 rounded-2xl">
                                        <Github className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-sm font-black uppercase tracking-widest italic">Pipeline Automation</h2>
                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Integrate StackPilot into GitHub Actions</p>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div className="bg-black/50 p-6 rounded-3xl border border-slate-800 font-mono text-[11px] leading-relaxed text-slate-300">
                                        <div className="mb-4 text-emerald-500 font-bold italic"># .github/workflows/security.yml</div>
                                        <p><span className="text-blue-400">name:</span> StackPilot Security Audit</p>
                                        <p><span className="text-blue-400">on:</span> [push]</p>
                                        <p><span className="text-blue-400">jobs:</span></p>
                                        <p className="ml-4"><span className="text-blue-400">audit:</span></p>
                                        <p className="ml-8"><span className="text-blue-400">runs-on:</span> ubuntu-latest</p>
                                        <p className="ml-8"><span className="text-blue-400">steps:</span></p>
                                        <p className="ml-12">- <span className="text-blue-400">name:</span> Trigger Scan</p>
                                        <p className="ml-16"><span className="text-blue-400">run:</span> |</p>
                                        <p className="ml-20">curl -X POST "{import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/webhooks/scan-trigger" \</p>
                                        <p className="ml-20">-H "X-API-KEY: ${'{'}{'{'} secrets.STACKPILOT_TOKEN {'}'}{'}'}" \</p>
                                        <p className="ml-20">-H "Content-Type: application/json" \</p>
                                        <p className="ml-20">-d '{'{'}"repo_url": "${'{'}{'{'} github.repositoryUrl {'}'}{'}'}"{'}'}'</p>
                                    </div>

                                    <div className="flex items-start gap-4 bg-blue-600/10 p-6 rounded-3xl border border-blue-600/20">
                                        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-1" />
                                        <p className="text-[10px] font-bold text-slate-300 leading-relaxed uppercase tracking-tight">
                                            Make sure to add your generated Signal Token to your GitHub repository secrets as <span className="text-white font-black italic">STACKPILOT_TOKEN</span>.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}




