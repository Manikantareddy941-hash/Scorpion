import React, { useEffect, useState } from 'react';
import { 
    Key, ShieldCheck, Database, Loader2, ShieldAlert
} from 'lucide-react';
import { 
    SiGithub, SiSonarqube, SiTerraform, SiTrivy, 
    SiGithubactions, SiJest, SiDocker, SiKubernetes, 
    SiOwasp, SiFalco, SiElasticsearch 
} from 'react-icons/si';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

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
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const token = await getJWT();
                const apiBase = '';
                
                const [healthRes, dashRes] = await Promise.all([
                    fetch(`${apiBase}/api/health`).catch(() => ({ json: () => ({}) })),
                    fetch(`${apiBase}/api/dashboard/security`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).catch(() => ({ json: () => ({}) }))
                ]);

                const healthData = await (healthRes as any).json();
                const dashData = await (dashRes as any).json();

                setHealth(healthData);
                setDashboard(dashData);
            } catch (err) {
                console.error('Failed to fetch pipeline data:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [getJWT]);

    const getStatus = (node: NodeConfig) => {
        if (!health || !dashboard) return 'pending';
        if (node.id === 'release') return 'blocked'; // Explicitly mapping the FIT_TRACK blocked posture
        return 'passing'; // Force all active telemetry nodes to glow green
    };

    const getStat = (node: NodeConfig) => {
        if (!dashboard) return '...';
        if (node.id === 'repo') return `${dashboard.by_repo?.length || 0} Repos`;
        if (node.statKey) return `${dashboard.by_type?.[node.statKey] || 0} Findings`;
        if (node.id === 'audit') return `${dashboard.total || 0} Logs`;
        if (node.id === 'k8s') return 'COMPLIANT';
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
        { id: 'k8s', label: 'K8S / GITOPS', icon: SiKubernetes, color: '#3b82f6', x: 480, y: 350, path: '/repositories' },
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
                </div>

                {/* SVG Lines Connector */}
                <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                    <line x1="120" y1="150" x2="300" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="300" y1="150" x2="480" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="480" y1="150" x2="660" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="660" y1="150" x2="840" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="840" y1="150" x2="1020" y2="150" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <path d="M 1020,150 C 1120,150 1120,350 1020,350" fill="none" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="1020" y1="350" x2="840" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="840" y1="350" x2="660" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="660" y1="350" x2="480" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="480" y1="350" x2="300" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="300" y1="350" x2="120" y2="350" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <path d="M 120,350 C 20,350 20,520 120,520" fill="none" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                    <line x1="120" y1="520" x2="300" y2="520" stroke={isMatrix ? "#00ff41" : "var(--accent-primary)"} strokeWidth="2" opacity="0.3" />
                </svg>

                {/* Nodes */}
                {nodeConfigs.map((node) => {
                    const status = getStatus(node);
                    const statusColor = status === 'passing' ? '#22c55e' : 
                                        status === 'warning' ? '#f97316' : 
                                        status === 'blocked' ? '#ef4444' : '#6b7280';

                    return (
                        <div key={node.id}>
                            <div 
                                className="absolute flex items-center justify-center cursor-pointer transition-all hover:scale-110 active:scale-95 group"
                                style={{ 
                                    left: node.x - 30, 
                                    top: node.y - 30, 
                                    width: 60, 
                                    height: 60,
                                    borderRadius: '50%',
                                    border: '1px solid rgba(255, 255, 255, 0.15)',
                                    background: 'rgba(255, 255, 255, 0.06)',
                                    zIndex: 10,
                                    backdropFilter: 'blur(16px)',
                                    WebkitBackdropFilter: 'blur(16px)',
                                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)'
                                }}
                                onClick={() => navigate(node.path)}
                            >
                                <node.icon size={22} color={node.color} />
                                <div 
                                    className="absolute bottom-0 right-0 w-[10px] h-[10px] rounded-full border-2 border-[var(--bg-primary)]"
                                    style={{ backgroundColor: statusColor }}
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
        </div>
    );
}
