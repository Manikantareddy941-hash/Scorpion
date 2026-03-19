import React, { useEffect, useState } from 'react';
import { account, databases, DB_ID, ID, Query, storage, COLLECTIONS } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import {
    User, Mail, Bell, Key,
    Save, Loader2, LogOut, Moon, Sun,
    Terminal, Github, Eye, Snowflake, Camera, Upload, Waves
} from 'lucide-react';
import { Theme } from '../contexts/ThemeContext';
import { useTheme } from '../contexts/ThemeContext';

export default function Settings() {
    const { user, signOut, updatePassword, getGithubToken, refreshUser, getJWT } = useAuth();
    const { theme, setTheme } = useTheme();
    const [isGithubConnected, setIsGithubConnected] = useState(false);
    const [preferences, setPreferences] = useState({});
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState<string | null>((user?.prefs as any)?.profilePic || null);
    
    const [profile, setProfile] = useState<any>({
        name: user?.name || '',
        email: user?.email || '',
        company: '',
        role: ''
    });

    const [prefEmail, setPrefEmail] = useState(true);
    const [prefSlack, setPrefSlack] = useState(false);
    const [prefWebhook, setPrefWebhook] = useState('');

    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [newKeyName, setNewKeyName] = useState('');
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    useEffect(() => {
        const checkGithubConnection = async () => {
            const token = await getGithubToken();
            setIsGithubConnected(!!token);
        };
        checkGithubConnection();
    }, [getGithubToken]);

    useEffect(() => {
        if (user?.prefs) {
            fetchSettings();
            setPreferences(prev => ({ ...prev, ...user.prefs }));
            setAvatarUrl((user.prefs as any)?.profilePic || null);
            setProfile((prev: any) => ({ ...prev, name: user.name, email: user.email }));
        }
    }, [user]);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            // Fetch notification preferences
            const prefResponse = await databases.listDocuments(
                DB_ID,
                'notification_preferences',
                [Query.equal('user_id', user?.$id || '')]
            );
            
            if (prefResponse.total > 0) {
                const prefs = prefResponse.documents;
                setPrefEmail(prefs.some(p => p.channel === 'email' && p.enabled));
                setPrefSlack(prefs.some(p => p.channel === 'slack' && p.enabled));
                setPrefWebhook(prefs.find(p => p.channel === 'webhook')?.target || '');
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
            setLoading(false);
        }
    };

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setUpdating(true);
        try {
            await account.updateName(profile.name);
            await refreshUser();
            alert('Profile updated successfully');
        } catch (error) {
            console.error('Update profile error:', error);
        } finally {
            setUpdating(false);
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const bucketId = COLLECTIONS.AVATARS_BUCKET_ID;
            const fileId = ID.unique();
            const response = await storage.createFile(bucketId, fileId, file);
            
            const url = `${import.meta.env.VITE_APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${response.$id}/view?project=${import.meta.env.VITE_APPWRITE_PROJECT_ID}`;
            // 3. Update User Preferences
            await account.updatePrefs({
                ...user?.prefs,
                profilePic: url
            });

            setAvatarUrl(url);
            await refreshUser();
            alert('Profile picture updated');
        } catch (error: any) {
            console.error('Avatar upload error:', error);
            alert(`Upload failed: ${error.message}`);
        } finally {
            setUploading(false);
        }
    };

    const handleSaveNotifications = async () => {
        setUpdating(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            
            await fetch(`${apiBase}/api/notifications/preferences`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
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
        } finally {
            setUpdating(false);
        }
    };

    const generateApiKey = async () => {
        if (!newKeyName) return;
        setUpdating(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            
            const response = await fetch(`${apiBase}/api/auth/api-key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name: newKeyName })
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
            <Loader2 className="w-8 h-8 text-[var(--accent-primary)] animate-spin" />
        </div>
    );

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] py-12">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center gap-4 mb-12">
                    <div className="w-12 h-12 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-[var(--accent-primary)]/20">
                        <Terminal className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">System Configuration</h1>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Neural Interface & Access Protocols</p>
                    </div>
                </div>

                <div className="space-y-12">
                    {/* Dark Mode Toggle */}
                    <div className="premium-card p-10">
                        <div className="flex items-center gap-5 mb-8">
                            <div className="w-12 h-12 bg-[var(--accent-primary)]/10 rounded-2xl flex items-center justify-center border border-[var(--accent-primary)]/20">
                                {theme === 'dark' || theme === 'snow-dark' ? <Moon className="w-5 h-5 text-[var(--accent-primary)]" /> : <Sun className="w-5 h-5 text-[var(--accent-primary)]" />}
                            </div>
                            <div>
                                <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">Visual Interface Mode</h3>
                                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">Select a luminance vector for your terminal</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {[
                                { id: 'light', label: 'Light Mode', icon: Sun, desc: 'High visibility daylight protocol' },
                                { id: 'dark', label: 'Dark Mode', icon: Moon, desc: 'Stealth ops standard interface' },
                                { id: 'eye-protection', label: 'Eye Protection', icon: Eye, desc: 'Warm amber neural filter' },
                                { id: 'snow-light', label: 'Snow Light', icon: Snowflake, desc: 'Arctic day with active precipitation' },
                                { id: 'snow-dark', label: 'Snow Dark', icon: Snowflake, desc: 'Arctic night with active precipitation' },
                                { id: 'underwater', label: 'Underwater', icon: Waves, desc: 'Deep sea stealth mode with caustic light' },
                            ].map((t) => (
                                <button
                                    key={t.id}
                                    onClick={() => setTheme(t.id as Theme)}
                                    className={`p-6 rounded-2xl border-2 transition-all flex flex-col items-start gap-4 text-left group
                                        ${theme === t.id ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 shadow-lg shadow-[var(--accent-primary)]/10' : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--accent-primary)]/30'}`}
                                >
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors
                                        ${theme === t.id ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-card)] text-[var(--text-secondary)] group-hover:text-[var(--accent-primary)]'}`}>
                                        <t.icon size={20} />
                                    </div>
                                    <div>
                                        <p className={`text-[11px] font-black uppercase italic tracking-wider mb-1 ${theme === t.id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
                                            {t.label}
                                        </p>
                                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase leading-tight italic">
                                            {t.desc}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Profile Section */}
                    <section className="premium-card p-10">
                        <h3 className="text-xs font-black text-[var(--text-primary)] mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <User className="w-4 h-4 text-[var(--accent-primary)]" /> Operator Credentials
                        </h3>

                        {/* Avatar Section */}
                        <div className="flex flex-col md:flex-row items-center gap-8 mb-12 pb-12 border-b border-[var(--border-subtle)]">
                            <div className="relative group">
                                <div className="w-32 h-32 rounded-[2.5rem] bg-[var(--bg-secondary)] border-2 border-[var(--border-subtle)] flex items-center justify-center overflow-hidden transition-all group-hover:border-[var(--accent-primary)] shadow-2xl">
                                    {avatarUrl ? (
                                        <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-4xl font-black text-[var(--text-secondary)] italic">
                                            {user?.name?.charAt(0).toUpperCase() || 'S'}
                                        </span>
                                    )}
                                    {uploading && (
                                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                                        </div>
                                    )}
                                </div>
                                <label className="absolute -bottom-2 -right-2 w-10 h-10 bg-[var(--accent-primary)] rounded-xl flex items-center justify-center text-white cursor-pointer shadow-lg hover:scale-110 transition-transform">
                                    <Camera size={18} />
                                    <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} disabled={uploading} />
                                </label>
                            </div>
                            <div className="flex-1 text-center md:text-left">
                                <h4 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tight mb-2">Neural Link Visualization</h4>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic leading-relaxed max-w-sm">
                                    Register your operational appearance in the system. This identifier will be broadcasted across all encrypted command interfaces.
                                </p>
                                <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-4">
                                    <button 
                                        onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
                                        className="text-[10px] font-black uppercase tracking-widest text-[var(--accent-primary)] flex items-center gap-2 hover:opacity-70 transition-opacity"
                                    >
                                        <Upload size={14} /> Upload Binary Image
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* GitHub Connection Section */}
                        <div className="mb-12 pb-12 border-b border-[var(--border-subtle)]">
                            <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)] relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                    <Github className="w-16 h-16" />
                                </div>
                                <div className="flex items-center gap-5 z-10">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-colors
                                        ${isGithubConnected ? 'bg-[var(--status-success)]/10 border-[var(--status-success)]/30 text-[var(--status-success)]' : 'bg-white/5 border-white/10 text-white'}`}>
                                        <Github size={24} />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-black text-[var(--text-primary)] uppercase italic tracking-widest">GitHub Repository Access</h4>
                                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">
                                            {isGithubConnected ? 'Neural Link Active — Authorized for Scan Operations' : 'Neural Link Required for Repository Indexing'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        sessionStorage.setItem('oauth_return_to', '/settings');
                                        (useAuth() as any).signInWithOAuth('github');
                                    }}
                                    className={`px-8 py-3 rounded-xl text-xs font-black uppercase italic tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl
                                        ${isGithubConnected ? 'bg-white/5 border border-white/10 text-white hover:bg-white/10' : 'bg-[var(--accent-primary)] text-black shadow-[var(--accent-primary)]/20 hover:shadow-[var(--accent-primary)]/40'}`}
                                >
                                    {isGithubConnected ? 'Reconnect Neural Link' : 'Initialize Neural Link'}
                                </button>
                            </div>
                        </div>

                        <form onSubmit={handleUpdateProfile} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block">Designation Name</label>
                                <input
                                    type="text"
                                    value={profile.name}
                                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                                    className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/10 focus:border-[var(--accent-primary)] text-[var(--text-primary)] transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block">Communications ID</label>
                                <input
                                    type="email"
                                    disabled
                                    value={profile.email}
                                    className="w-full px-6 py-4 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs text-[var(--text-secondary)] opacity-60"
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
                        <h3 className="text-xs font-black text-[var(--text-primary)] mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <Bell className="w-4 h-4 text-[var(--accent-secondary)]" /> Neural Alert Feeds
                        </h3>
                        <div className="space-y-6">
                            <div className="flex items-center justify-between p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)]">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-[var(--accent-primary)]/10 rounded-xl flex items-center justify-center text-[var(--accent-primary)]">
                                        <Mail className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">Direct Dispatch (Email)</p>
                                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">Receive critical vectors to {profile.email}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setPrefEmail(!prefEmail)}
                                    className={`w-12 h-6 rounded-full p-1 transition-colors ${prefEmail ? 'bg-[var(--status-success)]' : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'}`}
                                >
                                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${prefEmail ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)]">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-[var(--accent-secondary)]/10 rounded-xl flex items-center justify-center text-[var(--accent-secondary)]">
                                        <Github className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">PR Interceptor (Slack)</p>
                                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">Trigger alerts on security posture regression</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setPrefSlack(!prefSlack)}
                                    className={`w-12 h-6 rounded-full p-1 transition-colors ${prefSlack ? 'bg-[var(--status-success)]' : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'}`}
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
                        <h3 className="text-xs font-black text-[var(--status-success)] mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <Key className="w-4 h-4 text-[var(--status-success)]" /> Automated Access Keys (CI/CD)
                        </h3>
                        
                        {generatedKey && (
                            <div className="mb-8 p-6 bg-[var(--status-success)]/10 border border-[var(--status-success)]/20 rounded-2xl">
                                <p className="text-[10px] font-black text-[var(--status-success)] uppercase tracking-widest mb-3 animate-pulse">New Neural Key Linked - COPY NOW</p>
                                <code className="block bg-[var(--bg-primary)] text-[var(--status-success)] p-4 rounded-xl font-mono text-sm break-all border border-[var(--status-success)]/30">
                                    {generatedKey}
                                </code>
                                <p className="text-[9px] text-[var(--text-secondary)] mt-3 italic">* This key will not be displayed again. Store it in a secure vault.</p>
                            </div>
                        )}

                        <div className="flex gap-4 mb-10">
                            <input
                                type="text"
                                placeholder="Key Designation (e.g. JENKINS-MASTER)"
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                className="flex-1 px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none text-[var(--text-primary)] focus:ring-4 focus:ring-[var(--accent-primary)]/10"
                            />
                            <button onClick={generateApiKey} className="btn-premium whitespace-nowrap">Generate Neural Key</button>
                        </div>

                        <div className="space-y-4">
                            {apiKeys.map((key) => (
                                <div key={key.$id} className="flex justify-between items-center p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)]">
                                    <div>
                                        <p className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">{key.name}</p>
                                        <p className="text-[10px] font-mono text-[var(--text-secondary)] mt-1">{key.masked_key || 'sk_••••••••••••'}</p>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <span className="text-[9px] font-black text-[var(--status-success)] uppercase tracking-widest italic">Active Vector</span>
                                        <button className="p-2 text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-colors">
                                            <LogOut className="w-4 h-4 rotate-90" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Danger Zone */}
                    <section className="premium-card p-10 border-[var(--status-error)]/20">
                        <h3 className="text-xs font-black text-[var(--status-error)] mb-8 uppercase tracking-[0.2em] italic">Decommissioning Zone</h3>
                        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
                            <div>
                                <h4 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tight">System Termination</h4>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1">Disconnect current telemetry session</p>
                            </div>
                            <button
                                onClick={signOut}
                                className="px-10 py-4 bg-[var(--status-error)]/10 text-[var(--status-error)] border border-[var(--status-error)]/20 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[var(--status-error)] hover:text-white transition-all shadow-xl shadow-[var(--status-error)]/5"
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
