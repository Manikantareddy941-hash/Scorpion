import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    Users, UserPlus, Shield, Star, 
    Trash2, LogOut, Settings, MoreVertical,
    Search, Filter, Plus, ChevronRight,
    Loader2, Mail, Lock, CheckCircle, X,
    Activity, Globe, UserCheck
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

interface Team {
    $id: string;
    name: string;
    description: string;
    owner_id: string;
    role?: string;
}

interface Member {
    $id: string;
    user_id: string;
    email: string;
    name: string;
    role: string;
}

export default function Teams() {
    const { t } = useTranslation();
    const { getJWT, user } = useAuth();
    const [teams, setTeams] = useState<Team[]>([]);
    const [activeTeam, setActiveTeam] = useState<Team | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [membersLoading, setMembersLoading] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showInviteModal, setShowInviteModal] = useState(false);
    
    const [newTeamName, setNewTeamName] = useState('');
    const [newTeamDesc, setNewTeamDesc] = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('viewer');

    useEffect(() => {
        fetchTeams();
    }, []);

    useEffect(() => {
        if (activeTeam) {
            fetchMembers(activeTeam.$id);
        }
    }, [activeTeam]);

    const fetchTeams = async () => {
        setLoading(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/teams`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setTeams(data || []);
            if (data.length > 0 && !activeTeam) {
                setActiveTeam(data[0]);
            }
        } catch (err) {
            toast.error('Failed to fetch teams');
        } finally {
            setLoading(false);
        }
    };

    const fetchMembers = async (teamId: string) => {
        setMembersLoading(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/teams/${teamId}/members`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setMembers(data || []);
        } catch (err) {
            toast.error('Failed to fetch team members');
        } finally {
            setMembersLoading(false);
        }
    };

    const handleCreateTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/teams`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: newTeamName, description: newTeamDesc })
            });

            if (res.ok) {
                toast.success('Team battalion created');
                setShowCreateModal(false);
                setNewTeamName('');
                setNewTeamDesc('');
                fetchTeams();
            }
        } catch (err) {
            toast.error('Failed to create team');
        }
    };

    const handleInviteMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeTeam) return;
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/teams/${activeTeam.$id}/invite`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email: inviteEmail, role: inviteRole })
            });

            if (res.ok) {
                toast.success('Operator deployed to team');
                setShowInviteModal(false);
                setInviteEmail('');
                fetchMembers(activeTeam.$id);
            } else {
                const err = await res.json();
                toast.error(err.error || 'Failed to invite operator');
            }
        } catch (err) {
            toast.error('Failed to invite operator');
        }
    };

    const handleRemoveMember = async (memberUserId: string) => {
        if (!activeTeam) return;
        if (!window.confirm('Eject this operator from the battalion?')) return;
        
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            await fetch(`${apiBase}/api/teams/${activeTeam.$id}/members/${memberUserId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setMembers(prev => prev.filter(m => m.user_id !== memberUserId));
            toast.success('Operator ejected');
        } catch (err) {
            toast.error('Failed to remove member');
        }
    };

    const getRoleBadge = (role: string) => {
        const style = "px-2 py-0.5 rounded text-[8px] font-black uppercase italic border";
        switch (role.toLowerCase()) {
            case 'owner': return <span className={`${style} bg-orange-500/10 text-orange-500 border-orange-500/20`}>Commander</span>;
            case 'admin': return <span className={`${style} bg-purple-500/10 text-purple-500 border-purple-500/20`}>Officer</span>;
            case 'editor': return <span className={`${style} bg-blue-500/10 text-blue-500 border-blue-500/20`}>Specialist</span>;
            default: return <span className={`${style} bg-emerald-500/10 text-emerald-500 border-emerald-500/20`}>Operator</span>;
        }
    };

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
                    <div>
                        <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Tactical Battalions</h1>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Multi-tenant security team orchestration</p>
                    </div>

                    <button 
                        onClick={() => setShowCreateModal(true)}
                        className="btn-premium flex items-center gap-2"
                    >
                        <Plus size={18} />
                        Found Team
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Team List Sidebar */}
                    <div className="lg:col-span-1 space-y-4">
                        <div className="premium-card p-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={14} />
                                <input 
                                    type="text" 
                                    placeholder="Find team..."
                                    className="w-full pl-9 pr-4 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[10px] font-black italic outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)]"
                                />
                            </div>
                        </div>

                        {loading ? (
                            Array(3).fill(0).map((_, i) => (
                                <div key={i} className="premium-card h-20 animate-pulse bg-[var(--bg-card)]" />
                            ))
                        ) : teams.length === 0 ? (
                            <div className="text-center py-12 opacity-40">
                                <Users size={32} className="mx-auto mb-4" />
                                <p className="text-[10px] font-black uppercase italic tracking-widest">Lone Wolf Protocol</p>
                            </div>
                        ) : (
                            teams.map((team) => (
                                <button 
                                    key={team.$id}
                                    onClick={() => setActiveTeam(team)}
                                    className={`w-full premium-card p-6 text-left transition-all hover:scale-[1.02] active:scale-95 ${activeTeam?.$id === team.$id ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5' : ''}`}
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tight">{team.name}</h3>
                                            <p className="text-[8px] font-bold text-[var(--text-secondary)] uppercase italic mt-1">{team.role || 'Member'}</p>
                                        </div>
                                        <ChevronRight size={14} className={activeTeam?.$id === team.$id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'} />
                                    </div>
                                </button>
                            ))
                        )}
                    </div>

                    {/* Team Details Area */}
                    <div className="lg:col-span-3 space-y-8">
                        {activeTeam ? (
                            <>
                                <div className="premium-card p-8">
                                    <div className="flex flex-col md:flex-row justify-between gap-6">
                                        <div className="flex items-start gap-6">
                                            <div className="w-16 h-16 rounded-2xl bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 flex items-center justify-center text-[var(--accent-primary)]">
                                                <Users size={32} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-3">
                                                    <h2 className="text-2xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">{activeTeam.name}</h2>
                                                    {getRoleBadge(activeTeam.role || 'viewer')}
                                                </div>
                                                <p className="text-[11px] font-bold text-[var(--text-secondary)] uppercase italic mt-2 leading-relaxed max-w-xl">
                                                    {activeTeam.description || 'No operational brief provided for this battalion.'}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex gap-3">
                                            <button 
                                                onClick={() => setShowInviteModal(true)}
                                                className="p-3 bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 rounded-xl text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/20 transition-all flex items-center gap-2 text-[10px] font-black uppercase italic"
                                            >
                                                <UserPlus size={16} />
                                                Add Member
                                            </button>
                                            <button className="p-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                                                <Settings size={20} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="premium-card overflow-hidden">
                                    <div className="px-8 py-6 border-b border-[var(--border-subtle)] flex justify-between items-center bg-[var(--bg-primary)]/30">
                                        <h3 className="text-xs font-black text-[var(--text-primary)] uppercase italic tracking-[0.2em]">Deployment Roster</h3>
                                        <div className="flex items-center gap-2 text-[9px] font-black text-[var(--text-secondary)] uppercase italic">
                                            <Activity size={10} className="text-green-500" />
                                            {members.length} Operators Online
                                        </div>
                                    </div>

                                    {membersLoading ? (
                                        <div className="p-24 flex justify-center">
                                            <Loader2 size={32} className="animate-spin text-[var(--accent-primary)]" />
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-[var(--border-subtle)]">
                                            {members.map((member) => (
                                                <div key={member.$id} className="p-6 flex items-center justify-between hover:bg-[var(--bg-secondary)]/50 transition-colors group">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)] flex items-center justify-center font-black text-[var(--accent-primary)] italic text-sm">
                                                            {member.email.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-xs font-black text-[var(--text-primary)] uppercase italic tracking-tight">{member.name || member.email.split('@')[0]}</p>
                                                                {getRoleBadge(member.role)}
                                                                {member.user_id === user?.$id && (
                                                                    <span className="text-[7px] font-black bg-[var(--text-secondary)]/10 text-[var(--text-secondary)] px-1 rounded uppercase italic">You</span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <Mail size={10} className="text-[var(--text-secondary)]" />
                                                                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">{member.email}</p>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                        <button 
                                                            onClick={() => handleRemoveMember(member.user_id)}
                                                            disabled={member.user_id === user?.$id}
                                                            className="p-2 text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-30"
                                                        >
                                                            <LogOut size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="premium-card p-32 text-center border-dashed">
                                <Users size={48} className="mx-auto mb-6 opacity-20 text-[var(--text-secondary)]" />
                                <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">Select Operations Center</h3>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-2">Manage your battalions and operator deployments</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Create Team Modal */}
                {showCreateModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
                        <div className="premium-card max-w-md w-full p-10 relative z-10">
                            <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter mb-8">Found Battalion</h2>
                            <form onSubmit={handleCreateTeam} className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Battalion Name</label>
                                    <input 
                                        type="text" 
                                        required
                                        placeholder="SCORPION-ALPHA"
                                        value={newTeamName}
                                        onChange={(e) => setNewTeamName(e.target.value)}
                                        className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)]"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Mission Description</label>
                                    <textarea 
                                        rows={3}
                                        placeholder="Core security operations for..."
                                        value={newTeamDesc}
                                        onChange={(e) => setNewTeamDesc(e.target.value)}
                                        className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)] resize-none"
                                    />
                                </div>
                                <div className="flex gap-4 pt-4">
                                    <button 
                                        type="button"
                                        onClick={() => setShowCreateModal(false)}
                                        className="flex-1 py-4 text-[10px] font-black uppercase italic tracking-widest border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-2xl"
                                    >
                                        Abort
                                    </button>
                                    <button 
                                        type="submit"
                                        className="flex-1 py-4 text-[10px] font-black uppercase italic tracking-widest bg-[var(--accent-primary)] text-black rounded-2xl shadow-lg shadow-[var(--accent-primary)]/20"
                                    >
                                        Commence
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Invite Member Modal */}
                {showInviteModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowInviteModal(false)} />
                        <div className="premium-card max-w-md w-full p-10 relative z-10">
                            <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter mb-8">Deploy Operator</h2>
                            <form onSubmit={handleInviteMember} className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Operator Email</label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={16} />
                                        <input 
                                            type="email" 
                                            required
                                            placeholder="operator@scorpion.io"
                                            value={inviteEmail}
                                            onChange={(e) => setInviteEmail(e.target.value)}
                                            className="w-full pl-12 pr-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)]"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Assignment Role</label>
                                    <select 
                                        value={inviteRole}
                                        onChange={(e) => setInviteRole(e.target.value)}
                                        className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)] appearance-none"
                                    >
                                        <option value="viewer">Operator (Viewer)</option>
                                        <option value="editor">Specialist (Editor)</option>
                                        <option value="admin">Officer (Admin)</option>
                                    </select>
                                </div>
                                <div className="flex gap-4 pt-4">
                                    <button 
                                        type="button"
                                        onClick={() => setShowInviteModal(false)}
                                        className="flex-1 py-4 text-[10px] font-black uppercase italic tracking-widest border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-2xl"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        type="submit"
                                        className="flex-1 py-4 text-[10px] font-black uppercase italic tracking-widest bg-[var(--accent-primary)] text-black rounded-2xl shadow-lg shadow-[var(--accent-primary)]/20"
                                    >
                                        Deploy
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
