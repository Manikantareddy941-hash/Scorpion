import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    Users, UserPlus, LogOut, Settings, Plus, ChevronRight,
    Loader2, Mail, Activity, GitBranch, Shield, Terminal
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTerminology } from '../contexts/TerminologyContext';

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
    const { t_term } = useTerminology();
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
            if (!res.ok) {
                throw new Error(`HTTP Error ${res.status}`);
            }
            const data = await res.json();
            setTeams(data || []);
            if (data && data.length > 0) {
                setActiveTeam(data[0]);
            } else {
                setActiveTeam(null);
            }
        } catch (err) {
            console.error("Failed to fetch teams:", err);
            setTeams([]);
            setActiveTeam(null);
            toast.error(t_term('Failed to fetch battalions', 'Failed to fetch teams'));
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
            if (!res.ok) {
                throw new Error(`HTTP Error ${res.status}`);
            }
            const data = await res.json();
            setMembers(data || []);
        } catch (err) {
            console.error("Failed to fetch members:", err);
            setMembers([]);
            toast.error(t_term('Failed to fetch team operators', 'Failed to fetch team members'));
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
                toast.success(t_term('Team battalion created', 'Team created successfully'));
                setShowCreateModal(false);
                setNewTeamName('');
                setNewTeamDesc('');
                fetchTeams();
            }
        } catch (err) {
            toast.error(t_term('Failed to create battalion', 'Failed to create team'));
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
                toast.success(t_term('Operator deployed to team', 'Member invited to team'));
                setShowInviteModal(false);
                setInviteEmail('');
                fetchMembers(activeTeam.$id);
            } else {
                const err = await res.json();
                toast.error(err.error || t_term('Failed to deploy operator', 'Failed to invite member'));
            }
        } catch (err) {
            toast.error(t_term('Failed to deploy operator', 'Failed to invite member'));
        }
    };

    const handleRemoveMember = async (memberUserId: string) => {
        if (!activeTeam) return;
        if (!window.confirm(t_term('Eject this operator from the battalion?', 'Remove this member from the team?'))) return;
        
        try {
            const token = await getJWT();
            const apiBase = '';
            await fetch(`${apiBase}/api/teams/${activeTeam.$id}/members/${memberUserId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setMembers(prev => prev.filter(m => m.user_id !== memberUserId));
            toast.success(t_term('Operator ejected', 'Member removed'));
        } catch (err) {
            toast.error(t_term('Failed to remove operator', 'Failed to remove member'));
        }
    };

    const getRoleBadge = (role: string) => {
        const style = "px-2 py-0.5 rounded text-[8px] font-black uppercase italic border";
        switch (role.toLowerCase()) {
            case 'owner': return <span className={`${style} bg-orange-100 text-orange-700 border-orange-200`}>{t_term('Commander', 'Team Lead')}</span>;
            case 'admin': return <span className={`${style} bg-purple-100 text-purple-700 border-purple-200`}>{t_term('Officer', 'Admin')}</span>;
            case 'editor': return <span className={`${style} bg-blue-100 text-blue-700 border-blue-200`}>{t_term('Specialist', 'Editor')}</span>;
            default: return <span className={`${style} bg-emerald-100 text-[#6db87a] border-emerald-200`}>{t_term('Operator', 'Member')}</span>;
        }
    };

    const activePolicyDoc = activeTeam?.policy 
        ? (typeof activeTeam.policy === 'string' ? activeTeam.policy : JSON.stringify(activeTeam.policy, null, 2))
        : (ATTACHED_POLICIES_MOCK.find(p => p.name === selectedPolicyName)?.document || '');

    return (
        <div className="min-h-screen bg-[#f5f0e8] py-12 px-4 sm:px-6 lg:px-8 font-mono text-[#6db87a]">
            <div className="max-w-7xl mx-auto">
                
                {/* Header: White Card with Left Accent Border */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12 bg-white border border-[#e8e0d0] border-l-4 border-l-[#6db87a] p-6 rounded-xl shadow-sm">
                    <div>
                        <h1 className="text-3xl font-black text-[#6db87a] uppercase italic tracking-widest flex items-center gap-2">
                            <Users className="text-[#6db87a] animate-pulse" size={28} />
                            {t_term('TACTICAL BATTALIONS', 'TEAMS')}
                        </h1>
                        <p className="text-[10px] font-bold text-[#6db87a] uppercase tracking-widest mt-1">
                            {t_term('[ MULTI-TENANT WORKSPACE SEGREGATION & OPERATOR ROSTER ]', '[ WORKSPACE ISOLATION & TEAM MEMBER ROSTER ]')}
                        </p>
                    </div>

                    <button 
                        onClick={() => setShowCreateModal(true)}
                        className="px-5 py-3 bg-[#6db87a] hover:bg-[#6db87a]/90 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 shadow-sm flex items-center gap-2 cursor-pointer"
                    >
                        <Plus size={14} className="text-white" />
                        {t_term('INITIALIZE BATTALION', 'INITIALIZE TEAM')}
                    </button>
                </div>

                {/* Dual-Column Grid Split */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    
                    {/* 1. Left Sidebar Column (col-span-1) */}
                    <div className="col-span-1 space-y-6">
                        
                        {/* Operator Profile Widget - White background with subtle beige border */}
                        <div className="bg-[#ffffff] border border-[#e8e0d0] shadow-sm rounded-xl p-5 font-mono">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-xl bg-[#f5f0e8] border border-[#e8e0d0] flex items-center justify-center font-black text-[#6db87a] italic text-sm">
                                    {(user?.name || user?.email || 'M').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="text-xs font-black uppercase tracking-widest text-[#6db87a]">{t_term('OPERATOR CONSOLE', 'TEAM OVERVIEW')}</h3>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#6db87a] opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#6db87a]"></span>
                                        </span>
                                        <span className="text-[8px] font-black text-[#6db87a] uppercase tracking-wider">{t_term('[ ACTIVE_BUILDER ]', '[ SYNCED ]')}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Monospace Console Stats Block - Beige background with dark green text */}
                            <div className="bg-[#f5f0e8] p-4 rounded-lg border border-[#e8e0d0] font-mono text-xs text-[#6db87a] space-y-1.5 mb-4 shadow-inner">
                                <p><span className="text-[#6db87a]/70 font-bold">{t_term('OPERATOR', 'MEMBER')}:</span> {user?.name || user?.email?.split('@')[0] || 'MANIKANTA'}</p>
                                <p><span className="text-[#6db87a]/70 font-bold">{t_term('CLEARANCE', 'ACCESS LEVEL')}:</span> ROOT_ADMIN</p>
                                <p><span className="text-[#6db87a]/70 font-bold">ACTIVE BATTALIONS:</span> {teams.length}</p>
                                {activeTeam && <p><span className="text-[#6db87a]/70 font-bold">BATTALION STAFF:</span> {members.length} OPERATORS</p>}
                            </div>

                            <div className="bg-[#f5f0e8] p-3 rounded-lg border border-[#e8e0d0] text-[10px]">
                                <div className="flex justify-between items-center text-[8px] text-[#6db87a]/70 uppercase mb-1">
                                    <span>Workspace Isolation</span>
                                    <span className="text-[#6db87a] font-bold">{teams.length} ACTIVE</span>
                                </div>
                                <div className="w-full bg-[#e8e0d0] h-1.5 rounded-full overflow-hidden">
                                    <div className="bg-[#6db87a] h-full rounded-full" style={{ width: `${Math.min(teams.length * 20, 100)}%` }} />
                                </div>
                            </div>
                        </div>

                        {/* Tactical Battalion Navigation List - White card, beige border */}
                        <div className="bg-[#ffffff] border border-[#e8e0d0] shadow-sm rounded-xl p-5 space-y-4">
                            <div className="flex justify-between items-center border-b border-[#e8e0d0] pb-2">
                                <h4 className="text-[10px] font-black text-[#6db87a] uppercase tracking-widest flex items-center gap-1.5">
                                    <Users size={12} className="text-[#6db87a]" />
                                    {t_term('BATTALIONS', 'TEAMS')}
                                </h4>
                                <button 
                                    onClick={() => setShowCreateModal(true)}
                                    className="p-1 bg-[#f5f0e8] hover:bg-[#e8e0d0] rounded border border-[#e8e0d0] transition-colors cursor-pointer text-[#6db87a]"
                                >
                                    <Plus size={10} />
                                </button>
                            </div>

                            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                                {loading ? (
                                    Array(2).fill(0).map((_, i) => (
                                        <div key={i} className="h-14 animate-pulse bg-[#f5f0e8] rounded-lg border border-[#e8e0d0]" />
                                    ))
                                ) : teams.length === 0 ? (
                                    /* Lone Wolf State - beige bg with dark green text */
                                    <div className="text-center py-6 border border-dashed border-[#e8e0d0] rounded-lg text-[#6db87a] text-[9px] uppercase font-bold bg-[#f5f0e8]">
                                        {t_term('[ LONE WOLF STATE ]', '[ NO TEAMS ]')}
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
                                                        ? 'bg-[#6db87a]/15 border-[#6db87a] text-[#6db87a] shadow-sm'
                                                        : 'bg-[#f5f0e8] border-[#e8e0d0] text-[#6db87a]/75 hover:bg-[#e8e0d0]'
                                                }`}
                                            >
                                                <div className="truncate text-left">
                                                    <h3 className="text-[10px] font-black uppercase tracking-wide truncate text-[#6db87a]">{team.name || (team as any).title || 'Unnamed Team'}</h3>
                                                    <span className="text-[8px] opacity-60 uppercase font-bold text-[#6db87a]/70">{team.role || 'Member'}</span>
                                                </div>
                                                <ChevronRight size={12} className={isActive ? 'text-[#6db87a]' : 'text-[#6db87a]/40'} />
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 2. Operations Center Area (Right Column - col-span-3) */}
                    <div className="col-span-1 lg:col-span-3">
                        
                        {teams.length === 0 ? (
                            /* [ NO ACTIVE BATTALIONS ] empty state: White card with green icon/text */
                            <div className="bg-[#ffffff] border border-[#e8e0d0] shadow-sm rounded-xl p-8 sm:p-10 min-h-[480px] flex flex-col justify-center items-center text-center font-mono">
                                <Users className="text-[#6db87a]" size={64} />
                                <h3 className="text-xl font-black text-[#6db87a] uppercase italic tracking-wider mb-3">
                                    [ NO ACTIVE BATTALIONS ]
                                </h3>
                                <p className="text-[11px] text-[#6db87a]/85 font-medium leading-relaxed max-w-md mb-8">
                                    No tactical battalions or teams were found for your security scope. Access was denied, or the active endpoint returned an empty neural array.
                                </p>
                                <button 
                                    onClick={() => setShowCreateModal(true)}
                                    className="px-6 py-4 bg-[#6db87a] hover:bg-[#6db87a]/95 text-white font-black uppercase tracking-widest text-[9px] rounded-xl transition-all duration-300 shadow-sm flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.02]"
                                >
                                    <Plus size={14} className="text-white" />
                                    {t_term('INITIALIZE FIRST BATTALION', 'INITIALIZE FIRST TEAM')}
                                </button>
                            </div>
                        ) : activeTeam ? (
                            <div className="space-y-6">
                                {/* Active Battalion Info Card */}
                                <div className="bg-[#ffffff] border border-[#e8e0d0] shadow-sm rounded-xl p-6 sm:p-8">
                                    <div className="flex flex-col md:flex-row justify-between gap-6">
                                        <div className="flex items-start gap-6">
                                            <div className="w-16 h-16 rounded-2xl bg-[#f5f0e8] border border-[#e8e0d0] flex items-center justify-center text-[#6db87a] shrink-0">
                                                <Users size={32} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-3">
                                                    <h2 className="text-xl font-black text-[#6db87a] uppercase italic tracking-wider">{activeTeam.name || (activeTeam as any).title || t_term('Unnamed Battalion', 'Unnamed Team')}</h2>
                                                    {getRoleBadge(activeTeam.role || 'viewer')}
                                                </div>
                                                <p className="text-[10px] font-bold text-[#6db87a]/70 uppercase mt-2 leading-relaxed max-w-xl font-mono">
                                                    {activeTeam.description || t_term('No operational brief provided for this battalion.', 'No description provided for this team.')}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex gap-3 shrink-0 self-start md:self-center">
                                            <button 
                                                onClick={() => setShowInviteModal(true)}
                                                className="px-4 py-2.5 bg-[#f5f0e8] border border-[#e8e0d0] rounded-xl text-[#6db87a] hover:bg-[#e8e0d0] transition-all flex items-center gap-2 text-[9px] font-black uppercase tracking-wider cursor-pointer"
                                            >
                                                <UserPlus size={14} className="text-[#6db87a]" />
                                                {t_term('Deploy Operator', 'Add Member')}
                                            </button>
                                            <button className="p-3 bg-[#f5f0e8] border border-[#e8e0d0] rounded-xl text-[#6db87a] hover:bg-[#e8e0d0] transition-colors cursor-pointer">
                                                <Settings size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Sub Tabs Selector */}
                                <div className="flex border-b border-[#e8e0d0] gap-6">
                                    <button 
                                        onClick={() => setActiveTab('roster')}
                                        className={`pb-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all duration-300 cursor-pointer ${
                                            activeTab === 'roster' 
                                                ? 'border-[#6db87a] text-[#6db87a] font-bold' 
                                                : 'border-transparent text-[#6db87a]/60 hover:text-[#6db87a]'
                                        }`}
                                    >
                                        {t_term('Deployment Roster', 'Team Roster')}
                                    </button>
                                    <button 
                                        onClick={() => setActiveTab('iam')}
                                        className={`pb-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all duration-300 cursor-pointer ${
                                            activeTab === 'iam' 
                                                ? 'border-[#6db87a] text-[#6db87a] font-bold' 
                                                : 'border-transparent text-[#6db87a]/60 hover:text-[#6db87a]'
                                        }`}
                                    >
                                        Access Management (IAM)
                                    </button>
                                </div>

                                {activeTab === 'roster' ? (
                                    /* Deployment Roster Card - White background, beige border */
                                    <div className="bg-[#ffffff] border border-[#e8e0d0] shadow-sm rounded-xl overflow-hidden">
                                        <div className="px-6 py-4 border-b border-[#e8e0d0] flex justify-between items-center bg-[#f5f0e8]/30">
                                            <h3 className="text-[10px] font-black text-[#6db87a] uppercase tracking-widest">{t_term('Deployment Roster', 'Team Members')}</h3>
                                            <div className="flex items-center gap-2 text-[9px] font-black text-[#6db87a]/75 uppercase">
                                                <Activity size={10} className="text-[#6db87a] animate-pulse" />
                                                {members.length} {t_term('Operators Online', 'Members Online')}
                                            </div>
                                        </div>

                                        {membersLoading ? (
                                            <div className="p-20 flex justify-center">
                                                <Loader2 size={24} className="animate-spin text-[#6db87a]" />
                                            </div>
                                        ) : (
                                            <div className="divide-y divide-[#e8e0d0]">
                                                {members.map((member) => (
                                                    <div key={member.$id} className="p-5 flex items-center justify-between hover:bg-[#f5f0e8]/50 transition-colors group">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 rounded-xl bg-[#f5f0e8] border border-[#e8e0d0] flex items-center justify-center font-black text-[#6db87a] italic text-sm font-mono shadow-inner">
                                                                {member.email.charAt(0).toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <p className="text-xs font-black text-[#6db87a] uppercase italic tracking-tight">{member.name || member.email.split('@')[0]}</p>
                                                                    {getRoleBadge(member.role)}
                                                                    {member.user_id === user?.$id && (
                                                                        <span className="text-[7px] font-black bg-[#f5f0e8] text-[#6db87a] border border-[#e8e0d0] px-1.5 py-0.5 rounded uppercase tracking-widest font-mono">You</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2 mt-1">
                                                                    <Mail size={10} className="text-[#6db87a]/50" />
                                                                    <p className="text-[9px] font-bold text-[#6db87a]/60 uppercase font-mono">{member.email}</p>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                            <button 
                                                                onClick={() => handleRemoveMember(member.user_id)}
                                                                disabled={member.user_id === user?.$id}
                                                                className="p-2 text-[#6db87a]/70 hover:text-red-600 disabled:opacity-30 cursor-pointer"
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
                                        <div className="bg-[#ffffff] border border-[#e8e0d0] shadow-sm rounded-xl p-6 space-y-4">
                                            <div className="border-b border-[#e8e0d0] pb-2">
                                                <h4 className="text-[10px] font-black text-[#6db87a] uppercase tracking-widest flex items-center gap-1.5">
                                                    <Shield size={12} className="text-[#6db87a]" />
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
                                                            className={`p-4 rounded-xl border text-left cursor-pointer transition-all duration-300 ${
                                                                isSelected 
                                                                    ? 'bg-[#6db87a]/15 border-[#6db87a] text-[#6db87a]' 
                                                                    : 'bg-[#f5f0e8] border-[#e8e0d0] text-[#6db87a]/70'
                                                            }`}
                                                        >
                                                            <div className="flex justify-between items-center mb-1">
                                                                <span className="text-[10px] font-black uppercase tracking-wider text-[#6db87a]">{pol.name}</span>
                                                                <span className="text-[8px] px-2 py-0.5 rounded bg-white text-[#6db87a]/80 font-mono text-[7px] border border-[#e8e0d0]">Attached</span>
                                                            </div>
                                                            <p className="text-[9px] text-[#6db87a]/80 leading-relaxed mb-2 font-mono">{pol.description}</p>
                                                            <p className="text-[8px] font-mono text-[#6db87a]/60 font-medium tracking-tight truncate">{pol.arn}</p>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Right Card: JSON Policy Document Viewer */}
                                        <div className="bg-[#ffffff] border border-[#e8e0d0] shadow-sm rounded-xl p-6 flex flex-col justify-between">
                                            <div className="space-y-4">
                                                <div className="border-b border-[#e8e0d0] pb-2 flex justify-between items-center">
                                                    <h4 className="text-[10px] font-black text-[#6db87a] uppercase tracking-widest flex items-center gap-1.5">
                                                        <Terminal size={12} className="text-[#6db87a]" />
                                                        JSON Policy Document
                                                    </h4>
                                                    <span className="text-[8px] px-2 py-0.5 rounded bg-[#6db87a]/15 text-[#6db87a] font-mono font-bold tracking-widest">Active</span>
                                                </div>
                                                
                                                {/* JSON slate terminal viewer - Beige background with dark green monospace text */}
                                                <div className="bg-[#f5f0e8] text-[#6db87a] p-4 rounded-xl font-mono text-xs border border-[#e8e0d0] shadow-inner overflow-x-auto max-h-[320px] overflow-y-auto leading-relaxed relative">
                                                    <pre className="text-[10px] whitespace-pre font-mono">
                                                        {activePolicyDoc}
                                                    </pre>
                                                </div>
                                            </div>

                                            <div className="border-t border-[#e8e0d0] pt-4 mt-6 flex justify-between items-center">
                                                <span className="text-[8px] text-[#6db87a]/60 uppercase tracking-widest font-bold">AWS-STYLE PARSER v1.0.0</span>
                                                <button 
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(activePolicyDoc);
                                                        toast.success('IAM Policy copied to clipboard');
                                                    }}
                                                    className="px-3.5 py-2 bg-white border border-[#e8e0d0] hover:bg-[#f5f0e8] rounded-lg text-[#6db87a] text-[8px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm"
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
                            <div className="bg-[#ffffff] border border-[#e8e0d0] shadow-sm rounded-xl p-8 sm:p-10 min-h-[480px] flex flex-col justify-between font-mono">
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <span className="text-[9px] font-mono tracking-widest text-[#6db87a] uppercase bg-[#6db87a]/15 border border-[#6db87a]/30 px-2.5 py-1 rounded-md inline-block">
                                            {t_term('Operational Bounds Status: Awaiting Deployment', 'Workspace Status: Ready to Create')}
                                        </span>
                                        <h3 className="text-2xl font-black text-[#6db87a] uppercase italic tracking-wide mt-3">
                                            {t_term('Deploy Your First Tactical Battalion', 'Create Your First Team')}
                                        </h3>
                                        <p className="text-[11px] text-[#6db87a]/80 font-medium leading-relaxed max-w-2xl">
                                            {t_term('Initialize isolated, secure environments to manage separate development squads, unique repository arrays, and independent compliance guardrails with absolute cryptographic isolation.', 'Create secure and isolated environments to manage separate development teams, specific repository groups, and custom compliance rules.')}
                                        </p>
                                    </div>

                                    {/* 3-Column Capability Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-8">
                                        {/* Box A: Repository Clusters */}
                                        <div className="bg-[#f5f0e8] border border-[#e8e0d0] p-5 rounded-xl flex flex-col items-start hover:scale-[1.02] transition-transform duration-300 hover:bg-[#e8e0d0] group">
                                            <div className="w-8 h-8 rounded-lg bg-[#6db87a]/15 border border-[#6db87a]/30 flex items-center justify-center text-[#6db87a] mb-4 group-hover:scale-110 transition-transform">
                                                <GitBranch size={16} />
                                            </div>
                                            <span className="bg-white text-[#6db87a] px-2 py-0.5 rounded text-[10px] font-mono mb-2 uppercase font-black tracking-widest border border-[#e8e0d0]">action: "repo:*"</span>
                                            <h4 className="text-[10px] font-black uppercase tracking-wider text-[#6db87a] mb-1.5">Repository Clusters</h4>
                                            <p className="text-[9px] text-[#6db87a]/75 leading-relaxed font-mono">
                                                Cluster target repositories and control access bounds under specific team boundaries.
                                            </p>
                                        </div>

                                        {/* Box B: Isolated Policies */}
                                        <div className="bg-[#f5f0e8] border border-[#e8e0d0] p-5 rounded-xl flex flex-col items-start hover:scale-[1.02] transition-transform duration-300 hover:bg-[#e8e0d0] group">
                                            <div className="w-8 h-8 rounded-lg bg-[#6db87a]/15 border border-[#6db87a]/30 flex items-center justify-center text-[#6db87a] mb-4 group-hover:scale-110 transition-transform">
                                                <Shield size={16} />
                                            </div>
                                            <span className="bg-white text-orange-700 px-2 py-0.5 rounded text-[10px] font-mono mb-2 uppercase font-black tracking-widest border border-orange-200">effect: "Allow" | "Deny"</span>
                                            <h4 className="text-[10px] font-black uppercase tracking-wider text-[#6db87a] mb-1.5">Isolated Policies</h4>
                                            <p className="text-[9px] text-[#6db87a]/75 leading-relaxed font-mono">
                                                Enforce unique Dynamic Policy thresholds and customized vulnerability guardrails.
                                            </p>
                                        </div>

                                        {/* Box C: Operator Roles */}
                                        <div className="bg-[#f5f0e8] border border-[#e8e0d0] p-5 rounded-xl flex flex-col items-start hover:scale-[1.02] transition-transform duration-300 hover:bg-[#e8e0d0] group">
                                            <div className="w-8 h-8 rounded-lg bg-[#6db87a]/15 border border-[#6db87a]/30 flex items-center justify-center text-[#6db87a] mb-4 group-hover:scale-110 transition-transform">
                                                <Users size={16} />
                                            </div>
                                            <span className="bg-white text-[#6db87a]/80 px-2 py-0.5 rounded text-[10px] font-mono mb-2 uppercase font-black tracking-widest border border-[#e8e0d0]">resource: "arn:scorp:btln/*"</span>
                                            <h4 className="text-[10px] font-black uppercase tracking-wider text-[#6db87a] mb-1.5">{t_term('Operator Roles', 'Member Roles')}</h4>
                                            <p className="text-[9px] text-[#6db87a]/75 leading-relaxed font-mono">
                                                {t_term('Manage team member seats with strict document-level Role.team() access rules.', 'Manage team membership with custom, document-level security access permissions.')}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 flex justify-end border-t border-[#e8e0d0] pt-6">
                                    <button 
                                        onClick={() => setShowCreateModal(true)}
                                        className="w-full sm:w-auto px-6 py-3.5 bg-[#6db87a] hover:bg-[#6db87a]/90 text-white font-black uppercase tracking-widest text-[9px] rounded-xl transition-all duration-300 shadow-sm flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.02]"
                                    >
                                        <Plus size={14} className="text-white" />
                                        {t_term('INITIALIZE BATTALION', 'INITIALIZE TEAM')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Create Team Modal - white card modal, beige borders */}
                {showCreateModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-[#f5f0e8]/80 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
                        <div className="bg-white border border-[#e8e0d0] max-w-md w-full p-8 rounded-2xl relative z-10 font-mono shadow-2xl">
                            <h2 className="text-lg font-black text-[#6db87a] uppercase italic tracking-wider mb-6 flex items-center gap-2 border-b border-[#e8e0d0] pb-3">
                                <Users className="text-[#6db87a]" size={20} />
                                {t_term('INITIALIZE BATTALION', 'INITIALIZE TEAM')}
                            </h2>
                            <form onSubmit={handleCreateTeam} className="space-y-6">
                                <div>
                                    <label className="text-[9px] font-black text-[#6db87a] uppercase tracking-widest block mb-2">{t_term('Battalion Identifier', 'Team Name')}</label>
                                    <input 
                                        type="text" 
                                        required
                                        placeholder="SCORPION-ALPHA"
                                        value={newTeamName}
                                        onChange={(e) => setNewTeamName(e.target.value)}
                                        className="w-full px-4 py-3 bg-[#f5f0e8] border border-[#e8e0d0] rounded-xl font-bold uppercase text-xs outline-none focus:border-[#6db87a] text-[#6db87a]"
                                    />
                                </div>
                                <div>
                                    <label className="text-[9px] font-black text-[#6db87a] uppercase tracking-widest block mb-2">{t_term('Tactical Mission Briefing', 'Team Description')}</label>
                                    <textarea 
                                        rows={3}
                                        placeholder="Core security operations boundary for..."
                                        value={newTeamDesc}
                                        onChange={(e) => setNewTeamDesc(e.target.value)}
                                        className="w-full px-4 py-3 bg-[#f5f0e8] border border-[#e8e0d0] rounded-xl font-bold text-xs outline-none focus:border-[#6db87a] text-[#6db87a] resize-none"
                                    />
                                </div>
                                <div className="flex gap-4 pt-4 border-t border-[#e8e0d0]">
                                    <button 
                                        type="button"
                                        onClick={() => setShowCreateModal(false)}
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest border border-[#e8e0d0] text-[#6db87a]/70 rounded-xl hover:bg-[#f5f0e8] transition-colors cursor-pointer"
                                    >
                                        {t_term('Abort', 'Cancel')}
                                    </button>
                                    <button 
                                        type="submit"
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest bg-[#6db87a] text-white rounded-xl hover:bg-[#6db87a]/90 transition-all shadow-sm cursor-pointer"
                                    >
                                        {t_term('INITIALIZE', 'CREATE')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Invite Member Modal */}
                {showInviteModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-[#f5f0e8]/80 backdrop-blur-sm" onClick={() => setShowInviteModal(false)} />
                        <div className="bg-white border border-[#e8e0d0] max-w-md w-full p-8 rounded-2xl relative z-10 font-mono shadow-2xl">
                            <h2 className="text-lg font-black text-[#6db87a] uppercase italic tracking-wider mb-6 flex items-center gap-2 border-b border-[#e8e0d0] pb-3">
                                <UserPlus className="text-[#6db87a]" size={20} />
                                {t_term('DEPLOY OPERATOR', 'INVITE MEMBER')}
                            </h2>
                            <form onSubmit={handleInviteMember} className="space-y-6">
                                <div>
                                    <label className="text-[9px] font-black text-[#6db87a] uppercase tracking-widest block mb-2">{t_term('Operator Security Email', 'Member Email')}</label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6db87a]/50" size={14} />
                                        <input 
                                            type="email" 
                                            required
                                            placeholder="operator@scorpion.io"
                                            value={inviteEmail}
                                            onChange={(e) => setInviteEmail(e.target.value)}
                                            className="w-full pl-12 pr-4 py-3 bg-[#f5f0e8] border border-[#e8e0d0] rounded-xl font-bold text-xs outline-none focus:border-[#6db87a] text-[#6db87a]"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[9px] font-black text-[#6db87a] uppercase tracking-widest block mb-2">{t_term('Assignment Clearance Level', 'Role')}</label>
                                    <select 
                                        value={inviteRole}
                                        onChange={(e) => setInviteRole(e.target.value)}
                                        className="w-full px-4 py-3 bg-[#f5f0e8] border border-[#e8e0d0] rounded-xl font-bold text-xs outline-none focus:border-[#6db87a] text-[#6db87a] appearance-none cursor-pointer"
                                    >
                                        <option value="viewer">{t_term('OPERATOR (VIEWER)', 'MEMBER (VIEWER)')}</option>
                                        <option value="editor">{t_term('SPECIALIST (EDITOR)', 'EDITOR')}</option>
                                        <option value="admin">{t_term('OFFICER (ADMIN)', 'ADMIN')}</option>
                                    </select>
                                </div>
                                <div className="flex gap-4 pt-4 border-t border-[#e8e0d0]">
                                    <button 
                                        type="button"
                                        onClick={() => setShowInviteModal(false)}
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest border border-[#e8e0d0] text-[#6db87a]/70 rounded-xl hover:bg-[#f5f0e8] transition-colors cursor-pointer"
                                    >
                                        {t_term('Cancel', 'Cancel')}
                                    </button>
                                    <button 
                                        type="submit"
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest bg-[#6db87a] text-white rounded-xl hover:bg-[#6db87a]/90 transition-all shadow-sm cursor-pointer"
                                    >
                                        {t_term('DEPLOY', 'INVITE')}
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
