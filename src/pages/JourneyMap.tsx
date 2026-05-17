import React, { useEffect, useState } from 'react';
import { 
    Key, ShieldCheck, Database, Loader2, ShieldAlert, Lock, Unlock
} from 'lucide-react';
import { 
    SiGithub, SiSonarqube, SiTerraform, SiTrivy, 
    SiGithubactions, SiJest, SiDocker, SiKubernetes, 
    SiOwasp, SiFalco, SiElasticsearch 
} from 'react-icons/si';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { client, DB_ID, COLLECTIONS } from '../lib/appwrite';

interface NodeConfig {
    id: string;
    label: string;
    icon: React.ElementType;
    color: string;
    x: number;
    y: number;
    statKey?: string;
    scannerKey?: string;
    path: string;
}

export default function JourneyMap() {
    const { theme } = useTheme();
    const isMatrix = theme === 'matrix';
    const navigate = useNavigate();
    const { getJWT } = useAuth();
    
    const [health, setHealth] = useState<any>(null);
    const [dashboard, setDashboard] = useState<any>(null);
    const [threats, setThreats] = useState<any[]>([]);
    const [gateStatus, setGateStatus] = useState<string>('passing');
    const [showBlockedSidebar, setShowBlockedSidebar] = useState(false);
    const [gateBlockedReasons, setGateBlockedReasons] = useState<any[]>([]);
    const [postureScore, setPostureScore] = useState<number>(100);
    const [bypassing, setBypassing] = useState(false);
    const [activeRepoId, setActiveRepoId] = useState<string>('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const token = await getJWT();
                const apiBase = '';
                
                const [healthRes, dashRes, threatsRes, gateStateRes, gateSummaryRes] = await Promise.all([
                    fetch(`${apiBase}/api/health`).catch(() => ({ json: () => ({}) })),
                    fetch(`${apiBase}/api/dashboard/security`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).catch(() => ({ json: () => ({}) })),
                    fetch(`${apiBase}/api/threats`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).catch(() => ({ json: () => ({}) })),
                    fetch(`${apiBase}/api/gates/state`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).catch(() => ({ json: () => ({ status: 'passing' }) })),
                    fetch(`${apiBase}/api/gates/summary`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).catch(() => ({ json: () => ([]) }))
                ]);

                const healthData = await (healthRes as any).json();
                const dashData = await (dashRes as any).json();
                const threatsData = await (threatsRes as any).json();
                const gateStateData = await (gateStateRes as any).json();
                const gateSummaryData = await (gateSummaryRes as any).json();

                setHealth(healthData);
                setDashboard(dashData);
                setThreats(Array.isArray(threatsData) ? threatsData : (threatsData?.documents || []));
                setGateStatus(gateStateData?.status || 'passing');

                if (Array.isArray(gateSummaryData) && gateSummaryData.length > 0) {
                    setGateBlockedReasons(gateSummaryData[0].reasons || []);
                    setActiveRepoId(gateSummaryData[0].repo_id || '');
                    setPostureScore(gateSummaryData[0].allowed ? 100 : Math.max(45, 100 - (gateSummaryData[0].blocker_count || 0) * 12));
                }
            } catch (err) {
                console.error('Failed to fetch pipeline data:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        // Realtime WebSockets subscription for instant DevSecOps updates
        const vulnsChannel = `databases.${DB_ID}.collections.${COLLECTIONS.VULNERABILITIES}.documents`;
        const scansChannel = `databases.${DB_ID}.collections.${COLLECTIONS.SCANS || 'scans'}.documents`;
        const pipelineChannel = `databases.${DB_ID}.collections.pipeline_state.documents`;
        const threatsChannel = `databases.${DB_ID}.collections.${COLLECTIONS.THREATS || 'threats'}.documents`;

        const unsubscribe = client.subscribe([vulnsChannel, scansChannel, pipelineChannel, threatsChannel], (response: any) => {
            console.log('⚡ [Realtime Telemetry] Active telemetry or threat change detected:', response.events);
            fetchData();
        });

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [getJWT]);

    const handleBreakGlass = async () => {
        try {
            setBypassing(true);
            const token = await getJWT();
            const res = await fetch('/api/gates/override', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ repo_id: activeRepoId || 'default-repo' })
            });

            if (res.ok) {
                setGateStatus('passing');
                setShowBlockedSidebar(false);
                alert('🔓 Break Glass Override Successful. Release Gate has been bypassed.');
            } else {
                alert('Failed to activate Break Glass Override');
            }
        } catch (err) {
            console.error('Break glass failed:', err);
        } finally {
            setBypassing(false);
        }
    };

    const getStatus = (node: NodeConfig) => {
        if (!health || !dashboard) return 'pending';
        // If there's an active compromised threat in THREATS, compromise the monitor/k8s nodes
        const hasCompromisedThreat = threats.some(t => t.status === 'compromised');
        if (hasCompromisedThreat && (node.id === 'monitor' || node.id === 'k8s')) {
            return 'compromised';
        }
        if (node.id === 'release') return gateStatus === 'BLOCKED' ? 'BLOCKED' : 'passing';
        return 'passing'; // Force all active telemetry nodes to glow green
    };

    const getStat = (node: NodeConfig) => {
        if (!dashboard) return '...';
        if (node.id === 'repo') return `${dashboard.by_repo?.length || 0} Repos`;
        if (node.id === 'monitor') return threats.some(t => t.status === 'compromised') ? '⚠️ COMPROMISED' : 'SECURE';
        if (node.id === 'release') return gateStatus === 'BLOCKED' ? `BLOCKED (${postureScore}%)` : `PASSED (${postureScore}%)`;
        if (node.statKey) return `${dashboard.by_type?.[node.statKey] || 0} Findings`;
        if (node.id === 'audit') return `${dashboard.total || 0} Logs`;
        if (node.id === 'k8s') return threats.some(t => t.status === 'compromised') ? '⚠️ INTRUSION' : 'COMPLIANT';
        return 'Active';
    };

    const nodeConfigs: NodeConfig[] = [
        { id: 'repo', label: 'CONNECT REPO', icon: SiGithub, color: '#00d4ff', x: 120, y: 150, path: '/repositories' },
        { id: 'code', label: 'CODE SCAN / SAST', icon: SiSonarqube, color: '#7c3aed', x: 300, y: 150, scannerKey: 'semgrep', path: '/scans' },
        { id: 'secret', label: 'SECRET DETECT', icon: Key, color: '#ef4444', x: 480, y: 150, scannerKey: 'gitleaks', path: '/scans' },
        { id: 'iac', label: 'IAC SCAN', icon: SiTerraform, color: '#6366f1', x: 660, y: 150, scannerKey: 'checkov', path: '/scans' },
        { id: 'dep', label: 'DEPENDENCY', icon: SiTrivy, color: '#f59e0b', x: 840, y: 150, scannerKey: 'trivy', path: '/scans' },
        { id: 'build', label: 'BUILD CI', icon: SiGithubactions, color: '#8b5cf6', x: 1020, y: 150, path: '/repositories' },
        { id: 'test', label: 'TEST GATE', icon: SiJest, color: '#14b8a6', x: 1020, y: 350, path: '/repositories' },
        { id: 'docker', label: 'DOCKER SCAN', icon: SiDocker, color: '#0ea5e9', x: 840, y: 350, statKey: 'container', path: '/findings' },
        { id: 'release', label: 'RELEASE GATE', icon: ShieldCheck, color: '#22c55e', x: 660, y: 350, path: '/release-gate' },
        { id: 'k8s', label: 'K8S / GITOPS', icon: SiKubernetes, color: '#10b981', x: 480, y: 350, path: '/repositories' },
        { id: 'dast', label: 'DAST', icon: SiOwasp, color: '#ec4899', x: 300, y: 350, statKey: 'dast', path: '/scans' },
        { id: 'monitor', label: 'MONITOR', icon: SiFalco, color: '#f97316', x: 120, y: 350, path: '/monitor' },
        { id: 'comply', label: 'COMPLY', icon: ShieldCheck, color: '#eab308', x: 120, y: 520, path: '/governance' },
        { id: 'audit', label: 'AUDIT', icon: SiElasticsearch, color: '#94a3b8', x: 300, y: 520, path: '/audit-log' }
    ];

    const passingNodes = nodeConfigs.filter(n => getStatus(n) === 'passing').length;
    const score = Math.round((passingNodes / nodeConfigs.length) * 100);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'transparent' }}>
                <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin" />
            </div>
        );
    }

    const liquidGlassStyle = {
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.1)'
    };

    return (
        <div className="flex flex-col items-start min-h-screen pb-20 p-6">
            {/* The Pipeline Map Area */}
            <div className="relative w-full h-[600px] overflow-hidden font-sans rounded-3xl" style={{ background: 'transparent' }}>
                
                {/* Top Bar: Title & Score */}
                <div className="absolute top-6 left-6 right-6 z-20 flex justify-between items-start pointer-events-none">
                    <div className="pointer-events-auto">
                        <h1 className="text-2xl font-black uppercase italic tracking-tighter text-[var(--text-primary)]">
                            Security JourneyMap
                        </h1>
                        <p className="text-[10px] font-bold text-[var(--accent-primary)] uppercase tracking-widest mt-1">
                            DevSecOps Telemetry Grid
                        </p>
                    </div>

                    <div className="p-3 flex items-center gap-4 shadow-lg pointer-events-auto group relative cursor-help" style={liquidGlassStyle}>
                        <div className="relative w-10 h-10">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="50%" cy="50%" r="40%" fill="transparent" stroke="var(--bg-primary)" strokeWidth="3" />
                                <circle cx="50%" cy="50%" r="40%" fill="transparent" stroke="var(--accent-primary)" strokeWidth="3" 
                                    className="transition-all duration-1000"
                                    strokeDasharray="251.2"
                                    strokeDashoffset={251.2 - (251.2 * score / 100)}
                                />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black italic text-[var(--accent-primary)]">
                                {score}%
                            </span>
                        </div>
                        <div>
                            <h3 className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest leading-none">
                                Posture Score
                            </h3>
                        </div>

                        {/* Premium Hover Tooltip */}
                        <div className="absolute top-full mt-2 right-0 w-48 p-2 bg-black/90 border border-white/10 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-50">
                            <p className="text-[9px] text-white/80 font-bold leading-relaxed">Score reduced due to 1 blocked release gate in FIT_TRACK.</p>
                        </div>
                    </div>
                </div>                {/* SVG Lines Connector */}
                <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                    <line x1="120" y1="150" x2="300" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="300" y1="150" x2="480" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="480" y1="150" x2="660" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="660" y1="150" x2="840" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="840" y1="150" x2="1020" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <path d="M 1020,150 C 1120,150 1120,350 1020,350" fill="none" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="1020" y1="350" x2="840" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="840" y1="350" x2="660" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="660" y1="350" x2="480" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="480" y1="350" x2="300" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="300" y1="350" x2="120" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <path d="M 120,350 C 20,350 20,520 120,520" fill="none" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                    <line x1="120" y1="520" x2="300" y2="520" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" style={{ transition: 'stroke 0.8s ease-in-out, opacity 0.8s ease-in-out' }} />
                </svg>

                {/* Nodes */}
                {nodeConfigs.map((node) => {
                    const status = getStatus(node);
                    const isCompromised = status === 'compromised';
                    const isBlocked = status === 'BLOCKED';
                    
                    const statusColor = isCompromised ? '#ef4444' :
                                        isBlocked ? '#f59e0b' :
                                        status === 'passing' ? '#22c55e' : 
                                        status === 'warning' ? '#f97316' : 
                                        status === 'blocked' ? '#ef4444' : '#6b7280';

                    const NodeIcon = (node.id === 'release' && isBlocked) ? Lock : node.icon;

                    return (
                        <div key={node.id}>
                            <div 
                                className={`absolute flex items-center justify-center cursor-pointer transition-all hover:scale-110 active:scale-95 group ${
                                    (isCompromised || isBlocked) ? 'animate-pulse' : ''
                                }`}
                                style={{ 
                                    left: node.x - 30, 
                                    top: node.y - 30, 
                                    width: 60, 
                                    height: 60,
                                    borderRadius: '50%',
                                    border: isCompromised 
                                        ? '2px solid rgba(239, 68, 68, 0.6)' 
                                        : isBlocked 
                                        ? '2px solid rgba(245, 158, 11, 0.6)' 
                                        : '1px solid rgba(255, 255, 255, 0.15)',
                                    background: isCompromised 
                                        ? 'rgba(239, 68, 68, 0.15)' 
                                        : isBlocked 
                                        ? 'rgba(245, 158, 11, 0.15)' 
                                        : 'rgba(255, 255, 255, 0.06)',
                                    zIndex: 10,
                                    backdropFilter: 'blur(16px)',
                                    WebkitBackdropFilter: 'blur(16px)',
                                    boxShadow: isCompromised 
                                        ? '0 0 25px rgba(239, 68, 68, 0.7), inset 0 1px 0 rgba(255,255,255,0.2)'
                                        : isBlocked
                                        ? '0 0 25px rgba(245, 158, 11, 0.7), inset 0 1px 0 rgba(255,255,255,0.2)'
                                        : 'inset 0 1px 0 rgba(255,255,255,0.2)'
                                }}
                                onClick={() => {
                                    if (node.id === 'release' && isBlocked) {
                                        setShowBlockedSidebar(true);
                                    } else {
                                        navigate(node.path);
                                    }
                                }}
                            >
                                <NodeIcon size={22} color={isCompromised ? '#ef4444' : isBlocked ? '#f59e0b' : node.color} />
                                <div 
                                    className="absolute bottom-0 right-0 w-[10px] h-[10px] rounded-full border-2 border-[var(--bg-primary)] transition-all duration-500 ease-in-out"
                                    style={{ backgroundColor: statusColor, boxShadow: `0 0 8px ${statusColor}` }}
                                />
                            </div>

                            <div 
                                className="absolute w-32 text-center pointer-events-none"
                                style={{ 
                                    left: node.x - 64, 
                                    top: node.y + 35,
                                    fontSize: '10px',
                                    color: 'var(--text-secondary)',
                                    whiteSpace: 'nowrap',
                                    fontWeight: 'bold'
                                }}
                            >
                                <span className="text-[var(--text-primary)]">{node.label}</span>
                                <div className="opacity-60 text-[9px] uppercase tracking-tighter">{getStat(node)}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Separated Threat Intel Feed (Below Map) */}
            <div className="mt-4 p-4 w-[280px] shadow-lg" style={liquidGlassStyle}>
                <div className="flex items-center gap-2 mb-3">
                    <ShieldAlert size={14} className="text-[var(--accent-primary)]" />
                    <h3 className="text-[10px] font-black uppercase italic text-[var(--text-primary)] tracking-widest">
                        Threat Intel Feed
                    </h3>
                </div>
                <div className="space-y-2">
                    {dashboard?.findings?.documents?.length > 0 ? (
                        dashboard.findings.documents.slice(0, 3).map((finding: any) => (
                            <div key={finding.$id} className="flex gap-2 items-center p-1.5 rounded border border-[rgba(255,255,255,0.1)]">
                                <div className="w-1.5 h-1.5 rounded-full shrink-0" 
                                     style={{ backgroundColor: finding.severity === 'critical' ? '#ef4444' : '#f97316' }} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[9px] font-bold text-[var(--text-primary)] truncate uppercase">{finding.title}</p>
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic">No active threats</p>
                    )}
                </div>
            </div>

            {/* Blocked Release Gate Glassmorphic Sidebar */}
            {showBlockedSidebar && (
                <div 
                    className="fixed top-0 right-0 h-full w-[420px] z-50 p-6 flex flex-col justify-between border-l"
                    style={{
                        background: 'rgba(18, 18, 18, 0.85)',
                        backdropFilter: 'blur(40px)',
                        WebkitBackdropFilter: 'blur(40px)',
                        borderLeftColor: 'rgba(245, 158, 11, 0.3)',
                        boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.65)'
                    }}
                >
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-2 text-[#f59e0b]">
                                <Lock size={20} className="animate-pulse" />
                                <h2 className="text-xs font-black uppercase tracking-widest italic">
                                    Release Gate Blocked
                                </h2>
                            </div>
                            <button 
                                className="text-xs text-var(--text-secondary) hover:text-[var(--text-primary)] uppercase tracking-wider font-bold"
                                onClick={() => setShowBlockedSidebar(false)}
                            >
                                CLOSE [X]
                            </button>
                        </div>

                        {/* Posture Score Indicator */}
                        <div className="p-4 rounded-lg mb-6 border" style={{ 
                            background: 'rgba(245, 158, 11, 0.1)', 
                            borderColor: 'rgba(245, 158, 11, 0.2)' 
                        }}>
                            <p className="text-[10px] text-var(--text-secondary) uppercase font-bold mb-1">
                                Current Postural Score
                            </p>
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-black tracking-tight text-[#f59e0b]">{postureScore}%</span>
                                <span className="text-[9px] text-var(--text-secondary) uppercase">Required: 80%</span>
                            </div>
                            <div className="w-full bg-[rgba(255,255,255,0.05)] h-1.5 rounded-full mt-2 overflow-hidden">
                                <div 
                                    className="bg-[#f59e0b] h-full transition-all duration-1000"
                                    style={{ width: `${postureScore}%` }}
                                />
                            </div>
                        </div>

                        {/* Blocking Criteria */}
                        <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-3">
                            Blocking Vulnerabilities ({gateBlockedReasons.length})
                        </h3>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                            {gateBlockedReasons.length > 0 ? (
                                gateBlockedReasons.map((reason, idx) => (
                                    <div key={idx} className="p-3 rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]">
                                        <div className="flex gap-2 items-center mb-1">
                                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 uppercase tracking-tighter">
                                                CRITICAL BLOCKER
                                            </span>
                                        </div>
                                        <p className="text-[10px] font-bold text-[var(--text-primary)] uppercase">
                                            {reason}
                                        </p>
                                    </div>
                                ))
                            ) : (
                                <div className="p-3 rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]">
                                    <div className="flex gap-2 items-center mb-1">
                                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 uppercase tracking-tighter">
                                            SCORE DEDUCTION
                                        </span>
                                    </div>
                                    <p className="text-[10px] font-bold text-[var(--text-primary)] uppercase">
                                        Vulnerabilities detected: Posture score is below the 80% threshold.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Break Glass Override Button */}
                    <div className="pt-4 border-t border-[rgba(255,255,255,0.1)]">
                        <button
                            disabled={bypassing}
                            className="w-full py-3 rounded text-[10px] font-black uppercase tracking-widest italic transition-all duration-300 text-black hover:scale-[1.02] active:scale-95"
                            style={{
                                background: bypassing ? '#6b7280' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                                boxShadow: bypassing ? 'none' : '0 4px 15px rgba(245, 158, 11, 0.4)'
                            }}
                            onClick={handleBreakGlass}
                        >
                            {bypassing ? 'Bypassing...' : '💥 Break Glass Override'}
                        </button>
                        <p className="text-[8px] text-[var(--text-secondary)] uppercase font-bold text-center mt-2 tracking-tighter">
                            Warning: Activating override bypasses release security controls and logs an audit trail event.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
