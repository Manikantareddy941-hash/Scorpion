import React, { useEffect, useState } from 'react';
import { account, databases, DB_ID, ID, Query, storage, COLLECTIONS } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import {
    User, Mail, Bell, Key,
    Save, Loader2, LogOut, Moon, Sun,
    Terminal, Github, Eye, Snowflake, Camera, Upload, Waves, Activity, Cpu
} from 'lucide-react';
import { Theme } from '../contexts/ThemeContext';
import { useTheme } from '../contexts/ThemeContext';
import robotMascot from '../assets/tony-ai.png';
import { Bot, Globe } from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useTranslation } from 'react-i18next';

export default function Settings() {
    const { t } = useTranslation();
    const { user, signOut, updatePassword, getGithubToken, refreshUser, getJWT } = useAuth();
    const { theme, setTheme, echoMovementEnabled, setEchoMovementEnabled } = useTheme();
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
    const [prefDiscord, setPrefDiscord] = useState(false);
    const [prefSlackWebhook, setPrefSlackWebhook] = useState('');
    const [prefDiscordWebhook, setPrefDiscordWebhook] = useState('');

    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [repositories, setRepositories] = useState<any[]>([]);
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
            const prefResponse = await databases.listDocuments(
                DB_ID,
                'notification_preferences',
                [Query.equal('user_id', user?.$id || '')]
            );

            if (prefResponse.total > 0) {
                const prefs = prefResponse.documents;
                setPrefEmail(prefs.some(p => p.channel === 'email' && p.enabled));
                setPrefSlack(prefs.some(p => p.channel === 'slack' && p.enabled));
                setPrefDiscord(prefs.some(p => p.channel === 'discord' && p.enabled));
                setPrefSlackWebhook(prefs.find(p => p.channel === 'slack')?.target_value || '');
                setPrefDiscordWebhook(prefs.find(p => p.channel === 'discord')?.target_value || '');
            }

            const keysResponse = await databases.listDocuments(
                DB_ID,
                'api_keys',
                [Query.equal('user_id', user?.$id || '')]
            );
            setApiKeys(keysResponse.documents);

            const repoResponse = await databases.listDocuments(
                DB_ID,
                COLLECTIONS.REPOSITORIES,
                [Query.equal('user_id', user?.$id || '')]
            );
            setRepositories(repoResponse.documents);

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
            alert(t('settings.profile_updated', 'Profile updated successfully'));
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
            await account.updatePrefs({
                ...user?.prefs,
                profilePic: url
            });

            setAvatarUrl(url);
            await refreshUser();
            alert(t('settings.avatar_updated', 'Profile picture updated'));
        } catch (error: any) {
            console.error('Avatar upload error:', error);
            alert(t('settings.upload_failed', { error: error.message, defaultValue: `Upload failed: ${error.message}` }));
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
                        { channel: 'email', enabled: prefEmail, event_type: 'critical_detected' },
                        { channel: 'slack', enabled: prefSlack && !!prefSlackWebhook, event_type: 'scan_completed', target_value: prefSlackWebhook },
                        { channel: 'slack', enabled: prefSlack && !!prefSlackWebhook, event_type: 'critical_detected', target_value: prefSlackWebhook },
                        { channel: 'discord', enabled: prefDiscord && !!prefDiscordWebhook, event_type: 'scan_completed', target_value: prefDiscordWebhook },
                        { channel: 'discord', enabled: prefDiscord && !!prefDiscordWebhook, event_type: 'critical_detected', target_value: prefDiscordWebhook },
                    ]
                })
            });

            alert(t('settings.prefs_saved', 'Preferences saved'));
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

    const handleUpdateRepoCron = async (repoId: string, cronEnabled: boolean, cronSchedule: string) => {
        try {
            await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
                cron_enabled: cronEnabled,
                cron_schedule: cronSchedule
            });
            setRepositories(prev => prev.map(r => r.$id === repoId ? { ...r, cron_enabled: cronEnabled, cron_schedule: cronSchedule } : r));
        } catch (err) {
            console.error('Error updating repo cron:', err);
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
                        <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">{t('settings.title', 'Orchestration Settings')}</h1>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">{t('settings.subtitle', 'Configure system parameters & operator protocols')}</p>
                    </div>
                </div>

                <div className="space-y-12">
                    {/* Language Selection */}
                    <section className="premium-card p-10">
                        <div className="flex items-center gap-5 mb-8">
                            <div className="w-12 h-12 bg-[var(--accent-primary)]/10 rounded-2xl flex items-center justify-center border border-[var(--accent-primary)]/20">
                                <Globe className="w-5 h-5 text-[var(--accent-primary)]" />
                            </div>
                            <div>
                                <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">{t('settings.linguistic_protocols', 'Linguistic Protocols')}</h3>
                                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">{t('settings.linguistic_desc', 'Define neural interface base language')}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <LanguageSwitcher />
                            <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">
                                * {t('settings.neural_engine_notice', 'Linguistic shifts require neural engine recalibration (page refresh)')}
                            </p>
                        </div>
                    </section>

                    <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-subtle)] to-transparent opacity-50" />

                    {/* Dark Mode Toggle */}
                    <div className="premium-card p-10">
                        <div className="flex items-center gap-5 mb-8">
                            <div className="w-12 h-12 bg-[var(--accent-primary)]/10 rounded-2xl flex items-center justify-center border border-[var(--accent-primary)]/20">
                                {theme === 'dark' || theme === 'snow-dark' ? <Moon className="w-5 h-5 text-[var(--accent-primary)]" /> : <Sun className="w-5 h-5 text-[var(--accent-primary)]" />}
                            </div>
                            <div>
                                <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">{t('settings.visual_mode', 'Visual Interface Mode')}</h3>
                                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">{t('settings.visual_desc', 'Select ocular spectral preference')}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {[
                                { id: 'light', label: t('settings.theme_light', 'Light Mode'), icon: Sun, desc: t('settings.theme_light_desc', 'High visibility daylight protocol') },
                                { id: 'dark', label: t('settings.theme_dark', 'Dark Mode'), icon: Moon, desc: t('settings.theme_dark_desc', 'Stealth ops standard interface') },
                                { id: 'eye-protection', label: t('settings.theme_eye', 'Eye Protection'), icon: Eye, desc: t('settings.theme_eye_desc', 'Warm amber neural filter') },
                                { id: 'snow-light', label: t('settings.theme_snow_light', 'Snow Light'), icon: Snowflake, desc: t('settings.theme_snow_light_desc', 'Arctic day with active precipitation') },
                                { id: 'snow-dark', label: t('settings.theme_snow_dark', 'Snow Dark'), icon: Snowflake, desc: t('settings.theme_snow_dark_desc', 'Arctic night with active precipitation') },
                                { id: 'underwater', label: t('settings.theme_underwater', 'Underwater'), icon: Waves, desc: t('settings.theme_underwater_desc', 'Deep sea stealth mode with caustic light') },
                                { id: 'matrix', label: t('settings.theme_matrix', 'Matrix'), icon: Cpu, desc: t('settings.theme_matrix_desc', 'Particle globe · green terminal · cyber ops') },
                            ].map((themeOption) => (
                                <button
                                    key={themeOption.id}
                                    onClick={() => setTheme(themeOption.id as Theme)}
                                    className={`p-6 rounded-2xl border-2 transition-all flex flex-col items-start gap-4 text-left group
                                        ${theme === themeOption.id ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 shadow-lg shadow-[var(--accent-primary)]/10' : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--accent-primary)]/30'}`}
                                >
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors
                                        ${theme === themeOption.id ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-card)] text-[var(--text-secondary)] group-hover:text-[var(--accent-primary)]'}`}>
                                        <themeOption.icon size={20} />
                                    </div>
                                    <div>
                                        <p className={`text-[11px] font-black uppercase italic tracking-wider mb-1 ${theme === themeOption.id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
                                            {themeOption.label}
                                        </p>
                                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase leading-tight italic">
                                            {themeOption.desc}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Profile Section */}
                    <section className="premium-card p-10">
                        <h3 className="text-xs font-black text-[var(--text-primary)] mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <User className="w-4 h-4 text-[var(--accent-primary)]" /> {t('settings.operator_credentials', 'Operator Credentials')}
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
                                <h4 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tight mb-2">{t('settings.neural_link_visualization', 'Neural Link Visualization')}</h4>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic leading-relaxed max-w-sm">
                                    {t('settings.neural_link_desc', 'Synchronize your biological appearance with the Scorpion neural mesh. Recommended format: PNG/JPG @ 512px.')}
                                </p>
                                <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-4">
                                    <button
                                        onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
                                        className="text-[10px] font-black uppercase tracking-widest text-[var(--accent-primary)] flex items-center gap-2 hover:opacity-70 transition-opacity"
                                    >
                                        <Upload size={14} /> {t('settings.upload_binary', 'Upload Binary')}
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
                                        <h4 className="text-xs font-black text-[var(--text-primary)] uppercase italic tracking-widest">{t('settings.repo_access_heading', 'Repository Access Neural Link')}</h4>
                                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">
                                            {isGithubConnected ? t('settings.neural_link_active', 'Neural Link Active: ScorpNet Integrated') : t('settings.neural_link_inactive', 'Neural Link Offline: Manual Auth Required')}
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
                                    {isGithubConnected ? t('settings.reconnect_link', 'Reconnect Neural Link') : t('settings.init_link', 'Initialize Neural Link')}
                                </button>
                            </div>
                        </div>

                        {/* GitHub App Section */}
                        <div className="mb-12 pb-12 border-b border-[var(--border-subtle)]">
                            <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)] relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                    <Bot className="w-16 h-16" />
                                </div>
                                <div className="flex items-center gap-5 z-10">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-colors
                                        ${(user?.prefs as any)?.github_installation_id ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-500' : 'bg-white/5 border-white/10 text-white'}`}>
                                        <Bot size={24} />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-black text-[var(--text-primary)] uppercase italic tracking-widest">{t('settings.institutional_access', 'Institutional Mesh Access')}</h4>
                                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">
                                            {(user?.prefs as any)?.github_installation_id
                                                ? t('settings.mesh_active', { id: (user?.prefs as any)?.github_installation_id, defaultValue: `Neural Mesh Integrated (Installation ID: ${(user?.prefs as any)?.github_installation_id})` })
                                                : t('settings.mesh_description', 'Connect the ScorpApp to your organization for full spectrum scanning.')}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        window.open(`https://github.com/apps/scorpion-security-orchestrator/installations/new`, '_blank');
                                    }}
                                    className={`px-8 py-3 rounded-xl text-xs font-black uppercase italic tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl
                                        ${(user?.prefs as any)?.github_installation_id ? 'bg-white/5 border border-white/10 text-white hover:bg-white/10' : 'bg-cyan-500 text-black shadow-cyan-500/20 hover:shadow-cyan-500/40'}`}
                                >
                                    {(user?.prefs as any)?.github_installation_id ? t('settings.sync_mesh', 'Sync Neural Mesh') : t('settings.install_scorpapp', 'Install ScorpApp')}
                                </button>
                            </div>
                        </div>

                        <form onSubmit={handleUpdateProfile} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block">{t('settings.designation_name', 'Designation Name')}</label>
                                <input
                                    type="text"
                                    value={profile.name}
                                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                                    className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/10 focus:border-[var(--accent-primary)] text-[var(--text-primary)] transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block">{t('settings.communications_id', 'Communications ID')}</label>
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
                                    {t('settings.sync_profile', 'Sync Profile')}
                                </button>
                            </div>
                        </form>
                    </section>

                    {/* Notifications */}
                    <section className="premium-card p-10">
                        <h3 className="text-xs font-black text-[var(--text-primary)] mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <Bell className="w-4 h-4 text-[var(--accent-secondary)]" /> {t('settings.alert_feeds', 'Intelligence Alert Feeds')}
                        </h3>
                        <div className="space-y-6">

                            {/* Email */}
                            <div className="flex items-center justify-between p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)]">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-[var(--accent-primary)]/10 rounded-xl flex items-center justify-center text-[var(--accent-primary)]">
                                        <Mail className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">{t('settings.email_dispatch', 'Email Dispatch')}</p>
                                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">{t('settings.email_desc', { email: profile.email, defaultValue: `Primary contact: ${profile.email}` })}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setPrefEmail(!prefEmail)}
                                    className={`w-12 h-6 rounded-full p-1 transition-colors ${prefEmail ? 'bg-[var(--status-success)]' : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'}`}
                                >
                                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${prefEmail ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            </div>

                            {/* Slack */}
                            <div className="p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)] space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-[#4A154B]/40 rounded-xl flex items-center justify-center">
                                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                                                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#E01E5A" />
                                            </svg>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">{t('settings.slack_webhook', 'Slack Webhook')}</p>
                                            <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">{t('settings.slack_desc', 'Forward alerts to workspace')}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setPrefSlack(!prefSlack)}
                                        className={`w-12 h-6 rounded-full p-1 transition-colors ${prefSlack ? 'bg-[var(--status-success)]' : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'}`}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${prefSlack ? 'translate-x-6' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                                {prefSlack && (
                                    <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                                        <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest block">
                                            {t('settings.slack_url_label', 'Webhook URL')}
                                        </label>
                                        <input
                                            type="url"
                                            placeholder="https://hooks.slack.com/services/T.../B.../..."
                                            value={prefSlackWebhook}
                                            onChange={(e) => setPrefSlackWebhook(e.target.value)}
                                            className="w-full px-5 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl font-mono text-[10px] outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/10 focus:border-[var(--accent-primary)] text-[var(--text-primary)] transition-all placeholder:text-[var(--text-secondary)]/40"
                                        />
                                        <p className="text-[9px] text-[var(--text-secondary)] italic">
                                            {t('settings.slack_help', 'Instructions: Create an app in your Slack workspace and enable Incoming Webhooks.')}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Discord */}
                            <div className="p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)] space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-[#5865F2]/20 rounded-xl flex items-center justify-center">
                                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5865F2">
                                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.001.022.015.04.037.05A19.9 19.9 0 0 0 6.204 21a.077.077 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.074.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">{t('settings.discord_webhook', 'Discord Webhook')}</p>
                                            <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">{t('settings.discord_desc', 'Forward alerts to server')}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setPrefDiscord(!prefDiscord)}
                                        className={`w-12 h-6 rounded-full p-1 transition-colors ${prefDiscord ? 'bg-[var(--status-success)]' : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'}`}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${prefDiscord ? 'translate-x-6' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                                {prefDiscord && (
                                    <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                                        <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest block">
                                            {t('settings.discord_url_label', 'Webhook URL')}
                                        </label>
                                        <input
                                            type="url"
                                            placeholder="https://discord.com/api/webhooks/..."
                                            value={prefDiscordWebhook}
                                            onChange={(e) => setPrefDiscordWebhook(e.target.value)}
                                            className="w-full px-5 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl font-mono text-[10px] outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/10 focus:border-[var(--accent-primary)] text-[var(--text-primary)] transition-all placeholder:text-[var(--text-secondary)]/40"
                                        />
                                        <p className="text-[9px] text-[var(--text-secondary)] italic">
                                            {t('settings.discord_help', 'Instructions: Open Server Settings > Integrations > Webhooks to create a new endpoint.')}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Critical-only notice */}
                            <div className="flex items-center gap-3 px-4 py-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                                <p className="text-[9px] font-black text-red-400 uppercase tracking-widest italic">
                                    {t('settings.alert_warning', 'Intelligence protocols will exclusively trigger for CRITICAL severity events.')}
                                </p>
                            </div>

                            <div className="flex justify-end pt-2">
                                <button
                                    onClick={handleSaveNotifications}
                                    disabled={updating}
                                    className="btn-premium flex items-center gap-2"
                                >
                                    {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    {t('settings.commit_prefs', 'Commit Preferences')}
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Automated Scan Schedules */}
                    <section className="premium-card p-10">
                        <h3 className="text-xs font-black text-[var(--accent-primary)] mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <Activity className="w-4 h-4 text-[var(--accent-primary)]" /> {t('settings.scan_schedules', 'Automated Scan Schedules')}
                        </h3>
                        <div className="space-y-4">
                            {repositories.length === 0 ? (
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic">{t('settings.no_repos', 'No repositories connected.')}</p>
                            ) : repositories.map(repo => (
                                <div key={repo.$id} className="flex justify-between items-center p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)]">
                                    <div>
                                        <p className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">{repo.name}</p>
                                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase mt-1 italic">{repo.url}</p>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <select
                                            value={repo.cron_schedule || '0 0 * * *'}
                                            onChange={(e) => handleUpdateRepoCron(repo.$id, repo.cron_enabled, e.target.value)}
                                            className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none"
                                        >
                                            <option value="0 0 * * *">{t('settings.daily_midnight', 'Daily (Midnight)')}</option>
                                            <option value="0 0 * * 0">{t('settings.weekly_sunday', 'Weekly (Sunday)')}</option>
                                            <option value="* * * * *">{t('settings.custom_cron', 'Custom (* * * * *)')}</option>
                                        </select>
                                        <button
                                            onClick={() => handleUpdateRepoCron(repo.$id, !repo.cron_enabled, repo.cron_schedule || '0 0 * * *')}
                                            className={`w-12 h-6 rounded-full p-1 transition-colors ${repo.cron_enabled ? 'bg-[var(--status-success)]' : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'}`}
                                        >
                                            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${repo.cron_enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* API Keys */}
                    <section className="premium-card p-10">
                        <h3 className="text-xs font-black text-[var(--status-success)] mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                            <Key className="w-4 h-4 text-[var(--status-success)]" /> {t('settings.api_keys_heading', 'Secure API Vectors')}
                        </h3>

                        {generatedKey && (
                            <div className="mb-8 p-6 bg-[var(--status-success)]/10 border border-[var(--status-success)]/20 rounded-2xl">
                                <p className="text-[10px] font-black text-[var(--status-success)] uppercase tracking-widest mb-3 animate-pulse">{t('settings.new_key_linked', 'New neural key linked successfully.')}</p>
                                <code className="block bg-[var(--bg-primary)] text-[var(--status-success)] p-4 rounded-xl font-mono text-sm break-all border border-[var(--status-success)]/30">
                                    {generatedKey}
                                </code>
                                <p className="text-[9px] text-[var(--text-secondary)] mt-3 italic">{t('settings.key_security_notice', 'Caution: This key will not be displayed again. Archive it securely.')}</p>
                            </div>
                        )}

                        <div className="flex gap-4 mb-10">
                            <input
                                type="text"
                                placeholder={t('settings.key_designation_placeholder', 'Key Designation (e.g. JENKINS-MASTER)')}
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                className="flex-1 px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none text-[var(--text-primary)] focus:ring-4 focus:ring-[var(--accent-primary)]/10"
                            />
                            <button onClick={generateApiKey} className="btn-premium whitespace-nowrap">{t('settings.generate_key', 'Generate Key')}</button>
                        </div>

                        <div className="space-y-4">
                            {apiKeys.map((key) => (
                                <div key={key.$id} className="flex justify-between items-center p-6 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)]">
                                    <div>
                                        <p className="text-[11px] font-black text-[var(--text-primary)] uppercase italic">{key.name}</p>
                                        <p className="text-[10px] font-mono text-[var(--text-secondary)] mt-1">{key.masked_key || 'sk_••••••••••••'}</p>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <span className="text-[9px] font-black text-[var(--status-success)] uppercase tracking-widest italic">{t('settings.active_vector', 'Active Vector')}</span>
                                        <button className="p-2 text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-colors">
                                            <LogOut className="w-4 h-4 rotate-90" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Echo Neural Interface */}
                    <section className="premium-card p-10">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-5">
                                <div className="w-12 h-12 bg-cyan-500/10 rounded-2xl flex items-center justify-center border border-cyan-500/20">
                                    <Bot className="w-6 h-6 text-cyan-500" />
                                </div>
                                <div>
                                    <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">{t('settings.echo_heading', 'Echo Neural Interface')}</h3>
                                    <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">{t('settings.echo_description', 'Configure the autonomous security mascot behavior')}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setEchoMovementEnabled(!echoMovementEnabled)}
                                className={`w-14 h-7 rounded-full p-1 transition-all duration-300 ${echoMovementEnabled ? 'bg-cyan-500 shadow-lg shadow-cyan-500/20' : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'}`}
                            >
                                <div className={`w-5 h-5 rounded-full bg-white transition-transform duration-300 ${echoMovementEnabled ? 'translate-x-7' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                            <div className="space-y-6">
                                <div className={`p-6 rounded-2xl border transition-all ${echoMovementEnabled ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] opacity-60'}`}>
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className={`w-2 h-2 rounded-full ${echoMovementEnabled ? 'bg-cyan-400 animate-pulse' : 'bg-gray-500'}`} />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)]">
                                            {t('settings.echo_status_label', 'Status')}: {echoMovementEnabled ? t('settings.echo_status_floating', 'Floating') : t('settings.echo_status_paused', 'Paused')}
                                        </span>
                                    </div>
                                    <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase leading-relaxed italic">
                                        {echoMovementEnabled
                                            ? t('settings.echo_explanation_active', 'Echo is currently navigating your workspace, providing real-time security intuition.')
                                            : t('settings.echo_explanation_standby', 'Echo is in standby mode. Movement protocols are temporarily suspended.')}
                                    </p>
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => setEchoMovementEnabled(true)}
                                        className={`flex-1 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${echoMovementEnabled ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20 opacity-40 cursor-not-allowed' : 'bg-cyan-500 text-black hover:scale-[1.02] active:scale-[0.98]'}`}
                                        disabled={echoMovementEnabled}
                                    >
                                        {t('settings.init_movement', 'Initialize Movement')}
                                    </button>
                                    <button
                                        onClick={() => setEchoMovementEnabled(false)}
                                        className={`flex-1 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${!echoMovementEnabled ? 'bg-white/5 border border-white/10 text-[var(--text-secondary)] opacity-40 cursor-not-allowed' : 'bg-white/5 border border-white/10 text-[var(--text-primary)] hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98]'}`}
                                        disabled={!echoMovementEnabled}
                                    >
                                        {t('settings.halt_propulsion', 'Halt Propulsion')}
                                    </button>
                                </div>
                            </div>

                            <div className="relative aspect-video rounded-3xl bg-[var(--bg-primary)] border border-[var(--border-subtle)] overflow-hidden flex items-center justify-center group">
                                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_50%_50%,_var(--accent-primary)_0%,_transparent_70%)]" />

                                <div className={`relative transition-all duration-1000 ${echoMovementEnabled ? 'animate-[floating_4s_ease-in-out_infinite]' : ''}`}>
                                    <div className="w-20 h-20 relative">
                                        <img src={robotMascot} alt="Echo Preview" className="w-full h-full object-contain relative z-10" />
                                        <div className={`absolute inset-0 rounded-full blur-2xl transition-opacity duration-500 ${echoMovementEnabled ? 'bg-cyan-400/30 opacity-100' : 'bg-gray-400/10 opacity-0'}`} />
                                    </div>
                                </div>

                                <style>{`
                                    @keyframes floating {
                                        0%, 100% { transform: translateY(0) rotate(0deg); }
                                        50% { transform: translateY(-15px) rotate(2deg); }
                                    }
                                `}</style>

                                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center px-4">
                                    <span className="text-[8px] font-black uppercase tracking-[0.3em] text-[var(--text-secondary)]">{t('settings.neural_link_preview', 'Neural Link Preview')}</span>
                                    <span className="text-[8px] font-black uppercase tracking-[0.3em] text-cyan-500 animate-pulse">{echoMovementEnabled ? t('settings.live_status', 'LIVE') : t('settings.idle_status', 'IDLE')}</span>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Danger Zone */}
                    <section className="premium-card p-10 border-[var(--status-error)]/20">
                        <h3 className="text-xs font-black text-[var(--status-error)] mb-8 uppercase tracking-[0.2em] italic">{t('settings.decommissioning_zone', 'Decommissioning Zone')}</h3>
                        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
                            <div>
                                <h4 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tight">{t('settings.system_termination', 'System Termination')}</h4>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1">{t('settings.disconnect_session', 'Disconnect your current operator session from the neural mesh.')}</p>
                            </div>
                            <button
                                onClick={signOut}
                                className="px-10 py-4 bg-[var(--status-error)]/10 text-[var(--status-error)] border border-[var(--status-error)]/20 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[var(--status-error)] hover:text-white transition-all shadow-xl shadow-[var(--status-error)]/5"
                            >
                                {t('settings.deactivate_session', 'Deactivate Session')}
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
