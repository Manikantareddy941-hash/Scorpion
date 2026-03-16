import React, { useEffect, useState } from 'react';
import { account, databases, DB_ID, ID, Query } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
<<<<<<< HEAD
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/apiClient';
=======
>>>>>>> 98f3544 (ui updates)
import {
    User, Mail, Shield, Bell, Key,
    Save, Loader2, LogOut, Moon, Sun,
    Terminal, Globe, Github
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

<<<<<<< HEAD
interface NotificationPreferences {
    sns_topic_arn: string;
    email_notifications: boolean;
    slack_webhook: string;
}

export default function SettingsPage() {
    const { user, accessToken } = useAuth();
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
=======
export default function Settings() {
    const { user, signOut, updatePassword, getJWT } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [profile, setProfile] = useState<any>({
        name: user?.name || '',
        email: user?.email || '',
        company: '',
        role: ''
>>>>>>> 98f3544 (ui updates)
    });

    const [prefEmail, setPrefEmail] = useState(true);
    const [prefSlack, setPrefSlack] = useState(false);
    const [prefWebhook, setPrefWebhook] = useState('');

    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [newKeyName, setNewKeyName] = useState('');
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    useEffect(() => {
<<<<<<< HEAD
        fetchNotificationPrefs();
        fetchApiKeys();
    }, []);

    const fetchApiKeys = async () => {
        try {
            const data = await apiFetch(`/api/keys`, { token: accessToken });
            setApiKeys(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching API keys:', err);
=======
        if (user) {
            fetchSettings();
>>>>>>> 98f3544 (ui updates)
        }
    }, [user]);

    const fetchSettings = async () => {
        setLoading(true);
        try {
<<<<<<< HEAD
            const data = await apiFetch(`/api/keys`, {
                method: 'POST',
                body: JSON.stringify({ name: newKeyName }),
                token: accessToken
            });
            if (data?.api_key) {
                setNewlyCreatedKey(data.api_key);
                setApiKeys([data, ...apiKeys]);
                setNewKeyName('');
=======
            // Fetch profile extras from databases if exists
            // For now, we'll just use the account info
            
            // Fetch notification preferences
            const prefResponse = await databases.listDocuments(
                DB_ID,
                'notification_preferences',
                [Query.equal('user_id', user?.$id || '')]
            );
            
            if (prefResponse.total > 0) {
                // Simplified preference handling
                const prefs = prefResponse.documents;
                setPrefEmail(prefs.some(p => p.channel === 'email' && p.enabled));
                setPrefSlack(prefs.some(p => p.channel === 'slack' && p.enabled));
                setPrefWebhook(prefs.find(p => p.channel === 'webhook')?.target || '');
>>>>>>> 98f3544 (ui updates)
            }

            // Fetch API Keys
            const keysResponse = await databases.listDocuments(
                DB_ID,
                'api_keys',
                [Query.equal('user_id', user?.$id || '')]
            );
            setApiKeys(keysResponse.documents);

        } catch (error) {
            console.error('Error fetching settings:', error);
        } finally {
<<<<<<< HEAD
            setGeneratingKey(false);
        }
    };

    const handleRevokeKey = async (id: string) => {
        if (!confirm('Are you sure you want to revoke this API key? Pipelines using it will fail.')) return;
        try {
            await apiFetch(`/api/keys/${id}`, {
                method: 'DELETE',
                token: accessToken
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
=======
            setLoading(false);
>>>>>>> 98f3544 (ui updates)
        }
    };

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setUpdating(true);
        try {
<<<<<<< HEAD
            await apiFetch(`/api/user/profile`, {
                method: 'PATCH',
                body: JSON.stringify({ displayName }),
                token: accessToken
            });
            alert('Profile updated successfully!');
        } catch (err) {
            console.error(err);
=======
            await account.updateName(profile.name);
            // In Appwrite, email update requires verification flow, so we'll skip for now or use account.updateEmail
            
            alert('Profile updated successfully');
        } catch (error) {
            console.error('Update profile error:', error);
        } finally {
            setUpdating(false);
        }
    };

    const handleSaveNotifications = async () => {
        setUpdating(true);
        try {
            // This would ideally use a backend API or batch updates
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            
            await fetch(`${apiBase}/api/notifications/preferences`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'x-appwrite-session': token || ''
                },
                body: JSON.stringify({
                    preferences: [
                        { channel: 'email', enabled: prefEmail, event_type: 'scan_completed' },
                        { channel: 'slack', enabled: prefSlack, event_type: 'scan_completed' },
                        { channel: 'webhook', target: prefWebhook, enabled: !!prefWebhook, event_type: 'scan_completed' }
                    ]
                })
            });

            alert('Preferences saved');
        } catch (error) {
            console.error('Error saving notifications:', error);
>>>>>>> 98f3544 (ui updates)
        } finally {
            setUpdating(false);
        }
    };

    const generateApiKey = async () => {
        if (!newKeyName) return;
        setUpdating(true);
        try {
<<<<<<< HEAD
            const { data: repo, error: repoError } = await supabase
                .from('repositories')
                .upsert(
                    { user_id: user?.id, url: repoUrl, name: repoUrl.split('/').pop() },
                    { onConflict: 'user_id,url' }
                )
                .select().single();
            if (repoError) throw repoError;

            await apiFetch(`/api/repos/${repo.id}/scan`, {
                method: 'POST',
                token: accessToken
=======
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            
            const response = await fetch(`${apiBase}/api/auth/api-key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-appwrite-session': token || ''
                },
                body: JSON.stringify({ name: newKeyName })
>>>>>>> 98f3544 (ui updates)
            });

            const data = await response.json();
            if (data.key) {
                setGeneratedKey(data.key);
                setApiKeys([{ $id: ID.unique(), name: newKeyName, masked_key: 'sk_....' + data.key.slice(-4), created_at: new Date().toISOString() }, ...apiKeys]);
                setNewKeyName('');
            }
        } catch (error) {
            console.error('Error generating API key:', error);
        } finally {
            setUpdating(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
    );

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] py-12">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center gap-4 mb-12">
                    <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
                        <Terminal className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">System Configuration</h1>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic mt-1 font-mono">Neural Interface & Access Protocols</p>
                    </div>
                </div>

                <div className="space-y-12">
                    {/* Dark Mode Toggle */}
                    <div className="premium-card p-8 flex items-center justify-between">
                        <div className="flex items-center gap-5">
                            <div className="w-12 h-12 bg-slate-50 dark:bg-slate-900 rounded-2xl flex items-center justify-center border border-slate-100 dark:border-slate-800">
                                {theme === 'dark' ? <Moon className="w-5 h-5 text-indigo-400" /> : <Sun className="w-5 h-5 text-amber-500" />}
                            </div>
                            <div>
                                <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest italic">Visual Interface Mode</h3>
                                <p className="text-[9px] font-bold text-slate-400 uppercase italic mt-0.5">Toggle between Light/Dark luminance levels</p>
                            </div>
                        </div>
                        <button
                            onClick={toggleTheme}
                            className={`w-14 h-8 rounded-full p-1 transition-all duration-500 ease-in-out ${theme === 'dark' ? 'bg-indigo-600' : 'bg-slate-200'}`}
                        >
                            <div className={`w-6 h-6 rounded-full bg-white shadow-md transition-all duration-500 ${theme === 'dark' ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    {/* Profile Section */}
                    <section className="premium-card p-10">
                        <h3 className="text-xs font-black text-slate-900 dark:text-white mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <User className="w-4 h-4 text-blue-600" /> Operator Credentials
                        </h3>
                        <form onSubmit={handleUpdateProfile} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Designation Name</label>
                                <input
                                    type="text"
                                    value={profile.name}
                                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                                    className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl font-black italic text-xs outline-none focus:ring-4 focus:ring-blue-600/10 text-slate-900 dark:text-white"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Communications ID</label>
                                <input
                                    type="email"
                                    disabled
                                    value={profile.email}
                                    className="w-full px-6 py-4 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-2xl font-black italic text-xs text-slate-400"
                                />
                            </div>
                            <div className="md:col-span-2 flex justify-end">
                                <button
                                    type="submit"
                                    disabled={updating}
                                    className="btn-premium flex items-center gap-3"
                                >
                                    {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Sync Profile Info
                                </button>
                            </div>
                        </form>
                    </section>

                    {/* Notifications */}
                    <section className="premium-card p-10">
                        <h3 className="text-xs font-black text-slate-900 dark:text-white mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <Bell className="w-4 h-4 text-indigo-600" /> Neural Alert Feeds
                        </h3>
                        <div className="space-y-6">
                            <div className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center text-blue-600">
                                        <Mail className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase italic">Direct Dispatch (Email)</p>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase italic">Receive critical vectors to {profile.email}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setPrefEmail(!prefEmail)}
                                    className={`w-12 h-6 rounded-full p-1 transition-colors ${prefEmail ? 'bg-emerald-500' : 'bg-slate-300'}`}
                                >
                                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${prefEmail ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl flex items-center justify-center text-indigo-600">
                                        <Github className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase italic">PR Interceptor (Slack)</p>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase italic">Trigger alerts on security posture regression</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setPrefSlack(!prefSlack)}
                                    className={`w-12 h-6 rounded-full p-1 transition-colors ${prefSlack ? 'bg-emerald-500' : 'bg-slate-300'}`}
                                >
                                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${prefSlack ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            </div>

                            <div className="flex justify-end pt-4">
                                <button onClick={handleSaveNotifications} className="btn-premium">Commit Preferences</button>
                            </div>
                        </div>
                    </section>

                    {/* API Keys */}
                    <section className="premium-card p-10">
                        <h3 className="text-xs font-black text-slate-900 dark:text-white mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <Key className="w-4 h-4 text-emerald-600" /> Automated Access Keys (CI/CD)
                        </h3>
                        
                        {generatedKey && (
                            <div className="mb-8 p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-3 animate-pulse">New Neural Key Linked - COPY NOW</p>
                                <code className="block bg-slate-900 text-emerald-400 p-4 rounded-xl font-mono text-sm break-all border border-emerald-500/30">
                                    {generatedKey}
                                </code>
                                <p className="text-[9px] text-slate-400 mt-3 italic">* This key will not be displayed again. Store it in a secure vault.</p>
                            </div>
                        )}

                        <div className="flex gap-4 mb-10">
                            <input
                                type="text"
                                placeholder="Key Designation (e.g. JENKINS-MASTER)"
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl font-black italic text-xs outline-none"
                            />
                            <button onClick={generateApiKey} className="btn-premium whitespace-nowrap">Generate Neural Key</button>
                        </div>

                        <div className="space-y-4">
                            {apiKeys.map((key) => (
                                <div key={key.$id} className="flex justify-between items-center p-6 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800">
                                    <div>
                                        <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase italic">{key.name}</p>
                                        <p className="text-[10px] font-mono text-slate-400 mt-1">{key.masked_key || 'sk_••••••••••••'}</p>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest italic">Active Vector</span>
                                        <button className="p-2 text-slate-300 hover:text-rose-600 transition-colors">
                                            <LogOut className="w-4 h-4 rotate-90" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Danger Zone */}
                    <section className="premium-card p-10 border-rose-500/20">
                        <h3 className="text-xs font-black text-rose-600 mb-8 uppercase tracking-[0.2em] italic">Decommissioning Zone</h3>
                        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
                            <div>
                                <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase italic tracking-tight">System Termination</h4>
                                <p className="text-[10px] font-bold text-slate-400 uppercase italic mt-1">Disconnect current telemetry session</p>
                            </div>
                            <button
                                onClick={signOut}
                                className="px-10 py-4 bg-rose-600/10 text-rose-600 border border-rose-600/20 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-xl shadow-rose-500/5"
                            >
                                Deactivate Session
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
