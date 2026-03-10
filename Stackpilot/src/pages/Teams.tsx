import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Users, Plus, Shield, UserPlus, Trash2, Mail, ChevronRight, X, User } from 'lucide-react';

interface Team {
    id: string;
    name: string;
    owner_id: string;
    created_at: string;
}

interface TeamMember {
    id: string;
    user_id: string;
    role: 'owner' | 'admin' | 'developer' | 'viewer';
    user_email?: string;
}

export default function Teams() {
    const { user } = useAuth();
    const [teams, setTeams] = useState<Team[]>([]);
    const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'admin' | 'developer' | 'viewer'>('viewer');

    useEffect(() => {
        fetchTeams();
    }, []);

    const fetchTeams = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('teams')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setTeams(data || []);
            if (data && data.length > 0) {
                setSelectedTeam(data[0]);
                fetchMembers(data[0].id);
            }
        } catch (error) {
            console.error('Error fetching teams:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchMembers = async (teamId: string) => {
        try {
            const { data, error } = await supabase
                .from('team_members')
                .select('*, users(email)')
                .eq('team_id', teamId);

            if (error) throw error;
            const formattedMembers = data.map((m: any) => ({
                ...m,
                user_email: m.users?.email
            }));
            setMembers(formattedMembers);
        } catch (error) {
            console.error('Error fetching members:', error);
        }
    };

    const handleCreateTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeamName) return;

        setSubmitting(true);
        setError(null);
        try {
            const { data: team, error: teamErr } = await supabase
                .from('teams')
                .insert({ name: newTeamName, owner_id: user?.id })
                .select()
                .single();

            if (teamErr) throw teamErr;

            await supabase
                .from('team_members')
                .insert({ team_id: team.id, user_id: user?.id, role: 'owner' });

            setTeams([team, ...teams]);
            setSelectedTeam(team);
            setMembers([{ id: 'temp', user_id: user?.id || '', role: 'owner', user_email: user?.email }]);
            setShowCreateModal(false);
            setNewTeamName('');
        } catch (error: any) {
            console.error('Error creating team:', error);
            setError(error.message || 'Failed to create team');
        } finally {
            setSubmitting(false);
        }
    };

    const handleInviteMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail || !selectedTeam) return;

        try {
            const { data: userData, error: userErr } = await supabase
                .from('users')
                .select('id')
                .eq('email', inviteEmail)
                .single();

            if (userErr || !userData) {
                alert('User not found. They must sign up for StackPilot first.');
                return;
            }

            const { error } = await supabase
                .from('team_members')
                .insert({
                    team_id: selectedTeam.id,
                    user_id: userData.id,
                    role: inviteRole
                })
                .select()
                .single();

            if (error) throw error;

            fetchMembers(selectedTeam.id);
            setShowInviteModal(false);
            setInviteEmail('');
        } catch (error) {
            console.error('Error inviting member:', error);
        }
    };

    const getRoleBadgeColor = (role: string) => {
        switch (role) {
            case 'owner': return 'text-purple-600 bg-purple-50 dark:bg-purple-500/10 border-purple-100 dark:border-purple-500/20';
            case 'admin': return 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/20';
            case 'developer': return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20';
            default: return 'text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-500/10 border-slate-100 dark:border-slate-800 dark:border-slate-500/20';
        }
    };

    if (loading && teams.length === 0) {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Users className="w-12 h-12 text-blue-600 animate-pulse" />
                    <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse italic">Synchronizing Fleet...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-500/20">
                            <Users className="w-7 h-7" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic">Collaborators</h1>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1 italic">Fleet Command & Access Control</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="btn-premium flex items-center gap-2 group"
                    >
                        <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" /> Initialize Team
                    </button>
                </div>

                {teams.length === 0 ? (
                    <div className="premium-card p-24 text-center flex flex-col items-center">
                        <div className="w-24 h-24 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 rounded-[2rem] flex items-center justify-center mb-8 border border-slate-100 dark:border-slate-800 dark:border-slate-800">
                            <Users className="w-10 h-10 text-slate-200" />
                        </div>
                        <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase italic tracking-tight mb-2">Lone Pilot Detected</h2>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-10 italic max-w-xs mx-auto">
                            No active clusters found. Deploy your first team to start multi-vector collaboration.
                        </p>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/40"
                        >
                            Deploy New Team
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
                        {/* Team List Sidebar */}
                        <div className="lg:col-span-1 border-r border-[var(--border-subtle)] pr-12">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic mb-8">Active Clusters</h3>
                            <div className="space-y-4">
                                {teams.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => {
                                            setSelectedTeam(t);
                                            fetchMembers(t.id);
                                        }}
                                        className={`w-full text-left p-5 rounded-2xl transition-all flex items-center justify-between group relative overflow-hidden ${selectedTeam?.id === t.id
                                            ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/30'
                                            : 'hover:bg-slate-50 dark:bg-slate-800/50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300 dark:text-slate-400 border border-transparent'
                                            }`}
                                    >
                                        <span className="font-black text-xs uppercase tracking-tight italic z-10">{t.name}</span>
                                        <ChevronRight className={`w-4 h-4 transition-transform z-10 ${selectedTeam?.id === t.id ? 'translate-x-1' : 'opacity-0'}`} />
                                        {selectedTeam?.id === t.id && (
                                            <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-100" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Team Details & Members */}
                        <div className="lg:col-span-3">
                            {selectedTeam && (
                                <div className="premium-card overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
                                    <div className="p-10 border-b border-[var(--border-subtle)] bg-[var(--bg-accent)]/30">
                                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                                            <div>
                                                <h2 className="text-3xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter mb-2">{selectedTeam.name}</h2>
                                                <div className="flex items-center gap-2">
                                                    <span className="px-2 py-0.5 bg-blue-600/10 text-blue-600 rounded text-[9px] font-black uppercase tracking-widest italic border border-blue-500/10">
                                                        Cluster ID: {selectedTeam.id.slice(0, 8)}
                                                    </span>
                                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic">
                                                        &bull; DEPLOYED {new Date(selectedTeam.created_at).toLocaleDateString()}
                                                    </span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setShowInviteModal(true)}
                                                className="flex items-center gap-3 px-6 py-3 bg-white dark:bg-slate-900 dark:bg-slate-800 text-blue-600 border border-blue-200 dark:border-slate-700 rounded-2xl hover:bg-blue-50 dark:hover:bg-slate-700 transition-all font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-500/5"
                                            >
                                                <UserPlus className="w-4 h-4 text-blue-500" />
                                                Add Operator
                                            </button>
                                        </div>
                                    </div>

                                    <div className="p-10">
                                        <h3 className="text-xs font-black text-slate-900 dark:text-white mb-8 uppercase tracking-widest italic">Operations Personnel</h3>
                                        <div className="space-y-4">
                                            {members.map((member) => (
                                                <div key={member.id} className="flex flex-col md:flex-row items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900/50 rounded-3xl border border-slate-100 dark:border-slate-800 dark:border-slate-800 hover:border-blue-500/30 transition-all group">
                                                    <div className="flex items-center gap-5 w-full md:w-auto">
                                                        <div className="w-12 h-12 bg-white dark:bg-slate-900 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400 dark:text-slate-600 border border-slate-200 dark:border-slate-700 shadow-sm font-black group-hover:scale-110 transition-transform">
                                                            <User className="w-6 h-6" />
                                                        </div>
                                                        <div>
                                                            <p className="font-black text-slate-900 dark:text-white italic uppercase tracking-tight text-sm mb-1">{member.user_email}</p>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[9px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest italic">
                                                                    {member.user_id === user?.id ? 'Primary Controller' : 'Sub-Operator'}
                                                                </span>
                                                                <span className="w-1 h-1 bg-slate-200 rounded-full" />
                                                                <span className="text-[9px] text-emerald-500 font-black uppercase tracking-widest italic">Online-Ready</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-8 mt-6 md:mt-0 w-full md:w-auto justify-between md:justify-end">
                                                        <span className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-[0.15em] italic border shadow-sm ${getRoleBadgeColor(member.role)}`}>
                                                            {member.role}
                                                        </span>
                                                        {member.user_id !== user?.id && (
                                                            <button className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-all border border-transparent hover:border-rose-100">
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Create Team Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300 pointer-events-auto">
                    <div className="bg-[var(--bg-secondary)] rounded-[var(--card-radius)] w-full max-w-md p-10 shadow-2xl border border-[var(--border-subtle)] animate-in zoom-in duration-300 pointer-events-auto">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">New Fleet Cluster</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic mt-1">Initialize organizational vector</p>
                            </div>
                            <button onClick={() => setShowCreateModal(false)} className="p-2 text-slate-400 hover:text-slate-900 dark:text-white dark:hover:text-white transition-colors">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <form onSubmit={handleCreateTeam}>
                            <div className="space-y-8">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic mb-3 block">Designation Name</label>
                                    <div className="relative">
                                        <Shield className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-600" />
                                        <input
                                            type="text"
                                            autoFocus
                                            value={newTeamName}
                                            onChange={(e) => setNewTeamName(e.target.value)}
                                            placeholder="e.g. CORE-OPS"
                                            className="w-full pl-14 pr-6 py-5 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 dark:border-slate-800 rounded-2xl focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 outline-none transition-all font-black uppercase italic text-sm tracking-tight"
                                        />
                                    </div>
                                    {error && <p className="mt-2 text-[10px] font-bold text-rose-500 uppercase tracking-widest italic">{error}</p>}
                                </div>
                            </div>
                            <div className="flex gap-4 mt-12">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 dark:text-slate-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-slate-800 transition-all border border-slate-200 dark:border-slate-700 dark:border-slate-800"
                                >
                                    Abort
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {submitting ? 'Initializing...' : 'Activate Cluster'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Invite Modal */}
            {showInviteModal && (
                <div className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
                    <div className="bg-[var(--bg-secondary)] rounded-[var(--card-radius)] w-full max-w-md p-10 shadow-2xl border border-[var(--border-subtle)] animate-in zoom-in duration-300">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">Add Personnel</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic mt-1">Onboard new security operator</p>
                            </div>
                            <button onClick={() => setShowInviteModal(false)} className="p-2 text-slate-400 hover:text-slate-900 dark:text-white dark:hover:text-white transition-colors">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <form onSubmit={handleInviteMember}>
                            <div className="space-y-8">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic mb-3 block">Communications ID (Email)</label>
                                    <div className="relative">
                                        <Mail className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-600" />
                                        <input
                                            type="email"
                                            required
                                            value={inviteEmail}
                                            onChange={(e) => setInviteEmail(e.target.value)}
                                            placeholder="operator@sector.com"
                                            className="w-full pl-14 pr-6 py-5 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 dark:border-slate-800 rounded-2xl focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 outline-none transition-all font-black italic text-sm tracking-tight"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic mb-3 block">Authority Level (Role)</label>
                                    <div className="relative">
                                        <Shield className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-600 pointer-events-none" />
                                        <select
                                            value={inviteRole}
                                            onChange={(e) => setInviteRole(e.target.value as any)}
                                            className="w-full pl-14 pr-6 py-5 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 dark:border-slate-800 rounded-2xl focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 outline-none transition-all font-black italic text-sm tracking-tight appearance-none"
                                        >
                                            <option value="viewer">Viewer Protocol (Read-Only)</option>
                                            <option value="developer">Developer Protocol (Scan & Resolve)</option>
                                            <option value="admin">Administrator Protocol (Manage Cluster)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-4 mt-12">
                                <button
                                    type="button"
                                    onClick={() => setShowInviteModal(false)}
                                    className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 dark:text-slate-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-slate-800 transition-all border border-slate-200 dark:border-slate-700 dark:border-slate-800"
                                >
                                    Abort
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/40"
                                >
                                    Deploy Invitation
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}



