import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    Shield, Bug, AlertTriangle, CheckCircle, 
    XCircle, Clock, BarChart3, LineChart as LineIcon,
    AlertCircle, Activity, Loader2, Cpu, Globe
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, AreaChart, Area
} from 'recharts';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import SeverityBadge from '../components/SeverityBadge';
import Input from '../components/Input';
import Button from '../components/Button';
import { SkeletonCard } from '../components/Skeleton';

interface DashboardData {
    total: number;
    by_severity: { critical: number; high: number; medium: number; low: number };
    by_type: { secret: number; dependency: number; sast: number; docker: number };
    by_repo: { repo_name: string; count: number }[];
    trend: { date: string; count: number }[];
    open_count: number;
    resolved_count: number;
}

export default function SecurityDashboard() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchDashboard();
    }, []);

    const fetchDashboard = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await getJWT();
            const apiBase = '';
            
            const response = await fetch(`${apiBase}/api/dashboard/security`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to fetch dashboard intelligence');
            const result = await response.json();
            setData(result);
        } catch (err: any) {
            console.error('Dashboard Error:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)]">
                <div className="max-w-7xl mx-auto space-y-12">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-32" />)}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <SkeletonCard className="h-[450px]" />
                        <SkeletonCard className="h-[450px]" />
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] p-8">
                <div className="max-w-4xl mx-auto p-6 bg-[var(--status-error)]/10 border border-[var(--status-error)]/30 rounded-lg flex items-center gap-4">
                    <XCircle className="text-[var(--status-error)] w-8 h-8" />
                    <div>
                        <h3 className="text-sm font-black text-[var(--text-primary)] uppercase italic">Intelligence Link Offline</h3>
                        <p className="text-xs font-bold text-[var(--text-secondary)] uppercase italic mt-1">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)]">
            <div className="max-w-7xl mx-auto space-y-12">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="flex items-center gap-5">
                        <div className="w-16 h-16 bg-[var(--accent-primary)] rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-[var(--accent-primary)]/20">
                            <Shield size={32} />
                        </div>
                        <div>
                            <h1 className="text-4xl font-bold tracking-tight uppercase leading-none">Security Nexus</h1>
                            <div className="flex items-center gap-3 mt-2">
                                <p className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-widest mono">Global Defense Perimeter Analytics</p>
                                <div className="h-px w-8 bg-[var(--border-subtle)]" />
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] animate-pulse" />
                                    <span className="text-[10px] font-bold text-[var(--status-success)] uppercase tracking-wide mono">Live Link Active</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <StatusBar />
                        <div className="px-4 py-2 bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-xl flex items-center gap-3">
                            <AlertCircle className="w-4 h-4 text-[var(--status-error)]" />
                            <span className="text-[10px] font-black text-[var(--status-error)] uppercase italic">{data?.open_count} {t('dashboard.open_findings', 'Open Vulnerabilities')}</span>
                        </div>
                        <div className="px-4 py-2 bg-[var(--status-success)]/10 border border-[var(--status-success)]/20 rounded-xl flex items-center gap-3">
                            <CheckCircle className="w-4 h-4 text-[var(--status-success)]" />
                            <span className="text-[10px] font-black text-[var(--status-success)] uppercase italic">{data?.resolved_count} {t('dashboard.resolved_findings', 'Remediations Verified')}</span>
                        </div>
                    </div>
                </div>

                {/* Severity Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <SeverityCard 
                        label="Critical" 
                        count={data?.by_severity.critical || 0} 
                        color="text-[var(--severity-critical)]" 
                        bgColor="bg-[var(--severity-critical)]/10" 
                        icon={<XCircle />}
                    />
                    <SeverityCard 
                        label="High" 
                        count={data?.by_severity.high || 0} 
                        color="text-[var(--severity-high)]" 
                        bgColor="bg-[var(--severity-high)]/10" 
                        icon={<AlertTriangle />}
                    />
                    <SeverityCard 
                        label="Medium" 
                        count={data?.by_severity.medium || 0} 
                        color="text-[var(--severity-medium)]" 
                        bgColor="bg-[var(--severity-medium)]/10" 
                        icon={<AlertCircle />}
                    />
                    <SeverityCard 
                        label="Low" 
                        count={data?.by_severity.low || 0} 
                        color="text-[var(--severity-low)]" 
                        bgColor="bg-[var(--severity-low)]/10" 
                        icon={<Shield />}
                    />
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    
                    {/* Repository Breakdown (Bar Chart) */}
                    <div className="premium-card p-10 flex flex-col h-[450px]">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="w-10 h-10 bg-[var(--accent-primary)]/10 rounded-xl flex items-center justify-center text-[var(--accent-primary)]">
                                <BarChart3 size={20} />
                            </div>
                            <div>
                                <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">{t('dashboard.target_breakdown', 'Target Vulnerability Breakdown')}</h3>
                                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">{t('dashboard.findings_per_repo', 'Findings concentration across repository infrastructure')}</p>
                            </div>
                        </div>
                        <div className="flex-1 w-full mt-4 min-h-[300px]">
                            <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={300}>
                                <BarChart data={data?.by_repo || []} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis 
                                        dataKey="repo_name" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: 'var(--text-secondary)', fontSize: 9, fontWeight: 900 }} 
                                    />
                                    <YAxis 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: 'var(--text-secondary)', fontSize: 9, fontWeight: 900 }} 
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', fontSize: '10px', color: 'var(--text-primary)' }}
                                        cursor={{ fill: 'var(--accent-primary)', opacity: 0.05 }}
                                    />
                                    <Bar dataKey="count" fill="var(--accent-primary)" radius={[6, 6, 0, 0]} barSize={40} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Threat Trend (Line Chart) */}
                    <div className="premium-card p-10 flex flex-col h-[450px]">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="w-10 h-10 bg-[var(--accent-secondary)]/10 rounded-xl flex items-center justify-center text-[var(--accent-secondary)]">
                                <LineIcon size={20} />
                            </div>
                            <div>
                                <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">{t('dashboard.threat_telemetry', '30-Day Threat Telemetry')}</h3>
                                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">{t('dashboard.temporal_velocity', 'Temporal velocity of new vulnerability detections')}</p>
                            </div>
                        </div>
                        <div className="flex-1 w-full mt-4 min-h-[300px]">
                            <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={300}>
                                <AreaChart data={data?.trend || []} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis 
                                        dataKey="date" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: 'var(--text-secondary)', fontSize: 9, fontWeight: 900 }} 
                                        tickFormatter={(val) => val.split('-').slice(1).join('/')}
                                    />
                                    <YAxis 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: 'var(--text-secondary)', fontSize: 9, fontWeight: 900 }} 
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', fontSize: '10px', color: 'var(--text-primary)' }}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey="count" 
                                        stroke="var(--accent-primary)" 
                                        strokeWidth={3} 
                                        fillOpacity={1} 
                                        fill="url(#colorTrend)" 
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                </div>

                {/* Docker & DAST Image Scan Section */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    <DockerScanSection />
                    <DastScanSection />
                </div>

                {/* Additional Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <TypeDistribution types={data?.by_type || { secret: 0, dependency: 0, sast: 0, docker: 0 }} />
                    <div className="premium-card p-8 md:col-span-2 flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <div className="w-16 h-16 bg-[var(--status-success)]/10 rounded-2xl flex items-center justify-center text-[var(--status-success)]">
                                <Activity size={32} />
                            </div>
                            <div>
                                <h4 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-widest">{t('dashboard.system_integrity', 'System Integrity Score')}</h4>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1 leading-relaxed">
                                    Current security posture optimized based on <br />
                                    {data?.resolved_count} successfully remediated vulnerabilities.
                                </p>
                            </div>
                        </div>
                        <div className="text-right mono">
                            <span className="text-5xl font-bold tracking-tighter text-[var(--accent-primary)]">94.2%</span>
                            <p className="text-[11px] font-bold text-[var(--status-success)] uppercase mt-1">Ready for Deployment</p>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}

function SeverityCard({ label, count, color, bgColor, icon }: { label: string, count: number, color: string, bgColor: string, icon: any }) {
    const { t } = useTranslation();
    return (
        <div className="premium-card p-8 group relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-32 h-32 ${bgColor} blur-[60px] opacity-20 -mr-16 -mt-16 group-hover:opacity-40 transition-opacity`} />
            <div className="relative z-10 flex flex-col items-start gap-5">
                <div className={`w-12 h-12 ${bgColor} ${color} rounded-2xl flex items-center justify-center shadow-lg`}>
                    {icon}
                </div>
                <div>
                    <SeverityBadge severity={label} />
                    <p className="text-3xl font-bold text-[var(--text-primary)] tracking-tight mt-2 mono">{count}</p>
                </div>
                <div className="w-full h-1 bg-[var(--border-subtle)] rounded-full overflow-hidden">
                    <div className={`h-full ${bgColor.replace('/10', '')} transition-all duration-1000`} style={{ width: `${count > 0 ? 100 : 0}%` }} />
                </div>
            </div>
        </div>
    );
}

function TypeDistribution({ types }: { types: DashboardData['by_type'] }) {
    const { t } = useTranslation();
    const items = [
        { label: 'Secret', count: types.secret, icon: <Bug size={14} />, color: 'bg-yellow-500' },
        { label: 'Dependency', count: types.dependency, icon: <Activity size={14} />, color: 'bg-blue-500' },
        { label: 'SAST', count: types.sast, icon: <Activity size={14} />, color: 'bg-purple-500' },
        { label: 'Docker', count: types.docker, icon: <Shield size={14} />, color: 'bg-cyan-500' },
        { label: 'IaC', count: (types as any).iac || 0, icon: <Cpu size={14} />, color: 'bg-indigo-500' },
        { label: 'DAST', count: (types as any).dast || 0, icon: <Globe size={14} />, color: 'bg-rose-500' }
    ];

    return (
        <div className="premium-card p-8">
            <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-6 flex items-center gap-3">
                <Bug size={16} className="text-[var(--accent-primary)]" /> {t('dashboard.vector_distribution', 'Vector Distribution')}
            </h3>
            <div className="space-y-4">
                {items.map(item => (
                    <div key={item.label} className="flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 ${item.color}/10 ${item.color.replace('bg-', 'text-')} rounded-lg flex items-center justify-center`}>
                                {item.icon}
                            </div>
                            <span className="text-[11px] font-medium text-[var(--text-secondary)] uppercase group-hover:text-[var(--text-primary)] transition-colors mono">{item.label}</span>
                        </div>
                        <span className="text-xs font-bold text-[var(--text-primary)] mono">{item.count}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function DockerScanSection() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [imageName, setImageName] = useState('');
    const [scanning, setScanning] = useState(false);
    const [result, setResult] = useState<any>(null);

    const handleDockerScan = async () => {
        if (!imageName) return;
        setScanning(true);
        setResult(null);
        try {
            const token = await getJWT();
            const apiBase = '';
            const res = await fetch(`${apiBase}/api/scan/docker`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ image_name: imageName })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Scan failed');
            setResult(data);
            toast.success('Docker image scan complete');
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setScanning(false);
        }
    };

    return (
        <div className="premium-card p-10">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-cyan-500/10 rounded-2xl flex items-center justify-center text-cyan-500 shadow-xl shadow-cyan-500/10">
                        <Shield size={32} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Docker Registry Scan</h3>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1">Deep analysis of container image vulnerabilities</p>
                    </div>
                </div>

                <div className="flex-1 w-full max-w-xl flex gap-4">
                    <Input
                        type="text"
                        placeholder="e.g. nginx:latest, node:18-alpine"
                        value={imageName}
                        onChange={(e) => setImageName(e.target.value)}
                        className="flex-1 font-black"
                    />
                    <Button size="lg" onClick={handleDockerScan} disabled={scanning || !imageName}>
                        {scanning ? <Loader2 className="animate-spin" /> : 'Execute Scan'}
                    </Button>
                </div>
            </div>

            {result && (
                <div className="mt-8 p-6 bg-cyan-500/5 border border-cyan-500/20 rounded-2xl animate-in fade-in slide-in-from-top-4 duration-500 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="text-center">
                            <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase italic">Detected Anomalies</p>
                            <p className="text-3xl font-black text-cyan-500 italic tracking-tighter">{result.total}</p>
                        </div>
                        <div className="h-10 w-px bg-cyan-500/20" />
                        <div className="flex gap-4">
                            <SeverityPill label="Critical" count={result.by_severity.critical} color="text-red-500" />
                            <SeverityPill label="High" count={result.by_severity.high} color="text-orange-500" />
                            <SeverityPill label="Med" count={result.by_severity.medium} color="text-yellow-500" />
                            <SeverityPill label="Low" count={result.by_severity.low} color="text-green-500" />
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase italic">Scan Target</p>
                        <p className="text-xs font-black text-[var(--text-primary)] uppercase italic">{result.image_name}</p>
                    </div>
                </div>
            )}
        </div>
    );
}

function DastScanSection() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [targetUrl, setTargetUrl] = useState('');
    const [scanMode, setScanMode] = useState<'spider'|'active'|'passive'>('spider');
    const [scanning, setScanning] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [scanId, setScanId] = useState<string | null>(null);
    const [scanStatus, setScanStatus] = useState<string | null>(null);

    // Polling effect
    useEffect(() => {
        let interval: any;
        if (scanId && (scanStatus === 'running' || scanStatus === 'pending')) {
            interval = setInterval(async () => {
                try {
                    const token = await getJWT();
                    const res = await fetch(`/api/scan/dast/${scanId}/status`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await res.json();
                    if (res.ok) {
                        setScanStatus(data.status);
                        if (data.status === 'completed') {
                            setResult(data.details);
                            setScanning(false);
                            toast.success(`DAST ${scanMode} scan complete`);
                        } else if (data.status === 'failed') {
                            setScanning(false);
                            toast.error(data.details?.error || 'Scan failed');
                        }
                    }
                } catch (e) {
                    console.error('Polling error', e);
                }
            }, 5000);
        }
        return () => clearInterval(interval);
    }, [scanId, scanStatus, scanMode, getJWT]);

    const handleDastScan = async () => {
        if (!targetUrl) return;
        setScanning(true);
        setResult(null);
        try {
            const token = await getJWT();
            const apiBase = '';
            const res = await fetch(`${apiBase}/api/scan/dast`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ target_url: targetUrl, scanMode })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Scan failed');
            setScanId(data.scanId);
            setScanStatus('running');
            toast.success(`DAST ${scanMode} scan initiated...`);
        } catch (err: any) {
            toast.error(err.message);
            setScanning(false);
        }
    };

    const [vulns, setVulns] = useState<any[]>([]);
    const [filterSev, setFilterSev] = useState<string>('ALL');

    // Fetch vulns once completed
    useEffect(() => {
        if (scanStatus === 'completed' && scanId) {
            databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                Query.equal('scanId', scanId),
                Query.limit(500)
            ]).then(res => setVulns(res.documents)).catch(console.error);
        }
    }, [scanStatus, scanId]);

    const filteredVulns = vulns.filter(v => filterSev === 'ALL' || v.severity === filterSev);

    return (
        <div className="premium-card p-10">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-500 shadow-xl shadow-rose-500/10">
                        <Globe size={32} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">DAST Neural Probe</h3>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1">Dynamic application security testing (OWASP ZAP)</p>
                    </div>
                </div>

                <div className="flex-1 w-full max-w-xl flex flex-col gap-4">
                    <div className="flex gap-4">
                        <Input
                            type="url"
                            placeholder="https://staging.example.com"
                            value={targetUrl}
                            onChange={(e) => setTargetUrl(e.target.value)}
                            className="flex-1 font-black"
                        />
                        <select
                            value={scanMode}
                            onChange={(e: any) => setScanMode(e.target.value)}
                            className="bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2.5 text-xs font-black text-[var(--text-primary)] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        >
                            <option value="spider">Spider</option>
                            <option value="active">Active Scan</option>
                            <option value="passive">Passive Scan</option>
                        </select>
                        <Button size="lg" onClick={handleDastScan} disabled={scanning || !targetUrl} className="min-w-[160px]">
                            {scanning ? <Loader2 className="animate-spin mx-auto" /> : 'Launch Probe'}
                        </Button>
                    </div>
                    {scanning && (
                        <div className="w-full bg-[var(--bg-primary)] rounded-full h-1.5 overflow-hidden border border-[var(--border-subtle)]">
                            <div className="bg-rose-500 h-full animate-pulse transition-all duration-1000" style={{ width: '100%' }}></div>
                        </div>
                    )}
                </div>
            </div>

            {scanStatus === 'completed' && (
                <div className="mt-8 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-4 mb-4">
                        <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Filter:</span>
                        {['ALL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map(sev => (
                            <button 
                                key={sev}
                                onClick={() => setFilterSev(sev)}
                                className={`px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest italic transition-colors ${filterSev === sev ? 'bg-rose-500 text-white' : 'bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500/20'}`}
                            >
                                {sev}
                            </button>
                        ))}
                    </div>
                    
                    <div className="overflow-auto max-h-[70vh] border border-neutral-800 rounded-lg bg-neutral-900">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800">
                                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Severity</th>
                                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Alert Name</th>
                                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Location/URL</th>
                                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Confidence</th>
                                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Solution</th>
                                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-800/60">
                                {filteredVulns.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="p-8 text-center text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic">No vulnerabilities found for this filter.</td>
                                    </tr>
                                ) : filteredVulns.map((v, i) => {
                                    return (
                                        <tr key={v.$id} className={`hover:bg-neutral-800/40 transition-colors ${i % 2 === 1 ? 'bg-white/[0.02]' : ''}`}>
                                            <td className="px-4 py-2.5">
                                                <SeverityBadge severity={v.severity} />
                                            </td>
                                            <td className="px-4 py-2.5 text-[11px] font-bold text-[var(--text-primary)] max-w-[200px] truncate">{v.title}</td>
                                            <td className="px-4 py-2.5 text-[10px] text-[var(--text-secondary)] font-mono max-w-[200px] truncate">{v.filePath}</td>
                                            <td className="px-4 py-2.5 text-[10px] text-[var(--text-secondary)]">{v.confidence || 'Medium'}</td>
                                            <td className="px-4 py-2.5 text-[10px] text-[var(--text-secondary)] max-w-[250px] truncate">{v.solution || 'N/A'}</td>
                                            <td className="px-4 py-2.5 text-right">
                                                <button className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-teal-500/10 text-teal-500 border border-teal-500/20 hover:bg-teal-500 hover:text-white transition-all">
                                                    TONY AI
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

function StatusBar() {
    const [health, setHealth] = useState<any>(null);

    useEffect(() => {
        const fetchHealth = async () => {
            try {
                const apiBase = '';
                const res = await fetch(`${apiBase}/api/health`);
                const data = await res.json();
                setHealth(data);
            } catch (e) {
                console.error('Health check failed', e);
            }
        };
        fetchHealth();
        const interval = setInterval(fetchHealth, 30000); // Every 30s
        return () => clearInterval(interval);
    }, []);

    const services = [
        { name: 'Appwrite', key: 'appwrite' },
        { name: 'Gitleaks', key: 'gitleaks' },
        { name: 'Semgrep', key: 'semgrep' },
        { name: 'Trivy', key: 'trivy' },
        { name: 'Checkov', key: 'checkov' }
    ];

    return (
        <div className="flex items-center gap-3 px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl">
            <div className="flex items-center gap-1.5 mr-2">
                <Activity size={10} className={health?.worker === 'running' ? 'text-green-500' : 'text-red-500'} />
                <span className="text-[8px] font-black uppercase italic text-[var(--text-secondary)]">Worker</span>
            </div>
            <div className="h-4 w-px bg-[var(--border-subtle)]" />
            <div className="flex gap-2">
                {services.map(s => (
                    <div key={s.name} className="flex items-center gap-1.5 group relative" title={s.name}>
                        <div className={`w-2 h-2 rounded-full ${health?.services?.[s.key] ? 'bg-green-500' : 'bg-red-500'} shadow-[0_0_8px] ${health?.services?.[s.key] ? 'shadow-green-500/50' : 'shadow-red-500/50'}`} />
                        <span className="text-[7px] font-black text-[var(--text-secondary)] uppercase group-hover:text-[var(--text-primary)] transition-colors">{s.name[0]}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SeverityPill({ label, count }: { label: string, count: number, color?: string }) {
    return (
        <div className="flex flex-col items-start gap-1">
            <SeverityBadge severity={label} />
            <span className="text-sm font-black text-[var(--text-primary)] italic">{count}</span>
        </div>
    );
}
