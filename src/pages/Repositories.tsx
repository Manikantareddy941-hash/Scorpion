import React, { useEffect, useState } from 'react';
import { databases, DB_ID, ID, COLLECTIONS, Query } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import { 
    Github, Globe, Clock, Play, Trash2, Plus, 
    Shield, AlertCircle, CheckCircle, Search, 
    MoreVertical, Settings, ExternalLink, RefreshCw, Loader2 
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

interface Repository {
    $id: string;
    name: string;
    url: string;
    cron_enabled: boolean;
    cron_schedule: string;
    user_id: string;
    team_id?: string;
    $createdAt: string;
}

export default function Repositories() {
    const { t } = useTranslation();
    const { user, getJWT } = useAuth();
    const navigate = useNavigate();
    const [repos, setRepos] = useState<Repository[]>([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newRepo, setNewRepo] = useState({ name: '', url: '' });

    useEffect(() => {
        fetchRepos();
    }, [user]);

    const fetchRepos = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const res = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
                Query.equal('user_id', user.$id)
            ]);
            setRepos(res.documents as any);
        } catch (err) {
            toast.error('Failed to fetch repositories');
        } finally {
            setLoading(false);
        }
    };

    const handleAddRepo = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), {
                ...newRepo,
                user_id: user?.$id,
                cron_enabled: false,
                cron_schedule: '0 0 * * *'
            });
            toast.success('Repository added successfully');
            setShowAddModal(false);
            setNewRepo({ name: '', url: '' });
            fetchRepos();
        } catch (err) {
            toast.error('Failed to add repository');
        }
    };

    const handleDeleteRepo = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this repository?')) return;
        try {
            await databases.deleteDocument(DB_ID, COLLECTIONS.REPOSITORIES, id);
            toast.success('Repository deleted');
            fetchRepos();
        } catch (err) {
            toast.error('Failed to delete repository');
        }
    };

    const handleTriggerScan = async (repoId: string) => {
        setScanning(repoId);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/scan/manual/trigger`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ repo_id: repoId })
            });
            
            if (res.ok) {
                toast.success('Security scan initiated');
            } else {
                throw new Error('Failed to trigger scan');
            }
        } catch (err) {
            toast.error('Scan trigger failed');
        } finally {
            setScanning(null);
        }
    };

    const handleToggleCron = async (repo: Repository) => {
        try {
            await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, repo.$id, {
                cron_enabled: !repo.cron_enabled
            });
            setRepos(prev => prev.map(r => r.$id === repo.$id ? { ...r, cron_enabled: !r.cron_enabled } : r));
            toast.success(`Scan schedule ${!repo.cron_enabled ? 'enabled' : 'disabled'}`);
        } catch (err) {
            toast.error('Failed to update schedule');
        }
    };

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
                    <div>
                        <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Repositories</h1>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Manage your code perimeters & scan vectors</p>
                    </div>

                    <button 
                        onClick={() => setShowAddModal(true)}
                        className="btn-premium flex items-center gap-2"
                    >
                        <Plus size={18} />
                        Add Repository
                    </button>
                </div>

                {/* Repos Grid */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24">
                        <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] italic">Mapping Repository Mesh...</p>
                    </div>
                ) : repos.length === 0 ? (
                    <div className="premium-card p-24 text-center">
                        <Github className="w-16 h-16 text-[var(--text-secondary)] mx-auto mb-6 opacity-20" />
                        <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">No Repositories Linked</h3>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-2">Connect a repository to begin security orchestration</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {repos.map((repo) => (
                            <div key={repo.$id} className="premium-card group hover:border-[var(--accent-primary)]/40 transition-all p-8">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="w-12 h-12 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl flex items-center justify-center group-hover:border-[var(--accent-primary)]/40 transition-colors">
                                        <Github size={24} className="text-[var(--text-primary)]" />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => navigate('/tasks')}
                                            className="p-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
                                        >
                                            <ExternalLink size={16} />
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteRepo(repo.$id)}
                                            className="p-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-red-500 transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                <h3 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tight mb-2 truncate">{repo.name}</h3>
                                <p className="text-[10px] font-mono text-[var(--text-secondary)] mb-6 truncate opacity-60 italic">{repo.url}</p>

                                <div className="space-y-4 mb-8">
                                    <div className="flex items-center justify-between p-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl">
                                        <div className="flex items-center gap-3">
                                            <Clock size={14} className="text-[var(--accent-primary)]" />
                                            <span className="text-[9px] font-black uppercase italic text-[var(--text-primary)]">Scan Schedule</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-[9px] font-mono text-[var(--text-secondary)]">{repo.cron_schedule}</span>
                                            <button 
                                                onClick={() => handleToggleCron(repo)}
                                                className={`w-8 h-4 rounded-full p-0.5 transition-colors ${repo.cron_enabled ? 'bg-[var(--status-success)]' : 'bg-[var(--bg-card)] border border-[var(--border-subtle)]'}`}
                                            >
                                                <div className={`w-3 h-3 rounded-full bg-white transition-transform ${repo.cron_enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-center">
                                            <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase italic">Created</p>
                                            <p className="text-[10px] font-black text-[var(--text-primary)] italic mt-0.5">{new Date(repo.$createdAt).toLocaleDateString()}</p>
                                        </div>
                                        <div className="p-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-center">
                                            <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase italic">Status</p>
                                            <p className="text-[10px] font-black text-[var(--status-success)] italic mt-0.5 uppercase">Active</p>
                                        </div>
                                    </div>
                                </div>

                                <button 
                                    onClick={() => handleTriggerScan(repo.$id)}
                                    disabled={scanning === repo.$id}
                                    className={`w-full py-3 rounded-xl text-[10px] font-black uppercase italic tracking-widest transition-all flex items-center justify-center gap-2
                                        ${scanning === repo.$id 
                                            ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' 
                                            : 'bg-[var(--accent-primary)] text-black shadow-lg shadow-[var(--accent-primary)]/20 hover:scale-[1.02] active:scale-[0.98]'}`}
                                >
                                    {scanning === repo.$id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                                    {scanning === repo.$id ? 'Scanning...' : 'Scan Now'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add Repo Modal */}
                {showAddModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
                        <div className="premium-card max-w-md w-full p-10 relative z-10 animate-in zoom-in-95 duration-200">
                            <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter mb-2">Deploy Repository</h2>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mb-8">Establish a new security vector</p>
                            
                            <form onSubmit={handleAddRepo} className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Vector Name</label>
                                    <input 
                                        type="text" 
                                        required
                                        placeholder="e.g. CORE-MICROSERVICE"
                                        value={newRepo.name}
                                        onChange={(e) => setNewRepo({ ...newRepo, name: e.target.value })}
                                        className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)] transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">GitHub Binary URL</label>
                                    <input 
                                        type="url" 
                                        required
                                        placeholder="https://github.com/org/repo"
                                        value={newRepo.url}
                                        onChange={(e) => setNewRepo({ ...newRepo, url: e.target.value })}
                                        className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)] transition-all"
                                    />
                                </div>

                                <div className="flex gap-4 pt-4">
                                    <button 
                                        type="button"
                                        onClick={() => setShowAddModal(false)}
                                        className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase italic tracking-widest border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-all"
                                    >
                                        Abort
                                    </button>
                                    <button 
                                        type="submit"
                                        className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase italic tracking-widest bg-[var(--accent-primary)] text-black shadow-lg shadow-[var(--accent-primary)]/20 hover:scale-[1.02] transition-all"
                                    >
                                        Initialize
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
