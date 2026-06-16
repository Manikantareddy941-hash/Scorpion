import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
    Users, UserPlus, LogOut, Settings, Plus, ChevronRight,
    Loader2, Mail, Activity, GitBranch, Shield, Terminal,
    Trash2, Edit2, Check, X, Search, RefreshCw, AlertTriangle,
    Clock, Filter, Copy, ChevronDown, Eye, Lock, Unlock
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTerminology } from '../contexts/TerminologyContext';

// ─── Types ──────────────────────────────────────────────────────────────────

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
    version?: string;
    lastModified?: string;
    attachedAt?: string;
}

interface AuditEntry {
    id: string;
    action: string;
    actor: string;
    target: string;
    timestamp: string;
    severity: 'info' | 'warn' | 'critical';
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ROLES = ['viewer', 'editor', 'admin'] as const;
type Role = typeof ROLES[number];

// Team type categories for category picker
const TEAM_TYPES = [
    { id: 'all', name: 'All Teams', icon: 'all-teams', color: '#4DD9C0' },
    { id: 'security', name: 'Security', icon: 'security', color: '#50FA7B' },
    { id: 'devops', name: 'DevOps', icon: 'devops', color: '#4FC3F7' },
    { id: 'sre', name: 'SRE', icon: 'sre', color: '#FFB347' },
    { id: 'platform', name: 'Platform', icon: 'platform', color: '#BD93F9' },
    { id: 'data', name: 'Data', icon: 'data', color: '#FF6E6E' },
    { id: 'network', name: 'Network', icon: 'network', color: '#8BE9FD' },
    { id: 'engineering', name: 'Engineering', icon: 'engineering', color: '#F1FA8C' },
] as const;

const ATTACHED_POLICIES_MOCK: AttachedPolicy[] = [
    {
        name: "ScorpionDeveloperAccess",
        description: "Enables code scans, reading repositories, creating and resolving triage tasks. Denies security gate bypasses.",
        arn: "arn:scorpion:iam::aws:policy/ScorpionDeveloperAccess",
        version: "v3",
        lastModified: "2026-05-17",
        attachedAt: "2026-04-01",
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
        version: "v1",
        lastModified: "2026-03-10",
        attachedAt: "2026-04-15",
        document: JSON.stringify({
            "Version": "2026-03-10",
            "Statements": [
                {
                    "Effect": "Allow",
                    "Actions": ["repo:read", "tasks:read", "threats:read", "audit:read"],
                    "Resources": ["*"]
                },
                {
                    "Effect": "Deny",
                    "Actions": ["*"],
                    "Resources": ["arn:scorpion:iam::*"]
                }
            ]
        }, null, 2)
    },
    {
        name: "PipelineExecutorAccess",
        description: "Grants CI/CD pipeline trigger and read permissions. Denies direct repository write.",
        arn: "arn:scorpion:iam::aws:policy/PipelineExecutorAccess",
        version: "v2",
        lastModified: "2026-02-20",
        attachedAt: "2026-05-01",
        document: JSON.stringify({
            "Version": "2026-02-20",
            "Statements": [
                {
                    "Effect": "Allow",
                    "Actions": ["pipeline:read", "pipeline:trigger", "pipeline:logs"],
                    "Resources": ["arn:scorpion:pipeline::*"]
                },
                {
                    "Effect": "Deny",
                    "Actions": ["repo:write", "repo:delete", "gate:bypass"],
                    "Resources": ["*"]
                }
            ]
        }, null, 2)
    }
];

const AUDIT_LOG_MOCK: AuditEntry[] = [
    { id: '1', action: 'MEMBER_INVITED', actor: 'manikanta@scorpion.io', target: 'dev@scorpion.io', timestamp: '2026-05-28T04:12:00Z', severity: 'info' },
    { id: '2', action: 'ROLE_CHANGED', actor: 'manikanta@scorpion.io', target: 'dev@scorpion.io (viewer → editor)', timestamp: '2026-05-27T18:45:00Z', severity: 'warn' },
    { id: '3', action: 'POLICY_ATTACHED', actor: 'manikanta@scorpion.io', target: 'SecurityAuditorMinimal', timestamp: '2026-05-27T10:20:00Z', severity: 'info' },
    { id: '4', action: 'MEMBER_REMOVED', actor: 'manikanta@scorpion.io', target: 'ex-dev@scorpion.io', timestamp: '2026-05-26T14:00:00Z', severity: 'critical' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRoleBadge(role: string, t_term: (a: string, b: string) => string) {
    const base = "px-2 py-0.5 rounded text-[8px] font-black uppercase italic border";
    switch (role.toLowerCase()) {
        case 'owner':
            return <span className={`${base} bg-orange-50 text-orange-600 border-orange-200`}>{t_term('Commander', 'Team Lead')}</span>;
        case 'admin':
            return <span className={`${base} bg-purple-50 text-purple-600 border-purple-200`}>{t_term('Officer', 'Admin')}</span>;
        case 'editor':
            return <span className={`${base} bg-blue-50 text-blue-600 border-blue-200`}>{t_term('Specialist', 'Editor')}</span>;
        default:
            return <span className={`${base} bg-slate-100 text-slate-500 border-slate-200`}>{t_term('Operator', 'Member')}</span>;
    }
}

function getSeverityBadge(severity: AuditEntry['severity']) {
    switch (severity) {
        case 'critical': return <span className="px-1.5 py-0.5 rounded text-[7px] font-black uppercase bg-red-50 text-red-600 border border-red-200">CRITICAL</span>;
        case 'warn': return <span className="px-1.5 py-0.5 rounded text-[7px] font-black uppercase bg-yellow-50 text-yellow-600 border border-yellow-200">WARN</span>;
        default: return <span className="px-1.5 py-0.5 rounded text-[7px] font-black uppercase bg-slate-100 text-slate-500 border border-slate-200">INFO</span>;
    }
}

function formatTimestamp(ts: string) {
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function syntaxHighlightJSON(doc: string) {
    return doc.split('\n').map((line, i) => {
        if (line.includes('"Allow"')) return <span key={i} className="text-[#6db87a]">{line}{'\n'}</span>;
        if (line.includes('"Deny"')) return <span key={i} className="text-red-400">{line}{'\n'}</span>;
        if (line.match(/"[A-Z][a-zA-Z]+"\s*:/)) return <span key={i} className="text-blue-300">{line}{'\n'}</span>;
        if (line.match(/:\s*"[^"]+"/)) return <span key={i} className="text-amber-200">{line}{'\n'}</span>;
        return <span key={i}>{line}{'\n'}</span>;
    });
}

// ─── Custom SVG Icons ─────────────────────────────────────────────────────────

const AllTeamsIcon = ({ color }: { color: string }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <filter id="glow-all-teams" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <g filter="url(#glow-all-teams)">
            <circle cx="6" cy="6" r="2.5" stroke={color} strokeWidth="1.5" fill="none"/>
            <circle cx="18" cy="6" r="2.5" stroke={color} strokeWidth="1.5" fill="none"/>
            <circle cx="6" cy="18" r="2.5" stroke={color} strokeWidth="1.5" fill="none"/>
            <circle cx="18" cy="18" r="2.5" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M6 8.5V15.5" stroke={color} strokeWidth="1.5"/>
            <path d="M18 8.5V15.5" stroke={color} strokeWidth="1.5"/>
            <path d="M8.5 6H15.5" stroke={color} strokeWidth="1.5"/>
            <path d="M8.5 18H15.5" stroke={color} strokeWidth="1.5"/>
        </g>
    </svg>
);

const SecurityIcon = ({ color }: { color: string }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <filter id="glow-security" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <g filter="url(#glow-security)">
            <path d="M12 2L3 7V12C3 17.52 6.84 22.74 12 24C17.16 22.74 21 17.52 21 12V7L12 2Z" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M9 12L11 14L15 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
    </svg>
);

const DevOpsIcon = ({ color }: { color: string }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <filter id="glow-devops" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <g filter="url(#glow-devops)">
            <path d="M12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4Z" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M12 8V16" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M8 12H16" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M9.5 9.5L14.5 14.5" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M14.5 9.5L9.5 14.5" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 4V6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 18V20" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M4 12H6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M18 12H20" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </g>
    </svg>
);

const SREIcon = ({ color }: { color: string }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <filter id="glow-sre" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <g filter="url(#glow-sre)">
            <rect x="2" y="8" width="20" height="8" rx="1" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M4 12H6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M8 12H10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 12H14" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M16 12H18" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M20 12H22" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="5" cy="12" r="1.5" fill={color}/>
            <circle cx="12" cy="12" r="1.5" fill={color}/>
            <circle cx="19" cy="12" r="1.5" fill={color}/>
        </g>
    </svg>
);

const PlatformIcon = ({ color }: { color: string }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <filter id="glow-platform" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <g filter="url(#glow-platform)">
            <rect x="4" y="4" width="16" height="4" rx="1" stroke={color} strokeWidth="1.5" fill="none"/>
            <rect x="4" y="10" width="16" height="4" rx="1" stroke={color} strokeWidth="1.5" fill="none"/>
            <rect x="4" y="16" width="16" height="4" rx="1" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M8 6H16" stroke={color} strokeWidth="1" strokeLinecap="round"/>
            <path d="M8 12H16" stroke={color} strokeWidth="1" strokeLinecap="round"/>
            <path d="M8 18H16" stroke={color} strokeWidth="1" strokeLinecap="round"/>
        </g>
    </svg>
);

const DataIcon = ({ color }: { color: string }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <filter id="glow-data" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <g filter="url(#glow-data)">
            <ellipse cx="12" cy="5" rx="7" ry="2.5" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M5 5V19C5 20.66 8.13 22 12 22C15.87 22 19 20.66 19 19V5" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M5 10C5 11.66 8.13 13 12 13C15.87 13 19 11.66 19 10" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M5 15C5 16.66 8.13 18 12 18C15.87 18 19 16.66 19 15" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M12 8V16" stroke={color} strokeWidth="1" strokeLinecap="round"/>
            <path d="M8 10V14" stroke={color} strokeWidth="1" strokeLinecap="round"/>
            <path d="M16 10V14" stroke={color} strokeWidth="1" strokeLinecap="round"/>
        </g>
    </svg>
);

const NetworkIcon = ({ color }: { color: string }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <filter id="glow-network" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <g filter="url(#glow-network)">
            <circle cx="12" cy="4" r="2.5" stroke={color} strokeWidth="1.5" fill="none"/>
            <circle cx="4" cy="20" r="2.5" stroke={color} strokeWidth="1.5" fill="none"/>
            <circle cx="20" cy="20" r="2.5" stroke={color} strokeWidth="1.5" fill="none"/>
            <circle cx="12" cy="12" r="2" fill={color}/>
            <path d="M12 6.5V10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M10.5 11L6 17.5" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M13.5 11L18 17.5" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </g>
    </svg>
);

const EngineeringIcon = ({ color }: { color: string }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <filter id="glow-engineering" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <g filter="url(#glow-engineering)">
            <circle cx="12" cy="12" r="6" stroke={color} strokeWidth="1.5" fill="none"/>
            <path d="M12 6V4" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 18V20" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M6 12H4" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M18 12H20" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M8.5 8.5L7 7" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M15.5 15.5L17 17" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M8.5 15.5L7 17" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M15.5 8.5L17 7" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="12" cy="12" r="2" fill={color}/>
            <path d="M14 10L16 8" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M10 14L8 16" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </g>
    </svg>
);

const getIconComponent = (iconType: string, color: string) => {
    switch (iconType) {
        case 'all-teams': return <AllTeamsIcon color={color} />;
        case 'security': return <SecurityIcon color={color} />;
        case 'devops': return <DevOpsIcon color={color} />;
        case 'sre': return <SREIcon color={color} />;
        case 'platform': return <PlatformIcon color={color} />;
        case 'data': return <DataIcon color={color} />;
        case 'network': return <NetworkIcon color={color} />;
        case 'engineering': return <EngineeringIcon color={color} />;
        default: return <AllTeamsIcon color={color} />;
    }
};

// ─── Sub-Components ──────────────────────────────────────────────────────────

/** Inline role editor for an existing member row */
function RoleEditor({
    member, currentUserId, onRoleChange, onRemove, t_term
}: {
    member: Member;
    currentUserId?: string;
    onRoleChange: (userId: string, role: Role) => Promise<void>;
    onRemove: (userId: string) => void;
    t_term: (a: string, b: string) => string;
}) {
    const [editing, setEditing] = useState(false);
    const [selectedRole, setSelectedRole] = useState<Role>(member.role as Role || 'viewer');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        await onRoleChange(member.user_id, selectedRole);
        setSaving(false);
        setEditing(false);
    };

    const isSelf = member.user_id === currentUserId;

    return (
        <div className="p-5 flex items-center justify-between hover:bg-[#f5f0e8]/50 transition-colors group">
            <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center font-black text-blue-500 italic text-sm font-mono shadow-inner">
                    {member.email.charAt(0).toUpperCase()}
                </div>
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-black text-slate-700 uppercase italic tracking-tight">
                            {member.name || member.email.split('@')[0]}
                        </p>
                        {!editing && getRoleBadge(member.role, t_term)}
                        {isSelf && (
                            <span className="text-[7px] font-black bg-blue-50 text-blue-500 border border-blue-200 px-1.5 py-0.5 rounded uppercase tracking-widest font-mono">You</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <Mail size={10} className="text-slate-300" />
                        <p className="text-[9px] font-bold text-slate-400 uppercase font-mono">{member.email}</p>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2">
                {editing ? (
                    <div className="flex items-center gap-2">
                        <select
                            value={selectedRole}
                            onChange={e => setSelectedRole(e.target.value as Role)}
                            className="text-[9px] font-black uppercase bg-[#f5f0e8] border border-[#e8e0d0] rounded-lg px-2 py-1.5 outline-none focus:border-blue-400 cursor-pointer"
                        >
                            {ROLES.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                        </select>
                        <button
                            onClick={save}
                            disabled={saving}
                            className="p-1.5 bg-green-50 border border-green-200 rounded-lg text-green-600 hover:bg-green-100 transition-colors cursor-pointer disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        </button>
                        <button
                            onClick={() => setEditing(false)}
                            className="p-1.5 bg-[#f5f0e8] border border-[#e8e0d0] rounded-lg text-slate-400 hover:bg-[#e8e0d0] transition-colors cursor-pointer"
                        >
                            <X size={12} />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        {!isSelf && (
                            <>
                                <button
                                    onClick={() => setEditing(true)}
                                    title="Change role"
                                    className="p-2 text-slate-300 hover:text-blue-500 transition-colors cursor-pointer"
                                >
                                    <Edit2 size={14} />
                                </button>
                                <button
                                    onClick={() => onRemove(member.user_id)}
                                    title="Remove member"
                                    className="p-2 text-slate-300 hover:text-red-500 transition-colors cursor-pointer"
                                >
                                    <LogOut size={14} />
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Policy picker with search */
function PolicyPicker({
    policies, selected, onSelect
}: {
    policies: AttachedPolicy[];
    selected: string;
    onSelect: (name: string) => void;
}) {
    const [search, setSearch] = useState('');
    const filtered = policies.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="bg-white border border-[#e8e0d0] shadow-sm rounded-xl p-6 space-y-4">
            <div className="border-b border-[#e8e0d0] pb-3 flex justify-between items-center gap-3">
                <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-1.5 shrink-0">
                    <Shield size={12} className="text-purple-500" />
                    Attached IAM Policies
                </h4>
                <div className="relative">
                    <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input
                        placeholder="Filter..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-7 pr-2 py-1.5 text-[9px] bg-[#f5f0e8] border border-[#e8e0d0] rounded-lg outline-none focus:border-purple-300 w-28 font-mono"
                    />
                </div>
            </div>

            <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                {filtered.length === 0 ? (
                    <p className="text-center text-[9px] text-slate-400 py-4 uppercase font-bold">No policies match</p>
                ) : filtered.map((pol) => {
                    const isSelected = selected === pol.name;
                    return (
                        <div
                            key={pol.name}
                            onClick={() => onSelect(pol.name)}
                            className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${isSelected
                                ? 'bg-purple-50 border-purple-300'
                                : 'bg-[#f5f0e8] border-[#e8e0d0] hover:bg-[#e8e0d0]'}`}
                        >
                            <div className="flex justify-between items-center mb-1">
                                <span className={`text-[10px] font-black uppercase tracking-wider ${isSelected ? 'text-purple-700' : 'text-slate-700'}`}>
                                    {pol.name}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[7px] font-mono text-slate-400 font-bold">{pol.version}</span>
                                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-white text-purple-500 font-mono border border-purple-100 font-bold">Attached</span>
                                </div>
                            </div>
                            <p className="text-[9px] text-slate-500 leading-relaxed mb-2 font-mono">{pol.description}</p>
                            <div className="flex justify-between items-center">
                                <p className="text-[8px] font-mono text-slate-400 font-medium tracking-tight truncate max-w-[70%]">{pol.arn}</p>
                                {pol.attachedAt && (
                                    <span className="text-[7px] text-slate-400 font-mono flex items-center gap-1">
                                        <Clock size={8} />
                                        {pol.attachedAt}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** JSON policy document viewer with copy & version info */
function PolicyViewer({ policy }: { policy: AttachedPolicy | undefined }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (!policy) return;
        navigator.clipboard.writeText(policy.document);
        toast.success('IAM Policy copied to clipboard');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!policy) return null;

    return (
        <div className="bg-white border border-[#e8e0d0] shadow-sm rounded-xl p-6 flex flex-col gap-4">
            <div className="border-b border-[#e8e0d0] pb-3 flex justify-between items-center">
                <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                    <Terminal size={12} className="text-purple-500" />
                    JSON Policy Document
                </h4>
                <div className="flex items-center gap-2">
                    <span className="text-[7px] font-mono text-slate-400 font-bold">Modified: {policy.lastModified}</span>
                    <span className="text-[8px] px-2 py-0.5 rounded bg-purple-50 text-purple-600 font-mono font-bold tracking-widest border border-purple-100">{policy.version}</span>
                    <span className="text-[8px] px-2 py-0.5 rounded bg-green-50 text-green-600 font-mono font-bold border border-green-100">Active</span>
                </div>
            </div>

            <div className="bg-slate-800 text-slate-200 p-4 rounded-xl font-mono text-xs border border-slate-700 shadow-inner overflow-x-auto max-h-[320px] overflow-y-auto leading-relaxed">
                <pre className="text-[10px] whitespace-pre font-mono">
                    {syntaxHighlightJSON(policy.document)}
                </pre>
            </div>

            {/* Policy stat chips */}
            <div className="flex flex-wrap gap-2">
                {(() => {
                    try {
                        const parsed = JSON.parse(policy.document);
                        const stmts = parsed.Statements || [];
                        const allowCount = stmts.filter((s: any) => s.Effect === 'Allow').length;
                        const denyCount = stmts.filter((s: any) => s.Effect === 'Deny').length;
                        return (
                            <>
                                <span className="text-[8px] px-2 py-1 rounded-lg bg-green-50 border border-green-200 text-green-700 font-bold font-mono">
                                    ✓ {allowCount} Allow Statement{allowCount !== 1 ? 's' : ''}
                                </span>
                                <span className="text-[8px] px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-600 font-bold font-mono">
                                    ✗ {denyCount} Deny Statement{denyCount !== 1 ? 's' : ''}
                                </span>
                                <span className="text-[8px] px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 font-bold font-mono">
                                    {stmts.length} Total Statement{stmts.length !== 1 ? 's' : ''}
                                </span>
                            </>
                        );
                    } catch { return null; }
                })()}
            </div>

            <div className="border-t border-[#e8e0d0] pt-4 flex justify-between items-center">
                <span className="text-[8px] text-slate-400 uppercase tracking-widest font-bold">AWS-STYLE PARSER v1.0.0</span>
                <button
                    onClick={handleCopy}
                    className={`px-3.5 py-2 border rounded-lg text-[8px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm flex items-center gap-1.5
                        ${copied ? 'bg-green-50 border-green-200 text-green-600' : 'bg-white border-[#e8e0d0] hover:bg-[#f5f0e8] text-purple-600'}`}
                >
                    {copied ? <Check size={10} /> : <Copy size={10} />}
                    {copied ? 'Copied!' : 'Copy Document'}
                </button>
            </div>
        </div>
    );
}

/** Audit log panel */
function AuditLog({ entries }: { entries: AuditEntry[] }) {
    return (
        <div className="bg-white border border-[#e8e0d0] shadow-sm rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e8e0d0] flex justify-between items-center bg-[#f5f0e8]/30">
                <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                    <Clock size={12} className="text-amber-500" />
                    Recent IAM Activity
                </h3>
                <span className="text-[8px] font-bold text-slate-400 uppercase font-mono">{entries.length} events</span>
            </div>
            <div className="divide-y divide-[#e8e0d0]">
                {entries.map(entry => (
                    <div key={entry.id} className="px-6 py-3 flex items-center justify-between hover:bg-[#f5f0e8]/30 transition-colors">
                        <div className="flex items-center gap-3">
                            {getSeverityBadge(entry.severity)}
                            <div>
                                <p className="text-[9px] font-black text-slate-700 uppercase tracking-wide font-mono">{entry.action}</p>
                                <p className="text-[8px] text-slate-400 font-mono mt-0.5">
                                    <span className="text-blue-500">{entry.actor}</span> → <span>{entry.target}</span>
                                </p>
                            </div>
                        </div>
                        <span className="text-[8px] text-slate-400 font-mono shrink-0 ml-4">{formatTimestamp(entry.timestamp)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Delete team confirmation modal */
function DeleteTeamModal({
    team, onConfirm, onCancel
}: {
    team: Team;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const [confirmText, setConfirmText] = useState('');
    const valid = confirmText === team.name;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 backdrop-blur-sm" style={{ backgroundColor: '#0D1B2A80' }} onClick={onCancel} />
            <div className="max-w-md w-full p-8 rounded-2xl relative z-10 font-mono shadow-2xl" style={{ backgroundColor: '#1A2740', border: '1px solid #FF6E6E30' }}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#FF6E6E20', border: '1px solid #FF6E6E30' }}>
                        <AlertTriangle size={18} style={{ color: '#FF6E6E' }} />
                    </div>
                    <h2 className="text-base font-black uppercase italic tracking-wider" style={{ color: '#CDD6F4' }}>DISSOLVE BATTALION</h2>
                </div>
                <p className="text-[10px] leading-relaxed mb-4 font-mono" style={{ color: '#CDD6F4', opacity: 0.7 }}>
                    This is a <span className="font-black" style={{ color: '#FF6E6E' }}>PERMANENT</span> destructive action. All members, policy attachments, and repository scopes will be irrevocably removed.
                    Type <span className="font-black px-1 rounded" style={{ color: '#CDD6F4', backgroundColor: '#0D1B2A' }}>{team.name}</span> to confirm.
                </p>
                <input
                    type="text"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder={team.name}
                    className="w-full px-4 py-3 rounded-xl font-bold text-xs outline-none mb-6"
                    style={{ backgroundColor: '#0D1B2A', border: '1px solid #1A2740', color: '#CDD6F4' }}
                />
                <div className="flex gap-4">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest rounded-xl transition-colors cursor-pointer"
                        style={{ border: '1px solid #1A2740', color: '#CDD6F4', opacity: 0.7, backgroundColor: 'transparent' }}
                    >
                        Abort
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!valid}
                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ backgroundColor: '#FF6E6E', color: '#0D1B2A' }}
                    >
                        Dissolve Team
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Teams() {
    const { getJWT, user } = useAuth();
    const { t_term } = useTerminology();

    const [teams, setTeams] = useState<Team[]>([]);
    const [activeTeam, setActiveTeam] = useState<Team | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [membersLoading, setMembersLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    const [newTeamName, setNewTeamName] = useState('');
    const [newTeamDesc, setNewTeamDesc] = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<Role>('viewer');
    const [memberSearch, setMemberSearch] = useState('');
    const [memberRoleFilter, setMemberRoleFilter] = useState<'all' | Role>('all');

    const [activeTab, setActiveTab] = useState<'roster' | 'iam' | 'audit'>('roster');
    const [selectedPolicyName, setSelectedPolicyName] = useState('ScorpionDeveloperAccess');
    const [selectedTeamType, setSelectedTeamType] = useState('all');

    // Fetch teams from API
    const fetchTeams = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        else setRefreshing(true);
        try {
            const token = await getJWT();
            const res = await fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setTeams(data || []);
            if (data?.length > 0) setActiveTeam(prev => prev ? (data.find((t: Team) => t.$id === prev.$id) || data[0]) : data[0]);
            else setActiveTeam(null);
        } catch (err) {
            console.error('fetchTeams:', err);
            setTeams([]);
            setActiveTeam(null);
            toast.error(t_term('Failed to fetch battalions', 'Failed to fetch teams'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [getJWT, t_term]);

    const fetchMembers = useCallback(async (teamId: string) => {
        setMembersLoading(true);
        try {
            const token = await getJWT();
            const res = await fetch(`/api/teams/${teamId}/members`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setMembers(data || []);
        } catch (err) {
            console.error('fetchMembers:', err);
            setMembers([]);
            toast.error(t_term('Failed to fetch team operators', 'Failed to fetch team members'));
        } finally {
            setMembersLoading(false);
        }
    }, [getJWT, t_term]);

    useEffect(() => { fetchTeams(); }, []);
    useEffect(() => { if (activeTeam) fetchMembers(activeTeam.$id); }, [activeTeam?.$id]);

    // ── Actions ──

    const handleCreateTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const token = await getJWT();
            const res = await fetch('/api/teams', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newTeamName,
                    description: newTeamDesc,
                    // Backend Appwrite schema requires firstName/lastName
                    firstName: newTeamName.split(' ')[0] || newTeamName,
                    lastName: newTeamName.split(' ').slice(1).join(' ') || '',
                })
            });
            if (res.ok) {
                toast.success(t_term('Battalion initialized', 'Team created'));
                setShowCreateModal(false);
                setNewTeamName('');
                setNewTeamDesc('');
                fetchTeams(true);
            } else {
                const err = await res.json();
                toast.error(err.error || 'Create failed');
            }
        } catch { toast.error(t_term('Failed to create battalion', 'Failed to create team')); }
    };

    const handleInviteMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeTeam) return;
        try {
            const token = await getJWT();
            const res = await fetch(`/api/teams/${activeTeam.$id}/invite`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail, role: inviteRole })
            });
            if (res.ok) {
                toast.success(t_term('Operator deployed', 'Member invited'));
                setShowInviteModal(false);
                setInviteEmail('');
                setInviteRole('viewer');
                fetchMembers(activeTeam.$id);
            } else {
                const err = await res.json();
                toast.error(err.error || t_term('Failed to deploy operator', 'Failed to invite member'));
            }
        } catch { toast.error(t_term('Failed to deploy operator', 'Failed to invite member')); }
    };

    const handleRemoveMember = (memberUserId: string) => {
        if (!activeTeam) return;
        // Optimistic removal with undo opportunity
        const prev = [...members];
        setMembers(m => m.filter(x => x.user_id !== memberUserId));
        toast.custom((toastInstance) => (
            <div className="bg-white border border-[#e8e0d0] rounded-xl px-4 py-3 shadow-lg flex items-center gap-4 font-mono text-xs">
                <AlertTriangle size={14} className="text-red-500 shrink-0" />
                <span className="text-slate-700 font-bold uppercase text-[10px]">{t_term('Operator ejected', 'Member removed')}</span>
                <button
                    onClick={() => { setMembers(prev); toast.dismiss(toastInstance.id); }}
                    className="text-blue-500 font-black uppercase text-[9px] underline cursor-pointer"
                >
                    Undo
                </button>
            </div>
        ), { duration: 5000 });

        getJWT().then(token =>
            fetch(`/api/teams/${activeTeam.$id}/members/${memberUserId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
        ).catch(() => {
            setMembers(prev);
            toast.error(t_term('Failed to remove operator', 'Failed to remove member'));
        });
    };

    const handleRoleChange = async (userId: string, newRole: Role) => {
        if (!activeTeam) return;
        try {
            const token = await getJWT();
            const res = await fetch(`/api/teams/${activeTeam.$id}/members/${userId}/role`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            });
            if (res.ok) {
                setMembers(m => m.map(mem => mem.user_id === userId ? { ...mem, role: newRole } : mem));
                toast.success(`Role updated to ${newRole.toUpperCase()}`);
            } else {
                throw new Error('PATCH failed');
            }
        } catch {
            toast.error('Failed to update role');
        }
    };

    const handleDeleteTeam = async () => {
        if (!activeTeam) return;
        try {
            const token = await getJWT();
            await fetch(`/api/teams/${activeTeam.$id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success(t_term('Battalion dissolved', 'Team deleted'));
            setShowDeleteModal(false);
            fetchTeams();
        } catch {
            toast.error('Failed to delete team');
        }
    };

    // Derived state
    const filteredMembers = members.filter(m => {
        const matchesSearch = !memberSearch ||
            m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
            (m.name || '').toLowerCase().includes(memberSearch.toLowerCase());
        const matchesRole = memberRoleFilter === 'all' || m.role === memberRoleFilter;
        return matchesSearch && matchesRole;
    });

    const activePolicyDoc = activeTeam?.policy
        ? (typeof activeTeam.policy === 'string' ? activeTeam.policy : JSON.stringify(activeTeam.policy, null, 2))
        : null;

    // If the team has a real policy attached, synthesize it into the mock list so the viewer works
    const effectivePolicies: AttachedPolicy[] = activePolicyDoc
        ? [{ name: 'Team Policy', description: 'Team-level IAM policy', arn: `arn:scorpion:iam::${activeTeam?.$id}:policy/TeamPolicy`, document: activePolicyDoc, version: 'v1', lastModified: 'Unknown' }, ...ATTACHED_POLICIES_MOCK]
        : ATTACHED_POLICIES_MOCK;

    const selectedPolicy = effectivePolicies.find(p => p.name === selectedPolicyName) ?? effectivePolicies[0];

    // ── Render ──

    return (
        <div className="min-h-screen bg-[#0D1B2A] font-mono text-[#CDD6F4]" style={{ backgroundColor: '#0D1B2A' }}>
            <div className="max-w-7xl mx-auto px-6 py-8">

                {/* Header */}
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-black uppercase italic tracking-widest flex items-center gap-3" style={{ color: '#CDD6F4' }}>
                            <Users style={{ color: '#4DD9C0' }} size={32} />
                            {t_term('TACTICAL BATTALIONS', 'TEAMS')}
                        </h1>
                        <p className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: '#CDD6F4', opacity: 0.7 }}>
                            {t_term('[ MULTI-TENANT WORKSPACE SEGREGATION & OPERATOR ROSTER ]', '[ WORKSPACE ISOLATION & TEAM MEMBER ROSTER ]')}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => fetchTeams(true)}
                            disabled={refreshing}
                            className="p-3 backdrop-blur-sm border rounded-xl transition-all cursor-pointer"
                            style={{ backgroundColor: '#1A2740', borderColor: '#1A2740', color: '#CDD6F4' }}
                            title="Refresh"
                        >
                            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 shadow-lg flex items-center gap-2 cursor-pointer"
                            style={{ background: 'linear-gradient(to right, #4DD9C0, #4FC3F7)', color: '#0D1B2A' }}
                        >
                            <Plus size={14} />
                            {t_term('INITIALIZE BATTALION', 'INITIALIZE TEAM')}
                        </button>
                    </div>
                </div>

                {/* Category Picker Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 mb-8">
                    {TEAM_TYPES.map((type) => {
                        const isSelected = selectedTeamType === type.id;
                        return (
                            <button
                                key={type.id}
                                onClick={() => setSelectedTeamType(type.id)}
                                className={`flex flex-col items-center gap-3 p-4 rounded-xl transition-all duration-300 cursor-pointer ${
                                    isSelected
                                        ? 'bg-[#1A2740] border-[1.5px] shadow-lg hover:scale-105'
                                        : 'bg-[#1A2740]/50 backdrop-blur-sm border border-transparent hover:border-[#1A2740] hover:scale-105'
                                }`}
                                style={{
                                    borderColor: isSelected ? type.color : undefined,
                                    boxShadow: isSelected ? `0 0 20px ${type.color}40` : undefined
                                }}
                            >
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300 ${
                                    isSelected
                                        ? 'bg-white/10'
                                        : 'bg-white/5 backdrop-blur-sm'
                                }`}>
                                    {getIconComponent(type.icon, isSelected ? type.color : type.color)}
                                </div>
                                <span className="text-[9px] font-black uppercase tracking-wider text-center font-mono"
                                    style={{
                                        color: isSelected ? type.color : `${type.color}CC`,
                                        opacity: isSelected ? 1 : 0.8
                                    }}
                                >
                                    {type.name}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Team Member Cards Grid */}
                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 size={32} className="animate-spin" style={{ color: '#4DD9C0' }} />
                    </div>
                ) : teams.length === 0 ? (
                    <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: '#1A2740', border: '1px solid #1A2740' }}>
                        <Users className="mb-4 mx-auto" size={64} style={{ color: '#CDD6F4', opacity: 0.5 }} />
                        <h3 className="text-xl font-black uppercase italic tracking-wider mb-3" style={{ color: '#CDD6F4' }}>[ NO ACTIVE BATTALIONS ]</h3>
                        <p className="text-[11px] font-medium leading-relaxed max-w-md mb-8 mx-auto" style={{ color: '#CDD6F4', opacity: 0.7 }}>
                            No tactical battalions or teams were found for your security scope.
                        </p>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="px-6 py-4 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all duration-300 shadow-lg flex items-center gap-2 cursor-pointer hover:scale-[1.02] mx-auto"
                            style={{ background: 'linear-gradient(to right, #4DD9C0, #4FC3F7)', color: '#0D1B2A' }}
                        >
                            <Plus size={14} />
                            {t_term('INITIALIZE FIRST BATTALION', 'INITIALIZE FIRST TEAM')}
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {teams.map((team) => {
                            const isActive = activeTeam?.$id === team.$id;
                            return (
                                <div
                                    key={team.$id}
                                    onClick={() => setActiveTeam(team)}
                                    className="rounded-2xl p-6 transition-all duration-300 cursor-pointer hover:scale-[1.02]"
                                    style={{
                                        backgroundColor: '#1A2740',
                                        border: isActive ? '1.5px solid #4DD9C0' : '1px solid #1A2740',
                                        boxShadow: isActive ? '0 0 20px #4DD9C040' : undefined
                                    }}
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="w-14 h-14 rounded-xl flex items-center justify-center backdrop-blur-sm"
                                            style={{
                                                background: 'linear-gradient(to bottom right, #4DD9C020, #4FC3F720)',
                                                border: '1px solid #1A2740'
                                            }}
                                        >
                                            <Users size={28} style={{ color: '#4DD9C0' }} />
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setShowInviteModal(true); setActiveTeam(team); }}
                                                className="p-2 rounded-lg transition-colors cursor-pointer"
                                                style={{ backgroundColor: '#1A2740', color: '#CDD6F4' }}
                                                title="Add member"
                                            >
                                                <UserPlus size={14} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setActiveTeam(team); setShowDeleteModal(true); }}
                                                className="p-2 rounded-lg transition-colors cursor-pointer"
                                                style={{ backgroundColor: '#FF6E6E20', color: '#FF6E6E' }}
                                                title="Delete team"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <h3 className="text-sm font-black uppercase tracking-wider mb-2" style={{ color: '#CDD6F4' }}>
                                        {team.name || 'Unnamed Team'}
                                    </h3>
                                    <p className="text-[10px] font-medium leading-relaxed mb-4 line-clamp-2" style={{ color: '#CDD6F4', opacity: 0.7 }}>
                                        {team.description || t_term('No operational brief provided.', 'No description provided.')}
                                    </p>
                                    <div className="flex items-center justify-between text-[9px]" style={{ color: '#CDD6F4', opacity: 0.5 }}>
                                        <span className="font-mono">{team.$id}</span>
                                        <span className="font-mono">{team.role || 'Member'}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Create Team Modal */}
                {showCreateModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 backdrop-blur-sm" style={{ backgroundColor: '#0D1B2A80' }} onClick={() => setShowCreateModal(false)} />
                        <div className="max-w-md w-full p-8 rounded-2xl relative z-10 font-mono shadow-2xl" style={{ backgroundColor: '#1A2740', border: '1px solid #1A2740' }}>
                            <h2 className="text-lg font-black uppercase italic tracking-wider mb-6 flex items-center gap-2 pb-3" style={{ color: '#CDD6F4', borderBottom: '1px solid #1A2740' }}>
                                <Users style={{ color: '#4DD9C0' }} size={20} />
                                {t_term('INITIALIZE BATTALION', 'INITIALIZE TEAM')}
                            </h2>
                            <form onSubmit={handleCreateTeam} className="space-y-6">
                                <div>
                                    <label className="text-[9px] font-black uppercase tracking-widest block mb-2" style={{ color: '#CDD6F4', opacity: 0.7 }}>{t_term('Battalion Identifier', 'Team Name')}</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="SCORPION-ALPHA"
                                        value={newTeamName}
                                        onChange={e => setNewTeamName(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl font-bold uppercase text-xs outline-none resize-none"
                                        style={{ backgroundColor: '#0D1B2A', border: '1px solid #1A2740', color: '#CDD6F4' }}
                                    />
                                </div>
                                <div>
                                    <label className="text-[9px] font-black uppercase tracking-widest block mb-2" style={{ color: '#CDD6F4', opacity: 0.7 }}>{t_term('Tactical Mission Briefing', 'Team Description')}</label>
                                    <textarea
                                        rows={3}
                                        placeholder="Core security operations boundary for..."
                                        value={newTeamDesc}
                                        onChange={e => setNewTeamDesc(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl font-bold text-xs outline-none resize-none"
                                        style={{ backgroundColor: '#0D1B2A', border: '1px solid #1A2740', color: '#CDD6F4' }}
                                    />
                                </div>
                                <div className="flex gap-4 pt-4" style={{ borderTop: '1px solid #1A2740' }}>
                                    <button type="button" onClick={() => setShowCreateModal(false)}
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest rounded-xl transition-colors cursor-pointer"
                                        style={{ border: '1px solid #1A2740', color: '#CDD6F4', opacity: 0.7, backgroundColor: 'transparent' }}>
                                        {t_term('Abort', 'Cancel')}
                                    </button>
                                    <button type="submit"
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg cursor-pointer"
                                        style={{ background: 'linear-gradient(to right, #4DD9C0, #4FC3F7)', color: '#0D1B2A' }}>
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
                        <div className="absolute inset-0 backdrop-blur-sm" style={{ backgroundColor: '#0D1B2A80' }} onClick={() => setShowInviteModal(false)} />
                        <div className="max-w-md w-full p-8 rounded-2xl relative z-10 font-mono shadow-2xl" style={{ backgroundColor: '#1A2740', border: '1px solid #1A2740' }}>
                            <h2 className="text-lg font-black uppercase italic tracking-wider mb-6 flex items-center gap-2 pb-3" style={{ color: '#CDD6F4', borderBottom: '1px solid #1A2740' }}>
                                <UserPlus style={{ color: '#4DD9C0' }} size={20} />
                                {t_term('DEPLOY OPERATOR', 'INVITE MEMBER')}
                            </h2>
                            <form onSubmit={handleInviteMember} className="space-y-6">
                                <div>
                                    <label className="text-[9px] font-black uppercase tracking-widest block mb-2" style={{ color: '#CDD6F4', opacity: 0.7 }}>{t_term('Operator Security Email', 'Member Email')}</label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2" size={14} style={{ color: '#CDD6F4', opacity: 0.5 }} />
                                        <input
                                            type="email"
                                            required
                                            placeholder="operator@scorpion.io"
                                            value={inviteEmail}
                                            onChange={e => setInviteEmail(e.target.value)}
                                            className="w-full pl-12 pr-4 py-3 rounded-xl font-bold text-xs outline-none"
                                            style={{ backgroundColor: '#0D1B2A', border: '1px solid #1A2740', color: '#CDD6F4' }}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[9px] font-black uppercase tracking-widest block mb-2" style={{ color: '#CDD6F4', opacity: 0.7 }}>{t_term('Assignment Clearance Level', 'Role')}</label>
                                    <select
                                        value={inviteRole}
                                        onChange={e => setInviteRole(e.target.value as Role)}
                                        className="w-full px-4 py-3 rounded-xl font-bold text-xs outline-none appearance-none cursor-pointer"
                                        style={{ backgroundColor: '#0D1B2A', border: '1px solid #1A2740', color: '#CDD6F4' }}
                                    >
                                        <option value="viewer" style={{ backgroundColor: '#1A2740' }}>{t_term('OPERATOR (VIEWER)', 'MEMBER (VIEWER)')}</option>
                                        <option value="editor" style={{ backgroundColor: '#1A2740' }}>{t_term('SPECIALIST (EDITOR)', 'EDITOR')}</option>
                                        <option value="admin" style={{ backgroundColor: '#1A2740' }}>{t_term('OFFICER (ADMIN)', 'ADMIN')}</option>
                                    </select>
                                    {/* Role capability hints */}
                                    <div className="mt-2 p-3 rounded-lg text-[8px] font-mono space-y-0.5" style={{ backgroundColor: '#0D1B2A', border: '1px solid #1A2740', color: '#CDD6F4', opacity: 0.7 }}>
                                        {inviteRole === 'viewer' && <p>✓ Read repos, tasks, threats &nbsp; ✗ Write, scan, triage</p>}
                                        {inviteRole === 'editor' && <p>✓ Read + Write + Scan + Triage &nbsp; ✗ Gate bypass, policy edit</p>}
                                        {inviteRole === 'admin' && <p>✓ Full access except owner-only &nbsp; ✗ Team dissolution</p>}
                                    </div>
                                </div>
                                <div className="flex gap-4 pt-4" style={{ borderTop: '1px solid #1A2740' }}>
                                    <button type="button" onClick={() => setShowInviteModal(false)}
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest rounded-xl transition-colors cursor-pointer"
                                        style={{ border: '1px solid #1A2740', color: '#CDD6F4', opacity: 0.7, backgroundColor: 'transparent' }}>
                                        {t_term('Cancel', 'Cancel')}
                                    </button>
                                    <button type="submit"
                                        className="flex-1 py-3 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg cursor-pointer"
                                        style={{ background: 'linear-gradient(to right, #4DD9C0, #4FC3F7)', color: '#0D1B2A' }}>
                                        {t_term('DEPLOY', 'INVITE')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Delete Team Modal */}
                {showDeleteModal && activeTeam && (
                    <DeleteTeamModal
                        team={activeTeam}
                        onConfirm={handleDeleteTeam}
                        onCancel={() => setShowDeleteModal(false)}
                    />
                )}
            </div>
        </div>
    );
}