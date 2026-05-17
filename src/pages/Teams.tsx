import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    Users, UserPlus, LogOut, Settings, Plus, ChevronRight,
    Loader2, Mail, Activity, GitBranch, Shield, Terminal
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Team {
    $id: string;
    name: string;
    description: string;
    owner_id: string;
    role?: string;
    policy?: string;
}

interface Member {
    $id: string;
    user_id: string;
    email: string;
    name: string;
    role: string;
}

interface AttachedPolicy {
    name: string;
    description: string;
    arn: string;
    document: string;
}

const ATTACHED_POLICIES_MOCK: AttachedPolicy[] = [
    {
        name: "ScorpionDeveloperAccess",
        description: "Enables code scans, reading repositories, creating and resolving triage tasks. Denies security gate bypasses.",
        arn: "arn:scorpion:iam::aws:policy/ScorpionDeveloperAccess",
        document: JSON.stringify({
            "Version": "2026-05-17",
            "Statements": [
                {
                    "Effect": "Allow",
                    "Actions": ["repo:read", "repo:scan", "tasks:read", "tasks:create", "tasks:triage", "threats:read"],
                    "Resources": ["*"]
                },
                {
                    "Effect": "Deny",
                    "Actions": ["gate:bypass", "policy:edit"],
                    "Resources": ["*"]
                }
            ]
        }, null, 2)
    },
    {
        name: "SecurityAuditorMinimal",
        description: "Minimal read-only access for compliance audit inspection across all namespaces.",
        arn: "arn:scorpion:iam::aws:policy/SecurityAuditorMinimal",
        document: JSON.stringify({
            "Version": "2026-05-17",
            "Statements": [
                {
                    "Effect": "Allow",
                    "Actions": ["repo:read", "tasks:read", "threats:read", "audit:read"],
                    "Resources": ["*"]
                },
                {
                    "Effect": "Deny",
                    "Actions": ["*"],
                    "Resources": ["*"]
                }
            ]
        }, null, 2)
    }
];

export default function Teams() {
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
    
    const [activeTab, setActiveTab] = useState<'roster' | 'iam'>('roster');
    const [selectedPolicyName, setSelectedPolicyName] = useState('ScorpionDeveloperAccess');

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
            const apiBase = '';
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
            const apiBase = '';
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
            const apiBase = '';
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
            const apiBase = '';
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
            const apiBase = '';
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

    const activePolicyDoc = activeTeam?.policy 
        ? (typeof activeTeam.policy === 'string' ? activeTeam.policy : JSON.stringify(activeTeam.policy, null, 2))
        : (ATTACHED_POLICIES_MOCK.find(p => p.name === selectedPolicyName)?.document || '');

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8 font-mono text-[var(--text-primary)]">
            <div className="max-w-7xl mx-auto">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12 border-b border-white/5 pb-8">
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase italic tracking-widest flex items-center gap-2">
                            <Users className="text-emerald-500 animate-pulse" size={28} />
                            TACTICAL BATTALIONS
                        </h1>
                        <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mt-1">
                            [ MULTI-TENANT WORKSPACE SEGREGATION & OPERATOR ROSTER ]
                        </p>
                    </div>

                    <button 
                        onClick={() => setShowCreateModal(true)}
                        className="px-5 py-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 shadow-[0_0_15px_rgba(16,185,129,0.1)] flex items-center gap-2 cursor-pointer"
                    >
                        <Plus size={14} />
                        INITIALIZE BATTALION
                    </button>
                </div>

                {/* Dual-Column Grid Split */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    
                    {/* 1. Left Sidebar Column (col-span-1) */}
                    <div className="col-span-1 space-y-6">
                        
                        {/* Operator Profile Widget */}
                        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-5 font-mono">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center font-black text-emerald-500 italic text-sm">
                                    {(user?.name || user?.email || 'M').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="text-xs font-black uppercase tracking-widest text-emerald-500">OPERATOR CONSOLE</h3>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                        </span>
                                        <span className="text-[8px] font-black text-emerald-400 uppercase tracking-wider">[ ACTIVE_BUILDER ]</span>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-950 p-4 rounded-lg border border-white/5 font-mono text-xs text-slate-300 space-y-1.5 mb-4 shadow-inner">
                                <p><span className="text-zinc-500 font-bold">OPERATOR:</span> {user?.name || user?.email?.split('@')[0] || 'MANIKANTA'}</p>
                                <p><span className="text-zinc-500 font-bold">CLEARANCE:</span> ROOT_ADMIN</p>
                                <p className="truncate"><span className="text-zinc-500 font-bold">TENANT_ID:</span> SCORPION_CORE_01</p>
                            </div>

                            <div className="bg-white/[0.01] p-3 rounded-lg border border-white/5 text-[10px]">
                                <div className="flex justify-between items-center text-[8px] text-[var(--text-secondary)] uppercase mb-1">
                                    <span>Workspace Isolation</span>
                                    <span className="text-emerald-500 font-bold">{teams.length} ACTIVE</span>
                                </div>
                                <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                                    <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${Math.min(teams.length * 20, 100)}%` }} />
                                </div>
                            </div>
                        </div>

                        {/* Tactical Battalion Navigation List */}
                        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-5 space-y-4">
                            <div className="flex justify-between items-center border-b border-white/5 pb-2">
                                <h4 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-1.5">
                                    <Users size={12} className="text-emerald-500" />
                                    BATTALIONS
                                </h4>
                                <button 
                                    onClick={() => setShowCreateModal(true)}
                                    className="p-1 bg-white/5 hover:bg-emerald-500/10 hover:text-emerald-500 rounded border border-white/5 transition-colors cursor-pointer"
                                >
                                    <Plus size={10} />
                                </button>
                            </div>

                            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                                {loading ? (
                                    Array(2).fill(0).map((_, i) => (
                                        <div key={i} className="h-14 animate-pulse bg-white/5 rounded-lg border border-white/5" />
                                    ))
                                ) : teams.length === 0 ? (
                                    <div className="text-center py-6 border border-dashed border-white/5 rounded-lg text-stone-500 text-[9px] uppercase font-bold">
                                        [ LONE WOLF STATE ]
                                    </div>
                                ) : (
                                    teams.map((team) => {
                                        const isActive = activeTeam?.$id === team.$id;
                                        return (
                                            <button 
                                                key={team.$id}
                                                onClick={() => setActiveTeam(team)}
                                                className={`w-full p-3 text-left rounded-lg border font-mono transition-all duration-300 flex justify-between items-center cursor-pointer ${
                                                    isActive
                                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-white shadow-[0_0_10px_rgba(16,185,129,0.08)]'
                                                        : 'bg-white/[0.01] border-white/5 text-[var(--text-secondary)] hover:bg-white/[0.03] hover:text-white'
                                                }`}
                                            >
                                                <div className="truncate text-left">
                                                    <h3 className={`text-[10px] font-black uppercase tracking-wide truncate ${isActive ? 'text-emerald-500' : ''}`}>{team.name || (team as any).title || 'Unnamed Team'}</h3>
                                                    <span className="text-[8px] opacity-60 uppercase font-bold">{team.role || 'Member'}</span>
                                                </div>
                                                <ChevronRight size={12} className={isActive ? 'text-emerald-500' : 'text-stone-600'} />
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 2. Operations Center Area (Right Column - col-span-3) */}
                    <div className="col-span-1 lg:col-span-3">
                        
                        {activeTeam ? (
                            <div className="space-y-6">
                                {/* Active Battalion Info Card */}
                                <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-6 sm:p-8">
                                    <div className="flex flex-col md:flex-row justify-between gap-6">
                                        <div className="flex items-start gap-6">
                                            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                                                <Users size={32} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-3">
                                                    <h2 className="text-xl font-black text-white uppercase italic tracking-wider">{activeTeam.name || (activeTeam as any).title || 'Unnamed Battalion'}</h2>
                                                    {getRoleBadge(activeTeam.role || 'viewer')}
                                                </div>
                                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase mt-2 leading-relaxed max-w-xl font-mono">
                                                    {activeTeam.description || 'No operational brief provided for this battalion.'}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex gap-3 shrink-0 self-start md:self-center">
                                            <button 
                                                onClick={() => setShowInviteModal(true)}
                                                className="px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-500 hover:bg-emerald-500/20 transition-all flex items-center gap-2 text-[9px] font-black uppercase tracking-wider cursor-pointer"
                                            >
                                                <UserPlus size={14} />
                                                Add Member
                                            </button>
                                            <button className="p-3 bg-white/[0.01] border border-white/5 rounded-xl text-[var(--text-secondary)] hover:text-white transition-colors cursor-pointer">
                                                <Settings size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Sub Tabs Selector */}
                                <div className="flex border-b border-white/5 gap-6">
                                    <button 
                                        onClick={() => setActiveTab('roster')}
                                        className={`pb-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all duration-300 cursor-pointer ${
                                            activeTab === 'roster' 
                                                ? 'border-emerald-500 text-white font-bold' 
                                                : 'border-transparent text-zinc-500 hover:text-zinc-300'
                                        }`}
                                    >
                                        Deployment Roster
                                    </button>
                                    <button 
                                        onClick={() => setActiveTab('iam')}
                                        className={`pb-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all duration-300 cursor-pointer ${
                                            activeTab === 'iam' 
                                                ? 'border-emerald-500 text-white font-bold' 
                                                : 'border-transparent text-zinc-500 hover:text-zinc-300'
                                        }`}
                                    >
                                        Access Management (IAM)
                                    </button>
                                </div>

                                {activeTab === 'roster' ? (
                                    /* Deployment Roster card */
                                    <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl overflow-hidden">
                                        <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                                            <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Deployment Roster</h3>
                                            <div className="flex items-center gap-2 text-[9px] font-black text-[var(--text-secondary)] uppercase">
                                                <Activity size={10} className="text-green-500 animate-pulse" />
                                                {members.length} Operators Online
                                            </div>
                                        </div>

                                        {membersLoading ? (
                                            <div className="p-20 flex justify-center">
                                                <Loader2 size={24} className="animate-spin text-emerald-500" />
                                            </div>
                                        ) : (
                                            <div className="divide-y divide-white/5">
                                                {members.map((member) => (
                                                    <div key={member.$id} className="p-5 flex items-center justify-between hover:bg-white/[0.01] transition-colors group">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-center font-black text-emerald-500 italic text-sm font-mono shadow-inner">
                                                                {member.email.charAt(0).toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <p className="text-xs font-black text-white uppercase italic tracking-tight">{member.name || member.email.split('@')[0]}</p>
                                                                    {getRoleBadge(member.role)}
                                                                    {member.user_id === user?.$id && (
                                                                        <span className="text-[7px] font-black bg-white/10 text-white px-1.5 py-0.5 rounded uppercase tracking-widest font-mono">You</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2 mt-1">
                                                                    <Mail size={10} className="text-stone-500" />
                                                                    <p className="text-[9px] font-bold text-stone-500 uppercase font-mono">{member.email}</p>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                            <button 
                                                                onClick={() => handleRemoveMember(member.user_id)}
                                                                disabled={member.user_id === user?.$id}
                                                                className="p-2 text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-30 cursor-pointer"
                                                            >
                                                                <LogOut size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Access Management (IAM) Tab */
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        {/* Left Card: Attached Policies */}
                                        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-6 space-y-4">
                                            <div className="border-b border-white/5 pb-2">
                                                <h4 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-1.5">
                                                    <Shield size={12} className="text-emerald-500" />
                                                    Attached IAM Policies
                                                </h4>
                                            </div>
                                            <div className="space-y-4">
                                                {ATTACHED_POLICIES_MOCK.map((pol) => {
                                                    const isSelected = selectedPolicyName === pol.name;
                                                    return (
                                                        <div 
                                                            key={pol.name}
                                                            onClick={() => setSelectedPolicyName(pol.name)}
                                                            className={`p-4 rounded-xl border text-left cursor-pointer transition-all duration-300 hover:bg-white/[0.02] ${
                                                                isSelected 
                                                                    ? 'bg-emerald-500/5 border-emerald-500/30 text-white' 
                                                                    : 'bg-white/[0.01] border-white/5 text-zinc-400'
                                                            }`}
                                                        >
                                                            <div className="flex justify-between items-center mb-1">
                                                                <span className="text-[10px] font-black uppercase tracking-wider text-white">{pol.name}</span>
                                                                <span className="text-[8px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono text-[7px] border border-white/5">Attached</span>
                                                            </div>
                                                            <p className="text-[9px] text-zinc-400 leading-relaxed mb-2 font-mono">{pol.description}</p>
                                                            <p className="text-[8px] font-mono text-zinc-500 font-medium tracking-tight truncate">{pol.arn}</p>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Right Card: JSON Policy Document Viewer */}
                                        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-6 flex flex-col justify-between">
                                            <div className="space-y-4">
                                                <div className="border-b border-white/5 pb-2 flex justify-between items-center">
                                                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-1.5">
                                                        <Terminal size={12} className="text-emerald-500" />
                                                        JSON Policy Document
                                                    </h4>
                                                    <span className="text-[8px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-mono font-bold tracking-widest">Active</span>
                                                </div>
                                                
                                                {/* JSON slate terminal viewer */}
                                                <div className="bg-slate-950 text-slate-300 p-4 rounded-xl font-mono text-xs border border-white/5 shadow-inner overflow-x-auto max-h-[320px] overflow-y-auto leading-relaxed relative">
                                                    <pre className="text-[10px] whitespace-pre font-mono">
                                                        {activePolicyDoc}
                                                    </pre>
                                                </div>
                                            </div>

                                            <div className="border-t border-white/5 pt-4 mt-6 flex justify-between items-center">
                                                <span className="text-[8px] text-zinc-500 uppercase tracking-widest font-bold">AWS-STYLE PARSER v1.0.0</span>
                                                <button 
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(activePolicyDoc);
                                                        toast.success('IAM Policy copied to clipboard');
                                                    }}
                                                    className="px-3.5 py-2 bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg text-white text-[8px] font-black uppercase tracking-wider transition-all cursor-pointer"
                                                >
                                                    Copy Document
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* Productive Workspace Onboarding Capability Map */
                            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] rounded-xl p-8 sm:p-10 min-h-[480px] flex flex-col justify-between font-mono">
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <span className="text-[9px] font-mono tracking-widest text-emerald-600 uppercase bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md inline-block">
                                            Operational Bounds Status: Awaiting Deployment
                                        </span>
                                        <h3 className="text-2xl font-black text-white uppercase italic tracking-wide mt-3">
                                            Deploy Your First Tactical Battalion
                                        </h3>
                                        <p className="text-[11px] text-zinc-400 font-medium leading-relaxed max-w-2xl">
                                            Initialize isolated, secure environments to manage separate development squads, unique repository arrays, and independent compliance guardrails with absolute cryptographic isolation.
                                        </p>
                                    </div>

                                    {/* 3-Column Capability Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-8">
                                        {/* Box A: Repository Clusters */}
                                        <div className="bg-white/[0.01] border border-white/5 p-5 rounded-xl flex flex-col items-start hover:scale-[1.02] transition-transform duration-300 hover:bg-white/[0.03] hover:border-white/10 group">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mb-4 group-hover:scale-110 transition-transform">
                                                <GitBranch size={16} />
                                            </div>
                                            <span className="bg-slate-950 text-emerald-400 px-2 py-0.5 rounded text-[10px] font-mono mb-2 uppercase font-black tracking-widest border border-emerald-500/10">action: "repo:*"</span>
                                            <h4 className="text-[10px] font-black uppercase tracking-wider text-white mb-1.5">Repository Clusters</h4>
                                            <p className="text-[9px] text-zinc-400 leading-relaxed font-mono">
                                                Cluster target repositories and control access bounds under specific team boundaries.
                                            </p>
                                        </div>

                                        {/* Box B: Isolated Policies */}
                                        <div className="bg-white/[0.01] border border-white/5 p-5 rounded-xl flex flex-col items-start hover:scale-[1.02] transition-transform duration-300 hover:bg-white/[0.03] hover:border-white/10 group">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mb-4 group-hover:scale-110 transition-transform">
                                                <Shield size={16} />
                                            </div>
                                            <span className="bg-slate-950 text-amber-400 px-2 py-0.5 rounded text-[10px] font-mono mb-2 uppercase font-black tracking-widest border border-amber-400/10">effect: "Allow" | "Deny"</span>
                                            <h4 className="text-[10px] font-black uppercase tracking-wider text-white mb-1.5">Isolated Policies</h4>
                                            <p className="text-[9px] text-zinc-400 leading-relaxed font-mono">
                                                Enforce unique Dynamic Policy thresholds and customized vulnerability guardrails.
                                            </p>
                                        </div>

                                        {/* Box C: Operator Roles */}
                                        <div className="bg-white/[0.01] border border-white/5 p-5 rounded-xl flex flex-col items-start hover:scale-[1.02] transition-transform duration-300 hover:bg-white/[0.03] hover:border-white/10 group">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mb-4 group-hover:scale-110 transition-transform">
                                                <Users size={16} />
                                            </div>
                                            <span className="bg-slate-950 text-slate-300 px-2 py-0.5 rounded text-[10px] font-mono mb-2 uppercase font-black tracking-widest border border-white/5">resource: "arn:scorp:btln/*"</span>
                                            <h4 className="text-[10px] font-black uppercase tracking-wider text-white mb-1.5">Operator Roles</h4>
                                            <p className="text-[9px] text-zinc-400 leading-relaxed font-mono">
                                                Manage team member seats with strict document-level Role.team() access rules.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 flex justify-end border-t border-white/5 pt-6">
                                    <button 
                                        onClick={() => setShowCreateModal(true)}
                                        className="w-full sm:w-auto px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[9px] rounded-xl transition-all duration-300 shadow-[0_4px_12px_rgba(16,185,129,0.2)] flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.02]"
                                    >
                                        <Plus size={14} />
                                        INITIALIZE BATTALION
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Create Team Modal */}
                {showCreateModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
                        <div className="bg-[#0b0c10]/95 border border-white/10 backdrop-blur-xl max-w-md w-full p-8 rounded-2xl relative z-10 font-mono shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                            <h2 className="text-lg font-black text-white uppercase italic tracking-wider mb-6 flex items-center gap-2 border-b border-white/5 pb-3">
                                <Users className="text-emerald-500" size={20} />
                                INITIALIZE BATTALION
                            </h2>
                            <form onSubmit={handleCreateTeam} className="space-y-6">
                                <div>
                                    <label className="text-[9px] font-black text-emerald-500 uppercase tracking-widest block mb-2">Battalion Identifier</label>
                                    <input 
                                        type="text" 
                                        required
                                        placeholder="SCORPION-ALPHA"
                                        value={newTeamName}
                                        onChange={(e) => setNewTeamName(e.target.value)}
                                        className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl font-bold uppercase text-xs outline-none focus:border-emerald-500 text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-[9px] font-black text-emerald-500 uppercase tracking-widest block mb-2">Tactical Mission Briefing</label>
                                    <textarea 
                                        rows={3}
                                        placeholder="Core security operations boundary for..."
                                        value={newTeamDesc}
                                        onChange={(e) => setNewTeamDesc(e.target.value)}
                                        className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl font-bold text-xs outline-none focus:border-emerald-500 text-white resize-none"
                                    />
                                </div>
                                <div className="flex gap-4 pt-4 border-t border-white/5">
                                    <button 
                                        type="button"
                                        onClick={() => setShowCreateModal(false)}
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest border border-white/10 text-stone-400 rounded-xl hover:text-white transition-colors cursor-pointer"
                                    >
                                        Abort
                                    </button>
                                    <button 
                                        type="submit"
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-[0_4px_12px_rgba(16,185,129,0.2)] cursor-pointer"
                                    >
                                        INITIALIZE
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
                        <div className="bg-[#0b0c10]/95 border border-white/10 backdrop-blur-xl max-w-md w-full p-8 rounded-2xl relative z-10 font-mono shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                            <h2 className="text-lg font-black text-white uppercase italic tracking-wider mb-6 flex items-center gap-2 border-b border-white/5 pb-3">
                                <UserPlus className="text-emerald-500" size={20} />
                                DEPLOY OPERATOR
                            </h2>
                            <form onSubmit={handleInviteMember} className="space-y-6">
                                <div>
                                    <label className="text-[9px] font-black text-emerald-500 uppercase tracking-widest block mb-2">Operator Security Email</label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-500" size={14} />
                                        <input 
                                            type="email" 
                                            required
                                            placeholder="operator@scorpion.io"
                                            value={inviteEmail}
                                            onChange={(e) => setInviteEmail(e.target.value)}
                                            className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl font-bold text-xs outline-none focus:border-emerald-500 text-white"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[9px] font-black text-emerald-500 uppercase tracking-widest block mb-2">Assignment Clearance Level</label>
                                    <select 
                                        value={inviteRole}
                                        onChange={(e) => setInviteRole(e.target.value)}
                                        className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl font-bold text-xs outline-none focus:border-emerald-500 text-white appearance-none cursor-pointer"
                                    >
                                        <option value="viewer">OPERATOR (VIEWER)</option>
                                        <option value="editor">SPECIALIST (EDITOR)</option>
                                        <option value="admin">OFFICER (ADMIN)</option>
                                    </select>
                                </div>
                                <div className="flex gap-4 pt-4 border-t border-white/5">
                                    <button 
                                        type="button"
                                        onClick={() => setShowInviteModal(false)}
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest border border-white/10 text-stone-400 rounded-xl hover:text-white transition-colors cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        type="submit"
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-[0_4px_12px_rgba(16,185,129,0.2)] cursor-pointer"
                                    >
                                        DEPLOY
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
