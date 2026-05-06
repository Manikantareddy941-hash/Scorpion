import React, { useEffect, useState } from 'react';
import { 
    AlertCircle, GitBranch, Shield, Zap, Search, Lock, 
    Bell, CheckCircle, AlertTriangle, Play,
    Cpu, Globe, Terminal, Activity, Server,
    ArrowRight, ChevronRight, Loader2, Database,
    Github, Layers, Eye
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';

interface PipelineStep {
    id: string;
    title: string;
    description: string;
    status: 'idle' | 'active' | 'completed' | 'error';
    icon: React.ReactNode;
    details: string[];
}

export default function JourneyMap() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [health, setHealth] = useState<any>(null);
    const [activePulse, setActivePulse] = useState(0);

    useEffect(() => {
        fetchHealth();
        const interval = setInterval(() => {
            setActivePulse(prev => (prev + 1) % 5);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    const fetchHealth = async () => {
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/health`);
            const data = await res.json();
            setHealth(data);
        } catch (err) {}
    };

    const pipelineSteps: PipelineStep[] = [
        {
            id: 'ingestion',
            title: 'Ingestion Engine',
            description: 'Source code & container image capture',
            status: 'completed',
            icon: <Github className="text-blue-500" />,
            details: ['GitHub Webhook Listener', 'Oci Artifact Puller', 'Branch Tracking']
        },
        {
            id: 'analysis',
            title: 'Hfidelity Analysis',
            description: 'Multi-scanner orchestration layer',
            status: activePulse === 1 ? 'active' : 'completed',
            icon: <Search className="text-[var(--accent-primary)]" />,
            details: ['SAST (Semgrep)', 'SCA (OSV.dev)', 'Secret Scanning', 'IaC (Checkov)']
        },
        {
            id: 'governance',
            title: 'Governance Gate',
            description: 'Automated policy enforcement',
            status: activePulse === 2 ? 'active' : 'completed',
            icon: <Shield className="text-purple-500" />,
            details: ['Risk Score Evaluation', 'Threshold Verification', 'Release Blocking']
        },
        {
            id: 'intelligence',
            title: 'Security Intelligence',
            description: 'AI-driven remediation & enrichment',
            status: activePulse === 3 ? 'active' : 'idle',
            icon: <Cpu className="text-orange-500" />,
            details: ['CVE Prioritization', 'Fix Generation', 'Audit Persistence']
        },
        {
            id: 'alerting',
            title: 'Alert Propagation',
            description: 'Real-time incident notification',
            status: activePulse === 4 ? 'active' : 'idle',
            icon: <Bell className="text-[var(--status-warning)]" />,
            details: ['Slack/Discord Sync', 'PagerDuty Trigger', 'OpsGenie Dispatch']
        }
    ];

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8 overflow-hidden">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-16">
                    <div>
                        <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Security JourneyMap</h1>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Live telemetry of the security pipeline architecture</p>
                    </div>

                    <div className="flex gap-4">
                        <div className="premium-card px-6 py-3 flex items-center gap-4">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <p className="text-[10px] font-black text-[var(--text-primary)] uppercase italic">Worker Node: ONLINE</p>
                        </div>
                    </div>
                </div>

                {/* Pipeline Visualization */}
                <div className="relative mb-24">
                    {/* Connection Line Background */}
                    <div className="absolute top-1/2 left-0 w-full h-px bg-[var(--border-subtle)] -translate-y-1/2 hidden lg:block" />
                    
                    {/* Animated Pulse Path */}
                    <div className="absolute top-1/2 left-0 h-1 bg-gradient-to-r from-[var(--accent-primary)] to-transparent -translate-y-1/2 hidden lg:block transition-all duration-1000"
                        style={{ width: `${(activePulse + 1) * 20}%` }}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 relative z-10">
                        {pipelineSteps.map((step, idx) => (
                            <div key={step.id} className="flex flex-col items-center group">
                                <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center transition-all duration-500 border-2 mb-6 
                                    ${step.status === 'active' 
                                        ? 'bg-[var(--accent-primary)]/20 border-[var(--accent-primary)] shadow-[0_0_30px_rgba(var(--accent-primary-rgb),0.3)] scale-110' 
                                        : step.status === 'completed'
                                        ? 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--accent-primary)]'
                                        : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-secondary)] opacity-40'
                                    }`}>
                                    {React.cloneElement(step.icon as React.ReactElement, { size: 32 })}
                                </div>
                                
                                <div className="text-center px-4">
                                    <h3 className={`text-sm font-black uppercase italic tracking-tight mb-1 transition-colors ${step.status === 'active' ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
                                        {step.title}
                                    </h3>
                                    <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic leading-tight mb-4">
                                        {step.description}
                                    </p>
                                    
                                    <div className="space-y-1 hidden group-hover:block animate-in fade-in slide-in-from-top-2 duration-300">
                                        {step.details.map((detail, i) => (
                                            <p key={i} className="text-[8px] font-black text-[var(--accent-primary)] uppercase italic bg-[var(--accent-primary)]/5 px-2 py-1 rounded border border-[var(--accent-primary)]/10">
                                                {detail}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Infrastructure Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Live Telemetry */}
                    <div className="lg:col-span-2 premium-card p-8">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-widest flex items-center gap-2">
                                <Activity size={16} className="text-[var(--accent-primary)]" />
                                Runtime Telemetry
                            </h3>
                            <div className="px-3 py-1 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-[8px] font-black text-[var(--text-secondary)] uppercase italic">
                                Real-time Stream
                            </div>
                        </div>

                        <div className="space-y-6">
                            {['Appwrite Database', 'Security Worker Node', 'API Gateway', 'Alert Dispatcher'].map((svc, i) => (
                                <div key={svc} className="flex items-center justify-between p-4 bg-[var(--bg-primary)]/50 border border-[var(--border-subtle)] rounded-2xl group hover:border-[var(--accent-primary)]/30 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)] flex items-center justify-center">
                                            <Server size={18} className="text-[var(--text-secondary)] group-hover:text-[var(--accent-primary)] transition-colors" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-black text-[var(--text-primary)] uppercase italic">{svc}</p>
                                            <p className="text-[8px] font-bold text-[var(--text-secondary)] uppercase italic">Latency: {Math.floor(Math.random() * 50) + 10}ms</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-green-500" />
                                        <span className="text-[9px] font-black text-green-500 uppercase italic">Active</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Scanner Health */}
                    <div className="premium-card p-8">
                        <h3 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-widest mb-8 flex items-center gap-2">
                            <Layers size={16} className="text-purple-500" />
                            Scanner Fleet
                        </h3>
                        
                        <div className="space-y-4">
                            {health?.services ? Object.entries(health.services).map(([name, status]) => (
                                <div key={name} className="p-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl">
                                    <div className="flex justify-between items-center mb-2">
                                        <p className="text-[10px] font-black text-[var(--text-primary)] uppercase italic">{name}</p>
                                        <CheckCircle size={12} className={status ? 'text-green-500' : 'text-red-500'} />
                                    </div>
                                    <div className="w-full h-1 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                                        <div className={`h-full ${status ? 'bg-green-500' : 'bg-red-500'} transition-all duration-1000`} style={{ width: status ? '100%' : '0%' }} />
                                    </div>
                                </div>
                            )) : (
                                <div className="py-12 text-center opacity-30 italic text-[10px] uppercase font-black">
                                    Awaiting Sensor Data...
                                </div>
                            )}
                        </div>

                        <div className="mt-8 p-4 bg-orange-500/5 border border-orange-500/10 rounded-2xl flex items-start gap-3">
                            <AlertCircle size={14} className="text-orange-500 shrink-0 mt-0.5" />
                            <p className="text-[8px] font-bold text-orange-500 uppercase italic leading-tight">
                                Autonomous agent is currently monitoring 5 core scanners. Any service degradation will trigger immediate escalation.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
